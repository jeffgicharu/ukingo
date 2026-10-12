// Every email and text the lodge has written to a guest, sent or not.

import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { readReference } from "@/server/booking/links";
import { db, schema } from "@/server/db";
import type { MessageStatus } from "@/server/db/schema";
import { LINK } from "@/server/messages/templates";

export const MESSAGES_PER_PAGE = 40;

export const MESSAGE_STATES: Record<MessageStatus | "all", string> = {
  all: "All",
  sent: "Sent",
  queued: "Waiting to send",
  failed: "Failed",
  not_sent: "Not sent",
};

export type MessageFilters = {
  channel: "all" | "email" | "sms";
  status: MessageStatus | "all";
  q: string;
  page: number;
};

export type ListedMessage = {
  id: number;
  channel: "email" | "sms";
  kind: string;
  recipient: string;
  subject: string | null;
  status: MessageStatus;
  statusReason: string | null;
  createdAt: Date;
  sentAt: Date | null;
  bookingId: number | null;
  reference: string | null;
  guestName: string | null;
  /** True when it was written to an invented guest in the sample data. */
  sample: boolean;
};

const columns = {
  id: schema.messages.id,
  channel: schema.messages.channel,
  kind: schema.messages.kind,
  recipient: schema.messages.recipient,
  subject: schema.messages.subject,
  status: schema.messages.status,
  statusReason: schema.messages.statusReason,
  createdAt: schema.messages.createdAt,
  sentAt: schema.messages.sentAt,
  bookingId: schema.bookings.id,
  reference: schema.bookings.reference,
  guestName: schema.bookings.guestName,
  sample: sql<boolean>`coalesce(${schema.bookings.sample}, false)`,
};

export async function listMessages(filters: MessageFilters): Promise<{ rows: ListedMessage[]; total: number }> {
  const m = schema.messages;
  const b = schema.bookings;
  const where: SQL[] = [];
  if (filters.channel !== "all") where.push(eq(m.channel, filters.channel));
  if (filters.status !== "all") where.push(eq(m.status, filters.status));
  if (filters.q) {
    const reference = readReference(filters.q);
    const text = filters.q.replace(/[%_]/g, "");
    where.push(
      or(
        ilike(m.recipient, `%${text}%`),
        ilike(b.guestName, `%${text}%`),
        ilike(m.subject, `%${text}%`),
        reference ? eq(b.reference, reference) : undefined,
      )!,
    );
  }
  const condition = where.length ? and(...where) : undefined;

  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(m)
    .leftJoin(b, eq(b.id, m.bookingId))
    .where(condition);

  const rows = await db()
    .select(columns)
    .from(m)
    .leftJoin(b, eq(b.id, m.bookingId))
    .where(condition)
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(MESSAGES_PER_PAGE)
    .offset((filters.page - 1) * MESSAGES_PER_PAGE);

  return { rows, total };
}

export type StoredMessage = ListedMessage & { html: string | null; body: string };

export async function messageById(id: number): Promise<StoredMessage | null> {
  if (!Number.isInteger(id)) return null;
  const [row] = await db()
    .select({ ...columns, html: schema.messages.html, body: schema.messages.body })
    .from(schema.messages)
    .leftJoin(schema.bookings, eq(schema.bookings.id, schema.messages.bookingId))
    .where(eq(schema.messages.id, id));
  return row ?? null;
}

/** True when the stored copy holds the stand-in for the guest's private link. */
export function hasLinkStandIn(message: { html: string | null; body: string }): boolean {
  return message.body.includes(LINK) || (message.html ?? "").includes(LINK);
}

/**
 * The email as it is shown to staff. The guest's private link is never kept:
 * the stored copy holds a stand-in, which is shown here as a link to nowhere.
 */
export function htmlForDisplay(html: string): string {
  return html.split(LINK).join("#the-guests-private-link");
}
