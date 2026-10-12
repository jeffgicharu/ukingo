// The rules a stay must meet before it can be booked, and the terms a booking
// is made under. Pure functions: the caller supplies the moment.

import {
  type Day,
  type Stay,
  addDays,
  addMonths,
  daysBetween,
  isDay,
  lodgeDay,
  lodgeHour,
  nightsIn,
} from "@/lib/dates";
import { formatDay, plural } from "@/lib/format";
import type { BookingTerms } from "@/server/db/schema";
import type { Catalogue, RoomType, Settings } from "@/server/lodge/catalogue";

import { percentOf, type Party } from "./pricing";

export type StayProblem = {
  code:
    | "invalid_dates"
    | "in_the_past"
    | "too_late_today"
    | "too_far_ahead"
    | "too_long"
    | "too_short"
    | "invalid_party"
    | "too_many_guests";
  message: string;
};

/** The first and last days a guest may arrive, as things stand at `now`. */
export function bookableWindow(settings: Settings, now: Date): { first: Day; lastDeparture: Day } {
  const today = lodgeDay(now);
  const first = lodgeHour(now) >= settings.sameDayUntilHour ? addDays(today, 1) : today;
  return { first, lastDeparture: addMonths(today, settings.bookingWindowMonths) };
}

/** Why these dates cannot be booked by anyone, or null when they can. */
export function checkDates(catalogue: Catalogue, stay: { from: string; to: string }, now: Date): StayProblem | null {
  const { settings } = catalogue;

  if (!isDay(stay.from) || !isDay(stay.to) || stay.from >= stay.to) {
    return { code: "invalid_dates", message: "Choose the day you arrive and the day you leave." };
  }

  const today = lodgeDay(now);
  if (stay.from < today) {
    return { code: "in_the_past", message: "That arrival date has passed. Choose a date from today onwards." };
  }

  const window = bookableWindow(settings, now);
  if (stay.from < window.first) {
    return {
      code: "too_late_today",
      message: `Rooms for tonight can be booked online until ${hourLabel(settings.sameDayUntilHour)}. Choose a stay from ${formatDay(window.first)}.`,
    };
  }
  if (stay.to > window.lastDeparture) {
    return {
      code: "too_far_ahead",
      message: `Bookings are open ${plural(settings.bookingWindowMonths, "month")} ahead, for stays ending by ${formatDay(window.lastDeparture)}.`,
    };
  }

  const nights = nightsIn(stay);
  if (nights > settings.maxNights) {
    return {
      code: "too_long",
      message: `The longest stay that can be booked online is ${plural(settings.maxNights, "night")}.`,
    };
  }

  // The strictest rule that touches any night of the stay.
  const rule = catalogue.stayRules
    .filter((candidate) => candidate.from < stay.to && stay.from < candidate.to)
    .sort((a, b) => b.minNights - a.minNights)[0];
  if (rule && nights < rule.minNights) {
    return {
      code: "too_short",
      message: `Stays over ${rule.label} are at least ${plural(rule.minNights, "night")}.`,
    };
  }

  return null;
}

/** Why this party cannot be taken at all, or null. */
export function checkParty(catalogue: Catalogue, party: { adults: number; children: number }): StayProblem | null {
  const largest = Math.max(0, ...catalogue.roomTypes.map((type) => type.sleeps));
  if (!Number.isInteger(party.adults) || !Number.isInteger(party.children) || party.adults < 1 || party.children < 0) {
    return { code: "invalid_party", message: "Every booking needs at least one adult." };
  }
  if (party.adults + party.children > largest) {
    return {
      code: "too_many_guests",
      message: `The largest booking we take online is for ${plural(largest, "guest")}, in ${nameOfLargest(catalogue)}.`,
    };
  }
  return null;
}

function nameOfLargest(catalogue: Catalogue): string {
  return [...catalogue.roomTypes].sort((a, b) => b.sleeps - a.sleeps)[0]?.name ?? "our largest room";
}

export function fits(roomType: RoomType, party: Party): boolean {
  return party.adults + party.children <= roomType.sleeps;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/**
 * The terms for a booking made today: what is paid now, when the balance is
 * due, until when dates can be changed, and what a cancellation keeps. They
 * are stored with the booking and never recalculated from later settings.
 */
export function termsFor(settings: Settings, stay: Stay, totalCents: number, today: Day): BookingTerms {
  return resolveTerms(
    {
      deposit_percent: settings.depositPercent,
      balance_due_days: settings.balanceDueDays,
      change_until_days: settings.changeUntilDays,
      cancellation_steps: settings.cancellationSteps,
    },
    stay,
    totalCents,
    today,
  );
}

/**
 * Turns a booking's rules into dates and amounts for a stay. Used when the
 * booking is made, and again with the booking's own rules if its dates move.
 */
export function resolveTerms(policy: BookingTerms["policy"], stay: Stay, totalCents: number, today: Day): BookingTerms {
  const balanceDue = addDays(stay.from, -policy.balance_due_days);
  const payInFull = policy.deposit_percent >= 100 || balanceDue <= today;
  const depositPercent = payInFull ? 100 : policy.deposit_percent;

  const changeUntil = addDays(stay.from, -policy.change_until_days);

  const steps = [...policy.cancellation_steps].sort((a, b) => b.min_days - a.min_days);

  return {
    deposit_percent: depositPercent,
    deposit_cents: payInFull ? totalCents : percentOf(totalCents, depositPercent),
    balance_due: payInFull ? null : balanceDue,
    change_until: changeUntil >= today ? changeUntil : null,
    cancellation: steps.map((step, index) => ({
      // The last step has no end: it covers every day up to arrival.
      until: index === steps.length - 1 ? null : addDays(stay.from, -step.min_days),
      keep_percent: step.keep_percent,
    })),
    policy: { ...policy, cancellation_steps: steps },
  };
}

/** The share of the total the lodge keeps if the booking is cancelled on `today`. */
export function keepPercentOn(terms: BookingTerms, today: Day): number {
  for (const step of terms.cancellation) {
    if (step.until === null || today <= step.until) return step.keep_percent;
  }
  return 100;
}

/** What a cancellation on `today` returns to a guest who has paid `paidCents`. */
export function refundOnCancel(
  terms: BookingTerms,
  totalCents: number,
  paidCents: number,
  today: Day,
): { keepPercent: number; keptCents: number; refundCents: number } {
  const keepPercent = keepPercentOn(terms, today);
  const mayKeep = keepPercent >= 100 ? totalCents : percentOf(totalCents, keepPercent);
  const keptCents = Math.min(paidCents, mayKeep);
  return { keepPercent, keptCents, refundCents: Math.max(0, paidCents - keptCents) };
}

export function mayChangeDates(terms: BookingTerms, today: Day): boolean {
  return terms.change_until !== null && today <= terms.change_until;
}

export function daysUntilArrival(stay: Stay, today: Day): number {
  return daysBetween(today, stay.from);
}
