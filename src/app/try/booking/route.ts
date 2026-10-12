import { lodgeDay } from "@/lib/dates";
import { bookingPath } from "@/server/booking/links";
import { clock } from "@/server/clock";
import { bookingToTry, hasTrainingKey } from "@/server/training/door";

// A link from whoever runs the training: it opens a sample booking as its
// guest would see it, with a balance still to pay.
export async function GET(request: Request) {
  const booking = hasTrainingKey(request) ? await bookingToTry(lodgeDay(clock.now())) : null;
  if (!booking) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  return new Response(null, {
    status: 303,
    headers: { Location: bookingPath(booking), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
