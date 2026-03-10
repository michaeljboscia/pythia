# Research Prompt: RF-06 ColBERT and Late Interaction Retrieval

## Research Objective
Perform a deep, highly critical dive into late interaction retrieval models, specifically ColBERT. Understand how storing per-token embeddings bypasses the "information bottleneck" of single-vector embeddings, and assess the severe storage, computational, and architectural costs to determine if its viability for the Living Corpus System (LCS) outweighs its complexity.

## Research Questions
1. **The Information Bottleneck:** Why does compressing a 500-word paragraph into a single 768-dimensional vector inherently destroy nuance? How does ColBERT's late interaction mechanism solve this structurally?
2. **MaxSim Scoring:** Explain the MaxSim scoring algorithm mechanically. How does computing the similarity between every token in the query and every token in the document differ fundamentally from traditional single-vector dot-product search?
3. **Storage Explosion:** What is the exact storage footprint multiplier of storing per-token vectors (e.g., ColBERTv2) compared to standard single vectors? How do residual compression techniques (quantization, centroids) mitigate this, and is it enough?
4. **Code and Syntax Efficacy:** How does ColBERT handle out-of-vocabulary terms, specific code syntax, and exact keyword matches compared to BM25? Does storing token-level semantics naturally solve the "exact match" problem that plagues single vectors?
5. **Database Implementations:** What is the operational complexity of deploying a ColBERT-compatible vector index? Evaluate the current state of ColBERT support in databases like Vespa, Qdrant (Late Interaction), LanceDB, or dedicated PLAID indices.
6. **Query Latency Profile:** What is the query latency difference between evaluating MaxSim across thousands of tokens versus a standard HNSW ANN search? How does the PLAID engine speed this up?
7. **ColBERT vs Re-rankers:** Is ColBERT essentially just a Cross-Encoder (*RF-05*) pushed down into the database layer? Compare the retrieval quality and latency of [ColBERT End-to-End] versus [Bi-Encoder + Cross-Encoder Reranker].
8. **Context Window Limitations:** What are the max chunk sizes (*RF-09*) supported by ColBERT models? Does token-level embedding force significantly smaller chunk sizes to remain performant?
9. **Index Rebuilding:** Given the massive size of a ColBERT index, how long does it take to incrementally update (*DM-05*) or rebuild the index when files change compared to standard embeddings?
10. **Jina ColBERT v2:** Analyze recent implementations like `jina-colbert-v2`. Do they offer a more accessible, API-driven or quantized local approach that lowers the barrier to entry?

## Sub-Topics to Explore
- The PLAID (Performance-optimized Late Interaction via Asynchronous Infrastructure Design) algorithm.
- Binarized token vectors for extreme compression.
- Qdrant's recent native support for "Late Interaction Vectors".
- Tradeoffs between multi-vector routing (*EM-07*) and late interaction.

## Starting Sources
- **ColBERT Original Paper:** "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT" (Khattab & Zaharia, 2020) - https://arxiv.org/abs/2004.12832
- **ColBERTv2 Paper:** "ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction" (Santhanam et al., 2021) - https://arxiv.org/abs/2112.01488
- **PLAID Paper:** "PLAID: An Efficient Engine for Late Interaction Retrieval" - https://arxiv.org/abs/2205.09707
- **Vespa ColBERT Implementation:** https://docs.vespa.ai/en/colbert.html
- **Qdrant Late Interaction Support:** https://qdrant.tech/articles/what-is-colbert/
- **Jina ColBERT Announcement:** https://jina.ai/news/jina-colbert-v2/
- **RAGatouille (ColBERT framework):** https://github.com/bclavie/RAGatouille

## What to Measure & Compare
- Calculate the exact storage size (in MB/GB) for a 100,000 document corpus (assuming 500 tokens per document) using: (A) standard 768d dense vectors, (B) Uncompressed ColBERT, (C) ColBERTv2 with residual compression.
- Compare query latency of MaxSim operations versus HNSW ANN search at a 50k document scale based on available benchmarks.

## Definition of Done
A 3000-5000 word critical, highly technical assessment of late interaction retrieval. It must determine whether ColBERT is the "silver bullet" for high-fidelity codebase retrieval or an over-engineered storage hog unsuitable for a local daemon. The document must conclude with a firm decision on whether to pursue ColBERT for LCS v1 or stick to a traditional Hybrid + Re-ranker pipeline.

## Architectural Implication
This research heavily influences **ADR-003 (Embedding Model Strategy)** and **ADR-002 (Vector DB Selection)**. If late interaction is chosen, it completely alters the index storage requirements, mandates specific databases (forcing Vespa, Qdrant, or LanceDB over standard Postgres setups), and vastly increases the IO load of the ingestion pipeline.