// The words of every message the lodge sends about a booking.
//
// A message is written as a short list of blocks: paragraphs, a table of
// facts, a button. The email's HTML and its plain-text twin are both made
// from that one list, so they can never say different things.

import type { Day } from "@/lib/dates";
import { formatDay, formatMoment, formatMoney, plural } from "@/lib/format";
import type { BookingTerms } from "@/server/db/schema";

/** Stands in for the booking's private address until the moment of sending. */
export const LINK = "{{private-link}}";

export type MessageKind =
  | "booking-confirmed"
  | "payment-received"
  | "booking-changed"
  | "booking-cancelled"
  | "refund-sent"
  | "pay-by"
  | "provisional-lapsed"
  | "balance-due-soon"
  | "balance-due-today"
  | "arrival-soon"
  | "paid-too-late"
  | "find-booking";

const KIND_NAMES: Record<MessageKind, string> = {
  "booking-confirmed": "Booking confirmed",
  "payment-received": "Payment received",
  "booking-changed": "Dates changed",
  "booking-cancelled": "Booking cancelled",
  "refund-sent": "Refund sent",
  "pay-by": "Request to pay",
  "provisional-lapsed": "Booking lapsed",
  "balance-due-soon": "Balance due soon",
  "balance-due-today": "Balance due today",
  "arrival-soon": "Before you arrive",
  "paid-too-late": "Payment arrived too late",
  "find-booking": "Link to the booking",
};

/** What staff call a kind of message in their lists. */
export function messageName(kind: string): string {
  return KIND_NAMES[kind as MessageKind] ?? kind.replace(/-/g, " ");
}

export type MessageContext = {
  lodgeName: string;
  /** The date at the lodge when the message is written. */
  today: Day;
  guestName: string;
  reference: string;
  roomName: string;
  stay: { from: Day; to: Day };
  nights: number;
  adults: number;
  children: number;
  mealPlan: string;
  totalCents: number;
  paidCents: number;
  owedCents: number;
  terms: BookingTerms;
  checkInFrom: string;
  checkOutBy: string;
  /** The payment this message is about, when it is about one. */
  payment?: { cents: number; receipt: string | null; method: string };
  /** A refund this message is about. */
  refundCents?: number;
  refundReference?: string | null;
  /** What the lodge keeps on a cancellation. */
  keptCents?: number;
  /** When a booking made by staff lets its room go. */
  payBy?: Date;
  /** The least that confirms the booking. */
  depositCents?: number;
  /** What changed, for a change of dates: the stay as it was. */
  previousStay?: { from: Day; to: Day };
  previousTotalCents?: number;
};

type Block =
  | { type: "text"; text: string }
  | { type: "facts"; rows: [string, string][] }
  | { type: "button"; label: string; page?: "" | "/pay" | "/change" | "/cancel" }
  | { type: "small"; text: string };

export type Composed = {
  subject: string;
  html: string;
  text: string;
  /** The same news in a text message. */
  sms: string;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

function guests(context: MessageContext): string {
  const adults = plural(context.adults, "adult");
  return context.children ? `${adults}, ${plural(context.children, "child", "children")}` : adults;
}

function stayFacts(context: MessageContext): [string, string][] {
  return [
    ["Booking", context.reference],
    ["Room", context.roomName],
    ["Arrive", `${formatDay(context.stay.from, "long")}, from ${context.checkInFrom}`],
    ["Leave", `${formatDay(context.stay.to, "long")}, by ${context.checkOutBy}`],
    ["Nights", String(context.nights)],
    ["Guests", guests(context)],
    ["Meals", context.mealPlan],
  ];
}

/** " (M-Pesa receipt TJC4X8PQ21)": what a payment can be traced by, named for how it was paid. */
function proofOf(payment: MessageContext["payment"]): string {
  if (!payment?.receipt) return "";
  const names: Record<string, string> = {
    mpesa_prompt: "M-Pesa receipt",
    mpesa_desk: "M-Pesa receipt",
    bank: "bank reference",
    test: "test payment",
  };
  return ` (${names[payment.method] ?? "reference"} ${payment.receipt})`;
}

function moneyFacts(context: MessageContext): [string, string][] {
  const rows: [string, string][] = [
    ["Total", formatMoney(context.totalCents)],
    ["Paid", formatMoney(context.paidCents)],
  ];
  if (context.owedCents > 0) {
    rows.push([
      "Still to pay",
      context.terms.balance_due
        ? `${formatMoney(context.owedCents)}, by ${formatDay(context.terms.balance_due, "long")}`
        : formatMoney(context.owedCents),
    ]);
  }
  return rows;
}

/**
 * The cancellation terms in a sentence or two, as dates: "Cancel by Wednesday
 * 14 October 2026 and everything you have paid is refunded. …". Steps whose
 * date has already passed are left out.
 */
export function cancellationLines(terms: BookingTerms, today: Day): string {
  const open = terms.cancellation.filter((step) => step.until === null || step.until >= today);
  const lines = open.map((step, index) => {
    const keeps =
      step.keep_percent === 0
        ? "everything you have paid is refunded"
        : step.keep_percent >= 100
          ? "there is no refund"
          : `we keep ${step.keep_percent}% of the total and refund the rest`;
    if (step.until !== null) {
      return `Cancel by ${formatDay(step.until, "long")} and ${keeps}.`;
    }
    return index === 0 ? `If you cancel, ${keeps}.` : `After that, ${keeps}.`;
  });
  return lines.join(" ");
}

const directions =
  "Getting here: from Nanyuki town, take the road towards the mountain. The first 10 km are tarmac and the last 4 km are a murram road that any car manages in dry weather. The gate closes at 9 pm, so please plan to arrive before dark. Map pin: https://www.google.com/maps/search/?api=1&query=0.0500,37.1500";

function blocksFor(kind: MessageKind, context: MessageContext): { subject: string; blocks: Block[]; sms: string } {
  const name = firstName(context.guestName);
  const stayShort = `${formatDay(context.stay.from, "compact")} to ${formatDay(context.stay.to, "short")}`;

  switch (kind) {
    case "booking-confirmed":
      return {
        subject: `Your stay at ${context.lodgeName} is confirmed (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, thank you. Your booking is confirmed and the ${context.roomName} is yours for ${plural(context.nights, "night")}.`,
          },
          { type: "facts", rows: stayFacts(context) },
          ...(context.payment
            ? [
                {
                  type: "text" as const,
                  text: `We received ${formatMoney(context.payment.cents)}${proofOf(context.payment)}.`,
                },
              ]
            : []),
          { type: "facts", rows: moneyFacts(context) },
          {
            type: "text",
            text:
              context.owedCents > 0
                ? "You can pay the balance from your booking page at any time before it is due, in one payment or several."
                : "There is nothing more to pay.",
          },
          { type: "button", label: "Open your booking" },
          {
            type: "text",
            text: `${context.terms.change_until ? `You can change your dates from your booking page until ${formatDay(context.terms.change_until, "long")}. ` : ""}${cancellationLines(context.terms, context.today)}`,
          },
          { type: "text", text: directions },
          {
            type: "small",
            text: "Keep this email. The button above is your private link to the booking: anyone who has it can manage the booking.",
          },
        ],
        sms: `${context.lodgeName}: booking ${context.reference} confirmed. ${context.roomName}, ${stayShort}. Paid ${formatMoney(context.paidCents)}${context.owedCents > 0 ? `, ${formatMoney(context.owedCents)} to pay` : ""}.`,
      };

    case "payment-received":
      return {
        subject: `We received ${formatMoney(context.payment?.cents ?? 0)} for booking ${context.reference}`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, we received ${formatMoney(context.payment?.cents ?? 0)}${proofOf(context.payment)} towards your stay. Thank you.`,
          },
          { type: "facts", rows: [["Booking", context.reference], ["Stay", stayShort], ...moneyFacts(context)] },
          {
            type: "text",
            text:
              context.owedCents > 0 ? "The rest can be paid from your booking page." : "Your stay is now paid in full.",
          },
          { type: "button", label: "Open your booking" },
        ],
        sms: `${context.lodgeName}: received ${formatMoney(context.payment?.cents ?? 0)} for ${context.reference}. ${context.owedCents > 0 ? `${formatMoney(context.owedCents)} still to pay.` : "Paid in full."}`,
      };

    case "booking-changed": {
      const difference = context.totalCents - (context.previousTotalCents ?? context.totalCents);
      return {
        subject: `Your dates have changed (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, your stay has been moved${context.previousStay ? ` from ${formatDay(context.previousStay.from, "compact")} to ${formatDay(context.previousStay.to, "short")}` : ""}. The new details are below.`,
          },
          { type: "facts", rows: stayFacts(context) },
          {
            type: "text",
            text:
              difference > 0
                ? `The new dates cost ${formatMoney(difference)} more, which has been added to what is still to pay.`
                : difference < 0
                  ? `The new dates cost ${formatMoney(-difference)} less.${context.refundCents ? ` You had paid more than the new total, so ${formatMoney(context.refundCents)} will be refunded to the M-Pesa number that paid.` : ""}`
                  : "The price is the same.",
          },
          { type: "facts", rows: moneyFacts(context) },
          { type: "button", label: "Open your booking" },
        ],
        sms: `${context.lodgeName}: booking ${context.reference} moved to ${stayShort}. Total ${formatMoney(context.totalCents)}.`,
      };
    }

    case "booking-cancelled":
      return {
        subject: `Your booking is cancelled (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, your booking for the ${context.roomName}, ${stayShort}, has been cancelled.`,
          },
          {
            type: "text",
            text:
              (context.refundCents ?? 0) > 0
                ? `${formatMoney(context.refundCents!)} will be refunded to the M-Pesa number that paid, within 3 working days.${(context.keptCents ?? 0) > 0 ? ` Under the terms of the booking, ${formatMoney(context.keptCents!)} is kept.` : ""}`
                : context.paidCents > 0
                  ? "Under the terms of the booking, there is no refund."
                  : "Nothing had been paid, so nothing is owed either way.",
          },
          { type: "text", text: "We are sorry not to see you, and hope you will come another time." },
          { type: "button", label: "See the cancelled booking" },
        ],
        sms: `${context.lodgeName}: booking ${context.reference} cancelled.${(context.refundCents ?? 0) > 0 ? ` Refund of ${formatMoney(context.refundCents!)} to follow.` : ""}`,
      };

    case "refund-sent":
      return {
        subject: `Your refund of ${formatMoney(context.refundCents ?? 0)} has been sent (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, we have sent ${formatMoney(context.refundCents ?? 0)} to the M-Pesa number that paid for booking ${context.reference}.${context.refundReference ? ` The reference is ${context.refundReference}.` : ""}`,
          },
          { type: "button", label: "Open your booking" },
        ],
        sms: `${context.lodgeName}: refund of ${formatMoney(context.refundCents ?? 0)} sent for ${context.reference}.`,
      };

    case "pay-by":
      return {
        subject: `Pay ${formatMoney(context.depositCents ?? 0)} to confirm your stay at ${context.lodgeName} (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, we are holding the ${context.roomName} for you, ${stayShort}. The room is kept until ${context.payBy ? formatMoment(context.payBy) : "the deadline"}. To confirm the booking, pay ${formatMoney(context.depositCents ?? 0)} by M-Pesa before then.`,
          },
          { type: "facts", rows: stayFacts(context) },
          {
            type: "facts",
            rows: [
              ["Total", formatMoney(context.totalCents)],
              ["To confirm", formatMoney(context.depositCents ?? 0)],
              ["Pay by", context.payBy ? formatMoment(context.payBy) : ""],
            ],
          },
          { type: "button", label: "Pay and confirm", page: "/pay" },
          { type: "text", text: cancellationLines(context.terms, context.today) },
          {
            type: "small",
            text: "If the payment is not made in time, the room goes back on sale and nothing is owed.",
          },
        ],
        sms: `${context.lodgeName}: ${context.roomName} held for you, ${stayShort}. Pay ${formatMoney(context.depositCents ?? 0)} by ${context.payBy ? formatMoment(context.payBy) : "the deadline"} to confirm. Ref ${context.reference}.`,
      };

    case "provisional-lapsed":
      return {
        subject: `We have let your room go (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, we were holding the ${context.roomName} for you, ${stayShort}, but the payment to confirm it did not arrive in time, so the room is back on sale. Nothing is owed.`,
          },
          {
            type: "text",
            text: "If you would still like to come, you can check dates and book on our site at any time.",
          },
        ],
        sms: `${context.lodgeName}: the hold on ${context.roomName}, ${stayShort}, has lapsed (ref ${context.reference}). Nothing is owed.`,
      };

    case "balance-due-soon":
    case "balance-due-today": {
      const today = kind === "balance-due-today";
      return {
        subject: today
          ? `Your balance of ${formatMoney(context.owedCents)} is due today (${context.reference})`
          : `Your balance of ${formatMoney(context.owedCents)} is due on ${context.terms.balance_due ? formatDay(context.terms.balance_due, "long") : "arrival"} (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, a reminder that ${formatMoney(context.owedCents)} is still to pay for your stay, ${stayShort}. It is due ${today ? "today" : `by ${context.terms.balance_due ? formatDay(context.terms.balance_due, "long") : "arrival"}`}.`,
          },
          { type: "facts", rows: [["Booking", context.reference], ...moneyFacts(context)] },
          { type: "text", text: "You can pay by M-Pesa from your booking page, in one payment or several." },
          { type: "button", label: "Pay the balance", page: "/pay" },
        ],
        sms: `${context.lodgeName}: ${formatMoney(context.owedCents)} is due ${today ? "today" : `by ${context.terms.balance_due ? formatDay(context.terms.balance_due, "short") : "arrival"}`} for booking ${context.reference}.`,
      };
    }

    case "arrival-soon":
      return {
        subject: `See you on ${formatDay(context.stay.from, "long")} (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, your stay is nearly here. The ${context.roomName} will be ready from ${context.checkInFrom} on ${formatDay(context.stay.from, "long")}.`,
          },
          { type: "facts", rows: stayFacts(context) },
          ...(context.owedCents > 0
            ? [
                {
                  type: "text" as const,
                  text: `${formatMoney(context.owedCents)} is still to pay. You can pay it now from your booking page, or at the desk when you arrive.`,
                },
              ]
            : []),
          { type: "text", text: directions },
          {
            type: "text",
            text: "Nights here are cold all year. Bring a warm jacket, and closed shoes if you would like to walk in the forest.",
          },
          { type: "button", label: "Open your booking" },
        ],
        sms: `${context.lodgeName}: see you on ${formatDay(context.stay.from, "compact")}. Check-in from ${context.checkInFrom}. Ref ${context.reference}.`,
      };

    case "paid-too-late":
      return {
        subject: `About your payment for booking ${context.reference}`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, we received ${formatMoney(context.payment?.cents ?? 0)} from you${proofOf(context.payment)}, but it arrived after the time we could hold the room, and the room has since been taken by another guest. We are sorry.`,
          },
          {
            type: "text",
            text: `The full ${formatMoney(context.refundCents ?? context.payment?.cents ?? 0)} will be refunded to the M-Pesa number that paid, within 3 working days.`,
          },
          { type: "text", text: "Other rooms or other dates may be free. You can check on our site." },
        ],
        sms: `${context.lodgeName}: your payment for ${context.reference} arrived after the room was released. It will be refunded in full.`,
      };

    case "find-booking":
      return {
        subject: `The link to your booking at ${context.lodgeName} (${context.reference})`,
        blocks: [
          {
            type: "text",
            text: `Dear ${name}, here is the link to your booking for the ${context.roomName}, ${stayShort}, as you asked.`,
          },
          { type: "button", label: "Open your booking" },
          { type: "small", text: "If you did not ask for this, you can ignore this email. Nothing has changed." },
        ],
        sms: `${context.lodgeName}: the link to booking ${context.reference} has been emailed to you.`,
      };
  }
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Turns plain web addresses inside a paragraph into links. */
const linkify = (escaped: string) =>
  escaped.replace(/https:\/\/[^\s<]+/g, (address) => `<a href="${address}" style="color:#7c510a">${address}</a>`);

function renderHtml(subject: string, lodgeName: string, blocks: Block[]): string {
  const body = blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#101d26">${linkify(escape(block.text))}</p>`;
        case "small":
          return `<p style="margin:0 0 18px;font-size:13px;line-height:1.5;color:#5d6e76">${linkify(escape(block.text))}</p>`;
        case "facts":
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-top:1px solid #dde4dd">${block.rows
            .map(
              ([label, value]) =>
                `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid #dde4dd;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#5d6e76;white-space:nowrap;vertical-align:top">${escape(label)}</td><td style="padding:10px 0;border-bottom:1px solid #dde4dd;font-size:16px;line-height:1.4;color:#101d26;text-align:right">${escape(value)}</td></tr>`,
            )
            .join("")}</table>`;
        case "button":
          return `<p style="margin:6px 0 26px"><a href="${LINK}${block.page ?? ""}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#e5a23a;color:#0a141a;font-size:16px;font-weight:600;text-decoration:none">${escape(block.label)}</a></p>`;
      }
    })
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;padding:0;background:#edf1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf1ec"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="background:#101d26;border-radius:14px 14px 0 0;padding:22px 28px;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#f6f8f5">${escape(lodgeName)}<span style="display:block;margin-top:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#f6c877">Nanyuki · Mount Kenya</span></td></tr><tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:28px 28px 12px">${body}</td></tr><tr><td style="padding:18px 28px;font-size:12px;line-height:1.5;color:#5d6e76">This address does not take replies. ${escape(lodgeName)}, Nanyuki, Kenya.</td></tr></table></td></tr></table></body></html>`;
}

function renderText(lodgeName: string, blocks: Block[]): string {
  const parts = blocks.map((block) => {
    switch (block.type) {
      case "text":
      case "small":
        return block.text;
      case "facts":
        return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
      case "button":
        return `${block.label}: ${LINK}${block.page ?? ""}`;
    }
  });
  return `${parts.join("\n\n")}\n\nThis address does not take replies.\n${lodgeName}, Nanyuki, Kenya.\n`;
}

export function compose(kind: MessageKind, context: MessageContext): Composed {
  const { subject, blocks, sms } = blocksFor(kind, context);
  return {
    subject,
    html: renderHtml(subject, context.lodgeName, blocks),
    text: renderText(context.lodgeName, blocks),
    sms,
  };
}

/** A message to a member of staff, not about a booking. The link is given, not looked up. */
export function composeStaffMessage(message: {
  lodgeName: string;
  subject: string;
  paragraphs: string[];
  button?: { label: string };
  small?: string;
}): Omit<Composed, "sms"> {
  const blocks: Block[] = [
    ...message.paragraphs.map((text) => ({ type: "text" as const, text })),
    ...(message.button ? [{ type: "button" as const, label: message.button.label }] : []),
    ...(message.small ? [{ type: "small" as const, text: message.small }] : []),
  ];
  return {
    subject: message.subject,
    html: renderHtml(message.subject, message.lodgeName, blocks),
    text: renderText(message.lodgeName, blocks),
  };
}
