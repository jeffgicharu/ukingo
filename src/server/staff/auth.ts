// Signing staff in and keeping them signed in. Nothing here depends on a web
// request, so the command-line tools use it too.
//
// A session is a long random value in a cookie. Only its SHA-256 is stored,
// so the table cannot be used to sign in as anyone. Sessions live in the
// database, which is why a release never signs anybody out.

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { verifyPassword } from "./passwords";
import type { Staff } from "./permissions";

export const SESSION_COOKIE = "desk";

const IDLE_MS = 12 * 3_600_000; // signed out after twelve hours without a click
const LONGEST_MS = 14 * 86_400_000; // and after two weeks whatever happens
const ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60_000;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export type SignInResult = { ok: true; token: string; staff: Staff } | { ok: false; reason: "wrong" | "locked" };

/** Checks an email and password. The answer is the same for a wrong password and an unknown address. */
export async function signIn(
  email: string,
  password: string,
  ip: string | null,
  userAgent: string,
): Promise<SignInResult> {
  const now = clock.now();
  const address = email.trim().toLowerCase();

  // Five wrong tries for one address, or twenty from one visitor, and the door stays shut for a while.
  const since = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
  const [{ forAddress, fromVisitor }] = await db()
    .select({
      forAddress: sql<number>`count(*) filter (where ${schema.signInAttempts.email} = ${address})::int`,
      fromVisitor: sql<number>`count(*) filter (where ${schema.signInAttempts.ip} = ${ip}::inet)::int`,
    })
    .from(schema.signInAttempts)
    .where(and(eq(schema.signInAttempts.succeeded, false), gt(schema.signInAttempts.at, since)));
  if (forAddress >= ATTEMPTS || (ip && fromVisitor >= ATTEMPTS * 4)) {
    return { ok: false, reason: "locked" };
  }

  const [member] = await db().select().from(schema.staff).where(eq(schema.staff.email, address));
  // The hash is checked even when there is no such member, so the time taken gives nothing away.
  const valid = await verifyPassword(password, member?.passwordHash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA");

  if (!member || !member.active || !valid) {
    await db()
      .insert(schema.signInAttempts)
      .values({ email: address.slice(0, 200), ip, at: now, succeeded: false });
    return { ok: false, reason: "wrong" };
  }

  const token = await openSession(member.id, ip, userAgent);
  await db().insert(schema.signInAttempts).values({ email: address, ip, at: now, succeeded: true });
  return { ok: true, token, staff: toStaff(member) };
}

/** Starts a session for a member of staff and returns the value for the cookie. */
export async function openSession(staffId: number, ip: string | null, userAgent: string): Promise<string> {
  const now = clock.now();
  const token = randomBytes(32).toString("base64url");
  await db()
    .insert(schema.staffSessions)
    .values({
      id: digest(token),
      staffId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + IDLE_MS),
      ip,
      userAgent: userAgent.slice(0, 300),
    });
  await db().update(schema.staff).set({ lastSignInAt: now }).where(eq(schema.staff.id, staffId));
  return token;
}

export async function closeSession(token: string): Promise<void> {
  await db()
    .delete(schema.staffSessions)
    .where(eq(schema.staffSessions.id, digest(token)));
}

/** Ends every session a member of staff has, for when their password changes or they leave. */
export async function closeAllSessions(staffId: number): Promise<void> {
  await db().delete(schema.staffSessions).where(eq(schema.staffSessions.staffId, staffId));
}

function toStaff(member: typeof schema.staff.$inferSelect): Staff {
  return { id: member.id, name: member.name, email: member.email, role: member.role, training: member.training };
}

/** Who a session token belongs to, if it is still good. Each use keeps it alive a little longer. */
export async function staffForToken(token: string | undefined): Promise<Staff | null> {
  if (!token) return null;
  const now = clock.now();
  const [row] = await db()
    .select({ session: schema.staffSessions, member: schema.staff })
    .from(schema.staffSessions)
    .innerJoin(schema.staff, eq(schema.staff.id, schema.staffSessions.staffId))
    .where(eq(schema.staffSessions.id, digest(token)));

  if (!row || !row.member.active || row.session.expiresAt <= now) return null;
  if (now.getTime() - row.session.createdAt.getTime() > LONGEST_MS) return null;

  // Written at most once a minute, not on every click.
  if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
    await db()
      .update(schema.staffSessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + IDLE_MS) })
      .where(eq(schema.staffSessions.id, row.session.id));
  }
  return toStaff(row.member);
}
