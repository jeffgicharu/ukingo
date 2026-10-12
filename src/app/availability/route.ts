import { connection } from "next/server";

import { addMonths, isDay, maxDay, minDay, startOfMonth } from "@/lib/dates";
import { availabilityByNight } from "@/server/booking/availability";
import { priceOfNight } from "@/server/booking/pricing";
import { bookableWindow } from "@/server/booking/rules";
import { clock } from "@/server/clock";
import { json } from "@/server/http";
import { catalogue, roomTypeBySlug } from "@/server/lodge/catalogue";

// What the date calendar shows: for each night of a month or two, whether a
// room is free and the least it costs. /availability?from=2026-11-01&months=2
// With &room=forest-cottage the answer is for that kind of room only.
export async function GET(request: Request) {
  await connection();

  const query = new URL(request.url).searchParams;
  const lodge = await catalogue();
  const now = clock.now();
  const window = bookableWindow(lodge.settings, now);

  const asked = query.get("from");
  const months = Math.min(3, Math.max(1, Number(query.get("months")) || 1));
  const monthStart = startOfMonth(isDay(asked) ? asked : window.first);
  const from = maxDay(monthStart, window.first);
  const to = minDay(addMonths(monthStart, months), window.lastDeparture);

  const roomSlug = query.get("room");
  const only = roomSlug ? roomTypeBySlug(lodge, roomSlug) : undefined;
  const types = only ? [only] : lodge.roomTypes;

  const nights: Record<string, { free: number; from: number | null }> = {};
  if (from < to) {
    const byNight = await availabilityByNight(from, to, now);
    for (const [night, { free }] of byNight) {
      let rooms = 0;
      let least: number | null = null;
      for (const type of types) {
        const count = free[type.id] ?? 0;
        if (count === 0) continue;
        rooms += count;
        const price = priceOfNight(lodge, type, night).cents;
        least = least === null ? price : Math.min(least, price);
      }
      nights[night] = { free: rooms, from: least };
    }
  }

  return json({ first: window.first, lastDeparture: window.lastDeparture, nights });
}
