import type { Money } from "@/server/booking/ledger";
import type { BookingStatus } from "@/server/db/schema";

type Tone = "wait" | "booked" | "paid" | "here" | "gone" | "bad";

const tones: Record<Tone, string> = {
  wait: "bg-ember-100 text-ember-800",
  booked: "bg-night-200 text-night-900",
  paid: "bg-moss-100 text-moss-700",
  here: "bg-night-900 text-mist-50",
  gone: "bg-mist-200 text-ink-soft",
  bad: "bg-heath-100 text-heath-700",
};

/** The state of a booking in two or three words, as staff say it. */
export function bookingState(status: BookingStatus, money?: Money): { label: string; tone: Tone } {
  switch (status) {
    case "held":
      return { label: "Paying now", tone: "wait" };
    case "provisional":
      return { label: "Awaiting deposit", tone: "wait" };
    case "confirmed":
      return money && money.owedCents === 0
        ? { label: "Paid in full", tone: "paid" }
        : { label: "Deposit paid", tone: "booked" };
    case "checked_in":
      return { label: "In house", tone: "here" };
    case "checked_out":
      return { label: "Departed", tone: "gone" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
    case "expired":
      return { label: "Lapsed", tone: "gone" };
    case "no_show":
      return { label: "No-show", tone: "bad" };
  }
}

export function Chip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${tones[tone]}`}>
      {label}
    </span>
  );
}

export function BookingChip({ status, money }: { status: BookingStatus; money?: Money }) {
  return <Chip {...bookingState(status, money)} />;
}
