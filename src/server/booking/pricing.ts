// What a stay costs. Pure arithmetic on the catalogue: no database, no clock.

import { type Day, type Stay, isWeekendNight, nightsOf } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { Catalogue, Extra, MealPlan, RoomType } from "@/server/lodge/catalogue";

export type NightPrice = { night: Day; cents: number; season: string };

export type Charge = {
  kind: "meals" | "extra";
  label: string;
  quantity: number;
  unitCents: number;
  cents: number;
  extraId?: number;
};

export type Quote = {
  nights: NightPrice[];
  roomCents: number;
  charges: Charge[];
  totalCents: number;
};

export type Party = { adults: number; children: number };

/** The season a night falls in: the range that names it, or the default season. */
export function seasonOf(catalogue: Catalogue, night: Day): string {
  for (const range of catalogue.seasonRanges) {
    if (range.from <= night && night < range.to) return range.season;
  }
  const fallback = catalogue.seasons.find((season) => season.isDefault) ?? catalogue.seasons[0];
  if (!fallback) throw new Error("No seasons are set up");
  return fallback.code;
}

export function seasonName(catalogue: Catalogue, code: string): string {
  return catalogue.seasons.find((season) => season.code === code)?.name ?? code;
}

export function priceOfNight(catalogue: Catalogue, roomType: RoomType, night: Day): NightPrice {
  const season = seasonOf(catalogue, night);
  const rate = roomType.rates[season];
  if (!rate) {
    throw new Error(`${roomType.name} has no price for ${season}`);
  }
  return { night, cents: isWeekendNight(night) ? rate.weekend : rate.weeknight, season };
}

export function mealCharges(plan: MealPlan, party: Party, nightCount: number): Charge[] {
  const charges: Charge[] = [];
  if (plan.adultCents > 0 && party.adults > 0) {
    const quantity = party.adults * nightCount;
    charges.push({
      kind: "meals",
      label: `${plan.name}, ${plural(party.adults, "adult")} for ${plural(nightCount, "night")}`,
      quantity,
      unitCents: plan.adultCents,
      cents: quantity * plan.adultCents,
    });
  }
  if (plan.childCents > 0 && party.children > 0) {
    const quantity = party.children * nightCount;
    charges.push({
      kind: "meals",
      label: `${plan.name}, ${plural(party.children, "child", "children")} for ${plural(nightCount, "night")}`,
      quantity,
      unitCents: plan.childCents,
      cents: quantity * plan.childCents,
    });
  }
  return charges;
}

export function extraCharge(extra: Extra, party: Party): Charge {
  const quantity = extra.charged === "per_person" ? party.adults + party.children : 1;
  return {
    kind: "extra",
    label: extra.charged === "per_person" ? `${extra.name}, ${plural(quantity, "guest")}` : extra.name,
    quantity,
    unitCents: extra.priceCents,
    cents: quantity * extra.priceCents,
    extraId: extra.id,
  };
}

export function quote(
  catalogue: Catalogue,
  request: { roomType: RoomType; stay: Stay; party: Party; mealPlan: string; extraIds?: number[] },
): Quote {
  const nights = nightsOf(request.stay).map((night) => priceOfNight(catalogue, request.roomType, night));
  const roomCents = nights.reduce((sum, night) => sum + night.cents, 0);

  const plan = catalogue.mealPlans.find((candidate) => candidate.code === request.mealPlan);
  if (!plan) {
    throw new Error(`Unknown meal plan: ${request.mealPlan}`);
  }

  const charges = mealCharges(plan, request.party, nights.length);
  for (const id of new Set(request.extraIds ?? [])) {
    const extra = catalogue.extras.find((candidate) => candidate.id === id);
    if (extra) charges.push(extraCharge(extra, request.party));
  }

  return {
    nights,
    roomCents,
    charges,
    totalCents: roomCents + charges.reduce((sum, charge) => sum + charge.cents, 0),
  };
}

/** A share of an amount, rounded up to the next whole shilling. */
export function percentOf(cents: number, percent: number): number {
  return Math.min(cents, Math.ceil((cents * percent) / 100 / 100) * 100);
}
