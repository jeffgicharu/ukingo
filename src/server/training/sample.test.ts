import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { checkBooks } from "@/jobs/books";
import { addDays, lodgeDay } from "@/lib/dates";
import { holdBooking } from "@/server/booking/service";
import { db, schema } from "@/server/db";
import { balances, refundsList } from "@/server/desk/money";
import { board } from "@/server/desk/board";
import { at, freshLodge } from "@/testing/lodge";

import { rebuildTraining, TRAINING_STAFF } from "./sample";

const monday = at("2026-10-12 09:00");

beforeEach(async () => {
  await freshLodge();
});

describe("the books of a training lodge", () => {
  it("are written around today, and add up", async () => {
    const written = await rebuildTraining(monday);
    expect(written.bookings).toBeGreaterThan(300);

    const today = lodgeDay(monday);
    const [range] = (
      await db().execute<{ first: string; last: string; real: number }>(sql`
        SELECT min(lower(stay))::text AS first, max(upper(stay))::text AS last,
          count(*) FILTER (WHERE NOT sample)::int AS real
        FROM bookings
      `)
    ).rows;
    // Six months back and four months ahead, and every booking is marked as a sample.
    expect(range.first <= addDays(today, -170)).toBe(true);
    expect(range.first >= addDays(today, -200)).toBe(true);
    expect(range.last >= addDays(today, 60)).toBe(true);
    expect(range.real).toBe(0);

    // Nothing the nightly check would complain about.
    expect(await checkBooks()).toEqual([]);

    // The people trainees sign in as are there, and marked as such.
    const staff = await db().select().from(schema.staff).where(eq(schema.staff.training, true));
    expect(staff.map((person) => person.email).sort()).toEqual(TRAINING_STAFF.map((person) => person.email).sort());
  });

  it("give every screen something to work on, whatever the day", async () => {
    // A spread of days across the year, weekdays and weekends, at different hours.
    for (const moment of [
      "2026-10-12 09:00",
      "2026-11-07 17:30",
      "2026-12-25 12:00",
      "2027-02-03 07:15",
      "2027-06-19 21:00",
    ]) {
      const now = at(moment);
      await rebuildTraining(now);
      const today = await board(now);

      expect(today.arrivals.length, `arrivals on ${moment}`).toBeGreaterThanOrEqual(2);
      expect(today.departures.length, `departures on ${moment}`).toBeGreaterThanOrEqual(2);
      expect(
        today.inHouse.length + today.arrivals.filter((entry) => entry.booking.status === "checked_in").length,
        `in house on ${moment}`,
      ).toBeGreaterThanOrEqual(3);
      expect(today.overdue.length, `overdue on ${moment}`).toBeGreaterThanOrEqual(1);
      expect(today.lapsingSoon.length, `lapsing on ${moment}`).toBeGreaterThanOrEqual(1);
      expect(today.refundsOwed.length, `refunds on ${moment}`).toBeGreaterThanOrEqual(1);
      expect(today.occupiedTonight, `occupied on ${moment}`).toBeGreaterThanOrEqual(4);

      const owing = await balances(lodgeDay(now));
      expect(owing.overdue.length).toBeGreaterThanOrEqual(1);
      expect((await refundsList()).owed.length).toBeGreaterThanOrEqual(1);
      expect(await checkBooks(), `books on ${moment}`).toEqual([]);

      // A guest three weeks out with a balance still to pay, for a visitor to try paying.
      const toPay = await db().execute(sql`
        SELECT 1 FROM bookings b
        WHERE b.status = 'confirmed' AND lower(b.stay) >= ${addDays(lodgeDay(now), 16)}::date
          AND b.total_cents > (SELECT coalesce(sum(cents), 0) FROM payments p WHERE p.booking_id = b.id AND p.status = 'paid')
        LIMIT 1
      `);
      expect(toPay.rows.length, `a balance to pay on ${moment}`).toBe(1);
    }
  });

  it("keep the same stays from one day to the next, a day further on", async () => {
    const stays = async () =>
      (
        await db().execute<{ stay: string }>(sql`
          SELECT room_id || ' ' || lower(stay) || ' ' || upper(stay) || ' ' || guest_name AS stay
          FROM bookings
          WHERE lower(stay) BETWEEN '2026-07-01' AND '2026-09-15' AND status = 'checked_out'
          ORDER BY 1
        `)
      ).rows.map((row) => row.stay);

    await rebuildTraining(monday);
    const first = await stays();
    await rebuildTraining(at("2026-10-13 09:00"));
    const second = await stays();

    expect(first.length).toBeGreaterThan(60);
    expect(second).toEqual(first);
  });

  it("throw away what visitors did, and leave the lodge's setup and real staff alone", async () => {
    const [owner] = await db()
      .insert(schema.staff)
      .values({ name: "Ada Owner", email: "ada@ukingo.test", passwordHash: "x", role: "owner" })
      .returning({ id: schema.staff.id });
    await rebuildTraining(monday);
    const visitor = await holdBooking(
      {
        roomType: "ukingo-house",
        stay: { from: "2027-01-20", to: "2027-01-22" },
        party: { adults: 6, children: 0 },
        mealPlan: "bed_and_breakfast",
        extraIds: [],
        guest: { name: "A Visitor", phone: "+254712345678", email: "visitor@mailbox.org" },
        ip: "197.232.1.10",
      },
      monday,
    );
    const [before] = await db().select().from(schema.settings);

    await rebuildTraining(at("2026-10-13 03:30"));

    expect(await db().select().from(schema.bookings).where(eq(schema.bookings.reference, visitor.reference))).toEqual(
      [],
    );
    expect(await db().select().from(schema.guests).where(eq(schema.guests.sample, false))).toEqual([]);
    const [after] = await db().select().from(schema.settings);
    expect(after).toEqual(before);
    const [kept] = await db().select().from(schema.staff).where(eq(schema.staff.id, owner.id));
    expect(kept).toMatchObject({ name: "Ada Owner", active: true, training: false });
  });
});
