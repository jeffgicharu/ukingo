import { flash } from "@/server/flash";
import { clientIp, field } from "@/server/http";
import { sessionCookie, signIn } from "@/server/staff/sessions";

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
      "Set-Cookie": sessionCookie(result.token),
      "Cache-Control": "no-store",
    },
  });
}
