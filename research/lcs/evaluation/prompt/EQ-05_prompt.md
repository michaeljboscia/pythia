# Research Prompt: EQ-05 Adversarial Testing for RAG (P1)

## Research Objective
Design an adversarial evaluation program for LCS that systematically probes high-risk failure modes beyond standard benchmark performance, including false grounding, missing-evidence reasoning, and multi-source contradiction handling. The outcome should be a repeatable red-team protocol that complements golden-set regression testing and directly informs production safeguards. Findings feed ADR-010 and should cross-reference RF-10, RF-07, and KG-01.

## Research Questions
1. Which adversarial categories are highest risk for LCS: distractor injection, conflicting evidence, stale-vs-fresh contradiction, alias ambiguity, and citation spoofing?
2. How should “not in corpus” tests be designed to distinguish correct abstention from hallucinated confidence?
3. What protocols best test absence-of-evidence reasoning (proving non-existence claims with partial corpus coverage)?
4. How should multi-source synthesis stress tests be constructed so answers require combining distant evidence rather than single-chunk shortcuts?
5. How can lost-in-the-middle conditions be intentionally induced to expose packing vulnerabilities (cross-reference RF-07/RF-08)?
6. How should graph-retrieval-specific attacks be constructed (noisy edge traversal, community summary poisoning, bridge-node ambiguity)?
7. What judge framework and scoring rubric are robust for adversarial outcomes (binary pass/fail vs graded severity)?
8. How should adversarial test suites evolve as mitigations are deployed to avoid stale red-team scenarios?
9. What thresholds should trigger release blocks, canary rollback, or urgent retriever/reranker retuning?
10. How can adversarial findings be linked to root-cause layers (retrieval miss, ranking error, packing failure, generation failure)?
11. What automation level is realistic for continuous adversarial testing versus periodic manual deep dives?
12. How should adversarial tests account for cost and latency constraints while still being meaningful?

## Starting Sources
- CRAG paper (retrieval correction framing) — https://arxiv.org/abs/2401.15884
- Self-RAG paper — https://arxiv.org/abs/2310.11511
- Reflexion paper (self-correction patterns) — https://arxiv.org/abs/2303.11366
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- Promptfoo docs (LLM red-team/eval harness concepts) — https://www.promptfoo.dev/docs/intro/
- OpenAI Evals repository — https://github.com/openai/evals
- DeepEval docs — https://www.deepeval.com/docs/metrics-introduction
- Giskard platform site (LLM vulnerability testing context) — https://www.giskard.ai/
- Anthropic docs on reducing hallucinations — https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/reduce-hallucinations

## What to Measure, Compare, or Evaluate
- Adversarial pass rates by category and severity tier.
- Hallucination-under-pressure rate for not-in-corpus and contradiction prompts.
- Citation integrity under distractor and spoofed-evidence attacks.
- Root-cause attribution rate: percentage of failures mapped to a specific pipeline component.
- Mitigation efficacy: before/after comparison for retrieval, reranking, and packing fixes.
- Cost profile of adversarial suite runs (tokens/runtime) and feasible execution cadence.
- False positive burden of automated adversarial judges.

## Definition of Done
- An adversarial taxonomy and reproducible test suite are defined with representative cases per category.
- Severity scoring and release-block criteria are documented.
- Root-cause tagging schema is defined for triage and remediation tracking.
- A governance cadence is set (per-PR subset, nightly suite, monthly deep adversarial run).
- Mitigation feedback loop is established with RF/KG/VD owners.
- ADR-010 receives a concrete red-team quality-control strategy.

## How Findings Feed LCS Architecture Decisions
This research adds failure-pressure testing to ADR-010 and closes blind spots left by standard benchmark metrics. It also drives retrieval/packing hardening priorities in RF-07/RF-10 and graph traversal robustness checks related to KG-01.
