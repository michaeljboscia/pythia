# Research Prompt: RF-05 Re-ranking with Cross-Encoders

## Research Objective
Analyze the necessity, cost, and latency impact of using cross-encoder models for re-ranking retrieved results. This research will determine if LCS requires a dedicated re-ranking step to achieve acceptable precision, and whether to use local or API-based models.

## Research Questions
1. What is the fundamental architectural difference between a bi-encoder (embedding model) and a cross-encoder (re-ranker)? Why are cross-encoders significantly more accurate but computationally heavier?
2. How much does a cross-encoder re-ranker improve MRR (Mean Reciprocal Rank) and NDCG@10 compared to an optimized bi-encoder baseline?
3. What is the latency cost of re-ranking the top-K results (e.g., K=50, 100, 200) using local open-source models (like BAAI/bge-reranker-base) versus API models (like Cohere Rerank V3)?
4. Do general-purpose re-rankers generalize well to source code, logs, and technical architecture documents, or do they struggle with syntax-heavy text?
5. What is the optimal initial retrieval size (top-K) to pass to a re-ranker to maximize recall while keeping total search latency under 500ms?
6. Does adding a re-ranking step negate the need for complex, heavily-tuned hybrid search fusion (e.g., just passing top K from dense and top K from sparse directly to the re-ranker)?

## Starting Sources
- **SentenceTransformers Retrieve & Re-Rank:** https://www.sbert.net/examples/applications/retrieve_rerank/README.html
- **BAAI BGE Reranker Reports:** HuggingFace documentation for `BAAI/bge-reranker-v2-m3` - https://huggingface.co/BAAI/bge-reranker-v2-m3
- **Cohere Rerank V3 Paper/Blog:** https://cohere.com/blog/rerank-3
- **Jina Reranker Release Notes:** https://jina.ai/news/jina-reranker-v1-turbo/

## What to Measure & Compare
- Hardware metrics: CPU vs GPU latency (in milliseconds) of re-ranking 100 documents using a local BGE model.
- Network metrics: API latency and cost of re-ranking 100 documents via the Cohere Rerank API.
- Measured boost in Recall@10 / MRR when using a re-ranker on technical or code-heavy datasets (if available in public benchmarks).

## Definition of Done
A practical tradeoff matrix of latency versus accuracy for re-rankers, concluding with a concrete recommendation on whether LCS needs a re-ranker in v1, which specific model (local vs API) to use, and the optimal top-K pool size to forward to it.

## Architectural Implication
Feeds into **ADR-002 (Vector DB Selection)** and the core retrieval pipeline architecture. Decides if our retrieval pipeline is a 2-stage (Retrieve -> Format) or 3-stage (Retrieve -> Re-rank -> Format) process, heavily impacting latency budgets.