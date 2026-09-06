/**
 * The embedding port and its deterministic mock — M1's LlmClient pattern,
 * second verse.
 *
 * @module
 * Contract (port):
 * - `embed({ purpose, text })` resolves `{ vector, model }`.
 * - Transport failures REJECT. The port never resolves a sentinel — a
 *   sentinel would be journaled as a genuine vector and replayed forever.
 *
 * Contract (mock):
 * - `createMockEmbeddingClient({ dimension })`.
 * - vector = normalize(centre(draws)), where `draws` are `dimension` floats
 *   from `mulberry32(fnv1a(text))`. Hence identical text → identical vector,
 *   across processes; unit norm; unrelated texts near-orthogonal.
 * - Centring is what makes "near-orthogonal" true: uncentred uniform draws
 *   all point roughly the same way (cosine ≈ 0.72 at 256 dims), and every
 *   relevance assertion would pass vacuously.
 * - `model` is `MOCK_EMBEDDING_MODEL`.
 * - dimension < 2 throws: centring a single element yields the zero vector.
 * - `calls()` returns every request in order, like `MockLLM.calls()`.
 */
import { todo } from "./todo.ts";

export interface EmbedRequest {
  purpose: string;
  text: string;
}

export interface Embedding {
  vector: number[];
  model: string;
}

export interface EmbeddingClient {
  embed: (input: EmbedRequest) => Promise<Embedding>;
}

export interface MockEmbeddingClient extends EmbeddingClient {
  calls: () => ReadonlyArray<EmbedRequest>;
}

export const MOCK_EMBEDDING_MODEL = "mock";

export interface CreateMockEmbeddingClientInput {
  dimension: number;
}

export const createMockEmbeddingClient = (
  input: CreateMockEmbeddingClientInput,
): MockEmbeddingClient => todo(input);
