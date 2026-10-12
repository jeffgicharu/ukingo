// Looks at what last night's backup left behind.
//
// The backup itself is made by the server (deploy/backup.sh), outside this
// program, so that it does not depend on the thing it backs up. It writes a
// dump each night and one line saying whether that dump restored. This reads
// the line, and says what is wrong if anything is.

import { readFile } from "node:fs/promises";
import path from "node:path";

const A_DAY_AND_A_BIT_MS = 26 * 3_600_000;

/** Why the backup needs looking at, or null when last night's was made and restored. */
export async function backupFault(directory: string | undefined, now: Date): Promise<string | null> {
  if (!directory) return null;

  let line: string;
  try {
    line = (await readFile(path.join(directory, "last-check.txt"), "utf8")).trim();
  } catch {
    return `There is no record of a backup in ${directory}. The nightly backup may never have run.`;
  }

  // "ok 20261012-2250 bookings=529 bytes=412345" or "failed 20261012-2250 the dump would not restore"
  const [verdict, stamp, ...rest] = line.split(" ");
  const made = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(stamp ?? "");
  if (!made) return `The backup's record could not be read: "${line.slice(0, 200)}".`;
  const at = new Date(Date.UTC(+made[1], +made[2] - 1, +made[3], +made[4], +made[5]));

  if (verdict !== "ok") return `The backup of ${stamp} UTC failed: ${rest.join(" ") || "no reason was recorded"}.`;
  if (now.getTime() - at.getTime() > A_DAY_AND_A_BIT_MS) {
    return `The last good backup is from ${stamp} UTC. Nothing has been backed up since.`;
  }
  return null;
}
