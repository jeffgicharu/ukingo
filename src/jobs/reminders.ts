// The messages nobody has to remember to send: a balance coming due, and a
// stay a few days away. Each is written once, however often this runs.

import { and, eq, sql } from "drizzle-orm";

import { addDays, lodgeDay } from "@/lib/dates";
import { moneyOfMany } from "@/server/booking/ledger";
import { db, schema } from "@/server/db";
import { tell } from "@/server/messages/tell";

const DAYS_AHEAD = 3;

export async function sendReminders(now: Date): Promise<{ balances: number; arrivals: number }> {
  const today = lodgeDay(now);
  const horizon = addDays(today, DAYS_AHEAD);
  let balances = 0;
  let arrivals = 0;

  // Confirmed bookings whose balance falls due today or within three days.
  const dueSoon = await db()
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        sql`${schema.bookings.terms}->>'balance_due' BETWEEN ${today} AND ${horizon}`,
      ),
    );
  const money = await moneyOfMany(db(), dueSoon);

  for (const booking of dueSoon) {
    if ((money.get(booking.id)?.owedCents ?? 0) <= 0) continue;
    const dueDay = booking.terms.balance_due!;
    const kind = dueDay === today ? "balance-due-today" : "balance-due-soon";
    await db().transaction((tx) => tell(tx, booking.id, kind, now, { onceKey: `${kind}:${booking.id}:${dueDay}` }));
    balances++;
  }

  // Confirmed stays that start within three days, not counting today's arrivals.
  const arriving = await db()
    .select({ id: schema.bookings.id, stay: schema.bookings.stay })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        sql`lower(${schema.bookings.stay}) BETWEEN ${addDays(today, 1)}::date AND ${horizon}::date`,
      ),
    );
  for (const booking of arriving) {
    await db().transaction((tx) =>
      tell(tx, booking.id, "arrival-soon", now, { onceKey: `arrival-soon:${booking.id}:${booking.stay.from}` }),
    );
    arrivals++;
  }

  return { balances, arrivals };
}
