import { bookingPath } from "@/server/booking/links";
import { BookingError, holdAgain } from "@/server/booking/service";
import { bookingForLink } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { flash } from "@/server/flash";
import { seeOther } from "@/server/http";

// A guest whose time to pay ran out asks for the room again.
export async function POST(_request: Request, { params }: RouteContext<"/b/[code]/hold">) {
  const { code } = await params;
  const booking = await bookingForLink(code);
  if (!booking) return new Response("Not found", { status: 404 });

  try {
    await holdAgain(booking.id, clock.now());
    return seeOther(bookingPath(booking, "/pay"));
  } catch (error) {
    if (error instanceof BookingError) {
      return seeOther(`${bookingPath(booking)}?note=${flash(error.message)}`);
    }
    throw error;
  }
}
