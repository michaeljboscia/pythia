# Research Prompt: EQ-04 Golden Question Set Design Methodology (P0)

## Research Objective
Define a robust methodology for constructing and maintaining LCS-specific golden evaluation sets that reflect real user tasks, evolving corpus state, and high-risk failure scenarios. The methodology must balance manual expert curation with LLM-assisted generation while controlling bias, leakage, and stale questions. Findings feed ADR-010 and should integrate with RF-10 production patterns and DM-03 staleness/freshness concerns.

## Research Questions
1. What taxonomy should structure LCS golden questions (fact lookup, code navigation, ADR rationale, multi-hop synthesis, absence checks, change-over-time questions)?
2. How should coverage be ensured across artifact types, repositories, and decision-history periods?
3. What process best combines manual curation and LLM-generated candidate questions without sacrificing realism?
4. How should answer keys be represented: canonical answer text, required citations, acceptable alternatives, and abstain expectations?
5. How should “not in corpus” and ambiguity cases be incorporated to test refusal and uncertainty behavior (cross-reference EQ-05)?
6. What anti-leakage controls prevent training/evaluation contamination when synthetic generation is used (cross-reference EM-08)?
7. How should golden sets evolve with corpus updates: versioning, retirement, supersession, and temporal stratification?
8. What sample size and class balance are needed for statistically meaningful regression detection?
9. How should human adjudication workflows resolve evaluator disagreements efficiently?
10. How should difficult edge cases (conflicting sources, stale docs vs new code, partial evidence) be encoded and scored?
11. What metadata schema is required so each golden question remains traceable to source snapshots and expected evidence IDs?
12. What governance model should own golden set quality and update cadence over time?

## Starting Sources
- RAGAS docs (testset generation and evaluation workflows) — https://docs.ragas.io/
- RAGAS testset generation guide — https://docs.ragas.io/en/latest/getstarted/rag_testset_generation/
- OpenAI Evals repository — https://github.com/openai/evals
- OpenEvals repository — https://github.com/langchain-ai/openevals
- Promptfoo docs (evaluation workflows) — https://www.promptfoo.dev/docs/intro/
- LangChain evaluation concepts — https://python.langchain.com/docs/concepts/evaluation/
- BEIR repository (dataset/task structuring patterns) — https://github.com/beir-cellar/beir
- HotpotQA paper page (supporting-fact style supervision) — https://aclanthology.org/D18-1259/
- MuSiQue paper page — https://aclanthology.org/2022.tacl-1.31/
- MLflow LLM evaluation docs — https://mlflow.org/docs/latest/llms/llm-evaluate/index.html

## What to Measure, Compare, or Evaluate
- Coverage metrics: distribution across taxonomy classes and artifact types.
- Quality metrics: ambiguity rate, adjudication disagreement rate, stale-question rate.
- Generator quality: precision of LLM-generated candidate questions after human review.
- Maintenance metrics: time/cost to update golden set per corpus release cycle.
- Regression power: sensitivity/specificity of detecting known retrieval/generation degradations.
- Temporal robustness: performance stability when source artifacts evolve.
- Provenance integrity: ability to reproduce each expected answer from pinned corpus snapshots.

## Definition of Done
- A complete golden-set design playbook exists (taxonomy, generation workflow, review protocol, versioning).
- A seed golden set is specified with minimum class counts and evidence-link requirements.
- Update and retirement policies are documented for living-corpus operation.
- Leakage-prevention and adjudication standards are finalized.
- Golden-set artifacts are structured for direct integration into CI and scheduled eval runs.
- ADR-010 receives a long-term evaluation-data governance model.

## How Findings Feed LCS Architecture Decisions
This research defines ADR-010’s ground-truth backbone and enables meaningful automated regression detection in EQ-06. It also feeds DM-03/DM-05 operational practices by requiring corpus-version-aware evaluation and stale-question management.
