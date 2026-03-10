# Research Prompt: VD-03 pgvector Evaluation

## Research Objective
Evaluate pgvector as a vector retrieval option inside Postgres for LCS, focusing on HNSW and IVFFlat behavior, SQL-filter integration, and operational overhead relative to dedicated vector databases. The research should produce a realistic fit assessment for LCS v1 scope, not generic Postgres advocacy. Findings feed ADR-002 and should connect to PE-02 concurrency and EM-09 migration complexity.

## Research Questions
1. How do pgvector HNSW and IVFFlat indexes compare on quality, latency, and build costs for LCS-like datasets?
2. What are the practical benefits of colocating metadata and vectors in SQL versus split architecture (vector DB + graph/doc stores)?
3. How efficiently does Postgres execute hybrid vector + structured filters (`WHERE` clauses with high-cardinality metadata)?
4. What are tuning requirements (shared buffers, work_mem, maintenance_work_mem, autovacuum behavior) for stable vector-query performance?
5. How does write amplification and index maintenance cost behave under living-corpus incremental updates (cross-reference DM-05)?
6. What operational overhead emerges (backup/restore size, replication, vacuum/analyze load, schema migrations)?
7. How does pgvector perform across embedding dimensions and chunk cardinalities (cross-reference EM-06, RF-09)?
8. What concurrency profile can Postgres sustain under mixed transactional and vector-search workloads?
9. What are failure modes in real operations (bloat, slow index rebuilds, lock contention, planner misestimation)?
10. How does pgvector compare to Qdrant/LanceDB in retrieval quality and latency when benchmarked fairly (cross-reference VD-06)?
11. Does pgvector simplify or complicate blue-green model migrations (cross-reference EM-09)?
12. For LCS scale, when is pgvector “good enough” versus strategically limiting?

## Starting Sources
- pgvector repository and docs — https://github.com/pgvector/pgvector
- pgvector HNSW docs section — https://github.com/pgvector/pgvector#hnsw
- pgvector IVFFlat docs section — https://github.com/pgvector/pgvector#ivfflat
- PostgreSQL index type docs — https://www.postgresql.org/docs/current/indexes-types.html
- PostgreSQL resource tuning docs — https://www.postgresql.org/docs/current/runtime-config-resource.html
- PostgreSQL `EXPLAIN` docs — https://www.postgresql.org/docs/current/using-explain.html
- HNSW paper — https://arxiv.org/abs/1610.02415
- ANN-Benchmarks site — https://ann-benchmarks.com/
- VectorDBBench repository — https://github.com/zilliztech/VectorDBBench

## What to Measure, Compare, or Evaluate
- Retrieval metrics: Recall@k, MRR, NDCG for HNSW and IVFFlat with controlled settings.
- SQL filter integration: latency and quality under compound predicates.
- Operational metrics: index build time, vacuum overhead, storage growth, backup duration.
- Concurrency metrics: query latency under simultaneous ingest/update workloads.
- Planner behavior: query plan stability and regressions across dataset growth.
- Cost profile: infrastructure complexity and total operational effort vs specialized vector DBs.

## Definition of Done
- A repeatable pgvector test suite is run at multiple corpus sizes and dimensions.
- HNSW vs IVFFlat recommendation is documented with concrete tuning defaults.
- Operational risk profile is explicit for LCS context.
- A comparative statement against VD-01/VD-02 is backed by normalized benchmarks.
- ADR-002 receives a clear decision input on pgvector viability and constraints.

## How Findings Feed LCS Architecture Decisions
This research defines whether ADR-002 should consolidate retrieval into Postgres or separate concerns across specialized stores. It also informs PE-02 concurrency assumptions and EM-09 migration options when model versioning requires dual-index or shadow-read strategies.
