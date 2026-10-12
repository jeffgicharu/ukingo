import { eq } from "drizzle-orm";
import { after } from "next/server";

import { isDay, nightsIn } from "@/lib/dates";
import { formatStay } from "@/lib/format";
import { BookingError, blockRoom, relocate, unblockRoom } from "@/server/booking/service";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { flash } from "@/server/flash";
import { field, numberField, seeOther } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";
import { must, NotAllowed } from "@/server/staff/permissions";
import { staffForRequest } from "@/server/staff/sessions";
import { trainingMayBlock } from "@/server/training/door";

// What the calendar can change: where a booking sits, and which rooms are off sale.
export async function POST(request: Request) {
  const staff = await staffForRequest(request);
  if (!staff) return seeOther("/desk/sign-in");

  const form = await request.formData();
  const action = field(form, "action");
  const now = clock.now();

  // Back to the calendar as it was being looked at.
  const asked = field(form, "back");
  const back = asked.startsWith("/desk/calendar") ? asked : "/desk/calendar";
  const join = back.includes("?") ? "&" : "?";
  const done = (message: string) => seeOther(`${back}${join}note=${flash(message)}`);
  const refuse = (message: string) => seeOther(`${back}${join}oops=${flash(message)}`);

  const roomId = numberField(form, "room");
  const from = field(form, "in");
  const to = field(form, "out");

  try {
    switch (action) {
      case "move": {
        must(staff, "bookings.change");
        if (!Number.isInteger(roomId) || !isDay(from) || !isDay(to)) return refuse("That move could not be read.");
        const booking = await relocate(numberField(form, "booking"), { stay: { from, to }, roomId }, staff.id, now);
        after(() => deliverQueued());
        const [room] = await db().select().from(schema.rooms).where(eq(schema.rooms.id, booking.roomId));
        return done(`${booking.guestName} is now in ${room?.name ?? "the new room"}, ${formatStay(booking.stay)}.`);
      }
      case "block": {
        must(staff, "calendar.block");
        if (!Number.isInteger(roomId) || !isDay(from) || !isDay(to) || from >= to) {
          return refuse("Choose the first night of the block and the morning the room is back.");
        }
        await trainingMayBlock(staff, nightsIn({ from, to }), now);
        await blockRoom(roomId, { from, to }, field(form, "reason"), staff.id, now);
        return done("The room is off sale for those nights.");
      }
      case "unblock": {
        must(staff, "calendar.block");
        await unblockRoom(numberField(form, "allocation"));
        return done("The room is back on sale.");
      }
      default:
        return refuse("That could not be done.");
    }
  } catch (error) {
    if (error instanceof BookingError || error instanceof NotAllowed) return refuse(error.message);
    throw error;
  }
}
