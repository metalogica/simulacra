/**
 * Retrieval ranking — pure. No database, no clients.
 *
 * @module
 * Park et al.: score = α·recency + α·importance + α·relevance, each min-max
 * normalised to [0, 1], all α = 1. This module is that formula and nothing
 * else; `src/retrieval.ts` feeds it rows and joins content back on.
 *
 * Contract:
 * - Raw components per candidate:
 *     recency    = recencyScore({ createdTick: tick, nowTick, ticksPerHour, decay })
 *     importance = the 1–10 integer as stored
 *     relevance  = cosineSimilarity(embedding, queryEmbedding), or 0 when the
 *                  candidate has no embedding yet
 * - Each component is then min-max normalised ACROSS THE CANDIDATE SET, and
 *   the three normalised values are summed with weight 1 each.
 * - Output carries the NORMALISED components, so a caller can explain a rank.
 * - Sorted by score descending; ties broken by sequence ascending, so the
 *   order is stable across calls and rebuilds.
 * - Every candidate is returned. Truncation to k is the caller's job.
 * - `[]` → `[]`. Inputs are not mutated. A dimension mismatch throws.
 */
import { todo } from "./todo.ts";

export interface MemoryCandidate {
  sequence: number;
  tick: number;
  importance: number;
  embedding: Float32Array | null;
}

export interface RankParams {
  queryEmbedding: Float32Array;
  nowTick: number;
  ticksPerHour: number;
  decay: number;
}

export interface ScoredMemory {
  sequence: number;
  score: number;
  recency: number;
  importance: number;
  relevance: number;
}

export const rankMemories = (
  candidates: MemoryCandidate[],
  params: RankParams,
): ScoredMemory[] => todo(candidates, params);
