// A nightly look for anything that should be impossible. The code keeps
// these things true as it goes. This checks that it has, and says so loudly
// if it has not.

import { sql } from "drizzle-orm";

import { db } from "@/server/db";

export type Fault = { kind: string; reference: string; detail: string };

export async function checkBooks(): Promise<Fault[]> {
  const faults: Fault[] = [];

  // A booking's total is the sum of its nights and charges.
  const totals = await db().execute<{ reference: string; total_cents: number; lines: number }>(sql`
    SELECT b.reference, b.total_cents,
      (coalesce((SELECT sum(cents) FROM booking_nights n WHERE n.booking_id = b.id), 0) +
       coalesce((SELECT sum(cents) FROM booking_charges c WHERE c.booking_id = b.id), 0))::bigint AS lines
    FROM bookings b
    WHERE b.total_cents <> (
      coalesce((SELECT sum(cents) FROM booking_nights n WHERE n.booking_id = b.id), 0) +
      coalesce((SELECT sum(cents) FROM booking_charges c WHERE c.booking_id = b.id), 0))
    LIMIT 20
  `);
  for (const row of totals.rows) {
    faults.push({
      kind: "total",
      reference: row.reference,
      detail: `The total is ${row.total_cents} cents but its lines add up to ${row.lines}.`,
    });
  }

  // A live booking holds a room. One that is over holds none, except a finished stay, kept as history.
  const rooms = await db().execute<{ reference: string; status: string; held: boolean }>(sql`
    SELECT b.reference, b.status, (a.id IS NOT NULL) AS held
    FROM bookings b
    LEFT JOIN allocations a ON a.booking_id = b.id
    WHERE (b.status IN ('held', 'provisional', 'confirmed', 'checked_in', 'checked_out') AND a.id IS NULL)
       OR (b.status IN ('cancelled', 'expired', 'no_show') AND a.id IS NOT NULL)
    LIMIT 20
  `);
  for (const row of rooms.rows) {
    faults.push({
      kind: "room",
      reference: row.reference,
      detail: row.held ? `Is ${row.status} but still holds a room.` : `Is ${row.status} but holds no room.`,
    });
  }

  // A booking and its room agree about the room. Dates may differ only when a guest left early.
  const drift = await db().execute<{ reference: string }>(sql`
    SELECT b.reference
    FROM bookings b
    JOIN allocations a ON a.booking_id = b.id
    WHERE a.room_id <> b.room_id
       OR (b.status <> 'checked_out' AND a.stay <> b.stay)
    LIMIT 20
  `);
  for (const row of drift.rows) {
    faults.push({ kind: "drift", reference: row.reference, detail: "The booking and its room allocation disagree." });
  }

  // Nobody is refunded more than they paid.
  const refunds = await db().execute<{ reference: string }>(sql`
    SELECT b.reference
    FROM bookings b
    WHERE coalesce((SELECT sum(cents) FROM refunds r WHERE r.booking_id = b.id), 0) >
          coalesce((SELECT sum(cents) FROM payments p WHERE p.booking_id = b.id AND p.status = 'paid'), 0)
    LIMIT 20
  `);
  for (const row of refunds.rows) {
    faults.push({ kind: "refund", reference: row.reference, detail: "More has been refunded than was paid." });
  }

  return faults;
}
