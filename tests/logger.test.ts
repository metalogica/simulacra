import { describe, expect, it } from "vitest";
import { colorFor, formatEvent } from "../src/logger.ts";
import type { StoredEvent } from "../src/events.ts";

/**
 * Only the PURE parts of the logger are tested here.
 *
 * @remarks
 * The poll loop owns a timer, a database handle and stdout — testing it would
 * mean faking all three to assert almost nothing. Formatting is where the bugs
 * actually live (misaligned columns, a missing union branch), and it is pure.
 *
 * This split is the reason `formatEvent` and `colorFor` must be exported: not
 * because anything else imports them, but because a function you cannot call
 * in isolation is a function you cannot check.
 */

const stripAnsi = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/\x1b\[[0-9;]*m/g, "");

const OBSERVATION: StoredEvent = {
  type: "observation",
  agentId: "maria",
  tick: 7,
  content: "Klaus is reading alone in the cafe",
  importance: 4,
  sequence: 42,
  createdAt: 1_786_914_071_448,
};

const REFLECTION: StoredEvent = {
  type: "reflection",
  agentId: "klaus",
  tick: 12,
  content: "Maria keeps appearing wherever I am",
  importance: 8,
  pointerSequences: [3, 11, 27],
  sequence: 43,
  createdAt: 1_786_914_071_500,
};

describe("colorFor", () => {
  it("is deterministic for the same agent", () => {
    expect(colorFor("maria")).toBe(colorFor("maria"));
  });

  it("always returns a usable ANSI code, never undefined", () => {
    // noUncheckedIndexedAccess makes PALETTE[i] possibly-undefined. An agent
    // whose name hashes past the palette must still get a colour.
    for (const agent of [
      "maria",
      "klaus",
      "m",
      "",
      "a b c d",
      "2423434",
      "zzzzzzzzzzzzzzzz",
      "!z.,;.zzp[l339",
    ]) {
      expect(typeof colorFor(agent)).toBe("number");
    }
  });
});

describe("formatEvent", () => {
  it("includes sequence, tick, agent and type", () => {
    const line = stripAnsi(formatEvent(OBSERVATION));
    expect(line).toContain("42");
    expect(line).toContain("7");
    expect(line).toContain("maria");
    expect(line).toContain("observation");
  });

  it("shows an observation's content", () => {
    expect(stripAnsi(formatEvent(OBSERVATION))).toContain(
      "Klaus is reading alone in the cafe",
    );
  });

  it("shows a reflection's evidence pointers", () => {
    // The third consumer of the discriminated union. `satisfies never` in the
    // default branch is what will break this file's build in M1 when
    // llm_call_completed is added.
    const line = stripAnsi(formatEvent(REFLECTION));
    expect(line).toContain("Maria keeps appearing wherever I am");
    expect(line).toMatch(/3.*11.*27/);
  });

  it("colours the line and resets afterwards", () => {
    const line = formatEvent(OBSERVATION);
    // ANCHORED on purpose. An unanchored /\x1b\[\d+m/ is satisfied by the
    // trailing reset code, so a malformed *opening* escape (missing the "m"
    // after the colour number) slips through. Assert the line STARTS with a
    // well-formed SGR sequence.
    expect(line).toMatch(/^\x1b\[\d+m/);
    expect(line.endsWith("\x1b[0m")).toBe(true);
  });

  it("emits no stray escape characters in the body", () => {
    // stripAnsi only removes well-formed sequences. Any ESC left over after
    // stripping means one of them was malformed.
    expect(stripAnsi(formatEvent(OBSERVATION))).not.toContain("\x1b");
  });

  it("gives different agents different colours", () => {
    expect(colorFor("maria")).not.toBe(colorFor("klaus"));
  });

  it("aligns columns so the log stays scannable", () => {
    // A misaligned log is a log you stop reading — and this one is going on
    // screen during the kill-and-resume demo.
    const short = stripAnsi(formatEvent(OBSERVATION));
    const long = stripAnsi(formatEvent({ ...REFLECTION, sequence: 9 }));
    expect(short.indexOf("maria")).toBe(long.indexOf("klaus"));
  });

  it("returns a single line", () => {
    expect(formatEvent(OBSERVATION)).not.toContain("\n");
  });
});

// ─── M1: journal events ──────────────────────────────────────────────────────

const LLM_COMPLETED: StoredEvent = {
  type: "llm_call_completed",
  agentId: "maria",
  tick: 2,
  purpose: "score_importance",
  prompt: "Rate the importance of this observation from 1 to 10.",
  result: { score: 7 },
  attempts: 1,
  sequence: 44,
  createdAt: 1_786_914_071_600,
};

const LLM_FAILED: StoredEvent = {
  type: "llm_call_failed",
  agentId: "maria",
  tick: 3,
  purpose: "score_importance",
  prompt: "Rate the importance of this observation from 1 to 10.",
  errors: ["Unexpected token 'n'", "Unexpected token 'n'", "Unexpected token 'n'"],
  attempts: 3,
  sequence: 45,
  createdAt: 1_786_914_071_700,
};

describe("formatEvent — journal events (M1)", () => {
  it("renders an llm_call_completed with its purpose", () => {
    const line = stripAnsi(formatEvent(LLM_COMPLETED));
    expect(line).toContain("llm_call_completed");
    expect(line).toContain("score_importance");
  });

  it("renders an llm_call_failed with its purpose", () => {
    const line = stripAnsi(formatEvent(LLM_FAILED));
    expect(line).toContain("llm_call_failed");
    expect(line).toContain("score_importance");
  });

  it("keeps journal lines to a single line", () => {
    // Multi-line errors or pretty-printed results would wreck the tail view.
    expect(formatEvent(LLM_COMPLETED)).not.toContain("\n");
    expect(formatEvent(LLM_FAILED)).not.toContain("\n");
  });
});

// ─── M2: embedding events, and journal lines a human can read ────────────────

const EMBEDDING_STORED: StoredEvent = {
  type: "embedding_computed",
  agentId: "maria",
  tick: 0,
  memorySequence: 12345,
  model: "mock",
  vector: [0.6, 0.8],
  sequence: 46,
  createdAt: 1_786_914_071_800,
};

describe("formatEvent — embedding events (M2)", () => {
  it("renders an embedding_computed with its model and target memory", () => {
    const line = stripAnsi(formatEvent(EMBEDDING_STORED));
    expect(line).toContain("embedding_computed");
    expect(line).toContain("mock");
    expect(line).toContain("12345");
  });

  it("does not dump the vector — hundreds of floats would drown the tail", () => {
    const line = stripAnsi(formatEvent(EMBEDDING_STORED));
    expect(line).not.toMatch(/0\.6/);
    expect(line).not.toContain("\n");
  });
});

describe("formatEvent — journal lines are readable (M1 gap, closed in M2)", () => {
  it("separates attempts, prompt, purpose and result", () => {
    // Today the fields are glued together:
    //   1Rate the importance of this observation from 1 to 10.score_importance{"score":7}
    // A digit running straight into a letter, or the purpose running into
    // the result, means two fields have no separator between them.
    for (const event of [LLM_COMPLETED, LLM_FAILED]) {
      const line = stripAnsi(formatEvent(event));
      expect(line).not.toMatch(/\d[A-Za-z]/);
      expect(line).not.toMatch(/score_importance[{[]/);
    }
  });
});
