import { initStore } from "./store.ts";
import { initDB, DEFAULT_DB_PATH } from "./db.ts";
import { stderr, exit } from "node:process";
import fs from "node:fs";

const POLL_MS = 400;
const PALETTE = [36, 35, 33, 32, 34, 31] as const;
const RESET = "\x1b[0m";

const colorFor = (agentId: string) => {
  const hash = Array.from(agentId).reduce(
    (sum, character) => (sum += character.charCodeAt(0)),
    0,
  );

  return PALETTE[hash % PALETTE.length];
};

const paint = (input: { code: string; text: string }): string =>
  "\x1b[" + input.code + "m" + input.text + RESET;

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
