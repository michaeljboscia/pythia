# Research Prompt: EQ-02 Retrieval Metrics Comprehensive (P0)

## Research Objective
Build a rigorous metric framework for evaluating LCS retrieval performance, clarifying what each metric measures, when it is informative, and where it can mislead. The study must provide implementation-level formulas, protocol choices, and interpretation guidance for Recall@K, MRR, NDCG, MAP, and related metrics under realistic LCS workloads. Findings feed ADR-010 and must align with RF-10 production quality needs.

## Research Questions
1. What formal definitions and assumptions underlie Recall@K, Precision@K, MRR, NDCG, MAP, and Hit@K?
2. Which metric best captures each LCS retrieval objective: single-fact lookup, ranked evidence quality, multi-hop supporting set coverage, and citation-ready context quality?
3. How should graded relevance labels be defined for NDCG/MAP in mixed artifact corpora (code snippets vs ADR passages vs logs)?
4. How does K selection (5/10/20/50) alter conclusions and potentially hide failure modes?
5. What does metric disagreement indicate (for example, high Recall@20 but low MRR), and how should tuning decisions respond?
6. How should filtered retrieval and hybrid retrieval be evaluated separately from pure dense retrieval (cross-reference RF-03, RF-04, VD-06)?
7. What relevance-judgment process is practical for LCS: manual labeling, weak supervision, LLM-assisted labels, and adjudication workflow?
8. How do retrieval metrics correlate with end-to-end answer quality metrics, and where is correlation weak (cross-reference EQ-01, RF-07)?
9. What statistical techniques are required for robust comparisons (paired tests, confidence intervals, bootstrap)?
10. How should metric dashboards be designed for engineering decisions rather than vanity reporting?
11. Which edge cases systematically distort metrics (near-duplicate chunks, chunk overlap inflation, query ambiguity)?
12. What minimum metric suite should gate release decisions in ADR-010?

## Starting Sources
- BEIR benchmark site — https://beir.ai/
- BEIR repository — https://github.com/beir-cellar/beir
- TREC resources (IR evaluation standards) — https://trec.nist.gov/
- NDCG overview — https://en.wikipedia.org/wiki/Discounted_cumulative_gain
- MRR overview — https://en.wikipedia.org/wiki/Mean_reciprocal_rank
- IR evaluation measures overview — https://en.wikipedia.org/wiki/Evaluation_measures_(information_retrieval)
- Precision/Recall overview — https://en.wikipedia.org/wiki/Precision_and_recall
- scikit-learn `ndcg_score` reference — https://scikit-learn.org/stable/modules/generated/sklearn.metrics.ndcg_score.html
- MTEB benchmark repository — https://github.com/embeddings-benchmark/mteb
- ANN-Benchmarks (latency/quality frontier context) — https://ann-benchmarks.com/

## What to Measure, Compare, or Evaluate
- Metric computation correctness using validated reference implementations.
- Inter-metric correlation across retrieval experiments and query categories.
- Sensitivity analysis across K values, label granularity, and relevance thresholds.
- Impact of chunking and overlap on metric inflation (cross-reference RF-09).
- Retrieval-metric-to-answer-quality correlation against EQ-01 framework outputs.
- Confidence intervals and effect sizes for model/db comparisons.
- Dashboard prototype with decision-oriented thresholds and alerts.

## Definition of Done
- A metric handbook is produced with formulas, interpretation rules, and failure caveats.
- LCS-standard metric suite and K-values are fixed with rationale.
- Labeling protocol is defined for relevance judgments and adjudication.
- Statistical significance protocol is documented for A/B and regression checks.
- Metrics are mapped to release gates and SLO-style quality thresholds.
- ADR-010 receives a concrete measurement specification usable by all future evaluations.

## How Findings Feed LCS Architecture Decisions
This research gives ADR-010 the quantitative foundation for retrieval quality governance and prevents metric misuse during model/db selection (ADR-002/ADR-003). It also sets the scoring language used in VD benchmark studies and in continuous quality monitoring defined in EQ-06.
