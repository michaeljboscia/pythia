# Research Prompt: RF-05 Re-ranking with Cross-Encoders

## Research Objective
Analyze the necessity, computational cost, and latency impact of using cross-encoder models for re-ranking retrieved results. This research will determine if LCS requires a dedicated re-ranking step to achieve acceptable precision, whether to use local or API-based models, and how cross-encoders bridge the semantic gap left by bi-encoders.

## Research Questions
1. **Bi-encoder vs Cross-encoder Architecture:** What is the fundamental architectural difference between a bi-encoder (used for initial vector retrieval) and a cross-encoder (used for re-ranking)? Explain why cross-encoders are significantly more accurate but mathematically impossible to use for searching an entire corpus.
2. **Performance Delta:** How much does a cross-encoder re-ranker actually improve MRR (Mean Reciprocal Rank) and NDCG@10 compared to an optimized bi-encoder or hybrid baseline? Quantify the "bump" in relevance.
3. **Local vs API Models:** Compare top local open-source models (like `BAAI/bge-reranker-v2-m3` or `cross-encoder/ms-marco-MiniLM-L-6-v2`) against commercial API models (like Cohere Rerank V3). What is the latency and quality tradeoff?
4. **Latency Budget:** What is the exact latency cost of re-ranking the top-K results (e.g., K=50, 100, 200) using a local model on CPU vs a local model on Mac M-series Metal vs calling the Cohere API?
5. **Code Generalization:** Do general-purpose cross-encoders generalize well to source code, logs, and technical architecture documents, or do they struggle with syntax-heavy text? Are there specific code-trained re-rankers?
6. **Pool Size Optimization:** What is the optimal initial retrieval size (top-K) to pass to a re-ranker to maximize recall while keeping total search latency under 500ms? How does this curve degrade?
7. **Context Window Limits:** Cross-encoders concatenate the query and the document `[CLS] Query [SEP] Document [SEP]`. What happens if the document chunk (*RF-09*) plus the query exceeds the cross-encoder's context limit (often strictly 512 tokens)?
8. **The Fusion Bypass:** Does feeding the concatenated top-K results from a dense index and a sparse index directly into a cross-encoder negate the need for complex mathematical score fusion algorithms like RRF (*RF-04*)?
9. **Multi-hop QA implications:** Can a cross-encoder evaluate the relevance of a *subgraph* (a central node and its immediate neighbors) rather than just a flat text chunk?
10. **LLM as a Judge (Zero-shot Re-ranking):** Compare the speed and accuracy of using a specialized cross-encoder versus simply asking a fast LLM (like Claude 3 Haiku or Gemini Flash) to score the relevance of the top 20 documents.

## Sub-Topics to Explore
- SentenceTransformers library architecture for Cross-Encoders.
- Late Interaction models (ColBERT - *RF-06*) as an alternative to Cross-Encoders.
- Jina AI's reranker models and API.
- Handling long documents with overlapping sliding windows during re-ranking.

## Starting Sources
- **SentenceTransformers Retrieve & Re-Rank:** https://www.sbert.net/examples/applications/retrieve_rerank/README.html
- **BAAI BGE Reranker Reports:** HuggingFace documentation for `BAAI/bge-reranker-v2-m3` - https://huggingface.co/BAAI/bge-reranker-v2-m3
- **Cohere Rerank V3 Paper/Blog:** https://cohere.com/blog/rerank-3
- **Jina Reranker Release Notes:** https://jina.ai/news/jina-reranker-v1-turbo/
- **Paper:** "Pretrained Transformers for Text Ranking: BERT and Beyond" - https://arxiv.org/abs/2010.06467
- **LlamaIndex Node Postprocessors:** How LlamaIndex integrates rerankers in the pipeline - https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/

## What to Measure & Compare
- Hardware metrics: Estimate or measure the CPU latency (in milliseconds) of re-ranking 100 document chunks (of 500 tokens each) against a single query using a local BGE model on standard consumer hardware.
- Network metrics: Calculate the API latency, token consumption, and cost of re-ranking those same 100 documents via the Cohere Rerank API.
- Measured boost in Recall@10 / MRR when using a re-ranker on technical or code-heavy datasets based on available public benchmarks.

## Definition of Done
A 3000-5000 word practical tradeoff matrix of latency versus accuracy for re-rankers. The document must conclude with a concrete recommendation on whether LCS needs a re-ranker in v1, which specific model (local vs API) to use, and the mathematically optimal top-K pool size to forward to it without breaking latency budgets.

## Architectural Implication
Feeds into **ADR-002 (Vector DB Selection)** and the core retrieval pipeline architecture. Decides if our retrieval pipeline is a 2-stage (Retrieve -> Format) or 3-stage (Retrieve -> Re-rank -> Format) process, heavily impacting compute requirements and system latency.