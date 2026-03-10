# Research Prompt: RF-04 Score Fusion Methods

## Research Objective
Evaluate the mathematical and algorithmic methods for combining disparate relevance scores (e.g., semantic cosine similarity and lexical BM25 scores) into a single, highly accurate ranked list. The research must identify the most robust fusion algorithm for LCS's heterogeneous artifact types without requiring extensive, fine-tuned training data or introducing extreme latency.

## Research Questions
1. **Reciprocal Rank Fusion (RRF):** How exactly does RRF work? Provide the formula, explain the role of the constant `k` (typically 60), and explain why it is considered the robust, training-free standard baseline for score fusion.
2. **RRF Edge Cases:** What are the mathematical limitations of RRF? When does it fail to surface the most relevant documents? (e.g., how does it handle cases where a document is #1 in dense but #1000 in sparse?).
3. **Linear/Convex Combination:** How does Convex Combination (linear weighting) compare to RRF? Detail the mathematical process required to reliably normalize unbounded scores (like BM25) into a bounded range (0 to 1) before combining them with Cosine Similarity.
4. **CombSUM vs CombMNZ:** What are the CombSUM and CombMNZ algorithms? How do they work, and how does CombMNZ specifically account for the scenario where multiple retrieval systems return the *exact same* document (rewarding consensus)?
5. **Learned Fusion:** How do learned weighting systems or dynamically adjusted weights (e.g., using an LLM router or a small neural net to weight sparse vs dense based on the prompt's intent) perform compared to static algorithms? Is the complexity worth it?
6. **Pool Size Impact:** How does the size of the initial retrieval pool (`limit`) from the sub-systems impact the final sorted list in rank-based vs score-based fusion methods? If dense returns 100 and sparse returns 100, is the final RRF ranking accurate beyond the top 20?
7. **Database Native Fusion:** How do leading vector databases (Qdrant, Weaviate) handle fusion natively? Do they force RRF, or allow custom score combination formulas?
8. **Handling Missing Scores:** If using a score-based combination, and Document A is returned by the dense index but completely missing from the sparse index results, what is the mathematically correct way to assign its sparse score before fusion?
9. **Latency Overhead:** What is the computational cost of running these fusion algorithms over two arrays of 1,000 results in Node.js/Python?
10. **The Re-ranker Bypass:** If the top $K$ results from both systems are simply concatenated, deduplicated, and passed directly to a Cross-Encoder Re-ranker (*RF-05*), does that completely eliminate the need for a complex fusion algorithm?

## Sub-Topics to Explore
- Min-Max normalization vs Z-score normalization for BM25 scores.
- Borda Count method for rank aggregation.
- The impact of heavily skewed score distributions from dense embeddings.
- Implementations of RRF in Elasticsearch.

## Starting Sources
- **RRF Original Paper:** "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods" (Cormack et al., 2009) - https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- **Elastic RRF Documentation:** https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html
- **Weaviate Fusion Algorithms:** Relative Score Fusion vs RRF - https://weaviate.io/blog/hybrid-search-fusion-algorithms
- **Information Retrieval Literature:** Search for studies on CombSUM, CombMNZ, and data fusion in IR.
- **Qdrant Reciprocal Rank Fusion:** Check Qdrant docs for their specific implementation.
- **Paper:** "A Study of Score Normalization and Fusion in Information Retrieval" (or similar standard IR texts).
- **LangChain Ensemble Retriever Source:** Look at how LangChain implements `EnsembleRetriever` fusion in Python.

## What to Measure & Compare
- Write a Python/Node script simulating RRF. Compare the impact of the RRF constant on rank volatility: what happens to the top 10 rankings if `k=10` vs `k=60` vs `k=100` on a mock dataset?
- Contrast the theoretical Precision/Recall stability of rank-based fusion (RRF) vs normalized score-based fusion across datasets with wildly varying score scales.

## Definition of Done
A 3000-5000 word definitive, mathematically grounded recommendation on which fusion algorithm to implement for LCS's hybrid search. The document must include the exact formulas to be implemented in code and outline the required score normalization strategies if score-based fusion is recommended.

## Architectural Implication
Feeds into **ADR-002 (Vector DB Selection)**. It determines if we can rely on a Vector DB's native hybrid fusion or if LCS must pull raw results from multiple stores and manually execute the fusion algorithm in the application layer.