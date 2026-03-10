# Research Prompt: EM-07 Multi-Vector vs Single-Vector Embeddings (Model Routing, Cross-Space Scoring, Ops Complexity)

## Research Objective
Evaluate whether LCS should remain single-vector per chunk or adopt multi-vector strategies (late interaction, per-token vectors, per-type model routing) for higher retrieval quality. The research must quantify real gains on LCS tasks and include operational overhead, cross-space scoring complexity, and maintenance risk. Output should produce a clear adopt/defer decision for ADR-003.

## Research Questions
1. In which query classes does multi-vector retrieval materially outperform single-vector retrieval (code navigation, semantic dependency tracing, multi-hop rationale synthesis)?
2. How do ColBERT-style late interaction methods compare to strong single-vector baselines when reranking is already present (cross-reference RF-05, RF-06)?
3. What is the storage multiplier for multi-vector indexing at LCS scale, and can compression/quantization reduce it without destroying gains?
4. How should per-type model routing work (code model for code chunks, prose model for docs/ADRs), and what are the failure modes when query intent is ambiguous?
5. Can scores from heterogeneous embedding spaces be fused robustly, or does score calibration instability make this brittle?
6. Does two-stage routing (classifier -> retriever) introduce latency and compounding errors that offset relevance gains?
7. How do multi-vector and cross-encoder rerankers interact: complementary improvements or redundant complexity?
8. What debugging/observability burden appears when retrieval results come from multiple spaces with different semantic geometries?
9. How do model upgrades (cross-reference EM-09) become harder in multi-space systems with asynchronous migrations?
10. What minimum evaluation evidence is required before approving multi-vector for v1 versus deferring to v2?
11. Are there simpler alternatives (hybrid sparse+dense, better chunking, better reranking) that capture most benefits at lower complexity?
12. Which edge cases break multi-space routing (polyglot files, mixed markdown+code chunks, generated artifacts, tiny chunks)?

## Starting Sources
- ColBERT paper — https://arxiv.org/abs/2004.12832
- ColBERTv2 paper — https://arxiv.org/abs/2112.01488
- BGE-M3 (multi-function/multi-vector retrieval) — https://arxiv.org/abs/2402.03216
- RAGatouille (ColBERT tooling) — https://github.com/AnswerDotAI/RAGatouille
- Qdrant vector concepts (named vectors and multi-vector support) — https://qdrant.tech/documentation/concepts/vectors/
- Weaviate vector search concepts — https://weaviate.io/developers/weaviate/concepts/search/vector-search
- Milvus docs repository (multi-vector references) — https://github.com/milvus-io/milvus-docs
- FAISS documentation (ANN for dense retrieval variants) — https://faiss.ai/
- BEIR benchmark repository — https://github.com/beir-cellar/beir
- MTEB benchmark repository — https://github.com/embeddings-benchmark/mteb

## What to Measure, Compare, or Evaluate
- Quality comparison: single-vector baseline vs multi-vector variants on LCS evaluation suite (Recall@k, MRR, NDCG, grounded answer score).
- Cost profile: storage amplification, index build time, RAM overhead, and query-time compute cost.
- Latency stack: additional latency from routing, multi-space retrieval, score fusion, and reranking.
- Score calibration quality: reliability of fusion methods (RRF, z-score normalization, learned weighting) across spaces.
- Operational complexity index: number of deployable components, migration paths, and failure blast radius.
- Error attribution clarity: ability to diagnose whether failure came from routing, embedding space mismatch, ANN miss, or reranker.
- Robustness tests: ambiguous queries, mixed-format chunks, near-duplicate evidence across spaces.

## Definition of Done
- At least one strong single-vector pipeline and two multi-vector pipeline variants are benchmarked end-to-end.
- A quantified complexity-vs-quality decision is documented (not narrative-only).
- A go/no-go recommendation is made for LCS v1 with explicit acceptance thresholds.
- If deferred, a v2 trigger condition is defined (for example, measurable recall ceiling or specific missed-query class rate).
- ADR-003 receives a concrete architecture decision including scoring/fusion and observability requirements.

## How Findings Feed LCS Architecture Decisions
This research directly determines ADR-003 retrieval representation strategy and impacts ADR-002 index/storage sizing. It also influences ADR-007/ADR-009 interfaces because multi-space retrieval changes metadata contracts, score semantics, and context packing assumptions.
