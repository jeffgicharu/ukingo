import { desc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { roomTypeBySlug, type Catalogue } from "@/server/lodge/catalogue";
import { type Mpesa } from "@/server/payments/daraja";
import {
  answerMatches,
  answerPath,
  chasePayments,
  checkPayment,
  makeTestPayment,
  markRefundSent,
  recordDeskPayment,
  settlePayment,
  startMpesaPayment,
} from "@/server/payments/service";
import { at, freshLodge } from "@/testing/lodge";

import { freeRooms } from "./availability";
import { dueOn, moneyOf } from "./ledger";
import { linkCode, opens, readReference } from "./links";
import {
  addCharge,
  blockRoom,
  BookingError,
  cancelBooking,
  changeDates,
  checkIn,
  checkOut,
  holdAgain,
  holdBooking,
  makeDeskBooking,
  markNoShow,
  moveRoom,
  previewDateChange,
  releaseLapsedHolds,
  type Booking,
  type NewBooking,
} from "./service";

let lodge: Catalogue;
let staffId: number;

const monday = at("2026-10-12 09:00");
const guest = { name: "Wanjiru Kamau", phone: "+254712345678", email: "wanjiru@mailbox.org" };

function request(overrides: Partial<NewBooking> = {}): NewBooking {
  return {
    roomType: "forest-cottage",
    stay: { from: "2026-11-13", to: "2026-11-16" },
    party: { adults: 2, children: 0 },
    mealPlan: "bed_and_breakfast",
    extraIds: [],
    guest,
    ip: "197.232.1.10",
    ...overrides,
  };
}

/** A stand-in for Safaricom that remembers what it was asked. */
function fakeMpesa(answers: { result?: { code: string; description: string } | null; refuse?: string } = {}) {
  const prompts: { phone: string; shillings: number; reference: string; answerUrl: string }[] = [];
  let next = 1;
  const mpesa: Mpesa = {
    async prompt(asked) {
      if (answers.refuse) throw new Error(answers.refuse);
      prompts.push(asked);
      return { checkoutRequestId: `ws_CO_${next++}`, merchantRequestId: "m-1" };
    },
    async result() {
      return answers.result ?? null;
    },
  };
  return { mpesa, prompts };
}

const fresh = async (id: number): Promise<Booking> => {
  const [row] = await db().select().from(schema.bookings).where(eq(schema.bookings.id, id));
  return row;
};
const allocationOf = async (id: number) => {
  const [row] = await db().select().from(schema.allocations).where(eq(schema.allocations.bookingId, id));
  return row;
};
const events = async (id: number) =>
  (
    await db()
      .select()
      .from(schema.bookingEvents)
      .where(eq(schema.bookingEvents.bookingId, id))
      .orderBy(schema.bookingEvents.id)
  ).map((event) => event.kind);
const messagesFor = async (id: number, channel: "email" | "sms" = "email") =>
  (
    await db().select().from(schema.messages).where(eq(schema.messages.bookingId, id)).orderBy(schema.messages.id)
  ).filter((message) => message.channel === channel);

/** Takes whatever is still owed on a booking, in cash at the desk. */
const settle = async (id: number, when: Date) => {
  const booking = await fresh(id);
  const { owedCents } = await moneyOf(db(), booking);
  await recordDeskPayment({ bookingId: id, cents: owedCents, method: "cash", reference: "" }, staffId, when);
};

/** A booking that has been paid its deposit, made on Monday 12 October for 13 to 16 November. */
async function confirmedBooking(overrides: Partial<NewBooking> = {}): Promise<Booking> {
  const held = await holdBooking(request(overrides), monday);
  await makeTestPayment({ bookingId: held.id, cents: held.terms.deposit_cents, who: { actor: "guest" } }, monday);
  return fresh(held.id);
}

beforeEach(async () => {
  lodge = await freshLodge();
  process.env.TEST_PAYMENTS = "true";
  delete process.env.MPESA_PROMPT_SHILLINGS;
  delete process.env.RESEND_API_KEY;
  const [member] = await db()
    .insert(schema.staff)
    .values({ name: "Achieng Otieno", email: "achieng@ukingo.test", passwordHash: "x", role: "reservations" })
    .returning({ id: schema.staff.id });
  staffId = member.id;
});

afterEach(() => {
  clock.release();
});

describe("holding a room", () => {
  it("takes a room for fifteen minutes and prices the stay", async () => {
    const booking = await holdBooking(request(), monday);

    expect(booking.status).toBe("held");
    expect(booking.reference).toMatch(/^UKG-[2-9A-HJ-NP-Z]{6}$/);
    expect(booking.holdUntil?.toISOString()).toBe(at("2026-10-12 09:15").toISOString());
    // Friday and Saturday at the green-season weekend price, Sunday at the weeknight price.
    expect(booking.totalCents).toBe(1_650_000 + 1_650_000 + 1_450_000);
    expect(booking.terms.deposit_cents).toBe(1_425_000);
    expect(booking.terms.balance_due).toBe("2026-10-30");

    const allocation = await allocationOf(booking.id);
    expect(allocation.stay).toEqual({ from: "2026-11-13", to: "2026-11-16" });
    expect(allocation.roomId).toBe(booking.roomId);

    const nights = await db().select().from(schema.bookingNights).where(eq(schema.bookingNights.bookingId, booking.id));
    expect(nights).toHaveLength(3);
    expect(await events(booking.id)).toEqual(["made"]);
    // Nothing is sent to a guest who has not paid.
    expect(await messagesFor(booking.id)).toEqual([]);
  });

  it("makes one booking when the same form is sent twice", async () => {
    const [first, second] = await Promise.all([
      holdBooking(request({ requestKey: "form-1" }), monday),
      holdBooking(request({ requestKey: "form-1" }), monday),
    ]);
    expect(second.id).toBe(first.id);
    const [{ count }] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.bookings);
    expect(count).toBe(1);
  });

  it("gives the last room to one guest when several ask at once", async () => {
    const stay = { from: "2026-12-01", to: "2026-12-03" };
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        holdBooking(
          request({
            roomType: "ukingo-house",
            stay,
            guest: { ...guest, phone: `+25471234567${index}` },
            ip: `197.232.1.${index + 20}`,
          }),
          monday,
        ),
      ),
    );
    const won = attempts.filter((attempt) => attempt.status === "fulfilled");
    const lost = attempts.filter((attempt) => attempt.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(5);
    for (const attempt of lost) {
      expect((attempt as PromiseRejectedResult).reason).toBeInstanceOf(BookingError);
      expect(((attempt as PromiseRejectedResult).reason as BookingError).code).toBe("full");
    }
  });

  it("fills the rooms of a type one by one and then says it is full", async () => {
    const family = roomTypeBySlug(lodge, "family-cottage")!;
    const stay = { from: "2026-12-01", to: "2026-12-03" };
    const make = (index: number) =>
      holdBooking(
        request({
          roomType: "family-cottage",
          stay,
          party: { adults: 2, children: 2 },
          guest: { ...guest, phone: `+25472000000${index}` },
          ip: `197.232.2.${index}`,
        }),
        monday,
      );

    const first = await make(1);
    const second = await make(2);
    expect(new Set([first.roomId, second.roomId]).size).toBe(2);
    await expect(make(3)).rejects.toMatchObject({ code: "full" });
    expect(await freeRooms(db(), family.id, stay, monday)).toEqual([]);
  });

  it("refuses dates and parties that break the rules", async () => {
    await expect(
      holdBooking(request({ stay: { from: "2026-10-01", to: "2026-10-03" } }), monday),
    ).rejects.toMatchObject({
      code: "dates",
    });
    await expect(
      holdBooking(request({ stay: { from: "2026-12-24", to: "2026-12-26" } }), monday),
    ).rejects.toMatchObject({
      code: "dates",
    });
    await expect(holdBooking(request({ party: { adults: 3, children: 0 } }), monday)).rejects.toMatchObject({
      code: "party",
    });
    await expect(holdBooking(request({ mealPlan: "room_service" }), monday)).rejects.toMatchObject({ code: "invalid" });
    await expect(holdBooking(request({ roomType: "igloo" }), monday)).rejects.toMatchObject({ code: "invalid" });
  });

  it("lets one visitor hold only two rooms at a time", async () => {
    await holdBooking(request({ stay: { from: "2026-11-02", to: "2026-11-04" } }), monday);
    await holdBooking(request({ stay: { from: "2026-11-05", to: "2026-11-07" } }), monday);
    await expect(
      holdBooking(request({ stay: { from: "2026-11-09", to: "2026-11-11" } }), monday),
    ).rejects.toMatchObject({
      code: "too_many_holds",
    });

    // Once those holds have run out, the visitor can try again.
    const later = at("2026-10-12 09:20");
    await expect(
      holdBooking(request({ stay: { from: "2026-11-09", to: "2026-11-11" } }), later),
    ).resolves.toMatchObject({
      status: "held",
    });
  });

  it("keeps the price and the terms it was made with when rates and rules change later", async () => {
    const booking = await confirmedBooking();
    await db().execute(sql`UPDATE rates SET weeknight_cents = weeknight_cents * 2, weekend_cents = weekend_cents * 2`);
    await db().execute(
      sql`UPDATE settings SET deposit_percent = 50, cancellation_steps = '[{"min_days":0,"keep_percent":100}]'`,
    );

    const after = await fresh(booking.id);
    expect(after.totalCents).toBe(4_750_000);
    expect(after.terms.deposit_percent).toBe(30);
    // A cancellation the old rules allow in full is still refunded in full.
    const cancelled = await cancelBooking(booking.id, { actor: "guest" }, at("2026-10-13 10:00"));
    expect(cancelled.refundCents).toBe(1_425_000);
  });
});

describe("a hold that runs out", () => {
  it("lets the room go and frees the nights", async () => {
    const booking = await holdBooking(request(), monday);
    const cottage = roomTypeBySlug(lodge, "forest-cottage")!;

    // One second before the hold ends, the room is still taken.
    expect(await releaseLapsedHolds(db(), at("2026-10-12 09:14"))).toBe(0);
    expect(await freeRooms(db(), cottage.id, booking.stay, at("2026-10-12 09:14"))).toHaveLength(4);

    // After it ends the nights are free even before anything has swept the hold away.
    const after = at("2026-10-12 09:15");
    expect(await freeRooms(db(), cottage.id, booking.stay, after)).toHaveLength(5);

    expect(await releaseLapsedHolds(db(), after)).toBe(1);
    expect((await fresh(booking.id)).status).toBe("expired");
    expect(await allocationOf(booking.id)).toBeUndefined();
    expect(await events(booking.id)).toEqual(["made", "expired"]);
  });

  it("can be picked up again at the same price while the room is free", async () => {
    const booking = await holdBooking(request(), monday);
    await releaseLapsedHolds(db(), at("2026-10-12 10:00"));

    const again = await holdAgain(booking.id, at("2026-10-12 10:05"));
    expect(again.status).toBe("held");
    expect(again.roomId).toBe(booking.roomId);
    expect(again.totalCents).toBe(booking.totalCents);
    expect(again.holdUntil?.toISOString()).toBe(at("2026-10-12 10:20").toISOString());
  });

  it("cannot be picked up once every room of that kind has gone", async () => {
    const house = request({ roomType: "ukingo-house", party: { adults: 6, children: 0 } });
    const booking = await holdBooking(house, monday);
    await releaseLapsedHolds(db(), at("2026-10-12 10:00"));
    await holdBooking(
      { ...house, guest: { ...guest, phone: "+254733000111" }, ip: "41.90.1.1" },
      at("2026-10-12 10:01"),
    );

    await expect(holdAgain(booking.id, at("2026-10-12 10:05"))).rejects.toMatchObject({ code: "full" });
  });
});

describe("paying", () => {
  it("confirms the booking when the deposit lands, and writes to the guest", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa, prompts } = fakeMpesa();

    const payment = await startMpesaPayment(
      {
        bookingId: booking.id,
        cents: booking.terms.deposit_cents,
        phone: "0712 345 678",
        who: { actor: "guest" },
        ip: "197.232.1.10",
      },
      at("2026-10-12 09:02"),
      mpesa,
    );
    expect(payment.status).toBe("pending");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ phone: "254712345678", shillings: 14_250, reference: booking.reference });
    expect(prompts[0].answerUrl).toBe(`https://ukingo.test${answerPath(payment)}`);
    expect(prompts[0].answerUrl).not.toMatch(/mpesa|safaricom|query/i);

    const settled = await settlePayment(
      payment.id,
      { status: "paid", receipt: "TJC4X8PQ21", paidShillings: 14_250 },
      at("2026-10-12 09:03"),
    );
    expect(settled.effect).toBe("confirmed");

    const confirmed = await fresh(booking.id);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.holdUntil).toBeNull();

    const money = await moneyOf(db(), confirmed);
    expect(money).toMatchObject({ paidCents: 1_425_000, owedCents: 3_325_000 });

    const [email] = await messagesFor(booking.id);
    expect(email.kind).toBe("booking-confirmed");
    expect(email.subject).toBe(`Your stay at Ukingo is confirmed (${booking.reference})`);
    expect(email.body).toContain("M-Pesa receipt TJC4X8PQ21");
    expect(email.body).toContain("Still to pay: KSh 33,250, by Friday 30 October 2026");
    // The private link is never in the stored copy.
    expect(email.html).toContain("{{private-link}}");
    expect(email.html).not.toContain(linkCode(confirmed));
    const [text] = await messagesFor(booking.id, "sms");
    expect(text.status).toBe("not_sent");
  });

  it("records a confirmation once, however many times it arrives", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa } = fakeMpesa();
    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      monday,
      mpesa,
    );

    const news = { status: "paid" as const, receipt: "TJC4X8PQ21", paidShillings: 14_250 };
    const results = await Promise.all([1, 2, 3, 4].map(() => settlePayment(payment.id, news, monday)));
    expect(results.filter((result) => result.effect === "confirmed")).toHaveLength(1);
    expect(results.filter((result) => result.effect === "unchanged")).toHaveLength(3);

    expect((await moneyOf(db(), await fresh(booking.id))).paidCents).toBe(1_425_000);
    expect(await messagesFor(booking.id)).toHaveLength(1);
  });

  it("refuses a confirmation for a different amount", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa } = fakeMpesa();
    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      monday,
      mpesa,
    );
    const settled = await settlePayment(payment.id, { status: "paid", receipt: "X", paidShillings: 1 }, monday);
    expect(settled.payment.status).toBe("failed");
    expect((await fresh(booking.id)).status).toBe("held");
  });

  it("asks for one shilling where prompts go through the test system, and still counts the payment in full", async () => {
    process.env.MPESA_PROMPT_SHILLINGS = "1";
    const booking = await holdBooking(request(), monday);
    const { mpesa, prompts } = fakeMpesa();
    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      monday,
      mpesa,
    );
    expect(prompts[0].shillings).toBe(1);
    await settlePayment(payment.id, { status: "paid", receipt: "R1", paidShillings: 1 }, monday);
    expect((await moneyOf(db(), await fresh(booking.id))).paidCents).toBe(1_425_000);
  });

  it("only accepts amounts that make sense for the booking", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa } = fakeMpesa();
    const pay = (cents: number, phone = guest.phone) =>
      startMpesaPayment({ bookingId: booking.id, cents, phone, who: { actor: "guest" } }, monday, mpesa);

    await expect(pay(100_000)).rejects.toMatchObject({ code: "invalid" }); // less than the deposit
    await expect(pay(booking.totalCents + 100)).rejects.toMatchObject({ code: "invalid" }); // more than is owed
    await expect(pay(booking.terms.deposit_cents, "12345")).rejects.toMatchObject({ code: "invalid" });
    await expect(pay(booking.totalCents)).resolves.toMatchObject({ status: "pending" }); // in full is fine
  });

  it("never sends a prompt to an invented guest's number", async () => {
    await db()
      .insert(schema.guests)
      .values({ name: "Sample Guest", phone: "+254700111222", sample: true, createdAt: monday });
    const booking = await holdBooking(request(), monday);
    const { mpesa, prompts } = fakeMpesa();
    await expect(
      startMpesaPayment(
        { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: "0700 111 222", who: { actor: "guest" } },
        monday,
        mpesa,
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(prompts).toEqual([]);
  });

  it("does not send a second prompt while one is open", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa, prompts } = fakeMpesa();
    const ask = (when: Date) =>
      startMpesaPayment(
        { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
        when,
        mpesa,
      );

    const first = await ask(at("2026-10-12 09:01"));
    const second = await ask(new Date(at("2026-10-12 09:01").getTime() + 30_000));
    expect(second.id).toBe(first.id);
    expect(prompts).toHaveLength(1);

    // After the prompt has had its minute, a new one closes the old one.
    const third = await ask(at("2026-10-12 09:03"));
    expect(third.id).not.toBe(first.id);
    expect(prompts).toHaveLength(2);
    const [old] = await db().select().from(schema.payments).where(eq(schema.payments.id, first.id));
    expect(old.status).toBe("failed");
  });

  it("keeps the room while the guest is at the prompt, even if the hold was about to run out", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa } = fakeMpesa();
    await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      at("2026-10-12 09:14"),
      mpesa,
    );
    expect((await fresh(booking.id)).holdUntil?.toISOString()).toBe(at("2026-10-12 09:17").toISOString());
  });

  it("tells the guest why a payment failed and leaves the booking as it was", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa } = fakeMpesa();
    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      monday,
      mpesa,
    );
    const settled = await settlePayment(
      payment.id,
      { status: "failed", failure: "cancelled", detail: "Request cancelled by user" },
      monday,
    );
    expect(settled.effect).toBe("failed");
    expect(settled.payment.failure).toBe("cancelled");
    expect((await fresh(booking.id)).status).toBe("held");
    expect(await messagesFor(booking.id)).toEqual([]);
  });

  it("marks the payment failed when Safaricom refuses to send the prompt", async () => {
    const booking = await holdBooking(request(), monday);
    const { mpesa } = fakeMpesa({ refuse: "Invalid PhoneNumber" });
    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      monday,
      mpesa,
    );
    expect(payment.status).toBe("failed");
    expect(payment.failureDetail).toContain("Invalid PhoneNumber");
  });
});

describe("when the confirmation never arrives", () => {
  async function pendingPayment() {
    const booking = await holdBooking(request(), monday);
    const sent = fakeMpesa();
    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      monday,
      sent.mpesa,
    );
    return { booking, payment };
  }
  const after = (seconds: number) => new Date(monday.getTime() + seconds * 1000);

  it("asks M-Pesa and settles the booking as paid", async () => {
    const { booking, payment } = await pendingPayment();
    const { mpesa } = fakeMpesa({
      result: { code: "0", description: "The service request is processed successfully." },
    });

    // Too soon to ask.
    expect((await checkPayment(payment.id, after(5), mpesa))?.status).toBe("pending");
    expect((await checkPayment(payment.id, after(20), mpesa))?.status).toBe("paid");
    expect((await fresh(booking.id)).status).toBe("confirmed");
  });

  it("asks M-Pesa and settles it as failed", async () => {
    const { booking, payment } = await pendingPayment();
    const { mpesa } = fakeMpesa({ result: { code: "1037", description: "DS timeout user cannot be reached" } });
    const checked = await checkPayment(payment.id, after(20), mpesa);
    expect(checked).toMatchObject({ status: "failed", failure: "unreachable" });
    expect((await fresh(booking.id)).status).toBe("held");
  });

  it("gives up after five minutes of silence, and still believes M-Pesa if it speaks later", async () => {
    const { booking, payment } = await pendingPayment();
    const silent = fakeMpesa({ result: null });

    expect((await checkPayment(payment.id, after(60), silent.mpesa))?.status).toBe("pending");
    expect(await chasePayments(after(301), silent.mpesa)).toBe(1);
    const [given] = await db().select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    expect(given).toMatchObject({ status: "failed", failure: "timeout" });

    // The hold has long run out, and the room is still free: the late payment keeps the booking.
    await releaseLapsedHolds(db(), after(1000));
    const late = await settlePayment(
      payment.id,
      { status: "paid", receipt: "LATE1", paidShillings: 14_250 },
      after(1200),
    );
    expect(late.effect).toBe("room-retaken");
    expect((await fresh(booking.id)).status).toBe("confirmed");
    expect(await allocationOf(booking.id)).toBeDefined();
  });

  it("owes the money back when it arrives after the room has gone to someone else", async () => {
    const house = request({ roomType: "ukingo-house", party: { adults: 6, children: 0 } });
    const booking = await holdBooking(house, monday);
    const sent = fakeMpesa();
    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents: booking.terms.deposit_cents, phone: guest.phone, who: { actor: "guest" } },
      monday,
      sent.mpesa,
    );

    await releaseLapsedHolds(db(), after(3600));
    const other = await holdBooking(
      { ...house, guest: { ...guest, phone: "+254733000111" }, ip: "41.90.1.1" },
      after(3700),
    );
    await makeTestPayment(
      { bookingId: other.id, cents: other.terms.deposit_cents, who: { actor: "guest" } },
      after(3710),
    );

    const late = await settlePayment(
      payment.id,
      { status: "paid", receipt: "LATE2", paidShillings: booking.terms.deposit_cents / 100 },
      after(3800),
    );
    expect(late.effect).toBe("refund-owed");
    expect((await fresh(booking.id)).status).toBe("expired");

    const [refund] = await db().select().from(schema.refunds).where(eq(schema.refunds.bookingId, booking.id));
    expect(refund).toMatchObject({ status: "owed", cents: booking.terms.deposit_cents });
    const mail = await messagesFor(booking.id);
    expect(mail.map((message) => message.kind)).toEqual(["paid-too-late"]);
  });

  it("answers only on the address given out with that prompt", async () => {
    const { payment } = await pendingPayment();
    const code = answerPath(payment).split("/").pop()!;
    expect(answerMatches(code, payment)).toBe(true);
    expect(answerMatches(`${payment.id}.${"a".repeat(32)}`, payment)).toBe(false);
    expect(answerMatches(code, { ...payment, id: payment.id + 1 })).toBe(false);
  });
});

describe("the balance", () => {
  it("can be paid in parts, and each part is acknowledged", async () => {
    const booking = await confirmedBooking();
    const today = "2026-10-12";
    let money = await moneyOf(db(), booking);
    expect(dueOn(booking.status, booking.terms, money, today)).toEqual({
      minimumCents: 0,
      fullCents: 3_325_000,
      overdue: false,
    });

    await makeTestPayment({ bookingId: booking.id, cents: 1_000_000, who: { actor: "guest" } }, monday);
    await makeTestPayment({ bookingId: booking.id, cents: 2_325_000, who: { actor: "guest" } }, monday);

    money = await moneyOf(db(), await fresh(booking.id));
    expect(money).toMatchObject({ paidCents: 4_750_000, owedCents: 0 });
    await expect(
      makeTestPayment({ bookingId: booking.id, cents: 100, who: { actor: "guest" } }, monday),
    ).rejects.toMatchObject({
      code: "not_now",
    });

    const kinds = (await messagesFor(booking.id)).map((message) => message.kind);
    expect(kinds).toEqual(["booking-confirmed", "payment-received", "payment-received"]);
  });

  it("is overdue the day after it was due", async () => {
    const booking = await confirmedBooking();
    const money = await moneyOf(db(), booking);
    expect(dueOn(booking.status, booking.terms, money, "2026-10-30").overdue).toBe(false);
    expect(dueOn(booking.status, booking.terms, money, "2026-10-31").overdue).toBe(true);
  });

  it("is asked for in full when the stay is less than two weeks away", async () => {
    const soon = await holdBooking(request({ stay: { from: "2026-10-20", to: "2026-10-22" } }), monday);
    expect(soon.terms.deposit_cents).toBe(soon.totalCents);
    await expect(
      makeTestPayment({ bookingId: soon.id, cents: 500_000, who: { actor: "guest" } }, monday),
    ).rejects.toMatchObject({
      code: "invalid",
    });
  });
});

describe("cancelling", () => {
  it("refunds everything thirty days or more before arrival", async () => {
    const booking = await confirmedBooking();
    const cottage = roomTypeBySlug(lodge, "forest-cottage")!;

    const result = await cancelBooking(booking.id, { actor: "guest" }, at("2026-10-14 23:59"));
    expect(result).toMatchObject({ refundCents: 1_425_000, keptCents: 0, keepPercent: 0 });
    expect(result.booking.status).toBe("cancelled");

    // The room is back on sale at once.
    expect(await freeRooms(db(), cottage.id, booking.stay, at("2026-10-15 00:00"))).toHaveLength(5);
    const [refund] = await db().select().from(schema.refunds).where(eq(schema.refunds.bookingId, booking.id));
    expect(refund).toMatchObject({ status: "owed", cents: 1_425_000 });
    expect((await moneyOf(db(), result.booking)).owedCents).toBe(0);

    const mail = await messagesFor(booking.id);
    expect(mail.at(-1)?.kind).toBe("booking-cancelled");
    expect(mail.at(-1)?.body).toContain("KSh 14,250 will be refunded");
  });

  it("keeps the deposit from 29 days down to 14", async () => {
    const booking = await confirmedBooking();
    await makeTestPayment({ bookingId: booking.id, cents: 3_325_000, who: { actor: "guest" } }, monday);

    const result = await cancelBooking(booking.id, { actor: "guest" }, at("2026-10-15 00:00"));
    expect(result).toMatchObject({ refundCents: 3_325_000, keptCents: 1_425_000, keepPercent: 30 });
  });

  it("refunds nothing inside fourteen days", async () => {
    const booking = await confirmedBooking();
    const result = await cancelBooking(booking.id, { actor: "guest" }, at("2026-10-31 08:00"));
    expect(result).toMatchObject({ refundCents: 0, keptCents: 1_425_000, keepPercent: 100 });
    const refunds = await db().select().from(schema.refunds).where(eq(schema.refunds.bookingId, booking.id));
    expect(refunds).toEqual([]);
  });

  it("is refused to a guest once the stay has started, and can only be done once", async () => {
    const booking = await confirmedBooking();
    await expect(cancelBooking(booking.id, { actor: "guest" }, at("2026-11-13 07:00"))).rejects.toMatchObject({
      code: "not_allowed",
    });
    await cancelBooking(booking.id, { actor: "guest" }, at("2026-11-01 07:00"));
    await expect(cancelBooking(booking.id, { actor: "guest" }, at("2026-11-01 07:01"))).rejects.toMatchObject({
      code: "not_now",
    });
  });

  it("lets a manager set a different refund, with a reason", async () => {
    const booking = await confirmedBooking();
    const who = { actor: "staff" as const, staffId };
    const when = at("2026-10-31 08:00");

    await expect(cancelBooking(booking.id, who, when, { refundCents: 1_000_000 })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      cancelBooking(booking.id, who, when, { refundCents: 9_999_999, reason: "Goodwill" }),
    ).rejects.toMatchObject({
      code: "invalid",
    });
    const result = await cancelBooking(booking.id, who, when, { refundCents: 1_000_000, reason: "Bereavement" });
    expect(result).toMatchObject({ refundCents: 1_000_000, keptCents: 425_000 });
  });
});

describe("changing dates", () => {
  it("moves the stay, re-prices it and keeps the room when it can", async () => {
    const booking = await confirmedBooking();
    // Monday to Thursday in December: three green-season weeknights.
    const newStay = { from: "2026-12-07", to: "2026-12-10" };

    const preview = await previewDateChange(booking, newStay, { actor: "guest" }, monday);
    expect(preview).toMatchObject({
      ok: true,
      totalCents: 4_350_000,
      differenceCents: -400_000,
      refundCents: 0,
      roomFree: true,
    });

    const moved = await changeDates(booking.id, newStay, { actor: "guest" }, monday);
    expect(moved.booking.stay).toEqual(newStay);
    expect(moved.booking.roomId).toBe(booking.roomId);
    expect(moved.booking.totalCents).toBe(4_350_000);
    // The dates in the terms move with the stay, by the booking's own rules.
    expect(moved.booking.terms.balance_due).toBe("2026-11-23");
    expect(moved.booking.terms.deposit_percent).toBe(30);
    expect((await allocationOf(booking.id)).stay).toEqual(newStay);

    const nights = await db().select().from(schema.bookingNights).where(eq(schema.bookingNights.bookingId, booking.id));
    expect(nights.map((night) => night.night).sort()).toEqual(["2026-12-07", "2026-12-08", "2026-12-09"]);
    expect((await messagesFor(booking.id)).at(-1)?.kind).toBe("booking-changed");
  });

  it("owes back the difference when the new dates cost less than has been paid", async () => {
    const booking = await confirmedBooking();
    await makeTestPayment({ bookingId: booking.id, cents: 3_325_000, who: { actor: "guest" } }, monday);

    const moved = await changeDates(booking.id, { from: "2026-12-07", to: "2026-12-09" }, { actor: "guest" }, monday);
    expect(moved.booking.totalCents).toBe(2_900_000);
    expect(moved.refundCents).toBe(1_850_000);
    expect((await moneyOf(db(), moved.booking)).owedCents).toBe(0);
  });

  it("adds to the balance when the new dates cost more", async () => {
    const booking = await confirmedBooking();
    // Four nights from Christmas Eve, high season: Thursday, Friday, Saturday, Sunday.
    const moved = await changeDates(booking.id, { from: "2026-12-24", to: "2026-12-28" }, { actor: "guest" }, monday);
    expect(moved.booking.totalCents).toBe(2_100_000 + 2_400_000 + 2_400_000 + 2_100_000);
    expect((await moneyOf(db(), moved.booking)).owedCents).toBe(9_000_000 - 1_425_000);
  });

  it("takes another room of the same kind when its own is busy on the new dates", async () => {
    const booking = await confirmedBooking();
    const newStay = { from: "2026-12-07", to: "2026-12-10" };
    await blockRoom(booking.roomId, { from: "2026-12-08", to: "2026-12-09" }, "Repairs", staffId, monday);

    const moved = await changeDates(booking.id, newStay, { actor: "guest" }, monday);
    expect(moved.booking.roomId).not.toBe(booking.roomId);
    expect(moved.booking.roomTypeId).toBe(booking.roomTypeId);
  });

  it("is refused when no room is free, and changes nothing", async () => {
    const house = await confirmedBooking({ roomType: "ukingo-house", party: { adults: 6, children: 0 } });
    await blockRoom(house.roomId, { from: "2026-12-08", to: "2026-12-09" }, "Repairs", staffId, monday);

    await expect(
      changeDates(house.id, { from: "2026-12-07", to: "2026-12-10" }, { actor: "guest" }, monday),
    ).rejects.toMatchObject({
      code: "full",
    });
    const unchanged = await fresh(house.id);
    expect(unchanged.stay).toEqual(house.stay);
    expect(unchanged.totalCents).toBe(house.totalCents);
    expect((await allocationOf(house.id)).stay).toEqual(house.stay);
  });

  it("is open to a guest until a week before arrival, and to staff after that", async () => {
    const booking = await confirmedBooking();
    const newStay = { from: "2026-11-20", to: "2026-11-23" };

    expect(await previewDateChange(booking, newStay, { actor: "guest" }, at("2026-11-06 20:00"))).toMatchObject({
      ok: true,
    });
    const tooLate = await previewDateChange(booking, newStay, { actor: "guest" }, at("2026-11-07 08:00"));
    expect(tooLate).toMatchObject({ ok: false });
    await expect(changeDates(booking.id, newStay, { actor: "guest" }, at("2026-11-07 08:00"))).rejects.toMatchObject({
      code: "not_allowed",
    });
    await expect(
      changeDates(booking.id, newStay, { actor: "staff", staffId }, at("2026-11-07 08:00")),
    ).resolves.toBeDefined();
  });
});

describe("at the desk", () => {
  it("holds a room for a caller until tomorrow, and lets it go if the deposit never comes", async () => {
    const booking = await makeDeskBooking(
      request({ guest: { ...guest, email: "wanjiru@mailbox.org" }, ip: null }),
      staffId,
      monday,
    );
    expect(booking.status).toBe("provisional");
    expect(booking.source).toBe("desk");
    expect(booking.holdUntil?.toISOString()).toBe(at("2026-10-13 09:00").toISOString());

    const [asked] = await messagesFor(booking.id);
    expect(asked.kind).toBe("pay-by");
    expect(asked.body).toContain("pay KSh 14,250 by M-Pesa");
    expect(asked.body).toContain("Tue 13 Oct 2026, 9 am");

    expect(await releaseLapsedHolds(db(), at("2026-10-13 08:59"))).toBe(0);
    expect(await releaseLapsedHolds(db(), at("2026-10-13 09:00"))).toBe(1);
    expect((await fresh(booking.id)).status).toBe("expired");
    expect((await messagesFor(booking.id)).at(-1)?.kind).toBe("provisional-lapsed");
  });

  it("confirms a desk booking when the deposit is taken there and then", async () => {
    const booking = await makeDeskBooking(request({ ip: null }), staffId, monday);
    await expect(
      recordDeskPayment({ bookingId: booking.id, cents: 1_425_000, method: "bank", reference: "" }, staffId, monday),
    ).rejects.toMatchObject({ code: "invalid" });
    await recordDeskPayment(
      { bookingId: booking.id, cents: 1_425_000, method: "cash", reference: "" },
      staffId,
      monday,
    );
    expect((await fresh(booking.id)).status).toBe("confirmed");
  });

  it("may book inside the online rules: a short stay over Christmas", async () => {
    const booking = await makeDeskBooking(
      request({ stay: { from: "2026-12-24", to: "2026-12-26" }, ip: null }),
      staffId,
      monday,
    );
    expect(booking.status).toBe("provisional");
  });

  it("checks a guest in and out, each only from the right state", async () => {
    const booking = await confirmedBooking();

    await expect(checkIn(booking.id, staffId, at("2026-11-12 15:00"))).rejects.toMatchObject({ code: "not_now" });
    await expect(checkOut(booking.id, staffId, at("2026-11-13 15:00"))).rejects.toMatchObject({ code: "not_now" });

    const arrived = await checkIn(booking.id, staffId, at("2026-11-13 15:00"));
    expect(arrived.status).toBe("checked_in");
    // A second tap from a stale screen does nothing.
    await expect(checkIn(booking.id, staffId, at("2026-11-13 15:01"))).rejects.toMatchObject({ code: "not_now" });

    await settle(booking.id, at("2026-11-16 09:00"));
    const left = await checkOut(booking.id, staffId, at("2026-11-16 09:30"));
    expect(left.status).toBe("checked_out");
    await expect(checkOut(booking.id, staffId, at("2026-11-16 09:31"))).rejects.toMatchObject({ code: "not_now" });
    // The stay stays on the calendar as history.
    expect((await allocationOf(booking.id)).stay).toEqual(booking.stay);
  });

  it("does not check a guest out with the bill open unless that is chosen", async () => {
    const booking = await confirmedBooking();
    await checkIn(booking.id, staffId, at("2026-11-13 15:00"));
    const owed = (await moneyOf(db(), booking)).owedCents;
    expect(owed).toBeGreaterThan(0);

    await expect(checkOut(booking.id, staffId, at("2026-11-16 09:30"))).rejects.toMatchObject({
      code: "not_now",
      message: expect.stringContaining("still to pay"),
    });
    expect((await fresh(booking.id)).status).toBe("checked_in");

    const left = await checkOut(booking.id, staffId, at("2026-11-16 09:35"), { leaveOwing: true });
    expect(left.status).toBe("checked_out");
    // What was owed is still owed, and the history says so.
    expect((await moneyOf(db(), left)).owedCents).toBe(owed);
    const [last] = await db()
      .select()
      .from(schema.bookingEvents)
      .where(eq(schema.bookingEvents.bookingId, booking.id))
      .orderBy(desc(schema.bookingEvents.id))
      .limit(1);
    expect(last.summary).toContain("was left owing");
  });

  it("puts unused nights back on sale when a guest leaves early", async () => {
    const booking = await confirmedBooking();
    await checkIn(booking.id, staffId, at("2026-11-13 15:00"));
    await settle(booking.id, at("2026-11-14 07:50"));
    await checkOut(booking.id, staffId, at("2026-11-14 08:00"));
    expect((await allocationOf(booking.id)).stay).toEqual({ from: "2026-11-13", to: "2026-11-14" });
  });

  it("records a no-show from the day after arrival and frees the room", async () => {
    const booking = await confirmedBooking();
    await expect(markNoShow(booking.id, staffId, at("2026-11-13 22:00"))).rejects.toMatchObject({ code: "not_now" });
    const missed = await markNoShow(booking.id, staffId, at("2026-11-14 08:00"));
    expect(missed.status).toBe("no_show");
    expect(await allocationOf(booking.id)).toBeUndefined();
    expect((await moneyOf(db(), missed)).owedCents).toBe(0);
  });

  it("moves a booking to another room only when that room is free", async () => {
    const booking = await confirmedBooking();
    const cottages = roomTypeBySlug(lodge, "forest-cottage")!.rooms;
    const other = cottages.find((room) => room.id !== booking.roomId)!;
    const third = cottages.find((room) => room.id !== booking.roomId && room.id !== other.id)!;
    await blockRoom(third.id, { from: "2026-11-14", to: "2026-11-15" }, "Repairs", staffId, monday);

    await expect(moveRoom(booking.id, third.id, staffId, monday)).rejects.toMatchObject({ code: "full" });
    const moved = await moveRoom(booking.id, other.id, staffId, monday);
    expect(moved.roomId).toBe(other.id);
    expect((await allocationOf(booking.id)).roomId).toBe(other.id);
  });

  it("adds extras and adjustments to the bill and keeps the total in step", async () => {
    const booking = await confirmedBooking();
    const walk = lodge.extras.find((extra) => extra.slug === "forest-walk")!;

    let updated = await addCharge(booking.id, { extraId: walk.id }, staffId, monday);
    expect(updated.totalCents).toBe(4_750_000 + 500_000);
    updated = await addCharge(booking.id, { label: "Goodwill for the late room", cents: -250_000 }, staffId, monday);
    expect(updated.totalCents).toBe(5_000_000);
    expect((await moneyOf(db(), updated)).owedCents).toBe(5_000_000 - 1_425_000);
    await expect(addCharge(booking.id, { label: "", cents: 100 }, staffId, monday)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("refuses a block that would sit on top of a booking", async () => {
    const booking = await confirmedBooking();
    await expect(
      blockRoom(booking.roomId, { from: "2026-11-15", to: "2026-11-18" }, "Painting", staffId, monday),
    ).rejects.toMatchObject({
      code: "full",
    });
    await expect(
      blockRoom(booking.roomId, { from: "2026-11-16", to: "2026-11-18" }, "Painting", staffId, monday),
    ).resolves.toBeUndefined();
  });

  it("records a refund as sent once, and tells the guest", async () => {
    const booking = await confirmedBooking();
    await cancelBooking(booking.id, { actor: "guest" }, at("2026-10-13 09:00"));
    const [refund] = await db().select().from(schema.refunds).where(eq(schema.refunds.bookingId, booking.id));

    await expect(markRefundSent(refund.id, " ", staffId, monday)).rejects.toMatchObject({ code: "invalid" });
    await markRefundSent(refund.id, "TJD9K2LMN4", staffId, at("2026-10-13 12:00"));
    await expect(markRefundSent(refund.id, "TJD9K2LMN4", staffId, at("2026-10-13 12:01"))).rejects.toMatchObject({
      code: "not_now",
    });

    const money = await moneyOf(db(), await fresh(booking.id));
    expect(money).toMatchObject({ refundOwedCents: 0, refundSentCents: 1_425_000, heldCents: 0 });
    expect((await messagesFor(booking.id)).at(-1)?.kind).toBe("refund-sent");
  });
});

describe("private links", () => {
  it("open only the booking they were made for, and stop working when the booking's link is renewed", async () => {
    const booking = await confirmedBooking();
    const other = await confirmedBooking({
      stay: { from: "2026-11-20", to: "2026-11-22" },
      guest: { ...guest, phone: "+254733000222" },
      ip: "41.90.1.2",
    });
    const code = linkCode(booking);

    expect(code).toMatch(/^UKG-[2-9A-HJ-NP-Z]{6}\.[A-Za-z0-9_-]{22}$/);
    expect(opens(code, booking)).toBe(true);
    expect(opens(code, other)).toBe(false);
    expect(opens(`${booking.reference}.${"A".repeat(22)}`, booking)).toBe(false);
    expect(opens(code, { ...booking, linkVersion: 2 })).toBe(false);
  });

  it("reads a reference however a guest types it", () => {
    expect(readReference("ukg-7q4mxr")).toBe("UKG-7Q4MXR");
    expect(readReference(" UKG7Q4MXR ")).toBe("UKG-7Q4MXR");
    expect(readReference("7q4mxr")).toBe("UKG-7Q4MXR");
    expect(readReference("hello")).toBeNull();
    expect(readReference("UKG-7Q4MX0")).toBeNull();
  });
});
