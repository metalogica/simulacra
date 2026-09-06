import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replay, toMemoryEffect } from "../src/projection.ts";
import { encodeVector } from "../src/vector-codec.ts";
import {
  EMBEDDING_COMPUTED,
  freshDb,
  KLAUS_OBSERVATION,
  LLM_CALL_COMPLETED,
  LLM_CALL_FAILED,
  OBSERVATION,
  REFLECTION,
  observations,
  type Harness,
} from "./helpers.ts";

// ─── M2 contract for src/projection.ts ───────────────────────────────────────
//
// export interface MemoryRow {
//   sequence: number; agent_id: string; tick: number; content: string;
//   importance: number; embedding: Buffer | null; embedding_model: string | null;
// }
// export type MemoryEffect =
//   | { kind: "insert"; row: MemoryRow }
//   | { kind: "attach_embedding"; memorySequence: number;
//       embedding: Buffer; embeddingModel: string };
// export const toMemoryEffect: (event: StoredEvent) => MemoryEffect | null
//
// replay() folds effects in log order:
//   "insert"           → INSERT the row (embedding NULL until attached)
//   "attach_embedding" → UPDATE projection_memories SET embedding, embedding_model
//                        WHERE sequence = memorySequence; 0 rows changed → throw
//   null               → skip (journal events are not memories)
// A later attach for the same memory overrides an earlier one: last in log
// order wins, which is what makes re-indexing under a new model additive.

let h: Harness;
beforeEach(() => {
  h = freshDb();
});
afterEach(() => h?.cleanup());

describe("toMemoryEffect — the pure reducer", () => {
  it("maps an observation to an insert carrying the creation tick", () => {
    h.store.append(OBSERVATION);
    const [stored] = h.store.read();

    expect(toMemoryEffect(stored!)).toEqual({
      kind: "insert",
      row: {
        sequence: stored!.sequence,
        agent_id: OBSERVATION.agentId,
        tick: OBSERVATION.tick,
        content: OBSERVATION.content,
        importance: OBSERVATION.importance,
        embedding: null,
        embedding_model: null,
      },
    });
  });

  it("maps a reflection to an insert", () => {
    h.store.append(REFLECTION);
    const [stored] = h.store.read();
    const effect = toMemoryEffect(stored!);

    expect(effect?.kind).toBe("insert");
    if (effect?.kind === "insert") {
      expect(effect.row.tick).toBe(REFLECTION.tick);
      expect(effect.row.content).toBe(REFLECTION.content);
      expect(effect.row.embedding).toBeNull();
    }
  });

  it("maps an embedding_computed to an attach_embedding effect", () => {
    h.store.append(OBSERVATION);
    h.store.append(EMBEDDING_COMPUTED);
    const stored = h.store.read()[1]!;

    expect(toMemoryEffect(stored)).toEqual({
      kind: "attach_embedding",
      memorySequence: EMBEDDING_COMPUTED.memorySequence,
      embedding: encodeVector(EMBEDDING_COMPUTED.vector),
      embeddingModel: EMBEDDING_COMPUTED.model,
    });
  });

  it("is pure — it does not write to the database", () => {
    h.store.append(OBSERVATION);
    const [stored] = h.store.read();
    toMemoryEffect(stored!);
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

  it("copies the creation tick onto the row", () => {
    h.store.appendMany(observations(3));
    replay(h.db);
    expect(h.memories().map((row) => row.tick)).toEqual([0, 1, 2]);
  });
});

// ─── M1: journal events are not memories ─────────────────────────────────────
// The journal is replay infrastructure, not agent experience — an agent never
// "remembers" its own API calls. toMemoryEffect returns null for them and
// replay skips the nulls.

describe("journal events in the projection (M1)", () => {
  it("toMemoryEffect returns null for an llm_call_completed", () => {
    h.store.append(LLM_CALL_COMPLETED);
    const [stored] = h.store.read();
    expect(toMemoryEffect(stored!)).toBeNull();
  });

  it("toMemoryEffect returns null for an llm_call_failed", () => {
    h.store.append(LLM_CALL_FAILED);
    const [stored] = h.store.read();
    expect(toMemoryEffect(stored!)).toBeNull();
  });

  it("replay projects no rows from a journal-only log", () => {
    h.store.appendMany([LLM_CALL_COMPLETED, LLM_CALL_FAILED]);
    replay(h.db);
    expect(h.memories()).toHaveLength(0);
  });

  it("replay of a mixed log projects only the memories", () => {
    h.store.appendMany([
      OBSERVATION,
      LLM_CALL_COMPLETED,
      REFLECTION,
      LLM_CALL_FAILED,
    ]);
    replay(h.db);

    const rows = h.memories();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.content)).toEqual([
      OBSERVATION.content,
      REFLECTION.content,
    ]);
  });

  // The Projection Law survives M1: acceptance test 1 rerun over a mixed log.
  it("rebuilds byte-identically after a wipe, journal events present", () => {
    h.store.appendMany([
      OBSERVATION,
      LLM_CALL_COMPLETED,
      KLAUS_OBSERVATION,
      LLM_CALL_FAILED,
      REFLECTION,
    ]);
    replay(h.db);
    const before = h.memories();
    expect(before).toHaveLength(3);

    h.db.prepare("DELETE FROM projection_memories").run();
    replay(h.db);
    expect(h.memories()).toEqual(before);
  });
});

// ─── M2: embeddings are attached, not inserted ───────────────────────────────

describe("replay — embeddings (M2 acceptance test 3)", () => {
  it("attaches the embedding to the memory row it references", () => {
    h.store.appendMany([OBSERVATION, KLAUS_OBSERVATION, EMBEDDING_COMPUTED]);
    replay(h.db);

    const [maria, klaus] = h.memories();
    expect(maria!.sequence).toBe(EMBEDDING_COMPUTED.memorySequence);
    expect(maria!.embedding).not.toBeNull();
    expect(maria!.embedding!.equals(encodeVector(EMBEDDING_COMPUTED.vector))).toBe(true);
    expect(maria!.embedding_model).toBe(EMBEDDING_COMPUTED.model);
    expect(klaus!.embedding).toBeNull();
    expect(klaus!.embedding_model).toBeNull();
  });

  it("adds no row for the embedding event itself", () => {
    h.store.appendMany([OBSERVATION, EMBEDDING_COMPUTED]);
    replay(h.db);
    expect(h.memories()).toHaveLength(1);
  });

  it("rebuilds byte-identical embeddings after the table is wiped", () => {
    h.store.appendMany([OBSERVATION, EMBEDDING_COMPUTED, KLAUS_OBSERVATION]);
    replay(h.db);
    const before = h.memories();
    expect(before[0]!.embedding).not.toBeNull();

    h.db.prepare("DELETE FROM projection_memories").run();
    replay(h.db);
    expect(h.memories()).toEqual(before);
  });

  it("rebuilds byte-identical embeddings scoped to one agent", () => {
    h.store.appendMany([OBSERVATION, EMBEDDING_COMPUTED, KLAUS_OBSERVATION]);
    replay(h.db);
    const before = h.memories();

    replay(h.db, { agentId: "maria" });
    expect(h.memories()).toEqual(before);
  });

  it("takes the LAST embedding in log order when a memory is re-embedded", () => {
    h.store.appendMany([
      OBSERVATION,
      EMBEDDING_COMPUTED,
      { ...EMBEDDING_COMPUTED, model: "mock-v2", vector: [0, 1] },
    ]);
    replay(h.db);

    const [row] = h.memories();
    expect(row!.embedding_model).toBe("mock-v2");
    expect(row!.embedding!.equals(encodeVector([0, 1]))).toBe(true);
  });

  it("throws when an embedding references a memory that is not in the projection", () => {
    // A corrupt or hand-edited log should be loud, not silently unindexed.
    h.store.append({ ...EMBEDDING_COMPUTED, memorySequence: 99 });
    expect(() => replay(h.db)).toThrow();
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
