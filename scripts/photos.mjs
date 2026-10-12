// Prepares the site's photographs from their originals.
//
//   node scripts/photos.mjs [folder of originals]
//
// Each original (JPEG or PNG, named for where it goes: forest-cottage.jpg,
// forest-cottage-inside.jpg and so on) is saved at several widths in AVIF,
// WebP and JPEG under public/photos, and listed in src/photos/manifest.ts
// with its shape and its average colour, to show while it loads. A phone then
// downloads a small file and a laptop a larger one, in the newest format each
// knows.
//
// The originals are not part of the repository. What this writes is.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const from = path.resolve(process.argv[2] ?? "generated/masters");
const to = path.resolve("public/photos");
const WIDTHS = [480, 800, 1200, 1600];
// How each format is saved. A change here gives every photograph a new stamp.
const SAVED_AS = {
  avif: { quality: 50, effort: 6 },
  webp: { quality: 72, effort: 5 },
  jpeg: { quality: 74, mozjpeg: true },
};

const hex = (value) => Math.round(value).toString(16).padStart(2, "0");

const originals = (await readdir(from)).filter((name) => /\.(jpe?g|png)$/i.test(name)).sort();
if (originals.length === 0) {
  console.error(`No photographs in ${from}.`);
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });

const records = [];
let bytes = 0;

for (const file of originals) {
  const name = path.basename(file, path.extname(file)).toLowerCase();
  const original = sharp(path.join(from, file)).rotate();
  const { width, height } = await original.metadata();
  // Never larger than the original: a photograph blown up is only a bigger file.
  const widths = WIDTHS.filter((size) => size <= width);
  if (widths.length === 0) widths.push(width);

  for (const size of widths) {
    const sized = original.clone().resize({ width: size });
    const saved = await Promise.all([
      sized
        .clone()
        .avif(SAVED_AS.avif)
        .toFile(path.join(to, `${name}-${size}.avif`)),
      sized
        .clone()
        .webp(SAVED_AS.webp)
        .toFile(path.join(to, `${name}-${size}.webp`)),
      sized
        .clone()
        .jpeg(SAVED_AS.jpeg)
        .toFile(path.join(to, `${name}-${size}.jpg`)),
    ]);
    bytes += saved.reduce((sum, info) => sum + info.size, 0);
  }

  // The average colour, not the commonest one: most of these have deep shadows,
  // and the commonest colour of nearly all of them is black.
  const { channels } = await original.clone().resize(64).stats();
  const colour = `#${channels
    .slice(0, 3)
    .map((channel) => hex(channel.mean))
    .join("")}`;
  // A stamp that changes when the photograph or the way it is saved changes.
  // It goes on the end of the address, so browsers may keep each copy for good.
  const stamp = createHash("sha256")
    .update(await readFile(path.join(from, file)))
    .update(JSON.stringify([WIDTHS, SAVED_AS]))
    .digest("hex")
    .slice(0, 8);
  records.push({ name, width, height, widths, colour, stamp });
  console.log(`${name}: ${width}x${height}, saved at ${widths.join(", ")}`);
}

const manifest = `// The photographs the site can show, and the sizes each was prepared in.
// Written by scripts/photos.mjs from the originals. Do not edit by hand.

export type PhotoRecord = {
  /** Width over height of the original. */
  width: number;
  height: number;
  /** The widths, in pixels, the photograph was saved at. */
  widths: number[];
  /** Its average colour, shown while the photograph loads. */
  colour: string;
  /** Changes when the photograph does, so a browser never shows an old copy. */
  stamp: string;
};

export const photos: Record<string, PhotoRecord> = {
${records
  .map(
    (record) =>
      `  "${record.name}": { width: ${record.width}, height: ${record.height}, widths: [${record.widths.join(", ")}], colour: "${record.colour}", stamp: "${record.stamp}" },`,
  )
  .join("\n")}
};
`;
await writeFile("src/photos/manifest.ts", manifest);

console.log(
  `${records.length} photographs, ${records.reduce((sum, record) => sum + record.widths.length * 3, 0)} files, ${(bytes / 1_048_576).toFixed(1)} MB in public/photos.`,
);
