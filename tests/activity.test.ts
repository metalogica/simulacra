/**
 * Contract for M1 — the journaled LLM activity. Every model call in the
 * runtime flows through this wrapper; it is what makes replay idempotent.
 *
 * ```ts
 * // src/events.ts — two new members of the discriminated union:
 * //
 * // llm_call_completed: { agentId, tick, type, purpose: string(min 1),
 * //   prompt: string(min 1), result: <any JSON value>, attempts: int 1..3 }
 * // llm_call_failed:    { agentId, tick, type, purpose, prompt,
 * //   errors: string[](min 1), attempts: int 1..3 }
 * //
 * // NOTE: extending the union breaks the `satisfies never` switches in
 * // projection.ts (journal events are NOT memories — emit no row) and
 * // logger.ts (render purpose), and storedEventSchema must grow too or
 * // store.read() will report corrupt rows.
 *
 * // src/store.ts — read() grows two optional filters:
 * // read(input?: { agentId?, afterSequence?, tick?, type? })
 *
 * // src/activity.ts:
 * export type ActivityResult<T> =
 *   | { status: "completed"; value: T; replayed: boolean; sequence: number }
 *   | { status: "failed"; errors: string[]; replayed: boolean; sequence: number };
 *
 * export interface Activity {
 *   llm<S extends z.ZodType>(params: {
 *     agentId: string;
 *     tick: number;
 *     purpose: string;
 *     prompt: string;
 *     schema: S;
 *     // Pure. Runs on FIRST execution only; its events are appended in the
 *     // SAME transaction as the journal entry, journal entry first.
 *     deriveEvents?: (value: z.output<S>) => AgentEvent[];
 *   }): Promise<ActivityResult<z.output<S>>>;
 * }
 *
 * export const createActivity: (input: {
 *   store: Store;
 *   llm: LlmClient;
 * }) => Activity;
 * ```
 *
 * Semantics under test:
 * - Journal hit (llm_call_completed OR llm_call_failed for the key
 *   (agentId, tick, purpose) already in the LOG — never a projection) returns
 *   the journaled outcome with zero API calls. `replayed: true`, `sequence`
 *   = the original journal event's sequence.
 * - First execution: call model → JSON.parse → schema.parse. On either
 *   failure, retry ≤2 with the original prompt plus the error text appended.
 *   Attempts 1..3.
 * - After 3 failed attempts: append llm_call_failed (one error string per
 *   attempt) and resolve { status: "failed" }. Never throw for model output.
 * - Transport errors (LlmClient rejection) DO propagate — nothing journaled,
 *   crash-resume retries the call. Exactly-once effect, at-least-once call.
 * - Journal hits re-parse the stored result against the schema — drift
 *   throws.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createActivity } from "../src/activity.ts";
import { createMockLlm, type LlmClient } from "../src/llm.ts";
import { initDB } from "../src/db.ts";
import { initStore } from "../src/store.ts";
import { replay } from "../src/projection.ts";
import { formatEvent } from "../src/logger.ts";
import type { StoredEvent } from "../src/events.ts";
import {
  freshDb,
  INVALID_EVENT,
  LLM_CALL_COMPLETED,
  LLM_CALL_FAILED,
  OBSERVATION,
  type Harness,
} from "./helpers.ts";

const RESULT_SCHEMA = z.strictObject({ mood: z.string(), score: z.number() });
const VALID_JSON = '{"mood":"curious","score":7}';
const GARBAGE = "not json at all {{";
const WRONG_SHAPE = '{"wrong":true}';

const BASE_PARAMS = {
  agentId: "maria",
  tick: 0,
  purpose: "assess_mood",
  prompt: "How does maria feel right now?",
  schema: RESULT_SCHEMA,
};

let h: Harness;
beforeEach(() => {
  h = freshDb();
});
afterEach(() => h?.cleanup());

const completedEvents = () =>
  h.store.read().flatMap((e) => (e.type === "llm_call_completed" ? [e] : []));
const failedEvents = () =>
  h.store.read().flatMap((e) => (e.type === "llm_call_failed" ? [e] : []));

// ─── journal event schemas ───────────────────────────────────────────────────

describe("journal event schemas", () => {
  it("round-trips llm_call_completed through the store", () => {
    h.store.append(LLM_CALL_COMPLETED);
    const [event] = h.store.read();
    expect(event).toMatchObject(LLM_CALL_COMPLETED);
  });

  it("round-trips llm_call_failed through the store", () => {
    h.store.append(LLM_CALL_FAILED);
    const [event] = h.store.read();
    expect(event).toMatchObject(LLM_CALL_FAILED);
  });

  it("rejects an empty purpose", () => {
    expect(() =>
      h.store.append({ ...LLM_CALL_COMPLETED, purpose: "" }),
    ).toThrow();
  });

  it("rejects attempts of 0", () => {
    expect(() =>
      h.store.append({ ...LLM_CALL_COMPLETED, attempts: 0 }),
    ).toThrow();
  });

  it("rejects attempts above 3", () => {
    expect(() =>
      h.store.append({ ...LLM_CALL_COMPLETED, attempts: 4 }),
    ).toThrow();
  });

  it("rejects unknown keys (strictObject holds)", () => {
    expect(() =>
      h.store.append({
        ...LLM_CALL_COMPLETED,
        smuggled: true,
      } as never),
    ).toThrow();
  });

  it("rejects an empty errors array on llm_call_failed", () => {
    expect(() =>
      h.store.append({ ...LLM_CALL_FAILED, errors: [] }),
    ).toThrow();
  });

  it("accepts any JSON value as a result — nested object", () => {
    h.store.append({
      ...LLM_CALL_COMPLETED,
      result: { a: [1, "x", { b: null }] },
    });
    const [event] = completedEvents();
    expect(event!.result).toEqual({ a: [1, "x", { b: null }] });
  });

  it("accepts any JSON value as a result — bare scalar", () => {
    h.store.append({ ...LLM_CALL_COMPLETED, result: "just a string" });
    const [event] = completedEvents();
    expect(event!.result).toBe("just a string");
  });
});

// ─── store read filters ──────────────────────────────────────────────────────

describe("store read filters", () => {
  beforeEach(() => {
    h.store.append(OBSERVATION); // tick 0
    h.store.append(LLM_CALL_COMPLETED); // tick 2
    h.store.append(LLM_CALL_FAILED); // tick 3
  });

  it("filters by type", () => {
    const events = h.store.read({ type: "llm_call_completed" });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("llm_call_completed");
  });

  it("filters by tick", () => {
    const events = h.store.read({ tick: 3 });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("llm_call_failed");
  });

  it("combines agentId, tick and type", () => {
    const events = h.store.read({
      agentId: "maria",
      tick: 2,
      type: "llm_call_completed",
    });
    expect(events).toHaveLength(1);
  });

  it("still returns everything unfiltered", () => {
    expect(h.store.read()).toHaveLength(3);
  });
});

// ─── first execution ─────────────────────────────────────────────────────────

describe("activity.llm — first execution", () => {
  it("calls the model exactly once on clean success", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    expect(mock.calls()).toHaveLength(1);
  });

  it("passes purpose and prompt through to the model", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    expect(mock.calls()[0]).toEqual({
      purpose: "assess_mood",
      prompt: BASE_PARAMS.prompt,
    });
  });

  it("returns the schema-parsed value", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    const result = await activity.llm(BASE_PARAMS);
    expect(result).toMatchObject({
      status: "completed",
      replayed: false,
      value: { mood: "curious", score: 7 },
    });
  });

  it("appends llm_call_completed with the key, prompt, result and attempts", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);

    const [event] = completedEvents();
    expect(event).toMatchObject({
      agentId: "maria",
      tick: 0,
      purpose: "assess_mood",
      prompt: BASE_PARAMS.prompt,
      result: { mood: "curious", score: 7 },
      attempts: 1,
    });
  });

  it("returns the journal event's sequence", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    const result = await activity.llm(BASE_PARAMS);
    expect(result.sequence).toBe(completedEvents()[0]!.sequence);
  });
});

// ─── journal replay ──────────────────────────────────────────────────────────

describe("activity.llm — journal replay", () => {
  it("makes no API call on a journal hit", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    await activity.llm(BASE_PARAMS);
    expect(mock.calls()).toHaveLength(1);
  });

  // M1 acceptance test 3.
  it("returns a byte-identical result on a journal hit", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    const first = await activity.llm(BASE_PARAMS);
    const second = await activity.llm(BASE_PARAMS);
    if (first.status !== "completed" || second.status !== "completed") {
      throw new Error("expected both calls to complete");
    }
    expect(JSON.stringify(second.value)).toBe(JSON.stringify(first.value));
  });

  it("marks the hit as replayed with the original sequence", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    const first = await activity.llm(BASE_PARAMS);
    const second = await activity.llm(BASE_PARAMS);
    expect(second.replayed).toBe(true);
    expect(second.sequence).toBe(first.sequence);
  });

  it("never writes a duplicate journal entry", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    await activity.llm(BASE_PARAMS);
    await activity.llm(BASE_PARAMS);
    expect(completedEvents()).toHaveLength(1);
  });

  it("replays a journaled FAILURE without an API call — the halt is durable", async () => {
    const mock = createMockLlm({ responses: { assess_mood: GARBAGE } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS); // 3 attempts, journals llm_call_failed
    const callsAfterFirst = mock.calls().length;

    const second = await activity.llm(BASE_PARAMS);
    expect(second.status).toBe("failed");
    expect(second.replayed).toBe(true);
    expect(mock.calls()).toHaveLength(callsAfterFirst);
  });

  it("survives a projection wipe — the journal lives in the log", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);

    h.db.prepare("DELETE FROM projection_memories").run();

    const result = await activity.llm(BASE_PARAMS);
    expect(result.replayed).toBe(true);
    expect(mock.calls()).toHaveLength(1);
  });

  it("throws loudly when the journaled result no longer matches the schema", async () => {
    // Simulates schema drift under a live log: a journal entry exists but
    // its shape predates the current code.
    h.store.append({
      type: "llm_call_completed",
      agentId: "maria",
      tick: 0,
      purpose: "assess_mood",
      prompt: BASE_PARAMS.prompt,
      result: { wrong: "shape" },
      attempts: 1,
    });
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await expect(activity.llm(BASE_PARAMS)).rejects.toThrow();
    expect(mock.calls()).toHaveLength(0);
  });
});

// ─── journal keying ──────────────────────────────────────────────────────────

describe("activity.llm — journal keying", () => {
  it("a different purpose in the same tick is a fresh call", async () => {
    const mock = createMockLlm({
      responses: { assess_mood: VALID_JSON, pick_action: VALID_JSON },
    });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    await activity.llm({ ...BASE_PARAMS, purpose: "pick_action" });
    expect(mock.calls()).toHaveLength(2);
  });

  it("a different tick with the same purpose is a fresh call", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    await activity.llm({ ...BASE_PARAMS, tick: 1 });
    expect(mock.calls()).toHaveLength(2);
  });

  it("a different agent with the same tick and purpose is a fresh call", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    await activity.llm({ ...BASE_PARAMS, agentId: "klaus" });
    expect(mock.calls()).toHaveLength(2);
  });
});

// ─── retry & checkpoint-halt ─────────────────────────────────────────────────

describe("activity.llm — retry and checkpoint-halt", () => {
  it("retries once after garbage output and completes", async () => {
    const mock = createMockLlm({
      responses: { assess_mood: [GARBAGE, VALID_JSON] },
    });
    const activity = createActivity({ store: h.store, llm: mock });
    const result = await activity.llm(BASE_PARAMS);
    expect(result.status).toBe("completed");
    expect(mock.calls()).toHaveLength(2);
  });

  it("retries after valid-JSON-wrong-shape output too", async () => {
    const mock = createMockLlm({
      responses: { assess_mood: [WRONG_SHAPE, VALID_JSON] },
    });
    const activity = createActivity({ store: h.store, llm: mock });
    const result = await activity.llm(BASE_PARAMS);
    expect(result.status).toBe("completed");
    expect(mock.calls()).toHaveLength(2);
  });

  it("journals the real attempt count", async () => {
    const mock = createMockLlm({
      responses: { assess_mood: [GARBAGE, VALID_JSON] },
    });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    expect(completedEvents()[0]!.attempts).toBe(2);
  });

  it("feeds the error back: retry prompt contains the original prompt and differs", async () => {
    const mock = createMockLlm({
      responses: { assess_mood: [GARBAGE, VALID_JSON] },
    });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);

    const [first, second] = mock.calls();
    expect(second!.prompt).toContain(BASE_PARAMS.prompt);
    expect(second!.prompt).not.toBe(first!.prompt);
  });

  it("feeds the validation error back on schema mismatch", async () => {
    const mock = createMockLlm({
      responses: { assess_mood: [WRONG_SHAPE, VALID_JSON] },
    });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);

    // The zod issue is about the missing keys — the retry prompt must
    // surface it so the model gets feedback, not a blind re-roll.
    expect(mock.calls()[1]!.prompt).toContain("mood");
  });

  it("halts after 3 attempts: resolves failed, never throws", async () => {
    const mock = createMockLlm({ responses: { assess_mood: GARBAGE } });
    const activity = createActivity({ store: h.store, llm: mock });
    const result = await activity.llm(BASE_PARAMS);
    expect(result.status).toBe("failed");
    expect(mock.calls()).toHaveLength(3);
  });

  it("never makes a 4th attempt even when it would succeed", async () => {
    const mock = createMockLlm({
      responses: { assess_mood: [GARBAGE, GARBAGE, GARBAGE, VALID_JSON] },
    });
    const activity = createActivity({ store: h.store, llm: mock });
    const result = await activity.llm(BASE_PARAMS);
    expect(result.status).toBe("failed");
    expect(mock.calls()).toHaveLength(3);
  });

  it("journals llm_call_failed with one error per attempt", async () => {
    const mock = createMockLlm({ responses: { assess_mood: GARBAGE } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);

    const [event] = failedEvents();
    expect(event).toMatchObject({
      agentId: "maria",
      tick: 0,
      purpose: "assess_mood",
      attempts: 3,
    });
    expect(event!.errors).toHaveLength(3);
  });

  it("writes no llm_call_completed on failure", async () => {
    const mock = createMockLlm({ responses: { assess_mood: GARBAGE } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(BASE_PARAMS);
    expect(completedEvents()).toHaveLength(0);
  });

  it("propagates transport errors and journals nothing", async () => {
    const broken: LlmClient = {
      complete: async () => {
        throw new Error("ECONNRESET");
      },
    };
    const activity = createActivity({ store: h.store, llm: broken });
    await expect(activity.llm(BASE_PARAMS)).rejects.toThrow("ECONNRESET");
    expect(h.count()).toBe(0);
  });

  it("retries the API after a transport crash — nothing was journaled", async () => {
    const broken: LlmClient = {
      complete: async () => {
        throw new Error("ECONNRESET");
      },
    };
    const activityBefore = createActivity({ store: h.store, llm: broken });
    await expect(activityBefore.llm(BASE_PARAMS)).rejects.toThrow();

    // "Resume": same log, working client.
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activityAfter = createActivity({ store: h.store, llm: mock });
    const result = await activityAfter.llm(BASE_PARAMS);
    expect(result).toMatchObject({ status: "completed", replayed: false });
    expect(mock.calls()).toHaveLength(1);
  });
});

// ─── transaction boundary ────────────────────────────────────────────────────

describe("activity.llm — deriveEvents atomicity", () => {
  const WITH_DERIVED = {
    ...BASE_PARAMS,
    deriveEvents: (value: z.output<typeof RESULT_SCHEMA>) => [
      {
        type: "observation" as const,
        agentId: "maria",
        tick: 0,
        content: `maria feels ${value.mood}`,
        importance: 5,
      },
    ],
  };

  it("appends derived events in the same transaction, journal entry first", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(WITH_DERIVED);

    const events = h.store.read();
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("llm_call_completed");
    expect(events[1]).toMatchObject({
      type: "observation",
      content: "maria feels curious",
    });
    // Contiguous: one transaction, causal order.
    expect(events[1]!.sequence).toBe(events[0]!.sequence + 1);
  });

  it("rolls back the journal entry when a derived event is invalid", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await expect(
      activity.llm({
        ...BASE_PARAMS,
        deriveEvents: () => [INVALID_EVENT],
      }),
    ).rejects.toThrow();
    expect(h.count()).toBe(0);
  });

  // THE Rach question: process dies after the API responds but before the
  // journal commits. The rolled-back call above stands in for the crash;
  // the invariant is that the API gets called AGAIN — at-least-once calls,
  // exactly-once journaled effects.
  it("re-calls the API after a rolled-back journal write", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await expect(
      activity.llm({ ...BASE_PARAMS, deriveEvents: () => [INVALID_EVENT] }),
    ).rejects.toThrow();

    const result = await activity.llm(WITH_DERIVED);
    expect(result).toMatchObject({ status: "completed", replayed: false });
    expect(mock.calls()).toHaveLength(2);
    expect(h.count()).toBe(2);
  });

  it("does not re-derive on a journal hit", async () => {
    const mock = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activity = createActivity({ store: h.store, llm: mock });
    await activity.llm(WITH_DERIVED);
    const countAfterFirst = h.count();

    await activity.llm(WITH_DERIVED);
    expect(h.count()).toBe(countAfterFirst);
  });
});

// ─── crash and resume ────────────────────────────────────────────────────────

// M1 acceptance test 1: run a step → crash → resume: API called exactly once.
describe("activity.llm — crash and resume", () => {
  it("a restarted process replays from the journal with zero API calls", async () => {
    const mockBefore = createMockLlm({ responses: { assess_mood: VALID_JSON } });
    const activityBefore = createActivity({ store: h.store, llm: mockBefore });
    const first = await activityBefore.llm(BASE_PARAMS);

    // kill -9: drop the connection without any orderly shutdown.
    h.db.close();

    const db = initDB({ dbPath: h.dbPath });
    try {
      const mockAfter = createMockLlm({ responses: { assess_mood: VALID_JSON } });
      const activityAfter = createActivity({
        store: initStore(db),
        llm: mockAfter,
      });
      const second = await activityAfter.llm(BASE_PARAMS);

      expect(mockAfter.calls()).toHaveLength(0);
      expect(second.replayed).toBe(true);
      if (first.status !== "completed" || second.status !== "completed") {
        throw new Error("expected both calls to complete");
      }
      expect(JSON.stringify(second.value)).toBe(JSON.stringify(first.value));
    } finally {
      db.close();
    }
  });
});

// ─── chaos ───────────────────────────────────────────────────────────────────

// M1 acceptance test 2: many ticks under chaos, zero uncaught exceptions,
// failures visible in the log as events.
describe("activity.llm — chaos", () => {
  it("500 ticks at chaosRate 0.5: no exceptions, every outcome journaled", async () => {
    const mock = createMockLlm({
      responses: { chaos_step: '{"ok":true}' },
      chaosRate: 0.5,
      seed: 7,
    });
    const activity = createActivity({ store: h.store, llm: mock });
    const schema = z.strictObject({ ok: z.boolean() });

    let completed = 0;
    let failed = 0;
    for (let tick = 0; tick < 500; tick++) {
      // No try/catch: a single throw here fails the test, which is the point.
      const result = await activity.llm({
        agentId: "maria",
        tick,
        purpose: "chaos_step",
        prompt: "step",
        schema,
      });
      if (result.status === "completed") completed++;
      else failed++;
    }

    expect(completed + failed).toBe(500);
    // At 0.5 garbage, both outcomes are statistically certain to occur.
    expect(completed).toBeGreaterThan(0);
    expect(failed).toBeGreaterThan(0);

    // The log tells the same story as the return values.
    expect(completedEvents()).toHaveLength(completed);
    expect(failedEvents()).toHaveLength(failed);

    // The retry path was exercised: some call recovered on attempt 2 or 3.
    expect(
      completedEvents().some((event) => event.attempts > 1),
    ).toBe(true);
  });
});

// ─── integration with M0 surfaces ────────────────────────────────────────────

describe("journal events across the M0 surfaces", () => {
  it("journal events are not memories: replay projects none", () => {
    h.store.append(OBSERVATION);
    h.store.append(LLM_CALL_COMPLETED);
    h.store.append(LLM_CALL_FAILED);

    replay(h.db);

    const rows = h.memories();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe(OBSERVATION.content);
  });

  it("the logger renders llm_call_completed", () => {
    const sequence = h.store.append(LLM_CALL_COMPLETED);
    const [event] = h.store.read() as [StoredEvent];
    expect(() => formatEvent(event)).not.toThrow();
    expect(formatEvent(event)).toContain("score_importance");
    expect(formatEvent(event)).toContain(String(sequence));
  });

  it("the logger renders llm_call_failed", () => {
    h.store.append(LLM_CALL_FAILED);
    const [event] = h.store.read() as [StoredEvent];
    expect(() => formatEvent(event)).not.toThrow();
    expect(formatEvent(event)).toContain("score_importance");
  });
});
