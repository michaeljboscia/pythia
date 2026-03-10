# Research Prompt: RF-01 Dense Retrieval Fundamentals

## Research Objective
Deeply understand the mechanics of dense retrieval, including embeddings, Approximate Nearest Neighbor (ANN) search, the HNSW algorithm, and how vector similarity actually works. This foundational knowledge is required to make informed decisions about vector database configurations, embedding model constraints, and indexing strategies for the Living Corpus System (LCS).

## Research Questions
1. What exactly does an embedding vector capture mathematically, and how do different models optimize their latent spaces for source code versus natural language prose?
2. How does the HNSW (Hierarchical Navigable Small World) algorithm work under the hood? Explain the specific roles of the `m` (maximum number of outgoing connections) and `ef_construction` (size of the dynamic candidate list) parameters.
3. What are the practical differences—in terms of speed, accuracy, and memory footprint—between Cosine Similarity, Dot Product, and L2 (Euclidean) distance? When is one strictly preferred over the others?
4. How do vector quantization techniques (Scalar, Product Quantization, Binary) reduce memory footprint, and what is the measured impact on recall/precision at the 50K-100K document scale?
5. In a heterogeneous corpus (code chunks, markdown docs, API logs), what are the common failure modes of dense retrieval (e.g., exact matches, specific IDs, rare keywords) and why do they happen?
6. How does vector dimensionality (e.g., 384 vs 768 vs 1536) geometrically affect the density of the vector space and the likelihood of "hubness" (where a few vectors are close to everything)?

## Starting Sources
- **HNSW Paper:** "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs" (Malkov & Yashunin) - https://arxiv.org/abs/1610.02415
- **Faiss Documentation:** Facebook AI Research Faiss Wiki - https://github.com/facebookresearch/faiss/wiki
- **Qdrant Indexing Docs:** https://qdrant.tech/documentation/concepts/indexing/
- **Understanding Vector Similarity:** Pinecone guide on vector similarity - https://www.pinecone.io/learn/vector-similarity/

## What to Measure & Compare
- Calculate the raw RAM footprint requirements for 100,000 vectors at 384d, 768d, and 1536d using uncompressed flat indexing versus HNSW.
- Compare latency vs. recall tradeoffs when tuning HNSW parameters (`ef_construction` values of 64, 128, 256).

## Definition of Done
A comprehensive markdown report explaining the exact mechanics of dense retrieval. It must include a clear, accessible explanation of HNSW graph construction, a matrix comparing similarity metrics, and mathematical calculations showing the memory cost of scaling vector dimensions and corpus size for LCS.

## Architectural Implication
This research directly feeds **ADR-002 (Vector DB Selection)** by establishing baseline memory and algorithmic requirements, and **ADR-003 (Embedding Model Strategy)** by explaining the mechanical impact of dimensionality and vector similarity.