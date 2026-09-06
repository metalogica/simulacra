/**
 * The memory-characterisation activity: score importance, embed, commit —
 * one journaled unit.
 *
 * @module
 * `activity.ts` holds the generic journaled call. This module is the
 * memory-specific one: it turns a piece of content into an `observation`
 * with a model-scored importance and a journaled embedding, atomically.
 *
 * Data flow, first execution:
 *
 *   findReceipt(store, { agentId, tick, purpose })            → miss
 *   callWithValidation({ prompt: importancePrompt(content),
 *                        schema: importanceSchema })
 *     ok: false → store.append(llm_call_failed) → { status: "failed" }
 *     ok: true  ↓
 *   embeddings.embed({ purpose, text: content })              rejects → propagates,
 *                                                             nothing journaled
 *   store.transaction(() => {
 *     receipt  = append(llm_call_completed { result: { importance }, attempts })
 *     memory   = append(observation { content, importance })
 *                append(embedding_computed { memorySequence: memory, model, vector })
 *   })
 *   → { status: "completed", replayed: false, sequence: receipt, importance }
 *
 * Replay: `findReceipt` hits → no model call, no embedding call, no rows.
 *   completed → { replayed: true, importance } (result re-parsed against
 *   `importanceSchema` — drift under a live log fails loudly)
 *   failed    → { status: "failed", replayed: true, errors }
 *
 * The three rows commit contiguously, receipt first, in ONE transaction. A
 * crash anywhere before the commit leaves no receipt, so resume calls both
 * providers again: at-least-once calls, exactly-once effects — now spanning
 * two external calls.
 *
 * `importancePrompt(content)` must contain the paper's scale text ("scale of
 * 1 to 10", "purely mundane", "extremely poignant"), the content itself, and
 * an instruction to answer as JSON `{"importance": n}`.
 */
import { todo } from "./todo.ts";
import { z } from "zod";
import type { EmbeddingClient } from "./embedding.ts";
import type { LlmClient } from "./llm.ts";
import type { Store } from "./store.ts";

export const importanceSchema = z.strictObject({
  importance: z.int().min(1).max(10),
});

export const importancePrompt = (content: string): string => todo(content);

export interface CharacterizeInput {
  agentId: string;
  tick: number;
  purpose: string;
  content: string;
}

export type CharacterizeResult =
  | {
      status: "completed";
      replayed: boolean;
      sequence: number;
      importance: number;
    }
  | {
      status: "failed";
      replayed: boolean;
      sequence: number;
      errors: string[];
    };

export type Characterize = (
  input: CharacterizeInput,
) => Promise<CharacterizeResult>;

export interface CreateCharacterizeInput {
  store: Store;
  llm: LlmClient;
  embeddings: EmbeddingClient;
}

export const createCharacterize = (deps: CreateCharacterizeInput): Characterize =>
  todo(deps);
