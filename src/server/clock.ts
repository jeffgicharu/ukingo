// The one place the application asks what time it is.
//
// Almost every rule here depends on the date: what can be booked, what is
// due, what a cancellation returns. Code takes the moment from this clock (or
// is handed it) and never from `new Date()` directly, so the tests can run
// each rule at the exact moment that matters.

let pinned: Date | undefined;

export const clock = {
  now(): Date {
    return pinned ? new Date(pinned) : new Date();
  },

  /** Tests only: hold the clock at one moment. */
  pin(moment: Date): void {
    pinned = new Date(moment);
  },

  /** Tests only: let the clock run again. */
  release(): void {
    pinned = undefined;
  },
};
