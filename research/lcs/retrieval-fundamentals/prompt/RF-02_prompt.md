# Research Prompt: RF-02 Sparse Retrieval (BM25)

## Research Objective
Investigate sparse retrieval techniques with a heavy focus on BM25, TF-IDF, and inverted index structures. The goal is to deeply understand when, how, and why exact-keyword search outperforms semantic search, especially in the context of querying codebases where precise function names, variable scopes, and error codes are critical.

## Research Questions
1. How does the BM25 scoring algorithm calculate relevance mathematically? Breakdown the formula, specifically explaining the impact of length normalization (`b`) and term frequency saturation (`k1`).
2. In what specific retrieval scenarios does BM25 consistently and provably beat dense vector search? 
3. How do tokenization strategies (stemming, lemmatization, BPE/subword tokenization) impact sparse retrieval performance specifically for source code (e.g., camelCase, snake_case, symbol-heavy syntax)?
4. What are the computational and storage overheads of maintaining a real-time inverted index alongside a dense vector index?
5. How do modern vector databases (like Qdrant, Milvus, or LanceDB) implement sparse retrieval? Are they using true BM25 inverted indexes, or sparse vector approximations (like SPLADE)?
6. How does TF-IDF differ from BM25 in practice, and why has BM25 become the standard baseline for lexical search?

## Starting Sources
- **BM25 Core Paper:** "The Probabilistic Relevance Framework: BM25 and Beyond" (Robertson & Zaragoza) - https://dl.acm.org/doi/10.1561/1500000019
- **Elasticsearch BM25 tuning:** https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables
- **BEIR Benchmark Paper:** "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models" - https://arxiv.org/abs/2104.08663 (Analyze the sparse vs dense performance comparisons).
- **Qdrant Sparse Vectors Docs:** https://qdrant.tech/documentation/concepts/sparse-vectors/

## What to Measure & Compare
- Compare the Recall@10 of BM25 versus Dense embeddings specifically on exact-match queries (e.g., UUIDs, specific error codes, camelCase function names).
- Quantify the index size overhead (in MB/GB) of creating an inverted index representation versus a dense vector index for a standard 100k document dataset.

## Definition of Done
A detailed technical document that breaks down the BM25 formula variable by variable, maps out the exact limitations of semantic search for code/symbols, evaluates modern sparse implementation options in vector DBs, and dictates the tokenization strategy required for LCS source code.

## Architectural Implication
This research heavily feeds **ADR-002 (Vector DB Selection)** by dictating whether our chosen database must support true native BM25 inverted indexes, sparse vectors, or if we need a dual-database architecture (e.g., Postgres/Elastic + Qdrant).