import { NextResponse, type NextRequest } from "next/server";

// Runs before every page and route. It only adds headers.
export function proxy(_request: NextRequest) {
  const response = NextResponse.next();

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
