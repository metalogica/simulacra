/**
 * Float32 BLOB codec — how a vector crosses the SQLite boundary.
 *
 * @module
 * The log carries vectors as JSON number arrays (inspectable, float64). The
 * projection stores them as float32 BLOBs (4 bytes per element). This module
 * is the only place that knows the byte layout.
 *
 * Contract:
 * - `decodeVector(blob)` → Float32Array; throws unless `blob.length` is a
 *   multiple of 4.
 * - The round trip is exact for values representable in float32 and rounds
 *   otherwise (0.1 → 0.10000000149011612). That rounding is deterministic,
 *   which is all the Projection Law needs.
 * - Input is `number[]` on encode because that is what the event carries;
 *   output is `Float32Array` because that is what `src/vector.ts` takes.
 */

export const encodeVector = (vector: number[]): Buffer => {
  const buffer = Buffer.from(new Float32Array(vector).buffer);

  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i]!, i * 4);
  }

  return buffer;
};

export const decodeVector = (blob: Buffer): Float32Array => {
  if (blob.length % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Byte length is not a multiple of 4");
  }

  const array = new Float32Array(blob.length / Float32Array.BYTES_PER_ELEMENT);

  for (let i = 0; i < array.length; i++) {
    array[i] = blob.readFloatLE(i * Float32Array.BYTES_PER_ELEMENT);
  }

  return array;
};
