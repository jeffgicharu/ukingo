// Staff passwords. Only a salted scrypt hash is ever stored.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Memory-hard: about 32 MB and a twentieth of a second for each guess.
const COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 10;

/** "scrypt$32768$8$1$<salt>$<hash>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, LENGTH, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  try {
    const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: COST.maxmem,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Why a new password will not do, or null when it will. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) {
    return "That is too long. Use at most 200 characters.";
  }
  if (/^(.)\1+$/.test(password) || /^(password|ukingo|12345)/i.test(password)) {
    return "That password is too easy to guess.";
  }
  return null;
}
