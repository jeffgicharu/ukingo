// Draws the site's icons from the mark: the tab icon, the home-screen icons
// and the classic favicon. Run it after changing the mark.
//
//   node scripts/icons.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const NIGHT = "#101d26";
const MIST = "#f6f8f5";
const EMBER = "#e5a23a";

/** The mark on a dark tile. `inset` leaves room for platforms that crop icons to a circle. */
function icon({ radius, inset }) {
  const scale = (32 - inset * 2) / 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${radius}" fill="${NIGHT}"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2">
    <path d="M5 20.5 11.3 12.6l2.8 3.4L18.6 8.5 27 20.5" stroke="${MIST}"/>
    <path d="M5 25h22" stroke="${EMBER}"/>
  </g>
</svg>`;
}

const png = (svg, size) =>
  sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const rounded = icon({ radius: 7, inset: 0 });
const square = icon({ radius: 0, inset: 0 });
const padded = icon({ radius: 0, inset: 4 });

writeFileSync("src/app/icon.svg", rounded);
writeFileSync("src/app/apple-icon.png", await png(square, 180));
writeFileSync("public/icon-192.png", await png(square, 192));
writeFileSync("public/icon-512.png", await png(square, 512));
writeFileSync("public/icon-maskable-512.png", await png(padded, 512));

// favicon.ico holds 16, 32 and 48 pixel copies for old browsers.
const scratch = mkdtempSync(path.join(tmpdir(), "icons-"));
try {
  const sizes = [16, 32, 48];
  for (const size of sizes) {
    writeFileSync(path.join(scratch, `${size}.png`), await png(rounded, size));
  }
  execFileSync("convert", [...sizes.map((size) => path.join(scratch, `${size}.png`)), "src/app/favicon.ico"]);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("Icons written.");
