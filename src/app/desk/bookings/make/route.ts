import { after } from "next/server";

import { isDay } from "@/lib/dates";
import { normalisePhone } from "@/lib/format";
import { BookingError, makeDeskBooking, moveRoom } from "@/server/booking/service";
import { clock } from "@/server/clock";
import { flash } from "@/server/flash";
import { field, numberField, seeOther } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";
import { must, NotAllowed } from "@/server/staff/permissions";
import { staffForRequest } from "@/server/staff/sessions";
import { trainingMayBook } from "@/server/training/door";

// The desk's "new booking" form lands here.
export async function POST(request: Request) {
  const staff = await staffForRequest(request);
  if (!staff) return seeOther("/desk/sign-in");

  const form = await request.formData();
  const from = field(form, "in");
  const to = field(form, "out");
  const adults = numberField(form, "adults");
  const children = numberField(form, "children");
  const type = field(form, "type");

  const back = `/desk/bookings/new?in=${from}&out=${to}&adults=${adults || 2}&children=${children || 0}`;
  const refuse = (message: string) => seeOther(`${back}&oops=${flash(message)}`);

  try {
    must(staff, "bookings.make");
    if (!isDay(from) || !isDay(to)) return refuse("Choose the dates first.");

    const name = field(form, "name").replace(/\s+/g, " ");
    const phone = normalisePhone(field(form, "phone"));
    const emailTyped = field(form, "email").toLowerCase();
    if (name.length < 2) return refuse("Enter the guest's name.");
    if (!phone) return refuse("Enter a Kenyan mobile number for the guest, such as 0712 345 678.");
    if (emailTyped && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailTyped))
      return refuse("That email address is not complete.");

    const now = clock.now();
    await trainingMayBook(staff, now);
    let booking = await makeDeskBooking(
      {
        roomType: type,
        stay: { from, to },
        party: { adults, children },
        mealPlan: field(form, "meals"),
        extraIds: form
          .getAll("extra")
          .map(Number)
          .filter((id) => Number.isInteger(id)),
        guest: { name, phone, email: emailTyped || null },
        arrivalTime: field(form, "arrival"),
        requests: field(form, "requests"),
        requestKey: field(form, "key").slice(0, 64) || undefined,
        ip: null,
      },
      staff.id,
      now,
    );

    // Booked from a room's row on the calendar: put it in that room if it was given another.
    const wanted = numberField(form, "room");
    if (Number.isInteger(wanted) && wanted !== booking.roomId) {
      booking = await moveRoom(booking.id, wanted, staff.id, now).catch(() => booking);
    }

    after(() => deliverQueued());
    return seeOther(
      `/desk/bookings/${booking.id}?note=${flash("The booking is made and the room is held. Take the deposit below, or leave it for the guest to pay from their link.")}`,
    );
  } catch (error) {
    if (error instanceof BookingError || error instanceof NotAllowed) return refuse(error.message);
    throw error;
  }
}
