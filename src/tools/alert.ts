// Sends one trouble report by hand, to prove that reports reach the inbox
// they are meant for. Worth running whenever that address or the mail key
// changes.
//
//   node alert.mjs
//
// It goes through the same door as a real report, so it is held back too if
// one like it went out in the last fifteen minutes.

import { alert } from "@/server/alerts";
import { closeDatabase } from "@/server/db";

async function main(): Promise<void> {
  const outcome = await alert(
    "check",
    "Checking that trouble reports reach you",
    "Nothing is wrong. Someone ran the check that sends one report by hand, to see that it arrives.",
  );

  const said: Record<typeof outcome, string> = {
    sent: "The report was handed to the mail service.",
    quiet: "A check went out in the last fifteen minutes, so this one was held back.",
    off: "Reports are switched off: the address to send them to, or the mail key, is not set.",
    failed: "The mail service did not take the report.",
  };
  console.log(said[outcome]);
  if (outcome === "off" || outcome === "failed") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
