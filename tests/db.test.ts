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
