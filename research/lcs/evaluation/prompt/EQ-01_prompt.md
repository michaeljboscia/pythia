# Research Prompt: EQ-01 RAGAS Framework Deep Dive (P0 Blocker)

## Research Objective
Establish whether RAGAS can serve as the core automated evaluation framework for LCS, including metric validity, implementation architecture, and ongoing pipeline integration. The study must move beyond API usage and determine where RAGAS metrics are reliable, where they fail, and what guardrails are required for production-grade decisions. Findings directly feed ADR-010 and should connect to RF-10 (RAG production patterns), RF-07 (lost-in-the-middle effects on judged quality), and KG-01 (GraphRAG-specific retrieval behaviors).

## Research Questions
1. How are RAGAS metrics (faithfulness, answer relevance, context precision, context recall) mathematically and procedurally computed, and what assumptions do they make?
2. Which RAGAS metrics correlate best with human judgments for LCS query classes (code reasoning, ADR rationale tracing, multi-source synthesis)?
3. How sensitive are metric outputs to evaluator model choice, prompt templates, and context-window effects (cross-reference RF-07)?
4. What failure modes produce falsely high scores (citation leakage, verbosity bias, judge-model hallucination) and how can they be detected?
5. How should RAGAS testset generation be configured for a heterogeneous corpus (code, docs, ADRs, logs) without introducing synthetic bias (cross-reference EQ-04)?
6. How do RAGAS metrics compare against alternative frameworks (DeepEval, TruLens, OpenEvals) in stability, cost, and signal quality?
7. What integration architecture is best for LCS pipelines: offline batch eval, PR-gated eval, canary eval, and scheduled production replay?
8. How should RAGAS evaluate graph-enhanced retrieval (GraphRAG/LightRAG flows) where evidence spans neighborhood traversal and summaries (cross-reference KG-01, KG-10)?
9. What token and runtime costs are expected at daily/weekly eval cadences, and where are cost-quality breakpoints?
10. Which minimal metric bundle should block production releases versus remain informational only?
11. How should confidence intervals and variance across repeated runs be handled before making go/no-go decisions?
12. What governance model should LCS adopt for metric drift, evaluator upgrades, and backward compatibility of scores over time?

## Starting Sources
- RAGAS documentation — https://docs.ragas.io/
- RAGAS GitHub repository — https://github.com/explodinggradients/ragas
- RAGAS paper — https://arxiv.org/abs/2309.15217
- RAGAS available metrics docs — https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/
- RAGAS testset generation quickstart — https://docs.ragas.io/en/latest/getstarted/rag_testset_generation/
- RAGAS test data generation concepts — https://docs.ragas.io/en/latest/concepts/test_data_generation/
- DeepEval docs — https://www.deepeval.com/docs/metrics-introduction
- TruLens docs — https://www.trulens.org/
- OpenEvals repository — https://github.com/langchain-ai/openevals
- LangChain evaluation concepts — https://python.langchain.com/docs/concepts/evaluation/
- OpenAI Evals repository — https://github.com/openai/evals

## What to Measure, Compare, or Evaluate
- Metric validity: correlation of each RAGAS score with blinded human ratings by query class.
- Metric stability: run-to-run variance across evaluator model and prompt settings.
- Cost profile: tokens, runtime, and compute per 100/1,000 evaluated samples.
- Coverage analysis: which failure classes are detected vs missed (hallucination, omission, wrong citation).
- Framework comparison: RAGAS vs DeepEval/TruLens/OpenEvals on the same sample set.
- Pipeline fit: integration complexity for CI/CD, nightly replay, and canary gating.
- Graph-RAG fit: metric behavior when answers rely on graph traversal + summary nodes.

## Definition of Done
- A full evaluation protocol is documented with dataset splits, evaluator settings, and reproducibility rules.
- RAGAS strengths/limitations are explicitly mapped to LCS query categories.
- A production metric stack is proposed: blocking metrics, advisory metrics, and escalation thresholds.
- Integration blueprint exists for offline and continuous evaluation workflows.
- Known blind spots and compensating controls are documented.
- ADR-010 receives an implementation-ready decision on whether/how RAGAS is the primary evaluator.

## How Findings Feed LCS Architecture Decisions
This research defines ADR-010’s core quality-evaluation backbone and determines how LCS monitors retrieval-generation quality over time. It also feeds RF-10 operational patterns by specifying which quality signals should trigger rollback, drift investigation, or retriever/reranker tuning.
