// The books of a lodge kept for training.
//
// A training lodge is one where people learn the back office on bookings
// that belong to nobody. Its books are thrown away and written again every
// night: six months of past stays and four months of bookings to come, laid
// out around today's date, so every screen has something to work on.
//
// The stays themselves are fixed in the calendar: the same invented guest
// has the same room on the same nights whichever day the books are written.
// What changes from one day to the next is how far each booking has got.
// A guest who was due tomorrow is in the house the day after.

import { sql } from "drizzle-orm";

import { type Day, type Stay, addDays, daysBetween, lodgeDay, lodgeHour, lodgeMoment, weekday } from "@/lib/dates";
import { formatDay, formatMoney, plural } from "@/lib/format";
import { newReference } from "@/server/booking/links";
import { quote } from "@/server/booking/pricing";
import { refundOnCancel, termsFor } from "@/server/booking/rules";
import { touchDesk } from "@/server/booking/service";
import { db, schema, type Tx } from "@/server/db";
import type { BookingStatus, BookingTerms, PaymentMethod } from "@/server/db/schema";
import { forgetCatalogue, loadCatalogue, type Catalogue, type RoomType } from "@/server/lodge/catalogue";
import { hashPassword } from "@/server/staff/passwords";

/** Days of history kept, and days of bookings ahead. */
const BACK = 183;
const AHEAD = 122;
/** A Monday. Stays are laid out from here, so they fall on the same nights whenever the books are written. */
const ANCHOR: Day = "2026-01-05";
/**
 * Invented guests are numbered, and the number makes their phone number and
 * address. Each room has a run of numbers for its own guests, and the day's
 * set pieces have a run above them all.
 */
const GUESTS_A_ROOM = 2_000;
const SET_PIECE_GUESTS = 30_000;

export const TRAINING_STAFF = [
  { key: "reservations", name: "Wambui Kariuki", email: "wambui@ukingo.example", role: "reservations" },
  { key: "front-desk", name: "Brian Otieno", email: "brian@ukingo.example", role: "front_desk" },
] as const;

const FIRST = [
  "Wanjiru", "Otieno", "Achieng", "Kamau", "Njeri", "Mutua", "Akinyi", "Kiprono", "Wairimu", "Omondi",
  "Chebet", "Mwangi", "Nyambura", "Barasa", "Atieno", "Kiptoo", "Wambui", "Odhiambo", "Jepkoech", "Gitau",
  "Naliaka", "Mutiso", "Adhiambo", "Kibet", "Muthoni", "Wekesa", "Awino", "Kariuki", "Cherono", "Njoroge",
  "Halima", "Abdi", "Amina", "Salim", "Zawadi", "Baraka", "Neema", "Juma", "Makena", "Kirimi",
  "Sarah", "David", "Grace", "Peter", "Anne", "James", "Ruth", "Daniel", "Esther", "Samuel",
]; // prettier-ignore
const LAST = [
  "Kamau", "Odhiambo", "Mwangi", "Chebet", "Wanjiku", "Mutua", "Otieno", "Kiprotich", "Njoroge", "Wekesa",
  "Achieng", "Karanja", "Musyoka", "Rotich", "Nyaga", "Ouma", "Kimani", "Simiyu", "Koech", "Maina",
  "Ndungu", "Owino", "Kirui", "Wafula", "Gathoni", "Mbugua", "Onyango", "Langat", "Muriuki", "Hassan",
  "Mohamed", "Ali", "Mwende", "Kiplagat", "Gachanja", "Okello", "Jeptoo", "Macharia", "Nduta", "Were",
]; // prettier-ignore

const REQUESTS = [
  "",
  "",
  "",
  "",
  "A cot for the baby, please.",
  "Vegetarian dinners for one of us.",
  "It is our anniversary.",
  "We will arrive late, after dinner.",
  "A birthday on the Saturday.",
  "No nuts in the kitchen, please.",
];
const ARRIVALS = ["", "", "Before 2 pm", "2 pm to 5 pm", "2 pm to 5 pm", "5 pm to 8 pm"];

/** A small repeatable source of chance: the same seed gives the same lodge. */
function chance(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** A whole number from `low` to `high`, both included. */
    between: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    /** One of several outcomes, each with its own weight. */
    weighted: <T>(options: readonly (readonly [T, number])[]): T => {
      const total = options.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of options) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return options[options.length - 1][0];
    },
  };
}

type Planned = {
  room: { id: number; name: string };
  type: RoomType;
  stay: Stay;
  /** The moment the booking was made. */
  made: Date;
  guest: number;
  adults: number;
  children: number;
  mealPlan: string;
  extraIds: number[];
  byPhone: boolean;
  cancelsOn: Day | null;
  noShow: boolean;
  /** Pays the balance on arrival, not when it falls due. */
  paysLate: boolean;
  /** Orders something during the stay and settles it on leaving. */
  ordersAtLodge: boolean;
  /** Has left by breakfast on the last morning, or arrives before the afternoon. */
  early: boolean;
  requests: string;
  arrivalTime: string;
};

const overlaps = (a: Stay, b: Stay) => a.from < b.to && b.from < a.to;

/** Every stay the calendar holds for one room, from the anchor to the end of the window. */
function staysOf(
  room: { id: number; name: string },
  /** Where the room comes in the lodge's list, from 0. Guests are numbered from it. */
  order: number,
  type: RoomType,
  lodge: Catalogue,
  until: Day,
): Planned[] {
  const roll = chance(room.id * 7919 + 104729);
  const big = type.sleeps >= 8;
  const family = type.sleeps >= 4 && !big;
  const out: Planned[] = [];
  let day = addDays(ANCHOR, roll.between(0, 3));

  while (day < until) {
    let from = addDays(
      day,
      roll.weighted(
        big
          ? ([[2, 2], [4, 3], [6, 3], [9, 2]] as const)
          : ([[0, 34], [1, 26], [2, 18], [3, 12], [5, 10]] as const),
      ), // prettier-ignore
    );
    // People come for weekends: a stay that would start early in the week is often pushed to Thursday or Friday.
    const dow = weekday(from);
    if (dow >= 0 && dow <= 3 && roll.next() < 0.4) from = addDays(from, (roll.next() < 0.5 ? 4 : 5) - dow);

    const nights = roll.weighted(
      big || family
        ? ([[2, 45], [3, 35], [4, 20]] as const)
        : ([[1, 20], [2, 42], [3, 25], [4, 9], [5, 4]] as const),
    ); // prettier-ignore
    const stay = { from, to: addDays(from, nights) };

    const lead = 2 + Math.floor(roll.next() ** 2 * 72);
    const made = lodgeMoment(addDays(from, -lead), roll.between(7, 21), roll.between(0, 59));
    const adults = big ? roll.between(4, 6) : family ? 2 : roll.weighted([[2, 86], [1, 14]] as const); // prettier-ignore
    const children = big ? roll.between(0, 2) : family ? roll.between(1, 2) : 0;
    const cancels = roll.next() < 0.06 && lead >= 4;
    // Now and then a guest comes back to the room they liked: one stay in five is somebody's second or third.
    const comesBack = roll.next() < 0.2 && out.length > 3;
    const guest = comesBack
      ? out[out.length - roll.between(3, Math.min(30, out.length))].guest
      : order * GUESTS_A_ROOM + out.length;

    out.push({
      room,
      type,
      stay,
      made,
      guest,
      adults,
      children,
      mealPlan: roll.weighted([["bed_and_breakfast", 58], ["half_board", 30], ["full_board", 12]] as const), // prettier-ignore
      extraIds: lodge.extras.filter(() => roll.next() < 0.14).map((extra) => extra.id),
      byPhone: roll.next() < 0.2,
      cancelsOn: cancels ? addDays(lodgeDay(made), roll.between(1, lead - 1)) : null,
      noShow: roll.next() < 0.012,
      paysLate: roll.next() < 0.1,
      ordersAtLodge: roll.next() < 0.16,
      early: roll.next() < 0.4,
      requests: roll.pick(REQUESTS),
      arrivalTime: roll.pick(ARRIVALS),
    });
    day = stay.to;
  }
  return out;
}

/** Throws away the training lodge's books and writes them again around today. */
export async function rebuildTraining(now: Date): Promise<{ bookings: number; guests: number }> {
  const today = lodgeDay(now);
  const first = addDays(today, -BACK);
  const last = addDays(today, AHEAD);

  const written = await db().transaction(async (tx) => {
    // Everything a visitor or a trainee did yesterday goes, and with it every detail anyone typed in.
    await tx.execute(sql`
      TRUNCATE refunds, payments, messages, booking_notes, booking_events, booking_charges, booking_nights,
        allocations, bookings, guests, password_resets
      RESTART IDENTITY CASCADE
    `);
    const staff = await trainingStaff(tx);
    await tx.execute(sql`DELETE FROM staff_sessions WHERE staff_id IN (SELECT id FROM staff WHERE training)`);

    const lodge = await loadCatalogue(tx);
    const rooms = lodge.roomTypes.flatMap((type) => type.rooms.map((room) => ({ room, type })));

    // Whatever else is going on, today has people to greet, people to see off and people in the house,
    // and each list that asks for attention has something in it. These few are written first.
    const set = setPieces(rooms, today, now);
    const clear = (plan: { room: { id: number }; stay: Stay }) =>
      !set.plans.some(
        (piece) => piece.holdsRoom && piece.room.id === plan.room.id && overlaps(piece.stay, plan.stay),
      ) && !(set.repair && set.repair.room.id === plan.room.id && overlaps(set.repair.stay, plan.stay));

    // Then the calendar's fixed stays, kept where they touch the window and have been booked by now.
    const plans: Planned[] = set.plans.map(({ holdsRoom: _holds, ...plan }) => plan);
    for (const [order, { room, type }] of rooms.entries()) {
      for (const stay of staysOf(room, order, type, lodge, last)) {
        if (stay.stay.to <= first || stay.made > now || !clear(stay)) continue;
        plans.push(stay);
      }
    }

    const guests = await writeGuests(tx, plans, now);
    const count = await writeBookings(tx, lodge, plans, guests, staff, now);

    // A room off sale next week, so the calendar shows what that looks like.
    if (set.repair) {
      await tx.insert(schema.allocations).values({
        roomId: set.repair.room.id,
        stay: set.repair.stay,
        blockReason: "Chimney swept and the roof checked",
        createdBy: staff.get("reservations") ?? null,
        createdAt: lodgeMoment(addDays(today, -3), 10, 15),
      });
    }
    return { bookings: count, guests: guests.size };
  });

  forgetCatalogue();
  await touchDesk();
  return written;
}

type Place = { room: { id: number; name: string }; type: RoomType };

/**
 * The handful of bookings every day is given, whatever the calendar holds:
 * two arrivals, two departures, guests in the house, a balance that is late,
 * a phone booking about to lapse, a refund to send, and a booking with a
 * balance for a guest to pay. They move round the rooms from day to day.
 */
function setPieces(
  rooms: Place[],
  today: Day,
  now: Date,
): { plans: (Planned & { holdsRoom: boolean })[]; repair: { room: Place["room"]; stay: Stay } | null } {
  const small = rooms.filter((entry) => entry.type.sleeps === 2);
  const family = rooms.filter((entry) => entry.type.sleeps === 4);
  if (small.length < 6) return { plans: [], repair: null };

  const turn = daysBetween(ANCHOR, today);
  const room = (position: number) => small[(turn + position) % small.length];
  const morning = (daysAgo: number, hour = 10) => lodgeMoment(addDays(today, -daysAgo), hour, 15);
  const days = (from: number, to: number): Stay => ({ from: addDays(today, from), to: addDays(today, to) });

  const piece = (
    place: Place,
    stay: Stay,
    made: Date,
    number: number,
    extra: Partial<Planned> = {},
  ): Planned & { holdsRoom: boolean } => ({
    room: place.room,
    type: place.type,
    stay,
    made,
    // A different guest each day, and never one of the calendar's own.
    guest: SET_PIECE_GUESTS + ((turn * 20 + number) % 60_000),
    adults: 2,
    children: place.type.sleeps >= 4 ? 2 : 0,
    mealPlan: "half_board",
    extraIds: [],
    byPhone: false,
    cancelsOn: null,
    noShow: false,
    paysLate: false,
    ordersAtLodge: false,
    early: false,
    requests: "",
    arrivalTime: "2 pm to 5 pm",
    ...extra,
    holdsRoom: !extra.cancelsOn,
  });

  const plans = [
    piece(room(0), days(0, 2), morning(9), 1, { requests: "It is our anniversary." }),
    piece(room(1), days(0, 3), morning(21), 2, { mealPlan: "bed_and_breakfast", arrivalTime: "5 pm to 8 pm" }),
    piece(room(2), days(-2, 0), morning(12), 3),
    piece(room(3), days(-3, 0), morning(30), 4, { mealPlan: "full_board", ordersAtLodge: true }),
    piece(room(4), days(-1, 2), morning(15), 5, { ordersAtLodge: true }),
    piece(room(5), days(-2, 1), morning(18), 6, { mealPlan: "bed_and_breakfast" }),
    // A balance that should have been paid five days ago.
    piece(room(2), days(9, 12), morning(34), 7, { paysLate: true }),
    // Taken on the phone yesterday afternoon. Its deposit has until this evening.
    piece(room(3), days(12, 14), new Date(now.getTime() - 20 * 3_600_000), 8, { byPhone: true }),
    // Cancelled yesterday, well ahead of the stay, with the deposit to send back.
    piece(room(4), days(40, 43), morning(11), 9, { cancelsOn: addDays(today, -1) }),
    // Three weeks out, deposit paid, balance still to pay: the booking a visitor is shown as a guest.
    piece(room(5), days(23, 26), morning(6), 10, { mealPlan: "bed_and_breakfast" }),
  ];
  if (family.length) {
    plans.push(
      piece(family[turn % family.length], days(-1, 2), morning(25), 11, { requests: "A cot for the baby, please." }),
    );
  }
  return { plans, repair: { room: room(0).room, stay: days(6, 8) } };
}

/** The accounts trainees sign in with. They exist only on a training lodge, and have no password anyone knows. */
async function trainingStaff(tx: Tx): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const person of TRAINING_STAFF) {
    const [row] = await tx
      .insert(schema.staff)
      .values({
        name: person.name,
        email: person.email,
        role: person.role,
        training: true,
        // Nobody signs in to these with a password, so the password is one nobody has.
        passwordHash: await hashPassword(`${newReference()}-${newReference()}-${newReference()}`),
      })
      .onConflictDoUpdate({
        target: schema.staff.email,
        set: { name: person.name, role: person.role, training: true, active: true },
      })
      .returning({ id: schema.staff.id });
    ids.set(person.key, row.id);
  }
  return ids;
}

async function writeGuests(
  tx: Tx,
  plans: Planned[],
  now: Date,
): Promise<Map<number, { id: number; name: string; phone: string; email: string }>> {
  const keys = [...new Set(plans.map((plan) => plan.guest))];
  const people = keys.map((key) => {
    const roll = chance(key * 31 + 17);
    const name = `${roll.pick(FIRST)} ${roll.pick(LAST)}`;
    return {
      key,
      name,
      // Numbers in a run that is plainly made up. Nothing is ever sent to them.
      phone: `+254700${String(100_000 + key)}`,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
    };
  });

  const out = new Map<number, { id: number; name: string; phone: string; email: string }>();
  for (let start = 0; start < people.length; start += 400) {
    const batch = people.slice(start, start + 400);
    const rows = await tx
      .insert(schema.guests)
      .values(batch.map(({ name, phone, email }) => ({ name, phone, email, sample: true, createdAt: now })))
      .returning({ id: schema.guests.id, phone: schema.guests.phone });
    for (const person of batch) {
      const row = rows.find((candidate) => candidate.phone === person.phone)!;
      out.set(person.key, { id: Number(row.id), name: person.name, phone: person.phone, email: person.email });
    }
  }
  return out;
}

type Paid = { cents: number; method: PaymentMethod; at: Date; byStaff: boolean };

async function writeBookings(
  tx: Tx,
  lodge: Catalogue,
  plans: Planned[],
  guests: Map<number, { id: number; name: string; phone: string; email: string }>,
  staff: Map<string, number>,
  now: Date,
): Promise<number> {
  const today = lodgeDay(now);
  const hour = lodgeHour(now);
  const desk = staff.get("front-desk") ?? null;
  const manager = staff.get("reservations") ?? null;
  const dinner = lodge.extras.find((extra) => extra.slug.includes("dinner")) ?? lodge.extras[0];
  const references = new Set<string>();
  let written = 0;

  for (const [index, plan] of plans.entries()) {
    const roll = chance(index * 613 + 29);
    const guest = guests.get(plan.guest)!;
    const madeOn = lodgeDay(plan.made);
    const priced = quote(lodge, {
      roomType: plan.type,
      stay: plan.stay,
      party: { adults: plan.adults, children: plan.children },
      mealPlan: plan.mealPlan,
      extraIds: plan.extraIds,
    });
    const terms: BookingTerms = termsFor(lodge.settings, plan.stay, priced.totalCents, madeOn);
    const holdUntil = new Date(plan.made.getTime() + lodge.settings.provisionalHours * 3_600_000);
    const waiting = plan.byPhone && holdUntil > now;
    // A phone booking whose deposit never came was let go long ago, and is not part of the story.
    const cancelled = plan.cancelsOn !== null && plan.cancelsOn <= today;
    const missed = !cancelled && plan.noShow && plan.stay.from < today;

    const arrived =
      !cancelled &&
      !missed &&
      !waiting &&
      (plan.stay.from < today || (plan.stay.from === today && plan.early && hour >= 14));
    const left = arrived && (plan.stay.to < today || (plan.stay.to === today && plan.early && hour >= 9));
    const status: BookingStatus = cancelled
      ? "cancelled"
      : missed
        ? "no_show"
        : waiting
          ? "provisional"
          : left
            ? "checked_out"
            : arrived
              ? "checked_in"
              : "confirmed";

    // Money, in the order it came in.
    const method: PaymentMethod = plan.byPhone ? roll.weighted([["mpesa_desk", 6], ["bank", 3], ["cash", 1]] as const) : "mpesa_prompt"; // prettier-ignore
    const paid: Paid[] = [];
    if (!waiting) {
      paid.push({
        cents: terms.deposit_cents,
        method,
        at: new Date(plan.made.getTime() + (plan.byPhone ? 3_600_000 : 4 * 60_000)),
        byStaff: plan.byPhone,
      });
      const balance = priced.totalCents - terms.deposit_cents;
      if (balance > 0 && terms.balance_due) {
        const dueOn = plan.paysLate ? plan.stay.from : addDays(terms.balance_due, -roll.between(0, 6));
        const payDay = dueOn < madeOn ? madeOn : dueOn;
        const before = plan.cancelsOn === null || payDay < plan.cancelsOn;
        const settled = plan.paysLate ? arrived : payDay <= today;
        if (before && settled) {
          paid.push({
            cents: balance,
            method: plan.paysLate ? "mpesa_desk" : method,
            at: lodgeMoment(payDay, plan.paysLate ? 15 : roll.between(8, 20), roll.between(0, 59)),
            byStaff: plan.paysLate || plan.byPhone,
          });
        }
      }
    }

    // Something ordered at the lodge goes on the bill during the stay and is settled on leaving.
    const ordered = plan.ordersAtLodge && arrived && dinner && !plan.extraIds.includes(dinner.id);
    const orderedCents = ordered
      ? dinner.charged === "per_person"
        ? dinner.priceCents * (plan.adults + plan.children)
        : dinner.priceCents
      : 0;
    const totalCents = priced.totalCents + orderedCents;
    if (ordered && left) {
      paid.push({ cents: orderedCents, method: "cash", at: lodgeMoment(plan.stay.to, 9, 40), byStaff: true });
    }

    const paidCents = paid.reduce((sum, payment) => sum + payment.cents, 0);
    const back = cancelled ? refundOnCancel(terms, priced.totalCents, paidCents, plan.cancelsOn!) : null;

    let reference = newReference();
    while (references.has(reference)) reference = newReference();
    references.add(reference);

    const [{ id }] = await tx
      .insert(schema.bookings)
      .values({
        reference,
        guestId: guest.id,
        guestName: guest.name,
        guestPhone: guest.phone,
        guestEmail: guest.email,
        roomTypeId: plan.type.id,
        roomId: plan.room.id,
        stay: plan.stay,
        adults: plan.adults,
        children: plan.children,
        mealPlan: plan.mealPlan,
        arrivalTime: plan.arrivalTime,
        requests: plan.requests,
        status,
        source: plan.byPhone ? "desk" : "website",
        holdUntil: waiting ? holdUntil : null,
        totalCents,
        terms,
        createdBy: plan.byPhone ? desk : null,
        createdAt: plan.made,
        confirmedAt: waiting ? null : paid[0].at,
        checkedInAt: arrived ? lodgeMoment(plan.stay.from, plan.early ? 13 : 16, roll.between(0, 59)) : null,
        checkedOutAt: left ? lodgeMoment(plan.stay.to, plan.early ? 8 : 10, roll.between(0, 29)) : null,
        cancelledAt: cancelled ? lodgeMoment(plan.cancelsOn!, 11, roll.between(0, 59)) : null,
        endedReason: cancelled ? "Cancelled by the guest" : missed ? "Did not arrive" : null,
        sample: true,
      })
      .returning({ id: schema.bookings.id });
    written++;

    if (!cancelled && !missed) {
      await tx.insert(schema.allocations).values({
        roomId: plan.room.id,
        stay: plan.stay,
        bookingId: id,
        createdBy: plan.byPhone ? desk : null,
        createdAt: plan.made,
      });
    }

    await tx
      .insert(schema.bookingNights)
      .values(
        priced.nights.map((night) => ({ bookingId: id, night: night.night, cents: night.cents, season: night.season })),
      );
    const charges = priced.charges.map((charge) => ({
      bookingId: id,
      kind: charge.kind,
      label: charge.label,
      quantity: charge.quantity,
      unitCents: charge.unitCents,
      cents: charge.cents,
      extraId: charge.extraId ?? null,
      createdBy: null as number | null,
      createdAt: plan.made,
    }));
    if (ordered) {
      const people = plan.adults + plan.children;
      charges.push({
        bookingId: id,
        kind: "extra",
        label: dinner.charged === "per_person" ? `${dinner.name}, ${plural(people, "guest")}` : dinner.name,
        quantity: dinner.charged === "per_person" ? people : 1,
        unitCents: dinner.priceCents,
        cents: orderedCents,
        extraId: dinner.id,
        createdBy: desk,
        createdAt: lodgeMoment(addDays(plan.stay.from, 1) > today ? today : addDays(plan.stay.from, 1), 11, 5),
      });
    }
    if (charges.length) await tx.insert(schema.bookingCharges).values(charges);

    if (paid.length) {
      await tx.insert(schema.payments).values(
        paid.map((payment, order) => ({
          bookingId: id,
          method: payment.method,
          cents: payment.cents,
          phone: payment.method === "mpesa_prompt" ? guest.phone : null,
          status: "paid" as const,
          receipt:
            payment.method === "cash"
              ? null
              : `T${"ABCDEFGHJK"[order]}${reference.slice(4)}${String(index % 100).padStart(2, "0")}`,
          requestedAt: new Date(payment.at.getTime() - 40_000),
          settledAt: payment.at,
          recordedBy: payment.byStaff ? desk : null,
        })),
      );
    }

    const events: {
      at: Date;
      actor: "guest" | "staff" | "system";
      staffId: number | null;
      kind: string;
      summary: string;
    }[] = [
      {
        at: plan.made,
        actor: plan.byPhone ? "staff" : "guest",
        staffId: plan.byPhone ? desk : null,
        kind: "made",
        summary: plan.byPhone
          ? `Made at the desk. The room is held until ${formatDay(lodgeDay(holdUntil))} for the deposit of ${formatMoney(terms.deposit_cents)}.`
          : `Started on the website. The room is held for ${plural(lodge.settings.holdMinutes, "minute")} while the guest pays.`,
      },
      ...paid.map((payment, order) => ({
        at: payment.at,
        actor: (payment.byStaff ? "staff" : "guest") as "guest" | "staff",
        staffId: payment.byStaff ? desk : null,
        kind: "paid",
        summary: `${formatMoney(payment.cents)} received.${order === 0 ? " The booking is confirmed." : ""}`,
      })),
    ];
    if (arrived) events.push({ at: lodgeMoment(plan.stay.from, 16, 5), actor: "staff", staffId: desk, kind: "checked-in", summary: "Checked in." }); // prettier-ignore
    if (left) events.push({ at: lodgeMoment(plan.stay.to, 10, 5), actor: "staff", staffId: desk, kind: "checked-out", summary: "Checked out." }); // prettier-ignore
    if (missed) events.push({ at: lodgeMoment(addDays(plan.stay.from, 1), 9, 0), actor: "staff", staffId: manager, kind: "no-show", summary: "Marked as a no-show. The room is back on sale." }); // prettier-ignore
    if (cancelled && back) {
      events.push({
        at: lodgeMoment(plan.cancelsOn!, 11, 0),
        actor: "guest",
        staffId: null,
        kind: "cancelled",
        summary: `Cancelled. ${formatMoney(back.refundCents)} to refund, ${formatMoney(back.keptCents)} kept.`,
      });
    }
    await tx.insert(schema.bookingEvents).values(events.map((event) => ({ bookingId: id, ...event })));

    if (cancelled && back && back.refundCents > 0) {
      // A refund is sent within a couple of days. Yesterday's is still waiting.
      const sent = daysBetween(plan.cancelsOn!, today) >= 2;
      await tx.insert(schema.refunds).values({
        bookingId: id,
        cents: back.refundCents,
        reason: `Cancelled on ${formatDay(plan.cancelsOn!)}: ${back.keepPercent}% of the total kept under the booking's terms`,
        status: sent ? "sent" : "owed",
        createdAt: lodgeMoment(plan.cancelsOn!, 11, 0),
        sentAt: sent ? lodgeMoment(addDays(plan.cancelsOn!, 1), 14, 30) : null,
        sentBy: sent ? manager : null,
        reference: sent ? `TR${reference.slice(4)}${String(index % 10)}` : null,
      });
    }
  }
  return written;
}

/** True when there is nothing in the books at all, as on the day a training lodge is first set up. */
export async function booksAreEmpty(): Promise<boolean> {
  const found = await db().execute(sql`SELECT 1 FROM bookings LIMIT 1`);
  return found.rows.length === 0;
}
