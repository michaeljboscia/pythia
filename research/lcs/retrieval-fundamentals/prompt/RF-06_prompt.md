# Research Prompt: RF-06 ColBERT and Late Interaction Retrieval

## Research Objective
Perform a deep dive into late interaction retrieval models, specifically ColBERT. Understand how token-level embeddings bypass the information bottleneck of single-vector embeddings, and assess the storage, computational costs, and implementation viability for the Living Corpus System (LCS).

## Research Questions
1. How does ColBERT's late interaction mechanism work? Explain MaxSim scoring and how it differs fundamentally from traditional single-vector dot-product/cosine similarity retrieval.
2. What is the storage footprint of storing per-token vectors (e.g., ColBERTv2) compared to standard single vectors? How do compression techniques (like residual compression) mitigate this?
3. How does ColBERT handle out-of-vocabulary terms, specific code syntax, and exact keyword matches compared to BM25?
4. Does ColBERT's superior performance on natural language benchmarks generalize effectively to source code and highly structured technical documents?
5. What is the operational complexity of deploying a ColBERT-compatible vector index? Evaluate the current state of ColBERT support in databases like Vespa, Qdrant, LanceDB, or dedicated PLAID indices.
6. What is the query latency difference between evaluating MaxSim across tokens versus a standard HNSW ANN search?

## Starting Sources
- **ColBERT Original Paper:** "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT" (Khattab & Zaharia, 2020) - https://arxiv.org/abs/2004.12832
- **ColBERTv2 Paper:** "ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction" (Santhanam et al., 2021) - https://arxiv.org/abs/2112.01488
- **Vespa ColBERT Implementation:** https://docs.vespa.ai/en/colbert.html
- **Qdrant Late Interaction Support:** https://qdrant.tech/articles/what-is-colbert/

## What to Measure & Compare
- Calculate the storage size ratio for a 100k document corpus: ColBERTv2 index vs. standard 768d dense index vs. BM25 inverted index.
- Compare query latency of MaxSim operations versus HNSW ANN search at scale.

## Definition of Done
A critical, highly technical assessment of late interaction retrieval. It must determine whether ColBERT is the "silver bullet" for high-fidelity codebase retrieval or an over-engineered storage hog. The document must conclude with a firm decision on whether to pursue ColBERT for LCS v1 or stick to a traditional Hybrid + Re-ranker pipeline.

## Architectural Implication
This research heavily influences **ADR-003 (Embedding Model Strategy)**. If late interaction is chosen, it completely alters the index storage requirements, database selection (likely forcing Vespa or LanceDB over standard Postgres/Qdrant setups), and ingestion pipeline.