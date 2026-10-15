// What each member of staff may do.
//
// A role limits both what staff see and what they can do. The screens ask
// `may()` before showing a control, and every function that changes anything
// asks `must()` before doing it, so a hidden button is also a refused request.

import type { StaffRole } from "@/server/db/schema";

export type Staff = {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
  /** A training account works bookings on sample data and cannot change how the lodge is set up. */
  training: boolean;
};

export type Ability =
  // The day-to-day work of the desk.
  | "bookings.view"
  | "bookings.make"
  | "bookings.change" // dates, room, extras, notes
  | "bookings.cancel"
  | "bookings.check_in_out"
  | "payments.take"
  | "calendar.block"
  | "guests.view"
  | "guests.edit"
  | "guests.forget" // removing a guest's details at their request
  | "messages.view"
  // Decisions about money beyond the booking's own terms.
  | "refunds.override"
  | "refunds.send"
  | "bill.adjust"
  // How the lodge is set up.
  | "rates.edit"
  | "rules.edit"
  | "content.edit"
  | "settings.edit"
  | "staff.manage";

const DESK: Ability[] = [
  "bookings.view",
  "bookings.make",
  "bookings.change",
  "bookings.cancel",
  "bookings.check_in_out",
  "payments.take",
  "calendar.block",
  "guests.view",
  "guests.edit",
  "messages.view",
];

const MANAGER: Ability[] = [
  ...DESK,
  "refunds.override",
  "refunds.send",
  "bill.adjust",
  "guests.forget",
  "rates.edit",
  "rules.edit",
  "content.edit",
];

const BY_ROLE: Record<StaffRole, ReadonlySet<Ability>> = {
  front_desk: new Set(DESK),
  reservations: new Set(MANAGER),
  owner: new Set<Ability>([...MANAGER, "settings.edit", "staff.manage"]),
};

/** Changing how the lodge is set up. A training account may look at all of it and change none of it. */
const SETUP: ReadonlySet<Ability> = new Set([
  "rates.edit",
  "rules.edit",
  "content.edit",
  "settings.edit",
  "staff.manage",
]);

export const ROLE_NAMES: Record<StaffRole, string> = {
  owner: "Owner",
  reservations: "Reservations manager",
  front_desk: "Front desk",
};

/** May this person see the screens for this? */
export function maySee(staff: Staff, ability: Ability): boolean {
  return BY_ROLE[staff.role].has(ability);
}

/** May this person do this? */
export function may(staff: Staff, ability: Ability): boolean {
  if (!BY_ROLE[staff.role].has(ability)) return false;
  if (staff.training && SETUP.has(ability)) return false;
  return true;
}

export class NotAllowed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAllowed";
  }
}

/** Refuses, with a plain reason, anything this person may not do. */
export function must(staff: Staff, ability: Ability): void {
  if (!BY_ROLE[staff.role].has(ability)) {
    throw new NotAllowed(`Your role (${ROLE_NAMES[staff.role]}) does not allow that. Ask a manager.`);
  }
  if (staff.training && SETUP.has(ability)) {
    throw new NotAllowed(
      "Training accounts work bookings on sample data. They cannot change rooms, photographs, prices, rules, pages, settings or staff.",
    );
  }
}
