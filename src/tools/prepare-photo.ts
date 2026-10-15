// Prepares one photograph put up from the back office, in a process of its own.
//
//   node prepare-photo.mjs <name>     the photograph arrives on standard input
//   node prepare-photo.mjs --check    prepares a made-up photograph, then removes it
//
// It answers with one line of JSON. The site starts it for every photograph
// and waits. On a server whose processor the image library has no native
// build for, the library runs as WebAssembly, which takes a lot of memory and
// never gives it back. Here the memory goes when the process ends, and if the
// work fails badly only this process is lost, never the site.

import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { photoFolder, PhotoError, WIDTHS } from "@/server/lodge/photo-files";
import { preparePhoto, type PreparedPhoto } from "@/server/lodge/photos";

type Answer = { ok: true; photo: PreparedPhoto } | { ok: false; message: string };

function answer(result: Answer): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function input(): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const part of process.stdin) parts.push(part as Buffer);
  return new Uint8Array(Buffer.concat(parts));
}

async function main(): Promise<void> {
  // If the server runs short of memory, this process is the one to stop, not the site.
  try {
    writeFileSync("/proc/self/oom_score_adj", "1000");
  } catch {
    // Not on Linux, or not allowed: the work goes ahead all the same.
  }

  const [name] = process.argv.slice(2);

  if (name === "--check") {
    // A made-up photograph, prepared and saved where real ones go, then removed.
    const made = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#425058" } })
      .jpeg()
      .toBuffer();
    const photo = await preparePhoto(new Uint8Array(made), "release-check");
    const dir = photoFolder();
    await Promise.all(
      WIDTHS.flatMap((size) =>
        ["avif", "webp", "jpg"].map((format) => rm(path.join(dir, `${photo.file}-${size}.${format}`), { force: true })),
      ),
    );
    answer({ ok: true, photo });
    return;
  }

  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    answer({ ok: false, message: "The photograph has no name to be saved under." });
    return;
  }

  try {
    answer({ ok: true, photo: await preparePhoto(await input(), name) });
  } catch (error) {
    if (error instanceof PhotoError) {
      answer({ ok: false, message: error.message });
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
