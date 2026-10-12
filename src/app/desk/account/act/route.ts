import { flash } from "@/server/flash";
import { clientIp, seeOther } from "@/server/http";
import { changeOwnPassword, StaffError } from "@/server/staff/manage";
import { NotAllowed } from "@/server/staff/permissions";
import { openSession, sessionCookie, staffForRequest } from "@/server/staff/sessions";

// A member of staff changes their own password.
export async function POST(request: Request) {
  const staff = await staffForRequest(request);
  if (!staff) return seeOther("/desk/sign-in");

  const form = await request.formData();
  // Passwords are taken exactly as typed: a space at either end is part of the password.
  const current = String(form.get("current") ?? "");
  const password = String(form.get("password") ?? "");
  const again = String(form.get("again") ?? "");
  const refuse = (message: string) => seeOther(`/desk/account?oops=${flash(message)}`);

  if (password !== again) return refuse("The two new passwords are not the same.");
  try {
    await changeOwnPassword(staff, current, password);
  } catch (error) {
    if (error instanceof StaffError || error instanceof NotAllowed) return refuse(error.message);
    throw error;
  }

  // Every session was ended with the old password. This device gets a new one.
  const token = await openSession(staff.id, clientIp(request.headers), request.headers.get("user-agent") ?? "");
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/desk/account?note=${flash("Your password is changed. Other devices have been signed out.")}`,
      "Set-Cookie": sessionCookie(token),
      "Cache-Control": "no-store",
    },
  });
}
