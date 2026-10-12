import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lodgeDay } from "@/lib/dates";
import { moneyOf } from "@/server/booking/ledger";
import { blockRoom, makeDeskBooking } from "@/server/booking/service";
import { db, schema } from "@/server/db";
import { roomTypeBySlug } from "@/server/lodge/catalogue";
import { startMpesaPayment } from "@/server/payments/service";
import { NotAllowed, type Staff } from "@/server/staff/permissions";
import { at, freshLodge } from "@/testing/lodge";

import { bookingToTry, hasTrainingKey, trainingAccount, trainingMayBlock, trainingMayBook } from "./door";
import { rebuildTraining } from "./sample";

const monday = at("2026-10-12 09:00");
const KEY = "a-key-for-the-tests-0123";
const link = (path: string) => new Request(`https://lodge.example${path}`);

beforeEach(async () => {
  await freshLodge();
  process.env.TRAINING_MODE = "true";
  process.env.TRAINING_KEY = KEY;
});

afterEach(() => {
  delete process.env.TRAINING_MODE;
  delete process.env.TRAINING_KEY;
});

describe("walking in to a training lodge", () => {
  it("needs the key, and a lodge that is kept for training", () => {
    expect(hasTrainingKey(link(`/desk/try/reservations?key=${KEY}`))).toBe(true);
    expect(hasTrainingKey(link("/desk/try/reservations"))).toBe(false);
    expect(hasTrainingKey(link("/desk/try/reservations?key=a-key-for-the-tests-0124"))).toBe(false);
    expect(hasTrainingKey(link(`/desk/try/reservations?key=${KEY}0`))).toBe(false);

    process.env.TRAINING_MODE = "false";
    expect(hasTrainingKey(link(`/desk/try/reservations?key=${KEY}`))).toBe(false);

    // A key too short to be a secret is no key at all.
    process.env.TRAINING_MODE = "true";
    process.env.TRAINING_KEY = "short";
    expect(hasTrainingKey(link("/desk/try/reservations?key=short"))).toBe(false);
  });

  it("opens the two training accounts and nobody else's", async () => {
    await db()
      .insert(schema.staff)
      .values({ name: "Ada Owner", email: "ada@ukingo.test", passwordHash: "x", role: "owner" });
    expect(await trainingAccount("reservations")).toBeNull();

    await rebuildTraining(monday);
    const manager = await trainingAccount("reservations");
    const desk = await trainingAccount("front-desk");
    expect(manager).not.toBeNull();
    expect(desk).not.toBeNull();
    expect(await trainingAccount("owner")).toBeNull();
    expect(await trainingAccount("ada@ukingo.test")).toBeNull();

    const [row] = await db().select().from(schema.staff).where(eq(schema.staff.id, manager!.id));
    expect(row).toMatchObject({ role: "reservations", training: true });

    // An owner who switches a training account off has closed that door.
    await db().update(schema.staff).set({ active: false }).where(eq(schema.staff.id, desk!.id));
    expect(await trainingAccount("front-desk")).toBeNull();
  });

  it("shows a visitor a sample booking with a balance to pay, and never prompts an invented number", async () => {
    await rebuildTraining(monday);
    const shown = await bookingToTry(lodgeDay(monday));
    expect(shown).not.toBeNull();
    const [booking] = await db().select().from(schema.bookings).where(eq(schema.bookings.reference, shown!.reference));
    expect(booking).toMatchObject({ sample: true, status: "confirmed" });
    const money = await moneyOf(db(), booking);
    expect(money.owedCents).toBeGreaterThan(0);

    // Whatever number is typed, one that belongs to an invented guest gets no prompt.
    const prompts: string[] = [];
    await expect(
      startMpesaPayment(
        { bookingId: booking.id, cents: money.owedCents, phone: booking.guestPhone, who: { actor: "guest" }, ip: null },
        monday,
        {
          async prompt(asked) {
            prompts.push(asked.phone);
            return { checkoutRequestId: "ws_CO_1", merchantRequestId: "m-1" };
          },
          async result() {
            return null;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(prompts).toEqual([]);
  });
});

describe("what a training account may do", () => {
  let trainee: Staff;
  let member: Staff;

  beforeEach(async () => {
    const rows = await db()
      .insert(schema.staff)
      .values([
        {
          name: "Wambui Kariuki",
          email: "wambui@ukingo.example",
          passwordHash: "x",
          role: "front_desk",
          training: true,
        },
        { name: "Kip Desk", email: "kip@ukingo.test", passwordHash: "x", role: "front_desk" },
      ])
      .returning();
    const asStaff = (row: (typeof rows)[number]): Staff => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      training: row.training,
    });
    trainee = asStaff(rows[0]);
    member = asStaff(rows[1]);
  });

  const book = (staff: Staff, night: number) =>
    makeDeskBooking(
      {
        roomType: "forest-cottage",
        stay: {
          from: `2026-11-${String(night).padStart(2, "0")}`,
          to: `2026-11-${String(night + 1).padStart(2, "0")}`,
        },
        party: { adults: 2, children: 0 },
        mealPlan: "bed_and_breakfast",
        extraIds: [],
        guest: { name: "Wanjiru Kamau", phone: "+254712345678", email: null },
        ip: null,
      },
      staff.id,
      monday,
    );

  it("makes a dozen bookings an hour and no more, so the lodge is not filled for the next person", async () => {
    for (let night = 2; night < 14; night++) {
      await trainingMayBook(trainee, monday);
      await book(trainee, night);
    }
    await expect(trainingMayBook(trainee, monday)).rejects.toBeInstanceOf(NotAllowed);
    // An hour on, they may again. And real staff are never counted.
    await expect(trainingMayBook(trainee, new Date(monday.getTime() + 61 * 60_000))).resolves.toBeUndefined();
    for (let night = 14; night < 28; night++) await book(member, night);
    await expect(trainingMayBook(member, monday)).resolves.toBeUndefined();
  });

  it("takes a room off sale for a week at most, and a few rooms an hour", async () => {
    await expect(trainingMayBlock(trainee, 8, monday)).rejects.toThrow(/up to 7 nights/);
    await expect(trainingMayBlock(member, 60, monday)).resolves.toBeUndefined();

    const lodge = (await import("@/server/lodge/catalogue")).loadCatalogue;
    const rooms = roomTypeBySlug(await lodge(), "forest-cottage")!.rooms;
    for (let count = 0; count < 6; count++) {
      await trainingMayBlock(trainee, 2, monday);
      const from = `2026-12-${String(1 + count * 3).padStart(2, "0")}`;
      const to = `2026-12-${String(3 + count * 3).padStart(2, "0")}`;
      await blockRoom(rooms[0].id, { from, to }, "Repairs", trainee.id, monday);
    }
    await expect(trainingMayBlock(trainee, 2, monday)).rejects.toThrow(/an hour/);
  });
});
