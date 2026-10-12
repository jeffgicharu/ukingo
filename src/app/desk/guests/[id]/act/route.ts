import { eq } from "drizzle-orm";

import { normalisePhone } from "@/lib/format";
import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { forgetGuest, GuestError } from "@/server/desk/guests";
import { flash } from "@/server/flash";
import { field, seeOther } from "@/server/http";
import { must, NotAllowed } from "@/server/staff/permissions";
import { staffForRequest } from "@/server/staff/sessions";

// What staff keep about a guest: how to reach them, and what the team should know.
export async function POST(request: Request, { params }: RouteContext<"/desk/guests/[id]/act">) {
  const staff = await staffForRequest(request);
  if (!staff) return seeOther("/desk/sign-in");

  const { id } = await params;
  const guestId = Number(id);
  const back = `/desk/guests/${guestId}`;
  const done = (message: string) => seeOther(`${back}?note=${flash(message)}`);
  const refuse = (message: string) => seeOther(`${back}?oops=${flash(message)}`);
  if (!Number.isInteger(guestId)) return seeOther("/desk/guests");

  const form = await request.formData();

  try {
    if (field(form, "action") === "forget") {
      const stays = await forgetGuest(staff, guestId, clock.now());
      return done(
        `This guest's details are removed from their profile, ${stays === 1 ? "their booking" : `their ${stays} bookings`} and every message. The payment records are kept, as the law requires.`,
      );
    }
    must(staff, "guests.edit");
    const [guest] = await db().select().from(schema.guests).where(eq(schema.guests.id, guestId));
    if (!guest) return seeOther("/desk/guests");
    if (staff.training && !guest.sample) {
      throw new NotAllowed("Training accounts cannot change a real visitor's details.");
    }

    switch (field(form, "action")) {
      case "details": {
        const name = field(form, "name").replace(/\s+/g, " ");
        const phone = normalisePhone(field(form, "phone"));
        const email = field(form, "email").toLowerCase();
        if (name.length < 2 || name.length > 80) return refuse("Enter the guest's name.");
        if (!phone) return refuse("Enter a Kenyan mobile number, such as 0712 345 678.");
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return refuse("That email address is not complete.");
        await db()
          .update(schema.guests)
          .set({ name, phone, email: email || null })
          .where(eq(schema.guests.id, guestId));
        return done("Contact details saved.");
      }
      case "notes": {
        await db()
          .update(schema.guests)
          .set({ notes: field(form, "notes").slice(0, 2000) })
          .where(eq(schema.guests.id, guestId));
        return done("Notes saved.");
      }
      default:
        return refuse("That could not be done.");
    }
  } catch (error) {
    if (error instanceof NotAllowed || error instanceof GuestError) return refuse(error.message);
    throw error;
  }
}
