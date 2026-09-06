/**
 * Contract for `src/recency.ts` — decay over game hours since creation.
 * Rep 6 of M2. Pure.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DECAY, recencyScore } from "../src/recency.ts";

describe("recencyScore", () => {
  it("uses the paper's decay factor by default", () => {
    expect(DEFAULT_DECAY).toBe(0.995);
  });

  it("is 1 for a memory created this tick", () => {
    expect(recencyScore({ createdTick: 7, nowTick: 7, ticksPerHour: 60 })).toBe(1);
  });

  it("is decay^1 after one game hour", () => {
    expect(
      recencyScore({ createdTick: 0, nowTick: 60, ticksPerHour: 60 }),
    ).toBeCloseTo(0.995, 12);
  });

  it("is decay^2 after two game hours", () => {
    expect(
      recencyScore({ createdTick: 0, nowTick: 120, ticksPerHour: 60 }),
    ).toBeCloseTo(0.990025, 12);
  });

  it("is decay^100 after one hundred game hours", () => {
    expect(
      recencyScore({ createdTick: 0, nowTick: 6000, ticksPerHour: 60 }),
    ).toBeCloseTo(0.6057704364907279, 12);
  });

  it("converts ticks to hours through ticksPerHour", () => {
    // 60 ticks at 30 ticks per hour is two hours.
    expect(
      recencyScore({ createdTick: 0, nowTick: 60, ticksPerHour: 30 }),
    ).toBeCloseTo(0.990025, 12);
  });

  it("honours a decay override", () => {
    expect(
      recencyScore({ createdTick: 0, nowTick: 60, ticksPerHour: 60, decay: 0.5 }),
    ).toBeCloseTo(0.5, 12);
  });

  it("decreases monotonically as ticks pass", () => {
    let previous = 1;
    for (let now = 1; now <= 500; now += 7) {
      const score = recencyScore({ createdTick: 0, nowTick: now, ticksPerHour: 60 });
      expect(score).toBeLessThan(previous);
      expect(score).toBeGreaterThan(0);
      previous = score;
    }
  });

  it("throws when the memory is from the future", () => {
    expect(() =>
      recencyScore({ createdTick: 10, nowTick: 9, ticksPerHour: 60 }),
    ).toThrow();
  });

  it("throws on a non-positive ticksPerHour", () => {
    expect(() =>
      recencyScore({ createdTick: 0, nowTick: 1, ticksPerHour: 0 }),
    ).toThrow();
  });
});
