# Simulacra

A crash-safe generative agent runtime built from first principles.

> [Park et al. (2023)](https://arxiv.org/pdf/2304.03442) specified the architecture of believable agents — memory stream, reflection, planning — but their agents lived in process memory and died with the process. This project is a first-principles implementation of their system built as a durable execution runtime that survives kill -9 mid-thought, never re-runs a side effect, and never loses a memory.

## 1. Scope
* Custom Durability Layer
  * Simplicity: One process, one SQLite file, 3–5 agents, zero frameworks.
  * Independence between agents comes from log partitioning, not process isolation.
  * Append-only event log as the single source of truth
  * Rebuildable projections (memory index, current plan, relationships)
  * Journaled LLM calls → idempotent replay (the Temporal workflow/activity split, in miniature)
* The paper's cognitive loop: perceive → retrieve → plan → act → reflect
  * Believability on top (Park et al.), durability underneath (event sourcing + journaled effects).
  * Retrieval scoring: recency decay × importance × relevance
  * Multi-agent ticks with dialogue between agents
  * Chaos testing (crash drills) + the paper's five-category believability interview
* Out of scope
  ❌ No Phaser / rendering — terminal output only
  ❌ No LangGraph or agent frameworks — the minimal loop IS the thesis
  ❌ No separate processes / Docker per agent — ops cosplay
  ❌ No vendor observability — the event log IS the trace
  ❌ No 25 agents — emergence needs two agents and a rumor
  ❌ No perfect prompts — believability tuning is capped at 20% of total time

## 2. Stack
* Node 22 + TypeScript (strict), @anthropic-ai/sdk, zod, better-sqlite3 (WAL mode), vitest.

## 3. Architecture

```
                    ┌─────────────────────────────┐
                    │        TICK SCHEDULER        │  deterministic loop
                    │   for tick: Promise.all(     │
                    │     agents.map(a => a.step)) │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        ┌──────────┐         ┌──────────┐         ┌──────────┐
        │ Agent A  │         │ Agent B  │         │ Agent C  │   plain objects,
        │  no state│         │          │         │          │   NO in-memory truth
        └────┬─────┘         └────┬─────┘         └────┬─────┘
             │    perceive/retrieve/plan/act/reflect    │
             ▼                    ▼                    ▼
        ┌─────────────────────────────────────────────────┐
        │              EVENT LOG (append-only)             │  ← THE TRUTH
        │  seq | agent_id | tick | type | payload | ts     │
        │  observation · reflection · plan_created ·       │
        │  utterance · llm_call_completed (journal) · …    │
        └───────────────────────┬─────────────────────────┘
                                │ replay()
                                ▼
        ┌─────────────────────────────────────────────────┐
        │           PROJECTIONS (mutable, disposable)      │  ← rm -rf safe
        │  memory_index: importance, embedding,            │
        │                last_retrieved_at                 │
        │  current_plan: pointer + execution cursor        │
        │  relationships (stretch)                         │
        └─────────────────────────────────────────────────┘
```

### 3.1 Two Laws
* Log law: anything that is content or happened goes in the log, forever, immutable. Reflections and plans are events, not projection rows.
Projection law — anything in a projection must be fully re-derivable by replay(). If deleting projections loses information, you broke the design.

* The side-effect law: the LLM call is a side effect. Before every call, look up the journal (llm_call_completed for this (agent_id, tick, purpose)); if found, use the journaled response. Replay moves forward and skips. No transactional rollbacks.
