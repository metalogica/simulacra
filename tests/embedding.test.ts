/**
 * Contract for `src/embedding.ts` — the embedding port and its mock.
 * Rep 7 of M2. Depends on reps 1–3 (prng, hash, vector).
 *
 * The maths here is done inline on purpose: this file must not depend on
 * `src/vector.ts` being right to tell you whether the mock is right.
 */
import { describe, expect, it } from "vitest";
import {
  MOCK_EMBEDDING_MODEL,
  createMockEmbeddingClient,
} from "../src/embedding.ts";

const DIM = 256;

const dotOf = (a: number[], b: number[]): number =>
  a.reduce((sum, x, i) => sum + x * b[i]!, 0);
const normOf = (a: number[]): number => Math.sqrt(dotOf(a, a));

const TEXTS = [
  "Klaus is reading alone in the cafe",
  "The espresso machine hisses like it holds a grudge",
  "Rain on the windows; nobody is leaving soon",
  "A rumor: the bookshop next door is closing this month",
  "Maria walked past the window",
];

describe("createMockEmbeddingClient — determinism", () => {
  it("returns the same vector for the same text on the same client", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const a = await client.embed({ purpose: "p", text: TEXTS[0]! });
    const b = await client.embed({ purpose: "p", text: TEXTS[0]! });
    expect(a.vector).toEqual(b.vector);
  });

  it("returns the same vector across client instances — a stand-in for processes", async () => {
    const a = await createMockEmbeddingClient({ dimension: DIM }).embed({
      purpose: "p",
      text: TEXTS[0]!,
    });
    const b = await createMockEmbeddingClient({ dimension: DIM }).embed({
      purpose: "p",
      text: TEXTS[0]!,
    });
    expect(a.vector).toEqual(b.vector);
  });

  it("ignores purpose: only the text determines the vector", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const a = await client.embed({ purpose: "one", text: TEXTS[0]! });
    const b = await client.embed({ purpose: "two", text: TEXTS[0]! });
    expect(a.vector).toEqual(b.vector);
  });

  it("returns different vectors for different text", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const a = await client.embed({ purpose: "p", text: TEXTS[0]! });
    const b = await client.embed({ purpose: "p", text: TEXTS[1]! });
    expect(a.vector).not.toEqual(b.vector);
  });
});

describe("createMockEmbeddingClient — geometry", () => {
  it("has exactly `dimension` elements", async () => {
    const client = createMockEmbeddingClient({ dimension: 64 });
    const { vector } = await client.embed({ purpose: "p", text: TEXTS[0]! });
    expect(vector).toHaveLength(64);
  });

  it("has unit norm, so cosine reduces to a dot product", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const { vector } = await client.embed({ purpose: "p", text: TEXTS[0]! });
    expect(normOf(vector)).toBeCloseTo(1, 6);
  });

  it("is centred: the elements sum to roughly 0", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const { vector } = await client.embed({ purpose: "p", text: TEXTS[0]! });
    const sum = vector.reduce((acc, x) => acc + x, 0);
    expect(sum).toBeCloseTo(0, 5);
  });

  it("scores identical text as cosine 1", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const a = await client.embed({ purpose: "p", text: TEXTS[2]! });
    const b = await client.embed({ purpose: "p", text: TEXTS[2]! });
    expect(dotOf(a.vector, b.vector)).toBeCloseTo(1, 6);
  });

  it("scores unrelated text as near-orthogonal — the point of centring", async () => {
    // Uncentred uniform draws all sit in the positive orthant and score
    // ~0.72 against each other, which would let every relevance assertion in
    // the retrieval suite pass vacuously. Centred, |cos| stays near
    // 1/sqrt(dimension); the measured maximum over these pairs is 0.107.
    const client = createMockEmbeddingClient({ dimension: DIM });
    const vectors = await Promise.all(
      TEXTS.map((text) => client.embed({ purpose: "p", text })),
    );
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        expect(
          Math.abs(dotOf(vectors[i]!.vector, vectors[j]!.vector)),
        ).toBeLessThan(0.25);
      }
    }
  });

  it("contains only finite numbers", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const { vector } = await client.embed({ purpose: "p", text: TEXTS[3]! });
    expect(vector.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("createMockEmbeddingClient — port shape", () => {
  it("reports the mock model name", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    const { model } = await client.embed({ purpose: "p", text: TEXTS[0]! });
    expect(model).toBe(MOCK_EMBEDDING_MODEL);
    expect(model.length).toBeGreaterThan(0);
  });

  it("resolves asynchronously, like the real port", () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    expect(client.embed({ purpose: "p", text: TEXTS[0]! })).toBeInstanceOf(
      Promise,
    );
  });

  it("records every call in order", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    await client.embed({ purpose: "a", text: "first" });
    await client.embed({ purpose: "b", text: "second" });
    expect(client.calls()).toEqual([
      { purpose: "a", text: "first" },
      { purpose: "b", text: "second" },
    ]);
  });

  it("returns a copy from calls(), not the live array", async () => {
    const client = createMockEmbeddingClient({ dimension: DIM });
    await client.embed({ purpose: "a", text: "first" });
    const snapshot = client.calls();
    await client.embed({ purpose: "b", text: "second" });
    expect(snapshot).toHaveLength(1);
  });

  it("rejects a dimension below 2", () => {
    expect(() => createMockEmbeddingClient({ dimension: 1 })).toThrow();
    expect(() => createMockEmbeddingClient({ dimension: 0 })).toThrow();
  });
});
