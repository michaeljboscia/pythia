# Research Prompt: KG-07 Architecture Decision Records (ADR) as Graph Knowledge (P1)

## Research Objective
Define an ADR data model and ingestion workflow that turns architecture decisions into queryable graph knowledge with lifecycle integrity. The study must compare formats and tooling, optimize for deterministic parsing, and preserve supersession/history semantics. Findings feed ADR-004 and ADR-005, cross-referencing DM-06 and DM-02.

## Research Questions
1. Which ADR schema fields are mandatory for machine-queryable decision lineage?
2. How do MADR and lightweight ADR formats compare for parseability and authoring friction?
3. How should decision lifecycle states be modeled (proposed/accepted/deprecated/superseded)?
4. What deterministic parsing rules capture high-precision relationships from ADR markdown?
5. How should ADR links to code, tests, and incidents be represented and validated?
6. What versioning/provenance model preserves historical truth across edits?
7. How should contradictions between old and new ADRs be surfaced automatically?
8. What tooling (adr-tools, log4brains, custom parser) best fits LCS pipeline constraints?
9. What failure modes drive ADR drift and graph inconsistency over time?
10. How should ADR ingestion integrate with change events and incremental indexing?
11. What governance process keeps ADR graph quality high with low overhead?
12. What explicit interface should ADR extraction expose to KG-09 relationship routing?

## Starting Sources
- MADR repository — https://github.com/adr/madr
- adr-tools repository — https://github.com/npryce/adr-tools
- Log4brains repository — https://github.com/thomvaill/log4brains
- Lightweight ADR docs — https://adr.github.io/
- Cognitect ADR article — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- Thoughtworks radar (lightweight ADRs) — https://www.thoughtworks.com/en-us/radar/techniques/lightweight-architecture-decision-records
- ADR examples and guidance — https://github.com/joelparkerhenderson/architecture-decision-record
- Markdown spec (parser consistency context) — https://spec.commonmark.org/
- GraphRAG repo (decision/provenance comparison context) — https://github.com/microsoft/graphrag

## What to Measure, Compare, or Evaluate
- Field extraction precision/recall from real ADR samples.
- Relationship yield and correctness (supersedes, affects, implemented-by).
- Lifecycle consistency over version updates and supersessions.
- Authoring effort and adoption friction.
- Incremental update correctness in living-corpus pipelines.
- Query utility for “why/when/what changed” questions.

## Definition of Done
- A standardized ADR schema and parser contract are finalized.
- Lifecycle and supersession rules are codified with examples.
- Tooling recommendation (adopt/adapt/custom) is explicit.
- ADR extraction integration points for ADR-004/005 are documented.
- Drift detection and maintenance workflow are defined.

## How Findings Feed LCS Architecture Decisions
This research makes ADR knowledge first-class in LCS by specifying how decisions become durable graph objects. It directly informs ingestion design (ADR-004) and extraction/routing strategy (ADR-005) with lifecycle-safe semantics.
