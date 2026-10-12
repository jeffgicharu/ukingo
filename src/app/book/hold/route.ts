import { isDay } from "@/lib/dates";
import { normalisePhone } from "@/lib/format";
import { bookingPath } from "@/server/booking/links";
import { stayAddress } from "@/server/booking/search";
import { BookingError, holdBooking } from "@/server/booking/service";
import { clock } from "@/server/clock";
import { clientIp, field, numberField, seeOther } from "@/server/http";
import { catalogue } from "@/server/lodge/catalogue";

// The booking form lands here. A room is held and the guest goes on to pay.
// The address never changes between releases, and the form needs no script.
export async function POST(request: Request) {
  const form = await request.formData();

  const room = field(form, "room");
  const from = field(form, "in");
  const to = field(form, "out");
  const adults = numberField(form, "adults");
  const children = numberField(form, "children");

  if (!isDay(from) || !isDay(to) || !Number.isInteger(adults) || !Number.isInteger(children)) {
    return seeOther("/stay");
  }
  const stay = { from, to };
  const party = { adults, children };

  const lodge = await catalogue();
  const meals = field(form, "meals") || lodge.mealPlans[0].code;
  const extraIds = form
    .getAll("extra")
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id));

  // Back to the form, keeping the choices that are not personal details.
  const back = (problem: string) => {
    const address = new URL(stayAddress("/book", stay, party, { room, meals, problem }), "http://site");
    for (const id of extraIds) address.searchParams.append("extra", String(id));
    return seeOther(`${address.pathname}${address.search}`);
  };

  const name = field(form, "name").replace(/\s+/g, " ");
  const phone = normalisePhone(field(form, "phone"));
  const emailTyped = field(form, "email").toLowerCase();
  const email = emailTyped === "" ? null : emailTyped;

  if (
    name.length < 2 ||
    name.length > 80 ||
    !phone ||
    (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
  ) {
    return back("details");
  }

  try {
    const booking = await holdBooking(
      {
        roomType: room,
        stay,
        party,
        mealPlan: meals,
        extraIds,
        guest: { name, phone, email },
        arrivalTime: field(form, "arrival"),
        requests: field(form, "requests"),
        requestKey: field(form, "key").slice(0, 64) || undefined,
        ip: clientIp(request.headers),
      },
      clock.now(),
    );
    return seeOther(bookingPath(booking, "/pay"));
  } catch (error) {
    if (!(error instanceof BookingError)) throw error;
    switch (error.code) {
      case "full":
        return back("full");
      case "too_many_holds":
        return back("holds");
      case "dates":
      case "party":
        // The search page explains exactly what is wrong with the dates or the party.
        return seeOther(stayAddress("/stay", stay, party, { room }));
      default:
        return back("unknown");
    }
  }
}
