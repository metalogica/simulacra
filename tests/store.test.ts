import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  freshDb,
  INVALID_EVENT,
  KLAUS_OBSERVATION,
  LLM_CALL_COMPLETED,
  LLM_CALL_FAILED,
  OBSERVATION,
  REFLECTION,
  type Harness,
} from "./helpers.ts";

let h: Harness;
beforeEach(() => {
  h = freshDb();
});
afterEach(() => h?.cleanup());

describe("append", () => {
  it("assigns ascending sequences", () => {
    const first = h.store.append(OBSERVATION);
    const second = h.store.append(REFLECTION);
    expect(second).toBeGreaterThan(first);
  });

  it("writes one row per event", () => {
    h.store.append(OBSERVATION);
    h.store.append(REFLECTION);
    expect(h.count()).toBe(2);
  });

  // M0 acceptance test 2: validation happens before the database is touched.
  it("throws on an invalid event", () => {
    expect(() => h.store.append(INVALID_EVENT)).toThrow();
  });

  it("writes nothing when validation fails", () => {
    h.store.append(OBSERVATION);
    expect(() => h.store.append(INVALID_EVENT)).toThrow();
    expect(h.count()).toBe(1);
  });
});

describe("appendMany", () => {
  it("returns a sequence per event", () => {
    const sequences = h.store.appendMany([OBSERVATION, REFLECTION]);
    expect(sequences).toHaveLength(2);
    expect(sequences[1]).toBeGreaterThan(sequences[0]!);
  });

  // M0 acceptance test 3: two appends in one transaction are atomic. The first
  // event is valid and inserts; the second fails validation *inside* the
  // transaction, so the first must be rolled back.
  it("rolls back the whole batch when any member is invalid", () => {
    expect(() => h.store.appendMany([OBSERVATION, INVALID_EVENT])).toThrow();
    expect(h.count()).toBe(0);
  });

  it("leaves earlier successful appends untouched on rollback", () => {
    h.store.append(OBSERVATION);
    expect(() => h.store.appendMany([REFLECTION, INVALID_EVENT])).toThrow();
    expect(h.count()).toBe(1);
  });
});

describe("read", () => {
  beforeEach(() => {
    h.store.append(OBSERVATION);
    h.store.append(KLAUS_OBSERVATION);
    h.store.append(REFLECTION);
  });

  it("returns every event when unfiltered", () => {
    expect(h.store.read()).toHaveLength(3);
  });

  it("returns events in ascending sequence order", () => {
    const sequences = h.store.read().map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it("round-trips an observation losslessly", () => {
    const [first] = h.store.read();
    expect(first).toMatchObject({
      type: "observation",
      agentId: OBSERVATION.agentId,
      tick: OBSERVATION.tick,
      content: OBSERVATION.content,
      importance: OBSERVATION.importance,
    });
  });

  it("round-trips a reflection's pointerSequences", () => {
    const reflection = h.store.read().find((e) => e.type === "reflection");
    expect(reflection).toBeDefined();
    // The narrowing here is the discriminated union doing its job.
    if (reflection?.type === "reflection") {
      expect(reflection.pointerSequences).toEqual([1]);
    }
  });

  it("stamps createdAt on the way in", () => {
    const [first] = h.store.read();
    expect(first!.createdAt).toBeGreaterThan(0);
  });

  it("filters by afterSequence", () => {
    const all = h.store.read();
    const cursor = all[0]!.sequence;
    expect(h.store.read({ afterSequence: cursor })).toHaveLength(2);
  });

  it("filters by agentId", () => {
    expect(h.store.read({ agentId: "klaus" })).toHaveLength(1);
    expect(h.store.read({ agentId: "maria" })).toHaveLength(2);
  });

  it("returns nothing for an unknown agent", () => {
    expect(h.store.read({ agentId: "nobody" })).toHaveLength(0);
  });
});

// ─── M1: journal events + read filters ───────────────────────────────────────
// read() grows optional `tick` and `type` filters (same `@param IS NULL OR`
// pattern) — the journal lookup is `read({ agentId, tick, type })` plus a
// purpose match in JS, since purpose lives inside the payload column.

describe("journal events through the store (M1)", () => {
  it("round-trips an llm_call_completed losslessly", () => {
    h.store.append(LLM_CALL_COMPLETED);
    expect(h.store.read()[0]).toMatchObject(LLM_CALL_COMPLETED);
  });

  it("round-trips an llm_call_failed losslessly", () => {
    h.store.append(LLM_CALL_FAILED);
    expect(h.store.read()[0]).toMatchObject(LLM_CALL_FAILED);
  });

  it("round-trips a nested JSON result", () => {
    h.store.append({
      ...LLM_CALL_COMPLETED,
      result: { a: [1, "x", { b: null }] },
    });
    const event = h.store.read()[0];
    if (event?.type !== "llm_call_completed") {
      throw new Error("expected an llm_call_completed");
    }
    expect(event.result).toEqual({ a: [1, "x", { b: null }] });
  });

  it("validates journal events on the way in", () => {
    expect(() =>
      h.store.append({ ...LLM_CALL_COMPLETED, attempts: 0 }),
    ).toThrow();
    expect(h.count()).toBe(0);
  });
});

describe("read filters: tick and type (M1)", () => {
  beforeEach(() => {
    h.store.append(OBSERVATION); // maria, tick 0
    h.store.append(KLAUS_OBSERVATION); // klaus, tick 0
    h.store.append(LLM_CALL_COMPLETED); // maria, tick 2
    h.store.append(LLM_CALL_FAILED); // maria, tick 3
  });

  it("filters by type", () => {
    const events = h.store.read({ type: "llm_call_completed" });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("llm_call_completed");
  });

  it("filters by tick", () => {
    expect(h.store.read({ tick: 0 })).toHaveLength(2);
    expect(h.store.read({ tick: 3 })).toHaveLength(1);
  });

  it("treats tick 0 as a filter, not as absent", () => {
    // The `@param IS NULL OR` pattern must receive null for "no filter" —
    // a falsy-check bug here silently returns the whole log.
    const events = h.store.read({ tick: 0 });
    expect(events.every((event) => event.tick === 0)).toBe(true);
  });

  it("combines agentId, tick and type", () => {
    const events = h.store.read({
      agentId: "maria",
      tick: 2,
      type: "llm_call_completed",
    });
    expect(events).toHaveLength(1);
  });

  it("returns nothing when the combination matches no row", () => {
    expect(
      h.store.read({ agentId: "klaus", type: "llm_call_completed" }),
    ).toHaveLength(0);
  });

  it("still returns everything unfiltered", () => {
    expect(h.store.read()).toHaveLength(4);
  });
});
