# Research Prompt: PA-03 LightRAG Architecture Study

## Research Objective
Analyze LightRAG architecture and implementation to understand its dual-level retrieval model, graph construction strategy, and performance claims, then compare directly against GraphRAG for LCS fit. The objective is to extract concrete architectural lessons for balancing retrieval quality and implementation complexity. Findings feed ADR-001 and ADR-002, and should cross-reference KG-10, RF-10, and VD-06.

## Research Questions
1. What are LightRAG’s core architectural components and dataflow from ingestion to query response?
2. How does its local/global (dual-level) retrieval design work in practice, and how does it differ from GraphRAG?
3. What graph construction assumptions (entity extraction quality, edge density, summary quality) are required for LightRAG to perform well?
4. Which index structures and retrieval strategies are used for speed, and what quality tradeoffs do they imply?
5. How reproducible are LightRAG performance claims on non-paper datasets and mixed artifact corpora?
6. What operational bottlenecks emerge (index build time, summary generation cost, query routing overhead)?
7. How does LightRAG handle updates and graph freshness in living corpora (cross-reference DM-03/DM-05)?
8. What failure modes are likely for code-heavy corpora and ADR-heavy reasoning tasks?
9. How does LightRAG integrate with dense/sparse/hybrid retrieval choices from ADR-002?
10. Which LightRAG patterns are high-leverage for LCS v1 and which are v2-only due to complexity?
11. What benchmarking protocol should be used for a fair GraphRAG vs LightRAG comparison (cross-reference VD-06, EQ-02)?
12. Should LCS adopt a hybrid strategy borrowing from both systems, and under what guardrails?

## Starting Sources
- LightRAG repository — https://github.com/HKUDS/LightRAG
- LightRAG website/docs — https://lightrag.github.io/
- LightRAG paper — https://arxiv.org/abs/2410.05779
- GraphRAG repository — https://github.com/microsoft/graphrag
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- GraphRAG docs — https://microsoft.github.io/graphrag/
- RAPTOR paper (hierarchical retrieval comparison) — https://arxiv.org/abs/2401.18059
- CRAG paper (corrective retrieval context) — https://arxiv.org/abs/2401.15884
- ANN-Benchmarks site (retrieval performance framing) — https://ann-benchmarks.com/

## What to Measure, Compare, or Evaluate
- Architecture comparison matrix: stages, dependencies, data artifacts, complexity drivers.
- Quality comparison: multi-hop correctness, citation fidelity, global synthesis quality.
- Performance comparison: indexing duration, query latency, memory footprint.
- Freshness behavior: incremental update cost and stale-graph risk.
- Failure taxonomy: where each system fails by query type and corpus condition.
- Portability scoring for each subsystem into LCS constraints.

## Definition of Done
- A reproducible side-by-side architecture and evaluation report is produced.
- Clear adopt/adapt/reject recommendations are made for LightRAG components.
- Complexity-vs-quality tradeoffs are quantified with explicit thresholds.
- A proposal is made for LCS v1 and v2 use of LightRAG-derived patterns.
- ADR-001 and ADR-002 receive concrete decision inputs.

## How Findings Feed LCS Architecture Decisions
This research informs whether LCS should lean community-first, dual-level routing, or a hybrid graph retrieval strategy. It sets ADR-001 graph retrieval structure and ADR-002 retrieval/index implications based on measured tradeoffs, not paper claims alone.
