// The tables, described for typed queries. The tables themselves are created
// by the SQL files in /migrations, which are the source of truth.

import {
  bigint,
  boolean,
  customType,
  date,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { Stay } from "@/lib/dates";

/** PostgreSQL's daterange, read and written as arrival and departure dates. */
export const nights = customType<{ data: Stay; driverData: string }>({
  dataType() {
    return "daterange";
  },
  toDriver(stay) {
    return `[${stay.from},${stay.to})`;
  },
  fromDriver(value) {
    return parseDateRange(value);
  },
});

export function parseDateRange(value: string): Stay {
  const match = /^[[(]([^,]*),([^\])]*)[\])]$/.exec(value);
  if (!match) throw new Error(`Not a date range: ${value}`);
  return { from: match[1], to: match[2] };
}

const moment = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const cents = (name: string) => bigint(name, { mode: "number" });
const id = (name = "id") => integer(name).primaryKey().generatedAlwaysAsIdentity();
const bigId = (name = "id") => bigint(name, { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

export type CancellationStep = { min_days: number; keep_percent: number };

export const settings = pgTable("settings", {
  id: boolean("id").primaryKey().default(true),
  lodgeName: text("lodge_name").notNull(),
  place: text("place").notNull(),
  checkInFrom: text("check_in_from").notNull(),
  checkOutBy: text("check_out_by").notNull(),
  holdMinutes: integer("hold_minutes").notNull(),
  provisionalHours: integer("provisional_hours").notNull(),
  depositPercent: integer("deposit_percent").notNull(),
  balanceDueDays: integer("balance_due_days").notNull(),
  changeUntilDays: integer("change_until_days").notNull(),
  cancellationSteps: jsonb("cancellation_steps").$type<CancellationStep[]>().notNull(),
  bookingWindowMonths: integer("booking_window_months").notNull(),
  sameDayUntilHour: integer("same_day_until_hour").notNull(),
  maxNights: integer("max_nights").notNull(),
  updatedAt: moment("updated_at").notNull().defaultNow(),
});

export const roomTypes = pgTable("room_types", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  sleeps: integer("sleeps").notNull(),
  bedrooms: integer("bedrooms").notNull().default(1),
  beds: text("beds").notNull().default(""),
  sizeSqm: integer("size_sqm"),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const rooms = pgTable("rooms", {
  id: id(),
  roomTypeId: integer("room_type_id")
    .notNull()
    .references(() => roomTypes.id),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const seasons = pgTable("seasons", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  position: integer("position").notNull().default(0),
});

export const seasonDates = pgTable("season_dates", {
  id: id(),
  seasonId: integer("season_id")
    .notNull()
    .references(() => seasons.id, { onDelete: "cascade" }),
  dates: nights("dates").notNull(),
  label: text("label").notNull().default(""),
});

export const rates = pgTable(
  "rates",
  {
    roomTypeId: integer("room_type_id")
      .notNull()
      .references(() => roomTypes.id, { onDelete: "cascade" }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    weeknightCents: cents("weeknight_cents").notNull(),
    weekendCents: cents("weekend_cents").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roomTypeId, table.seasonId] })],
);

export const stayRules = pgTable("stay_rules", {
  id: id(),
  dates: nights("dates").notNull(),
  minNights: integer("min_nights").notNull(),
  label: text("label").notNull(),
});

export const mealPlans = pgTable("meal_plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  adultCents: cents("adult_cents").notNull(),
  childCents: cents("child_cents").notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const extras = pgTable("extras", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  duration: text("duration").notNull().default(""),
  priceCents: cents("price_cents").notNull(),
  charged: text("charged").$type<"per_person" | "per_booking">().notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export type StaffRole = "owner" | "reservations" | "front_desk";

export const staff = pgTable("staff", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<StaffRole>().notNull(),
  active: boolean("active").notNull().default(true),
  training: boolean("training").notNull().default(false),
  createdAt: moment("created_at").notNull().defaultNow(),
  lastSignInAt: moment("last_sign_in_at"),
});

export const staffSessions = pgTable("staff_sessions", {
  id: text("id").primaryKey(),
  staffId: integer("staff_id")
    .notNull()
    .references(() => staff.id, { onDelete: "cascade" }),
  createdAt: moment("created_at").notNull(),
  lastSeenAt: moment("last_seen_at").notNull(),
  expiresAt: moment("expires_at").notNull(),
  ip: inet("ip"),
  userAgent: text("user_agent").notNull().default(""),
});

export const signInAttempts = pgTable("sign_in_attempts", {
  id: bigId(),
  email: text("email").notNull(),
  ip: inet("ip"),
  at: moment("at").notNull(),
  succeeded: boolean("succeeded").notNull(),
});

export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  staffId: integer("staff_id")
    .notNull()
    .references(() => staff.id, { onDelete: "cascade" }),
  createdAt: moment("created_at").notNull(),
  expiresAt: moment("expires_at").notNull(),
  usedAt: moment("used_at"),
});

export const guests = pgTable("guests", {
  id: bigId(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  notes: text("notes").notNull().default(""),
  sample: boolean("sample").notNull().default(false),
  createdAt: moment("created_at").notNull(),
});

export type BookingStatus =
  "held" | "provisional" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired" | "no_show";

/** The rules a booking was made under, fixed as dates and amounts. */
export type BookingTerms = {
  deposit_percent: number;
  deposit_cents: number;
  /** The balance is due by the end of this day. Null when everything was due at booking. */
  balance_due: string | null;
  /** Dates can be changed up to and including this day. Null when it has already passed. */
  change_until: string | null;
  /** In order. A cancellation on or before `until` keeps `keep_percent` of the total. */
  cancellation: { until: string | null; keep_percent: number }[];
  /**
   * The rules themselves, as day counts, so that the dates above can be
   * worked out again from the same rules if the stay is moved.
   */
  policy: {
    deposit_percent: number;
    balance_due_days: number;
    change_until_days: number;
    cancellation_steps: CancellationStep[];
  };
};

export const bookings = pgTable("bookings", {
  id: bigId(),
  reference: text("reference").notNull().unique(),
  linkVersion: integer("link_version").notNull().default(1),
  requestKey: text("request_key").unique(),
  guestId: bigint("guest_id", { mode: "number" })
    .notNull()
    .references(() => guests.id),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone").notNull(),
  guestEmail: text("guest_email"),
  roomTypeId: integer("room_type_id")
    .notNull()
    .references(() => roomTypes.id),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id),
  stay: nights("stay").notNull(),
  adults: integer("adults").notNull(),
  children: integer("children").notNull().default(0),
  mealPlan: text("meal_plan")
    .notNull()
    .references(() => mealPlans.code),
  arrivalTime: text("arrival_time").notNull().default(""),
  requests: text("requests").notNull().default(""),
  status: text("status").$type<BookingStatus>().notNull(),
  source: text("source").$type<"website" | "desk">().notNull(),
  holdUntil: moment("hold_until"),
  totalCents: cents("total_cents").notNull(),
  terms: jsonb("terms").$type<BookingTerms>().notNull(),
  createdBy: integer("created_by").references(() => staff.id),
  createdAt: moment("created_at").notNull(),
  confirmedAt: moment("confirmed_at"),
  checkedInAt: moment("checked_in_at"),
  checkedOutAt: moment("checked_out_at"),
  cancelledAt: moment("cancelled_at"),
  endedReason: text("ended_reason"),
  originIp: inet("origin_ip"),
  sample: boolean("sample").notNull().default(false),
});

export const allocations = pgTable("allocations", {
  id: bigId(),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id),
  stay: nights("stay").notNull(),
  bookingId: bigint("booking_id", { mode: "number" })
    .unique()
    .references(() => bookings.id, { onDelete: "cascade" }),
  blockReason: text("block_reason"),
  createdBy: integer("created_by").references(() => staff.id),
  createdAt: moment("created_at").notNull(),
});

export const bookingNights = pgTable(
  "booking_nights",
  {
    bookingId: bigint("booking_id", { mode: "number" })
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    night: date("night", { mode: "string" }).notNull(),
    cents: cents("cents").notNull(),
    season: text("season").notNull(),
  },
  (table) => [primaryKey({ columns: [table.bookingId, table.night] })],
);

export type ChargeKind = "meals" | "extra" | "adjustment";

export const bookingCharges = pgTable("booking_charges", {
  id: bigId(),
  bookingId: bigint("booking_id", { mode: "number" })
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ChargeKind>().notNull(),
  label: text("label").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitCents: cents("unit_cents").notNull(),
  cents: cents("cents").notNull(),
  extraId: integer("extra_id").references(() => extras.id),
  createdBy: integer("created_by").references(() => staff.id),
  createdAt: moment("created_at").notNull(),
});

export type PaymentMethod = "mpesa_prompt" | "test" | "mpesa_desk" | "cash" | "bank";
export type PaymentStatus = "pending" | "paid" | "failed";
export type PaymentFailure =
  "cancelled" | "timeout" | "wrong_pin" | "insufficient_funds" | "unreachable" | "limit" | "other";

export const payments = pgTable("payments", {
  id: bigId(),
  bookingId: bigint("booking_id", { mode: "number" })
    .notNull()
    .references(() => bookings.id),
  method: text("method").$type<PaymentMethod>().notNull(),
  cents: cents("cents").notNull(),
  promptCents: cents("prompt_cents"),
  phone: text("phone"),
  status: text("status").$type<PaymentStatus>().notNull(),
  failure: text("failure").$type<PaymentFailure>(),
  failureDetail: text("failure_detail"),
  checkoutRequestId: text("checkout_request_id").unique(),
  merchantRequestId: text("merchant_request_id"),
  callbackKey: text("callback_key"),
  receipt: text("receipt"),
  requestedAt: moment("requested_at").notNull(),
  settledAt: moment("settled_at"),
  statusChecks: integer("status_checks").notNull().default(0),
  checkedAt: moment("checked_at"),
  recordedBy: integer("recorded_by").references(() => staff.id),
  originIp: inet("origin_ip"),
});

export const refunds = pgTable("refunds", {
  id: bigId(),
  bookingId: bigint("booking_id", { mode: "number" })
    .notNull()
    .references(() => bookings.id),
  cents: cents("cents").notNull(),
  reason: text("reason").notNull(),
  status: text("status").$type<"owed" | "sent">().notNull(),
  createdAt: moment("created_at").notNull(),
  sentAt: moment("sent_at"),
  sentBy: integer("sent_by").references(() => staff.id),
  reference: text("reference"),
});

export type Actor = "guest" | "staff" | "system";

export const bookingEvents = pgTable("booking_events", {
  id: bigId(),
  bookingId: bigint("booking_id", { mode: "number" })
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  at: moment("at").notNull(),
  actor: text("actor").$type<Actor>().notNull(),
  staffId: integer("staff_id").references(() => staff.id),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
});

export const bookingNotes = pgTable("booking_notes", {
  id: bigId(),
  bookingId: bigint("booking_id", { mode: "number" })
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  staffId: integer("staff_id")
    .notNull()
    .references(() => staff.id),
  body: text("body").notNull(),
  createdAt: moment("created_at").notNull(),
});

export type MessageStatus = "queued" | "sent" | "failed" | "not_sent";

export const messages = pgTable("messages", {
  id: bigId(),
  bookingId: bigint("booking_id", { mode: "number" }).references(() => bookings.id, { onDelete: "cascade" }),
  guestId: bigint("guest_id", { mode: "number" }).references(() => guests.id, { onDelete: "set null" }),
  channel: text("channel").$type<"email" | "sms">().notNull(),
  kind: text("kind").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject"),
  html: text("html"),
  body: text("body").notNull(),
  status: text("status").$type<MessageStatus>().notNull(),
  statusReason: text("status_reason"),
  onceKey: text("once_key").unique(),
  providerId: text("provider_id"),
  originIp: inet("origin_ip"),
  createdAt: moment("created_at").notNull(),
  sentAt: moment("sent_at"),
});

export const pages = pgTable("pages", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  body: text("body").notNull(),
  draftTitle: text("draft_title"),
  draftSummary: text("draft_summary"),
  draftBody: text("draft_body"),
  position: integer("position").notNull().default(0),
  updatedAt: moment("updated_at").notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => staff.id),
});

export const questions = pgTable("questions", {
  id: id(),
  topic: text("topic").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  position: integer("position").notNull().default(0),
});

export const siteText = pgTable("site_text", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  position: integer("position").notNull().default(0),
  updatedAt: moment("updated_at").notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  key: text("key").primaryKey(),
  lastSentAt: moment("last_sent_at").notNull(),
  times: integer("times").notNull().default(1),
});
