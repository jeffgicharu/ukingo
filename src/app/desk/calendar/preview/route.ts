import { isDay, nightsIn } from "@/lib/dates";
import { formatMoney, formatStay, plural } from "@/lib/format";
import { previewRelocation } from "@/server/booking/service";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { bookingById, nameFor } from "@/server/desk/bookings";
import { json } from "@/server/http";
import { may } from "@/server/staff/permissions";
import { staffForRequest } from "@/server/staff/sessions";

// The calendar asks this when a booking is dragged somewhere: are those nights
// free there, and what would the move do to the bill? Nothing is changed here.
export async function GET(request: Request) {
  const staff = await staffForRequest(request);
  if (!staff) return json({ ok: false, reason: "You have been signed out. Sign in again." }, 401);
  if (!may(staff, "bookings.change")) {
    return json({ ok: false, reason: "Your role does not include moving bookings." }, 403);
  }

  const asked = new URL(request.url).searchParams;
  const booking = await bookingById(Number(asked.get("booking")));
  const roomId = Number(asked.get("room"));
  const from = asked.get("in");
  const to = asked.get("out");
  if (!booking || !Number.isInteger(roomId) || !isDay(from) || !isDay(to) || from >= to) {
    return json({ ok: false, reason: "That move could not be read. Try again." }, 400);
  }

  const stay = { from, to };
  const preview = await previewRelocation(booking, { stay, roomId }, staff.id, clock.now());
  if (!preview.ok) return json(preview);

  const rooms = await db().select({ id: schema.rooms.id, name: schema.rooms.name }).from(schema.rooms);
  const roomName = (id: number) => rooms.find((room) => room.id === id)?.name ?? "its room";

  return json({
    ok: true,
    guest: nameFor(staff, { name: booking.guestName, sample: booking.sample }),
    was: `${roomName(booking.roomId)}, ${formatStay(booking.stay)}, ${plural(nightsIn(booking.stay), "night")}`,
    becomes: `${preview.roomName}, ${formatStay(stay)}, ${plural(nightsIn(stay), "night")}`,
    price: !preview.datesChange
      ? preview.otherKind
        ? `${preview.roomName} is a different kind of room (${preview.otherKind}). The price stays as it is: change the bill by hand if it should differ. The guest is not told.`
        : "The price stays as it is. The guest is not told."
      : `${preview.otherKind ? `At ${preview.otherKind} prices, the` : "The"} new dates cost ${formatMoney(preview.totalCents)}, ${
          preview.differenceCents === 0
            ? "the same as now"
            : `which is ${formatMoney(Math.abs(preview.differenceCents))} ${preview.differenceCents > 0 ? "more" : "less"}`
        }. The guest is told.`,
    money:
      preview.refundCents > 0
        ? `${formatMoney(preview.refundCents)} would be owed back to the guest.`
        : preview.owedCents > 0
          ? `${formatMoney(preview.owedCents)} would then be owing.`
          : "Nothing more would be owed.",
  });
}
