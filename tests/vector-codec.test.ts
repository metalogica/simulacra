/**
 * Contract for `src/vector-codec.ts` — float32, little-endian BLOBs.
 * Rep 4 of M2. Pure.
 */
import { describe, expect, it } from "vitest";
import { decodeVector, encodeVector } from "../src/vector-codec.ts";

describe("encodeVector", () => {
  it("writes IEEE-754 float32, little-endian", () => {
    expect(Array.from(encodeVector([1.0]))).toEqual([0, 0, 128, 63]);
    expect(Array.from(encodeVector([-2.5]))).toEqual([0, 0, 32, 192]);
  });

  it("uses exactly 4 bytes per element", () => {
    expect(encodeVector([]).length).toBe(0);
    expect(encodeVector([1, 2, 3]).length).toBe(12);
    expect(encodeVector(new Array<number>(256).fill(0.5)).length).toBe(1024);
  });

  it("returns a Buffer", () => {
    expect(Buffer.isBuffer(encodeVector([1]))).toBe(true);
  });
});

describe("decodeVector", () => {
  it("reads little-endian float32 into a Float32Array", () => {
    const out = decodeVector(Buffer.from([0, 0, 128, 63, 0, 0, 32, 192]));
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([1, -2.5]);
  });

  it("decodes an empty blob to an empty vector", () => {
    expect(decodeVector(Buffer.alloc(0)).length).toBe(0);
  });

  it("throws when the byte length is not a multiple of 4", () => {
    expect(() => decodeVector(Buffer.alloc(5))).toThrow();
    expect(() => decodeVector(Buffer.alloc(3))).toThrow();
  });
});

describe("round trip", () => {
  it("is exact for float32-representable values", () => {
    const values = Array.from({ length: 256 }, (_unused, i) => i / 8 - 16);
    expect(Array.from(decodeVector(encodeVector(values)))).toEqual(values);
  });

  it("rounds other values to float32, deterministically", () => {
    // 0.1 has no exact float32 form. The rounding is the same every time,
    // which is what byte-identical rebuilds rely on.
    const once = decodeVector(encodeVector([0.1, 0.2, 0.3]));
    const twice = decodeVector(encodeVector([0.1, 0.2, 0.3]));
    expect(once[0]).toBeCloseTo(0.1, 6);
    expect(once[0]).not.toBe(0.1);
    expect(Array.from(once)).toEqual(Array.from(twice));
  });

  it("preserves sign, zero and large magnitudes", () => {
    const values = [-0.5, 0, 1e6, -1e-6, 3.5];
    const out = Array.from(decodeVector(encodeVector(values)));
    for (let i = 0; i < values.length; i++) {
      expect(out[i]).toBeCloseTo(values[i]!, 5);
    }
  });
});
