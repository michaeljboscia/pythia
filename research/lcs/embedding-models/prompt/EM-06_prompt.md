# Research Prompt: EM-06 Embedding Dimension Tradeoffs (384 vs 768 vs 1024 vs 1536, including Matryoshka)

## Research Objective
Determine the optimal embedding dimensionality strategy for LCS retrieval quality, cost, and latency, with explicit evidence for 384, 768, 1024, and 1536 dimensions. This research must separate marketing claims from measurable effects on mixed corpora (code, ADRs, docs, logs), and evaluate whether Matryoshka-style variable-dimension embeddings can reduce operational complexity. Findings should produce production-ready defaults and fallback tiers for ADR-003.

## Research Questions
1. How does retrieval quality change across 384/768/1024/1536 dimensions on LCS-like tasks (single-hop lookup, multi-hop synthesis, code-reference resolution, decision-trace queries)?
2. At what corpus sizes (50k, 250k, 1M chunks) do dimensionality increases stop yielding meaningful quality gains relative to memory and latency costs?
3. How do ANN index configurations (HNSW parameters, quantization, ef settings) interact with dimensionality and distort naive quality comparisons?
4. Do high dimensions improve robustness for semantically nuanced queries while harming exact-identifier retrieval (IDs, function names, version strings)?
5. How does dimensionality affect reranker dependence: does lower-dimensional retrieval require stronger reranking to close quality gaps?
6. What are the practical benefits and pitfalls of Matryoshka Representation Learning (MRL) or truncated embeddings for tiered retrieval pipelines?
7. How does dimensionality impact vector drift sensitivity when model versions change (cross-reference EM-09)?
8. Which dimension choices remain stable across embedding providers (OpenAI, Voyage, open-source sentence-transformers) and which are model-specific artifacts?
9. What are the token and infrastructure cost breakpoints where 1024+ dimensions become unjustifiable for LCS v1?
10. For hybrid retrieval (cross-reference RF-03/RF-04), does lower-dimensional dense retrieval recover quality when fused with sparse signals?
11. What failure modes appear at low vs high dimensions (hubness, semantic collapse, oversmoothing, noise amplification), and how can they be detected?
12. Should LCS adopt a single global dimension, per-artifact-type dimensions, or Matryoshka dynamic truncation at query time?

## Starting Sources
- Matryoshka Representation Learning — https://arxiv.org/abs/2205.13147
- OpenAI embeddings guide — https://platform.openai.com/docs/guides/embeddings
- OpenAI cookbook embedding example — https://github.com/openai/openai-cookbook/blob/main/examples/Get_embeddings_from_dataset.ipynb
- Voyage embeddings documentation — https://docs.voyageai.com/docs/embeddings
- MTEB leaderboard — https://huggingface.co/spaces/mteb/leaderboard
- MTEB benchmark repository — https://github.com/embeddings-benchmark/mteb
- FAISS documentation portal — https://faiss.ai/
- FAISS wiki (index/dimension tradeoffs) — https://github.com/facebookresearch/faiss/wiki
- ANN-Benchmarks — https://ann-benchmarks.com/
- Qdrant vector concepts — https://qdrant.tech/documentation/concepts/vectors/
- BEIR benchmark repository — https://github.com/beir-cellar/beir

## What to Measure, Compare, or Evaluate
- Retrieval quality by dimension: Recall@10/20, MRR@10, NDCG@10 on LCS-specific question sets (cross-reference EQ-04).
- End-to-end answer quality: grounded correctness + citation fidelity after RAG assembly (cross-reference RF-10, ADR-009 dependencies).
- Resource economics: bytes/vector, total RAM footprint, index build time, disk footprint, and per-query p50/p95 latency.
- Diminishing-return analysis: quality gain per additional 256 dimensions vs incremental infrastructure cost.
- Dimension x index interaction matrix: fixed dimension with varied HNSW and quantization settings.
- Matryoshka experiments: same base embedding truncated to multiple dimensions with shared index strategy.
- Sensitivity tests by artifact type: code-only queries, ADR rationale queries, mixed evidence queries.
- Stability tests under model updates: quality retention when re-embedding a subset with a newer model (handoff to EM-09 migration planning).

## Definition of Done
- A benchmark report compares all four dimension tiers under identical retrieval and evaluation protocols.
- A recommended default dimension for LCS v1 is selected with explicit rationale (quality, cost, latency).
- A secondary “budget mode” and “high-fidelity mode” dimension policy is defined.
- Matryoshka viability is explicitly accepted or rejected for LCS, with implementation implications.
- Failure-mode diagnostics and monitoring indicators are documented for production.
- ADR-003 receives concrete numeric thresholds and an experiment-backed decision narrative.

## How Findings Feed LCS Architecture Decisions
This research is a core input to ADR-003 model and vector strategy, and it constrains ADR-002 vector database sizing assumptions. It also affects ADR-009 context quality indirectly by determining baseline retrieval recall before reranking/packing, and provides migration risk inputs for EM-09 version-cutover design.
