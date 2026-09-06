/**
 * Contract for `src/prng.ts` — see the module header for the algorithm.
 * Rep 1 of M2. Pure; no database, no clients.
 */
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/prng.ts";

const draws = (seed: number, n: number): number[] => {
  const next = mulberry32(seed);
  return Array.from({ length: n }, () => next());
};

describe("mulberry32", () => {
  it("is deterministic: the same seed yields the same stream", () => {
    expect(draws(1, 100)).toEqual(draws(1, 100));
  });

  it("differs across seeds", () => {
    expect(draws(1, 100)).not.toEqual(draws(2, 100));
  });

  it("matches the reference algorithm — pinned so llm.ts stays reproducible", () => {
    // First three draws of canonical mulberry32 for seed 1. These equal the
    // inline generator in src/llm.ts, so swapping the mock over changes no
    // chaos run.
    const [a, b, c] = draws(1, 3);
    expect(a).toBeCloseTo(0.6270739405881613, 12);
    expect(b).toBeCloseTo(0.002735721180215478, 12);
    expect(c).toBeCloseTo(0.5274470399599522, 12);
  });

  it("stays inside [0, 1)", () => {
    for (const x of draws(42, 10_000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("is roughly uniform", () => {
    const xs = draws(7, 10_000);
    const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it("truncates the seed to 32 bits: seed and seed + 2^32 are one stream", () => {
    expect(draws(1 + 2 ** 32, 10)).toEqual(draws(1, 10));
  });

  it("gives each generator its own state", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect(a()).toBe(b());
    a(); // advance a alone
    expect(a()).not.toBe(b());
  });

  it("throws on a NaN seed", () => {
    expect(() => mulberry32(Number.NaN)).toThrow();
  });
});
