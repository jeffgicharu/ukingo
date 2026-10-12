// Every background job, and when it runs. Times are East Africa Time.

import { lt, sql } from "drizzle-orm";

import { alert } from "@/server/alerts";
import { releaseLapsedHolds, touchDesk } from "@/server/booking/service";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { deliverQueued } from "@/server/messages/deliver";
import { chasePayments } from "@/server/payments/service";

import { checkBooks } from "./books";
import { sendReminders } from "./reminders";

export type Job = {
  name: string;
  /** A cron expression (minute hour day month weekday). */
  every: string;
  run: () => Promise<void>;
};

const DAY_MS = 86_400_000;

export const jobs: Job[] = [
  {
    // Rooms held for guests who never paid, and for callers whose deposit never came.
    name: "release-holds",
    every: "* * * * *",
    async run() {
      const released = await db().transaction((tx) => releaseLapsedHolds(tx, clock.now()));
      if (released > 0) await touchDesk();
    },
  },
  {
    // Prompts still waiting for an answer: ask M-Pesa what became of them.
    name: "chase-payments",
    every: "* * * * *",
    async run() {
      await chasePayments(clock.now());
    },
  },
  {
    // Emails written but not yet sent. Pages send their own straight away; this catches the rest.
    name: "send-mail",
    every: "* * * * *",
    async run() {
      await deliverQueued(20);
    },
  },
  {
    name: "send-reminders",
    every: "0 8 * * *",
    async run() {
      await sendReminders(clock.now());
      await deliverQueued(20);
    },
  },
  {
    name: "check-books",
    every: "20 4 * * *",
    async run() {
      const faults = await checkBooks();
      if (faults.length) {
        await alert(
          "books",
          `${faults.length} booking record${faults.length === 1 ? "" : "s"} do not add up`,
          faults.map((fault) => `${fault.reference}: ${fault.detail}`).join("\n"),
        );
      }
    },
  },
  {
    // Sign-in records that no longer matter: ended sessions and old attempts.
    name: "tidy-sign-ins",
    every: "40 4 * * *",
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
