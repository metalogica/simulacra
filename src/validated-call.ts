/**
 * Call the model until its output parses — M1's retry-with-feedback loop,
 * extracted so every activity shares one copy.
 *
 * @module
 * Contract:
 * - Up to `MAX_ATTEMPTS` (3). Each attempt: `llm.complete({ purpose, prompt })`
 *   → `JSON.parse` → `schema.parse`.
 * - On a semantic failure (either parse throws) the NEXT prompt is the
 *   ORIGINAL prompt, then a blank line, then a rejection notice ending in the
 *   error message. It is not cumulative: attempt 3 sees attempt 2's error,
 *   not attempt 1's.
 * - Success → `{ ok: true, value, attempts }`.
 * - Three failures → `{ ok: false, errors }`, one message per attempt.
 * - Transport errors (`llm.complete` rejects) are NOT caught. They propagate.
 * - Never touches a store. This is orchestration over the port, nothing more.
 */
import { todo } from "./todo.ts";
import type { LlmClient } from "./llm.ts";
import type z from "zod";

export const MAX_ATTEMPTS = 3;

export type ValidatedCall<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; errors: string[] };

export interface ValidatedCallInput<Schema extends z.ZodType> {
  llm: LlmClient;
  purpose: string;
  prompt: string;
  schema: Schema;
}

export const callWithValidation = <Schema extends z.ZodType>(
  input: ValidatedCallInput<Schema>,
): Promise<ValidatedCall<z.output<Schema>>> => todo(input);
