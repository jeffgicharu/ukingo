// The lodge's money, as the back office lists it: every payment, what is
// still owed and when, and what is owed back to guests.

import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { type Day, addDays } from "@/lib/dates";
import { moneyOfMany, type Money } from "@/server/booking/ledger";
import { readReference } from "@/server/booking/links";
import type { Booking } from "@/server/booking/service";
import { db, schema } from "@/server/db";
import type { PaymentStatus } from "@/server/db/schema";

export const PAYMENT_STATES = {
  all: { label: "All", statuses: [] },
  paid: { label: "Paid", statuses: ["paid"] },
  pending: { label: "Waiting for the guest", statuses: ["pending"] },
  failed: { label: "Did not go through", statuses: ["failed"] },
} satisfies Record<string, { label: string; statuses: PaymentStatus[] }>;

export type PaymentState = keyof typeof PAYMENT_STATES;

export const PAYMENTS_PER_PAGE = 30;

export type ListedPayment = {
  payment: typeof schema.payments.$inferSelect;
  bookingId: number;
  reference: string;
  guestName: string;
  sample: boolean;
  recordedBy: string | null;
};

export async function listPayments(filters: {
  state: PaymentState;
  q: string;
  page: number;
}): Promise<{ rows: ListedPayment[]; total: number }> {
  const p = schema.payments;
  const b = schema.bookings;
  const where: SQL[] = [];

  const statuses = PAYMENT_STATES[filters.state].statuses;
  if (statuses.length) where.push(inArray(p.status, statuses));
  if (filters.q) {
    const reference = readReference(filters.q);
    const text = filters.q.replace(/[%_]/g, "");
    where.push(
      or(
        ilike(p.receipt, `%${text}%`),
        ilike(b.guestName, `%${text}%`),
        reference ? eq(b.reference, reference) : undefined,
      )!,
    );
  }
  const condition = where.length ? and(...where) : undefined;

  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(p)
    .innerJoin(b, eq(b.id, p.bookingId))
    .where(condition);

  const rows = await db()
    .select({
      payment: p,
      bookingId: b.id,
      reference: b.reference,
      guestName: b.guestName,
      sample: b.sample,
      recordedBy: schema.staff.name,
    })
    .from(p)
    .innerJoin(b, eq(b.id, p.bookingId))
    .leftJoin(schema.staff, eq(schema.staff.id, p.recordedBy))
    .where(condition)
    .orderBy(desc(p.requestedAt), desc(p.id))
    .limit(PAYMENTS_PER_PAGE)
    .offset((filters.page - 1) * PAYMENTS_PER_PAGE);

  return { rows, total };
}

export type Balance = { booking: Booking; roomName: string; money: Money };

export type Balances = {
  /** Past its date, or left unpaid by a guest who has gone. */
  overdue: Balance[];
  /** Guests in the house settle up when they leave. */
  inHouse: Balance[];
  /** Due within the fortnight. */
  dueSoon: Balance[];
  /** Due later than that. Counted, not listed. */
  later: { count: number; cents: number };
};

/** What guests still owe, sorted by how soon it matters. */
export async function balances(today: Day): Promise<Balances> {
  const b = schema.bookings;
  const owing = await db()
    .select({ booking: b, roomName: schema.rooms.name })
    .from(b)
    .innerJoin(schema.rooms, eq(schema.rooms.id, b.roomId))
    .where(
      and(
        inArray(b.status, ["confirmed", "checked_in", "checked_out"]),
        sql`${b.totalCents} > coalesce((SELECT sum(p.cents) FROM payments p WHERE p.booking_id = ${b.id} AND p.status = 'paid'), 0)
          - coalesce((SELECT sum(f.cents) FROM refunds f WHERE f.booking_id = ${b.id}), 0)`,
      ),
    )
    .orderBy(asc(sql`lower(${b.stay})`), asc(b.id));

  const money = await moneyOfMany(
    db(),
    owing.map((row) => row.booking),
  );
  const rows: Balance[] = owing
    .map((row) => ({ ...row, money: money.get(row.booking.id)! }))
    .filter((row) => row.money.owedCents > 0);

  const horizon = addDays(today, 14);
  const result: Balances = { overdue: [], inHouse: [], dueSoon: [], later: { count: 0, cents: 0 } };
  for (const row of rows) {
    const due = row.booking.terms.balance_due;
    if (row.booking.status === "checked_in") result.inHouse.push(row);
    else if (row.booking.status === "checked_out" || due === null || due < today) result.overdue.push(row);
    else if (due <= horizon) result.dueSoon.push(row);
    else {
      result.later.count += 1;
      result.later.cents += row.money.owedCents;
    }
  }
  result.dueSoon.sort((a, z) => (a.booking.terms.balance_due ?? "").localeCompare(z.booking.terms.balance_due ?? ""));
  return result;
}

export type ListedRefund = {
  refund: typeof schema.refunds.$inferSelect;
  bookingId: number;
  reference: string;
  guestName: string;
  guestPhone: string;
  sample: boolean;
  sentBy: string | null;
};

/** Refunds still to send, oldest first, and the last few that were sent. */
export async function refundsList(): Promise<{ owed: ListedRefund[]; sent: ListedRefund[] }> {
  const f = schema.refunds;
  const b = schema.bookings;
  const select = () =>
    db()
      .select({
        refund: f,
        bookingId: b.id,
        reference: b.reference,
        guestName: b.guestName,
        guestPhone: b.guestPhone,
        sample: b.sample,
        sentBy: schema.staff.name,
      })
      .from(f)
      .innerJoin(b, eq(b.id, f.bookingId))
      .leftJoin(schema.staff, eq(schema.staff.id, f.sentBy));

  return {
    owed: await select().where(eq(f.status, "owed")).orderBy(asc(f.createdAt), asc(f.id)),
    sent: await select().where(eq(f.status, "sent")).orderBy(desc(f.sentAt), desc(f.id)).limit(20),
  };
}
