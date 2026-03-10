# Research Prompt: PA-05 Zed AI Codebase Indexing (Engineering Blog Study)

## Research Objective
Study Zed’s published AI engineering approach to code context, edit prediction, and MCP integration to extract actionable lessons for LCS code intelligence. Emphasis should be on architecture signals that can inform indexing, retrieval latency, and context assembly design for developer workflows. Findings feed ADR-002 and ADR-004, with cross-references to CI-08, RF-08, and MC-04.

## Research Questions
1. What architectural clues do Zed’s AI docs/blogs provide about how it builds context for code assistance?
2. How do Zed’s design choices balance local responsiveness, context richness, and model call costs?
3. What does Zed’s MCP integration imply about tool/resource orchestration for context retrieval?
4. How might Zed combine editor state, symbol information, and file retrieval for prompt assembly?
5. What can be inferred from edit prediction behavior about indexing granularity and recency handling?
6. How should LCS interpret Zed patterns when documentation is sparse or product-focused rather than architecture-focused?
7. What edge cases matter most for editor-integrated retrieval (large files, partial buffers, unsaved changes)?
8. Which Zed choices appear reusable for LCS MCP server design and which are editor-specific?
9. How do Zed patterns compare with Cursor and Sourcegraph on structural vs semantic emphasis?
10. What experiments should LCS run to validate the practical impact of these extracted patterns?
11. What anti-patterns are hinted at (overly aggressive context injection, stale buffer assumptions, opaque ranking)?
12. How should LCS incorporate these lessons into ADR-002/004 without overfitting to one product?

## Starting Sources
- Zed blog index — https://zed.dev/blog
- Zed AI overview page — https://zed.dev/ai
- Zed documentation home — https://zed.dev/docs
- Zed MCP docs — https://zed.dev/docs/assistant/model-context-protocol
- Zed languages/docs (context for structural tooling) — https://zed.dev/docs/languages
- Zed configuration docs — https://zed.dev/docs/configuring-zed
- Zed AI blog post — https://zed.dev/blog/zed-ai
- Zed edit prediction blog post — https://zed.dev/blog/edit-prediction
- Zed GitHub repository — https://github.com/zed-industries/zed
- LSP specification (baseline comparison) — https://microsoft.github.io/language-server-protocol/

## What to Measure, Compare, or Evaluate
- Extracted architecture signals from docs/blogs with confidence levels.
- Comparative matrix vs Cursor/Sourcegraph for context strategy dimensions.
- LCS portability analysis for each identified pattern.
- Risk analysis for adopting patterns with low observability.
- Proposed prototype tests to validate low-latency context strategies.
- Cost/latency implications of editor-like context expectations in LCS.

## Definition of Done
- A synthesis report captures concrete patterns, unknowns, and confidence levels.
- Reusable design ideas are mapped to ADR-002/004 decision points.
- Validation experiments are defined for each high-impact hypothesis.
- Product-specific assumptions are separated from generalizable architecture.
- Cross-system comparison with Cursor/Cody is included for triangulation.

## How Findings Feed LCS Architecture Decisions
This research contributes practical low-latency context assembly ideas for ADR-004 and retrieval orchestration insights for ADR-002, while keeping LCS grounded in verifiable patterns rather than opaque product behavior.
