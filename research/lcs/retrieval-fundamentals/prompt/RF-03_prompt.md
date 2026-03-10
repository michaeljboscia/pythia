# Research Prompt: RF-03 Hybrid Retrieval — Dense + Sparse Fusion

## Research Objective
Explore the mechanics, performance benefits, and architectural implications of hybrid retrieval (combining dense vector search and sparse lexical search). The aim is to quantify the "best of both worlds" advantage, map out the specific failure modes it resolves, and determine the structural necessity of a hybrid approach for LCS's heterogeneous corpus.

## Research Questions
1. **The Core Hypothesis:** Why does hybrid retrieval consistently outperform dense-only or sparse-only approaches across diverse, zero-shot datasets? Reference specific evidence from the BEIR benchmark.
2. **Complementary Strengths:** What are the distinct, non-overlapping failure modes of dense retrieval (*RF-01*) and sparse retrieval (*RF-02*) that hybrid search successfully mitigates? Provide examples of queries that would fail in one but succeed in the other.
3. **Query Intent Routing:** In a multi-artifact corpus (code, documentation, PRs, architecture decisions), do certain query patterns favor one system over the other? (e.g., "explain how auth works" [semantic] vs. "where is `AuthTokenProvider` instantiated" [lexical]). Should the system dynamically route or always hybridize?
4. **Infrastructure Implications:** What are the architectural tradeoffs of implementing hybrid search? Is it definitively better to use a single unified datastore that supports both (like Qdrant or Weaviate) or to federate queries across two specialized stores (e.g., SQLite FTS5 + LanceDB) and fuse them in application code?
5. **Latency Scaling:** How does query latency scale as the corpus grows, considering two separate retrieval algorithms (HNSW + Inverted Index) must execute, return results, and fuse before responding?
6. **Degradation Scenarios:** Are there specific scenarios or document types where adding sparse search to dense search actually *degrades* the relevance of the top 5 results? How do you prevent "keyword noise" from drowning out strong semantic matches?
7. **Score Normalization:** BM25 scores are unbounded (can be any positive number), while Cosine Similarity is bounded (usually -1 to 1 or 0 to 1). How do hybrid systems mathematically normalize these entirely different scales before fusing them (*RF-04*)?
8. **Search Result Pool Sizes:** To get an accurate hybrid top-10, how many results must be retrieved from the dense index and the sparse index respectively before fusion? (e.g., retrieve top 100 from both, fuse, return top 10).
9. **Dense vs Sparse Weighting:** How do systems handle alpha weighting (e.g., `score = alpha * dense + (1 - alpha) * sparse`)? Is there a universal alpha that works for code + prose, or must it be dynamically adjusted?
10. **The Role of Re-rankers:** Does adding a Cross-Encoder Re-ranker (*RF-05*) after the hybrid fusion step solve all weighting issues, rendering the initial fusion algorithm less critical?

## Sub-Topics to Explore
- Convex combination algorithms for score weighting.
- Alpha parameter tuning in Elasticsearch/Weaviate.
- The "Out-of-Domain" generalization problem of dense models and how sparse retrieval fixes it.
- SPLADE as an alternative to two separate indexes.

## Starting Sources
- **BEIR Benchmark Paper:** "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models" - https://arxiv.org/abs/2104.08663
- **Pinecone Hybrid Search Guide:** https://www.pinecone.io/learn/hybrid-search-intro/
- **Weaviate Hybrid Search Explained:** https://weaviate.io/blog/hybrid-search-explained
- **Cohere Hybrid Search Blog:** https://cohere.com/blog/hybrid-search
- **Elasticsearch Hybrid Search Docs:** https://www.elastic.co/guide/en/elasticsearch/reference/current/knn-search.html#knn-semantic-search
- **Qdrant Hybrid Search Implementation:** https://qdrant.tech/articles/hybrid-search/
- **Paper:** "A Dense-Sparse Hybrid Search Architecture for Information Retrieval" (Search for relevant academic literature on fusion).
- **Vespa Hybrid Search documentation.**

## What to Measure & Compare
- Extract and compare the exact recall improvement metrics (Recall@10, NDCG@10) of Hybrid versus Dense-only and Sparse-only on at least 3 distinct BEIR datasets (e.g., MS MARCO, SciFact, FiQA).
- Estimate the query latency overhead of executing both search paths and merging the results versus a single dense search using Qdrant's published benchmarks.

## Definition of Done
A 3000-5000 word empirical summary demonstrating the necessity (or lack thereof) of hybrid retrieval for LCS, backed by specific benchmark data. The report must include a clear architectural recommendation regarding single-store vs. dual-store indexing (*VD-01*, *VD-02*) for achieving hybrid search.

## Architectural Implication
This research dictates the core querying mechanism of LCS and directly feeds **ADR-002 (Vector DB Selection)**. It determines if the chosen database must natively support hybrid search, or if LCS must handle orchestration and fusion externally.