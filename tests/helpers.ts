import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { initDB } from "../src/db.ts";
import { initStore, type Store } from "../src/store.ts";
import type { AgentEvent } from "../src/events.ts";

/**
 * Test harness for a throwaway database.
 *
 * @remarks
 * Every test gets its own file under `os.tmpdir()`. Shared state between tests
 * is how a suite starts lying to you — one test's leftover rows silently
 * satisfying the next test's assertion.
 *
 * `cleanup()` must close the connection *before* removing the directory, or the
 * WAL sidecars (`-wal`, `-shm`) stay open and leak into /tmp.
 */
export interface Harness {
  db: BetterSqlite3.Database;
  store: Store;
  dbPath: string;
  /** Row count of the log. */
  count: () => number;
  /** Every projection row, ordered by sequence. */
  memories: () => MemoryProjectionRow[];
  cleanup: () => void;
}

export interface MemoryProjectionRow {
  sequence: number;
  agent_id: string;
  tick: number;
  content: string;
  importance: number;
  embedding: Buffer | null;
  embedding_model: string | null;
}

let harnessCounter = 0;

export const freshDb = (): Harness => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `simulacra-${process.pid}-${harnessCounter++}-`),
  );
  const dbPath = path.join(dir, "test.sqlite3");

  const db = initDB({ dbPath });
  const store = initStore(db);

  return {
    db,
    store,
    dbPath,
    count: () =>
      (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n,
    memories: () =>
      db
        .prepare("SELECT * FROM projection_memories ORDER BY sequence")
        .all() as MemoryProjectionRow[],
    cleanup: () => {
      // Tolerant: some tests close the handle themselves to reopen it
      // read-only. Closing twice must not fail the test that already passed.
      try {
        db.close();
      } catch {
        /* already closed */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
};

/** A temp directory path that has no database in it yet. */
export const emptyDbPath = (): { dbPath: string; cleanup: () => void } => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `simulacra-empty-${process.pid}-${harnessCounter++}-`),
  );
  return {
    dbPath: path.join(dir, "test.sqlite3"),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
};

// ─── fixtures ────────────────────────────────────────────────────────────────

export const OBSERVATION = {
  type: "observation",
  agentId: "maria",
  tick: 0,
  content: "Klaus is reading alone in the cafe",
  importance: 4,
} satisfies AgentEvent;

export const REFLECTION = {
  type: "reflection",
  agentId: "maria",
  tick: 1,
  content: "Klaus spends most of his mornings by himself",
  importance: 7,
  pointerSequences: [1],
} satisfies AgentEvent;

export const KLAUS_OBSERVATION = {
  type: "observation",
  agentId: "klaus",
  tick: 0,
  content: "Maria walked past the window",
  importance: 3,
} satisfies AgentEvent;

/** Deliberately invalid — importance is outside the 1–10 scale. */
export const INVALID_EVENT = {
  type: "observation",
  agentId: "maria",
  tick: 0,
  content: "this should never be written",
  importance: 99,
} as unknown as AgentEvent;

export const LLM_CALL_COMPLETED = {
  type: "llm_call_completed",
  agentId: "maria",
  tick: 2,
  purpose: "score_importance",
  prompt: "Rate the importance of this observation from 1 to 10.",
  result: { score: 7 },
  attempts: 1,
} satisfies AgentEvent;

export const LLM_CALL_FAILED = {
  type: "llm_call_failed",
  agentId: "maria",
  tick: 3,
  purpose: "score_importance",
  prompt: "Rate the importance of this observation from 1 to 10.",
  errors: [
    "Unexpected token 'n' in JSON",
    "Unexpected token 'n' in JSON",
    "Unexpected token 'n' in JSON",
  ],
  attempts: 3,
} satisfies AgentEvent;

/** `n` observations for the same agent, ticks ascending. */
export const observations = (n: number, agentId = "maria"): AgentEvent[] =>
  Array.from({ length: n }, (_unused, i) => ({
    type: "observation" as const,
    agentId,
    tick: i,
    content: `observation number ${i}`,
    importance: (i % 10) + 1,
  }));

// ─── M2 fixtures ─────────────────────────────────────────────────────────────

/**
 * An embedding for the memory at sequence 1. The vector is a unit vector on
 * purpose (0.6² + 0.8² = 1) so cosine assertions read cleanly.
 */
export const EMBEDDING_COMPUTED = {
  type: "embedding_computed",
  agentId: "maria",
  tick: 0,
  memorySequence: 1,
  model: "mock",
  vector: [0.6, 0.8],
} satisfies AgentEvent;
