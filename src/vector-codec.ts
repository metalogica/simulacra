/**
 * Float32 BLOB codec — how a vector crosses the SQLite boundary.
 *
 * @module
 * The log carries vectors as JSON number arrays (inspectable, float64). The
 * projection stores them as float32 BLOBs (4 bytes per element). This module
 * is the only place that knows the byte layout.
 *
 * Contract:
 * - `encodeVector(vector)` → Buffer, 4 bytes per element, IEEE-754 float32,
 *   LITTLE-ENDIAN regardless of host byte order.
 * - `decodeVector(blob)` → Float32Array; throws unless `blob.length` is a
 *   multiple of 4.
 * - The round trip is exact for values representable in float32 and rounds
 *   otherwise (0.1 → 0.10000000149011612). That rounding is deterministic,
 *   which is all the Projection Law needs.
 * - Input is `number[]` on encode because that is what the event carries;
 *   output is `Float32Array` because that is what `src/vector.ts` takes.
 */
import { todo } from "./todo.ts";

export const encodeVector = (vector: number[]): Buffer => todo(vector);

export const decodeVector = (blob: Buffer): Float32Array => todo(blob);
