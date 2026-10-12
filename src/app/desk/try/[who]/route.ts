import { clientIp } from "@/server/http";
import { openSession, sessionCookie } from "@/server/staff/sessions";
import { hasTrainingKey, trainingAccount } from "@/server/training/door";

// A link from whoever runs the training: it signs its holder in to a
// training account. Without the key, or on a lodge that is not kept for
// training, there is nothing here.
export async function GET(request: Request, { params }: RouteContext<"/desk/try/[who]">) {
  const { who } = await params;
  const account = hasTrainingKey(request) ? await trainingAccount(who) : null;
  if (!account) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const token = await openSession(account.id, clientIp(request.headers), request.headers.get("user-agent") ?? "");
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/desk",
      "Set-Cookie": sessionCookie(token),
      "Cache-Control": "no-store",
      // The link is a key. The page it leads to is not told where the visitor came from.
      "Referrer-Policy": "no-referrer",
    },
  });
}
