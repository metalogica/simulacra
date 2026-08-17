import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replay, toMemoryRow } from "../src/projection.ts";
import {
  freshDb,
  KLAUS_OBSERVATION,
  OBSERVATION,
  REFLECTION,
  observations,
  type Harness,
} from "./helpers.ts";

let h: Harness;
beforeEach(() => {
  h = freshDb();
});
afterEach(() => h?.cleanup());

describe("toMemoryRow — the pure reducer", () => {
  it("maps an observation to a projection row", () => {
    h.store.append(OBSERVATION);
    const [stored] = h.store.read();

    expect(toMemoryRow(stored!)).toEqual({
      sequence: stored!.sequence,
      agent_id: OBSERVATION.agentId,
      content: OBSERVATION.content,
      importance: OBSERVATION.importance,
      last_retrieved_tick: null,
    });
  });

  // NULL means "never retrieved". Any sentinel would be a lie: 0 reads as
  // 1970 to every recency query written in M2.
  it("leaves last_retrieved_tick null for a fresh memory", () => {
    h.store.append(REFLECTION);
    const [stored] = h.store.read();
    expect(toMemoryRow(stored!).last_retrieved_tick).toBeNull();
  });

  it("is pure — it does not write to the database", () => {
    h.store.append(OBSERVATION);
    const [stored] = h.store.read();
    toMemoryRow(stored!);
    expect(h.memories()).toHaveLength(0);
  });
});

describe("replay", () => {
  it("populates the projection from the log", () => {
    h.store.appendMany([OBSERVATION, KLAUS_OBSERVATION, REFLECTION]);
    replay(h.db);
    expect(h.memories()).toHaveLength(3);
  });

  // ── M0 acceptance test 1 ────────────────────────────────────────────────
  // The Projection Law: anything in a projection must be fully re-derivable by
  // replay(). If deleting the projection loses information, the design is
  // broken. This is the single test the architecture rests on.
  it("rebuilds a byte-identical projection after the table is wiped", () => {
    h.store.appendMany(observations(10));
    replay(h.db);

    const before = h.memories();
    expect(before).toHaveLength(10);

    h.db.prepare("DELETE FROM projection_memories").run();
    expect(h.memories()).toHaveLength(0);

    replay(h.db);
    expect(h.memories()).toEqual(before);
  });

  it("is idempotent — replaying twice does not duplicate rows", () => {
    h.store.appendMany([OBSERVATION, KLAUS_OBSERVATION, REFLECTION]);
    replay(h.db);
    replay(h.db);
    expect(h.memories()).toHaveLength(3);
  });

  it("never writes to the log", () => {
    h.store.appendMany([OBSERVATION, KLAUS_OBSERVATION]);
    const before = h.count();
    replay(h.db);
    replay(h.db);
    expect(h.count()).toBe(before);
  });
});

describe("replay scoped to one agent", () => {
  beforeEach(() => {
    h.store.appendMany([OBSERVATION, KLAUS_OBSERVATION, REFLECTION]);
    replay(h.db);
  });

  it("does not wipe other agents' rows", () => {
    replay(h.db, { agentId: "maria" });
    const klaus = h.memories().filter((row) => row.agent_id === "klaus");
    expect(klaus).toHaveLength(1);
  });

  it("still rebuilds the target agent's rows", () => {
    replay(h.db, { agentId: "maria" });
    const maria = h.memories().filter((row) => row.agent_id === "maria");
    expect(maria).toHaveLength(2);
  });

  it("leaves the total unchanged", () => {
    replay(h.db, { agentId: "maria" });
    expect(h.memories()).toHaveLength(3);
  });
});
