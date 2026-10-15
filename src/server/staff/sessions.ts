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

/** The header that gives a browser its session, or with no value takes it away. */
export function sessionCookie(value = ""): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${value ? cookieOptions.maxAge : 0}`,
    "HttpOnly",
    "SameSite=Lax",
    cookieOptions.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * After a wrong password, the sign-in page shows the email that was typed, so
 * only the password needs typing again. It is kept for ten minutes, for that
 * one page, and never in the address, where it would end up in logs.
 */
const TYPED_COOKIE = "desk_email";

export function typedEmailCookie(email = ""): string {
  return [
    `${TYPED_COOKIE}=${encodeURIComponent(email.trim().slice(0, 200))}`,
    "Path=/desk/sign-in",
    `Max-Age=${email ? 600 : 0}`,
    "HttpOnly",
    "SameSite=Lax",
    cookieOptions.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** The email typed before a wrong password, or "". */
export async function typedEmail(): Promise<string> {
  const value = (await cookies()).get(TYPED_COOKIE)?.value ?? "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

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
