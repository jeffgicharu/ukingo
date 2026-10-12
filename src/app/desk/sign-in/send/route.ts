import { flash } from "@/server/flash";
import { clientIp, field } from "@/server/http";
import { cookieOptions, SESSION_COOKIE, signIn } from "@/server/staff/sessions";

function cookie(value: string, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    cookieOptions.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function POST(request: Request) {
  const form = await request.formData();
  const result = await signIn(
    field(form, "email"),
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
      headers: { Location: `/desk/sign-in?oops=${flash(message)}`, "Cache-Control": "no-store" },
    });
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: "/desk",
      "Set-Cookie": cookie(result.token, cookieOptions.maxAge),
      "Cache-Control": "no-store",
    },
  });
}
