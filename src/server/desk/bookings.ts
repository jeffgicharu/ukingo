// Finding bookings for the back office's lists and screens.

import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import { type Day, isDay, lodgeDay } from "@/lib/dates";
import { maskEmail, maskPhone, normalisePhone } from "@/lib/format";
import { moneyOfMany, type Money } from "@/server/booking/ledger";
import { readReference } from "@/server/booking/links";
import type { Booking } from "@/server/booking/service";
import { db, schema } from "@/server/db";
import type { BookingStatus } from "@/server/db/schema";
import type { Staff } from "@/server/staff/permissions";

export const STATE_FILTERS = {
  coming: { label: "Coming", statuses: ["confirmed", "provisional"] },
  in_house: { label: "In house", statuses: ["checked_in"] },
  awaiting: { label: "Awaiting payment", statuses: ["provisional", "held"] },
  departed: { label: "Departed", statuses: ["checked_out"] },
  ended: { label: "Cancelled or lapsed", statuses: ["cancelled", "expired", "no_show"] },
  all: { label: "All", statuses: [] },
} satisfies Record<string, { label: string; statuses: BookingStatus[] }>;

export type StateFilter = keyof typeof STATE_FILTERS;

export type BookingFilters = {
  q: string;
  state: StateFilter;
  roomType: number | null;
  from: Day | null;
  to: Day | null;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export function readBookingFilters(params: Params): BookingFilters {
  const state = one(params.state);
  const from = one(params.from);
  const to = one(params.to);
  const roomType = Number(one(params.type));
  return {
    q: one(params.q).trim().slice(0, 80),
    state: state in STATE_FILTERS ? (state as StateFilter) : "coming",
    roomType: Number.isInteger(roomType) && roomType > 0 ? roomType : null,
    from: isDay(from) ? from : null,
    to: isDay(to) ? to : null,
    page: Math.max(1, Number(one(params.page)) || 1),
  };
}

export type ListedBooking = { booking: Booking; roomName: string; roomTypeName: string; money: Money };

export const PAGE_SIZE = 25;

export async function listBookings(filters: BookingFilters): Promise<{ rows: ListedBooking[]; total: number }> {
  const b = schema.bookings;
  const where: SQL[] = [];

  // A search looks everywhere: someone on the phone may be asking about a stay long past.
  const searching = filters.q !== "";
  if (!searching) {
    const statuses = STATE_FILTERS[filters.state].statuses;
    if (statuses.length) where.push(inArray(b.status, statuses));
  } else {
    const reference = readReference(filters.q);
    const phone = normalisePhone(filters.q);
    const digits = filters.q.replace(/\D/g, "");
    where.push(
      or(
        ilike(b.guestName, `%${filters.q.replace(/[%_]/g, "")}%`),
        reference ? eq(b.reference, reference) : undefined,
        phone ? eq(b.guestPhone, phone) : undefined,
        digits.length >= 4 ? ilike(b.guestPhone, `%${digits.replace(/^0/, "")}%`) : undefined,
        filters.q.includes("@") ? eq(b.guestEmail, filters.q.toLowerCase()) : undefined,
      )!,
    );
  }
  if (filters.roomType) where.push(eq(b.roomTypeId, filters.roomType));
  if (filters.from) where.push(gte(sql`lower(${b.stay})`, sql`${filters.from}::date`));
  if (filters.to) where.push(lt(sql`lower(${b.stay})`, sql`(${filters.to}::date + 1)`));

  const condition = where.length ? and(...where) : undefined;
  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(b)
    .where(condition);

  // Bookings still ahead read soonest first. Ones that are over read newest first.
  const backwards =
    !searching && (filters.state === "departed" || filters.state === "ended" || filters.state === "all");
  const rows = await db()
    .select({ booking: b, roomName: schema.rooms.name, roomTypeName: schema.roomTypes.name })
    .from(b)
    .innerJoin(schema.rooms, eq(schema.rooms.id, b.roomId))
    .innerJoin(schema.roomTypes, eq(schema.roomTypes.id, b.roomTypeId))
    .where(condition)
    .orderBy(backwards || searching ? desc(sql`lower(${b.stay})`) : asc(sql`lower(${b.stay})`), asc(b.id))
    .limit(PAGE_SIZE)
    .offset((filters.page - 1) * PAGE_SIZE);

  const money = await moneyOfMany(
    db(),
    rows.map((row) => row.booking),
  );
  return { rows: rows.map((row) => ({ ...row, money: money.get(row.booking.id)! })), total };
}

export async function bookingById(id: number): Promise<Booking | null> {
  if (!Number.isInteger(id)) return null;
  const [booking] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, id));
  return booking ?? null;
}

/**
 * A guest's phone number as this member of staff may see it. Training
 * accounts are open to anyone trying the system out, so they see real
 * visitors' details with the middle hidden. Sample guests are invented and
 * are shown in full.
 */
export function phoneFor(staff: Staff, subject: { phone: string; sample: boolean }): string {
  // A guest who asked to be forgotten has no number.
  if (subject.phone === "") return "None kept";
  return staff.training && !subject.sample ? maskPhone(subject.phone) : formatShown(subject.phone);
}

export function emailFor(staff: Staff, subject: { email: string | null; sample: boolean }): string | null {
  if (!subject.email) return null;
  return staff.training && !subject.sample ? maskEmail(subject.email) : subject.email;
}

/** A name, likewise: the first name and an initial for a real visitor seen from a training account. */
export function nameFor(staff: Staff, subject: { name: string; sample: boolean }): string {
  if (!staff.training || subject.sample) return subject.name;
  const [first, ...rest] = subject.name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
}

function formatShown(phone: string): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : phone;
}

export function todayAtLodge(now: Date): Day {
  return lodgeDay(now);
}

export async function historyOf(bookingId: number) {
  const events = await db()
    .select({
      id: schema.bookingEvents.id,
      at: schema.bookingEvents.at,
      actor: schema.bookingEvents.actor,
      summary: schema.bookingEvents.summary,
      staffName: schema.staff.name,
    })
    .from(schema.bookingEvents)
    .leftJoin(schema.staff, eq(schema.staff.id, schema.bookingEvents.staffId))
    .where(eq(schema.bookingEvents.bookingId, bookingId))
    .orderBy(desc(schema.bookingEvents.at), desc(schema.bookingEvents.id));

  const notes = await db()
    .select({
      id: schema.bookingNotes.id,
      body: schema.bookingNotes.body,
      createdAt: schema.bookingNotes.createdAt,
      staffName: schema.staff.name,
    })
    .from(schema.bookingNotes)
    .innerJoin(schema.staff, eq(schema.staff.id, schema.bookingNotes.staffId))
    .where(eq(schema.bookingNotes.bookingId, bookingId))
    .orderBy(desc(schema.bookingNotes.createdAt));

  const messages = await db()
    .select({
      id: schema.messages.id,
      channel: schema.messages.channel,
      kind: schema.messages.kind,
      subject: schema.messages.subject,
      status: schema.messages.status,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(eq(schema.messages.bookingId, bookingId))
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id));

  return { events, notes, messages };
}
