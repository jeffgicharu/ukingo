// The calendar the front desk works from: every room down the side, days
// across the top, and who has which room on which nights.

import { sql } from "drizzle-orm";

import { type Day, addDays } from "@/lib/dates";
import { db } from "@/server/db";
import type { BookingStatus } from "@/server/db/schema";

export type CalendarRoom = { id: number; name: string; typeId: number; typeName: string; sleeps: number };

export type CalendarEntry = {
  allocationId: number;
  roomId: number;
  from: Day;
  to: Day;
  bookingId: number | null;
  reference: string | null;
  guestName: string | null;
  status: BookingStatus | null;
  guests: number | null;
  /** True when nothing more is owed. */
  paid: boolean;
  sample: boolean;
  blockReason: string | null;
};

export type CalendarWindow = { from: Day; to: Day; days: Day[]; rooms: CalendarRoom[]; entries: CalendarEntry[] };

export async function calendarWindow(from: Day, dayCount: number, now: Date): Promise<CalendarWindow> {
  const to = addDays(from, dayCount);

  const rooms = await db().execute<{
    id: number;
    name: string;
    type_id: number;
    type_name: string;
    sleeps: number;
  }>(sql`
    SELECT r.id, r.name, t.id AS type_id, t.name AS type_name, t.sleeps
    FROM rooms r JOIN room_types t ON t.id = r.room_type_id
    WHERE r.active
    ORDER BY t.position, r.position
  `);

  // A stay is drawn up to the morning the guest leaves, so one that ends on the first day shown still appears.
  const entries = await db().execute<{
    allocation_id: number;
    room_id: number;
    from: Day;
    to: Day;
    booking_id: number | null;
    reference: string | null;
    guest_name: string | null;
    status: BookingStatus | null;
    guests: number | null;
    paid: boolean;
    sample: boolean | null;
    block_reason: string | null;
  }>(sql`
    SELECT a.id AS allocation_id, a.room_id,
      lower(a.stay)::text AS "from", upper(a.stay)::text AS "to",
      b.id AS booking_id, b.reference, b.guest_name, b.status, (b.adults + b.children) AS guests,
      coalesce(b.total_cents <= (
        coalesce((SELECT sum(cents) FROM payments p WHERE p.booking_id = b.id AND p.status = 'paid'), 0) -
        coalesce((SELECT sum(cents) FROM refunds f WHERE f.booking_id = b.id), 0)), false) AS paid,
      b.sample, a.block_reason
    FROM allocations a
    LEFT JOIN bookings b ON b.id = a.booking_id
    WHERE a.stay && daterange(${addDays(from, -1)}::date, ${to}::date)
      AND upper(a.stay) >= ${from}::date
      -- A hold that has run out is not drawn. A room off sale has no booking, and is always drawn.
      AND (b.id IS NULL OR NOT (b.status IN ('held', 'provisional') AND b.hold_until <= ${now}))
    ORDER BY a.room_id, lower(a.stay)
  `);

  return {
    from,
    to,
    days: Array.from({ length: dayCount }, (_, index) => addDays(from, index)),
    rooms: rooms.rows.map((room) => ({
      id: room.id,
      name: room.name,
      typeId: room.type_id,
      typeName: room.type_name,
      sleeps: room.sleeps,
    })),
    entries: entries.rows.map((entry) => ({
      allocationId: entry.allocation_id,
      roomId: entry.room_id,
      from: entry.from,
      to: entry.to,
      bookingId: entry.booking_id,
      reference: entry.reference,
      guestName: entry.guest_name,
      status: entry.status,
      guests: entry.guests,
      paid: entry.paid,
      sample: entry.sample ?? false,
      blockReason: entry.block_reason,
    })),
  };
}
