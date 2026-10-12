// Which rooms are free on which nights.
//
// A room is taken on a night when a row in `allocations` covers it. The one
// exception is a hold that has run out but has not been swept away yet: its
// nights count as free, and whoever books them clears the stale row first.

import { sql } from "drizzle-orm";

import { type Day, type Stay, addDays, daysBetween } from "@/lib/dates";
import { db, type Queryable } from "@/server/db";

export type FreeRoom = { id: number; name: string; position: number };

/** An allocation that still counts at `now`. Used inside every availability query. */
const stillHeld = (now: Date) => sql`
  NOT EXISTS (
    SELECT 1 FROM bookings lapsed
    WHERE lapsed.id = a.booking_id
      AND lapsed.status IN ('held', 'provisional')
      AND lapsed.hold_until <= ${now}
  )`;

const range = (stay: Stay) => sql`daterange(${stay.from}::date, ${stay.to}::date)`;

/**
 * The rooms of one type that are free for every night of the stay, best fit
 * first: a room where the stay sits flush against its neighbours is preferred,
 * so short stays fill gaps instead of breaking up long free runs elsewhere.
 */
export async function freeRooms(
  q: Queryable,
  roomTypeId: number,
  stay: Stay,
  now: Date,
  options: { ignoreBookingId?: number } = {},
): Promise<FreeRoom[]> {
  const ignore = options.ignoreBookingId ?? -1;
  const result = await q.execute<{
    id: number;
    name: string;
    position: number;
    gap_before: number | null;
    gap_after: number | null;
  }>(sql`
    SELECT r.id, r.name, r.position,
      (SELECT ${stay.from}::date - max(upper(a.stay))
         FROM allocations a
        WHERE a.room_id = r.id AND upper(a.stay) <= ${stay.from}::date
          AND a.booking_id IS DISTINCT FROM ${ignore} AND ${stillHeld(now)}) AS gap_before,
      (SELECT min(lower(a.stay)) - ${stay.to}::date
         FROM allocations a
        WHERE a.room_id = r.id AND lower(a.stay) >= ${stay.to}::date
          AND a.booking_id IS DISTINCT FROM ${ignore} AND ${stillHeld(now)}) AS gap_after
    FROM rooms r
    WHERE r.room_type_id = ${roomTypeId}
      AND r.active
      AND NOT EXISTS (
        SELECT 1 FROM allocations a
        WHERE a.room_id = r.id
          AND a.stay && ${range(stay)}
          AND a.booking_id IS DISTINCT FROM ${ignore}
          AND ${stillHeld(now)}
      )
  `);

  // A gap of one or two nights beside the stay is hard to sell, so it scores
  // worst. No gap at all scores best. Wide open space is neutral.
  const cost = (gap: number | null) => (gap === null ? 2 : gap === 0 ? 0 : gap <= 2 ? 5 : 2);

  return result.rows
    .map((row) => ({
      room: { id: row.id, name: row.name, position: row.position },
      score: cost(row.gap_before) + cost(row.gap_after),
    }))
    .sort((a, b) => a.score - b.score || a.room.position - b.room.position)
    .map((entry) => entry.room);
}

/** How many rooms of each type are free for the whole stay. */
export async function freeCountByType(stay: Stay, now: Date, q: Queryable = db()): Promise<Map<number, number>> {
  const result = await q.execute<{ room_type_id: number; free: number }>(sql`
    SELECT r.room_type_id, count(*)::int AS free
    FROM rooms r
    WHERE r.active
      AND NOT EXISTS (
        SELECT 1 FROM allocations a
        WHERE a.room_id = r.id AND a.stay && ${range(stay)} AND ${stillHeld(now)}
      )
    GROUP BY r.room_type_id
  `);
  return new Map(result.rows.map((row) => [row.room_type_id, row.free]));
}

export type NightAvailability = {
  /** Rooms free that night, by room type id. Types with none free are absent. */
  free: Record<number, number>;
};

/**
 * For each night from `from` up to but not including `to`: how many rooms of
 * each type are free. Drives the calendar a guest picks dates from.
 */
export async function availabilityByNight(
  from: Day,
  to: Day,
  now: Date,
  q: Queryable = db(),
): Promise<Map<Day, NightAvailability>> {
  const nights = new Map<Day, NightAvailability>();
  const count = daysBetween(from, to);
  for (let index = 0; index < count; index++) {
    nights.set(addDays(from, index), { free: {} });
  }
  if (count <= 0) return nights;

  const result = await q.execute<{ night: Day; room_type_id: number; free: number }>(sql`
    SELECT d.night::date::text AS night, r.room_type_id, count(*)::int AS free
    FROM generate_series(${from}::date, ${addDays(to, -1)}::date, interval '1 day') AS d(night)
    CROSS JOIN rooms r
    WHERE r.active
      AND NOT EXISTS (
        SELECT 1 FROM allocations a
        WHERE a.room_id = r.id AND a.stay @> d.night::date AND ${stillHeld(now)}
      )
    GROUP BY 1, 2
  `);

  for (const row of result.rows) {
    const night = nights.get(row.night);
    if (night) night.free[row.room_type_id] = row.free;
  }
  return nights;
}

/**
 * For a room type that cannot take the whole stay: the nights within it on
 * which no room of that type is free at all.
 */
export async function fullNights(roomTypeId: number, stay: Stay, now: Date, q: Queryable = db()): Promise<Day[]> {
  const byNight = await availabilityByNight(stay.from, stay.to, now, q);
  return [...byNight.entries()].filter(([, night]) => !night.free[roomTypeId]).map(([day]) => day);
}
