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
    expect(line).toMatch(/\x1b\[\d+m/);
    expect(line.endsWith("\x1b[0m")).toBe(true);
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
