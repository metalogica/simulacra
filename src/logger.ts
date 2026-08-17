import { initDB, DEFAULT_DB_PATH } from "./db.ts";
import { initStore } from "./store.ts";
import { stderr, exit } from "node:process";
import fs from "node:fs";
import { storedEventSchema, type StoredEvent } from "./events.ts";

const POLL_MS = 400;
const PALETTE = [36, 35, 33, 32, 34, 31] as const;
const ANSI_START = "\x1b";
const ANSI_END = "\x1b[0m";

export const colorFor = (agentId: string) => {
  const hash = Array.from(agentId).reduce(
    (sum, character) => (sum += character.charCodeAt(0)),
    0,
  );

  return PALETTE[hash % PALETTE.length];
};

export const formatEvent = (storedEvent: StoredEvent) => {
  const event = storedEventSchema.parse(storedEvent);

  const colorCode = colorFor(event.agentId);
  const sequence = String(event.sequence).padStart(4, " ");
  const tick = String(event.tick).padStart(4, " ");
  const agentId = String(event.agentId).padStart(4, " ");
  const type = String(event.type).padStart(8, " ");

  let body = "";

  switch (event.type) {
    case "observation":
      body = event.content;
      break;
    case "reflection":
      body = event.content + " " + event.pointerSequences.join(", ");
      break;
    default:
      event satisfies never;
      throw new Error(`Logger: Unhandled event ${JSON.stringify(storedEvent)}`);
  }

  return `${ANSI_START}${colorCode}[SEQUENCE: ${sequence} - TICKET: ${tick} - AGENT-ID: ${agentId} - TYPE: ${type}] ${body}${ANSI_END}`;
};

const paint = (input: { code: string; text: string }): string =>
  ANSI_START + input.code + "m" + input.text + ANSI_END;

export const createLogger = () => {
  const dbPath = process.argv[2] ?? DEFAULT_DB_PATH;

  if (!fs.existsSync(dbPath)) {
    stderr.write("no database at " + dbPath + " — run `pnpm start` first");
    exit(1);
  }

  const db = initDB({ dbPath, readOnly: true });

  const store = initStore(db);

  let cursor: number = 0;
};
