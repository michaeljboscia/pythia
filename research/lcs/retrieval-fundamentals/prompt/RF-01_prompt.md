# Research Prompt: RF-01 Dense Retrieval Fundamentals

## Research Objective
Deeply understand the mechanics of dense retrieval, moving beyond surface-level API usage to grasp the mathematics of embeddings, Approximate Nearest Neighbor (ANN) search, and specifically the HNSW algorithm. This foundational knowledge is required to make informed, defensible decisions about vector database configurations, embedding model constraints, and indexing strategies for the Living Corpus System (LCS).

## Research Questions
1. **Embedding Mathematics:** What exactly does an embedding vector capture mathematically? Explain the concept of a "latent space." How do different embedding architectures (e.g., bi-encoders) optimize this space differently for source code versus natural language prose?
2. **The Curse of Dimensionality:** How does vector dimensionality (e.g., 384 vs 768 vs 1536) geometrically affect the density of the vector space (*EM-06*)? At what point do distance metrics break down, and how does the likelihood of "hubness" (where a few vectors are inexplicably close to everything) increase with dimension size?
3. **Similarity Metrics:** What are the mathematical and practical differences—in terms of computational speed, accuracy, and memory footprint—between Cosine Similarity, Dot Product, and L2 (Euclidean) distance? When is one strictly preferred over the others based on how the vectors were trained/normalized?
4. **HNSW Algorithm Deep Dive:** How does the HNSW (Hierarchical Navigable Small World) algorithm work under the hood? Detail the construction phase versus the search phase. Explain the specific roles and tradeoffs of the `m` (maximum number of outgoing connections) and `ef_construction` (size of the dynamic candidate list) parameters (*VD-07*).
5. **Exact vs Approximate Search:** Why is exact k-Nearest Neighbors (k-NN) mathematically impossible to scale? At what exact corpus size (number of vectors) does the latency of exact search become unacceptable for an interactive MCP server, forcing the switch to ANN?
6. **Vector Quantization (VQ):** How do vector quantization techniques (Scalar Quantization, Product Quantization, Binary Quantization) compress the memory footprint of an index? What is the measured impact on recall/precision at the 50K-100K document scale when compressing `float32` to `int8` or binary?
7. **Failure Modes on Code:** In a heterogeneous corpus (code chunks, markdown docs, API logs), what are the common failure modes of dense retrieval? Why do embeddings frequently fail on exact UUID matches, specific variable names, or rare syntactical structures?
8. **Out-of-Vocabulary (OOV) Terms:** How do the tokenizers underlying dense embedding models handle completely novel, project-specific terminology (e.g., a newly invented domain acronym)? Does the embedding degrade gracefully or fail completely?
9. **Filtering during ANN:** How do modern vector databases handle metadata filtering *during* an HNSW search (e.g., "Find this vector, but only where `author=mike`")? Explain pre-filtering vs post-filtering and the risk of "result starvation" in ANN.
10. **Memory Footprint Calculation:** Formulate the exact mathematical equation to calculate the raw RAM requirement for a vector index based on vector count, dimension size, data type (`f32`), and HNSW overhead.

## Sub-Topics to Explore
- The "Hubness" problem in high-dimensional spaces.
- Pre-filtering vs Post-filtering vs Single-Stage filtering in Vector DBs.
- The difference between normalized and un-normalized vectors (and how it affects Dot Product vs Cosine).
- HNSW graph entry point selection.

## Starting Sources
- **HNSW Original Paper:** "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs" (Malkov & Yashunin) - https://arxiv.org/abs/1610.02415
- **Faiss Documentation & Wiki:** Facebook AI Research - https://github.com/facebookresearch/faiss/wiki
- **Qdrant Indexing Docs:** https://qdrant.tech/documentation/concepts/indexing/
- **Pinecone Vector Similarity Guide:** https://www.pinecone.io/learn/vector-similarity/
- **ANN-Benchmarks:** http://ann-benchmarks.com/
- **Paper:** "A Comprehensive Survey and Experimental Comparison of Graph-Based Approximate Nearest Neighbor Search" - https://arxiv.org/abs/2101.12631
- **Understanding Quantization:** https://weaviate.io/blog/pq-rescoring
- **The Hubness Problem:** Search for literature on "Hubness in high dimensional data retrieval."

## What to Measure & Compare
- Calculate the exact RAM footprint requirements for 100,000 vectors at 384d, 768d, and 1536d using uncompressed flat indexing versus an HNSW index with `m=16` and `ef_construction=100`.
- Create a matrix comparing the computational complexity (Big O notation) of Exact k-NN vs HNSW during both the index-building phase and the query phase.

## Definition of Done
A 3000-5000 word comprehensive markdown report explaining the exact mechanics of dense retrieval. It must include a clear, accessible explanation of HNSW graph construction, a matrix comparing similarity metrics, mathematical calculations for memory sizing, and an explicit breakdown of why dense retrieval fails on code artifacts.

## Architectural Implication
This research directly feeds **ADR-002 (Vector DB Selection)** by establishing baseline memory and algorithmic requirements, and **ADR-003 (Embedding Model Strategy)** by explaining the mechanical impact of dimensionality and vector similarity. It sets the technical baseline for why LCS cannot rely on dense embeddings alone.