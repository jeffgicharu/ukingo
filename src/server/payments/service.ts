// Taking money for a booking.
//
// A payment is believed only as far as it can be checked. The amount is the
// site's own figure, never one a browser or a message supplied. A result is
// recorded once, however many times it is reported. And when Safaricom's
// confirmation never arrives, the site asks what happened and settles the
// payment either way.

import { randomBytes, timingSafeEqual } from "node:crypto";

import { and, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import { lodgeDay } from "@/lib/dates";
import { formatMoney, normalisePhone } from "@/lib/format";
import { dueOn, isOver, moneyOf } from "@/server/booking/ledger";
import { paymentKey } from "@/server/booking/links";
import {
  applyPayment,
  BookingError,
  extendHoldForPayment,
  touchDesk,
  type PaymentEffect,
  type Who,
} from "@/server/booking/service";
import { db, schema, type Queryable } from "@/server/db";
import type { PaymentFailure, PaymentMethod } from "@/server/db/schema";
import { env } from "@/server/env";
import { tell } from "@/server/messages/tell";

import { daraja, MPESA_LIMIT_CENTS, readAskedResult, type Mpesa } from "./daraja";

export type Payment = typeof schema.payments.$inferSelect;

/** A prompt stays on the phone for about a minute. While one is open, no second one is sent. */
const PROMPT_SECONDS = 75;
/** After this long with no news from anywhere, a prompt is taken as unanswered. */
const GIVE_UP_AFTER_MS = 5 * 60_000;
const ASSUMED = "No answer from M-Pesa";

const PROMPTS_PER_PHONE = 5;
const PROMPTS_PER_VISITOR = 8;
const LIMIT_WINDOW_MS = 10 * 60_000;

/** The address Safaricom answers one prompt on: /hooks/pay/42.kq3… */
export function answerPath(payment: { id: number; callbackKey: string | null }): string {
  return `/hooks/pay/${payment.id}.${paymentKey(payment.id, payment.callbackKey ?? "")}`;
}

/** True when the last part of an answer address belongs to this payment. */
export function answerMatches(code: string, payment: { id: number; callbackKey: string | null }): boolean {
  const expected = Buffer.from(`${payment.id}.${paymentKey(payment.id, payment.callbackKey ?? "")}`);
  const given = Buffer.from(code);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function record(
  q: Queryable,
  bookingId: number,
  who: Who,
  summary: string,
  now: Date,
  detail?: Record<string, unknown>,
) {
  await q.insert(schema.bookingEvents).values({
    bookingId,
    at: now,
    actor: who.actor,
    staffId: who.actor === "staff" ? who.staffId : null,
    kind: "payment",
    summary,
    detail: detail ?? null,
  });
}

export type PaymentRequest = {
  bookingId: number;
  /** What the guest chose to pay, in cents. Checked against what is owed. */
  cents: number;
  phone: string;
  who: Who;
  ip?: string | null;
  /**
   * Hold this request to the limit on prompts from one visitor, as guests
   * are. Set for staff accounts that are open to the public for training.
   */
  asVisitor?: boolean;
};

/**
 * Works out whether this amount may be taken for this booking now, and
 * returns the booking locked for the transaction.
 */
async function admit(tx: Queryable, request: { bookingId: number; cents: number }, now: Date) {
  const found = await tx.execute<{ id: number }>(
    sql`SELECT id FROM bookings WHERE id = ${request.bookingId} FOR UPDATE`,
  );
  if (!found.rows[0]) throw new BookingError("not_found", "That booking could not be found.");
  const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, request.bookingId));

  if (isOver(booking.status) || booking.status === "checked_out") {
    throw new BookingError(
      "not_now",
      booking.status === "expired"
        ? "The time to pay for this booking has run out. Start it again to pay."
        : "This booking is over, so nothing more can be paid towards it.",
    );
  }
  if (booking.status === "held" && booking.holdUntil && booking.holdUntil <= now) {
    throw new BookingError("not_now", "The time to pay for this booking has run out. Start it again to pay.");
  }

  const money = await moneyOf(tx, booking);
  const due = dueOn(booking.status, booking.terms, money, lodgeDay(now));

  if (!Number.isInteger(request.cents) || request.cents <= 0) {
    throw new BookingError("invalid", "Enter the amount to pay.");
  }
  if (due.fullCents <= 0) {
    throw new BookingError("not_now", "This booking is paid in full.");
  }
  if (request.cents > due.fullCents) {
    throw new BookingError("invalid", `Only ${formatMoney(due.fullCents)} is owed on this booking.`);
  }
  if (request.cents > MPESA_LIMIT_CENTS) {
    throw new BookingError(
      "invalid",
      `M-Pesa moves at most ${formatMoney(MPESA_LIMIT_CENTS)} in one payment. Pay that now and the rest in a second payment.`,
    );
  }
  // To confirm a booking, the first payment must cover the deposit, or be as much as M-Pesa allows.
  const least = Math.min(due.minimumCents, MPESA_LIMIT_CENTS);
  if (request.cents < least) {
    throw new BookingError("invalid", `At least ${formatMoney(least)} is needed to confirm this booking.`);
  }

  return { booking, money, due };
}

/**
 * Sends an M-Pesa prompt to a phone for a booking. Returns the payment, which
 * is pending until Safaricom reports back or the site finds out for itself.
 */
export async function startMpesaPayment(
  request: PaymentRequest,
  now: Date,
  mpesa: Mpesa | null = daraja(),
): Promise<Payment> {
  const phone = normalisePhone(request.phone);
  if (!phone) {
    throw new BookingError("invalid", "Enter a Safaricom number, such as 0712 345 678.");
  }
  if (!mpesa) {
    throw new BookingError("not_now", "M-Pesa payments are not available at the moment. Please try again later.");
  }

  const prepared = await db().transaction(async (tx) => {
    const { booking } = await admit(tx, request, now);

    // Invented guests have invented numbers, and an invented number may be
    // somebody's real line. No prompt is ever sent to one.
    const [sampleLine] = await tx
      .select({ id: schema.guests.id })
      .from(schema.guests)
      .where(and(eq(schema.guests.phone, phone), eq(schema.guests.sample, true)))
      .limit(1);
    if (sampleLine) {
      throw new BookingError("invalid", "Enter your own Safaricom number. The prompt will appear on that phone.");
    }

    const [open] = await tx
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.bookingId, booking.id),
          eq(schema.payments.method, "mpesa_prompt"),
          eq(schema.payments.status, "pending"),
        ),
      )
      .orderBy(desc(schema.payments.id))
      .limit(1);
    if (open) {
      if (now.getTime() - open.requestedAt.getTime() < PROMPT_SECONDS * 1000) {
        return { payment: open, send: false as const };
      }
      // An older prompt nobody answered is closed before another is sent.
      await tx
        .update(schema.payments)
        .set({ status: "failed", failure: "timeout", failureDetail: ASSUMED, settledAt: now })
        .where(eq(schema.payments.id, open.id));
    }

    const since = new Date(now.getTime() - LIMIT_WINDOW_MS);
    const [{ toPhone, fromVisitor }] = await tx
      .select({
        toPhone: sql<number>`count(*) filter (where ${schema.payments.phone} = ${phone})::int`,
        fromVisitor: sql<number>`count(*) filter (where ${schema.payments.originIp} = ${request.ip ?? null}::inet)::int`,
      })
      .from(schema.payments)
      .where(and(eq(schema.payments.method, "mpesa_prompt"), gt(schema.payments.requestedAt, since)));
    if (
      toPhone >= PROMPTS_PER_PHONE ||
      (request.ip && (request.who.actor === "guest" || request.asVisitor) && fromVisitor >= PROMPTS_PER_VISITOR)
    ) {
      throw new BookingError(
        "too_many_holds",
        "Too many prompts have been sent in the last few minutes. Please wait ten minutes and try again.",
      );
    }

    const fixed = env.mpesaPromptShillings;
    const [payment] = await tx
      .insert(schema.payments)
      .values({
        bookingId: booking.id,
        method: "mpesa_prompt",
        cents: request.cents,
        promptCents: fixed ? fixed * 100 : request.cents,
        phone,
        status: "pending",
        callbackKey: randomBytes(18).toString("base64url"),
        requestedAt: now,
        recordedBy: request.who.actor === "staff" ? request.who.staffId : null,
        originIp: request.ip ?? null,
      })
      .returning();

    // The room stays held while the guest is at the prompt, even if the hold was about to run out.
    await extendHoldForPayment(tx, booking, now);
    return { payment, send: true as const, reference: booking.reference };
  });

  if (!prepared.send) return prepared.payment;
  const { payment } = prepared;

  try {
    const answer = await mpesa.prompt({
      phone: phone.slice(1),
      shillings: Math.round((payment.promptCents ?? payment.cents) / 100),
      reference: prepared.reference,
      answerUrl: `${env.siteUrl}${answerPath(payment)}`,
    });
    const [sent] = await db()
      .update(schema.payments)
      .set({ checkoutRequestId: answer.checkoutRequestId, merchantRequestId: answer.merchantRequestId })
      .where(eq(schema.payments.id, payment.id))
      .returning();
    return sent;
  } catch (error) {
    const detail = (error as Error).message.slice(0, 250);
    const [failed] = await db().transaction(async (tx) => {
      const rows = await tx
        .update(schema.payments)
        .set({
          status: "failed",
          failure: "other",
          failureDetail: `The prompt could not be sent. ${detail}`,
          settledAt: now,
        })
        .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, "pending")))
        .returning();
      await record(tx, payment.bookingId, request.who, "M-Pesa could not send the prompt.", now, {
        paymentId: payment.id,
      });
      return rows;
    });
    return failed ?? payment;
  }
}

export type Settlement =
  | { status: "paid"; receipt?: string | null; paidShillings?: number | null }
  | { status: "failed"; failure: PaymentFailure; detail?: string };

/**
 * Writes down what became of a payment. Whether the news came from
 * Safaricom's confirmation or from the site asking, it is recorded once: the
 * same news arriving again changes nothing.
 */
export async function settlePayment(
  paymentId: number,
  news: Settlement,
  now: Date,
  who: Who = { actor: "system" },
): Promise<{ payment: Payment; effect: PaymentEffect | "unchanged" | "failed" }> {
  const result = await db().transaction(async (tx) => {
    const locked = await tx.execute<{ id: number }>(sql`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`);
    if (!locked.rows[0]) throw new BookingError("not_found", "That payment could not be found.");
    const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));

    if (payment.status === "paid") {
      // Already settled. A receipt number that arrives later is still worth keeping.
      if (news.status === "paid" && news.receipt && !payment.receipt) {
        const [updated] = await tx
          .update(schema.payments)
          .set({ receipt: news.receipt })
          .where(eq(schema.payments.id, paymentId))
          .returning();
        return { payment: updated, effect: "unchanged" as const };
      }
      return { payment, effect: "unchanged" as const };
    }

    // A result M-Pesa gave stands. One the site assumed, having heard nothing, gives way to real news.
    const assumed = payment.status === "failed" && payment.failureDetail === ASSUMED;
    if (payment.status === "failed" && !assumed) {
      return { payment, effect: "unchanged" as const };
    }

    let outcome = news;
    // The amount comes from the site's own record, never from the message.
    if (outcome.status === "paid" && outcome.paidShillings != null) {
      const asked = Math.round((payment.promptCents ?? payment.cents) / 100);
      if (outcome.paidShillings !== asked) {
        outcome = {
          status: "failed",
          failure: "other",
          detail: `M-Pesa reported ${outcome.paidShillings} shillings where ${asked} were asked.`,
        };
      }
    }

    if (outcome.status === "failed") {
      const [updated] = await tx
        .update(schema.payments)
        .set({
          status: "failed",
          failure: outcome.failure,
          failureDetail: outcome.detail?.slice(0, 250) ?? null,
          settledAt: now,
        })
        .where(eq(schema.payments.id, paymentId))
        .returning();
      await record(
        tx,
        payment.bookingId,
        who,
        `A payment of ${formatMoney(payment.cents)} did not go through: ${failureWord(outcome.failure)}.`,
        now,
        {
          paymentId,
        },
      );
      return { payment: updated, effect: "failed" as const };
    }

    const [updated] = await tx
      .update(schema.payments)
      .set({ status: "paid", receipt: outcome.receipt ?? null, failure: null, failureDetail: null, settledAt: now })
      .where(eq(schema.payments.id, paymentId))
      .returning();
    const effect = await applyPayment(
      tx,
      payment.bookingId,
      { id: payment.id, cents: payment.cents, receipt: updated.receipt, method: payment.method },
      who,
      now,
    );
    return { payment: updated, effect };
  });

  await touchDesk();
  return result;
}

function failureWord(failure: PaymentFailure): string {
  const words: Record<PaymentFailure, string> = {
    cancelled: "cancelled on the phone",
    timeout: "not answered in time",
    wrong_pin: "wrong PIN",
    insufficient_funds: "not enough money in the account",
    unreachable: "the phone could not be reached",
    limit: "over the account's limit",
    other: "M-Pesa could not complete it",
  };
  return words[failure];
}

/**
 * Asks M-Pesa what became of one prompt, if it is still open and has not just
 * been asked about. Settles it when there is an answer, and gives up on it
 * when there has been none for several minutes.
 */
export async function checkPayment(
  paymentId: number,
  now: Date,
  mpesa: Mpesa | null = daraja(),
): Promise<Payment | null> {
  const [payment] = await db().select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) return null;
  if (payment.status !== "pending" || payment.method !== "mpesa_prompt") return payment;

  const age = now.getTime() - payment.requestedAt.getTime();
  const sinceCheck = payment.checkedAt ? now.getTime() - payment.checkedAt.getTime() : Infinity;

  if (age >= 15_000 && sinceCheck >= 10_000 && payment.checkoutRequestId && mpesa) {
    await db()
      .update(schema.payments)
      .set({ checkedAt: now, statusChecks: sql`${schema.payments.statusChecks} + 1` })
      .where(eq(schema.payments.id, paymentId));

    let result = null;
    try {
      result = await mpesa.result(payment.checkoutRequestId);
    } catch {
      // Safaricom could not be asked. The next check tries again.
    }
    const outcome = result ? readAskedResult(result.code) : null;
    if (result && outcome) {
      const settled = await settlePayment(
        paymentId,
        outcome.status === "paid" ? { status: "paid" } : { ...outcome, detail: result.description },
        now,
      );
      return settled.payment;
    }
  }

  if (age >= GIVE_UP_AFTER_MS) {
    // Nothing heard after several minutes. If M-Pesa does report later, its word replaces this.
    const settled = await settlePayment(paymentId, { status: "failed", failure: "timeout", detail: ASSUMED }, now);
    return settled.payment;
  }
  return payment;
}

/** Every open prompt, checked. Run by the background jobs so that no payment is left hanging. */
export async function chasePayments(now: Date, mpesa: Mpesa | null = daraja()): Promise<number> {
  const open = await db()
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.status, "pending"),
        eq(schema.payments.method, "mpesa_prompt"),
        lt(schema.payments.requestedAt, new Date(now.getTime() - 15_000)),
      ),
    )
    .limit(25);
  for (const payment of open) {
    await checkPayment(payment.id, now, mpesa);
  }
  return open.length;
}

/**
 * Completes a booking step with a payment that moves no money. Offered only
 * where it has been switched on, for a visitor without a Safaricom line.
 */
export async function makeTestPayment(request: Omit<PaymentRequest, "phone">, now: Date): Promise<Payment> {
  if (!env.testPayments) {
    throw new BookingError("not_allowed", "Test payments are not switched on.");
  }
  const payment = await db().transaction(async (tx) => {
    await admit(tx, request, now);

    if (request.ip) {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.method, "test"),
            sql`${schema.payments.originIp} = ${request.ip}::inet`,
            gt(schema.payments.requestedAt, new Date(now.getTime() - 86_400_000)),
          ),
        );
      if (count >= 12) {
        throw new BookingError(
          "too_many_holds",
          "That is a lot of test payments for one day. Please try again tomorrow.",
        );
      }
    }

    const [created] = await tx
      .insert(schema.payments)
      .values({
        bookingId: request.bookingId,
        method: "test",
        cents: request.cents,
        status: "paid",
        receipt: `TEST${randomBytes(4).toString("hex").toUpperCase()}`,
        requestedAt: now,
        settledAt: now,
        originIp: request.ip ?? null,
      })
      .returning();
    await applyPayment(
      tx,
      request.bookingId,
      { id: created.id, cents: created.cents, receipt: created.receipt, method: "test" },
      request.who,
      now,
    );
    return created;
  });
  await touchDesk();
  return payment;
}

/** Money taken at the desk: cash, a bank transfer, or M-Pesa paid to the till. */
export async function recordDeskPayment(
  request: {
    bookingId: number;
    cents: number;
    method: Extract<PaymentMethod, "cash" | "bank" | "mpesa_desk">;
    reference: string;
  },
  staffId: number,
  now: Date,
): Promise<Payment> {
  const reference = request.reference.trim().slice(0, 60);
  if (request.method !== "cash" && !reference) {
    throw new BookingError("invalid", "Enter the reference of the payment.");
  }
  const payment = await db().transaction(async (tx) => {
    const { due } = await admitDesk(tx, request, now);
    if (request.cents > due) {
      throw new BookingError("invalid", `Only ${formatMoney(due)} is owed on this booking.`);
    }
    const [created] = await tx
      .insert(schema.payments)
      .values({
        bookingId: request.bookingId,
        method: request.method,
        cents: request.cents,
        status: "paid",
        receipt: reference || null,
        requestedAt: now,
        settledAt: now,
        recordedBy: staffId,
      })
      .returning();
    await applyPayment(
      tx,
      request.bookingId,
      { id: created.id, cents: created.cents, receipt: created.receipt, method: created.method },
      { actor: "staff", staffId },
      now,
    );
    return created;
  });
  await touchDesk();
  return payment;
}

/** At the desk any amount up to what is owed may be taken: the deposit rule is the guest's, not the desk's. */
async function admitDesk(tx: Queryable, request: { bookingId: number; cents: number }, now: Date) {
  const found = await tx.execute<{ id: number }>(
    sql`SELECT id FROM bookings WHERE id = ${request.bookingId} FOR UPDATE`,
  );
  if (!found.rows[0]) throw new BookingError("not_found", "That booking could not be found.");
  const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, request.bookingId));
  if (isOver(booking.status)) {
    throw new BookingError("not_now", "This booking is over, so nothing more can be paid towards it.");
  }
  if (!Number.isInteger(request.cents) || request.cents <= 0) {
    throw new BookingError("invalid", "Enter the amount paid.");
  }
  const money = await moneyOf(tx, booking);
  void now;
  return { booking, due: money.owedCents };
}

/** A refund that was owed has been sent. Managers record it with its reference. */
export async function markRefundSent(refundId: number, reference: string, staffId: number, now: Date): Promise<void> {
  const cleaned = reference.trim().slice(0, 60);
  if (!cleaned)
    throw new BookingError("invalid", "Enter the reference of the refund, such as the M-Pesa receipt number.");

  await db().transaction(async (tx) => {
    const [refund] = await tx
      .update(schema.refunds)
      .set({ status: "sent", sentAt: now, sentBy: staffId, reference: cleaned })
      .where(and(eq(schema.refunds.id, refundId), eq(schema.refunds.status, "owed")))
      .returning();
    if (!refund) throw new BookingError("not_now", "That refund has already been recorded as sent.");

    await tx.insert(schema.bookingEvents).values({
      bookingId: refund.bookingId,
      at: now,
      actor: "staff",
      staffId,
      kind: "refund-sent",
      summary: `Refund of ${formatMoney(refund.cents)} sent (${cleaned}).`,
    });
    await tell(tx, refund.bookingId, "refund-sent", now, {
      refundCents: refund.cents,
      refundReference: cleaned,
      onceKey: `refund-sent:${refund.id}`,
    });
  });
  await touchDesk();
}

/** The newest payment on a booking that a guest should be told about: one in progress, or the last to finish. */
export async function latestPayment(bookingId: number, q: Queryable = db()): Promise<Payment | undefined> {
  const [payment] = await q
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.bookingId, bookingId),
        or(inArray(schema.payments.method, ["mpesa_prompt", "test"]), eq(schema.payments.status, "paid")),
      ),
    )
    .orderBy(desc(schema.payments.id))
    .limit(1);
  return payment;
}
