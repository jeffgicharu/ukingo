// Photographs put up from the back office, as the server keeps them.
//
// The staff member's own browser makes each photograph ready: turned the
// right way up, trimmed to the 4:3 frame the site shows it in, and saved at
// each width as a JPEG, and as a WebP where the browser can make one (see
// components/desk/photo-upload.tsx). Only those copies are sent: not the
// original, and nothing about where it was taken. The server checks that each
// copy is the kind of file it claims to be and exactly the size it should be,
// strips anything in it that is not the picture, and keeps it.
//
// The work is done in the browser because this server cannot do it: its
// processor is too old for the image library's native and WebAssembly builds,
// and a library written in plain JavaScript needed all the memory the site
// is allowed.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { copyHeight, UPLOAD, type CopyFormat } from "@/photos/picture";
import { env } from "@/server/env";

export const TYPES = { avif: "image/avif", webp: "image/webp", jpg: "image/jpeg" } as const;

/** No copy the browser makes comes near this. */
const MOST_COPY_BYTES = 3 * 1024 * 1024;

const FILE_NAME = /^([a-z0-9-]+)-(\d{3,4})\.(avif|webp|jpg)$/;

/** Something wrong with the photograph chosen, in words for the person who chose it. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

export type Copy = { format: CopyFormat; width: number; bytes: Uint8Array };

export type KeptPhoto = { file: string; width: number; height: number; widths: number[]; formats: CopyFormat[] };

export function photoFolder(): string {
  const dir = env.mediaDir;
  if (!dir) throw new PhotoError("Photographs cannot be put up on this server yet: it has no place to keep them.");
  return path.resolve(dir, "photos");
}

const word = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const text = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));

/** A JPEG's width and height, read from its frame header. Null when it is not a JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // A start-of-frame marker, but not the three that share its range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: word(bytes, at + 5), width: word(bytes, at + 7) };
    }
    if (marker === 0xda || marker === 0xd9) return null;
    at += 2 + word(bytes, at + 2);
  }
  return null;
}

/**
 * The JPEG with only the picture left in it. Every application segment but
 * the first, and every comment, goes: that is where cameras keep where and
 * when a photograph was taken.
 */
export function bareJpeg(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    const marker = bytes[at + 1];
    // From the start of the scan to the end, it is all picture.
    if (marker === 0xda) {
      kept.push(bytes.subarray(at));
      break;
    }
    const end = at + 2 + word(bytes, at + 2);
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) kept.push(bytes.subarray(at, end));
    at = end;
  }
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * A WebP's width and height. Null when it is not a WebP, or when it carries
 * more than a still picture: movement, or notes about where it was taken.
 */
export function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 4) !== "WEBP") return null;
  const chunk = text(bytes, 12, 4);
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // Movement, a note of where it was taken, or another kind of note.
    if (bytes[20] & (0x02 | 0x04 | 0x08)) return null;
    return {
      width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
      height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
    };
  }
  return null;
}

/**
 * Checks the copies a browser made of one photograph, and returns them ready
 * to keep. There must be a JPEG at each width from the smallest up, and a
 * WebP beside every one of them or beside none.
 */
export function checkCopies(copies: Copy[]): Copy[] {
  const jpegs = copies.filter((copy) => copy.format === "jpg");
  const webps = copies.filter((copy) => copy.format === "webp");
  const widths = jpegs.map((copy) => copy.width).sort((a, b) => a - b);
  const expected = UPLOAD.widths.slice(0, widths.length);
  const wrongSet =
    widths.length < 3 ||
    widths.some((width, index) => width !== expected[index]) ||
    (webps.length > 0 && (webps.length !== jpegs.length || webps.some((copy) => !widths.includes(copy.width))));
  if (wrongSet) {
    throw new PhotoError("The photograph did not arrive whole. Please choose it and put it up again.");
  }

  return copies.map((copy) => {
    if (copy.bytes.byteLength === 0 || copy.bytes.byteLength > MOST_COPY_BYTES) {
      throw new PhotoError("The photograph did not arrive whole. Please choose it and put it up again.");
    }
    const size = copy.format === "jpg" ? jpegSize(copy.bytes) : webpSize(copy.bytes);
    if (!size || size.width !== copy.width || size.height !== copyHeight(copy.width)) {
      throw new PhotoError(
        "The photograph was not made ready as this site needs. Please try again in another browser.",
      );
    }
    return copy.format === "jpg" ? { ...copy, bytes: bareJpeg(copy.bytes) } : copy;
  });
}

/** Keeps the checked copies under a new name beginning with `name`. Nothing is kept if this fails. */
export async function keepPhoto(name: string, copies: Copy[]): Promise<KeptPhoto> {
  const checked = checkCopies(copies);
  // A new name for every photograph put up, so no browser or cache can show an old one under it.
  const file = `${name}-${randomBytes(5).toString("hex")}`;
  const dir = photoFolder();
  await mkdir(dir, { recursive: true });

  const started: string[] = [];
  try {
    for (const copy of checked) {
      const target = path.join(dir, `${file}-${copy.width}.${copy.format}`);
      started.push(target);
      await writeFile(`${target}.part`, copy.bytes);
      await rename(`${target}.part`, target);
    }
  } catch (error) {
    await Promise.all(
      started.flatMap((target) => [rm(target, { force: true }), rm(`${target}.part`, { force: true })]),
    );
    throw error;
  }

  const widths = [...new Set(checked.map((copy) => copy.width))].sort((a, b) => a - b);
  const widest = widths[widths.length - 1];
  return {
    file,
    width: widest,
    height: copyHeight(widest),
    widths,
    formats: checked.some((copy) => copy.format === "webp") ? ["webp", "jpg"] : ["jpg"],
  };
}

/** Removes every copy of a photograph. Copies already gone are no trouble. */
export async function removePhotoFiles(file: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(file)) return;
  const dir = photoFolder();
  await Promise.all(
    UPLOAD.widths.flatMap((size) =>
      (Object.keys(TYPES) as (keyof typeof TYPES)[]).map((format) =>
        rm(path.join(dir, `${file}-${size}.${format}`), { force: true }),
      ),
    ),
  );
}

/** One kept copy, by the name in its address, or null when there is no such copy. */
export async function readPhotoFile(name: string): Promise<{ body: Buffer; type: string } | null> {
  const match = FILE_NAME.exec(name);
  if (!match) return null;
  try {
    return { body: await readFile(path.join(photoFolder(), name)), type: TYPES[match[3] as keyof typeof TYPES] };
  } catch {
    return null;
  }
}
