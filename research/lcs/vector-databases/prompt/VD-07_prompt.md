# Research Prompt: VD-07 Vector Index Algorithms (HNSW, IVF-PQ, IVF-Flat, DiskANN, ScaNN)

## Research Objective
Build a decision framework for selecting ANN index algorithms by workload, scale, and resource constraints in LCS, rather than treating index choice as vendor default. The study must compare HNSW, IVF-Flat, IVF-PQ, DiskANN, and ScaNN on quality/latency/memory tradeoffs and operational implications. Findings feed ADR-002 and should connect to RF-01, EM-06, and PE-02.

## Research Questions
1. What are the core algorithmic mechanics and asymptotic tradeoffs of HNSW, IVF-Flat, IVF-PQ, DiskANN, and ScaNN?
2. At LCS scale (50K-500K today, possible growth to 1M+), which algorithms dominate under different memory budgets?
3. How do these algorithms respond to embedding dimension increases and distribution changes (cross-reference EM-06)?
4. What recall-latency frontier does each algorithm provide for code-heavy vs prose-heavy query distributions?
5. How do update patterns (frequent inserts/deletes) affect index health and maintenance overhead for each approach?
6. What quantization artifacts in IVF-PQ or compression-heavy modes most harm retrieval fidelity for nuanced LCS queries?
7. Which algorithms are most robust under filtered retrieval and hybrid search integration?
8. What operational gotchas matter most: rebuild time, parameter sensitivity, hardware dependence, failure recovery complexity?
9. How portable are algorithm choices across databases, and where are vendor implementations materially different?
10. For small/medium datasets, when does algorithm sophistication add complexity without practical benefit?
11. How should LCS map query classes to algorithm/index profiles (single default vs profile-per-workload)?
12. What benchmark evidence threshold should be required before deviating from default HNSW-centric choices?

## Starting Sources
- HNSW paper — https://arxiv.org/abs/1610.02415
- FAISS wiki (IVF, PQ, HNSW implementations) — https://github.com/facebookresearch/faiss/wiki
- “Billion-scale similarity search with GPUs” (IVF/PQ context) — https://arxiv.org/abs/1702.08734
- ScaNN paper — https://arxiv.org/abs/1908.10396
- Google ScaNN repository path — https://github.com/google-research/google-research/tree/master/scann
- DiskANN NeurIPS abstract — https://proceedings.neurips.cc/paper/2019/hash/09853c7fb1d3f8ee67a61b6bf4a7f8e6-Abstract.html
- ANN-Benchmarks site — https://ann-benchmarks.com/
- ANN-Benchmarks repository — https://github.com/erikbern/ann-benchmarks
- Qdrant docs (HNSW behavior in production DB context) — https://qdrant.tech/documentation/concepts/storage/
- pgvector docs (HNSW and IVFFlat in SQL setting) — https://github.com/pgvector/pgvector

## What to Measure, Compare, or Evaluate
- Recall-latency frontiers for each algorithm under fixed hardware constraints.
- Memory and disk footprint per 100K vectors by dimension tier.
- Build/rebuild time and incremental update performance.
- Filtered retrieval degradation for each algorithm.
- Parameter-sensitivity analysis: how fragile quality is to mis-tuning.
- Operational resilience: behavior after crash/restart and partial rebuild scenarios.
- Workload-fit matrix: algorithm suitability by query type and scale profile.

## Definition of Done
- A comparative algorithm matrix exists with practical selection criteria for LCS workloads.
- Default and fallback index algorithm recommendations are documented.
- Parameter ranges are provided for initial deployment and tuning envelopes.
- Anti-patterns and high-risk configurations are identified clearly.
- Outputs are mapped into VD-01..VD-05 implementation choices.
- ADR-002 receives explicit algorithm-level decision guidance.

## How Findings Feed LCS Architecture Decisions
This research determines algorithm defaults and tuning boundaries inside ADR-002 and prevents vendor-default lock-in. It also informs EM-06 dimension strategy feasibility, PE-02 concurrency expectations, and VD-06 benchmark design by identifying which algorithm behaviors must be tested under LCS-specific workloads.
