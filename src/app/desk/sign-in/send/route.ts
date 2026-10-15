import { flash } from "@/server/flash";
import { clientIp, field } from "@/server/http";
import { sessionCookie, signIn, typedEmailCookie } from "@/server/staff/sessions";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = field(form, "email");
  const result = await signIn(
    email,
    field(form, "password"),
    clientIp(request.headers),
    request.headers.get("user-agent") ?? "",
  );

  if (!result.ok) {
    const message =
      result.reason === "locked"
        ? "Too many wrong tries. Wait fifteen minutes and try again."
        : "That email and password do not match. Check them and try again.";
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/desk/sign-in?oops=${flash(message)}`,
        "Set-Cookie": typedEmailCookie(email),
        "Cache-Control": "no-store",
      },
    });
  }

  const headers = new Headers({ Location: "/desk", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", sessionCookie(result.token));
  headers.append("Set-Cookie", typedEmailCookie());
  return new Response(null, { status: 303, headers });
}
