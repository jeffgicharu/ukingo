// Photographs staff put up from the back office: checked, saved at the widths
// and in the formats the site serves, and taken down again.
//
// A photograph from a phone is several megabytes and carries where it was
// taken. What is kept here is four smaller copies in each of three formats,
// with nothing in them but the picture.

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp, { type Metadata, type OutputInfo } from "sharp";

import { MOST_PHOTO_BYTES, photoFolder, PhotoError, WIDTHS } from "./photo-files";

const FEWEST_PIXELS_WIDE = 1200;
// Larger than any phone's camera. A file claiming more is refused before it is opened.
const MOST_PIXELS = 64_000_000;
// Every frame a room photograph is shown in is 4:3, as are the photographs
// the site was built with. A photograph of another shape is trimmed to it,
// keeping the middle, so it fills each frame without being stretched. Too far
// from that shape, and too much would be lost.
const FRAME = 4 / 3;
const NARROWEST = 1.2;
const WIDEST = 2.05;

// One photograph at a time, with no copies kept in memory: the site shares
// its server and its memory with other work.
sharp.concurrency(1);
sharp.cache(false);

export type PreparedPhoto = { file: string; width: number; height: number; widths: number[]; colour: string };

const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");

/**
 * Checks a photograph and saves its copies under a new name beginning with
 * `name`. Returns what a page needs to show it. Nothing is saved if it fails.
 */
export async function preparePhoto(bytes: Uint8Array, name: string): Promise<PreparedPhoto> {
  if (bytes.byteLength === 0) throw new PhotoError("Choose a photograph to put up.");
  if (bytes.byteLength > MOST_PHOTO_BYTES) {
    throw new PhotoError("That file is over 10 MB. Save a smaller copy of it and try again.");
  }

  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: MOST_PIXELS }).metadata();
  } catch {
    throw new PhotoError("That file is not a photograph this site can use. Choose a JPEG, PNG or WebP.");
  }
  if (!["jpeg", "png", "webp"].includes(meta.format ?? "")) {
    throw new PhotoError("That file is not a photograph this site can use. Choose a JPEG, PNG or WebP.");
  }
  if ((meta.pages ?? 1) > 1) {
    throw new PhotoError("That file holds a moving picture. Choose a still photograph.");
  }
  if (!meta.width || !meta.height || meta.width * meta.height > MOST_PIXELS) {
    throw new PhotoError("That photograph is larger than any camera makes. Save a smaller copy of it and try again.");
  }

  // A phone held on its side saves the picture sideways and says so in the file.
  const turned = (meta.orientation ?? 1) >= 5;
  const taken = { width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height };
  const shape = taken.width / taken.height;
  if (shape < NARROWEST) {
    throw new PhotoError(
      "That photograph is too tall for its frame. The site shows room photographs in landscape, so choose one clearly wider than it is tall.",
    );
  }
  if (shape > WIDEST) {
    throw new PhotoError(
      "That photograph is too long and thin for its frame. Choose one no more than twice as wide as it is tall.",
    );
  }
  // What is left once it is trimmed to the frame.
  const kept = shape > FRAME ? Math.round(taken.height * FRAME) : taken.width;
  if (kept < FEWEST_PIXELS_WIDE) {
    throw new PhotoError(
      `That photograph is ${kept.toLocaleString("en-GB")} pixels wide${kept < taken.width ? " once trimmed to the site's 4:3 frame" : ""}. Choose one at least ${FEWEST_PIXELS_WIDE.toLocaleString("en-GB")} wide, or it will look soft on a laptop.`,
    );
  }

  // Read once, the right way up and trimmed to the frame, at no more than the largest width served.
  const widest = Math.min(kept, WIDTHS[WIDTHS.length - 1]);
  const width = widest;
  const height = Math.round(widest / FRAME);
  let pixels: { data: Buffer; info: OutputInfo };
  try {
    pixels = await sharp(bytes, { limitInputPixels: MOST_PIXELS })
      .rotate()
      .resize({ width, height, fit: "cover", position: "centre" })
      // Anything see-through is laid on white, as a page would show it.
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new PhotoError("That photograph could not be read. It may be damaged. Try another copy of it.");
  }
  const source = () =>
    sharp(pixels.data, {
      raw: { width: pixels.info.width, height: pixels.info.height, channels: pixels.info.channels },
    });

  // The average colour, shown while the photograph loads.
  const { channels } = await source().resize(64).stats();
  const colour = `#${channels
    .slice(0, 3)
    .map((channel) => hex(channel.mean))
    .join("")}`;

  const widths = WIDTHS.filter((size) => size <= widest);
  // A new name for every photograph put up, so no browser or cache can show an old one under it.
  const file = `${name}-${randomBytes(5).toString("hex")}`;
  const dir = photoFolder();
  await mkdir(dir, { recursive: true });

  // One copy at a time. Where the image library runs as WebAssembly, copies
  // made side by side ran it out of memory.
  const started: string[] = [];
  try {
    for (const size of widths) {
      for (const format of ["avif", "webp", "jpg"] as const) {
        const target = path.join(dir, `${file}-${size}.${format}`);
        started.push(target);
        const sized = source().resize({ width: size });
        const copy = await (
          format === "avif"
            ? // Phones draw the 800-wide copy at over twice the density of an ordinary
              // screen, where saving it harder cannot be seen.
              sized.avif({ quality: size === 800 ? 42 : 50, effort: 0 })
            : format === "webp"
              ? sized.webp({ quality: 72, effort: 4 })
              : sized.jpeg({ quality: 74, mozjpeg: true })
        ).toBuffer();
        await writeFile(`${target}.part`, copy);
        await rename(`${target}.part`, target);
      }
    }
  } catch (error) {
    await Promise.all(
      started.flatMap((target) => [rm(target, { force: true }), rm(`${target}.part`, { force: true })]),
    );
    throw error;
  }

  return { file, width, height, widths, colour };
}
