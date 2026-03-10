# Research Prompt: NL-03 Text Chunking Algorithms Deep Dive (P0)

## Research Objective
Produce a decision-grade chunking strategy for LCS by comparing recursive, token-based, semantic, markdown-aware, and structure-aware chunking on retrieval and answer quality. This research must quantify tradeoffs in chunk size/overlap, index growth, and context packing impact. Findings feed ADR-004 and should explicitly cross-reference RF-09, EM-06, and EQ-02.

## Research Questions
1. How do recursive character, token, semantic-boundary, and markdown-aware splitters differ algorithmically?
2. What chunk sizes and overlaps maximize retrieval quality for LCS query classes?
3. How do chunking choices interact with embedding dimensions and model choice (cross-reference EM-06/EM-03)?
4. What fragmentation errors most harm downstream synthesis (split definitions, broken dependency chains, orphaned context)?
5. How much retrieval benefit comes from semantic chunking versus tuned deterministic chunking?
6. How should code blocks, headings, tables, and ADR sections be chunked differently?
7. What is the duplication tax from overlap, and when does it inflate metrics without true quality gains?
8. How does chunking affect long-context packing and lost-in-the-middle risk (cross-reference RF-07/RF-08)?
9. What index/storage and ingestion-time penalties arise from fine-grained chunking?
10. Which chunking policy should be global vs artifact-specific?
11. How should chunk IDs and provenance metadata be designed for stable migrations and diffing?
12. What benchmark protocol ensures fair chunking comparisons (cross-reference VD-06 methodology)?

## Starting Sources
- LangChain text splitters concept docs — https://python.langchain.com/docs/concepts/text_splitters/
- LlamaIndex node parsers modules — https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/
- RAPTOR paper (hierarchical retrieval/chunk abstraction) — https://arxiv.org/abs/2401.18059
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- BEIR benchmark repository — https://github.com/beir-cellar/beir
- Pinecone RAG series (chunking tradeoffs) — https://www.pinecone.io/learn/series/rag/
- Haystack docs (preprocessing/chunking pipelines) — https://docs.haystack.deepset.ai/docs/intro
- TextTiling foundational paper (topic segmentation) — https://aclanthology.org/J97-1003/
- Semantic chunking reference implementation (LlamaIndex) — https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/

## What to Measure, Compare, or Evaluate
- Retrieval metrics by chunk strategy: Recall@K, MRR, NDCG on LCS evaluation queries.
- End-to-end answer metrics: correctness, citation fidelity, multi-hop completion.
- Cost metrics: ingest time, index size, duplicate ratio, query latency impact.
- Error analysis: fragmentation rate, boundary-quality score, false-neighbor retrievals.
- Robustness under mixed artifacts and large docs.
- Sensitivity sweeps for size and overlap configurations.

## Definition of Done
- A full chunking comparison matrix is produced with reproducible configs.
- Default v1 chunking policy is selected with artifact-specific exceptions if needed.
- Provenance/ID scheme is specified for stable updates and migrations.
- Metric-backed rationale is documented for ADR-004.
- Continuous regression checks are defined for chunking policy drift.

## How Findings Feed LCS Architecture Decisions
This research is a primary ADR-004 input and sets the structural quality floor for all retrieval. It also impacts ADR-002 index sizing, ADR-009 context packing behavior, and EQ-06 monitoring by defining chunking-sensitive quality indicators.
