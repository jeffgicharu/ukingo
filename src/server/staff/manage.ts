// Who works at the lodge: adding people, changing what they may do, switching
// accounts off, and passwords.
//
// Accounts are switched off, never deleted, so the history of every booking
// keeps the name of whoever did each thing.

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db, schema, UNIQUE_VIOLATION, violates } from "@/server/db";
import type { StaffRole } from "@/server/db/schema";
import { env } from "@/server/env";
import { sendEmail } from "@/server/messages/deliver";
import { isDeliverable } from "@/server/messages/tell";
import { composeStaffMessage, LINK } from "@/server/messages/templates";

import { closeAllSessions } from "./auth";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { must, NotAllowed, type Staff } from "./permissions";

/** Something wrong with what was asked, in words for the person who asked. */
export class StaffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffError";
  }
}

const ROLES: StaffRole[] = ["owner", "reservations", "front_desk"];
export const isRole = (value: string): value is StaffRole => (ROLES as string[]).includes(value);

const RESET_GOOD_FOR_MS = 60 * 60_000;
const RESETS_AN_HOUR = 3;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

function checkPassword(password: string): void {
  const problem = passwordProblem(password);
  if (problem) throw new StaffError(`That password will not do. ${problem}`);
}

/** There must always be someone who can manage the rest: an owner whose account is on and is not for training. */
async function ownersWithout(staffId: number): Promise<number> {
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.staff)
    .where(
      and(
        eq(schema.staff.role, "owner"),
        eq(schema.staff.active, true),
        eq(schema.staff.training, false),
        sql`${schema.staff.id} <> ${staffId}`,
      ),
    );
  return count;
}

export async function addStaff(
  by: Staff,
  input: { name: string; email: string; role: string; password: string },
): Promise<void> {
  must(by, "staff.manage");
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 80) throw new StaffError("Enter the person's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    throw new StaffError("Enter the email address they will sign in with.");
  if (!isRole(input.role)) throw new StaffError("Choose what they do.");
  checkPassword(input.password);

  try {
    await db()
      .insert(schema.staff)
      .values({ name, email, role: input.role, passwordHash: await hashPassword(input.password) });
  } catch (error) {
    if (violates(error, UNIQUE_VIOLATION)) {
      throw new StaffError("Someone already signs in with that email address. Switch their account back on instead.");
    }
    throw error;
  }
}

export async function changeRole(by: Staff, staffId: number, role: string): Promise<void> {
  must(by, "staff.manage");
  if (!isRole(role)) throw new StaffError("Choose what they do.");
  if (staffId === by.id) throw new StaffError("You cannot change your own role. Ask another owner.");
  const [member] = await db().select().from(schema.staff).where(eq(schema.staff.id, staffId));
  if (!member) throw new StaffError("That person could not be found.");
  if (member.role === "owner" && role !== "owner" && (await ownersWithout(staffId)) === 0) {
    throw new StaffError("The lodge needs at least one owner.");
  }
  await db().update(schema.staff).set({ role }).where(eq(schema.staff.id, staffId));
  // What they may do has changed, so they sign in afresh.
  await closeAllSessions(staffId);
}

export async function setActive(by: Staff, staffId: number, active: boolean): Promise<string> {
  must(by, "staff.manage");
  if (staffId === by.id) throw new StaffError("You cannot switch off your own account. Ask another owner.");
  const [member] = await db().select().from(schema.staff).where(eq(schema.staff.id, staffId));
  if (!member) throw new StaffError("That person could not be found.");
  if (!active && member.role === "owner" && (await ownersWithout(staffId)) === 0) {
    throw new StaffError("The lodge needs at least one owner.");
  }
  await db().update(schema.staff).set({ active }).where(eq(schema.staff.id, staffId));
  if (!active) await closeAllSessions(staffId);
  return member.name;
}

/** An owner gives someone a new password, for when they are locked out and email will not do. */
export async function setPassword(by: Staff, staffId: number, password: string): Promise<string> {
  must(by, "staff.manage");
  checkPassword(password);
  const [member] = await db()
    .update(schema.staff)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(schema.staff.id, staffId))
    .returning({ name: schema.staff.name });
  if (!member) throw new StaffError("That person could not be found.");
  await closeAllSessions(staffId);
  return member.name;
}

/** Someone changes their own password. Every session they had is ended, the one in hand included. */
export async function changeOwnPassword(staff: Staff, current: string, next: string): Promise<void> {
  if (staff.training) {
    throw new NotAllowed("Training accounts are shared, so their passwords cannot be changed.");
  }
  const [member] = await db().select().from(schema.staff).where(eq(schema.staff.id, staff.id));
  if (!member || !(await verifyPassword(current, member.passwordHash))) {
    throw new StaffError("That is not your current password.");
  }
  checkPassword(next);
  if (await verifyPassword(next, member.passwordHash)) {
    throw new StaffError("The new password is the same as the old one.");
  }
  await db()
    .update(schema.staff)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(schema.staff.id, staff.id));
  await closeAllSessions(staff.id);
}

/**
 * Emails a link to choose a new password, if the address belongs to someone
 * who may sign in. It answers the same way whether it does or not, so the
 * form cannot be used to find out who works here.
 */
export async function requestReset(email: string, now: Date): Promise<void> {
  const address = email.trim().toLowerCase();
  const [member] = await db()
    .select()
    .from(schema.staff)
    .where(and(eq(schema.staff.email, address), eq(schema.staff.active, true), eq(schema.staff.training, false)));
  if (!member || !isDeliverable(member.email)) return;

  const [{ lately }] = await db()
    .select({ lately: sql<number>`count(*)::int` })
    .from(schema.passwordResets)
    .where(
      and(
        eq(schema.passwordResets.staffId, member.id),
        gt(schema.passwordResets.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  if (lately >= RESETS_AN_HOUR) return;

  const token = randomBytes(32).toString("base64url");
  await db()
    .insert(schema.passwordResets)
    .values({
      tokenHash: digest(token),
      staffId: member.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + RESET_GOOD_FOR_MS),
    });

  const [settings] = await db().select({ lodgeName: schema.settings.lodgeName }).from(schema.settings);
  const message = composeStaffMessage({
    lodgeName: settings?.lodgeName ?? "Ukingo",
    subject: "Choose a new password for the front desk",
    paragraphs: [
      `Dear ${member.name.split(" ")[0]}, someone asked to reset the password for your front desk account.`,
      "The button below is good for one hour and can be used once.",
    ],
    button: { label: "Choose a new password" },
    small: "If that was not you, do nothing: your password stays as it is.",
  });
  // The link exists only in the email. What is kept here is a fingerprint of it.
  const link = `${env.siteUrl}/desk/reset/${token}`;
  await sendEmail({
    to: member.email,
    subject: message.subject,
    html: message.html.replaceAll(LINK, link),
    text: message.text.replaceAll(LINK, link),
  });
}

/** Whether a reset link is still good, without using it up. */
export async function resetIsGood(token: string, now: Date): Promise<boolean> {
  const [row] = await db()
    .select({ staffId: schema.passwordResets.staffId })
    .from(schema.passwordResets)
    .where(
      and(
        eq(schema.passwordResets.tokenHash, digest(token)),
        isNull(schema.passwordResets.usedAt),
        gt(schema.passwordResets.expiresAt, now),
      ),
    );
  return row !== undefined;
}

/** Sets a new password from a reset link. The link works once. */
export async function resetPassword(token: string, password: string, now: Date): Promise<void> {
  checkPassword(password);
  const passwordHash = await hashPassword(password);
  const staffId = await db().transaction(async (tx) => {
    const [used] = await tx
      .update(schema.passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.passwordResets.tokenHash, digest(token)),
          isNull(schema.passwordResets.usedAt),
          gt(schema.passwordResets.expiresAt, now),
        ),
      )
      .returning({ staffId: schema.passwordResets.staffId });
    if (!used) return null;
    await tx.update(schema.staff).set({ passwordHash }).where(eq(schema.staff.id, used.staffId));
    return used.staffId;
  });
  if (staffId === null) {
    throw new StaffError("That link has been used or has run out. Ask for a new one.");
  }
  await closeAllSessions(staffId);
}
