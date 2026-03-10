# Research Prompt: PE-01 Single-Process Daemon Architecture for MCP + Background Ingest

## Research Objective
Define a robust single-process Node.js architecture for LCS MCP serving plus background ingest/index jobs, explicitly grounded in the current Pythia inter-agent pattern where MCP runs as a single Node.js process. The research must determine safe concurrency patterns, queue orchestration, and failure isolation within one process before introducing multiprocess complexity. Findings feed ADR-007 and should cross-reference MC-05, DM-07, and PE-05.

## Research Questions
1. What limits does the Node.js event loop impose for mixed latency-sensitive RPC handling and long-running background tasks?
2. How should CPU-bound work be isolated (worker threads vs child processes) without abandoning single-process coordination?
3. What queue patterns (Bull, Bee-Queue, BullMQ-like) are suitable when broker dependencies are optional or minimal?
4. How should backpressure be enforced to protect MCP responsiveness under indexing bursts?
5. What scheduling policies are needed for fairness between user-facing queries and ingestion jobs?
6. How should cancellation, retries, and idempotency be implemented for long-running ingest tasks?
7. What observability is essential to debug event-loop lag, starvation, and memory leaks?
8. How does the existing Pythia single-process MCP architecture behave under load, and what lessons transfer directly?
9. Which failure modes require escalating to multi-process designs, and what objective triggers should define that transition?
10. How should graceful shutdown and restart semantics preserve queue consistency and in-flight work?
11. What security/isolation tradeoffs arise when tool execution and retrieval run in one process?
12. What minimal v1 architecture should ADR-007 codify, and what v2 upgrades should be preplanned?

## Starting Sources
- Node.js event loop guide — https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick
- Node.js worker_threads docs — https://nodejs.org/api/worker_threads.html
- Node.js child_process docs — https://nodejs.org/api/child_process.html
- Node.js cluster docs — https://nodejs.org/api/cluster.html
- Bull queue repository — https://github.com/OptimalBits/bull
- Bee-Queue repository — https://github.com/bee-queue/bee-queue
- BullMQ docs (modern queue patterns) — https://docs.bullmq.io/
- OpenTelemetry docs (instrumentation) — https://opentelemetry.io/docs/
- Google SRE monitoring chapter — https://sre.google/sre-book/monitoring-distributed-systems/

## What to Measure, Compare, or Evaluate
- Event-loop lag under mixed RPC + ingest workloads.
- Query latency (p50/p95/p99) as background task concurrency increases.
- Throughput and failure rates for queue retry/backoff policies.
- Memory profile and leak risk across long-running daemon sessions.
- Recovery correctness for crash/restart with in-flight jobs.
- Operational complexity comparison: pure single-process vs hybrid worker-thread model.

## Definition of Done
- A concrete single-process architecture blueprint is produced for ADR-007.
- Queueing, backpressure, retry, and shutdown policies are specified.
- Performance limits and escalation triggers to multiprocess are defined.
- Observability requirements are documented with actionable dashboards/alerts.
- Existing Pythia MCP lessons are explicitly incorporated.

## How Findings Feed LCS Architecture Decisions
This research establishes ADR-007’s baseline daemon model and prevents premature architectural sprawl. It translates real constraints from current Pythia operations into design rules for safe, scalable single-process execution.
