# Research Prompt: KG-09 Relationship Extraction Strategies Compared (P0)

## Research Objective
Establish the optimal relationship extraction architecture for LCS by quantitatively comparing parser-based, LSP-based, and LLM-based strategies under shared evaluation protocols. The output must define routing rules, confidence semantics, and quality thresholds for production graph writes. Findings feed ADR-005 and cross-reference CI-03, CI-04, and KG-04.

## Research Questions
1. Which relation types are best extracted deterministically versus probabilistically?
2. How do parser-based approaches perform on technical prose and structured markdown?
3. For code, how do LSP-derived relations compare with AST/parser extraction on accuracy and coverage?
4. What additional value does LLM-based extraction provide beyond deterministic methods?
5. How should routing policy select extractors by artifact type and relation class?
6. How should conflicting extractor outputs be resolved and audited?
7. What confidence calibration is required to prevent noisy edge pollution?
8. What token/latency cost is acceptable for LLM-based extraction at LCS scale?
9. How should extraction pipelines handle ambiguous references and unresolved symbols?
10. What evaluation dataset and labeling protocol are needed for ongoing quality governance?
11. How should incremental updates prevent duplicate/conflicting edge creation?
12. What minimum quality thresholds should block production writes?

## Starting Sources
- REBEL paper — https://arxiv.org/abs/2101.11185
- Stanford OpenIE — https://nlp.stanford.edu/software/openie.html
- spaCy dependency parsing docs — https://spacy.io/usage/linguistic-features
- tree-sitter documentation — https://tree-sitter.github.io/tree-sitter/
- TypeScript Compiler API guide — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Language Server Protocol specification — https://microsoft.github.io/language-server-protocol/
- GraphRAG repository (reference pipeline) — https://github.com/microsoft/graphrag
- Cognee repository (reference pipeline) — https://github.com/topoteretes/cognee
- DeepEval repository (evaluation harness patterns) — https://github.com/confident-ai/deepeval

## What to Measure, Compare, or Evaluate
- Precision/recall/F1 by relation type and artifact type.
- Cost/latency profile for each extraction path.
- Conflict/disagreement rates and resolution outcomes.
- Confidence calibration quality for acceptance thresholds.
- Incremental update consistency and duplicate-edge prevention.
- Downstream retrieval impact from extracted edge quality.

## Definition of Done
- A benchmark and routing strategy are finalized with measurable thresholds.
- Extractor-specific confidence schema and conflict policy are defined.
- Production write gates for relation quality are documented.
- Integration points with CI-03/CI-04 pipelines are explicit.
- ADR-005 receives implementation-ready extraction architecture guidance.

## How Findings Feed LCS Architecture Decisions
This research directly sets ADR-005 extraction policy and quality controls. It ensures graph relationships are trustworthy, auditable, and cost-effective across heterogeneous LCS artifacts.
