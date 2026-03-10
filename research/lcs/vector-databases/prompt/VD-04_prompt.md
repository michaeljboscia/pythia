# Research Prompt: VD-04 ChromaDB Evaluation

## Research Objective
Assess ChromaDB as an embedded vector database option for LCS with focus on architecture, SQLite-backed persistence behavior, feature depth, and production readiness under living-corpus workloads. The output should separate rapid-prototyping strengths from long-term operational limitations and feed ADR-002 with evidence-based positioning. Cross-reference RF-01, VD-06, and PE-02.

## Research Questions
1. What is ChromaDB’s current architectural model (embedded/server modes, persistence layer, indexing strategy), and how stable is it for production use?
2. How does ChromaDB retrieval quality and latency compare at 50K-500K vectors under realistic LCS query mixes?
3. How effective are Chroma metadata filters for high-cardinality and compound predicates common in LCS?
4. What concurrency limitations exist with SQLite-backed storage and how do they affect simultaneous ingestion + querying?
5. How does Chroma handle incremental updates, deletes, and compaction in long-lived datasets?
6. What backup, restore, migration, and corruption-recovery tooling exists and what remains manual?
7. Which known limitations or recurring issue patterns appear in community usage (scaling pain points, locking, memory spikes)?
8. How does Chroma behave with larger embedding dimensions and heavy overlap chunking policies (cross-reference EM-06, RF-09)?
9. What observability hooks are available for latency, index health, and data integrity tracking?
10. How hard is it to integrate Chroma cleanly with LCS MCP and graph layers compared to other candidates?
11. What threshold conditions should trigger migration away from Chroma if adopted for v1 prototype?
12. Is Chroma best framed as production candidate, prototyping tool, or fallback option for LCS?

## Starting Sources
- Chroma documentation — https://docs.trychroma.com/
- Chroma introduction docs — https://docs.trychroma.com/docs/overview/introduction
- Chroma cookbook — https://cookbook.chromadb.dev/
- Chroma GitHub repository — https://github.com/chroma-core/chroma
- SQLite documentation (locking/concurrency background) — https://www.sqlite.org/lockingv3.html
- SQLite WAL mode docs — https://www.sqlite.org/wal.html
- ANN-Benchmarks site — https://ann-benchmarks.com/
- VectorDBBench repository — https://github.com/zilliztech/VectorDBBench
- HNSW paper (retrieval baseline context) — https://arxiv.org/abs/1610.02415

## What to Measure, Compare, or Evaluate
- Quality metrics: Recall@k, MRR, NDCG on LCS evaluation sets.
- Latency metrics: p50/p95/p99 under read-heavy and mixed read/write conditions.
- Concurrency behavior: lock contention rate, write stalls, query jitter under indexing load.
- Persistence reliability: restart recovery, durability under abrupt termination, backup/restore success.
- Scale behavior: memory and disk growth from 50K to 500K vectors.
- Filter behavior: latency and correctness for multi-field metadata predicates.
- Ops effort: setup complexity, maintenance burden, troubleshooting difficulty.

## Definition of Done
- A hands-on benchmark/evaluation report exists with reproducible setup and scripts.
- Production-readiness scorecard is completed with explicit must-have criteria.
- A decision recommendation is made: v1 candidate, prototype-only, or reject.
- Migration triggers and risk mitigations are documented if Chroma is adopted short-term.
- ADR-002 receives clear evidence and caveats for Chroma’s role in LCS.

## How Findings Feed LCS Architecture Decisions
This research determines whether ADR-002 can responsibly include Chroma in the shortlist or reserve it for prototyping only. It also feeds PE-02 concurrency decisions and informs VD-06 benchmarking baselines to avoid unfairly comparing prototype-oriented configurations with production-optimized systems.
