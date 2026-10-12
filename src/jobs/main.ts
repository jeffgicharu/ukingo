// The background process. It runs beside the site and does the work that has
// to happen on time whether or not anyone is looking at a page: letting go of
// rooms nobody paid for, chasing payment confirmations, sending reminders.
//
// Jobs and their schedule are kept in PostgreSQL by pg-boss, so nothing is
// lost when this process restarts.

import { PgBoss } from "pg-boss";

import { closeDatabase } from "@/server/db";
import { env } from "@/server/env";

import { jobs } from "./registry";

const boss = new PgBoss({
  connectionString: env.databaseUrl,
  application_name: "ukingo-jobs",
  max: 3,
});

boss.on("error", (error) => {
  console.error("job queue error:", error.message);
});

async function start(): Promise<void> {
  await boss.start();

  for (const job of jobs) {
    await boss.createQueue(job.name);

    if (job.every) {
      // The schedule is in East Africa Time, like everything else at the lodge.
      await boss.schedule(job.name, job.every, {}, { tz: "Africa/Nairobi" });
    }

    await boss.work(job.name, async () => {
      const started = Date.now();
      try {
        await job.run();
      } catch (error) {
        console.error(`job ${job.name} failed:`, error);
        throw error;
      } finally {
        const took = Date.now() - started;
        if (took > 5_000) console.log(`job ${job.name} took ${took} ms`);
      }
    });
  }

  console.log(`Jobs started (release ${env.release}): ${jobs.map((job) => job.name).join(", ")}`);
}

let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, finishing the jobs in hand`);
  try {
    await boss.stop({ graceful: true, timeout: 20_000 });
    await closeDatabase();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));

start().catch((error) => {
  console.error("The jobs could not start:", error);
  process.exit(1);
});
