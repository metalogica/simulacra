/**
 * Contract for `src/journal.ts` — the idempotency lookup, extracted from
 * activity.ts. Rep 13 of M2.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findReceipt } from "../src/journal.ts";
import {
  freshDb,
  LLM_CALL_COMPLETED,
  LLM_CALL_FAILED,
  OBSERVATION,
  type Harness,
} from "./helpers.ts";

let h: Harness;
beforeEach(() => {
  h = freshDb();
});
afterEach(() => h?.cleanup());

// LLM_CALL_COMPLETED is (maria, tick 2, score_importance).
const KEY = { agentId: "maria", tick: 2, purpose: "score_importance" };

describe("findReceipt", () => {
  it("returns null when nothing is journaled", () => {
    expect(findReceipt(h.store, KEY)).toBeNull();
  });

  it("finds a completed receipt by (agentId, tick, purpose)", () => {
    h.store.append(LLM_CALL_COMPLETED);
    const receipt = findReceipt(h.store, KEY);
    expect(receipt?.type).toBe("llm_call_completed");
    expect(receipt).toMatchObject(LLM_CALL_COMPLETED);
  });

  it("finds a failed receipt", () => {
    h.store.append({ ...LLM_CALL_FAILED, tick: 2 });
    const receipt = findReceipt(h.store, KEY);
    expect(receipt?.type).toBe("llm_call_failed");
  });

  it("prefers a completed receipt when both exist for one key", () => {
    h.store.append({ ...LLM_CALL_FAILED, tick: 2 });
    h.store.append(LLM_CALL_COMPLETED);
    expect(findReceipt(h.store, KEY)?.type).toBe("llm_call_completed");
  });

  it("returns the receipt's own sequence", () => {
    const sequence = h.store.append(LLM_CALL_COMPLETED);
    expect(findReceipt(h.store, KEY)?.sequence).toBe(sequence);
  });

  it("does not match a different purpose in the same tick", () => {
    h.store.append(LLM_CALL_COMPLETED);
    expect(findReceipt(h.store, { ...KEY, purpose: "pick_action" })).toBeNull();
  });

  it("does not match a different tick", () => {
    h.store.append(LLM_CALL_COMPLETED);
    expect(findReceipt(h.store, { ...KEY, tick: 3 })).toBeNull();
  });

  it("does not match a different agent", () => {
    h.store.append(LLM_CALL_COMPLETED);
    expect(findReceipt(h.store, { ...KEY, agentId: "klaus" })).toBeNull();
  });

  it("ignores non-journal events under the same key", () => {
    h.store.append({ ...OBSERVATION, tick: 2 });
    expect(findReceipt(h.store, KEY)).toBeNull();
  });

  it("survives a projection wipe — the lookup reads the log", () => {
    h.store.append(LLM_CALL_COMPLETED);
    h.db.prepare("DELETE FROM projection_memories").run();
    expect(findReceipt(h.store, KEY)?.type).toBe("llm_call_completed");
  });
});
