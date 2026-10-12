// Who may walk straight in to a training lodge.
//
// Whoever runs the training hands out links. A link carries a key, and signs
// its holder in to a training account without a password, or opens a sample
// booking as its guest. On a lodge that is not kept for training, and for
// anyone without the key, there is nothing at these addresses.

import { timingSafeEqual } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { type Day, addDays } from "@/lib/dates";
import { NotAllowed, type Staff } from "@/server/staff/permissions";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

import { TRAINING_STAFF } from "./sample";

/** True when this is a training lodge and the link carries its key. */
export function hasTrainingKey(request: Request): boolean {
  const key = env.trainingKey;
  const given = new URL(request.url).searchParams.get("key") ?? "";
  if (!env.training || !key || given.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

/** The training account a link names, if there is one. */
export async function trainingAccount(who: string): Promise<{ id: number } | null> {
  const person = TRAINING_STAFF.find((candidate) => candidate.key === who);
  if (!person) return null;
  const [found] = await db()
    .select({ id: schema.staff.id })
    .from(schema.staff)
    .where(and(eq(schema.staff.email, person.email), eq(schema.staff.training, true), eq(schema.staff.active, true)));
  return found ?? null;
}

/**
 * A sample booking for a visitor to open as its guest: confirmed, a few weeks
 * off, with a balance still to pay, so there is something to do with it.
 */
export async function bookingToTry(today: Day): Promise<{ reference: string; linkVersion: number } | null> {
  const found = await db().execute<{ reference: string; link_version: number }>(sql`
    SELECT b.reference, b.link_version
    FROM bookings b
    WHERE b.sample AND b.status = 'confirmed'
      AND lower(b.stay) BETWEEN ${addDays(today, 16)}::date AND ${addDays(today, 60)}::date
      AND b.total_cents > (SELECT coalesce(sum(p.cents), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'paid')
    ORDER BY b.created_at DESC
    LIMIT 1
  `);
  const row = found.rows[0];
  return row ? { reference: row.reference, linkVersion: row.link_version } : null;
}

const BOOKINGS_AN_HOUR = 12;
const BLOCKS_AN_HOUR = 6;
const LONGEST_BLOCK = 7;

/**
 * A training account is open to anyone who is given a link, so one person
 * must not be able to fill the lodge for the next. These are the limits.
 */
export async function trainingMayBook(staff: Staff, now: Date): Promise<void> {
  if (!staff.training) return;
  const [{ made }] = await db()
    .select({ made: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.createdBy, staff.id),
        sql`${schema.bookings.createdAt} > ${new Date(now.getTime() - 3_600_000)}`,
      ),
    );
  if (made >= BOOKINGS_AN_HOUR) {
    throw new NotAllowed(
      `Training accounts can make ${BOOKINGS_AN_HOUR} bookings an hour, so that the rooms are not all taken for the next person. Try again a little later.`,
    );
  }
}

export async function trainingMayBlock(staff: Staff, nights: number, now: Date): Promise<void> {
  if (!staff.training) return;
  if (nights > LONGEST_BLOCK) {
    throw new NotAllowed(`Training accounts can take a room off sale for up to ${LONGEST_BLOCK} nights at a time.`);
  }
  const [{ made }] = await db()
    .select({ made: sql<number>`count(*)::int` })
    .from(schema.allocations)
    .where(
      and(
        eq(schema.allocations.createdBy, staff.id),
        sql`${schema.allocations.bookingId} IS NULL`,
        sql`${schema.allocations.createdAt} > ${new Date(now.getTime() - 3_600_000)}`,
      ),
    );
  if (made >= BLOCKS_AN_HOUR) {
    throw new NotAllowed(
      `Training accounts can take ${BLOCKS_AN_HOUR} rooms off sale an hour. Try again a little later.`,
    );
  }
}
