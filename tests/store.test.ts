import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  freshDb,
  INVALID_EVENT,
  KLAUS_OBSERVATION,
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
