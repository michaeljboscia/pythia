# Research Prompt: RF-03 Hybrid Retrieval

## Research Objective
Explore the mechanics and performance benefits of hybrid retrieval (combining dense vector search and sparse lexical search). The aim is to quantify the "best of both worlds" advantage, map out the failure modes it resolves, and determine the necessity of a hybrid approach for LCS's heterogeneous corpus.

## Research Questions
1. Why does hybrid retrieval consistently outperform dense-only or sparse-only approaches across diverse datasets (specifically referencing BEIR benchmark evidence)?
2. What are the distinct failure modes of dense retrieval and sparse retrieval that hybrid search successfully mitigates?
3. In a multi-artifact corpus (code, documentation, PRs, architecture decisions), how do query patterns determine the reliance on dense vs. sparse retrieval (e.g., "how does auth work" vs. "where is AuthTokenProvider instantiated")?
4. What are the infrastructure implications of implementing hybrid search? Is it better to use a single unified datastore (like Qdrant) or to federate queries across two specialized stores (e.g., Elastic + single-purpose Vector DB)?
5. How does the performance and query latency scale as the corpus grows, considering two separate retrieval algorithms must execute before fusion?
6. Are there specific scenarios or document types where adding sparse search to dense search actually *degrades* the relevance of the top 5 results?

## Starting Sources
- **BEIR Benchmark Paper:** "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models" - https://arxiv.org/abs/2104.08663
- **Pinecone Hybrid Search Guide:** https://www.pinecone.io/learn/hybrid-search-intro/
- **Weaviate Hybrid Search Explanation:** https://weaviate.io/blog/hybrid-search-explained
- **Cohere / Qdrant Hybrid implementations:** Review their respective engineering blogs on combining SPLADE/BM25 with dense vectors.

## What to Measure & Compare
- Extract and compare the exact recall improvement metrics (Recall@10, NDCG@10) of Hybrid versus Dense-only and Sparse-only on the BEIR benchmark.
- Measure or estimate the query latency overhead of executing both search paths and merging the results versus a single dense search.

## Definition of Done
An empirical summary demonstrating the necessity (or lack thereof) of hybrid retrieval for LCS, backed by specific benchmark data. The report must include a clear architectural recommendation regarding single-store vs. dual-store indexing for achieving hybrid search.

## Architectural Implication
This research dictates the core querying mechanism of LCS and directly feeds **ADR-002 (Vector DB Selection)**. It determines if the chosen database must natively support hybrid search or if LCS must handle orchestration and fusion externally.