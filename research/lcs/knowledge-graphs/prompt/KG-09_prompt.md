# Research Prompt: KG-09 Relationship Extraction Strategies Compared (Parser vs LLM vs LSP)

## Research Objective
Produce a quantitative strategy comparison for extracting relationships into the LCS knowledge graph across mixed content types, with explicit cost, precision, and operational tradeoffs. Compare deterministic parser-based extraction, LLM-based extraction, and LSP-based extraction (for code) under a unified evaluation protocol. The output must define the extraction architecture for ADR-005, including routing, fallback logic, and confidence handling.

## Research Questions
1. What relationship classes can parser-based methods extract with high precision from markdown/ADR/code without LLMs, and where do they fail?
2. For code artifacts, how do LSP-based relationships (references, definitions, call hierarchy, type hierarchy) compare to AST parser extraction in precision, coverage, and runtime?
3. What additional relationship types does LLM-based extraction uniquely recover (implicit rationale links, semantic dependencies), and what is its noise profile?
4. What routing policy should LCS use: parser-first, LSP-first for code, LLM fallback, or blended voting?
5. How should confidence scores be computed and calibrated across heterogeneous extractors so graph writes remain trustworthy?
6. What is the dollar/token/latency cost model for LLM extraction at corpus scale, and when does it become unjustifiable versus deterministic methods?
7. How should extraction pipelines handle disagreement between extractors (conflict resolution, human review queue, deferred edges)?
8. Which relationship types are mission-critical for v1 and must meet strict precision thresholds before indexing?

## Starting Sources
- REBEL paper (LLM/seq2seq relation extraction baseline) — https://arxiv.org/abs/2101.11185
- Stanford OpenIE system overview — https://nlp.stanford.edu/software/openie.html
- spaCy linguistic features and dependency parsing — https://spacy.io/usage/linguistic-features
- tree-sitter documentation (deterministic syntax parsing) — https://tree-sitter.github.io/tree-sitter/
- TypeScript Compiler API usage guide — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Language Server Protocol specification — https://microsoft.github.io/language-server-protocol/
- Microsoft GraphRAG codebase (entity/relation pipeline reference) — https://github.com/microsoft/graphrag

## What to Measure, Compare, or Evaluate
- Precision/recall/F1 per relationship type across extraction strategies.
- Coverage by artifact type: markdown, ADR, TypeScript/JavaScript, logs, and mixed snippets.
- Cost/latency profile: runtime per file, total pipeline throughput, and token/API cost for LLM paths.
- Conflict rate: percentage of edges where extractors disagree and resolution outcomes.
- Confidence calibration: correlation between extractor confidence and true correctness.
- Robustness: failure rates on noisy, partially structured, or outdated artifacts.

## Definition of Done
- A benchmark dataset with annotated relationships is created or curated for LCS artifact types.
- A comparison report ranks extraction strategies by precision, coverage, and cost.
- A production routing architecture is selected with explicit fallback and conflict policies.
- Minimum quality thresholds are defined per relationship class for graph ingestion.
- ADR-005 receives a concrete implementation blueprint, including confidence schema and monitoring requirements.

## How Findings Feed LCS Architecture Decisions
This research directly determines ADR-005 extraction pipeline architecture and where LLM usage is justified versus prohibited. It also sets ingestion contracts for ADR-004 by defining which metadata/confidence fields must be persisted with each relationship edge for auditability and downstream retrieval trust.
