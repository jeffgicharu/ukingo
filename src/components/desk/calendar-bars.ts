// What the calendar draws, and how each state of a booking looks on it. Kept apart from the grid
// itself because the page that builds the bars runs on the server and the grid runs in the browser.

import type { Day } from "@/lib/dates";

export type BarState = "held" | "awaiting" | "deposit" | "paid" | "in_house" | "departed" | "block";

export type CalendarBar = {
  key: string;
  allocationId: number;
  roomId: number;
  from: Day;
  to: Day;
  /** Null for a room taken off sale. */
  bookingId: number | null;
  /** The guest's name, or why the room is off sale. */
  label: string;
  /** Said to a screen reader and shown on hover: the state, the reference, the nights. */
  detail: string;
  state: BarState;
  /** How far staff may drag it: to any room and dates, to another room only, or not at all. */
  move: "anywhere" | "room" | "none";
};

export type CalendarRow = { id: number; name: string; typeName: string; sleeps: number };

export const BAR_LOOKS: Record<BarState, { name: string; className: string }> = {
  held: { name: "Paying now", className: "border border-dashed border-ember-600 bg-ember-100 text-ember-800" },
  awaiting: { name: "Awaiting deposit", className: "bg-ember-300 text-night-950" },
  deposit: { name: "Deposit paid", className: "bg-night-200 text-night-950" },
  paid: { name: "Paid in full", className: "bg-moss-600 text-white" },
  in_house: { name: "In house", className: "bg-night-900 text-mist-50" },
  departed: { name: "Departed", className: "bg-mist-200 text-ink-soft" },
  block: {
    name: "Off sale",
    className:
      "bg-[repeating-linear-gradient(135deg,var(--color-mist-200)_0_6px,var(--color-mist-100)_6px_12px)] text-ink-soft ring-1 ring-inset ring-mist-300",
  },
};
