// How dates, money and phone numbers are written for people.

import { type Day, type Stay, nightsIn } from "./dates";

const TIME_ZONE = "Africa/Nairobi";

const dayFormats = {
  /** Fri 13 Nov 2026 */
  short: new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }),
  /** Friday 13 November 2026 */
  long: new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }),
  /** Fri 13 Nov */
  compact: new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }),
  /** 13 Nov */
  dayMonth: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
  /** November 2026 */
  month: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
};

export type DayStyle = keyof typeof dayFormats;

function parts(day: Day): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "Fri 13 Nov 2026" by default. en-GB puts a comma after the weekday, which we drop. */
export function formatDay(day: Day, style: DayStyle = "short"): string {
  return dayFormats[style].format(parts(day)).replace(",", "");
}

/** "Fri 13 Nov to Sun 15 Nov 2026" */
export function formatStay(stay: Stay): string {
  const sameYear = stay.from.slice(0, 4) === stay.to.slice(0, 4);
  return `${formatDay(stay.from, sameYear ? "compact" : "short")} to ${formatDay(stay.to, "short")}`;
}

export function formatNights(stay: Stay): string {
  return plural(nightsIn(stay), "night");
}

/** A room type in a sentence: "the Forest Cottage", but "Ukingo House". */
export function theRoom(name: string): string {
  return /^ukingo\b/i.test(name) ? name : `the ${name}`;
}

/** "2 nights", "1 night" */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

const moneyFormat = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
const moneyFormatCents = new Intl.NumberFormat("en-KE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Money is held as whole cents. "KSh 45,000", or "KSh 45,000.50" when there are cents. */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const text = absolute % 100 === 0 ? moneyFormat.format(absolute / 100) : moneyFormatCents.format(absolute / 100);
  return `${sign}KSh ${text}`;
}

/** Whole shillings to cents. */
export function shillings(amount: number): number {
  return Math.round(amount * 100);
}

const momentFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: TIME_ZONE,
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: TIME_ZONE,
});

/** "Fri 13 Nov 2026, 2:05 pm", in East Africa Time. */
export function formatMoment(at: Date): string {
  // en-GB writes "Fri, 13 Nov 2026, 2:05 pm". Only the first comma goes.
  return asWritten(momentFormat.format(at).replace(",", ""));
}

/** "2.05 pm", in East Africa Time. */
export function formatTime(at: Date): string {
  return asWritten(timeFormat.format(at));
}

/** The time of day the way the lodge writes it everywhere else: "2 pm", "10.30 am". */
function asWritten(formatted: string): string {
  return formatted.replace(/(\d{1,2}):(\d{2})\s?(am|pm)$/i, (_, hour: string, minutes: string, half: string) =>
    minutes === "00" ? `${hour} ${half.toLowerCase()}` : `${hour}.${minutes} ${half.toLowerCase()}`,
  );
}

/** A short phrase that must not be split across two lines on a narrow screen: "2 pm", "KSh 1". */
export function unbroken(phrase: string): string {
  return phrase.replace(/ /g, "\u00a0");
}

/**
 * Kenyan mobile numbers arrive as 07…, 01…, 7…, 2547… or +2547…. They are
 * stored one way: +254 followed by nine digits. Returns null for anything else.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  const match = /^(?:\+?254|0)?([17]\d{8})$/.exec(digits);
  return match ? `+254${match[1]}` : null;
}

/**
 * The same rule for a form field's `pattern`, so the browser can point at a
 * mistyped number before the form is sent. Browsers read patterns strictly: a
 * hyphen is escaped inside square brackets and nowhere else, or the whole
 * pattern is ignored without a word.
 */
export const PHONE_PATTERN = String.raw`\s*(\+?254|0)?[\s\-]?[17](\s?-?\d){8}\s*`;

/** "+254712345678" as "0712 345 678". */
export function formatPhone(phone: string): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : phone;
}

/** "0712 345 678" with the middle hidden: "0712 ••• 678". */
export function maskPhone(phone: string): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return match ? `0${match[1]} ••• ${match[3]}` : "•••";
}

/** "wanjiru@example.com" as "w•••@example.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at < 1 ? "•••" : `${email[0]}•••${email.slice(at)}`;
}
