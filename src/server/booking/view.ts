// A booking gathered up for showing: the stay, the bill, the money, the history.

import { asc, eq } from "drizzle-orm";

import { type Day, lodgeDay } from "@/lib/dates";
import { db, schema, type Queryable } from "@/server/db";

import { dueOn, moneyOf, type Due, type Money } from "./ledger";
import { opens, referenceIn } from "./links";
import type { Booking } from "./service";

export type BookingView = {
  booking: Booking;
  roomType: { id: number; name: string; slug: string; sleeps: number };
  room: { id: number; name: string };
  mealPlan: { code: string; name: string };
  nights: { night: Day; cents: number; season: string }[];
  charges: { id: number; kind: string; label: string; quantity: number; unitCents: number; cents: number }[];
  payments: (typeof schema.payments.$inferSelect)[];
  refunds: (typeof schema.refunds.$inferSelect)[];
  money: Money;
  due: Due;
  today: Day;
  /** Seconds left on a hold, or 0. */
  holdSeconds: number;
};

export async function viewOf(booking: Booking, now: Date, q: Queryable = db()): Promise<BookingView> {
  const [roomType] = await q
    .select({
      id: schema.roomTypes.id,
      name: schema.roomTypes.name,
      slug: schema.roomTypes.slug,
      sleeps: schema.roomTypes.sleeps,
    })
    .from(schema.roomTypes)
    .where(eq(schema.roomTypes.id, booking.roomTypeId));
  const [room] = await q
    .select({ id: schema.rooms.id, name: schema.rooms.name })
    .from(schema.rooms)
    .where(eq(schema.rooms.id, booking.roomId));
  const [mealPlan] = await q
    .select({ code: schema.mealPlans.code, name: schema.mealPlans.name })
    .from(schema.mealPlans)
    .where(eq(schema.mealPlans.code, booking.mealPlan));

  const nights = await q
    .select({
      night: schema.bookingNights.night,
      cents: schema.bookingNights.cents,
      season: schema.bookingNights.season,
    })
    .from(schema.bookingNights)
    .where(eq(schema.bookingNights.bookingId, booking.id))
    .orderBy(asc(schema.bookingNights.night));
  const charges = await q
    .select({
      id: schema.bookingCharges.id,
      kind: schema.bookingCharges.kind,
      label: schema.bookingCharges.label,
      quantity: schema.bookingCharges.quantity,
      unitCents: schema.bookingCharges.unitCents,
      cents: schema.bookingCharges.cents,
    })
    .from(schema.bookingCharges)
    .where(eq(schema.bookingCharges.bookingId, booking.id))
    .orderBy(asc(schema.bookingCharges.id));
  const payments = await q
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.bookingId, booking.id))
    .orderBy(asc(schema.payments.id));
  const refunds = await q
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.bookingId, booking.id))
    .orderBy(asc(schema.refunds.id));

  const money = await moneyOf(q, booking);
  const today = lodgeDay(now);
  const holding = (booking.status === "held" || booking.status === "provisional") && booking.holdUntil;

  return {
    booking,
    roomType,
    room,
    mealPlan,
    nights,
    charges,
    payments,
    refunds,
    money,
    due: dueOn(booking.status, booking.terms, money, today),
    today,
    holdSeconds: holding ? Math.max(0, Math.floor((booking.holdUntil!.getTime() - now.getTime()) / 1000)) : 0,
  };
}

/**
 * The booking a private link opens, or null. A link that names a real
 * booking but carries the wrong signature gets the same answer as one that
 * names nothing.
 */
export async function bookingForLink(code: string): Promise<Booking | null> {
  const reference = referenceIn(decodeURIComponent(code));
  if (!reference) return null;
  const [booking] = await db().select().from(schema.bookings).where(eq(schema.bookings.reference, reference));
  if (!booking || !opens(decodeURIComponent(code), booking)) return null;
  return booking;
}
