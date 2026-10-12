// What the front desk needs to know right now: who arrives, who leaves, who
// is in house, how full the lodge is, and what needs someone's attention.

import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { type Day, addDays, lodgeDay } from "@/lib/dates";
import { moneyOfMany, type Money } from "@/server/booking/ledger";
import type { Booking } from "@/server/booking/service";
import { db, schema } from "@/server/db";

export type BoardBooking = {
  booking: Booking;
  roomName: string;
  roomTypeName: string;
  money: Money;
};

export type Board = {
  today: Day;
  rooms: number;
  occupiedTonight: number;
  arrivals: BoardBooking[];
  departures: BoardBooking[];
  inHouse: BoardBooking[];
  /** Rooms taken on each of the next fourteen nights. */
  nights: { night: Day; taken: number; blocked: number }[];
  overdue: BoardBooking[];
  holds: BoardBooking[];
  lapsingSoon: BoardBooking[];
  refundsOwed: {
    id: number;
    cents: number;
    reason: string;
    createdAt: Date;
    reference: string;
    guestName: string;
    bookingId: number;
  }[];
};

async function decorate(bookings: Booking[]): Promise<BoardBooking[]> {
  if (bookings.length === 0) return [];
  const rooms = await db()
    .select({ id: schema.rooms.id, name: schema.rooms.name, type: schema.roomTypes.name })
    .from(schema.rooms)
    .innerJoin(schema.roomTypes, eq(schema.roomTypes.id, schema.rooms.roomTypeId));
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const money = await moneyOfMany(db(), bookings);
  return bookings.map((booking) => ({
    booking,
    roomName: byId.get(booking.roomId)?.name ?? "",
    roomTypeName: byId.get(booking.roomId)?.type ?? "",
    money: money.get(booking.id)!,
  }));
}

export async function board(now: Date): Promise<Board> {
  const today = lodgeDay(now);
  const b = schema.bookings;

  const [{ rooms }] = await db()
    .select({ rooms: sql<number>`count(*)::int` })
    .from(schema.rooms)
    .where(eq(schema.rooms.active, true));

  // Arriving today: still to check in, or checked in today.
  const arrivals = await db()
    .select()
    .from(b)
    .where(and(inArray(b.status, ["confirmed", "provisional", "checked_in"]), sql`lower(${b.stay}) = ${today}::date`))
    .orderBy(asc(b.status), asc(b.guestName));

  // Leaving today: in house and due out, or already checked out today.
  const departures = await db()
    .select()
    .from(b)
    .where(
      sql`(${b.status} = 'checked_in' AND upper(${b.stay}) <= ${today}::date)
          OR (${b.status} = 'checked_out' AND (${b.checkedOutAt} AT TIME ZONE 'Africa/Nairobi')::date = ${today}::date)`,
    )
    .orderBy(asc(b.status), asc(b.guestName));

  const inHouse = await db()
    .select()
    .from(b)
    .where(and(eq(b.status, "checked_in"), sql`upper(${b.stay}) > ${today}::date`))
    .orderBy(sql`upper(${b.stay})`, asc(b.guestName));

  // How full each of the next fourteen nights is. A hold that has run out does not count.
  const strip = await db().execute<{ night: Day; taken: number; blocked: number }>(sql`
    SELECT d.night::date::text AS night,
      count(a.id) FILTER (WHERE a.booking_id IS NOT NULL)::int AS taken,
      count(a.id) FILTER (WHERE a.booking_id IS NULL)::int AS blocked
    FROM generate_series(${today}::date, ${addDays(today, 13)}::date, interval '1 day') AS d(night)
    LEFT JOIN allocations a ON a.stay @> d.night::date
      AND NOT EXISTS (
        SELECT 1 FROM bookings lapsed
        WHERE lapsed.id = a.booking_id AND lapsed.status IN ('held', 'provisional') AND lapsed.hold_until <= ${now}
      )
    GROUP BY 1 ORDER BY 1
  `);

  // Confirmed bookings whose balance should already have been paid, and guests who left with a bill open.
  const pastDue = await db()
    .select()
    .from(b)
    .where(
      or(
        and(
          eq(b.status, "confirmed"),
          sql`(${b.terms}->>'balance_due' < ${today} OR ${b.terms}->>'balance_due' IS NULL)`,
        ),
        and(
          eq(b.status, "checked_out"),
          sql`${b.totalCents} > coalesce((SELECT sum(p.cents) FROM payments p WHERE p.booking_id = ${b.id} AND p.status = 'paid'), 0)
            - coalesce((SELECT sum(f.cents) FROM refunds f WHERE f.booking_id = ${b.id}), 0)`,
        ),
      ),
    )
    .orderBy(sql`lower(${b.stay})`);
  const overdue = (await decorate(pastDue)).filter((entry) => entry.money.owedCents > 0);

  const holds = await db()
    .select()
    .from(b)
    .where(and(eq(b.status, "held"), gt(b.holdUntil, now)))
    .orderBy(asc(b.holdUntil));

  const lapsing = await db()
    .select()
    .from(b)
    .where(
      and(
        eq(b.status, "provisional"),
        gt(b.holdUntil, now),
        sql`${b.holdUntil} <= ${new Date(now.getTime() + 86_400_000)}`,
      ),
    )
    .orderBy(asc(b.holdUntil));

  const refundsOwed = await db()
    .select({
      id: schema.refunds.id,
      cents: schema.refunds.cents,
      reason: schema.refunds.reason,
      createdAt: schema.refunds.createdAt,
      reference: b.reference,
      guestName: b.guestName,
      bookingId: b.id,
    })
    .from(schema.refunds)
    .innerJoin(b, eq(b.id, schema.refunds.bookingId))
    .where(eq(schema.refunds.status, "owed"))
    .orderBy(asc(schema.refunds.createdAt));

  return {
    today,
    rooms,
    occupiedTonight: strip.rows[0]?.taken ?? 0,
    arrivals: await decorate(arrivals),
    departures: await decorate(departures),
    inHouse: await decorate(inHouse),
    nights: strip.rows,
    overdue,
    holds: await decorate(holds),
    lapsingSoon: await decorate(lapsing),
    refundsOwed,
  };
}

/** The number staff screens watch: it moves on whenever something they show has changed. */
export async function deskPulse(): Promise<number> {
  const result = await db().execute<{ value: number }>(sql`SELECT last_value::bigint AS value FROM desk_pulse`);
  return Number(result.rows[0]?.value ?? 0);
}
