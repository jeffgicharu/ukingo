// Every background job, and when it runs. Times are East Africa Time.

import { lt, sql } from "drizzle-orm";

import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";

export type Job = {
  name: string;
  /** A cron expression (minute hour day month weekday). Absent for jobs that only run when asked. */
  every?: string;
  run: () => Promise<void>;
};

const DAY_MS = 86_400_000;

export const jobs: Job[] = [
  {
    // Sign-in records that no longer matter: ended sessions and old attempts.
    name: "tidy-sign-ins",
    every: "40 3 * * *",
    async run() {
      const now = clock.now();
      await db().delete(schema.staffSessions).where(lt(schema.staffSessions.expiresAt, now));
      await db()
        .delete(schema.signInAttempts)
        .where(lt(schema.signInAttempts.at, new Date(now.getTime() - 30 * DAY_MS)));
      await db().execute(sql`DELETE FROM password_resets WHERE expires_at < ${new Date(now.getTime() - 7 * DAY_MS)}`);
    },
  },
];
