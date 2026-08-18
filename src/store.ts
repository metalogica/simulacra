/**
 * The write/read boundary for the event log.
 *
 * @module
 * `sequence` is assigned by SQLite's INTEGER PRIMARY KEY and must never be
 * supplied by a caller — that's why `append` takes an `AgentEvent`
 * (no sequence) and returns a `StoredEvent` shape only on read.
 *
 * This module never writes to projection tables. Projections are built
 * exclusively by `replay()`; two writers would break the Projection Law.
 */

import type BetterSqlite3 from "better-sqlite3";
import {
  agentEventSchema,
  storedEventSchema,
  type AgentEvent,
  type StoredEvent,
} from "./events.ts";

interface EventRow {
  agent_id: string;
  created_at: number;
  payload: string;
  sequence: number;
  tick: number;
  type: string;
}

interface DbReadParams {
  afterSequence: number | null;
  agentId: string | null;
  type: string | null;
  tick: number | null;
}

interface InsertParams {
  tick: number;
  agentId: string;
  type: string;
  payload: string;
  createdAt: number;
}

interface StoreReadParams {
  agentId?: string;
  afterSequence?: number;
  type?: string;
  tick?: number;
}

export interface Store {
  append: (event: AgentEvent) => number;
  appendMany: (events: AgentEvent[]) => number[];
  read: (input?: StoreReadParams) => StoredEvent[];
}

export const initStore = (db: BetterSqlite3.Database): Store => {
  const writeQuery = db.prepare<InsertParams>(/*sql*/ `
    INSERT INTO events (tick, agent_id, type, payload, created_at)
    VALUES (@tick, @agentId, @type, @payload, @createdAt)
  `);

  const readQuery = db.prepare<[DbReadParams], EventRow>(/*sql*/ `
    SELECT sequence, tick, agent_id, type, payload, created_at
    FROM events
    WHERE (
      @agentId IS NULL OR
      agent_id = @agentId
    ) AND (
      @afterSequence IS NULL OR
      sequence > @afterSequence
    ) AND (
      @type IS NULL OR
      type = @type
    ) AND (
      @tick IS NULL OR
      tick = @tick
    )
    ORDER BY sequence
  `);

  const fromRow = (row: EventRow) => {
    const {
      agent_id: agentId,
      created_at: createdAt,
      payload,
      sequence,
      tick,
      type,
    } = row;

    const result = storedEventSchema.safeParse({
      ...JSON.parse(payload),

      agentId,
      createdAt,
      sequence,
      tick,
      type,
    });

    if (!result.success) {
      throw new Error(
        `Store Error: Corrupt data with candidate row.\nSequence: ${sequence}.\nIssues: ${JSON.stringify(result.error.issues)}`,
      );
    }

    return result.data;
  };

  const toRow = (input: {
    validatedEvent: AgentEvent;
    createdAt: number;
  }): InsertParams => {
    const { agentId, tick, type, ...payload } = input.validatedEvent;
    const createdAt = input.createdAt;

    return {
      agentId: agentId,
      createdAt,
      payload: JSON.stringify(payload),
      tick,
      type,
    };
  };

  const append = (event: AgentEvent): number => {
    const validatedEvent = agentEventSchema.parse(event);

    const result = writeQuery.run(
      toRow({ validatedEvent, createdAt: Date.now() }),
    );

    const nextSequence = result.lastInsertRowid;
    if (typeof nextSequence === "bigint") {
      throw new Error("Store Error: Row ID exceeds MAX_SAFE_INTEGER");
    }

    return nextSequence;
  };

  const appendMany = (events: AgentEvent[]): number[] => {
    const transaction = db.transaction((agentEvents: AgentEvent[]) =>
      agentEvents.map(append),
    );

    const sequences = transaction(events);

    return sequences;
  };

  const read = (input?: StoreReadParams): StoredEvent[] => {
    const afterSequence = input?.afterSequence ?? null;
    const agentId = input?.agentId ?? null;
    const tick = input?.tick ?? null;
    const type = input?.type ?? null;

    const rows = readQuery.all({
      afterSequence,
      agentId,
      tick,
      type,
    });

    const formattedRows = rows.map(fromRow);

    return formattedRows;
  };

  const store = {
    append,
    appendMany,
    read,
  };

  return store;
};
