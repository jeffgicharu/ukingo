// Prepares the site's photographs from their originals.
//
//   node scripts/photos.mjs [folder of originals]
//
// Each original (JPEG or PNG, named for where it goes: forest-cottage.jpg,
// forest-cottage-inside.jpg and so on) is saved at several widths in AVIF,
// WebP and JPEG under public/photos, and listed in src/photos/manifest.ts
// with its shape and a colour to show while it loads. A phone then downloads
// a small file and a laptop a larger one, in the newest format each knows.
//
// The originals are not part of the repository. What this writes is.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const from = path.resolve(process.argv[2] ?? "generated/masters");
const to = path.resolve("public/photos");
const WIDTHS = [480, 800, 1200, 1600];

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
        .avif({ quality: 50, effort: 6 })
        .toFile(path.join(to, `${name}-${size}.avif`)),
      sized
        .clone()
        .webp({ quality: 72, effort: 5 })
        .toFile(path.join(to, `${name}-${size}.webp`)),
      sized
        .clone()
        .jpeg({ quality: 74, mozjpeg: true })
        .toFile(path.join(to, `${name}-${size}.jpg`)),
    ]);
    bytes += saved.reduce((sum, info) => sum + info.size, 0);
  }

  const { dominant } = await original.clone().resize(64).stats();
  records.push({ name, width, height, widths, colour: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}` });
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
  /** A dominant colour, shown while the photograph loads. */
  colour: string;
};

export const photos: Record<string, PhotoRecord> = {
${records
  .map(
    (record) =>
      `  "${record.name}": { width: ${record.width}, height: ${record.height}, widths: [${record.widths.join(", ")}], colour: "${record.colour}" },`,
  )
  .join("\n")}
};
`;
await writeFile("src/photos/manifest.ts", manifest);

console.log(
  `${records.length} photographs, ${records.reduce((sum, record) => sum + record.widths.length * 3, 0)} files, ${(bytes / 1_048_576).toFixed(1)} MB in public/photos.`,
);
