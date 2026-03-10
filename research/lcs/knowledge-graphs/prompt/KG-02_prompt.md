# Research Prompt: KG-02 RAPTOR Paper Deep Study (P0 BLOCKER)

## Research Objective
Study RAPTOR’s hierarchical abstractive retrieval paradigm and evaluate whether its tree-based abstraction can improve LCS chunking and multi-level retrieval without unacceptable fidelity loss. The objective is to extract concrete design implications for ingestion/chunking and hierarchical context assembly. Findings feed ADR-004 and cross-reference RF-09 and NL-03.

## Research Questions
1. What are RAPTOR’s core stages (chunking, clustering, recursive summarization, retrieval) and how do they compose?
2. How does RAPTOR maintain fidelity while compressing information hierarchically?
3. Which assumptions about source text coherence break on code+ADR mixed corpora?
4. How should chunking policy be adapted to support RAPTOR-like hierarchical summaries?
5. What retrieval gains does hierarchical abstraction provide over flat retrieval baselines?
6. How does summary drift compound across recursive levels?
7. What evaluation setup best measures fidelity loss in hierarchical retrieval?
8. How does RAPTOR interact with lost-in-the-middle mitigation in long contexts?
9. What indexing/storage overhead does hierarchical representation add?
10. Which RAPTOR components are reusable in LCS v1 versus v2 experiments?
11. How should hierarchical nodes be represented in graph + vector layers simultaneously?
12. What risks should block adoption in ADR-004 until further evidence exists?

## Starting Sources
- RAPTOR paper — https://arxiv.org/abs/2401.18059
- RAG foundational paper — https://arxiv.org/abs/2005.11401
- GraphRAG paper (hierarchy comparison) — https://arxiv.org/abs/2404.16130
- LongBench repository — https://github.com/THUDM/LongBench
- BEIR repository — https://github.com/beir-cellar/beir
- LangChain text splitter concepts — https://python.langchain.com/docs/concepts/text_splitters/
- LlamaIndex node parsers docs — https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- Self-RAG paper (self-correction context) — https://arxiv.org/abs/2310.11511

## What to Measure, Compare, or Evaluate
- Flat vs hierarchical retrieval quality on LCS-style query sets.
- Fidelity metrics: claim retention and citation consistency across summary levels.
- Cost metrics: index build time, storage amplification, query latency.
- Error propagation: summary drift and abstraction hallucination rates.
- Ablation by chunking strategy from RF-09/NL-03.
- Suitability of hierarchy for code and decision-history artifacts.

## Definition of Done
- A reproducible RAPTOR-vs-flat evaluation is documented.
- Hierarchical retrieval benefits and limitations are quantified.
- Concrete ADR-004 recommendations are produced for v1/v2 scope.
- Failure classes and mitigation options are explicitly listed.
- Cross-links to RF-09 and NL-03 are resolved into implementation guidance.

## How Findings Feed LCS Architecture Decisions
This research determines whether ADR-004 should include hierarchical abstraction primitives or remain flat-first with selective summarization. It ties chunking strategy and fidelity safeguards directly to retrieval architecture decisions.
