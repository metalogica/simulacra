/**
 * The idempotency lookup — "has this call already happened?"
 *
 * @module
 * Extracted from `activity.ts` so the characterize activity can reuse it.
 *
 * Contract:
 * - `findReceipt(store, { agentId, tick, purpose })` reads the LOG, never a
 *   projection: `rm -rf` of every projection must not cause a duplicate call.
 * - Looks for an `llm_call_completed` with that key first, then an
 *   `llm_call_failed`. Returns the first found, or `null`.
 * - `purpose` is matched in JS because it lives inside the payload column.
 * - Precedence matters: a completed receipt is the stronger fact. The pair
 *   should never coexist; if it does, completion wins.
 */
import { todo } from "./todo.ts";
import type { StoredEvent } from "./events.ts";
import type { Store } from "./store.ts";

export interface JournalKey {
  agentId: string;
  tick: number;
  purpose: string;
}

export type CompletedReceipt = Extract<StoredEvent, { type: "llm_call_completed" }>;
export type FailedReceipt = Extract<StoredEvent, { type: "llm_call_failed" }>;
export type Receipt = CompletedReceipt | FailedReceipt;

export const findReceipt = (store: Store, key: JournalKey): Receipt | null =>
  todo(store, key);
