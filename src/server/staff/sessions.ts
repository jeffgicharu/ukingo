// The parts of signing in that belong to a web request: the cookie, the page
// that needs someone signed in, the form that must come from this site.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { clientIp } from "@/server/http";

import { SESSION_COOKIE, staffForToken } from "./auth";
import { may, maySee, type Ability, type Staff } from "./permissions";

const LONGEST_SECONDS = 14 * 86_400;

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: LONGEST_SECONDS,
};

/** The member of staff using this page, or null. */
export async function currentStaff(): Promise<Staff | null> {
  const jar = await cookies();
  return staffForToken(jar.get(SESSION_COOKIE)?.value);
}

/** For staff pages: the member of staff, or a trip to the sign-in page. */
export async function requireStaff(ability?: Ability): Promise<Staff> {
  const staff = await currentStaff();
  if (!staff) redirect("/desk/sign-in");
  if (ability && !maySee(staff, ability)) redirect("/desk?refused=1");
  return staff;
}

/**
 * For staff form handlers: the member of staff, or null. Also refuses a form
 * sent from another site, by checking where the request says it came from.
 */
export async function staffForRequest(request: Request): Promise<Staff | null> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return null;

  const cookie = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return staffForToken(cookie);
}

export async function requestDetails(): Promise<{ ip: string | null; userAgent: string }> {
  const all = await headers();
  return { ip: clientIp(all), userAgent: all.get("user-agent") ?? "" };
}

export { may, maySee };
export { closeAllSessions, closeSession, openSession, SESSION_COOKIE, signIn, staffForToken } from "./auth";
