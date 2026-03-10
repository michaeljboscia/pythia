# Research Prompt: KG-01 GraphRAG Paper + Implementation Deep Study (P0 BLOCKER)

## Research Objective
Perform a rigorous paper-and-code analysis of Microsoft GraphRAG to extract decision-grade guidance for LCS graph retrieval architecture. The study must reconcile theory with implementation realities around graph construction, community summarization, and local/global retrieval orchestration. Findings feed ADR-001 and cross-reference PA-02, KG-06, and KG-03.

## Research Questions
1. What are the exact algorithmic stages in GraphRAG from raw corpus to query-time retrieval?
2. How do entity/relation extraction assumptions affect downstream community quality?
3. How does community detection influence global query answers and topic summarization quality?
4. What tradeoffs exist between local graph traversal and global community retrieval paths?
5. How does GraphRAG represent schema and provenance, and how portable is that to LCS polymorphic nodes?
6. Which implementation details in PA-02 differ from paper abstractions and why?
7. What are major failure modes (bad extraction, community collapse, stale summaries, over-generalized global context)?
8. How does GraphRAG handle incremental updates and corpus drift?
9. Which evaluation metrics in the paper/implementation are strong versus insufficient for LCS needs?
10. What compute and cost bottlenecks dominate indexing and refresh cycles?
11. Which GraphRAG components are mandatory for LCS v1 versus deferrable?
12. What objective criteria should decide GraphRAG-inspired adoption in ADR-001?

## Starting Sources
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- GraphRAG repository — https://github.com/microsoft/graphrag
- GraphRAG documentation — https://microsoft.github.io/graphrag/
- Microsoft GraphRAG blog — https://www.microsoft.com/en-us/research/blog/graphrag-new-tool-for-complex-data-discovery-now-on-github/
- GraphRAG issues tracker — https://github.com/microsoft/graphrag/issues
- Leiden algorithm paper — https://www.nature.com/articles/s41598-019-41695-z
- Louvain paper — https://arxiv.org/abs/0803.0476
- LightRAG repository (comparison) — https://github.com/HKUDS/LightRAG
- Property graph standards hub (openCypher) — https://opencypher.org/

## What to Measure, Compare, or Evaluate
- Reproduce key GraphRAG pipeline stages on a representative LCS subset.
- Measure local vs global retrieval performance by query class.
- Evaluate community quality impact on answer correctness and citation fidelity.
- Benchmark index build time, refresh cost, and memory footprint.
- Perform failure-mode injection (noisy relations, missing entities, stale summaries).
- Produce adopt/adapt/reject mapping for each subsystem.

## Definition of Done
- A paper-to-code reconciliation report is completed.
- A reproducible LCS mini-pilot for GraphRAG-style flow is documented.
- Critical assumptions and failure boundaries are explicit.
- ADR-001 receives concrete design guidance and risk constraints.
- Cross-links to KG-06 and KG-03 decisions are resolved.

## How Findings Feed LCS Architecture Decisions
This research anchors ADR-001 in implementation reality rather than paper-level optimism. It determines whether LCS should adopt community-centric graph retrieval, how aggressively, and with which guardrails.
