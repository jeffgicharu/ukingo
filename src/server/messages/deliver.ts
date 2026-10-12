// Sending the emails that are waiting.
//
// Called right after a guest does something that writes a message, and once
// a minute by the background jobs in case that call never happened. Each
// message is locked while it is being sent, so two callers never send the
// same one.

import { eq, sql } from "drizzle-orm";

import { bookingUrl } from "@/server/booking/links";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

import { LINK } from "./templates";

const GIVE_UP_AFTER_MS = 2 * 3_600_000;

type Outcome = { sent: number; failed: number; waiting: number };

/** Hands one email to the mail service. Returns the service's id for it, or the reason it refused. */
export async function sendEmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true; id: string | null } | { ok: false; retry: boolean; reason: string }> {
  const key = env.resendKey;
  if (!key) return { ok: false, retry: false, reason: "Email sending is not set up on this server." };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.mailFrom,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return { ok: false, retry: true, reason: `The mail service could not be reached: ${(error as Error).message}` };
  }

  if (response.ok) {
    const answer = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: answer.id ?? null };
  }

  const detail = (await response.text().catch(() => "")).slice(0, 300);
  // The service being busy or briefly down is worth another try. A refusal of this message is not.
  const retry = response.status === 429 || response.status >= 500;
  return { ok: false, retry, reason: `The mail service answered ${response.status}. ${detail}`.trim() };
}

export async function deliverQueued(limit = 10): Promise<Outcome> {
  const outcome: Outcome = { sent: 0, failed: 0, waiting: 0 };

  for (let count = 0; count < limit; count++) {
    const more = await db().transaction(async (tx) => {
      const found = await tx.execute<{ id: number }>(sql`
        SELECT id FROM messages
        WHERE status = 'queued' AND channel = 'email'
        ORDER BY created_at
        LIMIT 1 OFFSET ${outcome.waiting}
        FOR UPDATE SKIP LOCKED
      `);
      const id = found.rows[0]?.id;
      if (id === undefined) return false;

      const [message] = await tx.select().from(schema.messages).where(eq(schema.messages.id, id));
      const now = clock.now();

      // The private link is put in only now. It is never part of the stored copy.
      let link = env.siteUrl;
      if (message.bookingId) {
        const [booking] = await tx
          .select({ reference: schema.bookings.reference, linkVersion: schema.bookings.linkVersion })
          .from(schema.bookings)
          .where(eq(schema.bookings.id, message.bookingId));
        if (booking) link = bookingUrl(booking);
      }

      const result = await sendEmail({
        to: message.recipient,
        subject: message.subject ?? "",
        html: (message.html ?? "").replaceAll(LINK, link),
        text: message.body.replaceAll(LINK, link),
      });

      if (result.ok) {
        await tx
          .update(schema.messages)
          .set({ status: "sent", sentAt: now, providerId: result.id, statusReason: null })
          .where(eq(schema.messages.id, id));
        outcome.sent++;
      } else if (!result.retry || now.getTime() - message.createdAt.getTime() > GIVE_UP_AFTER_MS) {
        await tx
          .update(schema.messages)
          .set({ status: "failed", statusReason: result.reason })
          .where(eq(schema.messages.id, id));
        outcome.failed++;
      } else {
        // Left in the queue for the next run.
        outcome.waiting++;
      }
      return true;
    });

    if (!more) break;
  }

  return outcome;
}
