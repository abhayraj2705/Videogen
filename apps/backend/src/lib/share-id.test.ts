import { describe, expect, it } from "vitest";
import { generateShareId, isValidShareId, SHARE_ID_ALPHABET, SHARE_ID_LENGTH } from "./share-id.js";

describe("generateShareId", () => {
  it("produces 12 URL-safe alphanumeric chars by default", () => {
    const id = generateShareId();
    expect(id).toHaveLength(SHARE_ID_LENGTH);
    expect(id).toMatch(/^[0-9A-Za-z]+$/);
    expect(isValidShareId(id)).toBe(true);
  });

  it("is unique across many draws", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => generateShareId()));
    expect(ids.size).toBe(5000);
  });

  it("rejects biased bytes (>= 248) via rejection sampling", () => {
    let call = 0;
    // First buffer is all rejected bytes, second maps 0..11 to the first 12 alphabet chars.
    const fake = (n: number) => (call++ === 0 ? Buffer.alloc(n, 250) : Buffer.from(Array.from({ length: n }, (_, i) => i)));
    expect(generateShareId(12, fake)).toBe(SHARE_ID_ALPHABET.slice(0, 12));
  });

  it("maps byte values modulo the alphabet size", () => {
    const fake = (n: number) => Buffer.alloc(n, 62 + 10); // 72 % 62 = 10 → "A"
    expect(generateShareId(10, fake)).toBe("AAAAAAAAAA");
  });
});

describe("isValidShareId", () => {
  it("rejects short, empty or non-alphanumeric ids", () => {
    expect(isValidShareId("")).toBe(false);
    expect(isValidShareId("abc")).toBe(false);
    expect(isValidShareId("abcdefghij-")).toBe(false);
    expect(isValidShareId("../../etc/passwd")).toBe(false);
    expect(isValidShareId("abcdefghij")).toBe(true);
  });
});
