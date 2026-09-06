/**
 * OpenRouter adapters for both ports, over raw `fetch`. Zero dependencies.
 *
 * @module
 * Contract:
 * - `config.fetch` is REQUIRED and injected. Tests never touch the network;
 *   `main.ts` passes `globalThis.fetch`.
 * - `baseUrl` defaults to `DEFAULT_OPENROUTER_BASE_URL`.
 * - `llm.complete({ purpose, prompt })`:
 *     POST {baseUrl}/chat/completions
 *     headers: Authorization: Bearer <apiKey>, Content-Type: application/json
 *     body: { model: chatModel, messages: [{ role: "user", content: prompt }],
 *             temperature: 0 }
 *     returns choices[0].message.content, which must be a string.
 * - `embeddings.embed({ purpose, text })`:
 *     POST {baseUrl}/embeddings
 *     body: { model: embeddingModel, input: text }
 *     returns { vector: data[0].embedding, model: embeddingModel }; every
 *     element must be a finite number.
 * - EVERY failure throws: a non-2xx status; a 2xx body carrying an `error`
 *   member (OpenRouter reports upstream failures that way, so `response.ok`
 *   alone is insufficient); a body missing the expected fields. A thrown
 *   transport error journals nothing (M1 policy).
 * - Error messages never include the api key.
 * - `purpose` is a journal concern and is not sent to the provider.
 */
import { todo } from "./todo.ts";
import type { LlmClient } from "./llm.ts";
import type { EmbeddingClient } from "./embedding.ts";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterConfig {
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  fetch: typeof globalThis.fetch;
  baseUrl?: string;
}

export interface OpenRouterClients {
  llm: LlmClient;
  embeddings: EmbeddingClient;
}

export const createOpenRouterClients = (
  config: OpenRouterConfig,
): OpenRouterClients => todo(config);
