/**
 * Retrieval — read the projection, rank it, return the top k.
 *
 * @module
 * Data flow:
 *   readMemories(db, agentId)            → MemoryRow[]        (one SELECT)
 *   rows → MemoryCandidate[]             (decodeVector on non-null blobs)
 *   rankMemories(candidates, params)     → ScoredMemory[]     (pure)
 *   join content back on by sequence, slice(0, k)
 *
 * Contract:
 * - Reads ONLY `projection_memories`. Takes no LlmClient and no
 *   EmbeddingClient, so "retrieve never calls the network" is a type-level
 *   guarantee. The query embedding is the caller's problem.
 * - Never writes. Under option C nothing about a read is worth recording.
 * - Scoped to one agent. Never returns another agent's memories.
 * - `k` results at most; fewer when fewer exist; `k = 0` → `[]`.
 * - Recency reads `nowTick`, never the wall clock.
 * - `ticksPerHour` defaults to `DEFAULT_TICKS_PER_HOUR`; `decay` to
 *   `DEFAULT_DECAY`.
 * - Because every input is a projection row and every projection row is a
 *   pure function of the log, the FULL ORDERED result is identical before and
 *   after a projection rebuild. That is M2 acceptance test 1.
 */
import { todo } from "./todo.ts";
import type BetterSqlite3 from "better-sqlite3";
import type { MemoryRow } from "./projection.ts";

export const DEFAULT_TICKS_PER_HOUR = 60;

export interface RetrieveParams {
  agentId: string;
  queryEmbedding: Float32Array;
  nowTick: number;
  k: number;
  ticksPerHour?: number;
  decay?: number;
}

export interface RetrievedMemory {
  sequence: number;
  content: string;
  score: number;
  recency: number;
  importance: number;
  relevance: number;
}

export const readMemories = (
  db: BetterSqlite3.Database,
  agentId: string,
): MemoryRow[] => todo(db, agentId);

export const retrieve = (
  db: BetterSqlite3.Database,
  params: RetrieveParams,
): RetrievedMemory[] => todo(db, params);
