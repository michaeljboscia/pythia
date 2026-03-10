# Research Prompt: KG-10 LightRAG Architecture Study (P1)

## Research Objective
Conduct a detailed architecture study of LightRAG, including code and paper claims, to determine what design elements are transferable to LCS and how they compare with GraphRAG approaches. The study should emphasize practical tradeoffs in quality, complexity, and operational maintainability. Findings feed ADR-001 and cross-reference PA-03 and KG-01.

## Research Questions
1. What are LightRAG’s core architectural modules and their runtime interactions?
2. How does LightRAG’s dual-level retrieval compare with GraphRAG local/global retrieval?
3. What graph construction assumptions and prerequisites does LightRAG rely on?
4. Which parts of LightRAG improve latency/quality most in practice?
5. What implementation complexity and maintenance burden come with LightRAG adoption?
6. How does LightRAG handle corpus updates, staleness, and incremental refresh?
7. What failure modes are likely on code+ADR-heavy corpora versus narrative text corpora?
8. How reproducible are published results under LCS-like evaluation tasks?
9. Which LightRAG components can be modularly adopted without importing full architecture?
10. How does LightRAG performance compare under fair methodology from VD-06/EQ-02?
11. What anti-patterns from LightRAG should LCS avoid?
12. Should ADR-001 prefer GraphRAG-like, LightRAG-like, hybrid, or minimal graph retrieval?

## Starting Sources
- LightRAG paper — https://arxiv.org/abs/2410.05779
- LightRAG repository — https://github.com/HKUDS/LightRAG
- LightRAG docs/site — https://lightrag.github.io/
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- GraphRAG repository — https://github.com/microsoft/graphrag
- GraphRAG docs — https://microsoft.github.io/graphrag/
- RAPTOR paper (hierarchical alternative) — https://arxiv.org/abs/2401.18059
- CRAG paper (retrieval correction context) — https://arxiv.org/abs/2401.15884
- LongBench repository (evaluation baseline) — https://github.com/THUDM/LongBench

## What to Measure, Compare, or Evaluate
- Architecture comparison matrix: components, dependencies, and complexity.
- Quality metrics for local/global/dual retrieval strategies.
- Performance metrics: ingest/indexing cost, query latency, memory footprint.
- Freshness/update behavior under corpus changes.
- Failure injection tests for noisy extraction and sparse graph conditions.
- Portability scoring for each subsystem into LCS constraints.

## Definition of Done
- A reproducible LightRAG vs GraphRAG comparison is produced.
- Reusable LightRAG patterns are tagged adopt/adapt/reject.
- Operational and quality risks are explicitly documented.
- ADR-001 recommendation is made with evidence-backed tradeoffs.
- Cross-domain impacts (RF/KG/EQ) are mapped to follow-up actions.

## How Findings Feed LCS Architecture Decisions
This research informs ADR-001 prior-art choice with direct code-and-metrics evidence, clarifying whether LCS should adopt a dual-level graph retrieval design, a GraphRAG-style approach, or a constrained hybrid.
