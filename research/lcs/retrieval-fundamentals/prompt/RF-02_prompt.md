# Research Prompt: RF-02 Sparse Retrieval — BM25 and TF-IDF

## Research Objective
Investigate sparse retrieval techniques with a heavy focus on BM25, TF-IDF, and inverted index structures. The goal is to deeply understand when, how, and why exact-keyword search outperforms semantic search, especially in the context of querying codebases where precise function names, variable scopes, UUIDs, and error codes are critical to context retrieval.

## Research Questions
1. **Algorithm Breakdown:** How does the BM25 scoring algorithm calculate relevance mathematically? Deconstruct the formula, specifically explaining the impact of length normalization (`b`) and term frequency saturation (`k1`). How does BM25 solve the "long document bias" present in pure term frequency?
2. **TF-IDF vs BM25:** How does TF-IDF differ mechanically from BM25 in practice? Why has BM25 universally replaced TF-IDF as the standard baseline for lexical search in engines like Lucene and Elasticsearch?
3. **Inverted Index Architecture:** Explain the data structure of an inverted index. How does it store terms, document IDs, and term frequencies? How are boolean queries (AND/OR/NOT) executed against an inverted index?
4. **Tokenization for Code:** How do tokenization strategies (stemming, lemmatization, stop-word removal, BPE) impact sparse retrieval performance specifically for source code? Why do standard English analyzers fail on `camelCase`, `snake_case`, and symbol-heavy syntax like `Array<string>`?
5. **The Semantic Blindspot:** In what specific retrieval scenarios does BM25 consistently and provably beat dense vector search (*RF-03*)? Detail the failure modes of semantic search that BM25 catches.
6. **SPLADE and Sparse Neural Vectors:** What is SPLADE (Sparse Lexical and Expansion Model)? How do neural sparse vectors differ from traditional BM25 inverted indexes, and do they offer a better bridge between lexical and semantic search?
7. **Database Implementations:** How do modern vector databases (like Qdrant, Milvus, or LanceDB) implement sparse retrieval alongside dense retrieval? Are they using true Lucene-style inverted indexes, or sparse vector approximations?
8. **Storage Overhead:** What is the computational and storage overhead of maintaining a real-time inverted index alongside a dense vector index for a 100k document dataset?
9. **Handling Synonyms:** BM25 relies on exact overlap. How do sparse retrieval systems handle synonyms (e.g., "auth" vs "authentication") without falling back to dense embeddings?
10. **Tuning BM25:** If BM25 is implemented, how should the `k1` and `b` parameters be tuned for a codebase versus a collection of markdown documents?

## Sub-Topics to Explore
- The probabilistic relevance framework (the theory behind BM25).
- n-gram tokenization for partial substring matching in code (e.g., finding `Auth` inside `useAuthenticationToken`).
- Elasticsearch/Lucene internal scoring algorithms.
- SPLADE vs BM25 benchmarks on technical datasets.

## Starting Sources
- **BM25 Core Paper:** "The Probabilistic Relevance Framework: BM25 and Beyond" (Robertson & Zaragoza) - https://dl.acm.org/doi/10.1561/1500000019
- **Elasticsearch BM25 tuning:** https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables
- **Lucene Inverted Index Docs:** https://lucene.apache.org/core/
- **SPLADE Paper:** "SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking" - https://arxiv.org/abs/2107.05720
- **Qdrant Sparse Vectors Docs:** https://qdrant.tech/documentation/concepts/sparse-vectors/
- **BEIR Benchmark Paper:** "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models" - https://arxiv.org/abs/2104.08663 (Analyze the sparse vs dense performance comparisons).
- **Postgres pg_trgm and tsvector:** How Postgres handles text search natively.
- **Blog:** "Why semantic search is not enough" (Search for general IR literature on the necessity of keywords).

## What to Measure & Compare
- Compare the Recall@10 of BM25 versus Dense embeddings specifically on exact-match queries (e.g., UUIDs, specific error codes, camelCase function names) using available benchmarks (e.g., CodeSearchNet).
- Quantify the index size overhead (in MB/GB) of creating an inverted index representation versus a 768d dense vector index for a standard 100k document dataset.

## Definition of Done
A 3000-5000 word detailed technical document that breaks down the BM25 formula, maps out the exact limitations of semantic search for code/symbols, evaluates modern sparse implementation options in vector DBs, and dictates the specific tokenization strategy required for LCS source code.

## Architectural Implication
This research heavily feeds **ADR-002 (Vector DB Selection)** by dictating whether our chosen database must natively support BM25/sparse vectors, or if we need a dual-database architecture (e.g., maintaining a local SQLite FTS5 index alongside a vector index).