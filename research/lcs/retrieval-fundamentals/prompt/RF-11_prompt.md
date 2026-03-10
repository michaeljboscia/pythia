# Research Prompt: RF-11 Query Decomposition for Multi-Hop Retrieval

## Research Objective
Evaluate whether explicit query decomposition materially improves multi-hop retrieval and synthesis for LCS, and identify which decomposition strategy is worth operational complexity. Compare least-to-most, step-back prompting, decomposed prompting, and retrieval-interleaved reasoning under realistic corpus tasks. The output should drive ADR-007 query-planning behavior and retrieval orchestration design.

## Research Questions
1. Which decomposition methods consistently improve multi-hop recall over single-shot retrieval in mixed artifact corpora?
2. How should LCS decide when decomposition is needed vs when direct retrieval is sufficient (query classifier, confidence threshold, or heuristic triggers)?
3. What is the best decomposition granularity: two-step subquestions, full reasoning chains, or dynamically generated retrieval steps?
4. Does decomposition increase error propagation (bad early subquestion poisoning later retrieval), and how can orchestration mitigate that?
5. How do least-to-most, step-back, and decomposed prompting differ in token/latency overhead relative to quality gains?
6. Can retrieval-interleaved reasoning (retrieve -> reason -> retrieve) outperform one-shot decomposition for hard cross-document joins?
7. What output schema should a decomposer produce so downstream retrievers, graph traversals, and packers can consume it deterministically?

## Starting Sources
- Least-to-Most Prompting Enables Complex Reasoning in Large Language Models — https://arxiv.org/abs/2205.10625
- Decomposed Prompting: A Modular Approach for Solving Complex Tasks — https://arxiv.org/abs/2210.02406
- Interleaving Retrieval with Chain-of-Thought Reasoning for Knowledge-Intensive Multi-Step Questions (IRCoT) — https://arxiv.org/abs/2212.10509
- STEP-BACK Prompting (Google DeepMind) — https://arxiv.org/abs/2310.06117
- LongBench repository (multi-task long context evaluation setup) — https://github.com/THUDM/LongBench
- LangChain retrieval conceptual docs (for orchestration implementation context) — https://python.langchain.com/docs/concepts/retrieval/

## What to Measure, Compare, or Evaluate
- Multi-hop retrieval metrics: supporting-fact recall@k and full evidence chain completion rate.
- End-task quality: exact match/F1 or judge score on multi-hop QA set derived from LCS corpus.
- Overhead metrics: extra retrieval calls, added tokens, median and p95 latency.
- Failure analysis: decomposition drift, subquestion redundancy, and dead-end branch rate.
- Control efficacy: performance of decomposition gating policy vs always-on decomposition.
- Determinism/reproducibility: variance in decomposition output across repeated runs.

## Definition of Done
- A head-to-head benchmark exists for at least four decomposition strategies against a no-decomposition baseline.
- A clear decomposition trigger policy is chosen with measurable precision/recall for “needs decomposition.”
- The orchestration contract is specified (input/output schema, max steps, abort conditions, fallback path).
- A recommendation is made for v1 (enable/disable decomposition by default) with quantified cost-benefit.
- Risks and guardrails are documented for production deployment.

## How Findings Feed LCS Architecture Decisions
Findings determine whether ADR-007 includes a query planner stage and how retrieval calls are sequenced (parallel vs iterative). They also affect ADR-009 context assembly by determining whether evidence is packed from one retrieval pass or composed across subqueries and graph traversals.
