import { describe, expect, it } from "vitest";
import { agentEventSchema, storedEventSchema } from "../src/events.ts";
import {
  EMBEDDING_COMPUTED,
  LLM_CALL_COMPLETED,
  LLM_CALL_FAILED,
  OBSERVATION,
  REFLECTION,
} from "./helpers.ts";

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

// ─── M1: journal events ──────────────────────────────────────────────────────
// llm_call_completed: { agentId, tick, type, purpose: string(min 1),
//   prompt: string(min 1), result: <any JSON value>, attempts: int 1..3 }
// llm_call_failed:    { agentId, tick, type, purpose, prompt,
//   errors: string[](min 1, one per attempt), attempts: int 1..3 }

describe("agentEventSchema — journal events (M1)", () => {
  it("accepts an llm_call_completed", () => {
    expect(agentEventSchema.safeParse(LLM_CALL_COMPLETED).success).toBe(true);
  });

  it("accepts an llm_call_failed", () => {
    expect(agentEventSchema.safeParse(LLM_CALL_FAILED).success).toBe(true);
  });

  it("rejects an empty purpose", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, purpose: "" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty prompt", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, prompt: "" }).success,
    ).toBe(false);
  });

  it("rejects attempts of 0 — a journal entry implies at least one call", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, attempts: 0 })
        .success,
    ).toBe(false);
  });

  it("rejects attempts above 3 — the retry ceiling is 2", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, attempts: 4 })
        .success,
    ).toBe(false);
  });

  it("rejects fractional attempts", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, attempts: 1.5 })
        .success,
    ).toBe(false);
  });

  it("rejects a caller-supplied sequence on a journal event", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, ...STORED_FIELDS })
        .success,
    ).toBe(false);
  });

  it("rejects unknown keys — strictObject holds for journal events too", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, smuggled: true })
        .success,
    ).toBe(false);
  });

  it("rejects an llm_call_failed with no errors", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_FAILED, errors: [] }).success,
    ).toBe(false);
  });

  // The journal is generic over its callers' schemas, so `result` must admit
  // any JSON value — the caller's zod schema is enforced by the activity, not
  // by the log.
  it("accepts a nested JSON result", () => {
    expect(
      agentEventSchema.safeParse({
        ...LLM_CALL_COMPLETED,
        result: { a: [1, "x", { b: null }] },
      }).success,
    ).toBe(true);
  });

  it("accepts a bare scalar result", () => {
    expect(
      agentEventSchema.safeParse({
        ...LLM_CALL_COMPLETED,
        result: "just a string",
      }).success,
    ).toBe(true);
  });

  it("accepts a null result", () => {
    expect(
      agentEventSchema.safeParse({ ...LLM_CALL_COMPLETED, result: null })
        .success,
    ).toBe(true);
  });
});

describe("storedEventSchema — journal events (M1)", () => {
  it("accepts a stored llm_call_completed", () => {
    expect(
      storedEventSchema.safeParse({ ...LLM_CALL_COMPLETED, ...STORED_FIELDS })
        .success,
    ).toBe(true);
  });

  it("accepts a stored llm_call_failed", () => {
    expect(
      storedEventSchema.safeParse({ ...LLM_CALL_FAILED, ...STORED_FIELDS })
        .success,
    ).toBe(true);
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

// ─── M2: embedding events ────────────────────────────────────────────────────
// embedding_computed: { agentId, tick, type, memorySequence: int > 0,
//   model: string(min 1), vector: number[](min 1, every element finite) }
//
// The vector length is deliberately NOT fixed by the schema. The dimension is
// a provider decision (DECISIONS.md § M2); a mismatch surfaces as a thrown
// error in cosineSimilarity, not as a schema rejection of a valid log row.

describe("agentEventSchema — embedding_computed (M2)", () => {
  it("accepts an embedding_computed", () => {
    expect(agentEventSchema.safeParse(EMBEDDING_COMPUTED).success).toBe(true);
  });

  it("rejects an empty vector", () => {
    expect(
      agentEventSchema.safeParse({ ...EMBEDDING_COMPUTED, vector: [] }).success,
    ).toBe(false);
  });

  it("rejects a non-finite element", () => {
    expect(
      agentEventSchema.safeParse({
        ...EMBEDDING_COMPUTED,
        vector: [0.6, Number.NaN],
      }).success,
    ).toBe(false);
    expect(
      agentEventSchema.safeParse({
        ...EMBEDDING_COMPUTED,
        vector: [0.6, Number.POSITIVE_INFINITY],
      }).success,
    ).toBe(false);
  });

  it("rejects a non-numeric element", () => {
    expect(
      agentEventSchema.safeParse({
        ...EMBEDDING_COMPUTED,
        vector: [0.6, "0.8"],
      }).success,
    ).toBe(false);
  });

  it("rejects memorySequence 0 — sequences start at 1", () => {
    expect(
      agentEventSchema.safeParse({ ...EMBEDDING_COMPUTED, memorySequence: 0 })
        .success,
    ).toBe(false);
  });

  it("rejects a fractional memorySequence", () => {
    expect(
      agentEventSchema.safeParse({ ...EMBEDDING_COMPUTED, memorySequence: 1.5 })
        .success,
    ).toBe(false);
  });

  it("rejects an empty model", () => {
    expect(
      agentEventSchema.safeParse({ ...EMBEDDING_COMPUTED, model: "" }).success,
    ).toBe(false);
  });

  it("rejects unknown keys — strictObject holds", () => {
    expect(
      agentEventSchema.safeParse({ ...EMBEDDING_COMPUTED, smuggled: true })
        .success,
    ).toBe(false);
  });

  it("rejects a caller-supplied sequence", () => {
    expect(
      agentEventSchema.safeParse({ ...EMBEDDING_COMPUTED, ...STORED_FIELDS })
        .success,
    ).toBe(false);
  });
});

describe("storedEventSchema — embedding_computed (M2)", () => {
  it("accepts a stored embedding_computed", () => {
    expect(
      storedEventSchema.safeParse({ ...EMBEDDING_COMPUTED, ...STORED_FIELDS })
        .success,
    ).toBe(true);
  });
});

// A gap left open in M0: pointerSequences accepted any positive number, so a
// pointer of 1.5 validated. Sequences are integers; say so in the schema.
describe("reflection pointers are integers (M0 gap, closed in M2)", () => {
  it("rejects a fractional pointer sequence", () => {
    expect(
      agentEventSchema.safeParse({ ...REFLECTION, pointerSequences: [1.5] })
        .success,
    ).toBe(false);
  });

  it("rejects a zero pointer sequence", () => {
    expect(
      agentEventSchema.safeParse({ ...REFLECTION, pointerSequences: [0] })
        .success,
    ).toBe(false);
  });
});
