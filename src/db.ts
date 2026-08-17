import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DEFAULT_DB_PATH = path.join(
  import.meta.dirname,
  "../db/simulacra.sqlite3",
);

export const initDB = (
  dbPath: string = DEFAULT_DB_PATH,
  verbose = false,
): BetterSqlite3.Database => {
  if (!path.isAbsolute(dbPath)) {
    throw new Error(`DB error: received invalid path ${dbPath}`);
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, {
    verbose: verbose ? console.log : undefined,
  });

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const journalMode = db.pragma("journal_mode", { simple: true });
  if (journalMode !== "wal") {
    throw new Error("DB Check Violation: DB journal mode not set to WAL");
  }

  const synchronousMode = db.pragma("synchronous", { simple: true });
  if (synchronousMode !== 1) {
    throw new Error("DB Check Violation: synchronous mode not set to NORMAL: ");
  }

  const foreignKeysMode = db.pragma("foreign_keys", { simple: true });
  if (foreignKeysMode !== 1) {
    throw new Error("DB Check Violation: Foreign keys not enabled");
  }

  const busyTimeoutMs = db.pragma("busy_timeout", { simple: true });
  if (busyTimeoutMs !== 5000) {
    throw new Error("DB Check Violation: Busy Timeout not set to 5000ms");
  }

  db.transaction(() => {
    db.prepare(
      /*sql*/ `
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY,
        tick INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
    `,
    ).run();

    db.prepare(
      /*sql*/ `
      CREATE INDEX IF NOT EXISTS index_events_agent_id_sequence
      ON events(agent_id, sequence);
    `,
    ).run();

    db.prepare(
      /*sql*/ `
      CREATE TRIGGER IF NOT EXISTS trigger_prevent_events_update
      BEFORE UPDATE ON events
      BEGIN
        SELECT RAISE(ABORT, 'Immutable log violation: UPDATE is prohibited');
      END;
    `,
    ).run();

    db.prepare(
      /*sql*/ `
      CREATE TRIGGER IF NOT EXISTS trigger_prevent_events_delete
      BEFORE DELETE ON events
      BEGIN
        SELECT RAISE(ABORT, 'Immutable log violation: DELETE is prohibited');
      END;
    `,
    ).run();

    db.prepare(
      /*sql*/ `
      CREATE TABLE IF NOT EXISTS projection_memories (
        sequence INTEGER PRIMARY KEY,
        agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        importance INTEGER NOT NULL,
        last_retrieved_tick INTEGER
      ) STRICT;
    `,
    ).run();
  })();

  return db;
};
