# Research Prompt: VD-01 Qdrant Deep Dive (Hands-On, P0 Blocker)

## Research Objective
Run a hands-on architecture and performance evaluation of Qdrant as a primary vector store candidate for LCS, with emphasis on real retrieval workloads, metadata filtering, and hybrid search. The study must produce measured latency/memory behavior at 50K, 100K, 250K, and 500K chunks under mixed artifact workloads (code, ADRs, docs, logs), not a feature checklist. Findings directly feed ADR-002 and must cross-reference RF-01 (dense retrieval fundamentals), EM-06 (dimension tradeoffs), and PE-02 (concurrency behavior under serving + indexing).

## Research Questions
1. How do Qdrant’s storage internals (segments, WAL, payload storage, quantization options) impact ingestion throughput and query latency at each corpus scale tier?
2. What HNSW settings in Qdrant (`m`, `ef_construct`, `hnsw_ef`) are optimal for LCS query mix, and how sensitive are results to embedding dimension (384/768/1024/1536)?
3. How well does payload filtering perform under realistic LCS metadata predicates (artifact type, repo, path prefix, timestamp, decision status), including highly selective and low-selectivity filters?
4. How does Qdrant hybrid retrieval (dense + sparse) compare to dense-only for exact identifier queries and semantically broad synthesis queries?
5. What are the memory and disk cost implications of quantization and on-disk payload/index strategies, and what quality loss appears under each?
6. How does Docker deployment behave under sustained load (resource limits, persistence, restart recovery, snapshot/restore behavior)?
7. What failure modes appear under partial outages or misconfiguration (index build interruption, WAL replay delays, payload schema drift)?
8. How does Qdrant perform under concurrent read + write workloads representative of living-corpus indexing (cross-reference DM-05/DM-07)?
9. What operational ergonomics matter most: backup/restore, schema evolution, aliasing/collection migration, observability hooks?
10. How do Qdrant benchmark claims translate to LCS-specific evaluation harnesses (cross-reference VD-06 methodology)?
11. Does Qdrant’s hybrid/filter performance change materially between code-heavy and prose-heavy subsets?
12. What hard constraints or gotchas would block Qdrant for LCS v1?

## Starting Sources
- Qdrant documentation home — https://qdrant.tech/documentation/
- Qdrant storage concepts — https://qdrant.tech/documentation/concepts/storage/
- Qdrant filtering concepts — https://qdrant.tech/documentation/concepts/filtering/
- Qdrant hybrid queries — https://qdrant.tech/documentation/concepts/hybrid-queries/
- Qdrant installation and deployment guides — https://qdrant.tech/documentation/guides/installation/
- Qdrant snapshots and backup concepts — https://qdrant.tech/documentation/concepts/snapshots/
- Qdrant collections/aliases concepts — https://qdrant.tech/documentation/concepts/collections/
- Qdrant GitHub repository — https://github.com/qdrant/qdrant
- Qdrant published benchmarks — https://qdrant.tech/benchmarks/
- HNSW paper (algorithm foundation) — https://arxiv.org/abs/1610.02415
- ANN-Benchmarks site — https://ann-benchmarks.com/

## What to Measure, Compare, or Evaluate
- Dataset tiers: 50K, 100K, 250K, 500K vectors with realistic LCS metadata and mixed chunk types.
- Quality metrics: Recall@10/20, MRR@10, NDCG@10 with and without filters/hybrid retrieval (cross-reference EQ-02).
- Latency metrics: p50/p95/p99 for query types (dense-only, filtered, hybrid, filtered+hybrid).
- Throughput metrics: QPS at fixed recall targets and under mixed read/write concurrency.
- Resource metrics: RAM, disk, CPU utilization, index build time, snapshot/restore time.
- Dimension sweep: repeat core tests at 384/768/1024/1536 dimensions (cross-reference EM-06).
- Robustness tests: restart during indexing, payload schema changes, high-cardinality metadata filters.
- Operational tests: Docker restart persistence, backup integrity, recovery correctness.

## Definition of Done
- A reproducible benchmark harness and dataset generation procedure are documented.
- A complete performance table exists across scale tiers, dimensions, and query classes.
- A clear recommendation is given for Qdrant suitability (adopt/reject/conditional) with risk register.
- Concrete configuration defaults are proposed for LCS (index params, filtering strategy, deployment profile).
- Known failure modes and mitigations are documented for production operations.
- ADR-002 receives decision-ready evidence and implementation constraints.

## How Findings Feed LCS Architecture Decisions
This research provides primary evidence for ADR-002 database selection, including expected quality/latency/cost envelopes. It also constrains ADR-003 dimensional choices (via measured interactions), informs PE-02 concurrency expectations, and sets baseline methodology inputs for VD-06 cross-database fairness.
