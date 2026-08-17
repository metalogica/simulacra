import { initDB } from "./db.ts";
import { initStore } from "./store.ts";

const db = initDB();
const store = initStore(db);
store.append({
  type: "reflection",
  agentId: "maria",
  tick: 1,
  content: "Klaus spends most of his mornings by himself",
  importance: 7,
  pointerSequences: [1],
});
