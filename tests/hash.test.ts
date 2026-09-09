/**
 * Contract for `src/hash.ts` — FNV-1a over UTF-8 bytes.
 * Rep 2 of M2. Pure.
 */
import { describe, expect, it } from "vitest";
import { fnv1a } from "../src/hash.ts";

describe("fnv1a", () => {
  it("matches the published FNV-1a 32-bit test vectors", () => {
    expect(fnv1a("")).toBe(2166136261);
    expect(fnv1a("a")).toBe(3826002220);
    expect(fnv1a("foobar")).toBe(3214735720);
  });

  it("hashes UTF-8 bytes, not UTF-16 code units", () => {
    // "é" is one code unit but two UTF-8 bytes (0xC3 0xA9). Hashing code
    // units instead gives a different number.
    expect(fnv1a("é")).toBe(513665217);
  });

  it("is deterministic", () => {
    expect(fnv1a("Klaus is reading alone in the cafe")).toBe(1154948389);
    expect(fnv1a("Klaus is reading alone in the cafe")).toBe(
      fnv1a("Klaus is reading alone in the cafe"),
    );
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const text of [
      "",
      "a",
      "zzzzzzzzzzzzzzzz",
      "!z.,;.zzp[l339",
      "日本語",
    ]) {
      const hash = fnv1a(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });

  it("separates nearby strings", () => {
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
    expect(fnv1a("ab")).not.toBe(fnv1a("ba"));
  });
});
