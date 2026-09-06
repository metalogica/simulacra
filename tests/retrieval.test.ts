/**
 * Contract for `src/retrieval.ts` — read, rank, top-k.
 * Rep 18 of M2. Depends on reps 4, 7, 9–12, 17.
 *
 * Memories are seeded through the real log (observation + embedding_computed
 * events) and projected with replay(), so this suite also proves the
 * projection path end to end.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMockEmbeddingClient,
  type MockEmbeddingClient,
} from "../src/embedding.ts";
import { replay } from "../src/projection.ts";
import { readMemories, retrieve } from "../src/retrieval.ts";
import { decodeVector } from "../src/vector-codec.ts";
import { freshDb, type Harness } from "./helpers.ts";

const DIM = 32;
// Created per test so this file reports a failure count, not a load error,
// until rep 7 (embedding.ts) is green.
let embedder: MockEmbeddingClient;

interface Seed {
  text: string;
  tick?: number;
  importance?: number;
  embed?: boolean;
}

const seed = async (harness: Harness, agentId: string, items: Seed[]): Promise<void> => {
  for (const item of items) {
    const tick = item.tick ?? 0;
    const sequence = harness.store.append({
      type: "observation",
      agentId,
      tick,
      content: item.text,
      importance: item.importance ?? 5,
    });
    if (item.embed !== false) {
      const { vector, model } = await embedder.embed({ purpose: "seed", text: item.text });
      harness.store.append({
        type: "embedding_computed",
        agentId,
        tick,
        memorySequence: sequence,
        model,
        vector,
      });
    }
  }
  replay(harness.db);
};

const query = async (text: string): Promise<Float32Array> =>
  Float32Array.from((await embedder.embed({ purpose: "query", text })).vector);

const TEXTS = [
  "Klaus is reading alone in the cafe again",
  "The espresso machine hisses like it holds a grudge",
  "Rain on the windows; nobody is leaving soon",
  "A rumor: the bookshop next door is closing this month",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let h: Harness;
beforeEach(() => {
  h = freshDb();
  embedder = createMockEmbeddingClient({ dimension: DIM });
});
afterEach(() => h?.cleanup());

describe("readMemories", () => {
  it("returns only that agent's rows, in sequence order", async () => {
    await seed(h, "maria", [{ text: TEXTS[0]! }, { text: TEXTS[1]! }]);
    await seed(h, "klaus", [{ text: TEXTS[2]! }]);
    const rows = readMemories(h.db, "maria");
    expect(rows.map((row) => row.content)).toEqual([TEXTS[0], TEXTS[1]]);
    expect(rows.every((row) => row.agent_id === "maria")).toBe(true);
  });

  it("returns rows whose embeddings decode to the seeded vectors", async () => {
    await seed(h, "maria", [{ text: TEXTS[0]! }]);
    const [row] = readMemories(h.db, "maria");
    const expected = await query(TEXTS[0]!);
    expect(Array.from(decodeVector(row!.embedding!))).toEqual(Array.from(expected));
  });

  it("returns an empty list for an unknown agent", () => {
    expect(readMemories(h.db, "nobody")).toEqual([]);
  });
});

describe("retrieve — results", () => {
  it("puts the memory matching the query first", async () => {
    await seed(h, "maria", TEXTS.map((text) => ({ text })));
    const results = retrieve(h.db, {
      agentId: "maria",
      queryEmbedding: await query(TEXTS[2]!),
      nowTick: 0,
      k: 4,
    });
    expect(results[0]!.content).toBe(TEXTS[2]);
    expect(results[0]!.relevance).toBe(1);
  });

  it("returns at most k, ordered by score descending", async () => {
    await seed(h, "maria", TEXTS.map((text) => ({ text })));
    const results = retrieve(h.db, {
      agentId: "maria",
      queryEmbedding: await query(TEXTS[0]!),
      nowTick: 0,
      k: 2,
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  it("returns fewer than k when fewer memories exist, without throwing", async () => {
    await seed(h, "maria", [{ text: TEXTS[0]! }]);
    const results = retrieve(h.db, {
      agentId: "maria",
      queryEmbedding: await query(TEXTS[0]!),
      nowTick: 0,
      k: 10,
    });
    expect(results).toHaveLength(1);
  });

  it("returns nothing for k = 0", async () => {
    await seed(h, "maria", [{ text: TEXTS[0]! }]);
    expect(
      retrieve(h.db, { agentId: "maria", queryEmbedding: await query(TEXTS[0]!), nowTick: 0, k: 0 }),
    ).toEqual([]);
  });

  it("returns nothing for an agent with no memories", async () => {
    expect(
      retrieve(h.db, { agentId: "nobody", queryEmbedding: await query(TEXTS[0]!), nowTick: 0, k: 3 }),
    ).toEqual([]);
  });

  it("is scoped to one agent", async () => {
    await seed(h, "maria", [{ text: TEXTS[0]! }, { text: TEXTS[1]! }]);
    await seed(h, "klaus", [{ text: TEXTS[2]! }, { text: TEXTS[3]! }]);
    const results = retrieve(h.db, {
      agentId: "maria",
      queryEmbedding: await query(TEXTS[2]!),
      nowTick: 0,
      k: 10,
    });
    expect(results.map((r) => r.content).sort()).toEqual([TEXTS[0], TEXTS[1]].sort());
  });

  it("carries content and the four scores", async () => {
    await seed(h, "maria", [{ text: TEXTS[0]! }]);
    const [result] = retrieve(h.db, {
      agentId: "maria",
      queryEmbedding: await query(TEXTS[0]!),
      nowTick: 0,
      k: 1,
    });
    expect(result).toEqual({
      sequence: 1,
      content: TEXTS[0],
      score: 3,
      recency: 1,
      importance: 1,
      relevance: 1,
    });
  });

  it("includes a memory that has no embedding yet", async () => {
    await seed(h, "maria", [{ text: TEXTS[0]! }, { text: TEXTS[1]!, embed: false }]);
    const results = retrieve(h.db, {
      agentId: "maria",
      queryEmbedding: await query(TEXTS[0]!),
      nowTick: 0,
      k: 10,
    });
    expect(results.map((r) => r.content)).toEqual([TEXTS[0], TEXTS[1]]);
  });

  it("lets an important old memory beat a trivial recent one (acceptance test 2, end to end)", async () => {
    // No embeddings: relevance is equal for all three, so only recency and
    // importance decide, exactly as in the pure fixture in rank.test.ts.
    await seed(h, "maria", [
      { text: "ancient trivia", tick: 0, importance: 1, embed: false },
      { text: "the day Klaus finally spoke to me", tick: 1440, importance: 10, embed: false },
      { text: "bought a sandwich", tick: 2879, importance: 2, embed: false },
    ]);
    const results = retrieve(h.db, {
      agentId: "maria",
      queryEmbedding: await query("something unrelated to all three"),
      nowTick: 2880,
      k: 1,
    });
    expect(results[0]!.content).toBe("the day Klaus finally spoke to me");
  });
});

describe("retrieve — purity", () => {
  it("never writes to the log or the projection", async () => {
    await seed(h, "maria", TEXTS.map((text) => ({ text })));
    const eventsBefore = h.count();
    const rowsBefore = h.memories();
    retrieve(h.db, { agentId: "maria", queryEmbedding: await query(TEXTS[0]!), nowTick: 5, k: 3 });
    expect(h.count()).toBe(eventsBefore);
    expect(h.memories()).toEqual(rowsBefore);
  });

  it("reads the tick argument, not the wall clock", async () => {
    await seed(h, "maria", TEXTS.map((text, i) => ({ text, tick: i * 30 })));
    const params = { agentId: "maria", queryEmbedding: await query(TEXTS[1]!), nowTick: 200, k: 4 };
    const first = retrieve(h.db, params);
    await sleep(25);
    const second = retrieve(h.db, params);
    expect(second).toEqual(first);
  });
});

// ─── M2 acceptance test 1 ────────────────────────────────────────────────────
// "Retrieval returns identical results before and after a projection rebuild."
// Asserted on the FULL ORDERED array, not on set membership, and with the
// first call made BEFORE the wipe.

describe("retrieve — rebuild identity (M2 acceptance test 1)", () => {
  it("returns the identical full ordered ranking after a wipe and replay", async () => {
    await seed(h, "maria", TEXTS.map((text, i) => ({ text, tick: i * 45, importance: (i * 3) % 10 + 1 })));
    const params = { agentId: "maria", queryEmbedding: await query(TEXTS[3]!), nowTick: 300, k: 4 };
    const before = retrieve(h.db, params);
    expect(before).toHaveLength(4);

    h.db.prepare("DELETE FROM projection_memories").run();
    replay(h.db);

    expect(retrieve(h.db, params)).toEqual(before);
  });

  it("survives a single-agent rebuild without perturbing another agent's ranking", async () => {
    await seed(h, "maria", TEXTS.slice(0, 2).map((text, i) => ({ text, tick: i * 10 })));
    await seed(h, "klaus", TEXTS.slice(2).map((text, i) => ({ text, tick: i * 10 })));
    const params = { agentId: "klaus", queryEmbedding: await query(TEXTS[3]!), nowTick: 100, k: 2 };
    const before = retrieve(h.db, params);

    replay(h.db, { agentId: "maria" });

    expect(retrieve(h.db, params)).toEqual(before);
  });
});
