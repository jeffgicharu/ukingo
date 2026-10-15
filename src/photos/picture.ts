// One photograph, wherever it came from: one the site was built with, or one
// staff put up from the back office. Plain data, so a page can hand it on.

import type { PhotoPlace } from "@/server/db/schema";

import { descriptions } from "./descriptions";
import { photos, type PhotoRecord } from "./manifest";

export const PLACES: readonly PhotoPlace[] = ["main", "inside", "detail"];

export const isPlace = (value: string): value is PhotoPlace => (PLACES as readonly string[]).includes(value);

/** What each place is called on the back-office screen. */
export const PLACE_NAMES: Record<PhotoPlace, string> = {
  main: "Main photograph",
  inside: "Inside",
  detail: "Detail",
};

/** "the inside photograph of Forest Cottage" */
export const photographOf = (place: PhotoPlace, room: string) => `the ${place} photograph of ${room}`;

/** The name a place's photograph has among the ones the site was built with. */
export const builtInName = (slug: string, place: PhotoPlace) =>
  `${slug}${{ main: "", inside: "-inside", detail: "-detail" }[place]}`;

export type Picture = PhotoRecord & {
  /** The start of each copy's address: `${base}-${width}.${format}${version}`. */
  base: string;
  /** What ends the address, so a browser never shows an old copy. */
  version: string;
  /** What it shows, in words, for someone who cannot see it. */
  description?: string;
};

/** A photograph the site was built with, or null when there is none of that name. */
export function builtIn(name: string): Picture | null {
  const record = photos[name];
  if (!record) return null;
  return { ...record, base: `/photos/${name}`, version: `?v=${record.stamp}`, description: descriptions[name] };
}

/**
 * A photograph staff put up. Its saved name already changes with every new
 * photograph, so the address needs nothing more on the end.
 */
export function uploaded(row: {
  file: string;
  width: number;
  height: number;
  widths: number[];
  colour: string;
  description: string;
}): Picture {
  return {
    width: row.width,
    height: row.height,
    widths: [...row.widths].sort((a, b) => a - b),
    colour: row.colour,
    stamp: row.file,
    base: `/uploads/${row.file}`,
    version: "",
    description: row.description,
  };
}

export function pictureAddress(picture: Picture, width: number, format: "avif" | "webp" | "jpg"): string {
  return `${picture.base}-${width}.${format}${picture.version}`;
}

/** The three photographs of a kind of room: the ones put up from the back office, or else the ones it was built with. */
export function roomPictures(
  slug: string,
  rows: (Parameters<typeof uploaded>[0] & { place: PhotoPlace })[],
): Record<PhotoPlace, Picture | null> {
  const pick = (place: PhotoPlace) => {
    const row = rows.find((candidate) => candidate.place === place);
    return row ? uploaded(row) : builtIn(builtInName(slug, place));
  };
  return { main: pick("main"), inside: pick("inside"), detail: pick("detail") };
}
