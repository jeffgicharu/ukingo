import { and, eq } from "drizzle-orm";
import { after } from "next/server";

import { isDay } from "@/lib/dates";
import { formatMoney, formatStay } from "@/lib/format";
import {
  addCharge,
  BookingError,
  cancelBooking,
  changeDates,
  checkIn,
  checkOut,
  markNoShow,
  moveRoom,
  removeCharge,
  touchDesk,
} from "@/server/booking/service";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { flash } from "@/server/flash";
import { clientIp, field, numberField, seeOther } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";
import { markRefundSent, recordDeskPayment, startMpesaPayment } from "@/server/payments/service";
import { must, NotAllowed } from "@/server/staff/permissions";
import { staffForRequest } from "@/server/staff/sessions";

// Everything staff do to one booking comes through here: one small form per
// step, each naming its step. A step that is not allowed, or no longer makes
// sense because the booking has moved on, changes nothing and says why.
export async function POST(request: Request, { params }: RouteContext<"/desk/bookings/[id]/act">) {
  const staff = await staffForRequest(request);
  if (!staff) return seeOther("/desk/sign-in");

  const { id } = await params;
  const bookingId = Number(id);
  const form = await request.formData();
  const action = field(form, "action");
  const now = clock.now();

  // Back to the screen the form was on. Only addresses inside the back office are followed.
  const asked = field(form, "back");
  const back = asked.startsWith("/desk") && !asked.startsWith("//") ? asked : `/desk/bookings/${bookingId}`;
  const join = back.includes("?") ? "&" : "?";
  const done = (message: string) => seeOther(`${back}${join}note=${flash(message)}`);
  const refuse = (message: string) => seeOther(`${back}${join}oops=${flash(message)}`);

  if (!Number.isInteger(bookingId)) return refuse("That booking could not be found.");

  try {
    switch (action) {
      case "check_in": {
        must(staff, "bookings.check_in_out");
        const booking = await checkIn(bookingId, staff.id, now);
        return done(`${booking.guestName} is checked in.`);
      }
      case "check_out": {
        must(staff, "bookings.check_in_out");
        const leaveOwing = field(form, "owing") === "leave";
        const booking = await checkOut(bookingId, staff.id, now, { leaveOwing });
        return done(
          leaveOwing
            ? `${booking.guestName} is checked out. What they owe stays on the booking and under Payments.`
            : `${booking.guestName} is checked out.`,
        );
      }
      case "no_show": {
        must(staff, "bookings.check_in_out");
        const booking = await markNoShow(bookingId, staff.id, now);
        return done(`${booking.guestName} is marked as a no-show. The room is back on sale.`);
      }
      case "cancel": {
        must(staff, "bookings.cancel");
        const reason = field(form, "reason");
        const typed = field(form, "refund");
        let refundCents: number | undefined;
        if (typed !== "") {
          must(staff, "refunds.override");
          const shillings = Number(typed.replace(/,/g, ""));
          if (!Number.isFinite(shillings) || shillings < 0)
            return refuse("Enter the refund as an amount in shillings.");
          refundCents = Math.round(shillings * 100);
        }
        const result = await cancelBooking(bookingId, { actor: "staff", staffId: staff.id }, now, {
          reason,
          refundCents,
        });
        after(() => deliverQueued());
        return done(
          result.refundCents > 0
            ? `Cancelled. ${formatMoney(result.refundCents)} is now owed back to the guest.`
            : "Cancelled. Nothing is owed back.",
        );
      }
      case "move_room": {
        must(staff, "bookings.change");
        const booking = await moveRoom(bookingId, numberField(form, "room"), staff.id, now);
        const [room] = await db().select().from(schema.rooms).where(eq(schema.rooms.id, booking.roomId));
        return done(`Moved to ${room?.name ?? "the new room"}.`);
      }
      case "change_dates": {
        must(staff, "bookings.change");
        const from = field(form, "in");
        const to = field(form, "out");
        if (!isDay(from) || !isDay(to)) return refuse("Choose the new arrival and departure dates.");
        const result = await changeDates(bookingId, { from, to }, { actor: "staff", staffId: staff.id }, now);
        after(() => deliverQueued());
        return done(
          `Moved to ${formatStay(result.booking.stay)}. The new total is ${formatMoney(result.booking.totalCents)}.`,
        );
      }
      case "add_extra": {
        must(staff, "bookings.change");
        await addCharge(bookingId, { extraId: numberField(form, "extra") }, staff.id, now);
        return done("Added to the bill.");
      }
      case "add_adjustment": {
        must(staff, "bill.adjust");
        const shillings = Number(field(form, "amount").replace(/,/g, ""));
        if (!Number.isFinite(shillings) || shillings === 0)
          return refuse("Enter an amount. Use a minus sign to take money off.");
        await addCharge(bookingId, { label: field(form, "label"), cents: Math.round(shillings * 100) }, staff.id, now);
        return done("The bill has been changed.");
      }
      case "remove_charge": {
        const chargeId = numberField(form, "charge");
        const [charge] = await db()
          .select({ kind: schema.bookingCharges.kind })
          .from(schema.bookingCharges)
          .where(and(eq(schema.bookingCharges.id, chargeId), eq(schema.bookingCharges.bookingId, bookingId)));
        must(staff, charge?.kind === "adjustment" ? "bill.adjust" : "bookings.change");
        await removeCharge(bookingId, chargeId, staff.id, now);
        return done("Removed from the bill.");
      }
      case "note": {
        must(staff, "bookings.change");
        const body = field(form, "body").slice(0, 2000);
        if (!body) return refuse("Write the note first.");
        await db().insert(schema.bookingNotes).values({ bookingId, staffId: staff.id, body, createdAt: now });
        await touchDesk();
        return done("Note added.");
      }
      case "pay_desk": {
        must(staff, "payments.take");
        const method = field(form, "method");
        if (method !== "cash" && method !== "bank" && method !== "mpesa_desk")
          return refuse("Choose how the guest paid.");
        const shillings = Number(field(form, "amount").replace(/,/g, ""));
        if (!Number.isFinite(shillings) || shillings <= 0) return refuse("Enter the amount paid, in shillings.");
        const payment = await recordDeskPayment(
          { bookingId, cents: Math.round(shillings * 100), method, reference: field(form, "reference") },
          staff.id,
          now,
        );
        after(() => deliverQueued());
        return done(`${formatMoney(payment.cents)} recorded.`);
      }
      case "pay_prompt": {
        must(staff, "payments.take");
        const shillings = Number(field(form, "amount").replace(/,/g, ""));
        if (!Number.isFinite(shillings) || shillings <= 0) return refuse("Enter the amount to ask for, in shillings.");
        const payment = await startMpesaPayment(
          {
            bookingId,
            cents: Math.round(shillings * 100),
            phone: field(form, "phone"),
            who: { actor: "staff", staffId: staff.id },
            ip: clientIp(request.headers),
          },
          now,
        );
        return payment.status === "failed"
          ? refuse("M-Pesa could not send the prompt. Check the number and try again.")
          : done(
              `A prompt for ${formatMoney(payment.cents)} is on the guest's phone. This page updates when they pay.`,
            );
      }
      case "refund_sent": {
        must(staff, "refunds.send");
        await markRefundSent(numberField(form, "refund"), field(form, "reference"), staff.id, now);
        after(() => deliverQueued());
        return done("The refund is recorded as sent, and the guest has been told.");
      }
      default:
        return refuse("That step is not known.");
    }
  } catch (error) {
    if (error instanceof BookingError || error instanceof NotAllowed) return refuse(error.message);
    throw error;
  }
}
