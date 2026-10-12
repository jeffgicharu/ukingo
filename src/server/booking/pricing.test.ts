import { beforeAll, describe, expect, it } from "vitest";

import { roomTypeBySlug, type Catalogue } from "@/server/lodge/catalogue";
import { at, freshLodge } from "@/testing/lodge";

import { percentOf, priceOfNight, quote, seasonOf } from "./pricing";
import {
  bookableWindow,
  checkDates,
  checkParty,
  keepPercentOn,
  mayChangeDates,
  refundOnCancel,
  termsFor,
} from "./rules";

let lodge: Catalogue;
const cottage = () => roomTypeBySlug(lodge, "forest-cottage")!;
const house = () => roomTypeBySlug(lodge, "ukingo-house")!;
const party = { adults: 2, children: 0 };

beforeAll(async () => {
  lodge = await freshLodge();
});

describe("seasons", () => {
  it("names the season of every night, falling back to the default", () => {
    expect(seasonOf(lodge, "2026-10-12")).toBe("mid");
    expect(seasonOf(lodge, "2026-11-01")).toBe("low");
    expect(seasonOf(lodge, "2026-12-14")).toBe("low");
    expect(seasonOf(lodge, "2026-12-15")).toBe("high");
    expect(seasonOf(lodge, "2027-01-05")).toBe("high");
    expect(seasonOf(lodge, "2027-01-06")).toBe("mid");
  });

  it("prices the Easter weekend as high season inside the long rains", () => {
    // Easter Sunday 2027 is 28 March. In 2026 it was 5 April, inside the rains.
    expect(seasonOf(lodge, "2027-03-26")).toBe("high");
    expect(seasonOf(lodge, "2027-03-30")).toBe("mid");
    expect(seasonOf(lodge, "2026-04-02")).toBe("low");
    expect(seasonOf(lodge, "2026-04-03")).toBe("high");
    expect(seasonOf(lodge, "2026-04-07")).toBe("low");
  });
});

describe("the price of a stay", () => {
  it("charges each night at its own season and day of the week", () => {
    expect(priceOfNight(lodge, cottage(), "2026-10-13")).toEqual({
      night: "2026-10-13",
      cents: 1_700_000,
      season: "mid",
    });
    expect(priceOfNight(lodge, cottage(), "2026-10-16").cents).toBe(1_950_000); // Friday
    expect(priceOfNight(lodge, cottage(), "2026-11-14").cents).toBe(1_650_000); // Saturday, green season
    expect(priceOfNight(lodge, cottage(), "2026-12-25").cents).toBe(2_400_000); // Friday, high season
  });

  it("adds the nights up", () => {
    const result = quote(lodge, {
      roomType: cottage(),
      stay: { from: "2026-10-12", to: "2026-10-15" },
      party,
      mealPlan: "bed_and_breakfast",
    });
    expect(result.nights).toHaveLength(3);
    expect(result.roomCents).toBe(5_100_000);
    expect(result.charges).toEqual([]);
    expect(result.totalCents).toBe(5_100_000);
  });

  it("prices a stay that crosses from one season into another night by night", () => {
    // Sunday 13 and Monday 14 December are green season, Tuesday 15 is high.
    const result = quote(lodge, {
      roomType: cottage(),
      stay: { from: "2026-12-13", to: "2026-12-16" },
      party,
      mealPlan: "bed_and_breakfast",
    });
    expect(result.nights.map((night) => [night.season, night.cents])).toEqual([
      ["low", 1_450_000],
      ["low", 1_450_000],
      ["high", 2_100_000],
    ]);
  });

  it("charges meals per person per night, children at their own price", () => {
    const result = quote(lodge, {
      roomType: house(),
      stay: { from: "2026-10-12", to: "2026-10-14" },
      party: { adults: 4, children: 3 },
      mealPlan: "half_board",
    });
    expect(result.charges).toEqual([
      { kind: "meals", label: "Half board, 4 adults for 2 nights", quantity: 8, unitCents: 350_000, cents: 2_800_000 },
      {
        kind: "meals",
        label: "Half board, 3 children for 2 nights",
        quantity: 6,
        unitCents: 175_000,
        cents: 1_050_000,
      },
    ]);
    expect(result.totalCents).toBe(2 * 6_800_000 + 2_800_000 + 1_050_000);
  });

  it("charges extras per person or once for the booking", () => {
    const walk = lodge.extras.find((extra) => extra.slug === "forest-walk")!;
    const transfer = lodge.extras.find((extra) => extra.slug === "nanyuki-transfer")!;
    const result = quote(lodge, {
      roomType: cottage(),
      stay: { from: "2026-10-12", to: "2026-10-13" },
      party: { adults: 2, children: 0 },
      mealPlan: "bed_and_breakfast",
      extraIds: [walk.id, transfer.id, walk.id],
    });
    expect(result.charges.map((charge) => [charge.label, charge.quantity, charge.cents])).toEqual([
      ["Guided forest walk, 2 guests", 2, 500_000],
      ["Transfer from Nanyuki", 1, 350_000],
    ]);
  });

  it("rounds a share up to a whole shilling and never past the amount", () => {
    expect(percentOf(5_100_000, 30)).toBe(1_530_000);
    expect(percentOf(3_333_300, 30)).toBe(1_000_000);
    expect(percentOf(100, 30)).toBe(100);
    expect(percentOf(5_100_000, 100)).toBe(5_100_000);
  });
});

describe("which dates can be booked", () => {
  const morning = at("2026-10-12 09:00");

  it("opens today until the afternoon cut-off, then from tomorrow", () => {
    expect(bookableWindow(lodge.settings, morning)).toEqual({ first: "2026-10-12", lastDeparture: "2027-10-12" });
    expect(bookableWindow(lodge.settings, at("2026-10-12 16:00")).first).toBe("2026-10-13");

    expect(checkDates(lodge, { from: "2026-10-12", to: "2026-10-13" }, morning)).toBeNull();
    expect(checkDates(lodge, { from: "2026-10-12", to: "2026-10-13" }, at("2026-10-12 16:30"))?.code).toBe(
      "too_late_today",
    );
  });

  it("uses the lodge's date, not the server's", () => {
    // 23:30 UTC on the 11th is already the 12th in Nanyuki.
    const justAfterMidnight = new Date("2026-10-11T23:30:00Z");
    expect(checkDates(lodge, { from: "2026-10-11", to: "2026-10-13" }, justAfterMidnight)?.code).toBe("in_the_past");
    expect(checkDates(lodge, { from: "2026-10-12", to: "2026-10-13" }, justAfterMidnight)).toBeNull();
  });

  it("refuses dates that are not dates, are backwards, are past, or are too far ahead", () => {
    expect(checkDates(lodge, { from: "soon", to: "2026-10-13" }, morning)?.code).toBe("invalid_dates");
    expect(checkDates(lodge, { from: "2026-10-15", to: "2026-10-15" }, morning)?.code).toBe("invalid_dates");
    expect(checkDates(lodge, { from: "2026-10-16", to: "2026-10-15" }, morning)?.code).toBe("invalid_dates");
    expect(checkDates(lodge, { from: "2026-10-01", to: "2026-10-03" }, morning)?.code).toBe("in_the_past");
    expect(checkDates(lodge, { from: "2027-10-11", to: "2027-10-12" }, morning)).toBeNull();
    expect(checkDates(lodge, { from: "2027-10-11", to: "2027-10-13" }, morning)?.code).toBe("too_far_ahead");
  });

  it("limits how long and how short a stay can be", () => {
    expect(checkDates(lodge, { from: "2026-11-01", to: "2026-11-15" }, morning)).toBeNull();
    expect(checkDates(lodge, { from: "2026-11-01", to: "2026-11-16" }, morning)?.code).toBe("too_long");

    const christmas = checkDates(lodge, { from: "2026-12-24", to: "2026-12-26" }, morning);
    expect(christmas?.code).toBe("too_short");
    expect(christmas?.message).toBe("Stays over Christmas and New Year are at least 3 nights.");
    expect(checkDates(lodge, { from: "2026-12-24", to: "2026-12-27" }, morning)).toBeNull();
    // Leaving on the morning the rule starts does not touch it.
    expect(checkDates(lodge, { from: "2026-12-23", to: "2026-12-24" }, morning)).toBeNull();
  });

  it("checks the party against the largest room", () => {
    expect(checkParty(lodge, { adults: 2, children: 1 })).toBeNull();
    expect(checkParty(lodge, { adults: 0, children: 2 })?.code).toBe("invalid_party");
    expect(checkParty(lodge, { adults: 6, children: 3 })?.code).toBe("too_many_guests");
  });
});

describe("the terms a booking is made under", () => {
  const stay = { from: "2026-11-13", to: "2026-11-16" };
  const total = 5_100_000;

  it("asks for a deposit now and the balance two weeks before arrival", () => {
    expect(termsFor(lodge.settings, stay, total, "2026-10-12")).toEqual({
      deposit_percent: 30,
      deposit_cents: 1_530_000,
      balance_due: "2026-10-30",
      change_until: "2026-11-06",
      cancellation: [
        { until: "2026-10-14", keep_percent: 0 },
        { until: "2026-10-30", keep_percent: 30 },
        { until: null, keep_percent: 100 },
      ],
      policy: {
        deposit_percent: 30,
        balance_due_days: 14,
        change_until_days: 7,
        cancellation_steps: [
          { min_days: 30, keep_percent: 0 },
          { min_days: 14, keep_percent: 30 },
          { min_days: 0, keep_percent: 100 },
        ],
      },
    });
  });

  it("asks for everything when the stay is less than two weeks away", () => {
    const terms = termsFor(lodge.settings, stay, total, "2026-10-30");
    expect(terms.deposit_percent).toBe(100);
    expect(terms.deposit_cents).toBe(total);
    expect(terms.balance_due).toBeNull();

    // The day before the balance would fall due, a deposit is still enough.
    expect(termsFor(lodge.settings, stay, total, "2026-10-29").balance_due).toBe("2026-10-30");
  });

  it("stops date changes a week before arrival", () => {
    const terms = termsFor(lodge.settings, stay, total, "2026-10-12");
    expect(mayChangeDates(terms, "2026-11-06")).toBe(true);
    expect(mayChangeDates(terms, "2026-11-07")).toBe(false);
    expect(termsFor(lodge.settings, stay, total, "2026-11-10").change_until).toBeNull();
  });

  it("works out a refund from the terms, the total and what was paid", () => {
    const terms = termsFor(lodge.settings, stay, total, "2026-10-12");
    const deposit = terms.deposit_cents;

    // Thirty days or more before arrival: everything back.
    expect(keepPercentOn(terms, "2026-10-14")).toBe(0);
    expect(refundOnCancel(terms, total, deposit, "2026-10-14")).toEqual({
      keepPercent: 0,
      keptCents: 0,
      refundCents: deposit,
    });

    // From 29 days down to 14: the deposit is kept.
    expect(refundOnCancel(terms, total, deposit, "2026-10-15")).toEqual({
      keepPercent: 30,
      keptCents: deposit,
      refundCents: 0,
    });
    expect(refundOnCancel(terms, total, total, "2026-10-30")).toEqual({
      keepPercent: 30,
      keptCents: 1_530_000,
      refundCents: 3_570_000,
    });

    // Inside 14 days: nothing back, and nothing more is owed.
    expect(refundOnCancel(terms, total, total, "2026-10-31")).toEqual({
      keepPercent: 100,
      keptCents: total,
      refundCents: 0,
    });
    expect(refundOnCancel(terms, total, deposit, "2026-11-12")).toEqual({
      keepPercent: 100,
      keptCents: deposit,
      refundCents: 0,
    });
    expect(refundOnCancel(terms, total, 0, "2026-10-20")).toEqual({ keepPercent: 30, keptCents: 0, refundCents: 0 });
  });
});
