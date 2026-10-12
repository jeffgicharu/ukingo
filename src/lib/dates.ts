// Calendar dates for stays.
//
// A stay is counted in nights, and the lodge keeps one clock: East Africa
// Time, which is three hours ahead of UTC all year. A calendar date is held as
// a plain "2026-11-13" string and never as a moment in time, so the server's
// clock and the visitor's phone cannot shift it.

/** A calendar date, "YYYY-MM-DD". */
export type Day = string;

/** A run of nights: the guest arrives on `from` and leaves on `to`. */
export type Stay = { from: Day; to: Day };

const DAY_MS = 86_400_000;
const EAT_OFFSET_MS = 3 * 3_600_000;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDay(value: unknown): value is Day {
  if (typeof value !== "string") return false;
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toUtc(day: Day): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`Not a date: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtc(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: Day, count: number): Day {
  return fromUtc(toUtc(day) + count * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function nightsIn(stay: Stay): number {
  return daysBetween(stay.from, stay.to);
}

/** Each night of the stay, named by the date the guest goes to bed. */
export function nightsOf(stay: Stay): Day[] {
  const nights: Day[] = [];
  for (let day = stay.from; day < stay.to; day = addDays(day, 1)) {
    nights.push(day);
  }
  return nights;
}

/** 0 is Sunday, 6 is Saturday. */
export function weekday(day: Day): number {
  return new Date(toUtc(day)).getUTCDay();
}

/** Friday and Saturday nights are priced as the weekend. */
export function isWeekendNight(night: Day): boolean {
  const index = weekday(night);
  return index === 5 || index === 6;
}

export function addMonths(day: Day, count: number): Day {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new Error(`Not a date: ${day}`);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1 + count;
  const wanted = Number(match[3]);
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, month, Math.min(wanted, lastOfMonth)));
}

export function startOfMonth(day: Day): Day {
  return `${day.slice(0, 7)}-01`;
}

/** The date at the lodge at a given moment. */
export function lodgeDay(at: Date): Day {
  return fromUtc(at.getTime() + EAT_OFFSET_MS);
}

/** The hour (0 to 23) at the lodge at a given moment. */
export function lodgeHour(at: Date): number {
  return new Date(at.getTime() + EAT_OFFSET_MS).getUTCHours();
}

/** The moment a lodge date and time of day happens. */
export function lodgeMoment(day: Day, hour = 0, minute = 0): Date {
  return new Date(toUtc(day) + hour * 3_600_000 + minute * 60_000 - EAT_OFFSET_MS);
}

export function minDay(a: Day, b: Day): Day {
  return a <= b ? a : b;
}

export function maxDay(a: Day, b: Day): Day {
  return a >= b ? a : b;
}

/** True when the two stays share at least one night. */
export function staysOverlap(a: Stay, b: Stay): boolean {
  return a.from < b.to && b.from < a.to;
}
