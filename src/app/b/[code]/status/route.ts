import { after } from "next/server";

import { bookingForLink } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { json } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";
import { checkPayment } from "@/server/payments/service";

// What the payment page asks every few seconds: has this payment landed?
// Asking also makes the site ask M-Pesa, when the answer is overdue.
export async function GET(request: Request, { params }: RouteContext<"/b/[code]/status">) {
  const { code } = await params;
  const booking = await bookingForLink(code);
  if (!booking) return json({ status: "unknown" }, 404);

  const id = new URL(request.url).searchParams.get("p") ?? "";
  if (!/^\d+$/.test(id)) return json({ status: "unknown" }, 400);

  const payment = await checkPayment(Number(id), clock.now());
  if (!payment || payment.bookingId !== booking.id) return json({ status: "unknown" }, 404);

  if (payment.status === "paid") {
    // The confirmation email was written when the payment was settled. Send it now.
    after(() => deliverQueued());
  }
  return json({ status: payment.status });
}
