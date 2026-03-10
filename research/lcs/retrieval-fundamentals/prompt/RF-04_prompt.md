# Research Prompt: RF-04 Score Fusion Methods

## Research Objective
Evaluate mathematical and algorithmic methods for combining relevance scores from disparate retrieval systems (e.g., dense and sparse results) into a single ranked list. The research must identify the most robust fusion algorithm for heterogeneous artifact types in LCS without requiring extensive, fine-tuned training data.

## Research Questions
1. How exactly does Reciprocal Rank Fusion (RRF) work? Provide the formula, and explain why it is considered the robust standard baseline for score fusion.
2. What are the mathematical limitations and edge cases of RRF? When does it fail to surface the most relevant documents?
3. How does Convex Combination (linear weighting) compare to RRF? How do you reliably normalize unbounded scores (e.g., BM25) and bounded scores (e.g., Cosine Similarity) before combining them?
4. What is CombMNZ, how does it work, and how does it specifically account for the scenario where multiple retrieval systems return the *exact same* document?
5. How do learned weighting or dynamically adjusted weights (e.g., using an LLM router to weight sparse vs dense based on the prompt) perform compared to static RRF?
6. How does the size of the initial retrieval pool (`k`) impact the final sorted list in rank-based vs score-based fusion methods?

## Starting Sources
- **RRF Original Paper:** "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods" (Cormack et al., 2009) - https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- **Elastic RRF Documentation:** https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html
- **Weaviate Fusion Algorithms:** Relative Score Fusion vs RRF - https://weaviate.io/blog/hybrid-search-fusion-algorithms
- **Information Retrieval literature on CombSUM and CombMNZ.**

## What to Measure & Compare
- Compare the impact of the RRF constant (typically `k=60`) on rank volatility. What happens to the top 10 if `k=10` vs `k=100`?
- Contrast the Precision/Recall metrics of rank-based fusion (RRF) vs score-based fusion (Convex Combination) on standardized IR datasets.

## Definition of Done
A definitive, mathematically grounded recommendation on which fusion algorithm to implement for LCS's hybrid search. The document must include the exact formulas to be implemented in code and outline the required score normalization strategies if score-based fusion is recommended.

## Architectural Implication
Feeds into **ADR-002 (Vector DB Selection)**. It determines if we can rely on a Vector DB's native hybrid fusion (e.g., Qdrant's implementation) or if LCS must pull raw results and manually execute the fusion algorithm in Node.js/Python.