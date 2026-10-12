import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Stay } from "@/lib/dates";
import { db, EXCLUSION_VIOLATION, violates } from "@/server/db";
import { roomTypeBySlug, type Catalogue } from "@/server/lodge/catalogue";
import { at, freshLodge } from "@/testing/lodge";

import { availabilityByNight, freeCountByType, freeRooms, fullNights } from "./availability";

let lodge: Catalogue;
const now = at("2026-10-12 09:00");
const cottages = () => roomTypeBySlug(lodge, "forest-cottage")!;
const room = (name: string) => cottages().rooms.find((candidate) => candidate.name === name)!;

/** Takes a room off sale for some nights, the way a repair block does. */
async function block(roomId: number, stay: Stay): Promise<void> {
  await db().execute(sql`
    INSERT INTO allocations (room_id, stay, block_reason, created_at)
    VALUES (${roomId}, daterange(${stay.from}::date, ${stay.to}::date), 'Repairs', ${now})
  `);
}

beforeEach(async () => {
  lodge = await freshLodge();
});

describe("the database's own rule", () => {
  it("refuses two stays in one room that share a night", async () => {
    await block(room("Cedar").id, { from: "2026-11-13", to: "2026-11-15" });

    const overlapping = block(room("Cedar").id, { from: "2026-11-14", to: "2026-11-16" });
    await expect(overlapping).rejects.toSatisfy((error) =>
      violates(error, EXCLUSION_VIOLATION, "one_stay_per_room_per_night"),
    );
  });

  it("lets one stay end on the morning the next begins", async () => {
    await block(room("Cedar").id, { from: "2026-11-13", to: "2026-11-15" });
    await expect(block(room("Cedar").id, { from: "2026-11-15", to: "2026-11-17" })).resolves.toBeUndefined();
    await expect(block(room("Cedar").id, { from: "2026-11-10", to: "2026-11-13" })).resolves.toBeUndefined();
  });

  it("keeps rooms apart: the same nights in another room are fine", async () => {
    await block(room("Cedar").id, { from: "2026-11-13", to: "2026-11-15" });
    await expect(block(room("Olive").id, { from: "2026-11-13", to: "2026-11-15" })).resolves.toBeUndefined();
  });

  it("holds when many ask for the same room at the same moment", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => block(room("Fig").id, { from: "2026-12-01", to: "2026-12-04" })),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(11);
  });
});

describe("free rooms", () => {
  const stay = { from: "2026-11-13", to: "2026-11-15" };

  it("offers every room of the type when nothing is booked", async () => {
    const free = await freeRooms(db(), cottages().id, stay, now);
    expect(free.map((entry) => entry.name)).toEqual(["Cedar", "Olive", "Fig", "Croton", "Hagenia"]);
  });

  it("leaves out a room that is taken for any night of the stay", async () => {
    await block(room("Cedar").id, { from: "2026-11-14", to: "2026-11-20" });
    const free = await freeRooms(db(), cottages().id, stay, now);
    expect(free.map((entry) => entry.name)).not.toContain("Cedar");
    expect(free).toHaveLength(4);
  });

  it("prefers the room where the stay sits flush against another, to keep long runs free", async () => {
    await block(room("Croton").id, { from: "2026-11-10", to: "2026-11-13" });
    const free = await freeRooms(db(), cottages().id, stay, now);
    expect(free[0].name).toBe("Croton");
  });

  it("avoids leaving a gap of a night or two that nobody will book", async () => {
    // Cedar would be left with one empty night before the stay.
    await block(room("Cedar").id, { from: "2026-11-09", to: "2026-11-12" });
    const free = await freeRooms(db(), cottages().id, stay, now);
    expect(free[0].name).toBe("Olive");
    expect(free.at(-1)?.name).toBe("Cedar");
  });

  it("counts free rooms by type for a whole stay", async () => {
    await block(room("Cedar").id, { from: "2026-11-13", to: "2026-11-14" });
    await block(room("Olive").id, { from: "2026-11-14", to: "2026-11-15" });
    const counts = await freeCountByType(stay, now);
    expect(counts.get(cottages().id)).toBe(3);
    expect(counts.get(roomTypeBySlug(lodge, "ukingo-house")!.id)).toBe(1);
  });

  it("offers nothing when each night has a room free but no one room has them all", async () => {
    const house = roomTypeBySlug(lodge, "family-cottage")!;
    const [sirimon, chogoria] = house.rooms;
    await block(sirimon.id, { from: "2026-11-13", to: "2026-11-14" });
    await block(chogoria.id, { from: "2026-11-14", to: "2026-11-15" });

    expect(await freeRooms(db(), house.id, stay, now)).toEqual([]);
    // Each night on its own still has one cottage free, so no night is "full".
    expect(await fullNights(house.id, stay, now)).toEqual([]);
  });
});

describe("the calendar", () => {
  it("reports how many rooms of each type are free on each night", async () => {
    const house = roomTypeBySlug(lodge, "ukingo-house")!;
    await block(house.rooms[0].id, { from: "2026-11-14", to: "2026-11-16" });
    await block(room("Cedar").id, { from: "2026-11-13", to: "2026-11-14" });

    const nights = await availabilityByNight("2026-11-13", "2026-11-17", now);
    expect([...nights.keys()]).toEqual(["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(nights.get("2026-11-13")?.free[cottages().id]).toBe(4);
    expect(nights.get("2026-11-14")?.free[cottages().id]).toBe(5);
    expect(nights.get("2026-11-13")?.free[house.id]).toBe(1);
    expect(nights.get("2026-11-14")?.free[house.id]).toBeUndefined();
    expect(nights.get("2026-11-15")?.free[house.id]).toBeUndefined();
    expect(nights.get("2026-11-16")?.free[house.id]).toBe(1);

    expect(await fullNights(house.id, { from: "2026-11-13", to: "2026-11-17" }, now)).toEqual([
      "2026-11-14",
      "2026-11-15",
    ]);
  });
});
