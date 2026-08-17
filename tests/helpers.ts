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
  content: string;
  importance: number;
  last_retrieved_tick: number | null;
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

export const OBSERVATION: AgentEvent = {
  type: "observation",
  agentId: "maria",
  tick: 0,
  content: "Klaus is reading alone in the cafe",
  importance: 4,
};

export const REFLECTION: AgentEvent = {
  type: "reflection",
  agentId: "maria",
  tick: 1,
  content: "Klaus spends most of his mornings by himself",
  importance: 7,
  pointerSequences: [1],
};

export const KLAUS_OBSERVATION: AgentEvent = {
  type: "observation",
  agentId: "klaus",
  tick: 0,
  content: "Maria walked past the window",
  importance: 3,
};

/** Deliberately invalid — importance is outside the 1–10 scale. */
export const INVALID_EVENT = {
  type: "observation",
  agentId: "maria",
  tick: 0,
  content: "this should never be written",
  importance: 99,
} as unknown as AgentEvent;

/** `n` observations for the same agent, ticks ascending. */
export const observations = (n: number, agentId = "maria"): AgentEvent[] =>
  Array.from({ length: n }, (_unused, i) => ({
    type: "observation" as const,
    agentId,
    tick: i,
    content: `observation number ${i}`,
    importance: (i % 10) + 1,
  }));
