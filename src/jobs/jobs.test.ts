import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { holdBooking, type NewBooking } from "@/server/booking/service";
import { db, schema } from "@/server/db";
import { decideSending, isDeliverable } from "@/server/messages/tell";
import { cancellationLines } from "@/server/messages/templates";
import { makeTestPayment } from "@/server/payments/service";
import { at, freshLodge } from "@/testing/lodge";

import { checkBooks } from "./books";
import { sendReminders } from "./reminders";

const monday = at("2026-10-12 09:00");

function request(overrides: Partial<NewBooking> = {}): NewBooking {
  return {
    roomType: "forest-cottage",
    stay: { from: "2026-11-13", to: "2026-11-16" },
    party: { adults: 2, children: 0 },
    mealPlan: "bed_and_breakfast",
    extraIds: [],
    guest: { name: "Wanjiru Kamau", phone: "+254712345678", email: "wanjiru@mailbox.org" },
    ip: "197.232.1.10",
    ...overrides,
  };
}

async function confirmed(overrides: Partial<NewBooking> = {}) {
  const held = await holdBooking(request(overrides), monday);
  await makeTestPayment({ bookingId: held.id, cents: held.terms.deposit_cents, who: { actor: "guest" } }, monday);
  return held;
}

const kindsFor = async (bookingId: number) =>
  (
    await db()
      .select({ kind: schema.messages.kind, channel: schema.messages.channel })
      .from(schema.messages)
      .where(eq(schema.messages.bookingId, bookingId))
      .orderBy(schema.messages.id)
  )
    .filter((message) => message.channel === "email")
    .map((message) => message.kind);

beforeEach(async () => {
  await freshLodge();
  process.env.TEST_PAYMENTS = "true";
  delete process.env.RESEND_API_KEY;
});

describe("reminders", () => {
  it("reminds a guest once that the balance is coming due, and once on the day", async () => {
    // Balance due Friday 30 October.
    const booking = await confirmed();

    await sendReminders(at("2026-10-26 08:00")); // four days before: too early
    expect(await kindsFor(booking.id)).toEqual(["booking-confirmed"]);

    await sendReminders(at("2026-10-27 08:00")); // three days before
    await sendReminders(at("2026-10-28 08:00")); // not again
    expect(await kindsFor(booking.id)).toEqual(["booking-confirmed", "balance-due-soon"]);

    await sendReminders(at("2026-10-30 08:00"));
    await sendReminders(at("2026-10-30 18:00"));
    expect(await kindsFor(booking.id)).toEqual(["booking-confirmed", "balance-due-soon", "balance-due-today"]);
  });

  it("does not chase a guest who has paid in full", async () => {
    const booking = await confirmed();
    await makeTestPayment({ bookingId: booking.id, cents: 3_325_000, who: { actor: "guest" } }, monday);
    await sendReminders(at("2026-10-27 08:00"));
    await sendReminders(at("2026-10-30 08:00"));
    expect(await kindsFor(booking.id)).toEqual(["booking-confirmed", "payment-received"]);
  });

  it("writes once, three days ahead, to say the stay is near", async () => {
    const booking = await confirmed();
    await makeTestPayment({ bookingId: booking.id, cents: 3_325_000, who: { actor: "guest" } }, monday);

    await sendReminders(at("2026-11-09 08:00"));
    expect(await kindsFor(booking.id)).not.toContain("arrival-soon");
    await sendReminders(at("2026-11-10 08:00"));
    await sendReminders(at("2026-11-11 08:00"));
    await sendReminders(at("2026-11-13 08:00")); // the day itself: nothing more
    expect((await kindsFor(booking.id)).filter((kind) => kind === "arrival-soon")).toHaveLength(1);
  });

  it("catches up if a morning was missed", async () => {
    const booking = await confirmed();
    // Nothing ran on the 27th or 28th. The 29th still sends the reminder.
    await sendReminders(at("2026-10-29 08:00"));
    expect(await kindsFor(booking.id)).toContain("balance-due-soon");
  });
});

describe("the nightly check of the records", () => {
  it("finds nothing wrong after ordinary use", async () => {
    await confirmed();
    await holdBooking(
      request({
        stay: { from: "2026-11-20", to: "2026-11-22" },
        guest: { name: "A B", phone: "+254733000111", email: null },
        ip: "41.90.1.1",
      }),
      monday,
    );
    expect(await checkBooks()).toEqual([]);
  });

  it("notices a total that no longer matches its lines, and a booking without its room", async () => {
    const booking = await confirmed();
    await db().execute(sql`UPDATE bookings SET total_cents = total_cents + 100 WHERE id = ${booking.id}`);
    await db().execute(sql`DELETE FROM allocations WHERE booking_id = ${booking.id}`);

    const faults = await checkBooks();
    expect(faults.map((fault) => fault.kind).sort()).toEqual(["room", "total"]);
    expect(faults.every((fault) => fault.reference === booking.reference)).toBe(true);
  });
});

describe("who is written to", () => {
  it("knows an address that cannot belong to anyone", () => {
    expect(isDeliverable("wanjiru@gmail.com")).toBe(true);
    expect(isDeliverable("wanjiru@example.com")).toBe(false);
    expect(isDeliverable("wanjiru@mail.example.org")).toBe(false);
    expect(isDeliverable("guest@ukingo.test")).toBe(false);
    expect(isDeliverable("guest@lodge.example")).toBe(false);
    expect(isDeliverable("not-an-address")).toBe(false);
  });

  it("holds back mail to invented guests, without a mail service, and past the daily limits", async () => {
    const ask = (recipient: string, extra: { sample?: boolean; ip?: string } = {}) =>
      decideSending(db(), { recipient, sample: extra.sample ?? false, ip: extra.ip }, monday);

    expect(await ask("wanjiru@gmail.com")).toMatchObject({ status: "not_sent" }); // no mail service set up

    process.env.RESEND_API_KEY = "re_test";
    process.env.MAIL_DAILY_LIMIT = "3";
    process.env.MAIL_ADDRESS_LIMIT = "2";
    expect(await ask("wanjiru@gmail.com")).toEqual({ status: "queued" });
    expect(await ask("wanjiru@gmail.com", { sample: true })).toMatchObject({ status: "not_sent" });
    expect(await ask("wanjiru@example.com")).toMatchObject({ status: "not_sent" });

    const sent = (recipient: string) =>
      db()
        .insert(schema.messages)
        .values({ channel: "email", kind: "test", recipient, body: "x", status: "sent", createdAt: monday });
    await sent("wanjiru@gmail.com");
    await sent("wanjiru@gmail.com");
    expect(await ask("wanjiru@gmail.com")).toMatchObject({
      status: "not_sent",
      reason: expect.stringContaining("one address"),
    });
    expect(await ask("otieno@gmail.com")).toEqual({ status: "queued" });
    await sent("otieno@gmail.com");
    expect(await ask("achieng@gmail.com")).toMatchObject({
      status: "not_sent",
      reason: expect.stringContaining("3 emails a day"),
    });

    // The count starts again with the lodge's new day.
    expect(
      await decideSending(db(), { recipient: "achieng@gmail.com", sample: false }, at("2026-10-13 00:05")),
    ).toEqual({
      status: "queued",
    });
    delete process.env.MAIL_DAILY_LIMIT;
    delete process.env.MAIL_ADDRESS_LIMIT;
  });
});

describe("the cancellation terms in words", () => {
  const terms = {
    deposit_percent: 30,
    deposit_cents: 1_425_000,
    balance_due: "2026-10-30",
    change_until: "2026-11-06",
    cancellation: [
      { until: "2026-10-14", keep_percent: 0 },
      { until: "2026-10-30", keep_percent: 30 },
      { until: null, keep_percent: 100 },
    ],
    policy: { deposit_percent: 30, balance_due_days: 14, change_until_days: 7, cancellation_steps: [] },
  };

  it("gives real dates, and leaves out the steps that have passed", () => {
    expect(cancellationLines(terms, "2026-10-12")).toBe(
      "Cancel by Wednesday 14 October 2026 and everything you have paid is refunded. Cancel by Friday 30 October 2026 and we keep 30% of the total and refund the rest. After that, there is no refund.",
    );
    expect(cancellationLines(terms, "2026-10-20")).toBe(
      "Cancel by Friday 30 October 2026 and we keep 30% of the total and refund the rest. After that, there is no refund.",
    );
    expect(cancellationLines(terms, "2026-11-01")).toBe("If you cancel, there is no refund.");
  });
});
