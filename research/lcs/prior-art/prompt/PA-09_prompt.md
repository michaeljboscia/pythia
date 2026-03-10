# Research Prompt: PA-09 Notion AI and Confluence AI (Living Docs Systems)

## Research Objective
Study Notion AI and Confluence AI as living-document systems to extract patterns for freshness management, relationship evolution, and user trust in knowledge retrieval over changing corpora. Focus on document lifecycle behavior, update semantics, and governance signals that can inform LCS “living corpus” design. Findings feed ADR-006 and ADR-008, with cross-references to DM-03, DM-06, and EQ-06.

## Research Questions
1. What mechanisms do Notion AI and Confluence AI expose for keeping generated answers aligned with changing source content?
2. How do these systems represent or imply document provenance, recency, and confidence to users?
3. What relationship and linking patterns exist between documents, pages, comments, and updates?
4. How are stale references handled when content is edited, moved, or archived?
5. What user-facing affordances improve trust (source citations, edit history, visibility into retrieval scope)?
6. How do permission models and workspace boundaries affect retrieval and answer quality?
7. What are common failure modes in living-doc AI systems (stale answers, outdated summaries, permission leakage, citation drift)?
8. How do these products balance speed vs freshness (caching policies, background indexing cadence)?
9. What governance or admin controls exist for monitoring AI behavior and limiting risk?
10. Which design patterns are transferable to LCS despite product differences?
11. What anti-patterns should LCS avoid when building freshness scoring and relationship updates?
12. How should LCS instrument freshness and provenance metrics inspired by these systems (cross-reference EQ-06)?

## Starting Sources
- Notion AI product page — https://www.notion.so/product/ai
- Notion AI help category — https://www.notion.com/help/category/notion-ai
- Notion AI guides category — https://www.notion.com/help/guides/category/ai
- Confluence AI product page — https://www.atlassian.com/software/confluence/ai
- Atlassian Intelligence trust page — https://www.atlassian.com/trust/atlassian-intelligence
- Atlassian AI blog hub — https://www.atlassian.com/blog/artificial-intelligence
- Confluence product docs home — https://support.atlassian.com/confluence-cloud/
- Notion help center home — https://www.notion.com/help
- RAG production patterns context — https://arxiv.org/abs/2005.11401
- CRAG paper (corrective retrieval) — https://arxiv.org/abs/2401.15884

## What to Measure, Compare, or Evaluate
- Freshness strategy comparison: update triggers, indexing latency, cache invalidation signals.
- Provenance UX comparison: citation clarity, recency transparency, and trust affordances.
- Lifecycle coverage: create/update/archive/supersede behavior handling.
- Permission-aware retrieval behavior and risk implications.
- Failure-mode catalog and mitigation pattern extraction.
- LCS portability matrix for freshness/governance patterns.

## Definition of Done
- A comparative analysis of Notion AI vs Confluence AI is produced with LCS-focused dimensions.
- Transferable patterns are identified for freshness, provenance, and relationship management.
- Anti-patterns and high-risk failure modes are documented with mitigation proposals.
- Concrete requirements are proposed for ADR-006 and ADR-008 implementation.
- Monitoring implications are mapped into EQ-06 pipeline design.

## How Findings Feed LCS Architecture Decisions
This research provides practical product-tested guidance for ADR-006 (event-driven updates/lifecycle) and ADR-008 (freshness/staleness logic). It helps LCS design trust-preserving living-corpus behavior, especially around provenance and stale-answer prevention.
