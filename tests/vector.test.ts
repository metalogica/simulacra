/**
 * Contract for `src/vector.ts` — arithmetic over Float32Array.
 * Rep 3 of M2. Pure.
 *
 * Float32 carries ~7 significant digits, so equality is `toBeCloseTo(…, 5)`.
 */
import { describe, expect, it } from "vitest";
import { centre, cosineSimilarity, dot, norm, normalize } from "../src/vector.ts";

const f = (...xs: number[]): Float32Array => Float32Array.from(xs);

describe("dot", () => {
  it("multiplies pairwise and sums", () => {
    expect(dot(f(1, 2, 3), f(4, 5, 6))).toBeCloseTo(32, 5);
  });

  it("is 0 for empty inputs", () => {
    expect(dot(f(), f())).toBe(0);
  });

  it("throws on a length mismatch", () => {
    expect(() => dot(f(1, 2), f(1, 2, 3))).toThrow();
  });
});

describe("norm", () => {
  it("is the Euclidean length", () => {
    expect(norm(f(3, 4))).toBeCloseTo(5, 5);
  });

  it("is 0 for the zero vector", () => {
    expect(norm(f(0, 0, 0))).toBe(0);
  });

  it("is 1 for a unit vector", () => {
    expect(norm(f(0, 1, 0))).toBeCloseTo(1, 5);
  });
});

describe("normalize", () => {
  it("scales to unit length", () => {
    const out = normalize(f(3, 4));
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
    expect(norm(out)).toBeCloseTo(1, 5);
  });

  it("returns a new array and leaves the input untouched", () => {
    const input = f(3, 4);
    const out = normalize(input);
    expect(out).not.toBe(input);
    expect(Array.from(input)).toEqual([3, 4]);
  });

  it("throws on the zero vector", () => {
    expect(() => normalize(f(0, 0))).toThrow();
  });
});

describe("centre", () => {
  it("subtracts the mean from every element", () => {
    expect(Array.from(centre(f(1, 2, 3)))).toEqual([-1, 0, 1]);
  });

  it("leaves the result with mean 0", () => {
    const out = centre(f(5, 9, 2, 8));
    const mean = Array.from(out).reduce((sum, x) => sum + x, 0) / out.length;
    expect(mean).toBeCloseTo(0, 5);
  });

  it("does not mutate the input", () => {
    const input = f(1, 2, 3);
    centre(input);
    expect(Array.from(input)).toEqual([1, 2, 3]);
  });

  it("is a no-op on an already-centred vector", () => {
    expect(Array.from(centre(f(-1, 0, 1)))).toEqual([-1, 0, 1]);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for the same direction", () => {
    expect(cosineSimilarity(f(1, 2, 3), f(1, 2, 3))).toBeCloseTo(1, 5);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(f(1, 0), f(0, 1))).toBeCloseTo(0, 5);
  });

  it("is -1 for opposite directions", () => {
    expect(cosineSimilarity(f(1, 2), f(-1, -2))).toBeCloseTo(-1, 5);
  });

  it("ignores magnitude", () => {
    expect(cosineSimilarity(f(1, 2, 3), f(5, 10, 15))).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    const a = f(0.3, -0.7, 0.2);
    const b = f(0.9, 0.1, -0.4);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 6);
  });

  it("throws on a length mismatch", () => {
    expect(() => cosineSimilarity(f(1, 2), f(1, 2, 3))).toThrow();
  });

  it("throws when either vector is zero", () => {
    expect(() => cosineSimilarity(f(0, 0), f(1, 2))).toThrow();
    expect(() => cosineSimilarity(f(1, 2), f(0, 0))).toThrow();
  });
});
