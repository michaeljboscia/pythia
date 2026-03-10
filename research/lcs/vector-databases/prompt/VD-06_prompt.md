# Research Prompt: VD-06 Vector Database Benchmarking Methodology (P0)

## Research Objective
Define a fair, reproducible benchmarking methodology for comparing vector databases in the exact LCS context, avoiding vendor-biased setups and invalid apples-to-oranges conclusions. The methodology must specify datasets, query sets, relevance judgments, tuning budgets, hardware controls, and reporting standards. Findings feed ADR-002 and should anchor all VD-01 through VD-05 evaluations.

## Research Questions
1. What benchmark dimensions are mandatory for LCS decisions: recall-focused relevance, end-to-end answer quality, p95 latency, throughput, memory, storage, and operational complexity?
2. How should query sets be constructed to represent LCS workloads (identifier lookup, semantic synthesis, multi-hop retrieval, filter-heavy retrieval, hybrid retrieval)?
3. What fairness rules are required for hyperparameter tuning across systems (equal tuning budget, warmup protocol, index-build constraints)?
4. How should embedding model and dimension effects be controlled so DB comparisons are not confounded (cross-reference EM-06)?
5. Should benchmark scoring prioritize retrieval metrics alone or include downstream RAG quality metrics (cross-reference EQ-02/EQ-06, RF-10)?
6. How should hardware normalization be enforced (single-node specs, container limits, disk type, NUMA considerations)?
7. What methodology handles systems with different feature sets (e.g., built-in hybrid search vs external fusion) without penalizing architecture choices unfairly?
8. How should concurrency and update tests be standardized for living-corpus conditions (cross-reference PE-02, DM-05)?
9. What statistical reporting is required (confidence intervals, run-to-run variance, significance thresholds)?
10. How should failure-mode and resilience behavior be benchmarked alongside steady-state performance?
11. Which open benchmark suites (ANN-Benchmarks, VectorDBBench, BEIR) are reusable as-is and what LCS-specific extensions are required?
12. What documentation standards ensure benchmark results are auditable and reproducible six months later?

## Starting Sources
- ANN-Benchmarks site — https://ann-benchmarks.com/
- ANN-Benchmarks repository — https://github.com/erikbern/ann-benchmarks
- VectorDBBench repository — https://github.com/zilliztech/VectorDBBench
- BEIR benchmark repository — https://github.com/beir-cellar/beir
- MTEB benchmark repository — https://github.com/embeddings-benchmark/mteb
- HNSW paper — https://arxiv.org/abs/1610.02415
- FAISS wiki (ANN evaluation/tuning context) — https://github.com/facebookresearch/faiss/wiki
- Qdrant benchmarks page — https://qdrant.tech/benchmarks/
- NeurIPS reproducibility checklist (reporting rigor inspiration) — https://neurips.cc/public/guides/PaperChecklist

## What to Measure, Compare, or Evaluate
- Core retrieval metrics: Recall@k, MRR, NDCG, filtered-retrieval accuracy.
- System metrics: p50/p95/p99 latency, QPS at target recall, index build/rebuild time.
- Resource metrics: memory footprint, disk footprint, CPU load, cost-per-query estimates.
- Reliability metrics: error rates under load, recovery time after failure, consistency after restarts.
- Concurrency metrics: performance degradation with simultaneous ingest and query traffic.
- Reproducibility metrics: run variance and confidence intervals across repeated trials.
- End-to-end quality metrics: grounded answer correctness/citation when feasible.

## Definition of Done
- A benchmark protocol document exists with fixed rules for datasets, tuning budgets, and reporting.
- A reference harness is produced that can run all candidate databases under the same workload definitions.
- Statistical reporting templates and pass/fail thresholds are defined.
- Methodology is validated by re-running at least one scenario with consistent results.
- VD-01 through VD-05 studies are aligned to this methodology.
- ADR-002 receives a defensible evaluation framework, not anecdotal comparisons.

## How Findings Feed LCS Architecture Decisions
This research is the methodological backbone for ADR-002 decision quality. It prevents biased vendor selection, enforces consistency across hands-on evaluations, and links retrieval-system metrics to downstream LCS outcome metrics defined in EQ-02 and EQ-06.
