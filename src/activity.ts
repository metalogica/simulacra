/**
 * The journaled LLM activity — the single choke point for ALL model calls.
 *
 * @module
 * Temporal's workflow/activity split in miniature: everything in this file is
 * deterministic given the log; the only nondeterminism (the model call) is
 * journaled as an effect receipt so replay skips it.
 *
 * Error policy:
 * - Semantic errors (garbage JSON, schema mismatch) retry ≤2 with feedback,
 *   then checkpoint-halt the AGENT via a durable llm_call_failed receipt.
 * - Transport errors (client rejection) propagate and crash the step —
 *   nothing is journaled, so crash-resume simply retries the call.
 */

import type { AgentEvent, StoredEvent } from "./events.ts";
import type { LlmClient } from "./llm.ts";
import type { Store } from "./store.ts";
import type z from "zod";

const MAX_ATTEMPTS = 3;

type CompletedReceipt = Extract<StoredEvent, { type: "llm_call_completed" }>;
type FailedReceipt = Extract<StoredEvent, { type: "llm_call_failed" }>;

export type ActivityResult<T> =
  | {
      replayed: boolean;
      sequence: number;
      status: "completed";
      value: T;
    }
  | {
      errors: string[];
      replayed: boolean;
      sequence: number;
      status: "failed";
    };

export interface LLMInput<Schema extends z.ZodType> {
  agentId: string;
  tick: number;
  purpose: string;
  prompt: string;
  schema: Schema;
  /**
   * Pure. Runs on FIRST execution only; its events commit in the SAME
   * transaction as the receipt, receipt first. Replay never re-derives —
   * the derived events are already in the log.
   */
  deriveEvents?: (value: z.output<Schema>) => AgentEvent[];
}

interface CreateActivityInput {
  store: Store;
  llm: LlmClient;
}

export interface Activity {
  llm: <Schema extends z.ZodType>(
    input: LLMInput<Schema>,
  ) => Promise<ActivityResult<z.output<Schema>>>;
}

export const createActivity = (input: CreateActivityInput): Activity => {
  const { store, llm: llmClient } = input;

  const activity: Activity = {
    llm: async <Schema extends z.ZodType>({
      agentId,
      tick,
      purpose,
      prompt,
      schema,
      deriveEvents,
    }: LLMInput<Schema>): Promise<ActivityResult<z.output<Schema>>> => {
      // Journal lookup — against the LOG, never a projection. The type
      // equality in each predicate is narrowing for TS; the SQL filter
      // already guarantees it. Purpose is matched in JS because it lives
      // inside the payload column.
      const completedReceipt = store
        .read({ agentId, tick, type: "llm_call_completed" })
        .find(
          (event): event is CompletedReceipt =>
            event.type === "llm_call_completed" && event.purpose === purpose,
        );

      if (completedReceipt) {
        // Re-parse against the CURRENT schema: drift under a live log must
        // fail loudly, not return a stale shape.
        return {
          replayed: true,
          sequence: completedReceipt.sequence,
          status: "completed",
          value: schema.parse(completedReceipt.result),
        };
      }

      const failedReceipt = store
        .read({ agentId, tick, type: "llm_call_failed" })
        .find(
          (event): event is FailedReceipt =>
            event.type === "llm_call_failed" && event.purpose === purpose,
        );

      if (failedReceipt) {
        // The halt is durable — un-halting is an explicit new tick, not a
        // retry loop on replay.
        return {
          errors: failedReceipt.errors,
          replayed: true,
          sequence: failedReceipt.sequence,
          status: "failed",
        };
      }

      // Miss: this call has never happened. Attempt loop.
      const errors: string[] = [];
      let currentPrompt = prompt;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Deliberately NOT wrapped: a transport error means the world is
        // broken, not the model output — crash the step, journal nothing,
        // let crash-resume retry.
        const response = await llmClient.complete({
          purpose,
          prompt: currentPrompt,
        });

        let value: z.output<Schema>;
        try {
          value = schema.parse(JSON.parse(response));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push(message);
          currentPrompt = `${prompt}\n\nYour previous reply was rejected with this validation error — respond again with corrected JSON only:\n${message}`;
          continue;
        }

        // Success: receipt + derived events in ONE transaction, receipt
        // first. A crash before this line leaves no receipt, so resume
        // calls the API again — at-least-once calls, exactly-once effects.
        const receipt: AgentEvent = {
          type: "llm_call_completed",
          agentId,
          tick,
          purpose,
          prompt,
          result: value as CompletedReceipt["result"],
          attempts: attempt,
        };

        const sequences = store.appendMany([
          receipt,
          ...(deriveEvents?.(value) ?? []),
        ]);

        return {
          replayed: false,
          sequence: sequences[0]!,
          status: "completed",
          value,
        };
      }

      // Three strikes: checkpoint-halt the agent, not the process.
      const sequence = store.append({
        type: "llm_call_failed",
        agentId,
        tick,
        purpose,
        prompt,
        errors,
        attempts: MAX_ATTEMPTS,
      });

      return {
        errors,
        replayed: false,
        sequence,
        status: "failed",
      };
    },
  };

  return activity;
};
