import { initDB, DEFAULT_DB_PATH } from "./db.ts";
import { initStore } from "./store.ts";
import { stderr, exit } from "node:process";
import fs from "node:fs";
import { type StoredEvent } from "./events.ts";

const DEFAULT_CURSOR_VALUE = 0;
const DEFAULT_POLL_MS = 400;
const PALETTE = [36, 35, 33, 32, 34, 31] as const;

const ANSI_END = "\x1b[0m";
const ANSI_PADDING_AGENT_ID = 1;
const ANSI_PADDING_SEQUENCE = 1;
const ANSI_PADDING_TICK = 1;
const ANSI_PADDING_TYPE = 1;
const ANSI_START = "\x1b[";

export interface Logger {
  start: () => void;
  stop: () => void;
  pollOnce: () => {};
}

interface CreateLoggerInput {
  dbPath?: string;
  pollMs?: number;
}

export const colorFor = (agentId: string): number => {
  const hash = Array.from(agentId).reduce(
    (sum, character) => (sum += character.charCodeAt(0)),
    0,
  );

  const colorCode = PALETTE[hash % PALETTE.length];
  if (typeof colorCode !== "number") {
    throw new Error(`Logger: Invalid color code for agent-id: ${agentId}.`);
  }

  return colorCode;
};

export const formatEvent = (storedEvent: StoredEvent) => {
  const agentId = String(storedEvent.agentId).padStart(
    ANSI_PADDING_AGENT_ID,
    " ",
  );
  const colorCode = `${colorFor(storedEvent.agentId)}m`;
  const sequence = String(storedEvent.sequence).padStart(
    ANSI_PADDING_SEQUENCE,
    " ",
  );
  const tick = String(storedEvent.tick).padStart(ANSI_PADDING_TICK, " ");
  const type = String(storedEvent.type).padStart(ANSI_PADDING_TYPE, " ");

  let body = "";

  switch (storedEvent.type) {
    case "observation":
      body = storedEvent.content;
      break;
    case "reflection":
      body =
        storedEvent.content +
        " | Pointer Sequences: " +
        storedEvent.pointerSequences.join(", ");
      break;
    case "llm_call_completed":
      body =
        storedEvent.attempts +
        storedEvent.prompt +
        storedEvent.purpose +
        JSON.stringify(storedEvent.result);
      break;
    case "llm_call_failed":
      body =
        storedEvent.attempts +
        storedEvent.prompt +
        storedEvent.purpose +
        JSON.stringify(storedEvent.errors);
      break;
    default:
      storedEvent satisfies never;
      throw new Error(`Logger: Unhandled event ${JSON.stringify(storedEvent)}`);
  }

  return `${ANSI_START}${colorCode}[SEQUENCE: ${sequence} - TICK: ${tick} - AGENT-ID: ${agentId} - TYPE: ${type}] ${body}${ANSI_END}`;
};

export const createLogger = (input?: CreateLoggerInput) => {
  const dbPath = input?.dbPath ?? process.argv[2] ?? DEFAULT_DB_PATH;
  const pollMs = input?.pollMs ?? DEFAULT_POLL_MS;

  if (!fs.existsSync(dbPath)) {
    stderr.write("no database at " + dbPath + " — run `pnpm start` first");
    exit(1);
  }

  const db = initDB({ dbPath, readOnly: true });
  const store = initStore(db);

  let cursor: number = DEFAULT_CURSOR_VALUE;
  let timer: NodeJS.Timeout | null = null;

  const pollOnce = (): number => {
    const storeEvents = store.read({ afterSequence: cursor });

    for (const storeEvent of storeEvents) {
      process.stdout.write(formatEvent(storeEvent) + "\n");

      cursor = Math.max(cursor, storeEvent.sequence);
    }

    return storeEvents.length;
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    if (db.open) {
      db.close();
    }
  };

  const start = () => {
    if (timer) {
      return;
    }

    pollOnce();

    timer = setInterval(pollOnce, pollMs);

    const handleSignal = () => {
      stop();

      process.exit(0);
    };

    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  };

  return {
    pollOnce,
    stop,
    start,
  };
};
