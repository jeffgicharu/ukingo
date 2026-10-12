// Rewrites the books of a lodge kept for training, there and then. The
// background jobs do this by themselves every night. This is for the day it
// is first set up, or when a training session has left the books in a state.
//
//   node training.mjs rebuild
//
// It refuses to run anywhere that is not a training lodge, because it throws
// every booking away.

import { closeDatabase } from "@/server/db";
import { env } from "@/server/env";
import { rebuildTraining } from "@/server/training/sample";

async function main(): Promise<void> {
  if (process.argv[2] !== "rebuild") throw new Error("Usage: training rebuild");
  if (!env.training) {
    throw new Error("This is not a training lodge (TRAINING_MODE is not on). Nothing was touched.");
  }
  const written = await rebuildTraining(new Date());
  console.log(`The books are rewritten: ${written.bookings} bookings for ${written.guests} guests.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());

export {};
