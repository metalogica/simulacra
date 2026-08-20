/**
 * Demo driver — the kill-and-resume drill.
 *
 * @module
 * One journaled LLM call per tick, each deriving an observation into the log.
 * Run it, `kill -9` it mid-run, run it again: every completed tick replays
 * from the journal (no model call, no new rows), then the run continues from
 * the first tick that never committed.
 *
 *   node src/main.ts --ticks 50            # clean run
 *   node src/main.ts --ticks 50 --chaos    # model returns garbage 50% of the time
 *   pnpm db:drop                           # reset the world
 */

import { parseArgs } from "node:util";
import { z } from "zod";
import { initDB } from "./db.ts";
import { initStore } from "./store.ts";
import { createActivity } from "./activity.ts";
import { createMockLLM } from "./llm.ts";

const AGENT_ID = "maria";
const PURPOSE = "observe_world";
const TICK_PACING_MS = 200;

const THOUGHTS = [
  '{"thought":"Klaus is reading alone in the cafe again"}',
  '{"thought":"The espresso machine hisses like it holds a grudge"}',
  '{"thought":"Rain on the windows; nobody is leaving soon"}',
  '{"thought":"Klaus glanced up when the door opened. Waiting for someone?"}',
  '{"thought":"The barista knows every regular by their order, not their name"}',
  '{"thought":"A rumor: the bookshop next door is closing this month"}',
];

const thoughtSchema = z.strictObject({ thought: z.string().min(1) });

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const { values } = parseArgs({
  options: {
    ticks: { type: "string", default: "20" },
    chaos: { type: "boolean", default: false },
    seed: { type: "string", default: "1" },
  },
});

const ticks = Number(values.ticks);
const seed = Number(values.seed);
if (!Number.isInteger(ticks) || ticks < 1) {
  throw new Error(`main: --ticks must be a positive integer, got ${values.ticks}`);
}

const db = initDB();
const store = initStore(db);
const llm = createMockLLM({
  responses: { [PURPOSE]: THOUGHTS },
  chaosRate: values.chaos ? 0.5 : 0,
  seed,
});
const activity = createActivity({ store, llm });

console.log(
  `simulacra: ${ticks} ticks, agent=${AGENT_ID}, chaos=${values.chaos ? "0.5" : "off"}, pid=${process.pid}`,
);
console.log(`kill me any time:  kill -9 ${process.pid}\n`);

let called = 0;
let replayed = 0;
let halted = 0;

for (let tick = 0; tick < ticks; tick++) {
  const result = await activity.llm({
    agentId: AGENT_ID,
    tick,
    purpose: PURPOSE,
    prompt: `It is tick ${tick}. What does ${AGENT_ID} notice?`,
    schema: thoughtSchema,
    deriveEvents: (value) => [
      {
        type: "observation",
        agentId: AGENT_ID,
        tick,
        content: value.thought,
        importance: (tick % 10) + 1,
      },
    ],
  });

  if (result.replayed) {
    replayed++;
    const label = result.status === "completed" ? "receipt" : "halt receipt";
    console.log(`tick ${String(tick).padStart(3)}  ⏭  replayed from ${label} (seq ${result.sequence}) — no API call`);
    continue; // replays are free: no pacing, no model latency
  }

  if (result.status === "completed") {
    called++;
    console.log(`tick ${String(tick).padStart(3)}  ✓  model called → journaled seq ${result.sequence}: ${JSON.stringify(result.value)}`);
  } else {
    halted++;
    console.log(`tick ${String(tick).padStart(3)}  ✗  3 bad outputs → agent checkpoint-halted at seq ${result.sequence} (process still alive)`);
  }

  await sleep(TICK_PACING_MS);
}

const rows = (
  db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }
).n;
console.log(
  `\ndone: ${called} model calls, ${replayed} replayed, ${halted} halted, ${llm.calls().length} total client invocations, ${rows} rows in the log`,
);
db.close();
