# Research Prompt: VD-02 LanceDB Deep Dive (Hands-On, P0 Blocker)

## Research Objective
Run a hands-on deep evaluation of LanceDB as an embedded vector database option for LCS, emphasizing Lance columnar format behavior, zero-copy mmap access patterns, IVF-PQ indexing, and concurrent read/write safety. The output must determine whether LanceDB’s embedded architecture is an advantage or liability for LCS operational goals. Findings feed ADR-002 and should cross-reference RF-01, EM-06, and PE-02.

## Research Questions
1. How does LanceDB’s embedded architecture (file-backed Lance format, mmap behavior) impact cold-start and warm-query latency for local MCP-serving workloads?
2. What are the practical tradeoffs between IVF-PQ and flat/alternative index modes in LanceDB for recall, latency, and memory footprint?
3. How does query performance scale from 50K to 500K vectors under realistic LCS metadata filtering and artifact-type segmentation?
4. How stable is concurrent access across ingestion and query workloads, and what locking/contention behavior emerges under stress?
5. How much operational simplicity does embedded deployment provide versus networked vector DBs, and where does it break (backup strategy, corruption recovery, multi-process contention)?
6. How well does LanceDB support hybrid retrieval or lexical augmentation patterns needed by LCS exact-match-heavy queries (cross-reference RF-03/RF-04)?
7. What are the implications of file-format evolution/versioning on long-lived corpus maintenance and migrations (cross-reference EM-09)?
8. How does LanceDB perform across different embedding dimensions and chunking policies (cross-reference EM-06, RF-09)?
9. What failure modes appear with abrupt process termination or partial writes, and how recoverable are they?
10. How does LanceDB’s developer ergonomics compare for Node/Python integration in LCS pipelines?
11. What observability and debugging gaps exist relative to server-based databases?
12. Which LCS scenarios favor LanceDB strongly, and which scenarios disqualify it?

## Starting Sources
- LanceDB docs portal — https://lancedb.github.io/lancedb/
- LanceDB Python SDK docs — https://lancedb.github.io/lancedb/python/python/
- LanceDB JavaScript docs — https://lancedb.github.io/lancedb/js/globals/
- LanceDB Java docs — https://lancedb.github.io/lancedb/java/java/
- LanceDB GitHub repository — https://github.com/lancedb/lancedb
- Lance format repository (storage engine internals) — https://github.com/lancedb/lance
- LanceDB company docs landing — https://docs.lancedb.com/
- LanceDB website/docs hub — https://www.lancedb.com/docs/
- ANN-Benchmarks site — https://ann-benchmarks.com/
- FAISS wiki (IVF/PQ background) — https://github.com/facebookresearch/faiss/wiki
- “Billion-scale similarity search with GPUs” (IVF/PQ context) — https://arxiv.org/abs/1702.08734

## What to Measure, Compare, or Evaluate
- Scale tiers: 50K/100K/250K/500K with dimension sweeps (384/768/1024/1536).
- Query classes: semantic lookup, identifier-heavy lookup, filtered retrieval, mixed artifact retrieval.
- Metrics: Recall@k, MRR, NDCG, p50/p95/p99 latency, ingest throughput, index build/rebuild time.
- Concurrency tests: simultaneous ingest + query across one and multiple processes.
- Memory/I/O profile: RSS, page-cache behavior, disk read/write amplification, mmap effects.
- Resilience tests: crash during ingest, restart correctness, file integrity checks.
- Operational burden: backup process complexity, restore speed, migration friction.

## Definition of Done
- A reproducible LanceDB benchmark/evaluation workbook exists with scripts and configuration snapshots.
- IVF-PQ vs alternatives are compared with explicit quality/latency/storage tradeoffs.
- Concurrency and failure-mode behavior are documented with pass/fail criteria.
- A clear recommendation is made for LanceDB fit in LCS v1 (primary/secondary/reject).
- ADR-002 receives decision-ready constraints and deployment implications.

## How Findings Feed LCS Architecture Decisions
This research determines whether ADR-002 should prioritize embedded deployment simplicity or favor server-based operational controls. It also affects EM-06 dimension policy feasibility, PE-02 concurrency architecture, and EM-09 migration strategy if file-format or index rebuild constraints become dominant.
