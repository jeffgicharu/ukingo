// Writing a message to a guest.
//
// Every message is written to the `messages` table first, inside the same
// transaction as the change it reports, so the two can never part company.
// Whether it is then sent is decided here, and the reason is kept when it is
// not. Sending itself happens afterwards (see deliver.ts).

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { lodgeDay, lodgeMoment, nightsIn } from "@/lib/dates";
import { moneyOf } from "@/server/booking/ledger";
import { schema, type Queryable } from "@/server/db";
import { env } from "@/server/env";

import { compose, type MessageContext, type MessageKind } from "./templates";

type Extra = Partial<
  Pick<
    MessageContext,
    | "payment"
    | "refundCents"
    | "refundReference"
    | "keptCents"
    | "payBy"
    | "depositCents"
    | "previousStay"
    | "previousTotalCents"
  >
> & {
  /** A message with the same key is written only once, however often this is called. */
  onceKey?: string;
  /** The visitor whose action caused the message, for the per-visitor limit. */
  ip?: string | null;
};

const NEVER_REAL = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

/** False for addresses that cannot belong to anyone: example.com, anything.test and the like. */
export function isDeliverable(address: string): boolean {
  const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(address.trim());
  return match !== null && !NEVER_REAL.test(match[1]);
}

export type SendingDecision = { status: "queued" } | { status: "not_sent"; reason: string };

/** Whether an email to this address may go out now, and if not, why. */
export async function decideSending(
  q: Queryable,
  message: { recipient: string; sample: boolean; ip?: string | null },
  now: Date,
): Promise<SendingDecision> {
  if (message.sample) {
    return { status: "not_sent", reason: "Sample booking. Messages for sample bookings are never sent." };
  }
  if (!isDeliverable(message.recipient)) {
    return { status: "not_sent", reason: "Not an address that can receive mail." };
  }
  if (!env.resendKey) {
    return { status: "not_sent", reason: "Email sending is not set up on this server." };
  }

  const limits = env.mailLimits;
  const since = lodgeMoment(lodgeDay(now));
  const counted = and(
    eq(schema.messages.channel, "email"),
    inArray(schema.messages.status, ["queued", "sent"]),
    gte(schema.messages.createdAt, since),
  );

  const [{ total, toAddress, fromVisitor }] = await q
    .select({
      total: sql<number>`count(*)::int`,
      toAddress: sql<number>`count(*) filter (where ${schema.messages.recipient} = ${message.recipient})::int`,
      fromVisitor: sql<number>`count(*) filter (where ${schema.messages.originIp} = ${message.ip ?? null}::inet)::int`,
    })
    .from(schema.messages)
    .where(counted);

  if (total >= limits.daily) {
    return { status: "not_sent", reason: `The limit of ${limits.daily} emails a day has been reached.` };
  }
  if (toAddress >= limits.perAddress) {
    return {
      status: "not_sent",
      reason: `The limit of ${limits.perAddress} emails a day to one address has been reached.`,
    };
  }
  if (message.ip && fromVisitor >= limits.perVisitor) {
    return {
      status: "not_sent",
      reason: `The limit of ${limits.perVisitor} emails a day caused by one visitor has been reached.`,
    };
  }
  return { status: "queued" };
}

/** Writes the email and the text message for one piece of news about a booking. */
export async function tell(
  q: Queryable,
  bookingId: number,
  kind: MessageKind,
  now: Date,
  extra: Extra = {},
): Promise<void> {
  const [row] = await q
    .select({
      booking: schema.bookings,
      roomName: schema.roomTypes.name,
      mealPlan: schema.mealPlans.name,
    })
    .from(schema.bookings)
    .innerJoin(schema.roomTypes, eq(schema.roomTypes.id, schema.bookings.roomTypeId))
    .innerJoin(schema.mealPlans, eq(schema.mealPlans.code, schema.bookings.mealPlan))
    .where(eq(schema.bookings.id, bookingId));
  if (!row) return;

  const { booking } = row;
  const [settings] = await q.select().from(schema.settings);
  const money = await moneyOf(q, booking);

  const { onceKey, ip, ...details } = extra;
  const composed = compose(kind, {
    lodgeName: settings?.lodgeName ?? "Ukingo",
    today: lodgeDay(now),
    guestName: booking.guestName,
    reference: booking.reference,
    roomName: row.roomName,
    stay: booking.stay,
    nights: nightsIn(booking.stay),
    adults: booking.adults,
    children: booking.children,
    mealPlan: row.mealPlan,
    totalCents: money.totalCents,
    paidCents: money.paidCents,
    owedCents: money.owedCents,
    terms: booking.terms,
    checkInFrom: settings?.checkInFrom ?? "2 pm",
    checkOutBy: settings?.checkOutBy ?? "10.30 am",
    ...details,
  });

  if (booking.guestEmail) {
    const decision = await decideSending(q, { recipient: booking.guestEmail, sample: booking.sample, ip }, now);
    await q
      .insert(schema.messages)
      .values({
        bookingId: booking.id,
        guestId: booking.guestId,
        channel: "email",
        kind,
        recipient: booking.guestEmail,
        subject: composed.subject,
        html: composed.html,
        body: composed.text,
        status: decision.status,
        statusReason: decision.status === "not_sent" ? decision.reason : null,
        onceKey: onceKey ?? null,
        originIp: ip ?? null,
        createdAt: now,
      })
      .onConflictDoNothing({ target: schema.messages.onceKey });
  }

  await q
    .insert(schema.messages)
    .values({
      bookingId: booking.id,
      guestId: booking.guestId,
      channel: "sms",
      kind,
      recipient: booking.guestPhone,
      body: composed.sms,
      status: "not_sent",
      statusReason: booking.sample
        ? "Sample booking. Messages for sample bookings are never sent."
        : "Text messages are written and kept, but sending them is not switched on.",
      onceKey: onceKey ? `${onceKey}:sms` : null,
      originIp: ip ?? null,
      createdAt: now,
    })
    .onConflictDoNothing({ target: schema.messages.onceKey });
}
