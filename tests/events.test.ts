import { describe, expect, it } from "vitest";
import { agentEventSchema, storedEventSchema } from "../src/events.ts";
import { OBSERVATION, REFLECTION } from "./helpers.ts";

const STORED_FIELDS = { sequence: 1, createdAt: 1_786_914_071_448 };

describe("agentEventSchema — what goes in", () => {
  it("accepts an observation", () => {
    expect(agentEventSchema.safeParse(OBSERVATION).success).toBe(true);
  });

  it("accepts a reflection", () => {
    expect(agentEventSchema.safeParse(REFLECTION).success).toBe(true);
  });

  // strictObject is what makes the AgentEvent/StoredEvent split a runtime
  // guarantee rather than a naming convention: a caller cannot invent a
  // position in the log.
  it("rejects a caller-supplied sequence", () => {
    const result = agentEventSchema.safeParse({
      ...OBSERVATION,
      ...STORED_FIELDS,
    });
    expect(result.success).toBe(false);
  });

  it("rejects importance above the 1–10 scale", () => {
    const result = agentEventSchema.safeParse({
      ...OBSERVATION,
      importance: 50,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["importance"]);
    }
  });

  it("rejects a fractional importance (int, not number)", () => {
    expect(
      agentEventSchema.safeParse({ ...OBSERVATION, importance: 7.5 }).success,
    ).toBe(false);
  });

  it("rejects an empty content string", () => {
    expect(
      agentEventSchema.safeParse({ ...OBSERVATION, content: "" }).success,
    ).toBe(false);
  });

  it("rejects a reflection with no evidence", () => {
    expect(
      agentEventSchema.safeParse({ ...REFLECTION, pointerSequences: [] })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown event type without crashing", () => {
    const result = agentEventSchema.safeParse({ type: "nope" });
    expect(result.success).toBe(false);
  });
});

describe("storedEventSchema — what comes out", () => {
  it("accepts an event carrying sequence and createdAt", () => {
    expect(
      storedEventSchema.safeParse({ ...OBSERVATION, ...STORED_FIELDS }).success,
    ).toBe(true);
  });

  it("rejects a row with no sequence", () => {
    expect(storedEventSchema.safeParse(OBSERVATION).success).toBe(false);
  });
});
