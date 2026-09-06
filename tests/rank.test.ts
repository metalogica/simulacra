/**
 * Contract for `src/rank.ts` — the retrieval formula, pure.
 * Rep 17 of M2. Depends on reps 3, 5, 6 (vector, minmax, recency).
 *
 * Every fixture is in-memory. If a test here fails, the database is not the
 * reason.
 */
import { describe, expect, it } from "vitest";
import { rankMemories, type MemoryCandidate, type RankParams } from "../src/rank.ts";

const f = (...xs: number[]): Float32Array => Float32Array.from(xs);

const PARAMS: RankParams = {
  queryEmbedding: f(1, 0),
  nowTick: 0,
  ticksPerHour: 60,
  decay: 0.995,
};

const candidate = (over: Partial<MemoryCandidate> = {}): MemoryCandidate => ({
  sequence: 1,
  tick: 0,
  importance: 5,
  embedding: null,
  ...over,
});

const order = (scored: { sequence: number }[]): number[] =>
  scored.map((s) => s.sequence);

describe("rankMemories — shape", () => {
  it("maps the empty set to the empty set", () => {
    expect(rankMemories([], PARAMS)).toEqual([]);
  });

  it("gives a lone candidate the maximum on every component", () => {
    const [only] = rankMemories([candidate()], PARAMS);
    expect(only).toEqual({
      sequence: 1,
      score: 3,
      recency: 1,
      importance: 1,
      relevance: 1,
    });
  });

  it("returns every candidate — truncation is the caller's job", () => {
    const candidates = [1, 2, 3, 4, 5].map((sequence) => candidate({ sequence }));
    expect(rankMemories(candidates, PARAMS)).toHaveLength(5);
  });

  it("keeps every component inside [0, 1]", () => {
    const candidates = [
      candidate({ sequence: 1, tick: 0, importance: 1, embedding: f(1, 0) }),
      candidate({ sequence: 2, tick: 50, importance: 10, embedding: f(0, 1) }),
      candidate({ sequence: 3, tick: 100, importance: 4, embedding: f(-1, 0) }),
    ];
    for (const scored of rankMemories(candidates, { ...PARAMS, nowTick: 100 })) {
      for (const component of [scored.recency, scored.importance, scored.relevance]) {
        expect(component).toBeGreaterThanOrEqual(0);
        expect(component).toBeLessThanOrEqual(1);
      }
      expect(scored.score).toBeCloseTo(
        scored.recency + scored.importance + scored.relevance,
        12,
      );
    }
  });

  it("does not mutate its inputs", () => {
    const candidates = [candidate({ sequence: 2 }), candidate({ sequence: 1 })];
    const snapshot = JSON.stringify(candidates);
    rankMemories(candidates, PARAMS);
    expect(JSON.stringify(candidates)).toBe(snapshot);
  });
});

describe("rankMemories — ordering", () => {
  it("sorts by score, highest first", () => {
    const candidates = [
      candidate({ sequence: 1, importance: 1 }),
      candidate({ sequence: 2, importance: 10 }),
      candidate({ sequence: 3, importance: 5 }),
    ];
    expect(order(rankMemories(candidates, PARAMS))).toEqual([2, 3, 1]);
  });

  it("breaks ties by sequence, lowest first, so order is stable", () => {
    const candidates = [candidate({ sequence: 9 }), candidate({ sequence: 4 }), candidate({ sequence: 7 })];
    expect(order(rankMemories(candidates, PARAMS))).toEqual([4, 7, 9]);
  });

  it("is deterministic across calls", () => {
    const candidates = [
      candidate({ sequence: 1, tick: 0, importance: 3, embedding: f(1, 1) }),
      candidate({ sequence: 2, tick: 10, importance: 8, embedding: f(1, -1) }),
      candidate({ sequence: 3, tick: 20, importance: 8, embedding: f(1, 0) }),
    ];
    const params = { ...PARAMS, nowTick: 30 };
    expect(rankMemories(candidates, params)).toEqual(rankMemories(candidates, params));
  });
});

describe("rankMemories — components", () => {
  it("recency: the newer of two otherwise-equal memories ranks first", () => {
    const candidates = [
      candidate({ sequence: 1, tick: 0 }),
      candidate({ sequence: 2, tick: 60 }),
    ];
    const ranked = rankMemories(candidates, { ...PARAMS, nowTick: 120 });
    expect(order(ranked)).toEqual([2, 1]);
    expect(ranked[0]!.recency).toBe(1);
    expect(ranked[1]!.recency).toBe(0);
  });

  it("importance: the more important of two otherwise-equal memories ranks first", () => {
    const candidates = [
      candidate({ sequence: 1, importance: 1 }),
      candidate({ sequence: 2, importance: 10 }),
    ];
    const ranked = rankMemories(candidates, PARAMS);
    expect(order(ranked)).toEqual([2, 1]);
    expect(ranked[0]!.importance).toBe(1);
    expect(ranked[1]!.importance).toBe(0);
  });

  it("relevance: the memory aligned with the query ranks first", () => {
    const candidates = [
      candidate({ sequence: 1, embedding: f(0, 1) }),
      candidate({ sequence: 2, embedding: f(1, 0) }),
    ];
    const ranked = rankMemories(candidates, PARAMS);
    expect(order(ranked)).toEqual([2, 1]);
    expect(ranked[0]!.relevance).toBe(1);
    expect(ranked[1]!.relevance).toBe(0);
  });

  it("relevance: a memory with no embedding scores as cosine 0 before normalising", () => {
    const candidates = [
      candidate({ sequence: 1, embedding: null }),
      candidate({ sequence: 2, embedding: f(1, 0) }),
      candidate({ sequence: 3, embedding: f(-1, 0) }),
    ];
    // Raw relevance: 0, 1, -1 → normalised: 0.5, 1, 0.
    const bySequence = new Map(rankMemories(candidates, PARAMS).map((s) => [s.sequence, s]));
    expect(bySequence.get(1)!.relevance).toBeCloseTo(0.5, 12);
    expect(bySequence.get(2)!.relevance).toBe(1);
    expect(bySequence.get(3)!.relevance).toBe(0);
  });

  it("normalises within the candidate set, not against a fixed range", () => {
    // Importance 4 and 6 span the whole [0, 1] when they are the only two.
    const candidates = [
      candidate({ sequence: 1, importance: 4 }),
      candidate({ sequence: 2, importance: 6 }),
    ];
    const ranked = rankMemories(candidates, PARAMS);
    expect(ranked.find((s) => s.sequence === 2)!.importance).toBe(1);
    expect(ranked.find((s) => s.sequence === 1)!.importance).toBe(0);
  });
});

// ─── M2 acceptance test 2 ────────────────────────────────────────────────────
// "A high-importance old memory can beat a low-importance recent one."
//
// This is subtler than it sounds. With two candidates, min-max makes them
// mirror images (one wins recency 1:0, the other wins importance 1:0) and
// the scores tie. A third, even older and even less important memory is
// needed so that neither "old" nor "recent" sits at BOTH extremes.
//
//   nowTick = 2880 (two game days at 60 ticks/hour)
//   ancient  seq 1, tick    0, importance  1   recency 0.995^48 = 0.7862
//   old      seq 2, tick 1440, importance 10   recency 0.995^24 = 0.8867
//   recent   seq 3, tick 2879, importance  2   recency 0.995^(1/60) = 0.99992
//
//   normalised recency    0        0.4701   1
//   normalised importance 0        1        0.1111
//   relevance (no embeddings, all equal → 1)
//   score                 1.0000   2.4701   2.1111

describe("rankMemories — M2 acceptance test 2", () => {
  const candidates: MemoryCandidate[] = [
    candidate({ sequence: 1, tick: 0, importance: 1 }),
    candidate({ sequence: 2, tick: 1440, importance: 10 }),
    candidate({ sequence: 3, tick: 2879, importance: 2 }),
  ];
  const params: RankParams = { ...PARAMS, nowTick: 2880 };

  it("ranks the important old memory above the trivial recent one", () => {
    expect(order(rankMemories(candidates, params))).toEqual([2, 3, 1]);
  });

  it("produces the scores derived above", () => {
    const [old, recent, ancient] = rankMemories(candidates, params);
    expect(old!.score).toBeCloseTo(2.4701446304653945, 10);
    expect(recent!.score).toBeCloseTo(2.111111111111111, 10);
    expect(ancient!.score).toBeCloseTo(1, 10);
  });
});

describe("rankMemories — errors", () => {
  it("throws when a candidate's embedding has a different dimension from the query", () => {
    const candidates = [candidate({ sequence: 1, embedding: f(1, 0, 0) })];
    expect(() => rankMemories(candidates, PARAMS)).toThrow();
  });
});
