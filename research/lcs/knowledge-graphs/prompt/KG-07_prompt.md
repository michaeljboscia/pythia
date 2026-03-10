# Research Prompt: KG-07 Architecture Decision Records (ADRs) in Living Knowledge Systems

## Research Objective
Define an ADR practice for LCS that is machine-queryable, durable over time, and integrated with graph relationship extraction rather than treated as static markdown. Compare MADR, Nygard-style lightweight ADRs, and real tooling ecosystems to determine a format and lifecycle that supports both human governance and automated decision lineage analysis. This research feeds ADR-004 (ingestion/chunking metadata strategy) and ADR-005 (relationship extraction and code-intelligence linkages).

## Research Questions
1. What structural fields are essential in an ADR for LCS machine use (decision, status, context, alternatives, consequences, supersedes/superseded-by, affected artifacts)?
2. How do MADR and Nygard-style ADRs differ in expressiveness, authoring friction, and machine-parsing reliability?
3. Which existing ADR tools (`adr-tools`, `log4brains`) are easiest to operationalize with LCS ingestion pipelines and graph updates?
4. How should ADR status transitions be modeled (`proposed`, `accepted`, `deprecated`, `superseded`) to keep historical truth and avoid graph ambiguity?
5. What conventions are required so deterministic parsers can extract relationships with high precision before invoking LLM fallback extraction?
6. How should ADRs link to implementation evidence (commits, PRs, files, tests) and how should those links evolve when code moves or decisions are reversed?
7. What anti-patterns cause ADR rot in production teams, and what automation can enforce freshness and consistency?

## Starting Sources
- MADR specification repository — https://github.com/adr/madr
- `adr-tools` repository — https://github.com/npryce/adr-tools
- Log4brains repository — https://github.com/thomvaill/log4brains
- Lightweight ADR template and rationale — https://adr.github.io/
- Cognitect article on documenting architecture decisions — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- Thoughtworks Radar entry: Lightweight architecture decision records — https://www.thoughtworks.com/en-us/radar/techniques/lightweight-architecture-decision-records
- Curated ADR guidance/examples — https://github.com/joelparkerhenderson/architecture-decision-record

## What to Measure, Compare, or Evaluate
- Parseability score: percent of ADRs where required fields are extracted deterministically without LLM intervention.
- Relationship yield: number and precision of extracted links per ADR (supersedes, affects, implemented-by).
- Authoring friction: time-to-create/update ADR and qualitative adoption risk for maintainers.
- Change tracking quality: accuracy of decision lineage after supersession/deprecation events.
- Retrieval utility: impact of ADR graph links on answering “why” and “what changed” queries.
- Governance robustness: percentage of ADRs with stale status, missing consequences, or broken evidence links.

## Definition of Done
- A single recommended ADR schema is selected for LCS with required/optional fields and examples.
- Naming, status transitions, and supersession rules are documented as enforceable conventions.
- A deterministic extraction spec is defined for ADR-005 pipeline implementation.
- Tooling recommendation is explicit (adopt, adapt, or custom) with cost/benefit rationale.
- ADR-004 and ADR-005 receive concrete metadata and parser requirements.

## How Findings Feed LCS Architecture Decisions
Findings define how ADR documents are chunked, parsed, and represented as first-class graph nodes in ADR-004/005. They also determine relationship extraction strategy boundaries (parser-first vs LLM fallback), and provide the canonical decision-lineage model LCS must preserve for architectural memory queries.
