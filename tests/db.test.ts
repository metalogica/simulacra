import { afterEach, describe, expect, it } from "vitest";
import { initDB } from "../src/db.ts";
import { freshDb, type Harness } from "./helpers.ts";

let h: Harness;
afterEach(() => h?.cleanup());

const INSERT_ONE = `INSERT INTO events (tick, agent_id, type, payload, created_at)
                    VALUES (1, 'maria', 'observation', '{"content":"x","importance":4}', 1)`;

const countIn = (db: { prepare: (sql: string) => { get: () => unknown } }) =>
  (db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;

describe("durability pragmas", () => {
  // Configuring a guarantee is not the same as having one. journal_mode can
  // silently fail to switch, and if it does the entire crash-safety claim is
  // void with nothing in the suite to notice.
  it("asserts WAL, synchronous=NORMAL, foreign_keys, busy_timeout", () => {
    h = freshDb();
    expect(h.db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(h.db.pragma("synchronous", { simple: true })).toBe(1);
    expect(h.db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(h.db.pragma("busy_timeout", { simple: true })).toBe(5000);
  });
});

describe("the log is append-only", () => {
  it("blocks UPDATE at the database level", () => {
    h = freshDb();
    h.db.prepare(INSERT_ONE).run();
    expect(() =>
      h.db.prepare("UPDATE events SET payload = '{}' WHERE sequence = 1").run(),
    ).toThrow(/append-only|prohibited/i);
  });

  it("blocks DELETE at the database level", () => {
    h = freshDb();
    h.db.prepare(INSERT_ONE).run();
    expect(() =>
      h.db.prepare("DELETE FROM events WHERE sequence = 1").run(),
    ).toThrow(/append-only|prohibited/i);
  });

  // Documents the BOUNDARY of the guarantee, not a bug. Triggers make rows
  // immutable; they do not make the schema immutable. Being able to say
  // exactly where the fence ends is worth more than pretending it encloses
  // everything.
  it("does NOT block DROP TABLE — triggers protect rows, not schema", () => {
    h = freshDb();
    expect(() => h.db.exec("DROP TABLE events")).not.toThrow();
  });
});

describe("startup is idempotent", () => {
  // A runtime whose thesis is "kill it and it comes back" must survive being
  // started twice. CREATE TABLE without IF NOT EXISTS fails on run #2.
  it("opens the same database twice and keeps the data", () => {
    h = freshDb();
    h.db.prepare(INSERT_ONE).run();
    h.db.close();

    const second = initDB({ dbPath: h.dbPath });
    expect(countIn(second)).toBe(1);
    second.close();
  });
});

describe("read-only connections", () => {
  // The observability path (tail) opens the log read-only so it is physically
  // incapable of corrupting the thing it observes. initDB must therefore not
  // run its DDL or writer pragmas when readOnly is set.
  it("opens an existing database read-only", () => {
    h = freshDb();
    h.db.prepare(INSERT_ONE).run();
    h.db.close();

    const reader = initDB({ dbPath: h.dbPath, readOnly: true });
    expect(countIn(reader)).toBe(1);
    reader.close();
  });

  it("refuses writes through a read-only connection", () => {
    h = freshDb();
    h.db.close();

    const reader = initDB({ dbPath: h.dbPath, readOnly: true });
    expect(() => reader.prepare(INSERT_ONE).run()).toThrow(/readonly/i);
    reader.close();
  });
});

// ─── M2: projection_memories schema ──────────────────────────────────────────
// Columns after M2: sequence, agent_id, tick, content, importance,
// embedding (BLOB, nullable), embedding_model (TEXT, nullable).
//
// There is no migration framework (DECISIONS.md § M0). Instead: on open, if
// the projection table exists with a different column set, DROP it and
// recreate. Projections are disposable by law; replay() rebuilds them. The
// events table is never touched by this path.

import Database from "better-sqlite3";
import { emptyDbPath } from "./helpers.ts";

interface ColumnInfo {
  name: string;
  notnull: number;
  type: string;
}

const columnsOf = (
  db: { pragma: (sql: string) => unknown },
  table: string,
): ColumnInfo[] => db.pragma(`table_info(${table})`) as ColumnInfo[];

const columnNames = (db: { pragma: (sql: string) => unknown }): string[] =>
  columnsOf(db, "projection_memories")
    .map((column) => column.name)
    .sort();

describe("projection_memories schema (M2)", () => {
  it("carries exactly the columns retrieval reads", () => {
    h = freshDb();
    expect(columnNames(h.db)).toEqual(
      [
        "sequence",
        "agent_id",
        "tick",
        "content",
        "importance",
        "embedding",
        "embedding_model",
      ].sort(),
    );
  });

  it("no longer carries last_retrieved_tick — recency reads the creation tick", () => {
    h = freshDb();
    expect(columnNames(h.db)).not.toContain("last_retrieved_tick");
  });

  it("requires a tick on every memory row", () => {
    h = freshDb();
    expect(() =>
      h.db
        .prepare(
          `INSERT INTO projection_memories (sequence, agent_id, content, importance)
           VALUES (1, 'maria', 'x', 4)`,
        )
        .run(),
    ).toThrow(/NOT NULL/i);
  });

  it("allows a memory row with no embedding yet", () => {
    h = freshDb();
    expect(() =>
      h.db
        .prepare(
          `INSERT INTO projection_memories (sequence, agent_id, tick, content, importance)
           VALUES (1, 'maria', 0, 'x', 4)`,
        )
        .run(),
    ).not.toThrow();
  });

  it("stores the embedding as a BLOB and reads it back byte-identical", () => {
    h = freshDb();
    const blob = Buffer.from([0, 0, 128, 63, 0, 0, 32, 192]);
    h.db
      .prepare(
        `INSERT INTO projection_memories (sequence, agent_id, tick, content, importance, embedding, embedding_model)
         VALUES (1, 'maria', 0, 'x', 4, @blob, 'mock')`,
      )
      .run({ blob });
    const row = h.db
      .prepare("SELECT embedding FROM projection_memories WHERE sequence = 1")
      .get() as { embedding: Buffer };
    expect(Buffer.isBuffer(row.embedding)).toBe(true);
    expect(row.embedding.equals(blob)).toBe(true);
  });

  it("drops and recreates a stale projection table on open — projections are disposable", () => {
    const { dbPath, cleanup } = emptyDbPath();
    try {
      // A database left behind by the M1 schema.
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE projection_memories (
          sequence INTEGER PRIMARY KEY,
          agent_id TEXT NOT NULL,
          content TEXT NOT NULL,
          importance INTEGER NOT NULL,
          last_retrieved_tick INTEGER
        ) STRICT;
      `);
      legacy
        .prepare(
          "INSERT INTO projection_memories VALUES (1, 'maria', 'stale', 4, NULL)",
        )
        .run();
      legacy.close();

      const db = initDB({ dbPath });
      try {
        expect(columnNames(db)).toContain("embedding");
        expect(columnNames(db)).not.toContain("last_retrieved_tick");
        const { n } = db
          .prepare("SELECT COUNT(*) AS n FROM projection_memories")
          .get() as { n: number };
        expect(n).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      cleanup();
    }
  });

  it("leaves an up-to-date projection table alone on reopen", () => {
    h = freshDb();
    h.db
      .prepare(
        `INSERT INTO projection_memories (sequence, agent_id, tick, content, importance)
         VALUES (1, 'maria', 0, 'kept', 4)`,
      )
      .run();
    h.db.close();

    const second = initDB({ dbPath: h.dbPath });
    try {
      const { n } = second
        .prepare("SELECT COUNT(*) AS n FROM projection_memories")
        .get() as { n: number };
      expect(n).toBe(1);
    } finally {
      second.close();
    }
  });
});
