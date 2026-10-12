import { closeSession, SESSION_COOKIE, sessionCookie } from "@/server/staff/sessions";

export async function POST(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (token) await closeSession(token);

  return new Response(null, {
    status: 303,
    headers: {
      Location: "/desk/sign-in",
      "Set-Cookie": sessionCookie(),
      "Cache-Control": "no-store",
    },
  });
}
