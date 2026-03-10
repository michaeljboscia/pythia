# Research Prompt: PE-02 Embedded Database Concurrency Patterns (P0)

## Research Objective
Evaluate concurrency behavior for embedded data stores in LCS, with emphasis on SQLite WAL/isolation and LanceDB access patterns under simultaneous read/write pressure. The goal is to define safe serving + indexing patterns and lock contention mitigation for small-to-medium scale deployments. Findings feed ADR-001 and ADR-002, and should cross-reference GD-01, VD-02, and DM-05.

## Research Questions
1. How do SQLite rollback vs WAL modes differ under mixed read/write workloads typical of LCS?
2. What reader/writer isolation guarantees exist in SQLite and how do they impact query freshness?
3. Which SQLite settings (WAL checkpointing, busy timeout, journal config) most affect throughput and stability?
4. How does LanceDB concurrency behave across threads/processes and concurrent ingest/query workloads?
5. What lock contention/failure patterns appear in embedded stores when indexing bursts overlap with user queries?
6. How should connection management be designed in a single-process MCP daemon for embedded DB safety?
7. What are the practical limits before embedded storage becomes operationally risky?
8. How should snapshot/backup operations be performed without unacceptable read disruption?
9. What consistency guarantees are required during incremental indexing and partial failures?
10. How do these patterns compare with client-server stores (Qdrant/pgvector) for concurrency resilience?
11. Which anti-patterns lead to deadlocks, starvation, or silent stale reads?
12. What should ADR-001/002 specify as mandatory concurrency guardrails?

## Starting Sources
- SQLite WAL documentation — https://sqlite.org/wal.html
- SQLite isolation semantics — https://sqlite.org/isolation.html
- SQLite locking model — https://sqlite.org/lockingv3.html
- SQLite pragmas reference — https://sqlite.org/pragma.html
- LanceDB repository — https://github.com/lancedb/lancedb
- LanceDB docs — https://lancedb.github.io/lancedb/
- Qdrant collections docs (comparison baseline) — https://qdrant.tech/documentation/concepts/collections/
- pgvector repository (comparison baseline) — https://github.com/pgvector/pgvector
- “A Critique of ANSI SQL Isolation Levels” (transaction isolation context) — https://dl.acm.org/doi/10.1145/223784.223785

## What to Measure, Compare, or Evaluate
- Read latency degradation under increasing write concurrency.
- Write throughput and conflict rates under ingest bursts.
- Busy timeout/lock wait distributions and failure counts.
- Freshness lag between committed writes and read visibility.
- Backup/snapshot impact on query latency and write availability.
- Recovery behavior after abrupt process termination.
- Comparative concurrency resilience vs non-embedded alternatives.

## Definition of Done
- A concurrency test harness and workload matrix are defined and run.
- Recommended DB settings and access patterns are documented.
- Safe operational envelopes (QPS/write rate limits) are established.
- Failure-mode runbooks for lock/contention incidents are drafted.
- ADR-001/002 receive explicit concurrency design constraints.

## How Findings Feed LCS Architecture Decisions
This research sets hard concurrency guardrails for embedded-store usage in ADR-001/002 and informs PE-01 daemon scheduling decisions. It determines when embedded patterns are sufficient and when to escalate to client-server database architectures.
