// Where photographs put up from the back office are kept, and reading and
// removing their copies. The work of making the copies is in photos.ts.

import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { env } from "@/server/env";

/** The same widths as the photographs the site was built with, so pages ask for the same sizes. */
export const WIDTHS = [480, 800, 1200, 1600];
export const TYPES = { avif: "image/avif", webp: "image/webp", jpg: "image/jpeg" } as const;
export const MOST_PHOTO_BYTES = 10 * 1024 * 1024;

const FILE_NAME = /^([a-z0-9-]+)-(\d{3,4})\.(avif|webp|jpg)$/;

/** Something wrong with the photograph chosen, in words for the person who chose it. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

export function photoFolder(): string {
  const dir = env.mediaDir;
  if (!dir) throw new PhotoError("Photographs cannot be put up on this server yet: it has no place to keep them.");
  return path.resolve(dir, "photos");
}

/** Removes every copy of a photograph. Copies already gone are no trouble. */
export async function removePhotoFiles(file: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(file)) return;
  const dir = photoFolder();
  await Promise.all(
    WIDTHS.flatMap((size) =>
      (Object.keys(TYPES) as (keyof typeof TYPES)[]).map((format) =>
        rm(path.join(dir, `${file}-${size}.${format}`), { force: true }),
      ),
    ),
  );
}

/** One saved copy, by the name in its address, or null when there is no such copy. */
export async function readPhotoFile(name: string): Promise<{ body: Buffer; type: string } | null> {
  const match = FILE_NAME.exec(name);
  if (!match) return null;
  try {
    return { body: await readFile(path.join(photoFolder(), name)), type: TYPES[match[3] as keyof typeof TYPES] };
  } catch {
    return null;
  }
}
