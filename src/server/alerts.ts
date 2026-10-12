// Telling the people who run the site that something is wrong.
//
// One fault can happen hundreds of times in a minute. The same trouble is
// reported at most once every fifteen minutes, with a count of how often it
// happened in between.

import { sql } from "drizzle-orm";

import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { sendEmail } from "@/server/messages/deliver";

const QUIET_MS = 15 * 60_000;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Reports trouble. `key` names the kind of trouble, so repeats can be
 * recognised. Never throws: reporting a fault must not cause another.
 */
export async function alert(
  key: string,
  subject: string,
  detail: string,
): Promise<"sent" | "quiet" | "off" | "failed"> {
  try {
    console.error(`[alert] ${key}: ${subject}\n${detail}`);

    const to = env.alertEmail;
    if (!to || !env.resendKey) return "off";

    const now = clock.now();
    const quietSince = new Date(now.getTime() - QUIET_MS);

    // Takes the right to send, or counts the repeat. One statement, so two
    // processes reporting the same fault at once cannot both send.
    const claimed = await db().execute<{ times: number; sending: boolean }>(sql`
      INSERT INTO alerts (key, last_sent_at, times) VALUES (${key.slice(0, 200)}, ${now}, 1)
      ON CONFLICT (key) DO UPDATE SET
        times = CASE WHEN alerts.last_sent_at <= ${quietSince} THEN 1 ELSE alerts.times + 1 END,
        last_sent_at = CASE WHEN alerts.last_sent_at <= ${quietSince} THEN ${now} ELSE alerts.last_sent_at END
      RETURNING times, (last_sent_at = ${now}) AS sending
    `);
    if (!claimed.rows[0]?.sending) return "quiet";

    const text = `${subject}\n\n${detail}\n\nRelease ${env.release}. The same trouble will not be reported again for 15 minutes.`;
    const result = await sendEmail({
      to,
      subject: `[Ukingo] ${subject}`.slice(0, 200),
      html: `<pre style="font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escape(text)}</pre>`,
      text,
    });
    return result.ok ? "sent" : "failed";
  } catch (error) {
    console.error("[alert] could not report:", error);
    return "failed";
  }
}
