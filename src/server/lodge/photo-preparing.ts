// Has a photograph prepared by tools/prepare-photo.mjs, in a process of its
// own, and waits for the answer. One photograph at a time: each can take a
// few seconds and a few hundred megabytes, and the site shares its server.
// In development and in tests, where the tool may not be built, the work is
// done here instead.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { alert } from "@/server/alerts";

import { photoFolder, PhotoError } from "./photo-files";
import type { PreparedPhoto } from "./photos";

const LONGEST_MS = 90_000;

let turn: Promise<unknown> = Promise.resolve();

/** The command that starts the tool, or null where the work is done in this process. */
function toolCommand(): string[] | null {
  if (process.env.NODE_ENV !== "production") return null;
  // A release keeps its tools beside the site.
  const tool = path.resolve("tools/prepare-photo.mjs");
  if (!existsSync(tool)) throw new PhotoError("Photographs cannot be prepared on this server yet.");
  return [process.execPath, "--max-old-space-size=96", tool];
}

/** Checks a photograph and saves its copies (see photos.ts), away from the site's own process. */
export function preparePhotoApart(
  bytes: Uint8Array,
  name: string,
  command: string[] | null = toolCommand(),
): Promise<PreparedPhoto> {
  const mine = turn.then(async () => {
    if (!command) {
      const { preparePhoto } = await import("./photos");
      return preparePhoto(bytes, name);
    }
    return runTool(command, bytes, name);
  });
  // The next photograph waits for this one, whether it worked or not.
  turn = mine.catch(() => undefined);
  return mine;
}

function runTool(command: string[], bytes: Uint8Array, name: string): Promise<PreparedPhoto> {
  return new Promise((resolve, reject) => {
    const [program, ...args] = command;
    const child = spawn(program, [...args, name], { stdio: ["pipe", "pipe", "pipe"] });
    let said = "";
    let complaint = "";
    let tooLong = false;
    const timer = setTimeout(() => {
      tooLong = true;
      child.kill("SIGKILL");
    }, LONGEST_MS);

    child.stdout.setEncoding("utf8").on("data", (part: string) => (said += part));
    child.stderr.setEncoding("utf8").on("data", (part: string) => (complaint = (complaint + part).slice(-4000)));
    // The tool may end before it has read everything, when it refuses the photograph early.
    child.stdin.on("error", () => {});

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      let answer: { ok: true; photo: PreparedPhoto } | { ok: false; message: string } | undefined;
      try {
        answer = JSON.parse(said.trim().split("\n").pop() ?? "");
      } catch {
        answer = undefined;
      }
      if (answer?.ok) return resolve(answer.photo);
      if (answer && !answer.ok) return reject(new PhotoError(answer.message));

      // It stopped without answering: too slow, out of memory, or a fault. Nothing half made is kept.
      await removeUnfinished(name);
      const how = tooLong ? "took too long and was stopped" : `ended with ${signal ?? `code ${code}`}`;
      await alert(
        "photos:prepare",
        "A photograph could not be prepared",
        `Preparing ${name} ${how}.\n\n${complaint.trim() || "It said nothing."}`,
      );
      reject(
        new PhotoError(
          tooLong
            ? "Preparing that photograph took too long. Save a smaller copy of it and try again."
            : "That photograph could not be prepared. Save a smaller copy of it and try again.",
        ),
      );
    });

    child.stdin.end(Buffer.from(bytes));
  });
}

/** Copies left by a preparation that was stopped part way: <name>-<ten letters>-<width>.<format>[.part] */
async function removeUnfinished(name: string): Promise<void> {
  try {
    const dir = photoFolder();
    const pattern = new RegExp(`^${name}-[0-9a-f]{10}-\\d{3,4}\\.(avif|webp|jpg)(\\.part)?$`);
    const files = await readdir(dir);
    // A photograph already up under the same name was made earlier and is whole. Only parts are certain
    // to be unfinished, so only parts, and the copies made beside them, go.
    const unfinished = new Set(
      files
        .filter((file) => pattern.test(file) && file.endsWith(".part"))
        .map((file) => file.split("-").slice(0, -1).join("-")),
    );
    await Promise.all(
      files
        .filter((file) => pattern.test(file) && unfinished.has(file.split("-").slice(0, -1).join("-")))
        .map((file) => rm(path.join(dir, file), { force: true })),
    );
  } catch {
    // Leftover copies take a little room and are shown nowhere.
  }
}
