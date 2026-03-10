# Research Prompt: KG-10 LightRAG Architecture Study (Prior Art vs GraphRAG)

## Research Objective
Perform a rigorous architecture study of LightRAG, including its dual-level retrieval design, graph construction assumptions, and operational tradeoffs, then compare it against Microsoft GraphRAG for LCS fit. The goal is to identify reusable patterns, hidden constraints, and failure points before adopting any LightRAG-inspired design in LCS. This research feeds ADR-001.

## Research Questions
1. What are LightRAG’s core architectural components (indexing pipeline, graph representation, local/global retrieval paths), and how do they differ from GraphRAG’s community-centric approach?
2. Which assumptions in LightRAG are dataset-dependent (document homogeneity, entity extraction quality, graph density), and do they hold for LCS mixed artifacts?
3. How does LightRAG handle incremental updates, corpus drift, and graph freshness compared with GraphRAG implementations?
4. What empirical quality and latency claims does LightRAG make, and are they reproducible on non-paper benchmarks or realistic engineering corpora?
5. What are the primary complexity drivers in LightRAG (graph build cost, query routing overhead, summarization stages), and where are the practical bottlenecks?
6. Which LightRAG components can be modularly adopted in LCS without importing full-stack complexity?
7. What failure modes appear when LightRAG-style methods are applied to code-centric and ADR-centric corpora (entity ambiguity, weak relation extraction, context inflation)?
8. What decision criteria should be used to choose between GraphRAG-like, LightRAG-like, or hybrid graph retrieval for LCS v1?

## Starting Sources
- LightRAG paper: Simple and Fast Retrieval-Augmented Generation — https://arxiv.org/abs/2410.05779
- LightRAG official repository — https://github.com/HKUDS/LightRAG
- LightRAG project site/documentation — https://lightrag.github.io/
- GraphRAG paper: From Local to Global — https://arxiv.org/abs/2404.16130
- Microsoft GraphRAG implementation — https://github.com/microsoft/graphrag
- RAPTOR paper (alternative hierarchical retrieval baseline) — https://arxiv.org/abs/2401.18059

## What to Measure, Compare, or Evaluate
- Architecture comparison matrix: pipeline steps, dependencies, statefulness, and required infrastructure.
- Retrieval quality head-to-head: local precision, global synthesis quality, and multi-hop evidence completeness.
- Performance/cost profile: indexing time, query latency, memory footprint, and compute cost by stage.
- Operability factors: debuggability, observability hooks, and complexity of failure recovery.
- Adaptation effort: estimated engineering effort to integrate key components into LCS.
- Fit score: weighted rubric against LCS constraints (heterogeneous corpus, MCP serving model, incremental updates).

## Definition of Done
- A side-by-side LightRAG vs GraphRAG comparison report is produced with reproducible experiment settings.
- Reusable LightRAG patterns are explicitly identified as adopt/modify/reject for LCS.
- Risks are documented for adopting LightRAG components in a code+ADR-heavy environment.
- A recommendation is made for ADR-001: LightRAG-inspired, GraphRAG-inspired, hybrid, or neither.
- Decision confidence is supported by measurements, not only paper claims.

## How Findings Feed LCS Architecture Decisions
This research provides ADR-001 with an evidence-backed prior-art decision on graph retrieval architecture. It determines whether LCS should adopt community-first global retrieval, lightweight dual-level routing, or a staged hybrid; and it constrains downstream schema and extraction design by clarifying which prior-art assumptions are compatible with LCS data reality.
