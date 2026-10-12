import { after } from "next/server";

import { dueOn, moneyOf } from "@/server/booking/ledger";
import { bookingPath } from "@/server/booking/links";
import { BookingError } from "@/server/booking/service";
import { bookingForLink } from "@/server/booking/view";
import { clock } from "@/server/clock";
import { db } from "@/server/db";
import { flash } from "@/server/flash";
import { clientIp, field, numberField, seeOther } from "@/server/http";
import { lodgeDay } from "@/lib/dates";
import { deliverQueued } from "@/server/messages/deliver";
import { MPESA_LIMIT_CENTS } from "@/server/payments/daraja";
import { makeTestPayment, startMpesaPayment } from "@/server/payments/service";

// The payment form lands here. The amount is worked out from the booking and
// the guest's choice ("the deposit", "everything", "this much"), never taken
// as a figure from the browser.
export async function POST(request: Request, { params }: RouteContext<"/b/[code]/pay/send">) {
  const { code } = await params;
  const booking = await bookingForLink(code);
  if (!booking) return new Response("Not found", { status: 404 });

  const form = await request.formData();
  const now = clock.now();
  const payPage = bookingPath(booking, "/pay");
  const refuse = (message: string) => seeOther(`${payPage}?note=${flash(message)}`);

  const money = await moneyOf(db(), booking);
  const due = dueOn(booking.status, booking.terms, money, lodgeDay(now));
  const least = Math.min(due.minimumCents, MPESA_LIMIT_CENTS);
  const most = Math.min(due.fullCents, MPESA_LIMIT_CENTS);

  let cents: number;
  switch (field(form, "amount")) {
    case "least":
      cents = least > 0 ? least : most;
      break;
    case "other": {
      const shillings = numberField(form, "other");
      if (!Number.isInteger(shillings) || shillings < 1000) {
        return refuse("Enter the amount you would like to pay now, from KSh 1,000.");
      }
      cents = shillings * 100;
      break;
    }
    default:
      cents = most;
  }

  const ip = clientIp(request.headers);
  try {
    if (field(form, "method") === "test") {
      const payment = await makeTestPayment({ bookingId: booking.id, cents, who: { actor: "guest" }, ip }, now);
      after(() => deliverQueued());
      return seeOther(`${bookingPath(booking)}?paid=${payment.id}`);
    }

    const payment = await startMpesaPayment(
      { bookingId: booking.id, cents, phone: field(form, "phone"), who: { actor: "guest" }, ip },
      now,
    );
    return seeOther(`${payPage}?p=${payment.id}`);
  } catch (error) {
    if (error instanceof BookingError) return refuse(error.message);
    throw error;
  }
}
