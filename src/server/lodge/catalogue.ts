// What the lodge sells and the rules it sells under, read in one go.
//
// Pricing and availability are worked out from this snapshot, so one request
// never mixes an old price with a new rule.

import { asc, eq } from "drizzle-orm";

import type { Day } from "@/lib/dates";
import { roomPictures, type Picture } from "@/photos/picture";
import { db, schema, type Queryable } from "@/server/db";
import type { CancellationStep, PhotoPlace } from "@/server/db/schema";

export type Settings = {
  lodgeName: string;
  place: string;
  checkInFrom: string;
  checkOutBy: string;
  holdMinutes: number;
  provisionalHours: number;
  depositPercent: number;
  balanceDueDays: number;
  changeUntilDays: number;
  cancellationSteps: CancellationStep[];
  bookingWindowMonths: number;
  sameDayUntilHour: number;
  maxNights: number;
};

export type Room = { id: number; name: string; position: number };

export type RoomType = {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  sleeps: number;
  bedrooms: number;
  beds: string;
  sizeSqm: number | null;
  features: string[];
  rooms: Room[];
  /** Price per night by season code, in cents. */
  rates: Record<string, { weeknight: number; weekend: number }>;
  /** The lowest price a night can cost, in cents. */
  fromCents: number;
  /** Its three photographs. Null where it has none. */
  photos: Record<PhotoPlace, Picture | null>;
};

export type Season = { code: string; name: string; isDefault: boolean };
export type SeasonRange = { season: string; from: Day; to: Day; label: string };
export type StayRule = { from: Day; to: Day; minNights: number; label: string };
export type MealPlan = { code: string; name: string; description: string; adultCents: number; childCents: number };
export type Extra = {
  id: number;
  slug: string;
  name: string;
  description: string;
  duration: string;
  priceCents: number;
  charged: "per_person" | "per_booking";
};

export type Catalogue = {
  settings: Settings;
  roomTypes: RoomType[];
  seasons: Season[];
  seasonRanges: SeasonRange[];
  stayRules: StayRule[];
  mealPlans: MealPlan[];
  extras: Extra[];
};

/** Reads the catalogue as it is right now. Pass a transaction to read inside it. */
export async function loadCatalogue(q: Queryable = db()): Promise<Catalogue> {
  // One query at a time: inside a transaction they all share one connection.
  const settingsRows = await q.select().from(schema.settings);
  const typeRows = await q
    .select()
    .from(schema.roomTypes)
    .where(eq(schema.roomTypes.active, true))
    .orderBy(asc(schema.roomTypes.position));
  const roomRows = await q
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.active, true))
    .orderBy(asc(schema.rooms.position));
  const seasonRows = await q.select().from(schema.seasons).orderBy(asc(schema.seasons.position));
  const rangeRows = await q.select().from(schema.seasonDates);
  const rateRows = await q.select().from(schema.rates);
  const photoRows = await q.select().from(schema.roomPhotos);
  const ruleRows = await q.select().from(schema.stayRules);
  const planRows = await q
    .select()
    .from(schema.mealPlans)
    .where(eq(schema.mealPlans.active, true))
    .orderBy(asc(schema.mealPlans.position));
  const extraRows = await q
    .select()
    .from(schema.extras)
    .where(eq(schema.extras.active, true))
    .orderBy(asc(schema.extras.position));

  const settings = settingsRows[0];
  if (!settings) {
    throw new Error("The lodge has not been set up. Run the seed tool.");
  }

  const seasonCodes = new Map(seasonRows.map((season) => [season.id, season.code]));

  const roomTypes: RoomType[] = typeRows.map((type) => {
    const rates: RoomType["rates"] = {};
    for (const rate of rateRows) {
      if (rate.roomTypeId !== type.id) continue;
      const code = seasonCodes.get(rate.seasonId);
      if (code) rates[code] = { weeknight: rate.weeknightCents, weekend: rate.weekendCents };
    }
    const prices = Object.values(rates).flatMap((rate) => [rate.weeknight, rate.weekend]);
    return {
      id: type.id,
      slug: type.slug,
      name: type.name,
      tagline: type.tagline,
      description: type.description,
      sleeps: type.sleeps,
      bedrooms: type.bedrooms,
      beds: type.beds,
      sizeSqm: type.sizeSqm,
      features: type.features,
      rooms: roomRows
        .filter((room) => room.roomTypeId === type.id)
        .map((room) => ({ id: room.id, name: room.name, position: room.position })),
      rates,
      fromCents: prices.length ? Math.min(...prices) : 0,
      photos: roomPictures(
        type.slug,
        photoRows.filter((photo) => photo.roomTypeId === type.id),
      ),
    };
  });

  return {
    settings: {
      lodgeName: settings.lodgeName,
      place: settings.place,
      checkInFrom: settings.checkInFrom,
      checkOutBy: settings.checkOutBy,
      holdMinutes: settings.holdMinutes,
      provisionalHours: settings.provisionalHours,
      depositPercent: settings.depositPercent,
      balanceDueDays: settings.balanceDueDays,
      changeUntilDays: settings.changeUntilDays,
      cancellationSteps: settings.cancellationSteps,
      bookingWindowMonths: settings.bookingWindowMonths,
      sameDayUntilHour: settings.sameDayUntilHour,
      maxNights: settings.maxNights,
    },
    roomTypes,
    seasons: seasonRows.map((season) => ({ code: season.code, name: season.name, isDefault: season.isDefault })),
    seasonRanges: rangeRows
      .map((range) => ({
        season: seasonCodes.get(range.seasonId) ?? "",
        from: range.dates.from,
        to: range.dates.to,
        label: range.label,
      }))
      .sort((a, b) => a.from.localeCompare(b.from)),
    stayRules: ruleRows.map((rule) => ({
      from: rule.dates.from,
      to: rule.dates.to,
      minNights: rule.minNights,
      label: rule.label,
    })),
    mealPlans: planRows.map((plan) => ({
      code: plan.code,
      name: plan.name,
      description: plan.description,
      adultCents: plan.adultCents,
      childCents: plan.childCents,
    })),
    extras: extraRows.map((extra) => ({
      id: extra.id,
      slug: extra.slug,
      name: extra.name,
      description: extra.description,
      duration: extra.duration,
      priceCents: extra.priceCents,
      charged: extra.charged,
    })),
  };
}

// Pages that only show the catalogue share one copy for a few seconds. Making
// a booking never uses this: it reads the catalogue afresh inside its transaction.
const FRESH_FOR_MS = 15_000;
let kept: { at: number; value: Promise<Catalogue> } | undefined;

export function catalogue(): Promise<Catalogue> {
  const now = Date.now();
  if (!kept || now - kept.at > FRESH_FOR_MS) {
    const value = loadCatalogue();
    kept = { at: now, value };
    // A failed read must not be remembered.
    value.catch(() => {
      if (kept?.value === value) kept = undefined;
    });
  }
  return kept.value;
}

/** Call after staff change anything in the catalogue, so the next page sees it. */
export function forgetCatalogue(): void {
  kept = undefined;
}

export function roomTypeBySlug(catalogue: Catalogue, slug: string): RoomType | undefined {
  return catalogue.roomTypes.find((type) => type.slug === slug);
}

export function roomTypeById(catalogue: Catalogue, id: number): RoomType | undefined {
  return catalogue.roomTypes.find((type) => type.id === id);
}
