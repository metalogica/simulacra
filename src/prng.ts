/**
 * Mulberry32 — a 32-bit seeded pseudo-random number generator that outputs [0, 1).
 *
 * @module
 * The source of determinism in the system. Every random draw inside the runtime
 * must come from a seed, never from `Math.random()` otherwise a run cannot be reproduced.
 */

/** A source of floats in [0, 1) */
export type Random = () => number;

export const mulberry32 = (seed: number): Random => {
  if (Number.isNaN(seed)) {
    throw new Error("Seed is NaN");
  }

  let state = seed >>> 0;

  return () => {
    // 0x6d2b79f5 (The Increment / Fractional Golden Ratio):
    // - Guarantees a full period length of 2^32 (4.29 billion calls).
    state = (state + 0x6d2b79f5) | 0;

    const a = state >>> 15;
    const b = state ^ a;
    const c = state | 1;
    const t1 = Math.imul(b, c);

    const d = t1 >>> 7;
    const e = t1 ^ d;
    const f = t1 | 61;
    const g = Math.imul(e, f);
    const h = t1 + g;
    const t2 = h ^ t1;

    const i = t2 ^ (t2 >>> 14);
    const j = i >>> 0;
    const t3 = j / 2 ** 32;

    return t3;
  };
};
