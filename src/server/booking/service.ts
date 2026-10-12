// Everything that changes a booking.
//
// Each function here is one whole step: it either completes or leaves no
// trace. Rooms are taken and given back only through `allocations`, where the
// database refuses two stays in one room that share a night. Every step is
// handed the moment it happens at, and writes down what it did and who did it.

import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";

import { type Day, type Stay, addDays, isDay, lodgeDay, maxDay, nightsIn } from "@/lib/dates";
import { formatDay, formatMoney, formatStay, plural } from "@/lib/format";
import { db, EXCLUSION_VIOLATION, schema, UNIQUE_VIOLATION, violates, type Queryable, type Tx } from "@/server/db";
import type { Actor, BookingStatus } from "@/server/db/schema";
import { loadCatalogue, roomTypeById, roomTypeBySlug, type Catalogue } from "@/server/lodge/catalogue";
import { tell } from "@/server/messages/tell";

import { freeRooms, roomIsFree } from "./availability";
import { isOver, moneyOf, type Money } from "./ledger";
import { newReference } from "./links";
import { quote, type Party, type Quote } from "./pricing";
import { checkDates, checkParty, fits, mayChangeDates, refundOnCancel, resolveTerms, termsFor } from "./rules";

export type Booking = typeof schema.bookings.$inferSelect;

/** Who is acting. Staff are named, so the history can say who did what. */
export type Who = { actor: "guest" } | { actor: "system" } | { actor: "staff"; staffId: number };

/** A step that could not be taken, with a reason fit to show the person who asked. */
export class BookingError extends Error {
  constructor(
    public readonly code:
      "dates" | "party" | "full" | "too_many_holds" | "not_found" | "not_now" | "not_allowed" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

const HOLDS_AT_ONCE = 2;
const BOOKINGS_A_DAY = 6;

async function record(
  q: Queryable,
  bookingId: number,
  who: Who,
  kind: string,
  summary: string,
  now: Date,
  detail?: Record<string, unknown>,
): Promise<void> {
  await q.insert(schema.bookingEvents).values({
    bookingId,
    at: now,
    actor: who.actor as Actor,
    staffId: who.actor === "staff" ? who.staffId : null,
    kind,
    summary,
    detail: detail ?? null,
  });
}

/** Tells every open staff screen that something has changed. Call after the change is saved. */
export async function touchDesk(): Promise<void> {
  await db()
    .execute(sql`SELECT nextval('desk_pulse')`)
    .catch(() => {});
}

async function lock(tx: Queryable, bookingId: number): Promise<Booking> {
  const found = await tx.execute<{ id: number }>(sql`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`);
  if (!found.rows[0]) {
    throw new BookingError("not_found", "That booking could not be found.");
  }
  const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  return booking;
}

/**
 * Lets go of every room whose hold has run out: bookings a guest started to
 * pay for and did not, and bookings staff made that never got their deposit.
 * Safe to call at any time and from anywhere. Returns how many were let go.
 */
export async function releaseLapsedHolds(q: Queryable, now: Date): Promise<number> {
  const lapsed = await q
    .select({ id: schema.bookings.id, status: schema.bookings.status })
    .from(schema.bookings)
    .where(and(inArray(schema.bookings.status, ["held", "provisional"]), lte(schema.bookings.holdUntil, now)))
    .for("update", { skipLocked: true });

  for (const booking of lapsed) {
    const wasProvisional = booking.status === "provisional";
    await q
      .update(schema.bookings)
      .set({
        status: "expired",
        holdUntil: null,
        endedReason: wasProvisional ? "The deposit did not arrive by the deadline" : "Not paid for in time",
      })
      .where(eq(schema.bookings.id, booking.id));
    await q.delete(schema.allocations).where(eq(schema.allocations.bookingId, booking.id));
    await record(
      q,
      booking.id,
      { actor: "system" },
      "expired",
      wasProvisional
        ? "The deposit did not arrive by the deadline. The room was let go."
        : "Not paid for in time. The room was let go.",
      now,
    );
    if (wasProvisional) {
      await tell(q, booking.id, "provisional-lapsed", now, { onceKey: `provisional-lapsed:${booking.id}` });
    }
  }
  return lapsed.length;
}

/** Takes a room for a booking. Tries each free room in turn, best fit first. */
async function allocate(
  tx: Tx,
  roomTypeId: number,
  stay: Stay,
  now: Date,
  write: (roomId: number, sp: Queryable) => Promise<void>,
  options: { ignoreBookingId?: number; preferRoomId?: number } = {},
): Promise<number> {
  let candidates = await freeRooms(tx, roomTypeId, stay, now, { ignoreBookingId: options.ignoreBookingId });
  if (options.preferRoomId !== undefined) {
    const preferred = candidates.filter((room) => room.id === options.preferRoomId);
    candidates = [...preferred, ...candidates.filter((room) => room.id !== options.preferRoomId)];
  }

  for (const room of candidates) {
    try {
      // Tried inside its own savepoint: if someone else took this room a
      // moment ago, only this attempt is undone and the next room is tried.
      await tx.transaction(async (sp) => {
        await write(room.id, sp);
      });
      return room.id;
    } catch (error) {
      if (!violates(error, EXCLUSION_VIOLATION, "one_stay_per_room_per_night")) throw error;
    }
  }
  throw new BookingError("full", "That room has just been taken for those dates. Please choose again.");
}

export type GuestDetails = { name: string; phone: string; email: string | null };

export type NewBooking = {
  roomType: string; // slug
  stay: Stay;
  party: Party;
  mealPlan: string;
  extraIds: number[];
  guest: GuestDetails;
  arrivalTime?: string;
  requests?: string;
  /** Sent by the form, so the same form sent twice makes one booking. */
  requestKey?: string;
  ip?: string | null;
};

async function findOrCreateGuest(tx: Queryable, guest: GuestDetails, now: Date, sample = false): Promise<number> {
  const [known] = await tx
    .select({ id: schema.guests.id })
    .from(schema.guests)
    .where(and(eq(schema.guests.phone, guest.phone), eq(schema.guests.sample, sample)))
    .orderBy(schema.guests.id)
    .limit(1);
  if (known) return known.id;

  const [created] = await tx
    .insert(schema.guests)
    .values({ name: guest.name, phone: guest.phone, email: guest.email, sample, createdAt: now })
    .returning({ id: schema.guests.id });
  return created.id;
}

async function writeLines(tx: Queryable, bookingId: number, priced: Quote, now: Date, staffId: number | null) {
  await tx.delete(schema.bookingNights).where(eq(schema.bookingNights.bookingId, bookingId));
  await tx
    .delete(schema.bookingCharges)
    .where(
      and(eq(schema.bookingCharges.bookingId, bookingId), inArray(schema.bookingCharges.kind, ["meals", "extra"])),
    );

  await tx
    .insert(schema.bookingNights)
    .values(
      priced.nights.map((night) => ({ bookingId, night: night.night, cents: night.cents, season: night.season })),
    );
  if (priced.charges.length) {
    await tx.insert(schema.bookingCharges).values(
      priced.charges.map((charge) => ({
        bookingId,
        kind: charge.kind,
        label: charge.label,
        quantity: charge.quantity,
        unitCents: charge.unitCents,
        cents: charge.cents,
        extraId: charge.extraId ?? null,
        createdBy: staffId,
        createdAt: now,
      })),
    );
  }
}

/** Nights plus every charge on the bill, straight from the rows. */
async function billTotal(tx: Queryable, bookingId: number): Promise<number> {
  const result = await tx.execute<{ total: number }>(sql`
    SELECT (
      coalesce((SELECT sum(cents) FROM booking_nights WHERE booking_id = ${bookingId}), 0) +
      coalesce((SELECT sum(cents) FROM booking_charges WHERE booking_id = ${bookingId}), 0)
    )::bigint AS total
  `);
  return Number(result.rows[0].total);
}

type MakeOptions =
  | { by: "guest" }
  | {
      by: "staff";
      staffId: number;
      /** Staff may book inside the rules that only apply online: tonight after the cut-off, a short stay over a holiday. */
    };

async function make(input: NewBooking, now: Date, options: MakeOptions): Promise<Booking> {
  const who: Who = options.by === "guest" ? { actor: "guest" } : { actor: "staff", staffId: options.staffId };

  const booking = await db().transaction(async (tx) => {
    if (input.requestKey) {
      const [again] = await tx.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
      if (again) return again;
    }

    const lodge = await loadCatalogue(tx);
    const roomType = roomTypeBySlug(lodge, input.roomType);
    if (!roomType) {
      throw new BookingError("invalid", "That room is no longer offered.");
    }

    const today = lodgeDay(now);
    const datesProblem = checkDates(lodge, input.stay, now);
    if (datesProblem) {
      // Staff are held only to the rules that protect the calendar itself.
      const staffMay =
        options.by === "staff" && ["too_late_today", "too_short", "too_long"].includes(datesProblem.code);
      if (!staffMay) throw new BookingError("dates", datesProblem.message);
    }
    const partyProblem = checkParty(lodge, input.party);
    if (partyProblem) throw new BookingError("party", partyProblem.message);
    if (!fits(roomType, input.party)) {
      throw new BookingError(
        "party",
        `The ${roomType.name} sleeps ${roomType.sleeps}. Choose a larger room for your party.`,
      );
    }
    if (!lodge.mealPlans.some((plan) => plan.code === input.mealPlan)) {
      throw new BookingError("invalid", "Choose a meal plan.");
    }

    if (options.by === "guest") {
      // One visitor cannot tie up the lodge: a couple of rooms held at a time, a few bookings a day.
      const mine = or(
        eq(schema.bookings.guestPhone, input.guest.phone),
        input.ip ? sql`${schema.bookings.originIp} = ${input.ip}::inet` : sql`false`,
      );
      const [{ holding, today: madeToday }] = await tx
        .select({
          holding: sql<number>`count(*) filter (where ${schema.bookings.status} = 'held' and ${schema.bookings.holdUntil} > ${now})::int`,
          today: sql<number>`count(*) filter (where ${schema.bookings.createdAt} > ${new Date(now.getTime() - 86_400_000)})::int`,
        })
        .from(schema.bookings)
        .where(and(eq(schema.bookings.source, "website"), mine));
      if (holding >= HOLDS_AT_ONCE) {
        throw new BookingError(
          "too_many_holds",
          "You already have rooms held while you pay. Finish or leave those bookings first.",
        );
      }
      if (madeToday >= BOOKINGS_A_DAY) {
        throw new BookingError("too_many_holds", "That is a lot of bookings for one day. Please try again tomorrow.");
      }
    }

    await releaseLapsedHolds(tx, now);

    const priced = quote(lodge, {
      roomType,
      stay: input.stay,
      party: input.party,
      mealPlan: input.mealPlan,
      extraIds: input.extraIds,
    });
    const terms = termsFor(lodge.settings, input.stay, priced.totalCents, today);
    const guestId = await findOrCreateGuest(tx, input.guest, now);

    const holdUntil =
      options.by === "guest"
        ? new Date(now.getTime() + lodge.settings.holdMinutes * 60_000)
        : new Date(now.getTime() + lodge.settings.provisionalHours * 3_600_000);

    let bookingId = 0;
    await allocate(tx, roomType.id, input.stay, now, async (roomId, sp) => {
      const [created] = await sp
        .insert(schema.bookings)
        .values({
          reference: await unusedReference(sp),
          requestKey: input.requestKey ?? null,
          guestId,
          guestName: input.guest.name,
          guestPhone: input.guest.phone,
          guestEmail: input.guest.email,
          roomTypeId: roomType.id,
          roomId,
          stay: input.stay,
          adults: input.party.adults,
          children: input.party.children,
          mealPlan: input.mealPlan,
          arrivalTime: (input.arrivalTime ?? "").slice(0, 60),
          requests: (input.requests ?? "").slice(0, 1000),
          status: options.by === "guest" ? "held" : "provisional",
          source: options.by === "guest" ? "website" : "desk",
          holdUntil,
          totalCents: priced.totalCents,
          terms,
          createdBy: options.by === "staff" ? options.staffId : null,
          createdAt: now,
          originIp: input.ip ?? null,
        })
        .returning({ id: schema.bookings.id });
      bookingId = created.id;

      await sp.insert(schema.allocations).values({
        roomId,
        stay: input.stay,
        bookingId,
        createdBy: options.by === "staff" ? options.staffId : null,
        createdAt: now,
      });
    });

    await writeLines(tx, bookingId, priced, now, options.by === "staff" ? options.staffId : null);
    await record(
      tx,
      bookingId,
      who,
      "made",
      options.by === "guest"
        ? `Started on the website. The room is held for ${plural(lodge.settings.holdMinutes, "minute")} while the guest pays.`
        : `Made at the desk. The room is held until ${formatDay(lodgeDay(holdUntil))} for the deposit of ${formatMoney(terms.deposit_cents)}.`,
      now,
    );

    if (options.by === "staff") {
      await tell(tx, bookingId, "pay-by", now, {
        payBy: holdUntil,
        depositCents: terms.deposit_cents,
        onceKey: `pay-by:${bookingId}`,
      });
    }

    const [made] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return made;
  });

  await touchDesk();
  return booking;
}

async function unusedReference(q: Queryable): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const reference = newReference();
    const [taken] = await q
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(eq(schema.bookings.reference, reference));
    if (!taken) return reference;
  }
  throw new Error("Could not find an unused booking reference");
}

/**
 * A guest starts a booking on the website. The room is held for a few
 * minutes while they pay, and let go by itself if they do not.
 */
export async function holdBooking(input: NewBooking, now: Date): Promise<Booking> {
  try {
    return await make(input, now, { by: "guest" });
  } catch (error) {
    // Two copies of the same form arriving together: the second finds the first.
    if (input.requestKey && violates(error, UNIQUE_VIOLATION)) {
      const [again] = await db().select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
      if (again) return again;
    }
    throw error;
  }
}

/**
 * Staff make a booking for someone on the phone or at the desk. The room is
 * held until a deadline for the deposit, and let go by itself after it.
 */
export async function makeDeskBooking(input: NewBooking, staffId: number, now: Date): Promise<Booking> {
  return make(input, now, { by: "staff", staffId });
}

/**
 * A held booking whose time ran out, started again: the same booking takes a
 * room once more if one is free, at the price it was first given.
 */
export async function holdAgain(bookingId: number, now: Date): Promise<Booking> {
  const booking = await db().transaction(async (tx) => {
    const current = await lock(tx, bookingId);
    if (current.status === "held" && current.holdUntil && current.holdUntil > now) return current;
    if (current.status !== "expired" || current.source !== "website") {
      throw new BookingError("not_now", "This booking can no longer be picked up.");
    }

    const lodge = await loadCatalogue(tx);
    const problem = checkDates(lodge, current.stay, now);
    if (problem) throw new BookingError("dates", problem.message);

    await releaseLapsedHolds(tx, now);
    const holdUntil = new Date(now.getTime() + lodge.settings.holdMinutes * 60_000);

    const roomId = await allocate(
      tx,
      current.roomTypeId,
      current.stay,
      now,
      async (room, sp) => {
        await sp.insert(schema.allocations).values({ roomId: room, stay: current.stay, bookingId, createdAt: now });
      },
      { preferRoomId: current.roomId },
    );

    await tx
      .update(schema.bookings)
      .set({ status: "held", holdUntil, roomId, endedReason: null })
      .where(eq(schema.bookings.id, bookingId));
    await record(
      tx,
      bookingId,
      { actor: "guest" },
      "held-again",
      "The guest came back. The room is held again while they pay.",
      now,
    );

    const [held] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return held;
  });

  await touchDesk();
  return booking;
}

/** Keeps a held room a little longer, because a payment prompt is on the guest's phone. */
export async function extendHoldForPayment(tx: Queryable, booking: Booking, now: Date, minutes = 3): Promise<void> {
  if (booking.status !== "held" || !booking.holdUntil) return;
  const until = new Date(now.getTime() + minutes * 60_000);
  if (until > booking.holdUntil) {
    await tx.update(schema.bookings).set({ holdUntil: until }).where(eq(schema.bookings.id, booking.id));
  }
}

export type PaymentEffect = "confirmed" | "recorded" | "room-retaken" | "refund-owed";

/**
 * Called, inside the transaction that marks a payment as paid, to let the
 * money do its work: confirm the booking, or simply reduce what is owed. A
 * payment that arrives after the room was let go takes the room again if it
 * is still free, and is otherwise owed straight back.
 */
export async function applyPayment(
  tx: Tx,
  bookingId: number,
  payment: { id: number; cents: number; receipt: string | null; method: string },
  who: Who,
  now: Date,
): Promise<PaymentEffect> {
  const booking = await lock(tx, bookingId);
  const paidLine = `${formatMoney(payment.cents)} received${payment.receipt ? ` (${payment.receipt})` : ""}.`;

  if (booking.status === "held" || booking.status === "provisional") {
    const money = await moneyOf(tx, booking);
    if (money.heldCents >= Math.min(booking.terms.deposit_cents, booking.totalCents)) {
      await tx
        .update(schema.bookings)
        .set({ status: "confirmed", confirmedAt: now, holdUntil: null })
        .where(eq(schema.bookings.id, bookingId));
      await record(tx, bookingId, who, "confirmed", `${paidLine} The booking is confirmed.`, now, {
        paymentId: payment.id,
      });
      await tell(tx, bookingId, "booking-confirmed", now, { payment, onceKey: `booking-confirmed:${bookingId}` });
      return "confirmed";
    }
    await record(tx, bookingId, who, "payment", `${paidLine} The deposit is not yet covered.`, now, {
      paymentId: payment.id,
    });
    // Money has arrived, so the guest is given time to send the rest before the room is let go.
    if (booking.status === "held") {
      await extendHoldForPayment(tx, booking, now, 15);
    }
    return "recorded";
  }

  if (booking.status === "confirmed" || booking.status === "checked_in" || booking.status === "checked_out") {
    await record(tx, bookingId, who, "payment", paidLine, now, { paymentId: payment.id });
    await tell(tx, bookingId, "payment-received", now, { payment, onceKey: `payment-received:${payment.id}` });
    return "recorded";
  }

  if (booking.status === "expired") {
    // The guest paid in good faith, a little late. If the nights are still free, they keep them.
    const lodge = await loadCatalogue(tx);
    const stillBookable = booking.stay.from >= lodgeDay(now);
    if (stillBookable) {
      try {
        await releaseLapsedHolds(tx, now);
        const roomId = await allocate(
          tx,
          booking.roomTypeId,
          booking.stay,
          now,
          async (room, sp) => {
            await sp.insert(schema.allocations).values({ roomId: room, stay: booking.stay, bookingId, createdAt: now });
          },
          { preferRoomId: booking.roomId },
        );
        const money = await moneyOf(tx, { ...booking, status: "confirmed" });
        const enough = money.heldCents >= Math.min(booking.terms.deposit_cents, booking.totalCents);
        await tx
          .update(schema.bookings)
          .set(
            enough
              ? { status: "confirmed", confirmedAt: now, holdUntil: null, roomId, endedReason: null }
              : {
                  status: "provisional",
                  holdUntil: new Date(now.getTime() + lodge.settings.provisionalHours * 3_600_000),
                  roomId,
                  endedReason: null,
                },
          )
          .where(eq(schema.bookings.id, bookingId));
        await record(
          tx,
          bookingId,
          who,
          "confirmed",
          `${paidLine} It arrived after the hold had run out, but the room was still free, so the booking is confirmed.`,
          now,
          { paymentId: payment.id },
        );
        if (enough) {
          await tell(tx, bookingId, "booking-confirmed", now, { payment, onceKey: `booking-confirmed:${bookingId}` });
        }
        return "room-retaken";
      } catch (error) {
        if (!(error instanceof BookingError)) throw error;
      }
    }
  }

  // Expired with the room gone, cancelled, or a no-show: the money is owed back.
  await tx.insert(schema.refunds).values({
    bookingId,
    cents: payment.cents,
    reason:
      booking.status === "expired"
        ? "Paid after the hold ran out, and the room had been taken"
        : "Paid after the booking had ended",
    status: "owed",
    createdAt: now,
  });
  await record(
    tx,
    bookingId,
    who,
    "refund-owed",
    `${paidLine} The booking had ended, so the full amount is owed back.`,
    now,
    {
      paymentId: payment.id,
    },
  );
  await tell(tx, bookingId, "paid-too-late", now, {
    payment,
    refundCents: payment.cents,
    onceKey: `paid-too-late:${payment.id}`,
  });
  return "refund-owed";
}

export type Cancellation = { booking: Booking; refundCents: number; keptCents: number; keepPercent: number };

/** What cancelling would do, without doing it. Shown to the guest before they confirm. */
export function previewCancellation(booking: Booking, money: Money, today: Day) {
  return refundOnCancel(booking.terms, booking.totalCents, money.heldCents, today);
}

/**
 * Cancels a booking and lets its room go at once. The refund is worked out
 * from the booking's own terms. A manager may set a different refund, with a
 * reason.
 */
export async function cancelBooking(
  bookingId: number,
  who: Who,
  now: Date,
  options: { reason?: string; refundCents?: number; ip?: string | null } = {},
): Promise<Cancellation> {
  const result = await db().transaction(async (tx) => {
    const booking = await lock(tx, bookingId);
    const today = lodgeDay(now);

    if (!["held", "provisional", "confirmed"].includes(booking.status)) {
      throw new BookingError("not_now", cannotCancelReason(booking.status));
    }
    if (who.actor === "guest" && booking.stay.from <= today && booking.status === "confirmed") {
      throw new BookingError(
        "not_allowed",
        "Your stay starts today or has already started, so it cannot be cancelled online. Please speak to the front desk.",
      );
    }

    const money = await moneyOf(tx, booking);
    const byTerms = refundOnCancel(booking.terms, booking.totalCents, money.heldCents, today);

    let refundCents = byTerms.refundCents;
    if (options.refundCents !== undefined && who.actor === "staff") {
      if (!Number.isInteger(options.refundCents) || options.refundCents < 0 || options.refundCents > money.heldCents) {
        throw new BookingError(
          "invalid",
          `A refund must be between nothing and ${formatMoney(money.heldCents)}, what has been paid.`,
        );
      }
      if (options.refundCents !== byTerms.refundCents && !options.reason?.trim()) {
        throw new BookingError("invalid", "Give a reason for a refund that differs from the booking's terms.");
      }
      refundCents = options.refundCents;
    }
    const keptCents = money.heldCents - refundCents;

    await tx
      .update(schema.bookings)
      .set({ status: "cancelled", cancelledAt: now, holdUntil: null, endedReason: options.reason?.trim() || null })
      .where(eq(schema.bookings.id, bookingId));
    await tx.delete(schema.allocations).where(eq(schema.allocations.bookingId, bookingId));

    if (refundCents > 0) {
      await tx.insert(schema.refunds).values({
        bookingId,
        cents: refundCents,
        reason:
          refundCents === byTerms.refundCents
            ? `Cancelled on ${formatDay(today)}: ${byTerms.keepPercent}% of the total kept under the booking's terms`
            : `Cancelled on ${formatDay(today)}: refund set by staff. ${options.reason?.trim() ?? ""}`.trim(),
        status: "owed",
        createdAt: now,
      });
    }

    await record(
      tx,
      bookingId,
      who,
      "cancelled",
      money.paidCents === 0
        ? "Cancelled. Nothing had been paid."
        : `Cancelled. ${formatMoney(refundCents)} to refund, ${formatMoney(keptCents)} kept.${refundCents !== byTerms.refundCents ? " Refund set by staff." : ""}`,
      now,
      { refundCents, keptCents, byTerms: byTerms.refundCents, reason: options.reason ?? null },
    );

    // A guest who walks away from a booking they never paid for is not written to.
    if (booking.status !== "held") {
      await tell(tx, bookingId, "booking-cancelled", now, {
        refundCents,
        keptCents,
        ip: options.ip,
        onceKey: `booking-cancelled:${bookingId}`,
      });
    }

    const [cancelled] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return { booking: cancelled, refundCents, keptCents, keepPercent: byTerms.keepPercent };
  });

  await touchDesk();
  return result;
}

function cannotCancelReason(status: BookingStatus): string {
  switch (status) {
    case "cancelled":
      return "This booking has already been cancelled.";
    case "expired":
      return "This booking was never paid for and has already lapsed.";
    case "checked_in":
      return "The guest has checked in. Check them out instead.";
    case "checked_out":
      return "This stay is over.";
    default:
      return "This booking can no longer be cancelled.";
  }
}

export type DateChange = {
  booking: Booking;
  previousStay: Stay;
  previousTotalCents: number;
  /** Money owed back because the new stay costs less than has been paid. */
  refundCents: number;
};

/** What moving a booking to new dates would cost, without doing it. */
export async function previewDateChange(
  booking: Booking,
  newStay: Stay,
  who: Who,
  now: Date,
  q: Queryable = db(),
): Promise<
  | { ok: true; priced: Quote; totalCents: number; differenceCents: number; refundCents: number; roomFree: boolean }
  | { ok: false; reason: string }
> {
  const today = lodgeDay(now);
  // A guest already in the house can stay longer or leave sooner. Their arrival is history.
  const staying = who.actor === "staff" && booking.status === "checked_in";
  if (staying) {
    if (newStay.from !== booking.stay.from) {
      return { ok: false, reason: "This guest has arrived. Only the day they leave can change." };
    }
    if (!isDay(newStay.to) || newStay.to <= today) {
      return { ok: false, reason: "Choose a day to leave that is after today, or check the guest out." };
    }
  } else if (booking.status !== "confirmed" && !(who.actor === "staff" && booking.status === "provisional")) {
    return { ok: false, reason: "Only a confirmed booking can be moved." };
  }
  if (who.actor === "guest" && !mayChangeDates(booking.terms, today)) {
    return {
      ok: false,
      reason: booking.terms.change_until
        ? `Dates could be changed until ${formatDay(booking.terms.change_until, "long")}. To change them now, please speak to the front desk.`
        : "This booking was made too close to arrival for its dates to be changed online. Please speak to the front desk.",
    };
  }
  if (newStay.from === booking.stay.from && newStay.to === booking.stay.to) {
    return { ok: false, reason: "Those are the dates you already have." };
  }

  const lodge = await loadCatalogue(q);
  const problem = staying ? null : checkDates(lodge, newStay, now);
  if (problem && !(who.actor === "staff" && ["too_late_today", "too_short", "too_long"].includes(problem.code))) {
    return { ok: false, reason: problem.message };
  }
  const roomType = roomTypeById(lodge, booking.roomTypeId);
  if (!roomType) return { ok: false, reason: "That room is no longer offered." };

  const priced = await priceFor(q, lodge, booking, newStay);
  const adjustments = await adjustmentsTotal(q, booking.id);
  const totalCents = priced.totalCents + adjustments;
  const money = await moneyOf(q, booking);
  const free = await freeRooms(q, booking.roomTypeId, newStay, now, { ignoreBookingId: booking.id });

  return {
    ok: true,
    priced,
    totalCents,
    differenceCents: totalCents - booking.totalCents,
    refundCents: Math.max(0, money.heldCents - totalCents),
    roomFree: free.length > 0,
  };
}

async function adjustmentsTotal(q: Queryable, bookingId: number): Promise<number> {
  const [row] = await q
    .select({ cents: sql<number>`coalesce(sum(${schema.bookingCharges.cents}), 0)::bigint` })
    .from(schema.bookingCharges)
    .where(and(eq(schema.bookingCharges.bookingId, bookingId), eq(schema.bookingCharges.kind, "adjustment")));
  return Number(row.cents);
}

/** Prices a booking's own choices (room, guests, meals, extras) for a stay, at today's rates. */
async function priceFor(q: Queryable, lodge: Catalogue, booking: Booking, stay: Stay): Promise<Quote> {
  const roomType = roomTypeById(lodge, booking.roomTypeId);
  if (!roomType) throw new BookingError("invalid", "That room is no longer offered.");
  const extras = await q
    .select({ extraId: schema.bookingCharges.extraId })
    .from(schema.bookingCharges)
    .where(and(eq(schema.bookingCharges.bookingId, booking.id), eq(schema.bookingCharges.kind, "extra")));
  return quote(lodge, {
    roomType,
    stay,
    party: { adults: booking.adults, children: booking.children },
    mealPlan: booking.mealPlan,
    extraIds: extras.map((row) => row.extraId).filter((id): id is number => id !== null),
  });
}

/**
 * Moves a booking to other dates, at the prices of the new dates. The same
 * room is kept if it is free, and another of the same kind taken if not.
 */
export async function changeDates(
  bookingId: number,
  newStay: Stay,
  who: Who,
  now: Date,
  /** `intoRoomId`: staff have chosen the room, on the calendar. It is that room or nothing. */
  options: { ip?: string | null; intoRoomId?: number } = {},
): Promise<DateChange> {
  const result = await db().transaction(async (tx) => {
    const booking = await lock(tx, bookingId);
    const preview = await previewDateChange(booking, newStay, who, now, tx);
    if (!preview.ok) throw new BookingError("not_allowed", preview.reason);

    const today = lodgeDay(now);
    await releaseLapsedHolds(tx, now);

    // The booking's own row in `allocations` is moved. The database checks
    // the new nights against every other stay in that room as it does so.
    let roomId: number;
    let roomTypeId = booking.roomTypeId;
    let nowIn = "";
    if (options.intoRoomId !== undefined && who.actor === "staff") {
      const room = await usableRoom(tx, options.intoRoomId, booking);
      await placeIn(tx, bookingId, room, newStay);
      roomId = room.id;
      roomTypeId = room.roomTypeId;
      if (room.id !== booking.roomId) nowIn = ` Now in ${room.name}.`;
    } else {
      roomId = await allocate(
        tx,
        booking.roomTypeId,
        newStay,
        now,
        async (room, sp) => {
          await sp
            .update(schema.allocations)
            .set({ roomId: room, stay: newStay })
            .where(eq(schema.allocations.bookingId, bookingId));
        },
        { ignoreBookingId: bookingId, preferRoomId: booking.roomId },
      ).catch((error) => {
        if (error instanceof BookingError && error.code === "full") {
          throw new BookingError("full", "No room of this kind is free for all of those nights.");
        }
        throw error;
      });
    }

    await writeLines(tx, bookingId, preview.priced, now, who.actor === "staff" ? who.staffId : null);
    const totalCents = await billTotal(tx, bookingId);
    const terms = resolveTerms(booking.terms.policy, newStay, totalCents, today);

    await tx
      .update(schema.bookings)
      .set({ stay: newStay, roomId, roomTypeId, totalCents, terms })
      .where(eq(schema.bookings.id, bookingId));

    const money = await moneyOf(tx, { id: bookingId, totalCents, status: booking.status });
    const refundCents = Math.max(0, money.heldCents - totalCents);
    if (refundCents > 0) {
      await tx.insert(schema.refunds).values({
        bookingId,
        cents: refundCents,
        reason: `Moved to ${formatStay(newStay)}, which costs less than had been paid`,
        status: "owed",
        createdAt: now,
      });
    }

    const difference = totalCents - booking.totalCents;
    await record(
      tx,
      bookingId,
      who,
      "moved",
      `Moved from ${formatStay(booking.stay)} to ${formatStay(newStay)}. ${
        difference === 0
          ? "The price is the same."
          : difference > 0
            ? `${formatMoney(difference)} more.`
            : `${formatMoney(-difference)} less.`
      }${refundCents > 0 ? ` ${formatMoney(refundCents)} to refund.` : ""}${nowIn}`,
      now,
      { from: booking.stay, to: newStay, previousTotalCents: booking.totalCents, totalCents, refundCents },
    );
    await tell(tx, bookingId, "booking-changed", now, {
      previousStay: booking.stay,
      previousTotalCents: booking.totalCents,
      refundCents: refundCents || undefined,
      ip: options.ip,
    });

    const [moved] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return { booking: moved, previousStay: booking.stay, previousTotalCents: booking.totalCents, refundCents };
  });

  await touchDesk();
  return result;
}

/** The guest has arrived. */
export async function checkIn(bookingId: number, staffId: number, now: Date): Promise<Booking> {
  const booking = await db().transaction(async (tx) => {
    const current = await lock(tx, bookingId);
    const today = lodgeDay(now);
    if (current.status !== "confirmed") {
      throw new BookingError("not_now", checkInReason(current.status));
    }
    if (today < current.stay.from) {
      throw new BookingError(
        "not_now",
        `This stay starts on ${formatDay(current.stay.from, "long")}. It cannot be checked in before then.`,
      );
    }
    if (today >= current.stay.to) {
      throw new BookingError("not_now", "This stay has already ended. Mark it as a no-show instead.");
    }
    await tx
      .update(schema.bookings)
      .set({ status: "checked_in", checkedInAt: now })
      .where(eq(schema.bookings.id, bookingId));
    await record(tx, bookingId, { actor: "staff", staffId }, "checked-in", "Checked in.", now);
    const [updated] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return updated;
  });
  await touchDesk();
  return booking;
}

function checkInReason(status: BookingStatus): string {
  switch (status) {
    case "checked_in":
      return "This guest is already checked in.";
    case "held":
    case "provisional":
      return "This booking has not been paid for yet. Take the deposit first.";
    default:
      return "This booking cannot be checked in.";
  }
}

/** The guest has left. If they leave early, the nights they did not use go back on sale. */
export async function checkOut(
  bookingId: number,
  staffId: number,
  now: Date,
  options: { leaveOwing?: boolean } = {},
): Promise<Booking> {
  const booking = await db().transaction(async (tx) => {
    const current = await lock(tx, bookingId);
    if (current.status !== "checked_in") {
      throw new BookingError(
        "not_now",
        current.status === "checked_out" ? "This guest has already checked out." : "This guest has not checked in.",
      );
    }
    // Nobody leaves with a bill open by accident. Leaving it open has to be chosen.
    const { owedCents } = await moneyOf(tx, current);
    if (owedCents > 0 && !options.leaveOwing) {
      throw new BookingError(
        "not_now",
        `${formatMoney(owedCents)} is still to pay. Take the payment first, or check out and leave it owing.`,
      );
    }
    const today = lodgeDay(now);
    const early = today < current.stay.to;
    if (early) {
      const lastMorning = maxDay(today, addDays(current.stay.from, 1));
      await tx
        .update(schema.allocations)
        .set({ stay: { from: current.stay.from, to: lastMorning } })
        .where(eq(schema.allocations.bookingId, bookingId));
    }
    await tx
      .update(schema.bookings)
      .set({ status: "checked_out", checkedOutAt: now })
      .where(eq(schema.bookings.id, bookingId));
    await record(
      tx,
      bookingId,
      { actor: "staff", staffId },
      "checked-out",
      [
        early ? "Checked out early. The remaining nights are back on sale." : "Checked out.",
        owedCents > 0 ? `${formatMoney(owedCents)} was left owing.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      now,
    );
    const [updated] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return updated;
  });
  await touchDesk();
  return booking;
}

/** The guest never came. The room goes back on sale and the booking's terms decide the money. */
export async function markNoShow(bookingId: number, staffId: number, now: Date): Promise<Booking> {
  const booking = await db().transaction(async (tx) => {
    const current = await lock(tx, bookingId);
    const today = lodgeDay(now);
    if (current.status !== "confirmed") {
      throw new BookingError(
        "not_now",
        "Only a confirmed booking that has not been checked in can be marked as a no-show.",
      );
    }
    if (today <= current.stay.from) {
      throw new BookingError(
        "not_now",
        `The guest may still arrive today. A no-show can be recorded from ${formatDay(addDays(current.stay.from, 1), "long")}.`,
      );
    }
    await tx
      .update(schema.bookings)
      .set({ status: "no_show", endedReason: "The guest did not arrive" })
      .where(eq(schema.bookings.id, bookingId));
    await tx.delete(schema.allocations).where(eq(schema.allocations.bookingId, bookingId));
    await record(
      tx,
      bookingId,
      { actor: "staff", staffId },
      "no-show",
      "Marked as a no-show. The room is back on sale. No refund is due.",
      now,
    );
    const [updated] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return updated;
  });
  await touchDesk();
  return booking;
}

/** Moves a booking into another room for the same nights. The price does not change. */
type Room = typeof schema.rooms.$inferSelect;

/** A room this booking's party could be put in: one that is in use and sleeps them all. */
async function usableRoom(q: Queryable, roomId: number, booking: Booking): Promise<Room> {
  const [room] = await q
    .select()
    .from(schema.rooms)
    .where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.active, true)));
  if (!room) throw new BookingError("invalid", "That room is not in use.");
  const [type] = await q.select().from(schema.roomTypes).where(eq(schema.roomTypes.id, room.roomTypeId));
  if (booking.adults + booking.children > type.sleeps) {
    throw new BookingError(
      "party",
      `${room.name} sleeps ${type.sleeps}, and this booking is for ${booking.adults + booking.children}.`,
    );
  }
  return room;
}

/** Puts a booking's nights in one particular room, or refuses if any of them is taken there. */
async function placeIn(tx: Tx, bookingId: number, room: Room, stay: Stay): Promise<void> {
  try {
    // In its own savepoint, so a refusal undoes this step and nothing else.
    await tx.transaction(async (sp) => {
      await sp
        .update(schema.allocations)
        .set({ roomId: room.id, stay })
        .where(eq(schema.allocations.bookingId, bookingId));
    });
  } catch (error) {
    if (violates(error, EXCLUSION_VIOLATION, "one_stay_per_room_per_night")) {
      throw new BookingError("full", `${room.name} is taken for some of those nights.`);
    }
    throw error;
  }
}

export type Relocation = { stay: Stay; roomId: number };

export type RelocationPreview =
  | {
      ok: true;
      roomName: string;
      roomChanges: boolean;
      datesChange: boolean;
      totalCents: number;
      differenceCents: number;
      /** Owed back to the guest if the move makes the stay cost less than they have paid. */
      refundCents: number;
      /** Still to pay once the move is made. */
      owedCents: number;
    }
  | { ok: false; reason: string };

/**
 * What putting a booking in a chosen room on chosen dates would do, without
 * doing it: whether those nights are free there, and what it does to the bill.
 * The calendar asks this when a booking is dragged, before anything is saved.
 */
export async function previewRelocation(
  booking: Booking,
  to: Relocation,
  staffId: number,
  now: Date,
): Promise<RelocationPreview> {
  const datesChange = to.stay.from !== booking.stay.from || to.stay.to !== booking.stay.to;
  const roomChanges = to.roomId !== booking.roomId;
  if (!datesChange && !roomChanges) return { ok: false, reason: "That is where the booking already is." };
  if (isOver(booking.status) || booking.status === "checked_out") {
    return { ok: false, reason: "This booking no longer holds a room." };
  }
  if (booking.status === "held") {
    return { ok: false, reason: "The guest is paying for this booking right now. Move it once it is paid." };
  }

  let room: Room;
  try {
    room = await usableRoom(db(), to.roomId, booking);
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, reason: error.message };
    throw error;
  }
  const money = await moneyOf(db(), booking);
  const moved = { roomName: room.name, roomChanges, datesChange };

  if (!datesChange) {
    if (!(await roomIsFree(db(), room.id, booking.stay, now, { ignoreBookingId: booking.id }))) {
      return { ok: false, reason: `${room.name} is taken for some of those nights.` };
    }
    // Another room for the same nights is the lodge's choice. The price agreed stays.
    return {
      ok: true,
      ...moved,
      totalCents: booking.totalCents,
      differenceCents: 0,
      refundCents: 0,
      owedCents: money.owedCents,
    };
  }

  const priced = await previewDateChange(booking, to.stay, { actor: "staff", staffId }, now);
  if (!priced.ok) return priced;
  if (!(await roomIsFree(db(), room.id, to.stay, now, { ignoreBookingId: booking.id }))) {
    return { ok: false, reason: `${room.name} is taken for some of those nights.` };
  }
  return {
    ok: true,
    ...moved,
    totalCents: priced.totalCents,
    differenceCents: priced.differenceCents,
    refundCents: priced.refundCents,
    owedCents: Math.max(0, priced.totalCents - money.heldCents),
  };
}

/** Puts a booking in a chosen room on chosen dates. Either the whole move happens or none of it. */
export async function relocate(bookingId: number, to: Relocation, staffId: number, now: Date): Promise<Booking> {
  const [current] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!current) throw new BookingError("not_found", "That booking could not be found.");

  const datesChange = to.stay.from !== current.stay.from || to.stay.to !== current.stay.to;
  if (!datesChange) return moveRoom(bookingId, to.roomId, staffId, now);
  const moved = await changeDates(bookingId, to.stay, { actor: "staff", staffId }, now, { intoRoomId: to.roomId });
  return moved.booking;
}

export async function moveRoom(bookingId: number, roomId: number, staffId: number, now: Date): Promise<Booking> {
  const booking = await db().transaction(async (tx) => {
    const current = await lock(tx, bookingId);
    if (isOver(current.status) || current.status === "checked_out") {
      throw new BookingError("not_now", "This booking no longer holds a room.");
    }
    if (current.roomId === roomId) return current;

    const room = await usableRoom(tx, roomId, current);
    const [from] = await tx
      .select({ name: schema.rooms.name })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, current.roomId));

    await placeIn(tx, bookingId, room, current.stay);

    await tx
      .update(schema.bookings)
      .set({ roomId, roomTypeId: room.roomTypeId })
      .where(eq(schema.bookings.id, bookingId));
    await record(
      tx,
      bookingId,
      { actor: "staff", staffId },
      "room-moved",
      `Moved from ${from?.name ?? "its room"} to ${room.name}.`,
      now,
    );
    const [updated] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return updated;
  });
  await touchDesk();
  return booking;
}

/**
 * Adds something to the bill: an extra from the list, or a line staff write
 * themselves. A negative amount takes money off.
 */
export async function addCharge(
  bookingId: number,
  charge: { extraId: number } | { label: string; cents: number },
  staffId: number,
  now: Date,
): Promise<Booking> {
  const booking = await db().transaction(async (tx) => {
    const current = await lock(tx, bookingId);
    if (isOver(current.status)) {
      throw new BookingError("not_now", "This booking has ended. Nothing more can be added to it.");
    }

    let label: string;
    let cents: number;
    if ("extraId" in charge) {
      const [extra] = await tx.select().from(schema.extras).where(eq(schema.extras.id, charge.extraId));
      if (!extra) throw new BookingError("invalid", "That extra is no longer offered.");
      const quantity = extra.charged === "per_person" ? current.adults + current.children : 1;
      label = extra.charged === "per_person" ? `${extra.name}, ${plural(quantity, "guest")}` : extra.name;
      cents = quantity * extra.priceCents;
      await tx.insert(schema.bookingCharges).values({
        bookingId,
        kind: "extra",
        label,
        quantity,
        unitCents: extra.priceCents,
        cents,
        extraId: extra.id,
        createdBy: staffId,
        createdAt: now,
      });
    } else {
      label = charge.label.trim().slice(0, 120);
      cents = charge.cents;
      if (!label) throw new BookingError("invalid", "Say what the charge is for.");
      if (!Number.isInteger(cents) || cents === 0) throw new BookingError("invalid", "Enter an amount.");
      await tx.insert(schema.bookingCharges).values({
        bookingId,
        kind: "adjustment",
        label,
        quantity: 1,
        unitCents: cents,
        cents,
        createdBy: staffId,
        createdAt: now,
      });
    }

    const totalCents = await billTotal(tx, bookingId);
    if (totalCents < 0) throw new BookingError("invalid", "That would take the bill below nothing.");
    await tx.update(schema.bookings).set({ totalCents }).where(eq(schema.bookings.id, bookingId));
    await record(
      tx,
      bookingId,
      { actor: "staff", staffId },
      "charge",
      `${cents > 0 ? "Added" : "Took off"} ${formatMoney(Math.abs(cents))}: ${label}.`,
      now,
    );
    const [updated] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return updated;
  });
  await touchDesk();
  return booking;
}

/** Takes a charge off the bill again. Nights and meals are not charges that can be removed. */
export async function removeCharge(bookingId: number, chargeId: number, staffId: number, now: Date): Promise<Booking> {
  const booking = await db().transaction(async (tx) => {
    const current = await lock(tx, bookingId);
    if (isOver(current.status)) throw new BookingError("not_now", "This booking has ended.");
    const [charge] = await tx
      .select()
      .from(schema.bookingCharges)
      .where(and(eq(schema.bookingCharges.id, chargeId), eq(schema.bookingCharges.bookingId, bookingId)));
    if (!charge || charge.kind === "meals") {
      throw new BookingError("invalid", "That line cannot be removed.");
    }
    await tx.delete(schema.bookingCharges).where(eq(schema.bookingCharges.id, chargeId));
    const totalCents = await billTotal(tx, bookingId);
    await tx.update(schema.bookings).set({ totalCents }).where(eq(schema.bookings.id, bookingId));
    await record(
      tx,
      bookingId,
      { actor: "staff", staffId },
      "charge",
      `Removed ${formatMoney(charge.cents)}: ${charge.label}.`,
      now,
    );
    const [updated] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    return updated;
  });
  await touchDesk();
  return booking;
}

/** A room taken off sale for some nights: repairs, the owner's own use. */
export async function blockRoom(roomId: number, stay: Stay, reason: string, staffId: number, now: Date): Promise<void> {
  if (!reason.trim()) throw new BookingError("invalid", "Say why the room is blocked.");
  if (nightsIn(stay) < 1) throw new BookingError("dates", "Choose the first and the last night of the block.");
  try {
    await db().transaction(async (tx) => {
      await releaseLapsedHolds(tx, now);
      await tx.insert(schema.allocations).values({
        roomId,
        stay,
        blockReason: reason.trim().slice(0, 200),
        createdBy: staffId,
        createdAt: now,
      });
    });
  } catch (error) {
    if (violates(error, EXCLUSION_VIOLATION, "one_stay_per_room_per_night")) {
      throw new BookingError("full", "That room has a booking or a block on some of those nights.");
    }
    throw error;
  }
  await touchDesk();
}

export async function unblockRoom(allocationId: number): Promise<void> {
  await db()
    .delete(schema.allocations)
    .where(and(eq(schema.allocations.id, allocationId), sql`${schema.allocations.bookingId} IS NULL`));
  await touchDesk();
}

/** Bookings a guest is in the middle of paying for, for the staff's "today" screen. */
export async function holdsInProgress(now: Date, q: Queryable = db()): Promise<Booking[]> {
  return q
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.status, "held"), gt(schema.bookings.holdUntil, now)))
    .orderBy(schema.bookings.holdUntil);
}
