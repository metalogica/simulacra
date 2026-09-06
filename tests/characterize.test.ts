/**
 * Contract for `src/characterize.ts` — importance + embedding, one journaled
 * unit. Rep 16 of M2. Depends on reps 7, 9, 11, 13, 14.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCharacterize,
  importancePrompt,
  importanceSchema,
} from "../src/characterize.ts";
import { initDB } from "../src/db.ts";
import {
  createMockEmbeddingClient,
  type EmbeddingClient,
} from "../src/embedding.ts";
import { createMockLLM } from "../src/llm.ts";
import { initStore } from "../src/store.ts";
import { freshDb, type Harness } from "./helpers.ts";

const DIM = 8;
const CONTENT = "Klaus is reading alone in the cafe again";
const PURPOSE = "characterize";
const INPUT = { agentId: "maria", tick: 0, purpose: PURPOSE, content: CONTENT };

const GARBAGE = "not json {{";
const SEVEN = '{"importance":7}';

let h: Harness;
beforeEach(() => {
  h = freshDb();
});
afterEach(() => h?.cleanup());

const make = (llmResponses: string | string[], embeddings?: EmbeddingClient) => {
  const llm = createMockLLM({ responses: { [PURPOSE]: llmResponses } });
  const embedder = createMockEmbeddingClient({ dimension: DIM });
  const characterize = createCharacterize({
    store: h.store,
    llm,
    embeddings: embeddings ?? embedder,
  });
  return { llm, embedder, characterize };
};

const ofType = <T extends ReturnType<Harness["store"]["read"]>[number]["type"]>(type: T) =>
  h.store.read().filter((e) => e.type === type);

describe("importancePrompt", () => {
  it("quotes the paper's scale", () => {
    const prompt = importancePrompt(CONTENT);
    expect(prompt).toContain("scale of 1 to 10");
    expect(prompt).toContain("purely mundane");
    expect(prompt).toContain("extremely poignant");
  });

  it("includes the memory text", () => {
    expect(importancePrompt(CONTENT)).toContain(CONTENT);
  });

  it("asks for JSON with an importance key", () => {
    expect(importancePrompt(CONTENT)).toMatch(/"importance"/);
  });
});

describe("importanceSchema", () => {
  it("accepts integers 1 through 10", () => {
    for (const importance of [1, 5, 10]) {
      expect(importanceSchema.safeParse({ importance }).success).toBe(true);
    }
  });

  it("rejects 0, 11, fractions and extra keys", () => {
    expect(importanceSchema.safeParse({ importance: 0 }).success).toBe(false);
    expect(importanceSchema.safeParse({ importance: 11 }).success).toBe(false);
    expect(importanceSchema.safeParse({ importance: 7.5 }).success).toBe(false);
    expect(importanceSchema.safeParse({ importance: 7, extra: 1 }).success).toBe(false);
  });
});

describe("createCharacterize — first execution", () => {
  it("calls the model once and the embedder once", async () => {
    const { llm, embedder, characterize } = make(SEVEN);
    await characterize(INPUT);
    expect(llm.calls()).toHaveLength(1);
    expect(embedder.calls()).toHaveLength(1);
  });

  it("sends the importance prompt for this content", async () => {
    const { llm, characterize } = make(SEVEN);
    await characterize(INPUT);
    expect(llm.calls()[0]).toEqual({ purpose: PURPOSE, prompt: importancePrompt(CONTENT) });
  });

  it("embeds the content under the same purpose", async () => {
    const { embedder, characterize } = make(SEVEN);
    await characterize(INPUT);
    expect(embedder.calls()[0]).toEqual({ purpose: PURPOSE, text: CONTENT });
  });

  it("commits receipt, observation and embedding contiguously, in that order", async () => {
    const { embedder, characterize } = make(SEVEN);
    await characterize(INPUT);

    const events = h.store.read();
    expect(events.map((e) => e.type)).toEqual([
      "llm_call_completed",
      "observation",
      "embedding_computed",
    ]);
    const [receipt, observation, embedding] = events;
    expect(observation!.sequence).toBe(receipt!.sequence + 1);
    expect(embedding!.sequence).toBe(receipt!.sequence + 2);

    if (observation?.type !== "observation" || embedding?.type !== "embedding_computed") {
      throw new Error("unexpected event shapes");
    }
    expect(observation).toMatchObject({ agentId: "maria", tick: 0, content: CONTENT, importance: 7 });
    expect(embedding.memorySequence).toBe(observation.sequence);
    expect(embedding.model).toBe("mock");
    expect(embedding.vector).toEqual((await embedder.embed({ purpose: "x", text: CONTENT })).vector);
  });

  it("journals the parsed importance in the receipt", async () => {
    const { characterize } = make(SEVEN);
    await characterize(INPUT);
    const [receipt] = ofType("llm_call_completed");
    expect(receipt).toMatchObject({
      agentId: "maria",
      tick: 0,
      purpose: PURPOSE,
      result: { importance: 7 },
      attempts: 1,
    });
  });

  it("returns the receipt sequence and the importance", async () => {
    const { characterize } = make(SEVEN);
    const result = await characterize(INPUT);
    expect(result).toEqual({
      status: "completed",
      replayed: false,
      sequence: ofType("llm_call_completed")[0]!.sequence,
      importance: 7,
    });
  });
});

describe("createCharacterize — replay", () => {
  it("makes no model call and no embedding call on a journal hit", async () => {
    const { llm, embedder, characterize } = make(SEVEN);
    await characterize(INPUT);
    await characterize(INPUT);
    expect(llm.calls()).toHaveLength(1);
    expect(embedder.calls()).toHaveLength(1);
  });

  it("writes no new rows on a journal hit", async () => {
    const { characterize } = make(SEVEN);
    await characterize(INPUT);
    const before = h.count();
    await characterize(INPUT);
    expect(h.count()).toBe(before);
  });

  it("reports the hit as replayed with the original sequence and importance", async () => {
    const { characterize } = make(SEVEN);
    const first = await characterize(INPUT);
    const second = await characterize(INPUT);
    expect(second).toEqual({ ...first, replayed: true });
  });

  it("ignores different content under the same key — the key is the identity", async () => {
    const { characterize } = make(SEVEN);
    await characterize(INPUT);
    const result = await characterize({ ...INPUT, content: "something else entirely" });
    expect(result.replayed).toBe(true);
    const [observation] = ofType("observation");
    expect(observation).toMatchObject({ content: CONTENT });
  });

  it("replays a journaled failure without calling either provider", async () => {
    const { llm, embedder, characterize } = make(GARBAGE);
    await characterize(INPUT);
    const llmCalls = llm.calls().length;

    const second = await characterize(INPUT);
    expect(second.status).toBe("failed");
    expect(second.replayed).toBe(true);
    expect(llm.calls()).toHaveLength(llmCalls);
    expect(embedder.calls()).toHaveLength(0);
  });

  it("a restarted process replays from the journal with byte-identical rows", async () => {
    const before = make(SEVEN);
    const first = await before.characterize(INPUT);
    const rowsBefore = h.store.read();

    h.db.close(); // kill -9

    const db = initDB({ dbPath: h.dbPath });
    try {
      const store = initStore(db);
      const llm = createMockLLM({ responses: { [PURPOSE]: SEVEN } });
      const embedder = createMockEmbeddingClient({ dimension: DIM });
      const characterize = createCharacterize({ store, llm, embeddings: embedder });

      const second = await characterize(INPUT);
      expect(second).toEqual({ ...first, replayed: true });
      expect(llm.calls()).toHaveLength(0);
      expect(embedder.calls()).toHaveLength(0);
      expect(store.read()).toEqual(rowsBefore);
    } finally {
      db.close();
    }
  });

  it("throws loudly when the journaled result no longer matches the schema", async () => {
    h.store.append({
      type: "llm_call_completed",
      agentId: "maria",
      tick: 0,
      purpose: PURPOSE,
      prompt: "old prompt",
      result: { score: 7 }, // predates the importance schema
      attempts: 1,
    });
    const { llm, characterize } = make(SEVEN);
    await expect(characterize(INPUT)).rejects.toThrow();
    expect(llm.calls()).toHaveLength(0);
  });
});

describe("createCharacterize — importance validation", () => {
  it("retries with feedback when importance is out of range", async () => {
    const { llm, characterize } = make(['{"importance":11}', SEVEN]);
    const result = await characterize(INPUT);
    expect(result).toMatchObject({ status: "completed", importance: 7 });
    expect(llm.calls()).toHaveLength(2);
    expect(llm.calls()[1]!.prompt).toContain("importance");
    expect(ofType("llm_call_completed")[0]).toMatchObject({ attempts: 2 });
  });

  it("checkpoint-halts after three bad outputs and journals the failure", async () => {
    const { characterize } = make(GARBAGE);
    const result = await characterize(INPUT);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.errors).toHaveLength(3);
      expect(result.replayed).toBe(false);
    }
    expect(ofType("llm_call_failed")).toHaveLength(1);
    expect(ofType("llm_call_completed")).toHaveLength(0);
  });

  it("writes no observation and no embedding on failure", async () => {
    const { characterize } = make(GARBAGE);
    await characterize(INPUT);
    expect(ofType("observation")).toHaveLength(0);
    expect(ofType("embedding_computed")).toHaveLength(0);
  });

  it("does not call the embedder when importance scoring fails — score first, then embed", async () => {
    const { embedder, characterize } = make(GARBAGE);
    await characterize(INPUT);
    expect(embedder.calls()).toHaveLength(0);
  });
});

describe("createCharacterize — transport", () => {
  const broken: EmbeddingClient = {
    embed: async () => {
      throw new Error("ECONNRESET");
    },
  };

  it("propagates an embedding transport error and journals nothing — not even the receipt", async () => {
    const { characterize } = make(SEVEN, broken);
    await expect(characterize(INPUT)).rejects.toThrow("ECONNRESET");
    expect(h.count()).toBe(0);
  });

  it("calls the model AGAIN on resume after an embedding crash — at-least-once calls", async () => {
    const llm = createMockLLM({ responses: { [PURPOSE]: SEVEN } });
    const crashed = createCharacterize({ store: h.store, llm, embeddings: broken });
    await expect(crashed(INPUT)).rejects.toThrow();

    const embedder = createMockEmbeddingClient({ dimension: DIM });
    const resumed = createCharacterize({ store: h.store, llm, embeddings: embedder });
    const result = await resumed(INPUT);

    expect(result).toMatchObject({ status: "completed", replayed: false, importance: 7 });
    expect(llm.calls()).toHaveLength(2);
    expect(h.count()).toBe(3);
  });

  it("propagates a model transport error and journals nothing", async () => {
    const llm = { complete: async () => { throw new Error("ECONNRESET"); } };
    const embedder = createMockEmbeddingClient({ dimension: DIM });
    const characterize = createCharacterize({ store: h.store, llm, embeddings: embedder });
    await expect(characterize(INPUT)).rejects.toThrow("ECONNRESET");
    expect(h.count()).toBe(0);
    expect(embedder.calls()).toHaveLength(0);
  });
});

describe("createCharacterize — keying", () => {
  it("distinct purposes are distinct calls", async () => {
    const llm = createMockLLM({
      responses: { [`${PURPOSE}:0`]: SEVEN, [`${PURPOSE}:1`]: '{"importance":3}' },
    });
    const embedder = createMockEmbeddingClient({ dimension: DIM });
    const characterize = createCharacterize({ store: h.store, llm, embeddings: embedder });

    await characterize({ ...INPUT, purpose: `${PURPOSE}:0` });
    await characterize({ ...INPUT, purpose: `${PURPOSE}:1`, content: "second thought" });

    expect(llm.calls()).toHaveLength(2);
    expect(ofType("observation").map((e) => (e.type === "observation" ? e.importance : -1))).toEqual([7, 3]);
    expect(h.count()).toBe(6);
  });

  it("a different tick with the same purpose is a fresh call", async () => {
    const { llm, characterize } = make(SEVEN);
    await characterize(INPUT);
    await characterize({ ...INPUT, tick: 1 });
    expect(llm.calls()).toHaveLength(2);
    expect(ofType("observation")).toHaveLength(2);
  });
});
