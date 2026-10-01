import { randomBytes } from "node:crypto";

export const SHARE_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHARE_ID_LENGTH = 12; // 62^12 ≈ 3.2e21 — unguessable, still short enough for a URL

/**
 * URL-safe random slug for /v/:shareId. Uses rejection sampling (bytes >= 248
 * are discarded) so every character is uniformly distributed — a plain
 * `byte % 62` would bias the first 8 characters.
 */
export function generateShareId(length: number = SHARE_ID_LENGTH, random: (n: number) => Buffer = randomBytes): string {
  const alphabetSize = SHARE_ID_ALPHABET.length;
  const limit = 256 - (256 % alphabetSize); // 248
  let out = "";
  while (out.length < length) {
    const bytes = random(length * 2);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += SHARE_ID_ALPHABET[byte % alphabetSize];
      if (out.length === length) break;
    }
  }
  return out;
}

const SHARE_ID_RE = /^[0-9A-Za-z]{10,64}$/;

/** Cheap syntactic check before touching the DB on the public route. */
export function isValidShareId(value: string): boolean {
  return SHARE_ID_RE.test(value);
}
