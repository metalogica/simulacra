/**
 * Contract for `src/minmax.ts` — scale a set onto [0, 1].
 * Rep 5 of M2. Pure.
 */
import { describe, expect, it } from "vitest";
import { minMax } from "../src/minmax.ts";

describe("minMax", () => {
  it("maps the minimum to 0, the maximum to 1, and interpolates between", () => {
    expect(minMax([1, 2, 3])).toEqual([0, 0.5, 1]);
  });

  it("preserves order", () => {
    expect(minMax([3, 1, 2])).toEqual([1, 0, 0.5]);
  });

  it("maps a single element to 1", () => {
    expect(minMax([5])).toEqual([1]);
  });

  it("maps all-equal elements to 1", () => {
    expect(minMax([2, 2, 2])).toEqual([1, 1, 1]);
  });

  it("maps the empty set to the empty set", () => {
    expect(minMax([])).toEqual([]);
  });

  it("handles negative values", () => {
    expect(minMax([-1, 0, 1])).toEqual([0, 0.5, 1]);
  });

  it("handles a range that does not start at 0", () => {
    expect(minMax([10, 20])).toEqual([0, 1]);
  });

  it("does not mutate the input", () => {
    const input = [3, 1, 2];
    minMax(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("throws on a non-finite element", () => {
    expect(() => minMax([1, Number.NaN])).toThrow();
    expect(() => minMax([1, Number.POSITIVE_INFINITY])).toThrow();
  });
});
