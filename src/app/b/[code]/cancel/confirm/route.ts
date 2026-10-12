import { after } from "next/server";

import { formatMoney } from "@/lib/format";
import { bookingPath } from "@/server/booking/links";
import { BookingError, cancelBooking } from "@/server/booking/service";
import { bookingForLink } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { flash } from "@/server/flash";
import { clientIp, seeOther } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";

export async function POST(request: Request, { params }: RouteContext<"/b/[code]/cancel/confirm">) {
  const { code } = await params;
  const booking = await bookingForLink(code);
  if (!booking) return new Response("Not found", { status: 404 });

  try {
    const result = await cancelBooking(booking.id, { actor: "guest" }, clock.now(), { ip: clientIp(request.headers) });
    after(() => deliverQueued());
    const note =
      result.refundCents > 0
        ? `Your booking is cancelled. ${formatMoney(result.refundCents)} will be refunded.`
        : "Your booking is cancelled.";
    return seeOther(`${bookingPath(booking)}?note=${flash(note)}`);
  } catch (error) {
    if (error instanceof BookingError) {
      return seeOther(`${bookingPath(booking)}?note=${flash(error.message)}`);
    }
    throw error;
  }
}
