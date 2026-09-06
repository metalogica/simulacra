/**
 * Contract for `src/validated-call.ts` — M1's retry loop, extracted.
 * Rep 14 of M2. No database.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_ATTEMPTS, callWithValidation } from "../src/validated-call.ts";
import { createMockLLM, type LlmClient } from "../src/llm.ts";

const SCHEMA = z.strictObject({ mood: z.string(), score: z.number() });
const VALID_JSON = '{"mood":"curious","score":7}';
const GARBAGE = "not json at all {{";
const WRONG_SHAPE = '{"wrong":true}';
const PROMPT = "How does maria feel right now?";

const call = (llm: LlmClient) =>
  callWithValidation({ llm, purpose: "assess_mood", prompt: PROMPT, schema: SCHEMA });

describe("callWithValidation — success", () => {
  it("caps attempts at 3", () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it("calls the model once and returns the parsed value", async () => {
    const mock = createMockLLM({ responses: { assess_mood: VALID_JSON } });
    const result = await call(mock);
    expect(result).toEqual({
      ok: true,
      value: { mood: "curious", score: 7 },
      attempts: 1,
    });
    expect(mock.calls()).toHaveLength(1);
  });

  it("passes purpose and prompt through unchanged", async () => {
    const mock = createMockLLM({ responses: { assess_mood: VALID_JSON } });
    await call(mock);
    expect(mock.calls()[0]).toEqual({ purpose: "assess_mood", prompt: PROMPT });
  });
});

describe("callWithValidation — retry with feedback", () => {
  it("retries after garbage output and succeeds", async () => {
    const mock = createMockLLM({ responses: { assess_mood: [GARBAGE, VALID_JSON] } });
    const result = await call(mock);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
    expect(mock.calls()).toHaveLength(2);
  });

  it("retries after valid-JSON-wrong-shape output too", async () => {
    const mock = createMockLLM({ responses: { assess_mood: [WRONG_SHAPE, VALID_JSON] } });
    const result = await call(mock);
    expect(result.ok).toBe(true);
    expect(mock.calls()).toHaveLength(2);
  });

  it("builds the retry prompt from the ORIGINAL prompt plus the error", async () => {
    const mock = createMockLLM({ responses: { assess_mood: [GARBAGE, VALID_JSON] } });
    await call(mock);
    const [first, second] = mock.calls();
    expect(second!.prompt.startsWith(PROMPT)).toBe(true);
    expect(second!.prompt).not.toBe(first!.prompt);
    expect(second!.prompt.length).toBeGreaterThan(PROMPT.length);
  });

  it("names the schema problem in the feedback", async () => {
    const mock = createMockLLM({ responses: { assess_mood: [WRONG_SHAPE, VALID_JSON] } });
    await call(mock);
    expect(mock.calls()[1]!.prompt).toContain("mood");
  });

  it("does not nest previous retry prompts — feedback is not cumulative", async () => {
    const mock = createMockLLM({
      responses: { assess_mood: [GARBAGE, WRONG_SHAPE, VALID_JSON] },
    });
    await call(mock);
    const [, second, third] = mock.calls();
    expect(third!.prompt.startsWith(PROMPT)).toBe(true);
    expect(third!.prompt).not.toContain(second!.prompt);
  });
});

describe("callWithValidation — halt", () => {
  it("gives up after three failures with one error per attempt", async () => {
    const mock = createMockLLM({ responses: { assess_mood: GARBAGE } });
    const result = await call(mock);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(3);
      expect(result.errors.every((e) => typeof e === "string" && e.length > 0)).toBe(true);
    }
    expect(mock.calls()).toHaveLength(3);
  });

  it("never makes a fourth attempt even when it would succeed", async () => {
    const mock = createMockLLM({
      responses: { assess_mood: [GARBAGE, GARBAGE, GARBAGE, VALID_JSON] },
    });
    const result = await call(mock);
    expect(result.ok).toBe(false);
    expect(mock.calls()).toHaveLength(3);
  });

  it("resolves rather than throws on model failure", async () => {
    const mock = createMockLLM({ responses: { assess_mood: GARBAGE } });
    await expect(call(mock)).resolves.toBeDefined();
  });
});

describe("callWithValidation — transport", () => {
  it("propagates a transport error without retrying", async () => {
    let attempts = 0;
    const broken: LlmClient = {
      complete: async () => {
        attempts++;
        throw new Error("ECONNRESET");
      },
    };
    await expect(call(broken)).rejects.toThrow("ECONNRESET");
    expect(attempts).toBe(1);
  });
});
