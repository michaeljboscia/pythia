# Research Prompt: NL-02 Semantic Textual Similarity Beyond Cosine (P1)

## Research Objective
Establish a robust similarity strategy for LCS retrieval/reranking by comparing cosine similarity on embeddings with cross-encoder and hybrid scoring methods. The study must identify where cosine fails (semantic asymmetry, lexical traps, context dependence) and define practical mitigation patterns. Findings feed ADR-003 and should cross-reference RF-01, RF-05, and EM-06.

## Research Questions
1. What assumptions make cosine similarity effective, and where do those assumptions break in real retrieval tasks?
2. How do dot product, cosine, and L2 compare under normalization and model-specific embedding behavior?
3. When do cross-encoders outperform embedding similarity enough to justify latency/cost overhead?
4. How should two-stage retrieval + reranking be tuned for LCS query types (code lookup vs conceptual synthesis)?
5. What semantic failure modes appear with cosine (polysemy, negation, role reversal, lexical overlap bias)?
6. How does embedding dimension and model family affect similarity reliability (cross-reference EM-06)?
7. Can lightweight learned similarity calibration layers improve ranking without full cross-encoder reranking?
8. How should STS metrics map to downstream answer quality and citation fidelity (cross-reference EQ-02/EQ-01)?
9. What query/document length mismatches most distort cosine scoring?
10. What benchmark suites best reflect LCS similarity tasks, and what internal benchmarks are needed?
11. How should thresholding and score normalization be handled across heterogeneous artifact types?
12. What default similarity stack should ADR-003 adopt for v1 vs v2?

## Starting Sources
- Sentence-BERT paper — https://aclanthology.org/D19-1410/
- STS Benchmark shared task paper — https://aclanthology.org/S17-2001/
- SimCSE paper — https://aclanthology.org/2021.emnlp-main.552/
- Cross-encoder examples (Sentence Transformers) — https://www.sbert.net/examples/applications/cross-encoder/README.html
- SBERT pretrained model docs — https://www.sbert.net/docs/pretrained_models.html
- MTEB leaderboard — https://huggingface.co/spaces/mteb/leaderboard
- BEIR repository (retrieval relevance benchmarking) — https://github.com/beir-cellar/beir
- Reranker context docs (Cohere) — https://docs.cohere.com/docs/rerank-overview
- OpenAI embeddings guide — https://platform.openai.com/docs/guides/embeddings

## What to Measure, Compare, or Evaluate
- Ranking quality (MRR/NDCG/Recall@K) for cosine-only vs reranked pipelines.
- Score pathology analysis on manually curated hard negatives and role-reversal cases.
- Latency/cost tradeoff for cross-encoder reranking depth (top-20, top-50, top-100).
- Artifact-type calibration: separate performance on code, ADR, prose, and logs.
- Similarity drift after embedding model upgrades (cross-reference EM-09).
- Correlation between retrieval score improvements and final answer quality.

## Definition of Done
- A recommended similarity + reranking stack is defined for ADR-003.
- Known cosine failure classes and mitigations are documented.
- Score normalization and thresholding policy is specified per artifact category.
- Cost/latency envelope is defined for production constraints.
- Regression checks for similarity quality are integrated into EQ-06 plans.

## How Findings Feed LCS Architecture Decisions
This research sets ADR-003 scoring strategy boundaries and determines when reranking is mandatory versus optional. It also informs ADR-002 retrieval architecture and ADR-010 metric design by linking similarity choices to measurable quality outcomes.
