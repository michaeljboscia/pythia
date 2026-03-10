# Research Prompt: RF-09 Chunking Strategies Comprehensive Survey (P0)

## Research Objective
Establish a high-confidence chunking policy for LCS by comparing recursive, token-based, semantic, sliding-window, markdown-aware, and structure-aware splitting methods across mixed artifact types. The study must quantify retrieval and end-to-end answer impact, not just splitter behavior in isolation. Findings feed ADR-004 and cross-reference NL-03 and CI-02.

## Research Questions
1. How do chunking algorithms differ in boundary quality and downstream retrieval utility?
2. What chunk size/overlap combinations maximize quality for code vs prose vs ADR content?
3. How much does semantic chunking outperform tuned deterministic splitters in LCS workloads?
4. Which chunking patterns most reduce entity/definition fragmentation errors?
5. How should code chunking align with syntax-aware splits from CI-02?
6. How do chunking choices alter index size, ingest throughput, and query latency?
7. What metric inflation risks arise from high overlap and duplicated evidence?
8. How does chunking interact with reranking and packing (RF-08) under strict context budgets?
9. Which metadata must be attached to chunks for provenance and migration stability?
10. How should chunking policy evolve as corpus scales from 50K to 500K+ chunks?
11. What edge cases are hardest: long tables, generated code, giant functions, mixed markdown/code blocks?
12. What benchmark protocol ensures fair splitter comparisons across artifact types?

## Starting Sources
- LangChain text splitters concepts — https://python.langchain.com/docs/concepts/text_splitters/
- LlamaIndex node parsers modules — https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/
- RAPTOR paper — https://arxiv.org/abs/2401.18059
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- BEIR repository — https://github.com/beir-cellar/beir
- Pinecone RAG chunking series — https://www.pinecone.io/learn/series/rag/
- Haystack docs — https://docs.haystack.deepset.ai/docs/intro
- tree-sitter docs (code-structure context) — https://tree-sitter.github.io/tree-sitter/
- LongBench repository — https://github.com/THUDM/LongBench

## What to Measure, Compare, or Evaluate
- Retrieval metrics: Recall@K, MRR, NDCG by chunking configuration.
- End-to-end metrics: answer correctness and citation fidelity.
- Fragmentation diagnostics: split entity/claim rate and cross-chunk dependency breaks.
- Index economics: chunk count, duplicate ratio, storage footprint, ingest time.
- Query latency impact from chunk cardinality inflation.
- Sensitivity sweeps for size/overlap and artifact-specific policies.

## Definition of Done
- A complete chunking comparison matrix is produced with reproducible configs.
- A default ADR-004 chunking profile is selected with artifact-specific exceptions.
- Metadata and chunk-ID scheme is standardized for stable updates/migrations.
- Quality/cost breakpoints and anti-patterns are explicitly documented.
- Continuous evaluation hooks are defined for EQ-06.

## How Findings Feed LCS Architecture Decisions
This research sets ADR-004 chunking defaults and links code-aware splitting from CI-02 with general text chunking from NL-03. It also constrains ADR-002 retrieval scalability and ADR-009 packing efficiency by controlling chunk granularity.
