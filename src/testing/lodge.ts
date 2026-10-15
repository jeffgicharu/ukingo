// Helpers shared by the tests.

import { sql } from "drizzle-orm";

import { db } from "@/server/db";
import { forgetCatalogue, loadCatalogue, type Catalogue } from "@/server/lodge/catalogue";
import { seedLodge } from "@/tools/seed";

/** Empties every table and sets the lodge up again, so each test starts from the same place. */
export async function freshLodge(): Promise<Catalogue> {
  await db().execute(sql`
    TRUNCATE settings, room_types, rooms, seasons, season_dates, rates, stay_rules, meal_plans, extras,
      staff, staff_sessions, sign_in_attempts, password_resets,
      guests, bookings, allocations, booking_nights, booking_charges, payments, refunds,
      booking_events, booking_notes, messages, pages, questions, site_text, alerts, room_photos
    RESTART IDENTITY CASCADE
  `);
  await db().transaction((tx) => seedLodge(tx, { refresh: false, years: [2025, 2028] }));
  forgetCatalogue();
  return loadCatalogue();
}

/** A moment given as East Africa Time: at("2026-10-12 09:30"). */
export function at(eastAfricaTime: string): Date {
  const moment = new Date(`${eastAfricaTime.replace(" ", "T")}:00+03:00`);
  if (Number.isNaN(moment.getTime())) throw new Error(`Not a time: ${eastAfricaTime}`);
  return moment;
}
