/**
 * FNV-1a, 32-bit — a deterministic string → uint32 hash.
 *
 * @module
 * Seeds the mock embedding client so the same text always maps to the same
 * vector, across processes. Not cryptographic; collisions are acceptable.
 *
 * Contract:
 * - Hashes the UTF-8 BYTES of `text`, not UTF-16 code units.
 * - Offset basis 0x811c9dc5, prime 0x01000193. Per byte: xor, then multiply.
 * - Multiplication wraps at 32 bits (`Math.imul`); the result is unsigned
 *   (`>>> 0`), so the return value is an integer in [0, 2^32).
 */

const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

export const fnv1a = (text: string): number => {
  const bytes = new TextEncoder().encode(text);
  let hash = OFFSET_BASIS;

  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, PRIME);
  }

  const unsignedHash = hash >>> 0;

  return unsignedHash;
};
