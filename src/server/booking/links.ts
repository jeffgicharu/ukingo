// A booking's reference and its private link.
//
// The reference (UKG-7Q4MXR) is what guests and staff say to each other. It
// is not a secret. The private link adds a signature made with the site's
// secret, so it cannot be guessed, and nothing that would let someone rebuild
// it is kept in the database or shown on a staff screen.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { env } from "@/server/env";

// No 0, 1, I or O: nothing that is misread over the phone.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REFERENCE = /^UKG-[2-9A-HJ-NP-Z]{6}$/;
const LINK_CODE = /^(UKG-[2-9A-HJ-NP-Z]{6})\.([A-Za-z0-9_-]{22})$/;

export function newReference(): string {
  let code = "";
  for (let index = 0; index < 6; index++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `UKG-${code}`;
}

/** Accepts what a guest might type: "ukg-7q4mxr", "UKG7Q4MXR", "7q4mxr". */
export function readReference(typed: string): string | null {
  const cleaned = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const code = cleaned.startsWith("UKG") && cleaned.length === 9 ? cleaned.slice(3) : cleaned;
  const reference = `UKG-${code}`;
  return REFERENCE.test(reference) ? reference : null;
}

type Linkable = { reference: string; linkVersion: number };

function sign(booking: Linkable): string {
  return createHmac("sha256", env.appSecret)
    .update(`booking-link:${booking.reference}:${booking.linkVersion}`)
    .digest("base64url")
    .slice(0, 22);
}

/** The last part of a booking's private address: UKG-7Q4MXR.kq3… */
export function linkCode(booking: Linkable): string {
  return `${booking.reference}.${sign(booking)}`;
}

/** "/b/UKG-7Q4MXR.kq3…/pay" */
export function bookingPath(booking: Linkable, page: "" | "/pay" | "/change" | "/cancel" | "/calendar" = ""): string {
  return `/b/${linkCode(booking)}${page}`;
}

export function bookingUrl(booking: Linkable, page: Parameters<typeof bookingPath>[1] = ""): string {
  return `${env.siteUrl}${bookingPath(booking, page)}`;
}

/** The reference inside a link code, without judging whether the signature is right. */
export function referenceIn(code: string): string | null {
  return LINK_CODE.exec(code)?.[1] ?? null;
}

/** True when the code is this booking's current link. */
export function opens(code: string, booking: Linkable): boolean {
  const match = LINK_CODE.exec(code);
  if (!match || match[1] !== booking.reference) return false;
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(sign(booking));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Signs the address Safaricom answers one prompt on. */
export function paymentKey(paymentId: number, nonce: string): string {
  return createHmac("sha256", env.appSecret)
    .update(`payment-answer:${paymentId}:${nonce}`)
    .digest("base64url")
    .slice(0, 32);
}
