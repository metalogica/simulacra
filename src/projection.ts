/**
 * @module
 * This module writes only to projection tables, never to events.
 */

import type { StoredEvent } from "./events.ts";
import { initStore } from "./store.ts";
import type BetterSqlite3 from "better-sqlite3";

interface MemoryRow {
  sequence: number;
  agent_id: string;
  content: string;
  importance: number;
  last_retrieved_tick: number | null;
}

interface InsertParams {
  sequence: number;
  agent_id: string;
  content: string;
  importance: number;
  last_retrieved_tick: number | null;
}

interface DeleteParams {
  agent_id: string | null;
}

export const toMemoryRow = (storeEvent: StoredEvent): MemoryRow | null => {
  switch (storeEvent.type) {
    case "observation":
      return {
        agent_id: storeEvent.agentId,
        content: storeEvent.content,
        importance: storeEvent.importance,
        last_retrieved_tick: null,
        sequence: storeEvent.sequence,
      };
    case "reflection":
      return {
        agent_id: storeEvent.agentId,
        content: storeEvent.content,
        importance: storeEvent.importance,
        last_retrieved_tick: null,
        sequence: storeEvent.sequence,
      };
    case "llm_call_completed":
      return null;
    case "llm_call_failed":
      return null;
    default:
      storeEvent satisfies never;
      throw new Error(
        `Projections: Unhandled event type. Received: ${JSON.stringify(storeEvent)}`,
      );
  }
};

export const replay = (
  db: BetterSqlite3.Database,
  params: { agentId?: string } = {},
): void => {
  const agentId = params?.agentId;

  const store = initStore(db);

  const deleteQuery = db.prepare<DeleteParams>(/*sql*/ `
    DELETE FROM projection_memories
    WHERE
      @agent_id IS NULL OR
      agent_id = @agent_id
  `);

  const insertQuery = db.prepare<InsertParams>(/*sql*/ `
    INSERT INTO projection_memories (sequence, agent_id, content, importance, last_retrieved_tick)
    VALUES (@sequence, @agent_id, @content, @importance, @last_retrieved_tick)
  `);

  const transaction = db.transaction(() => {
    deleteQuery.run({ agent_id: agentId ?? null });

    const storeEvents = store.read(agentId ? { agentId } : undefined);
    for (const storeEvent of storeEvents) {
      const row = toMemoryRow(storeEvent);

      if (!row) {
        continue;
      }

      insertQuery.run(row);
    }
  });

  transaction();
};
