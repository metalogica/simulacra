/**
 * Contract for `src/llm.ts` — the LLM port and its deterministic mock.
 *
 * ```ts
 * export interface LlmClient {
 *   complete(input: { purpose: string; prompt: string }): Promise<string>;
 * }
 *
 * export interface MockLlm extends LlmClient {
 *   // Every complete() invocation, in call order, chaos calls included.
 *   calls(): ReadonlyArray<{ purpose: string; prompt: string }>;
 * }
 *
 * export const createMockLLM: (input: {
 *   // Canned model output keyed by purpose. A string is returned on every
 *   // call; an array is served one element per call, sticking on the last.
 *   responses: Record<string, string | string[]>;
 *   chaosRate?: number; // default 0 — probability a call returns non-JSON garbage
 *   seed?: number;      // default 1 — seeds the PRNG; same seed ⇒ same run
 * }) => MockLlm;
 * ```
 *
 * Rules:
 * - Unknown purpose rejects — a misconfigured test should be loud.
 * - Chaos draws once per complete() call from a seeded PRNG (mulberry32 or
 *   similar). Math.random is banned: chaos runs must be reproducible.
 * - Garbage output must not be valid JSON (JSON.parse must throw on it).
 */

import { describe, expect, it } from "vitest";
import { createMockLLM } from "../src/llm.ts";

const VALID_JSON = '{"mood":"curious","score":7}';

describe("canned responses", () => {
  it("returns the canned string for a known purpose", async () => {
    const mock = createMockLLM({ responses: { greet: VALID_JSON } });
    await expect(
      mock.complete({ purpose: "greet", prompt: "say hi" }),
    ).resolves.toBe(VALID_JSON);
  });

  it("returns the same string on every call", async () => {
    const mock = createMockLLM({ responses: { greet: VALID_JSON } });
    const first = await mock.complete({ purpose: "greet", prompt: "a" });
    const second = await mock.complete({ purpose: "greet", prompt: "b" });
    expect(second).toBe(first);
  });

  it("serves an array response one element per call, in order", async () => {
    const mock = createMockLLM({
      responses: { greet: ["first", "second", "third"] },
    });
    expect(await mock.complete({ purpose: "greet", prompt: "p" })).toBe(
      "first",
    );
    expect(await mock.complete({ purpose: "greet", prompt: "p" })).toBe(
      "second",
    );
    expect(await mock.complete({ purpose: "greet", prompt: "p" })).toBe(
      "third",
    );
  });

  it("sticks on the last element once an array is exhausted", async () => {
    const mock = createMockLLM({ responses: { greet: ["only"] } });
    await mock.complete({ purpose: "greet", prompt: "p" });
    expect(await mock.complete({ purpose: "greet", prompt: "p" })).toBe("only");
  });

  it("tracks array position per purpose, not globally", async () => {
    const mock = createMockLLM({
      responses: { a: ["a1", "a2"], b: ["b1", "b2"] },
    });
    await mock.complete({ purpose: "a", prompt: "p" });
    expect(await mock.complete({ purpose: "b", prompt: "p" })).toBe("b1");
  });

  it("rejects on an unknown purpose", async () => {
    const mock = createMockLLM({ responses: {} });
    await expect(
      mock.complete({ purpose: "missing", prompt: "p" }),
    ).rejects.toThrow();
  });
});

describe("call recording", () => {
  it("records every call with purpose and prompt, in order", async () => {
    const mock = createMockLLM({
      responses: { a: VALID_JSON, b: VALID_JSON },
    });
    await mock.complete({ purpose: "a", prompt: "first prompt" });
    await mock.complete({ purpose: "b", prompt: "second prompt" });
    expect(mock.calls()).toEqual([
      { purpose: "a", prompt: "first prompt" },
      { purpose: "b", prompt: "second prompt" },
    ]);
  });

  it("records chaos calls too", async () => {
    const mock = createMockLLM({
      responses: { a: VALID_JSON },
      chaosRate: 1,
    });
    await mock.complete({ purpose: "a", prompt: "p" });
    expect(mock.calls()).toHaveLength(1);
  });
});

describe("chaos mode", () => {
  it("never corrupts output when chaosRate is 0 (the default)", async () => {
    const mock = createMockLLM({ responses: { a: VALID_JSON } });
    for (let i = 0; i < 100; i++) {
      const output = await mock.complete({ purpose: "a", prompt: "p" });
      expect(() => JSON.parse(output)).not.toThrow();
    }
  });

  it("always returns invalid JSON when chaosRate is 1", async () => {
    const mock = createMockLLM({ responses: { a: VALID_JSON }, chaosRate: 1 });
    for (let i = 0; i < 100; i++) {
      const output = await mock.complete({ purpose: "a", prompt: "p" });
      expect(() => JSON.parse(output)).toThrow();
    }
  });

  it("corrupts roughly chaosRate of calls at 0.2", async () => {
    const mock = createMockLLM({
      responses: { a: VALID_JSON },
      chaosRate: 0.2,
      seed: 42,
    });
    let garbage = 0;
    for (let i = 0; i < 1000; i++) {
      const output = await mock.complete({ purpose: "a", prompt: "p" });
      try {
        JSON.parse(output);
      } catch {
        garbage++;
      }
    }
    expect(garbage).toBeGreaterThan(100);
    expect(garbage).toBeLessThan(300);
  });

  it("is deterministic: same seed produces the same output sequence", async () => {
    const run = async (seed: number) => {
      const mock = createMockLLM({
        responses: { a: VALID_JSON },
        chaosRate: 0.5,
        seed,
      });
      const outputs: string[] = [];
      for (let i = 0; i < 200; i++) {
        outputs.push(await mock.complete({ purpose: "a", prompt: "p" }));
      }
      return outputs;
    };

    expect(await run(7)).toEqual(await run(7));
  });

  it("varies across seeds", async () => {
    const run = async (seed: number) => {
      const mock = createMockLLM({
        responses: { a: VALID_JSON },
        chaosRate: 0.5,
        seed,
      });
      const outputs: string[] = [];
      for (let i = 0; i < 200; i++) {
        outputs.push(await mock.complete({ purpose: "a", prompt: "p" }));
      }
      return outputs;
    };

    expect(await run(1)).not.toEqual(await run(2));
  });
});
