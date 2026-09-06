/**
 * Mulberry32 — a 32-bit seeded pseudo-random number generator.
 *
 * @module
 * The determinism boundary starts here. Every "random" draw inside the
 * runtime must come from a seed, never from `Math.random`, or a chaos run
 * cannot be reproduced. `src/llm.ts` carries an inline generator version of
 * this same algorithm; once this module is green, point the mock at it and
 * delete the duplicate.
 *
 * Contract:
 * - `mulberry32(seed)` returns a function. Each call yields a float in [0, 1).
 * - The seed is truncated to an unsigned 32-bit integer (`seed >>> 0`), so
 *   `seed` and `seed + 2^32` produce the same stream.
 * - A NaN seed throws. Coercing it to 0 would hide a caller bug.
 * - Reference: state += 0x6d2b79f5; t = imul(state ^ (state >>> 15), 1 | state);
 *   t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t; yield ((t ^ (t >>> 14)) >>> 0) / 2^32.
 */
import { todo } from "./todo.ts";

/** A source of floats in [0, 1). */
export type Random = () => number;

export const mulberry32 = (seed: number): Random => todo(seed);
