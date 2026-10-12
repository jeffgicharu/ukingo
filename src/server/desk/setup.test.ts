import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { checkBooks } from "@/jobs/books";
import { checkIn, checkOut, holdBooking, makeDeskBooking, type NewBooking } from "@/server/booking/service";
import { db, schema } from "@/server/db";
import { catalogue, forgetCatalogue, roomTypeBySlug, type Catalogue } from "@/server/lodge/catalogue";
import { forgetContent, page, questions, siteWords } from "@/server/lodge/content";
import { recordDeskPayment } from "@/server/payments/service";
import { openSession, staffForToken } from "@/server/staff/auth";
import {
  addStaff,
  changeOwnPassword,
  changeRole,
  requestReset,
  resetIsGood,
  resetPassword,
  setActive,
  setPassword,
  StaffError,
} from "@/server/staff/manage";
import { verifyPassword } from "@/server/staff/passwords";
import { NotAllowed, type Staff } from "@/server/staff/permissions";
import { at, freshLodge } from "@/testing/lodge";

import { forgetGuest } from "./guests";
import { fieldsOf, rulesOf, setupAction, SetupError, type SetupActionName } from "./setup";

let lodge: Catalogue;
let owner: Staff;
let manager: Staff;
let desk: Staff;
let trainee: Staff;

const monday = at("2026-10-12 09:00");

async function member(name: string, role: Staff["role"], training = false): Promise<Staff> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@ukingo.test`;
  const [row] = await db()
    .insert(schema.staff)
    .values({ name, email, passwordHash: "x", role, training })
    .returning({ id: schema.staff.id });
  return { id: row.id, name, email, role, training };
}

/** Makes a change the way the screens do: read the form, then apply what was read. */
async function change(name: SetupActionName, values: Record<string, string>, staff: Staff): Promise<string> {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  const action = setupAction(name);
  const proposal = await action.read(fieldsOf(form));
  return action.apply(proposal, staff, monday);
}

/** What a change would do, as the review step says it. */
async function linesOf(name: SetupActionName, values: Record<string, string>): Promise<string[]> {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  const action = setupAction(name);
  return action.lines!(await action.read(fieldsOf(form)));
}

/** The prices form as it stands, with some cells typed over. */
async function pricesForm(typed: Record<string, string> = {}): Promise<Record<string, string>> {
  const rates = await db().select().from(schema.rates);
  const form: Record<string, string> = {};
  for (const rate of rates) {
    form[`w-${rate.roomTypeId}-${rate.seasonId}`] = String(rate.weeknightCents / 100);
    form[`e-${rate.roomTypeId}-${rate.seasonId}`] = String(rate.weekendCents / 100);
  }
  return { ...form, ...typed };
}

async function rulesForm(typed: Record<string, string> = {}): Promise<Record<string, string>> {
  const [settings] = await db().select().from(schema.settings);
  const rules = rulesOf(settings);
  return { ...Object.fromEntries(Object.entries(rules).map(([key, value]) => [key, String(value)])), ...typed };
}

const request = (overrides: Partial<NewBooking> = {}): NewBooking => ({
  roomType: "forest-cottage",
  stay: { from: "2026-11-16", to: "2026-11-18" }, // two weekday nights in the low season
  party: { adults: 2, children: 0 },
  mealPlan: "bed_and_breakfast",
  extraIds: [],
  guest: { name: "Wanjiru Kamau", phone: "+254712345678", email: "wanjiru@mailbox.org" },
  ip: null,
  ...overrides,
});

beforeEach(async () => {
  lodge = await freshLodge();
  forgetContent();
  owner = await member("Ada Owner", "owner");
  manager = await member("Moraa Manager", "reservations");
  desk = await member("Kip Desk", "front_desk");
  trainee = await member("Training Manager", "reservations", true);
});

describe("who may change how the lodge is set up", () => {
  it("refuses the front desk, and a training account, where the data is changed", async () => {
    const cottage = roomTypeBySlug(lodge, "forest-cottage")!;
    const [low] = await db().select().from(schema.seasons).where(eq(schema.seasons.code, "low"));
    const dearer = await pricesForm({ [`w-${cottage.id}-${low.id}`]: "99000" });

    await expect(change("prices", dearer, desk)).rejects.toBeInstanceOf(NotAllowed);
    await expect(change("prices", dearer, trainee)).rejects.toThrow(/Training accounts/);
    await expect(change("rules", await rulesForm({ depositPercent: "90" }), trainee)).rejects.toBeInstanceOf(
      NotAllowed,
    );
    await expect(
      change("lodge", { lodgeName: "Mine", place: "Here", checkInFrom: "1 pm", checkOutBy: "noon" }, manager),
    ).rejects.toBeInstanceOf(NotAllowed);
    await expect(change("words-publish", {}, trainee)).rejects.toBeInstanceOf(NotAllowed);
    await expect(
      change("question-add", { topic: "Booking", question: "May I bring a dog?", answer: "Sadly not." }, trainee),
    ).rejects.toBeInstanceOf(NotAllowed);
    await expect(change("room-add", { type: String(cottage.id), name: "Podo" }, trainee)).rejects.toBeInstanceOf(
      NotAllowed,
    );

    // Nothing moved.
    forgetCatalogue();
    const after = await catalogue();
    expect(roomTypeBySlug(after, "forest-cottage")!.rates.low.weeknight).toBe(cottage.rates.low.weeknight);
    expect(after.settings.depositPercent).toBe(lodge.settings.depositPercent);
    expect(roomTypeBySlug(after, "forest-cottage")!.rooms).toHaveLength(cottage.rooms.length);
  });

  it("lets a training account work bookings all the same", async () => {
    const booking = await makeDeskBooking(request(), trainee.id, monday);
    expect(booking.status).toBe("provisional");
  });
});

describe("prices", () => {
  it("says what would change, and changes only bookings made afterwards", async () => {
    const cottage = roomTypeBySlug(lodge, "forest-cottage")!;
    const [low] = await db().select().from(schema.seasons).where(eq(schema.seasons.code, "low"));
    const before = await makeDeskBooking(request(), owner.id, monday);
    expect(before.totalCents).toBe(2 * 1_450_000);

    const form = await pricesForm({ [`w-${cottage.id}-${low.id}`]: "15,500" });
    expect(await linesOf("prices", form)).toEqual([
      "Forest Cottage, green season, Sunday to Thursday nights: KSh 14,500 becomes KSh 15,500.",
    ]);
    expect(await linesOf("prices", await pricesForm())).toEqual([]);

    await change("prices", form, manager);
    const after = await makeDeskBooking(request({ stay: { from: "2026-11-23", to: "2026-11-25" } }), owner.id, monday);
    expect(after.totalCents).toBe(2 * 1_550_000);

    // The booking made before keeps the price it was made at.
    const [kept] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, before.id));
    expect(kept.totalCents).toBe(2 * 1_450_000);
  });

  it("will not take a price that is not a sensible number", async () => {
    const cottage = roomTypeBySlug(lodge, "forest-cottage")!;
    const [low] = await db().select().from(schema.seasons).where(eq(schema.seasons.code, "low"));
    for (const typed of ["", "free", "-5", "12.50", "0"]) {
      await expect(
        change("prices", await pricesForm({ [`w-${cottage.id}-${low.id}`]: typed }), owner),
      ).rejects.toBeInstanceOf(SetupError);
    }
  });
});

describe("seasons and shortest stays", () => {
  it("gives chosen nights another season's prices, cutting them out of the season that had them", async () => {
    const [high] = await db().select().from(schema.seasons).where(eq(schema.seasons.code, "high"));
    const week = { season: String(high.id), label: "A festival", from: "2026-11-16", last: "2026-11-22" };

    // Those nights are in the green season of the short rains, which runs 1 November to 14 December.
    expect(await linesOf("season-add", week)).toEqual([
      "High season prices will apply to the nights of Mon 16 Nov to Sun 22 Nov 2026 (A festival).",
      "Green season (Short rains 2026) gives up those nights, and keeps Sun 1 Nov to Sun 15 Nov 2026 and Mon 23 Nov to Mon 14 Dec 2026.",
    ]);
    await change("season-add", week, manager);

    const cottage = roomTypeBySlug(lodge, "forest-cottage")!;
    const during = await makeDeskBooking(request(), owner.id, monday);
    expect(during.totalCents).toBe(2 * cottage.rates.high.weeknight);
    // The nights either side are still green season.
    const after = await makeDeskBooking(request({ stay: { from: "2026-11-23", to: "2026-11-25" } }), owner.id, monday);
    expect(after.totalCents).toBe(2 * cottage.rates.low.weeknight);
    const before = await makeDeskBooking(request({ stay: { from: "2026-11-11", to: "2026-11-13" } }), owner.id, monday);
    expect(before.totalCents).toBe(2 * cottage.rates.low.weeknight);

    await expect(change("season-add", { ...week, from: "2026-11-18", last: "2026-11-20" }, manager)).rejects.toThrow(
      /already high season \(A festival\)/,
    );
  });

  it("makes a stay over chosen nights longer than one night", async () => {
    await change("stay-add", { label: "Lewa Marathon", from: "2026-11-20", last: "2026-11-21", min: "3" }, manager);
    await expect(
      holdBooking(request({ stay: { from: "2026-11-20", to: "2026-11-22" }, ip: "197.232.1.10" }), monday),
    ).rejects.toMatchObject({ code: "dates", message: expect.stringContaining("at least 3 nights") });
  });
});

describe("booking rules", () => {
  it("apply to bookings made afterwards, and leave earlier bookings on their own terms", async () => {
    const before = await makeDeskBooking(request(), owner.id, monday);
    expect(before.terms.deposit_percent).toBe(30);

    const form = await rulesForm({ depositPercent: "50", freeUntilDays: "21", partUntilDays: "7" });
    expect(await linesOf("rules", form)).toEqual([
      "The deposit: 30% of the total becomes 50% of the total.",
      "Cancelling is free until: 30 days before arrival becomes 21 days before arrival.",
      "That lasts until: 14 days before arrival, and then there is no refund becomes 7 days before arrival, and then there is no refund.",
    ]);
    await change("rules", form, manager);

    const after = await makeDeskBooking(request({ stay: { from: "2026-11-23", to: "2026-11-25" } }), owner.id, monday);
    expect(after.terms.deposit_percent).toBe(50);
    expect(after.terms.policy.cancellation_steps).toEqual([
      { min_days: 21, keep_percent: 0 },
      { min_days: 7, keep_percent: 30 },
      { min_days: 0, keep_percent: 100 },
    ]);

    const [kept] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, before.id));
    expect(kept.terms).toEqual(before.terms);
  });

  it("refuses rules that contradict each other", async () => {
    await expect(change("rules", await rulesForm({ freeUntilDays: "10", partUntilDays: "14" }), owner)).rejects.toThrow(
      /must be smaller/,
    );
  });
});

describe("rooms", () => {
  it("cannot be taken out of use from under a guest who is coming", async () => {
    const booking = await makeDeskBooking(request(), owner.id, monday);
    const [room] = await db().select().from(schema.rooms).where(eq(schema.rooms.id, booking.roomId));
    const out = { id: String(room.id), name: room.name, use: "out" };

    await expect(change("room-change", out, manager)).rejects.toThrow(/still to come/);

    const other = roomTypeBySlug(lodge, "forest-cottage")!.rooms.find((candidate) => candidate.id !== room.id)!;
    await change("room-change", { id: String(other.id), name: other.name, use: "out" }, manager);
    forgetCatalogue();
    const rooms = roomTypeBySlug(await catalogue(), "forest-cottage")!.rooms;
    expect(rooms.map((candidate) => candidate.id)).not.toContain(other.id);
    // Its history is kept: the room is still there, only not in use.
    const [kept] = await db().select().from(schema.rooms).where(eq(schema.rooms.id, other.id));
    expect(kept.active).toBe(false);
  });
});

describe("the words on the site", () => {
  it("keeps a draft from guests until it is published", async () => {
    const texts = await db().select().from(schema.siteText);
    const form = Object.fromEntries(texts.map((text) => [`text-${text.key}`, text.value]));
    const published = (await siteWords())("home.headline");

    await change("words-draft", { ...form, "text-home.headline": "Above the clouds" }, manager);
    forgetContent();
    expect((await siteWords())("home.headline")).toBe(published);
    expect((await siteWords({ preview: true }))("home.headline")).toBe("Above the clouds");

    await change("words-publish", {}, manager);
    expect((await siteWords())("home.headline")).toBe("Above the clouds");

    // Saving the same words again leaves no draft behind.
    await change("words-draft", { ...form, "text-home.headline": "Above the clouds" }, manager);
    expect((await db().select().from(schema.siteText)).every((text) => text.draft === null)).toBe(true);
  });

  it("drafts, previews and publishes a page", async () => {
    const about = (await page("about"))!;
    const draft = { slug: "about", title: "Our story", summary: about.summary, body: "## A new start\n\nWords." };

    await change("page-draft", draft, manager);
    expect((await page("about"))!.title).toBe(about.title);
    expect((await page("about", { preview: true }))!.title).toBe("Our story");

    await change("page-discard", { slug: "about" }, manager);
    expect((await page("about", { preview: true }))!.title).toBe(about.title);

    await change("page-draft", draft, manager);
    await change("page-publish", { slug: "about" }, manager);
    expect(await page("about")).toMatchObject({ title: "Our story", body: "## A new start\n\nWords." });
  });

  it("keeps a new question back until it is shown", async () => {
    const before = (await questions()).length;
    await change("question-add", { topic: "Booking", question: "May I bring a dog?", answer: "Sadly not." }, manager);
    expect(await questions()).toHaveLength(before);
    const kept = (await questions({ preview: true })).find((entry) => entry.question === "May I bring a dog?")!;
    expect(kept.shown).toBe(false);

    await change(
      "question-save",
      { id: String(kept.id), topic: "Booking", question: kept.question, answer: kept.answer, shown: "on" },
      manager,
    );
    expect(await questions()).toHaveLength(before + 1);
  });
});

describe("staff", () => {
  it("is managed by an owner only, and never by a training account", async () => {
    const who = { name: "Njeri Mwangi", email: "njeri@ukingo.test", role: "front_desk", password: "a-long-password-1" };
    await expect(addStaff(manager, who)).rejects.toBeInstanceOf(NotAllowed);
    const trainingOwner = await member("Training Owner", "owner", true);
    await expect(addStaff(trainingOwner, who)).rejects.toBeInstanceOf(NotAllowed);

    await addStaff(owner, who);
    const [added] = await db().select().from(schema.staff).where(eq(schema.staff.email, who.email));
    expect(added).toMatchObject({ name: "Njeri Mwangi", role: "front_desk", active: true });
    expect(await verifyPassword(who.password, added.passwordHash)).toBe(true);

    await expect(addStaff(owner, who)).rejects.toThrow(/already signs in/);
    await expect(addStaff(owner, { ...who, email: "n2@ukingo.test", password: "short" })).rejects.toBeInstanceOf(
      StaffError,
    );
  });

  it("always leaves an owner, and nobody switches themselves off", async () => {
    await expect(setActive(owner, owner.id, false)).rejects.toThrow(/your own account/);
    await expect(changeRole(owner, owner.id, "front_desk")).rejects.toThrow(/your own role/);

    // A second owner may step the first down, but then nobody may remove the last one.
    const second = await member("Baraka Owner", "owner");
    await changeRole(second, owner.id, "reservations");
    const third = await member("Training Owner", "owner", true);
    await expect(setActive(third, second.id, false)).rejects.toBeInstanceOf(NotAllowed);
    await db().update(schema.staff).set({ role: "owner" }).where(eq(schema.staff.id, owner.id));
    await setActive({ ...owner, role: "owner" }, second.id, false);
    const helper = await member("Helper Owner", "owner");
    await expect(setActive(helper, owner.id, false)).resolves.toBe(owner.name);
    await expect(setActive(helper, helper.id, false)).rejects.toBeInstanceOf(StaffError);
  });

  it("signs someone out everywhere when they are switched off or given a new password", async () => {
    const token = await openSession(desk.id, null, "test");
    expect(await staffForToken(token)).toMatchObject({ id: desk.id });
    await setPassword(owner, desk.id, "another-long-password");
    expect(await staffForToken(token)).toBeNull();

    const again = await openSession(desk.id, null, "test");
    await setActive(owner, desk.id, false);
    expect(await staffForToken(again)).toBeNull();
    // The name stays for the history.
    const [kept] = await db().select().from(schema.staff).where(eq(schema.staff.id, desk.id));
    expect(kept).toMatchObject({ name: "Kip Desk", active: false });
  });

  it("changes a password only for someone who knows the old one", async () => {
    await addStaff(owner, {
      name: "Njeri Mwangi",
      email: "njeri@ukingo.test",
      role: "front_desk",
      password: "first-password-1",
    });
    const [row] = await db().select().from(schema.staff).where(eq(schema.staff.email, "njeri@ukingo.test"));
    const njeri: Staff = { id: row.id, name: row.name, email: row.email, role: row.role, training: false };

    await expect(changeOwnPassword(njeri, "not-it", "second-password-2")).rejects.toThrow(/not your current/);
    await expect(changeOwnPassword(njeri, "first-password-1", "first-password-1")).rejects.toThrow(/same as the old/);
    await changeOwnPassword(njeri, "first-password-1", "second-password-2");
    const [after] = await db().select().from(schema.staff).where(eq(schema.staff.id, njeri.id));
    expect(await verifyPassword("second-password-2", after.passwordHash)).toBe(true);

    await expect(
      changeOwnPassword({ ...njeri, training: true }, "second-password-2", "third-password-3"),
    ).rejects.toBeInstanceOf(NotAllowed);
  });

  it("resets a password with a link that works once, for an hour", async () => {
    // Asking for an address nobody has, or a training account, leaves nothing behind.
    await requestReset("nobody@ukingo.example", monday);
    await requestReset(trainee.email, monday);
    expect(await db().select().from(schema.passwordResets)).toHaveLength(0);

    // The link itself is only ever in the email, so the test plants one the same way the code does.
    const { createHash } = await import("node:crypto");
    const plant = async (token: string, expiresAt: Date) =>
      db()
        .insert(schema.passwordResets)
        .values({
          tokenHash: createHash("sha256").update(token).digest("hex"),
          staffId: desk.id,
          createdAt: monday,
          expiresAt,
        });
    const later = new Date(monday.getTime() + 61 * 60_000);
    await plant("stale", new Date(monday.getTime() + 60 * 60_000));
    expect(await resetIsGood("stale", monday)).toBe(true);
    expect(await resetIsGood("stale", later)).toBe(false);
    await expect(resetPassword("stale", "brand-new-password", later)).rejects.toThrow(/used or has run out/);

    const session = await openSession(desk.id, null, "test");
    await resetPassword("stale", "brand-new-password", monday);
    const [after] = await db().select().from(schema.staff).where(eq(schema.staff.id, desk.id));
    expect(await verifyPassword("brand-new-password", after.passwordHash)).toBe(true);
    expect(await staffForToken(session)).toBeNull();
    // Used once, it is spent.
    await expect(resetPassword("stale", "yet-another-password", monday)).rejects.toBeInstanceOf(StaffError);
    expect(await resetIsGood("made-up", monday)).toBe(false);
  });
});

describe("a guest who asks for their details to be deleted", () => {
  it("is forgotten once no stay is still to come, and the books stay whole", async () => {
    const booking = await makeDeskBooking(request(), owner.id, monday);
    await expect(forgetGuest(manager, booking.guestId, monday)).rejects.toThrow(/still to come/);

    await recordDeskPayment(
      { bookingId: booking.id, cents: booking.totalCents, method: "cash", reference: "" },
      owner.id,
      monday,
    );
    await checkIn(booking.id, owner.id, at("2026-11-16 15:00"));
    await checkOut(booking.id, owner.id, at("2026-11-18 09:00"));
    const afterwards = at("2026-11-20 10:00");

    // The front desk may not, and nor may a training account, whatever its role.
    await expect(forgetGuest(desk, booking.guestId, afterwards)).rejects.toBeInstanceOf(NotAllowed);
    await expect(forgetGuest(trainee, booking.guestId, afterwards)).rejects.toThrow(/Training accounts/);

    expect(await forgetGuest(manager, booking.guestId, afterwards)).toBe(1);

    const [guest] = await db().select().from(schema.guests).where(eq(schema.guests.id, booking.guestId));
    expect(guest).toMatchObject({ name: "Removed on request", email: null, notes: "" });
    expect(guest.phone).toBe("");
    const [kept] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
    expect(kept).toMatchObject({
      guestName: "Removed on request",
      guestEmail: null,
      requests: "",
      totalCents: booking.totalCents,
      status: "checked_out",
    });
    expect(await db().select().from(schema.messages).where(eq(schema.messages.bookingId, booking.id))).toEqual([]);
    // The money is still accounted for, with nobody's name on it.
    const payments = await db().select().from(schema.payments).where(eq(schema.payments.bookingId, booking.id));
    expect(payments.map((payment) => payment.cents)).toEqual([booking.totalCents]);
    expect(await checkBooks()).toEqual([]);
  });
});
