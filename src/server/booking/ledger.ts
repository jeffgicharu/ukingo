// What has been paid and what is owed.
//
// Nothing here is stored. Every figure is worked out from the booking's
// total and the payments and refunds recorded against it, each time it is
// needed, so the numbers on a screen cannot drift from the money that moved.

import { and, eq, inArray, sql } from "drizzle-orm";

import type { Day } from "@/lib/dates";
import { schema, type Queryable } from "@/server/db";
import type { BookingStatus, BookingTerms } from "@/server/db/schema";

export type Money = {
  totalCents: number;
  /** Payments that have arrived. */
  paidCents: number;
  /** Refunds worked out and still to be sent. */
  refundOwedCents: number;
  /** Refunds already sent. */
  refundSentCents: number;
  /** What the lodge holds for this booking: paid, less everything refunded or owed back. */
  heldCents: number;
  /** What the guest still has to pay. Nothing, once a booking is over. */
  owedCents: number;
};

const OVER: BookingStatus[] = ["cancelled", "expired", "no_show"];

export function isOver(status: BookingStatus): boolean {
  return OVER.includes(status);
}

export function summarise(
  totalCents: number,
  status: BookingStatus,
  paidCents: number,
  refundOwedCents: number,
  refundSentCents: number,
): Money {
  const heldCents = paidCents - refundOwedCents - refundSentCents;
  return {
    totalCents,
    paidCents,
    refundOwedCents,
    refundSentCents,
    heldCents,
    owedCents: isOver(status) ? 0 : Math.max(0, totalCents - heldCents),
  };
}

/** The money on one booking. Run it inside the transaction that is changing the booking. */
export async function moneyOf(
  q: Queryable,
  booking: { id: number; totalCents: number; status: BookingStatus },
): Promise<Money> {
  const [paid] = await q
    .select({ cents: sql<number>`coalesce(sum(${schema.payments.cents}), 0)::bigint` })
    .from(schema.payments)
    .where(and(eq(schema.payments.bookingId, booking.id), eq(schema.payments.status, "paid")));

  const refunds = await q
    .select({ status: schema.refunds.status, cents: sql<number>`coalesce(sum(${schema.refunds.cents}), 0)::bigint` })
    .from(schema.refunds)
    .where(eq(schema.refunds.bookingId, booking.id))
    .groupBy(schema.refunds.status);

  const owed = refunds.find((row) => row.status === "owed")?.cents ?? 0;
  const sent = refunds.find((row) => row.status === "sent")?.cents ?? 0;
  return summarise(booking.totalCents, booking.status, Number(paid.cents), Number(owed), Number(sent));
}

/** The money on many bookings at once, for lists. */
export async function moneyOfMany(
  q: Queryable,
  bookings: { id: number; totalCents: number; status: BookingStatus }[],
): Promise<Map<number, Money>> {
  const result = new Map<number, Money>();
  if (bookings.length === 0) return result;
  const ids = bookings.map((booking) => booking.id);

  const paid = await q
    .select({ bookingId: schema.payments.bookingId, cents: sql<number>`sum(${schema.payments.cents})::bigint` })
    .from(schema.payments)
    .where(and(inArray(schema.payments.bookingId, ids), eq(schema.payments.status, "paid")))
    .groupBy(schema.payments.bookingId);

  const refunds = await q
    .select({
      bookingId: schema.refunds.bookingId,
      status: schema.refunds.status,
      cents: sql<number>`sum(${schema.refunds.cents})::bigint`,
    })
    .from(schema.refunds)
    .where(inArray(schema.refunds.bookingId, ids))
    .groupBy(schema.refunds.bookingId, schema.refunds.status);

  for (const booking of bookings) {
    const paidCents = Number(paid.find((row) => row.bookingId === booking.id)?.cents ?? 0);
    const owed = Number(refunds.find((row) => row.bookingId === booking.id && row.status === "owed")?.cents ?? 0);
    const sent = Number(refunds.find((row) => row.bookingId === booking.id && row.status === "sent")?.cents ?? 0);
    result.set(booking.id, summarise(booking.totalCents, booking.status, paidCents, owed, sent));
  }
  return result;
}

export type Due = {
  /** The least the guest can pay now for the booking to stand: the rest of the deposit. */
  minimumCents: number;
  /** Everything still owed. */
  fullCents: number;
  /** True when the balance should already have been paid. */
  overdue: boolean;
};

/** What a guest is asked to pay, as things stand on `today`. */
export function dueOn(status: BookingStatus, terms: BookingTerms, money: Money, today: Day): Due {
  if (status === "held" || status === "provisional") {
    return {
      minimumCents: Math.max(0, Math.min(terms.deposit_cents, money.totalCents) - money.heldCents),
      fullCents: money.owedCents,
      overdue: false,
    };
  }
  const overdue = money.owedCents > 0 && (terms.balance_due === null || today > terms.balance_due);
  return { minimumCents: 0, fullCents: money.owedCents, overdue };
}
