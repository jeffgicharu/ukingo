import { NextResponse, type NextRequest } from "next/server";

import { contentPolicy, makeNonce } from "@/lib/content-policy";

// Runs before every page and route. It only adds headers.
export function proxy(request: NextRequest) {
  // Next.js reads the policy from the request to know which number to put on
  // its inline scripts, and the browser reads it from the response.
  const policy = contentPolicy({
    nonce: makeNonce(),
    https: (process.env.SITE_URL ?? "").startsWith("https:"),
    development: process.env.NODE_ENV === "development",
  });
  const forward = new Headers(request.headers);
  forward.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: forward } });
  response.headers.set("Content-Security-Policy", policy);

  // Which release answered. The deploy pipeline reads this to know the switch happened.
  response.headers.set("X-Release", process.env.RELEASE ?? "dev");

  // Search engines are asked not to list the site unless listing is switched on.
  // The pages stay open to crawlers so that they can see this.
  if (process.env.ALLOW_INDEXING !== "true") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
