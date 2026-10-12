// "What is free for these dates?" The answer a guest sees after choosing dates.

import { type Day, type Stay, isDay } from "@/lib/dates";
import type { Catalogue, RoomType } from "@/server/lodge/catalogue";

import { availabilityByNight, freeCountByType } from "./availability";
import { quote, type Party, type Quote } from "./pricing";
import { fits } from "./rules";

export type StayQuery = {
  from?: string;
  to?: string;
  adults: number;
  children: number;
  /** A room type's slug, when the guest is looking at one kind of room. */
  room?: string;
  /** False when the address carried no dates at all. */
  asked: boolean;
};

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

function count(value: string | undefined, fallback: number, max: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : fallback;
}

/** Reads dates and guests from an address such as /stay?in=2026-11-13&out=2026-11-15&adults=2. */
export function readStayQuery(params: Params): StayQuery {
  const from = first(params.in);
  const to = first(params.out);
  const room = first(params.room);
  return {
    from,
    to,
    adults: Math.max(1, count(first(params.adults), 2, 30)),
    children: count(first(params.children), 0, 30),
    room: room && /^[a-z0-9-]{1,60}$/.test(room) ? room : undefined,
    asked: from !== undefined || to !== undefined,
  };
}

/** The same question as an address, for links and redirects. */
export function stayAddress(
  path: string,
  stay: Stay,
  party: Party,
  more: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(more)) {
    if (value) params.set(key, value);
  }
  params.set("in", stay.from);
  params.set("out", stay.to);
  params.set("adults", String(party.adults));
  params.set("children", String(party.children));
  return `${path}?${params}`;
}

export function hasDates(query: StayQuery): query is StayQuery & Stay {
  return isDay(query.from) && isDay(query.to);
}

export type Offer = {
  roomType: RoomType;
  state: "free" | "too_small" | "full";
  /** Rooms of this type free for the whole stay. */
  free: number;
  /** The price with breakfast, when the room can be booked. */
  quote?: Quote;
  /**
   * When full: the nights on which every room of this type is taken. Empty
   * when each night has a room free but no single room is free for them all.
   */
  fullNights: Day[];
};

/** Every kind of room, the ones that can be booked first. */
export async function searchStay(catalogue: Catalogue, stay: Stay, party: Party, now: Date): Promise<Offer[]> {
  const [freeCounts, byNight] = await Promise.all([
    freeCountByType(stay, now),
    availabilityByNight(stay.from, stay.to, now),
  ]);

  const offers = catalogue.roomTypes.map((roomType): Offer => {
    const free = freeCounts.get(roomType.id) ?? 0;

    if (!fits(roomType, party)) {
      return { roomType, state: "too_small", free, fullNights: [] };
    }
    if (free === 0) {
      const fullNights = [...byNight.entries()].filter(([, night]) => !night.free[roomType.id]).map(([day]) => day);
      return { roomType, state: "full", free, fullNights };
    }
    return {
      roomType,
      state: "free",
      free,
      quote: quote(catalogue, { roomType, stay, party, mealPlan: defaultMealPlan(catalogue) }),
      fullNights: [],
    };
  });

  const order = { free: 0, full: 1, too_small: 2 };
  return offers.sort((a, b) => order[a.state] - order[b.state]);
}

/** The plan every price starts from: the one that adds nothing. */
export function defaultMealPlan(catalogue: Catalogue): string {
  const included = catalogue.mealPlans.find((plan) => plan.adultCents === 0 && plan.childCents === 0);
  return (included ?? catalogue.mealPlans[0]).code;
}
