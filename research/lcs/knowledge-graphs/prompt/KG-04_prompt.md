# Research Prompt: KG-04 Knowledge Graph Construction from Unstructured Text (P1)

## Research Objective
Design a practical graph-construction pipeline for LCS that transforms unstructured artifacts into high-quality entities and relations with measurable confidence. The study should compare deterministic extractors, OpenIE-style methods, and LLM-assisted extraction in terms of precision, coverage, and cost. Findings feed ADR-005 and cross-reference KG-09 and CI-04.

## Research Questions
1. Which extraction stages are required from raw text to graph-ready nodes/edges?
2. How do REBEL/OpenIE/LLM-based extraction strategies compare on precision and coverage?
3. What entity normalization and canonicalization steps are required for stable graph IDs?
4. How should relation typing and confidence scoring be designed for downstream filtering?
5. What domain-specific parsing is needed for code and technical docs versus general prose?
6. How should extraction pipelines handle ambiguity, co-reference, and incomplete statements?
7. What quality-control loops are needed (human review, active learning, heuristic validation)?
8. How should temporal/version context be encoded to avoid stale contradictions?
9. What failure modes dominate at scale (entity explosion, relation noise, duplicate nodes)?
10. How should incremental updates merge with existing graph state safely?
11. Where should deterministic parser outputs override LLM guesses?
12. What minimum precision thresholds should gate writes into production graph stores?

## Starting Sources
- REBEL paper — https://arxiv.org/abs/2101.11185
- Stanford OpenIE — https://nlp.stanford.edu/software/openie.html
- spaCy linguistic features — https://spacy.io/usage/linguistic-features
- Stanford CoreNLP OpenIE docs — https://stanfordnlp.github.io/CoreNLP/openie.html
- GraphRAG repository (entity/relation pipeline reference) — https://github.com/microsoft/graphrag
- Cognee repository (practical pipeline reference) — https://github.com/topoteretes/cognee
- LlamaIndex KG API reference — https://docs.llamaindex.ai/en/stable/api_reference/indices/knowledge_graph/
- TypeScript Compiler API (code extraction context) — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- tree-sitter docs — https://tree-sitter.github.io/tree-sitter/

## What to Measure, Compare, or Evaluate
- Edge precision/recall/F1 by relation class.
- Entity linking quality and duplicate-node rate.
- Cost/latency per extraction strategy at corpus scale.
- Confidence calibration quality for auto-accept thresholds.
- Incremental merge correctness during corpus updates.
- Impact of extraction quality on downstream retrieval answers.

## Definition of Done
- A production candidate extraction pipeline is specified with fallback order.
- Relation taxonomy and confidence schema are finalized for ADR-005.
- Quality thresholds and review workflow are defined.
- Failure-mode mitigation plan is documented.
- Cross-link with KG-09 routing strategy is explicit.

## How Findings Feed LCS Architecture Decisions
This research defines ADR-005 ingestion intelligence boundaries: what is deterministic, what is probabilistic, and what needs review. It ensures graph construction quality is measurable and operationally sustainable.
