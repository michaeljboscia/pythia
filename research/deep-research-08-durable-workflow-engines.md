# Durable Workflow Engines as Prior Art for Multi-Step Orchestration

**Source:** Gemini Deep Research
**Research ID:** `v1_ChdFWjZ2YWJteEhxdU1fUFVQcFo3QndRURIXRVo2dmFibXhIcXVNX1BVUHBaN0J3UVE`
**Duration:** 4m 15s
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T04-33-22-204Z.json`

---

## Key Points

- **Two paradigms:** State-machine-as-a-service (AWS Step Functions) vs event-sourced workflow-as-code (Cadence/Temporal) — distinct trade-offs in developer friction vs operational overhead
- **"Exactly-once" is an abstraction:** Achieved practically via at-least-once delivery + strict idempotency + deduplication — not true exactly-once
- **Saga pattern is mandatory:** For distributed compensation/rollback when ACID transactions span multiple services
- **Directly applicable to Pythia:** checkpoint→dismiss→spawn→load→verify pipeline maps cleanly to durable workflow Activities with compensation logic

---

## Architectural Paradigms

### Cadence (Uber)
- "Workflow-as-code" — write workflows in general-purpose languages (Java, Go)
- 4 services: Frontend (API gateway), History (append-only event journal on Cassandra), Matching (task queue), Worker (background maintenance)
- Ringpop gossiping protocol for workload sharding

### Temporal.io (Cadence Fork)
- Modernized: full gRPC, datastore agnostic (PostgreSQL/MySQL support), native mTLS, Elasticsearch visibility
- **Workflows** = deterministic orchestration logic; **Activities** = non-deterministic side effects
- Cluster is stateless state manager; application code runs on external Worker processes
- Determinism constraint: no `datetime.now()`, no direct network access, no true random — engine provides `workflow.now()` that replays from event log

### AWS Step Functions
- JSON-based state machine (Amazon States Language)
- Standard Workflows: long-running (up to 1 year), exactly-once, durable journaling
- Express Workflows: high-throughput (up to 5 min), at-least-once, in-memory
- Zero operational overhead but vendor lock-in

---

## Core Reliability Mechanisms

### Exactly-Once Execution
- **Temporal:** At-least-once dispatch + deterministic replay. Worker replays event history; SDK intercepts Activity calls and returns stored results instead of re-executing
- **Step Functions:** Task tokens (`.waitForTaskToken`) — unique token passed to external service, duplicate submissions rejected

### Step Journaling (Event Sourcing)
- State = immutable append-only event log, NOT mutable database row
- Example journal: `WorkflowStarted → TaskScheduled → TaskStarted → TaskCompleted → ActivityScheduled → ActivityStarted → ActivityCompleted`
- On crash recovery: new worker receives full event log, replays deterministic code, skips completed activities
- **Limits:** Temporal: 50K events or 50MB (use `ContinueAsNew` to truncate); Step Functions: 256KB state payload (use S3 Claim-Check pattern)

### Compensation / Rollback (Saga Pattern)
- **Backward Recovery:** Revert to original state (delete new cluster, restore old)
- **Forward Recovery:** Retry failed step indefinitely (transient failure assumed)
- **Temporal:** Native `try/catch/finally` + Saga SDK primitive; register compensations dynamically
- **Step Functions:** Explicit `Catch` blocks in ASL JSON → transition to compensation states

### Timeout Handling (Temporal's 4 Types)
1. **ScheduleToStart:** Max time in task queue waiting for worker pickup (worker starvation detection)
2. **StartToClose:** Max execution time after worker pickup (stuck process detection)
3. **ScheduleToClose:** Overall max (ScheduleToStart + StartToClose)
4. **Heartbeat:** Long-running activities must ping server at intervals; missed heartbeat = worker assumed dead

### Crash Recovery
- **Worker crash:** Engine detects via severed TCP/missed heartbeat → task re-queued → new worker replays from journal
- **Orchestrator crash:** Stateless services; another node takes shard ownership. Backend DB (Cassandra/PostgreSQL) handles consensus

---

## Application to Pythia Pipeline

### Failure Matrix with Compensation

| Failure Point | Forward Recovery | Backward Recovery (Saga) |
|--------------|-----------------|-------------------------|
| **checkpoint fails** | Retry to different storage node | No state changed; alert operator |
| **dismiss fails** | Exponential backoff retries | Pipeline blocked (old nodes still running); halt |
| **spawn fails** (no capacity) | Wait + retry | Saga: spawn(old config) → load(old checkpoint) to restore |
| **load fails** | Network retry | Saga: dismiss(new) → spawn(old) → load(previous good checkpoint) |
| **verify fails** | Retry verification | Same as load failure — new nodes poisoned, restore old |

### Key Design Rules
1. **Control Flow, not Data Flow:** Never pass large payloads through the engine — pass pointers (S3 URIs, file paths)
2. **Idempotent Activities:** Every activity must handle duplicate execution (e.g., terminating already-terminated instance returns success)
3. **Heartbeats for Long Operations:** Checkpoint and load activities MUST heartbeat — these are multi-minute operations
4. **Deterministic Workflows:** No `Date.now()`, no `Math.random()`, no direct I/O in workflow code

### Temporal vs Step Functions for Pythia

| Dimension | Temporal | Step Functions |
|-----------|---------|---------------|
| Dynamic compensation | Native try/catch/finally | Verbose JSON Catch blocks |
| Testing | Local unit tests with mock activities | Requires deployed infra |
| Vendor lock-in | None (any cloud/on-prem) | AWS only |
| Ops overhead | Must run cluster + DB | Zero (managed) |
| Expressiveness | Turing-complete (Python/Go/Java) | JSON DSL (ASL) |
| Visual debugging | Limited | Excellent (DAG visualization) |

---

## Recommendations for Pythia

1. **Model checkpoint→dismiss→spawn→load→verify as a Saga** with explicit compensating transactions for each step
2. **Heartbeat timeout on checkpoint and load** — these are the longest operations and most likely to hang
3. **Pass pointers, not payloads** — checkpoint path, manifest path, corpus file list — never raw content through the orchestrator
4. **Idempotency keys** on every mutating operation — derived from `WorkflowId + StepId`
5. **Consider lightweight Saga implementation** rather than full Temporal deployment — XState or a custom step journal in SQLite may suffice for single-host Pythia
