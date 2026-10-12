import { clock } from "@/server/clock";
import { flash } from "@/server/flash";
import { seeOther } from "@/server/http";
import { resetPassword, StaffError } from "@/server/staff/manage";

export async function POST(request: Request, { params }: RouteContext<"/desk/reset/[token]/send">) {
  const { token } = await params;
  const form = await request.formData();
  // Passwords are taken exactly as typed: a space at either end is part of the password.
  const password = String(form.get("password") ?? "");
  const again = String(form.get("again") ?? "");
  const back = `/desk/reset/${encodeURIComponent(token)}`;

  if (password !== again) return seeOther(`${back}?oops=${flash("The two passwords are not the same.")}`);
  try {
    await resetPassword(token, password, clock.now());
  } catch (error) {
    if (error instanceof StaffError) return seeOther(`${back}?oops=${flash(error.message)}`);
    throw error;
  }
  return seeOther(`/desk/sign-in?note=${flash("Your password is changed. Sign in with the new one.")}`);
}
