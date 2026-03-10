# Research Prompt: NL-01 Natural Language Inference (NLI) for Contradiction Signals (v2)

## Research Objective
Assess NLI as a practical contradiction/entailment layer for LCS v2, focusing on lightweight models, calibration quality, and integration into corpus health checks and answer validation workflows. The research should determine where NLI adds reliable signal versus where it produces brittle judgments in mixed code+prose corpora. Findings feed the v2 roadmap and should cross-reference NL-05, EQ-01, and DM-03.

## Research Questions
1. What are the formal semantics of entailment, contradiction, and neutral in modern NLI benchmarks, and how transferable are they to LCS artifacts?
2. How do lightweight NLI models compare on accuracy/latency/cost against larger cross-encoders and LLM-judge approaches?
3. What calibration techniques (temperature scaling, threshold tuning, abstention policies) improve reliability for contradiction detection?
4. How does performance degrade when premises/hypotheses include technical language, code symbols, version references, or partial evidence?
5. What benchmark gaps exist between MNLI-style sentence pairs and real LCS document-level contradiction cases?
6. How should NLI be used operationally: offline corpus consistency scans, query-time fact checks, or post-answer verification?
7. What failure modes are common (lexical overlap traps, negation errors, temporal contradiction misses, scope ambiguity)?
8. How should uncertainty be represented in graph edges and freshness/staleness scoring (cross-reference KG-09, ADR-008 intent)?
9. How does NLI performance change with claim decomposition pipelines vs raw long-text pairs (cross-reference NL-05)?
10. What minimal quality bar and latency budget justify NLI in LCS v2?
11. How should multilingual or domain-shifted data be handled if LCS expands scope?
12. What evaluation harness should be created for ongoing NLI regression detection (cross-reference EQ-06)?

## Starting Sources
- SNLI paper page — https://aclanthology.org/D15-1075/
- MultiNLI paper — https://arxiv.org/abs/1704.05426
- MultiNLI dataset site — https://cims.nyu.edu/~sbowman/multinli/
- RoBERTa paper (strong NLI backbone) — https://arxiv.org/abs/1907.11692
- DeBERTa paper (NLI-relevant architecture) — https://arxiv.org/abs/2006.03654
- SBERT NLI models docs — https://www.sbert.net/docs/pretrained-models/nli-models.html
- Hugging Face sequence classification task docs — https://huggingface.co/docs/transformers/tasks/sequence_classification
- “ANLI” adversarial NLI paper — https://arxiv.org/abs/1910.14599
- RAGAS paper (evaluation integration context) — https://arxiv.org/abs/2309.15217

## What to Measure, Compare, or Evaluate
- Class-wise precision/recall/F1 for entailment/contradiction/neutral on adapted LCS test pairs.
- Calibration error and abstention effectiveness under uncertain or incomplete evidence.
- Latency/cost per 1k pair evaluations for lightweight vs heavyweight models.
- Robustness to technical tokens, dates/versions, and mixed code-prose claims.
- Lift from claim decomposition before NLI scoring versus direct pair scoring.
- False positive contradiction rate on temporally evolving documents.
- Integration impact on end-to-end answer trust metrics (cross-reference EQ-01/EQ-06).

## Definition of Done
- A model shortlist is produced with calibrated thresholds and deployment envelopes.
- NLI usage policy is defined by workflow (offline scan, online guardrail, or both).
- Known failure classes are documented with mitigation strategies.
- A regression test suite and monitoring plan are specified.
- A clear go/no-go recommendation is produced for LCS v2 adoption.

## How Findings Feed LCS Architecture Decisions
This research determines whether NLI becomes a first-class v2 contradiction signal and where it should sit in the pipeline (graph maintenance, answer validation, or both). It also provides concrete inputs to NL-05 approach selection and ADR-010 quality-monitoring extensions for contradiction-sensitive tasks.
