// A one-line message carried from a form handler to the page it sends the
// browser on to. It travels in the address, so it is signed: a page only shows
// a message this site wrote, never one somebody typed into a link.

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/server/env";

function sign(text: string): string {
  return createHmac("sha256", env.appSecret).update(`flash:${text}`).digest("base64url").slice(0, 16);
}

/** The value to put in the address: ?note=… */
export function flash(message: string): string {
  const text = Buffer.from(message.slice(0, 400), "utf8").toString("base64url");
  return `${text}.${sign(text)}`;
}

/** The message, if the value is one this site made. Otherwise null. */
export function readFlash(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const [text, signature] = value.split(".");
  if (!text || !signature) return null;
  const expected = Buffer.from(sign(text));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Buffer.from(text, "base64url").toString("utf8");
}
