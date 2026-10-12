import { and, eq, gt, sql } from "drizzle-orm";
import { after } from "next/server";

import { readReference } from "@/server/booking/links";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { clientIp, field, seeOther } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";
import { tell } from "@/server/messages/tell";

// Sends a booking's link to the email address on the booking, and nowhere
// else. The answer is the same whether or not the details matched, so this
// form cannot be used to find out which bookings exist.
export async function POST(request: Request) {
  const form = await request.formData();
  const reference = readReference(field(form, "reference"));
  const email = field(form, "email").toLowerCase();

  if (!reference || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return seeOther("/find-booking?problem=1");
  }

  const now = clock.now();
  const [booking] = await db()
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.reference, reference), eq(schema.bookings.guestEmail, email)));

  if (booking) {
    // At most three of these a day for one booking.
    const [{ count }] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.bookingId, booking.id),
          eq(schema.messages.kind, "find-booking"),
          eq(schema.messages.channel, "email"),
          gt(schema.messages.createdAt, new Date(now.getTime() - 86_400_000)),
        ),
      );
    if (count < 3) {
      await db().transaction((tx) => tell(tx, booking.id, "find-booking", now, { ip: clientIp(request.headers) }));
      after(() => deliverQueued());
    }
  }

  return seeOther("/find-booking?sent=1");
}
