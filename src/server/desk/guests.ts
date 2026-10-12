// Guests, as the back office knows them: who they are, when they have stayed
// and are coming, and what they have spent.

import { desc, eq, inArray, sql } from "drizzle-orm";

import type { Day } from "@/lib/dates";
import { normalisePhone } from "@/lib/format";
import { moneyOfMany, type Money } from "@/server/booking/ledger";
import type { Booking } from "@/server/booking/service";
import { db, schema } from "@/server/db";
import { must, NotAllowed, type Staff } from "@/server/staff/permissions";

export const GUESTS_PER_PAGE = 30;

export type Guest = typeof schema.guests.$inferSelect;

export type ListedGuest = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  sample: boolean;
  /** Stays that went ahead or are still to come. */
  stays: number;
  lastStay: Day | null;
  nextStay: Day | null;
  /** Everything paid, less everything refunded or owed back. */
  spentCents: number;
};

export async function listGuests(q: string, page: number, today: Day): Promise<{ rows: ListedGuest[]; total: number }> {
  const text = q.replace(/[%_]/g, "");
  const phone = normalisePhone(q);
  const digits = q.replace(/\D/g, "").replace(/^0/, "");
  const matches = q
    ? sql`(
        g.name ILIKE ${`%${text}%`}
        OR g.email ILIKE ${`%${text}%`}
        ${phone ? sql`OR g.phone = ${phone}` : sql``}
        ${digits.length >= 4 ? sql`OR g.phone LIKE ${`%${digits}%`}` : sql``}
      )`
    : sql`true`;

  const counted = await db().execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM guests g WHERE ${matches}`,
  );

  // Guests with a stay coming are first, soonest first. Then whoever stayed most recently.
  const rows = await db().execute<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    sample: boolean;
    stays: number;
    last_stay: Day | null;
    next_stay: Day | null;
    spent_cents: number;
  }>(sql`
    SELECT g.id, g.name, g.phone, g.email, g.sample,
      s.stays, s.last_stay::text, s.next_stay::text, m.spent_cents
    FROM guests g
    CROSS JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'checked_out'))::int AS stays,
        max(lower(b.stay)) FILTER (WHERE b.status IN ('checked_in', 'checked_out')) AS last_stay,
        min(lower(b.stay)) FILTER (WHERE b.status IN ('confirmed', 'provisional') AND lower(b.stay) >= ${today}::date) AS next_stay
      FROM bookings b WHERE b.guest_id = g.id
    ) s
    CROSS JOIN LATERAL (
      SELECT (
        coalesce((SELECT sum(p.cents) FROM payments p JOIN bookings b ON b.id = p.booking_id
                   WHERE b.guest_id = g.id AND p.status = 'paid'), 0) -
        coalesce((SELECT sum(f.cents) FROM refunds f JOIN bookings b ON b.id = f.booking_id
                   WHERE b.guest_id = g.id), 0)
      )::bigint AS spent_cents
    ) m
    WHERE ${matches}
    ORDER BY s.next_stay NULLS LAST, s.last_stay DESC NULLS LAST, g.id DESC
    LIMIT ${GUESTS_PER_PAGE} OFFSET ${(page - 1) * GUESTS_PER_PAGE}
  `);

  return {
    total: counted.rows[0]?.total ?? 0,
    rows: rows.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      phone: row.phone,
      email: row.email,
      sample: row.sample,
      stays: row.stays,
      lastStay: row.last_stay,
      nextStay: row.next_stay,
      spentCents: Number(row.spent_cents),
    })),
  };
}

export type GuestStay = { booking: Booking; roomName: string; roomTypeName: string; money: Money };

export type GuestProfile = { guest: Guest; stays: GuestStay[]; spentCents: number; owedCents: number };

export async function guestProfile(id: number): Promise<GuestProfile | null> {
  if (!Number.isInteger(id)) return null;
  const [guest] = await db().select().from(schema.guests).where(eq(schema.guests.id, id));
  if (!guest) return null;

  const rows = await db()
    .select({ booking: schema.bookings, roomName: schema.rooms.name, roomTypeName: schema.roomTypes.name })
    .from(schema.bookings)
    .innerJoin(schema.rooms, eq(schema.rooms.id, schema.bookings.roomId))
    .innerJoin(schema.roomTypes, eq(schema.roomTypes.id, schema.bookings.roomTypeId))
    .where(eq(schema.bookings.guestId, id))
    .orderBy(desc(sql`lower(${schema.bookings.stay})`), desc(schema.bookings.id));

  const money = await moneyOfMany(
    db(),
    rows.map((row) => row.booking),
  );
  const stays = rows.map((row) => ({ ...row, money: money.get(row.booking.id)! }));
  return {
    guest,
    stays,
    spentCents: stays.reduce((sum, stay) => sum + stay.money.heldCents, 0),
    owedCents: stays.reduce((sum, stay) => sum + stay.money.owedCents, 0),
  };
}

/** Something that stops a guest's details being removed, in words for staff. */
export class GuestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestError";
  }
}

export const REMOVED = "Removed on request";
/** A guest whose details have been removed has no number. Nothing typed can ever match it. */
const NO_PHONE = "";

/**
 * Removes what identifies a guest, at their own request. The stays and the
 * payments stay in the books, because the law requires those records, but
 * the name, phone number, email address, notes, requests and every message
 * written to them are gone. It cannot be undone.
 */
export async function forgetGuest(staff: Staff, guestId: number, now: Date): Promise<number> {
  must(staff, "guests.forget");
  // A training account is open to anyone with a link. It does not get to erase people.
  if (staff.training) throw new NotAllowed("Training accounts cannot remove a guest's details.");
  return db().transaction(async (tx) => {
    const [guest] = await tx.select().from(schema.guests).where(eq(schema.guests.id, guestId));
    if (!guest) throw new GuestError("That guest could not be found.");

    const bookings = await tx
      .select({ id: schema.bookings.id, status: schema.bookings.status })
      .from(schema.bookings)
      .where(eq(schema.bookings.guestId, guestId));
    if (bookings.some((booking) => ["held", "provisional", "confirmed", "checked_in"].includes(booking.status))) {
      throw new GuestError(
        "This guest has a stay still to come or is in the house. Their details are needed until it is over or cancelled.",
      );
    }
    const refunds = await tx.execute(sql`
      SELECT 1 FROM refunds f JOIN bookings b ON b.id = f.booking_id
      WHERE b.guest_id = ${guestId} AND f.status = 'owed' LIMIT 1
    `);
    if (refunds.rows.length) {
      throw new GuestError("This guest is still owed a refund. Send it first: it goes to their phone number.");
    }

    const ids = bookings.map((booking) => booking.id);
    if (ids.length) {
      await tx.delete(schema.messages).where(inArray(schema.messages.bookingId, ids));
      await tx.delete(schema.bookingNotes).where(inArray(schema.bookingNotes.bookingId, ids));
      await tx
        .update(schema.payments)
        .set({ phone: null, originIp: null })
        .where(inArray(schema.payments.bookingId, ids));
      await tx
        .update(schema.bookings)
        .set({
          guestName: REMOVED,
          guestPhone: NO_PHONE,
          guestEmail: null,
          requests: "",
          arrivalTime: "",
          originIp: null,
        })
        .where(inArray(schema.bookings.id, ids));
      await tx.insert(schema.bookingEvents).values(
        ids.map((bookingId) => ({
          bookingId,
          at: now,
          actor: "staff" as const,
          staffId: staff.id,
          kind: "guest-forgotten",
          summary: "The guest's details were removed at their request.",
        })),
      );
    }
    await tx.delete(schema.messages).where(eq(schema.messages.guestId, guestId));
    await tx
      .update(schema.guests)
      .set({ name: REMOVED, phone: NO_PHONE, email: null, notes: "" })
      .where(eq(schema.guests.id, guestId));
    return ids.length;
  });
}
