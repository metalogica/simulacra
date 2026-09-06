# Simulacra

**What is this repo?**
A crash-safe generative agent runtime built from first principles using an event-sourced, durable-execution core with a functional shell and flat modules. Nothing fancy. Framework-free. Minimal runtime dependencies. All in your terminal. Not a single GUI.

**Why did I build it?**
I wanted to develop my understanding of both distributed systems and AI agent harness engineering through a focussed example derived from an academic paper that I find genuinely fascinating: [Park et al. (2023)](https://arxiv.org/pdf/2304.03442)'s famous study of simulated agent societies.

**What is the opportunity?**
Their paper defined the architecture of believable agents — memory stream, reflection, planning — but did not address specific implementation details. This project is a first-principles implementation of their system built as a durable execution runtime that survives kill -9 mid-thought, never re-runs a side effect, and never loses a memory.

## 1. Execution

```bash
# T1: check app
pnpm compile
pnpm test

# T1: run the writer
pnpm db:drop && node src/main.ts --ticks 50 --chaos

# T2: run the reader
pnpm tail

# T3: kill -9
pkill -9 -f "src/main.ts"
## check DB
sqlite3 db/simulacra.sqlite3 "SELECT COUNT(*) FROM events;"

```


```mermaid
sequenceDiagram
  autonumber
  participant D as main.ts<br/>(driver)
  participant A as activity.ts
  participant S as store<br/>(event log)
  participant L as LLM Provider

  D->>A: llm({agentId, tick, purpose,<br/>schema, deriveEvents})

  A->>S: read receipts for<br/>(agentId, tick, purpose)
  Note over A,S: Idempotency key.<br/>Looked up against the LOG,<br/>never a projection.

  alt Journal MISS — first execution
    S-->>A: none

    loop up to 3 attempts
      A->>L: complete(prompt)
      L-->>A: raw string
      Note over A: schema.parse(JSON.parse(...))<br/>On failure: append error to prompt, retry.<br/>Transport errors are NOT caught —<br/>they crash the step, journaling nothing.
    end

    rect rgb(255, 230, 230)
      Note over A,L: ⚠ CRASH WINDOW<br/>kill -9 anywhere from here back to the call:<br/>no receipt exists → resume calls the API again.<br/>This is the at-least-once half.
    end

    A->>S: appendMany([receipt, ...derived])
    Note over A,S: ONE transaction, receipt first.<br/>Atomic commit is what makes<br/>effects exactly-once.
    S-->>A: sequences
    A-->>D: {status: "completed", replayed: false}

  else Journal HIT — resume after crash
    S-->>A: llm_call_completed receipt
    Note over A: schema.parse(receipt.result)<br/>Re-parsed against the CURRENT schema —<br/>drift under a live log fails loudly.
    A-->>D: {status: "completed", replayed: true}
    Note over A,L: No API call. No new rows.<br/>This is the exactly-once half.

  end
```


## 2. Architecture

### 2.1 System Principles
* Event-sourcing: immutable append-only log as a source of truth
  * One journal table `events` that records 1) in-world events 2) effect receipts.
  * One projection table `projection_memories` to deterministically rebuild in-world events from the event store on replay.
* Read side: CQRS-lite
  * Two composition roots in the project
    * `main.ts` is the write-side
    * `tail.ts` is the read side; no controller currently built.
* Execution: Durable Execution & Journalled Effects
  * Temporal `workflow` / `activity` split with receipts, at-least-once calls, and exactly-once effects.
* Module layout: functional core, imperative shell
  * flat file hierarchy
  * pure factory function DI (it's not poor if it's done with love)

### 2.2 System Invariants
* Log law: anything that is content or happened goes in the log, forever, immutable. Reflections and plans are events, not projection rows.
* Projection law: anything in a projection must be fully re-derivable by `projection.replay()`. If deleting projections loses information, the design failed.
* The Side-Effect Law: the LLM call is a side effect. Before every call, look up the journal (`llm_call_completed` for this (`agent_id`, `tick`, `purpose`)); if found, use the journaled response. Replay moves forward and skips. No transactional rollbacks.

### 2.3 Tech Stack

* Persistence: Sqlite3
* Runtime: Node 24, running TypeScript directly (native type stripping, TS 7)
  * `zod` for domain event modelling
  * `better-sqlite3` for the DB adapter
* Model access: OpenRouter over raw `fetch` (chat completions and embeddings), no SDK

## 3. C4 Model

### L1 — Context
```mermaid
flowchart LR
  operator(["Operator<br/><i>runs, kills, watches</i>"])
  simulacra["<b>Simulacra</b><br/>Crash-safe generative<br/>agent runtime"]
  provider["<b>LLM Provider</b><br/><i>External system</i><br/>OpenRouter"]

  operator -->|"starts a run, kill -9s it,<br/>tails the log"| simulacra
  simulacra -->|"completes prompts<br/><b>the only nondeterminism</b>"| provider

  classDef person fill:#0b4884,stroke:#073b6f,color:#fff
  classDef system fill:#1168bd,stroke:#0b4884,color:#fff
  classDef external fill:#6b6b6b,stroke:#4d4d4d,color:#fff
  class operator person
  class simulacra system
  class provider external
```

What you say: one actor, one external dependency, and that dependency is the entire source of nondeterminism in the system. Everything else is a function of the log.

### L2 — Containers

```mermaid
flowchart TB
  operator(["Operator"])
  provider["<b>LLM Provider</b><br/><i>External</i>"]

  subgraph simulacra["Simulacra"]
    direction TB
    writer["<b>Writer Process</b><br/>[Node 24 · TypeScript]<br/><i>pnpm start</i><br/><br/>Runs the tick loop.<br/>Sole writer to the log."]
    reader["<b>Reader Process</b><br/>[Node 24 · TypeScript]<br/><i>pnpm tail</i><br/><br/>Cursor-based tailer.<br/>Read-only connection."]
    store[("<b>Event Log + Projections</b><br/>[SQLite 3 · WAL]<br/><br/>Append-only log = source of truth.<br/>Projections = disposable caches.")]
  end

  operator -->|"launches / kill -9"| writer
  operator -->|"launches, reads stdout"| reader
  writer -->|"append events<br/><i>one txn per journaled call</i>"| store
  writer -->|"complete prompt<br/><i>HTTPS</i>"| provider
  store -->|"SELECT WHERE sequence > cursor<br/><i>poll, 400ms</i>"| reader

  classDef person fill:#0b4884,stroke:#073b6f,color:#fff
  classDef container fill:#438dd5,stroke:#2e6295,color:#fff
  classDef db fill:#438dd5,stroke:#2e6295,color:#fff
  classDef external fill:#6b6b6b,stroke:#4d4d4d,color:#fff
  class operator person
  class writer,reader container
  class store db
  class provider external
```

What you say: WAL gives you exactly one writer and N concurrent readers, and readers never block the writer. That's why tail can watch a live run without touching it. Two processes, one file, no broker, no network. The reader is a demonstration of the pragma choice, not a convenience feature.

### L3 — Components inside the Writer Process

```mermaid
flowchart TB
  provider["<b>LLM Provider</b><br/><i>External</i>"]
  sqlite[("<b>SQLite</b><br/>events · projection_memories")]

  subgraph writer["Writer Process — Node 24 · TypeScript"]
    direction TB

    main["<b>main.ts</b><br/>[Composition Root · CLI]<br/><i>Pure DI — wires the graph by hand.<br/>Parses argv, drives the tick loop.</i>"]

    subgraph core["Application Core — no I/O, no vendor types"]
      direction TB
      activity["<b>activity.ts</b><br/>[Application Service]<br/><i>The idempotence barrier.<br/>Journal lookup → call → receipt.<br/>Sole nondeterminism choke point.</i>"]
      events["<b>events.ts</b><br/>[Domain Model]<br/><i>Event schema registry.<br/>AgentEvent / StoredEvent.<br/>Parse boundary. Zero I/O.</i>"]
      projection["<b>projection.ts</b><br/>[Application Service]<br/><i>Rebuilds read models<br/>by replaying the log.</i>"]
    end

    subgraph ports["Ports — interfaces owned by the core"]
      direction LR
      storePort{{"<b>Store</b><br/><i>append · appendMany · read</i>"}}
      llmPort{{"<b>LlmClient</b><br/><i>complete</i>"}}
    end

    subgraph adapters["Driven Adapters — infrastructure"]
      direction TB
      storeImpl["<b>store.ts</b><br/>[Repository]<br/><i>Prepared statements.<br/>Row ⇄ event mapping.</i>"]
      llmImpl["<b>llm.ts</b><br/>[Client]<br/><i>createMockLLM — seeded<br/>Mulberry32, chaos injection.</i>"]
      db["<b>db.ts</b><br/>[Infrastructure]<br/><i>Connection, pragmas,<br/>DDL, immutability triggers.</i>"]
    end
  end

  main -->|constructs + injects| activity
  main -->|constructs| storeImpl
  main -->|constructs| llmImpl
  main -->|"llm per tick"| activity

  activity -.->|depends on| storePort
  activity -.->|depends on| llmPort
  activity -->|"AgentEvent types"| events
  projection -->|"toMemoryRow"| events

  storeImpl -.->|implements| storePort
  llmImpl -.->|implements| llmPort

  storeImpl -->|"zod parse / serialize"| events
  storeImpl -->|"prepared stmts"| db
  projection -->|"read log, write rows"| storeImpl

  db -->|"better-sqlite3"| sqlite
  llmImpl -->|"complete"| provider

  classDef root fill:#f5a623,stroke:#c47f0f,color:#000
  classDef svc fill:#85bbf0,stroke:#5d82a8,color:#000
  classDef domain fill:#b5e6a2,stroke:#7fae6c,color:#000
  classDef port fill:#fff,stroke:#333,stroke-dasharray:4 3,color:#000
  classDef infra fill:#c9c9c9,stroke:#8a8a8a,color:#000
  classDef external fill:#6b6b6b,stroke:#4d4d4d,color:#fff
  class main root
  class activity,projection svc
  class events domain
  class storePort,llmPort port
  class storeImpl,llmImpl,db infra
  class provider external
  class sqlite external
```


### L3 — Reader Process

```mermaid
flowchart LR
  sqlite[("<b>SQLite</b><br/><i>read-only connection</i>")]

  subgraph reader["Reader Process — Node 24 · TypeScript"]
    direction TB
    tail["<b>tail.ts</b><br/>[Composition Root]<br/><i>4 lines. This is what a<br/>composition root should look like.</i>"]
    logger["<b>logger.ts</b><br/>[Driving Adapter · Presenter]<br/><i>Cursor-based tailer + ANSI formatter.<br/>Self-composes — builds its own db/store.</i>"]
    ev["<b>events.ts</b><br/>[Domain Model]"]
  end

  tail --> logger
  logger -->|"exhaustive switch<br/>on event type"| ev
  sqlite -->|"poll: sequence > cursor"| logger
  logger -->|stdout| out(["Terminal"])

  classDef root fill:#f5a623,stroke:#c47f0f,color:#000
  classDef svc fill:#85bbf0,stroke:#5d82a8,color:#000
  classDef domain fill:#b5e6a2,stroke:#7fae6c,color:#000
  classDef external fill:#6b6b6b,stroke:#4d4d4d,color:#fff
  class tail root
  class logger svc
  class ev domain
  class sqlite,out external
```
