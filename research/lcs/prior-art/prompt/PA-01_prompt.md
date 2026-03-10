# Research Prompt: PA-01 Cognee (Open Source KG + RAG)

## Research Objective
Perform a code-level study of Cognee as a prior-art implementation of knowledge-graph-enhanced RAG, focusing on how it builds graphs, extracts relationships, and handles heterogeneous sources. The goal is to identify reusable design patterns, hidden assumptions, and failure modes that matter for LCS graph + retrieval architecture. Findings feed ADR-001 and ADR-005, and should cross-reference KG-04/KG-09, RF-10, and DM-05.

## Research Questions
1. What is Cognee’s end-to-end architecture from ingestion to retrieval, and what components are tightly coupled vs modular?
2. How does Cognee construct graph entities/edges from unstructured documents and code-like artifacts?
3. Which extraction strategies does Cognee use (parser-based, LLM-based, hybrid), and where are confidence/quality controls applied?
4. How does Cognee represent heterogeneous node types and relationship semantics, and what schema evolution strategy exists?
5. What retrieval orchestration patterns are used (graph traversal, vector search, reranking, synthesis), and where do they break?
6. How does Cognee handle incremental updates, stale relationships, and re-indexing consistency over time?
7. What operational constraints appear in real use (latency bottlenecks, memory pressure, indexing costs, pipeline fragility)?
8. How does Cognee evaluate quality internally, and what metrics or test harnesses are missing for production rigor (cross-reference EQ-01/EQ-06)?
9. Which parts of Cognee are directly portable to LCS and which are coupled to assumptions LCS does not share?
10. What anti-patterns should LCS avoid based on Cognee’s implementation tradeoffs?
11. How does Cognee’s architecture compare to GraphRAG and LightRAG decisions at equivalent complexity levels?
12. What specific extraction and graph-governance primitives should LCS adopt, adapt, or reject?

## Starting Sources
- Cognee repository — https://github.com/topoteretes/cognee
- Cognee documentation — https://docs.cognee.ai/
- Cognee website — https://www.cognee.ai/
- Cognee evals directory — https://github.com/topoteretes/cognee/tree/main/evals
- Microsoft GraphRAG repository (comparison baseline) — https://github.com/microsoft/graphrag
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- LightRAG repository (comparison baseline) — https://github.com/HKUDS/LightRAG
- LightRAG paper — https://arxiv.org/abs/2410.05779
- REBEL relation extraction paper — https://arxiv.org/abs/2101.11185

## What to Measure, Compare, or Evaluate
- Pipeline decomposition: ingestion stages, extraction stages, indexing stages, query stages.
- Extraction quality signals: edge precision/recall strategy and confidence propagation.
- Schema robustness: polymorphic node handling, edge typing discipline, evolution overhead.
- Retrieval quality hooks: where graph retrieval improves or harms answer grounding.
- Incremental update behavior: delta ingest correctness and stale-edge cleanup.
- Operational profile: indexing throughput, query latency, component failure blast radius.
- Portability matrix: adopt/adapt/reject recommendations for each major Cognee subsystem.

## Definition of Done
- A code-informed architecture map of Cognee is produced with module-level annotations.
- Reusable LCS patterns are identified with concrete implementation candidates.
- Critical gaps and anti-patterns are documented with evidence from code/docs/issues.
- A side-by-side comparison to GraphRAG/LightRAG is included for key decisions.
- ADR-001 and ADR-005 receive concrete design inputs, not generic observations.

## How Findings Feed LCS Architecture Decisions
This research directly informs ADR-001 graph model and ADR-005 extraction pipeline boundaries by showing what works in an OSS KG+RAG system under practical constraints. It also provides risk signals for RF-10 production hardening and DM-05 incremental indexing behavior.
