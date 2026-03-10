# Research Prompt: RF-09 Chunking Strategy Survey and Retrieval Impact

## Research Objective
Identify the chunking strategy that gives LCS the best retrieval and synthesis performance across heterogeneous corpus artifacts, with explicit tradeoffs in index size, latency, and fidelity. Compare recursive character chunking, token-based chunking, semantic boundary chunking, sliding-window overlap, and markdown/code-aware splitting under a shared evaluation harness. The output must provide an evidence-backed default for ADR-004 (Ingestion and Chunking Pipeline).

## Research Questions
1. How does chunk size (for example, 128/256/512/1024 tokens) affect Recall@k, MRR, and downstream answer quality for code-heavy vs prose-heavy queries?
2. What overlap percentage (0%, 10%, 20%, 30%+) provides the best quality/duplication tradeoff for multi-hop reasoning without exploding index size?
3. Do semantic chunkers outperform deterministic splitters on real LCS tasks, or only on benchmark-style datasets?
4. How should markdown-aware and code-aware chunking preserve structural units (headings, lists, function boundaries) to prevent context fragmentation?
5. What chunking failures are most harmful in production (split definitions, orphaned references, duplicated evidence pollution, metadata drift)?
6. How do chunking strategies interact with reranking and context packing (for example, many tiny chunks helping retrieval but hurting context assembly)?
7. Should LCS use per-artifact-type chunking policies (different rules for `.ts`, `.md`, ADR files, and logs), and what complexity cost does that introduce?

## Starting Sources
- LangChain text splitters (recursive, token, markdown) — https://python.langchain.com/docs/concepts/text_splitters/
- LlamaIndex node parser modules (sentence/semantic/token/markdown split options) — https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/
- RAPTOR paper (hierarchical retrieval implications for chunk granularity) — https://arxiv.org/abs/2401.18059
- Contriever repository (retrieval evaluation utilities and dense retrieval baselines) — https://github.com/facebookresearch/contriever
- Pinecone RAG series (production chunking tradeoffs and retrieval behavior) — https://www.pinecone.io/learn/series/rag/
- Haystack documentation (document preprocessing and chunking pipelines) — https://docs.haystack.deepset.ai/docs/intro

## What to Measure, Compare, or Evaluate
- Retrieval metrics by chunker configuration: Recall@5/10/20, MRR@10, NDCG@10.
- End-to-end QA metrics: correctness, citation fidelity, and multi-hop completion rate.
- Index economics: number of chunks, duplicate-content ratio, storage footprint, and ingest time.
- Latency profile: retrieval p50/p95 and reranking overhead as chunk counts increase.
- Fragmentation diagnostics: rate of split entities/claims and cross-chunk dependency breaks.
- Sensitivity tests: performance variance across short factual queries vs long synthesis prompts.

## Definition of Done
- A full comparison matrix exists across chunking methods, chunk sizes, and overlap settings.
- One default chunking profile is selected for v1, plus explicit exceptions by artifact type if needed.
- The report includes quantitative breakpoints where increased chunk granularity stops paying off.
- A migration strategy is provided for re-chunking existing indexes when policy changes.
- ADR-004 receives concrete parameter recommendations (size, overlap, parser type, metadata schema).

## How Findings Feed LCS Architecture Decisions
This research is the primary input for ADR-004 ingestion design and impacts ADR-002 retrieval behavior by changing index density and reranking load. It also influences ADR-009 context assembly because chunk granularity determines how many units can be packed before hitting context limits.
