import { after } from "next/server";

import { isDay } from "@/lib/dates";
import { formatStay } from "@/lib/format";
import { bookingPath } from "@/server/booking/links";
import { BookingError, changeDates } from "@/server/booking/service";
import { bookingForLink } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { flash } from "@/server/flash";
import { clientIp, field, seeOther } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";

export async function POST(request: Request, { params }: RouteContext<"/b/[code]/change/confirm">) {
  const { code } = await params;
  const booking = await bookingForLink(code);
  if (!booking) return new Response("Not found", { status: 404 });

  const form = await request.formData();
  const from = field(form, "in");
  const to = field(form, "out");
  const changePage = bookingPath(booking, "/change");
  if (!isDay(from) || !isDay(to)) return seeOther(changePage);

  try {
    const result = await changeDates(booking.id, { from, to }, { actor: "guest" }, clock.now(), {
      ip: clientIp(request.headers),
    });
    after(() => deliverQueued());
    return seeOther(
      `${bookingPath(booking)}?note=${flash(`Your stay has been moved to ${formatStay(result.booking.stay)}.`)}`,
    );
  } catch (error) {
    if (error instanceof BookingError) {
      return seeOther(`${changePage}?in=${from}&out=${to}&note=${flash(error.message)}`);
    }
    throw error;
  }
}
