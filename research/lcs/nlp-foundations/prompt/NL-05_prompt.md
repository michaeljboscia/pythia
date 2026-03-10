# Research Prompt: NL-05 Contradiction Detection Approaches (NLI, LLM Judge, Claim Decomposition)

## Research Objective
Compare contradiction detection strategies for LCS v2, including NLI classifiers, LLM-as-judge methods, and claim decomposition + verification pipelines. The study should identify precision/cost tradeoffs and define where each approach fits in offline corpus hygiene versus online answer validation. Findings feed v2 planning and cross-reference NL-01, EQ-05, and DM-03.

## Research Questions
1. How do NLI-based contradiction detectors perform against LLM-judge approaches on LCS-style technical contradictions?
2. What gains come from claim decomposition before contradiction checks versus direct full-text comparisons?
3. How should contradictions be scoped temporally (old truth vs superseded truth) to avoid false positives?
4. What evidence granularity is required (sentence-level, claim-level, document-level) for reliable contradiction signaling?
5. How do different approaches handle implicit contradictions, numerical inconsistencies, and version conflicts?
6. What precision thresholds are required before contradiction edges are written into the knowledge graph?
7. Which approach best balances latency and reliability for query-time guardrails?
8. How should contradiction confidence be calibrated and surfaced to downstream ranking/answering?
9. What adversarial cases break each approach (paraphrase traps, negation scope, partial evidence)?
10. How should human-in-the-loop review be inserted for high-impact contradiction alerts?
11. What evaluation dataset design is needed for contradiction-specific regression testing?
12. What minimal architecture should LCS adopt in v2: single-method, ensemble, or staged pipeline?

## Starting Sources
- MultiNLI paper — https://arxiv.org/abs/1704.05426
- ANLI paper — https://arxiv.org/abs/1910.14599
- SBERT NLI models docs — https://www.sbert.net/docs/pretrained-models/nli-models.html
- DeBERTa paper — https://arxiv.org/abs/2006.03654
- Promptagator paper (claim generation patterns) — https://arxiv.org/abs/2209.11755
- Self-RAG paper (self-critique context) — https://arxiv.org/abs/2310.11511
- CRAG paper — https://arxiv.org/abs/2401.15884
- RAGAS docs (evaluation integration) — https://docs.ragas.io/
- OpenAI Evals repository — https://github.com/openai/evals
- Promptfoo docs (adversarial eval harness) — https://www.promptfoo.dev/docs/intro/

## What to Measure, Compare, or Evaluate
- Contradiction precision/recall/F1 across method families and hybrid ensembles.
- Latency and token cost per evaluated claim pair.
- False positive classes (temporal drift, lexical mismatch, implied assumptions).
- Benefit of claim decomposition on difficult contradiction categories.
- Impact on downstream retrieval and answer trust when contradiction signals are applied.
- Human adjudication agreement rates for borderline cases.

## Definition of Done
- A method comparison report ranks approaches by quality, cost, and operational fit.
- A recommended v2 contradiction architecture is specified with thresholds.
- Graph-write policy for contradiction edges is documented (confidence and review gates).
- A contradiction benchmark and regression plan is defined.
- Risks and mitigations for high-impact false positives are documented.

## How Findings Feed LCS Architecture Decisions
This research determines how contradiction intelligence should be operationalized in LCS v2 and whether NL-01 NLI can serve as a core primitive or only a component in a broader ensemble. It also informs ADR-010 extensions for contradiction-aware monitoring and alerts.
