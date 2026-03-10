# Research Prompt: PA-04 Cursor Codebase Indexing (Reverse Engineering)

## Research Objective
Reverse-engineer Cursor’s likely codebase indexing and context assembly strategies using public docs, behavior observation, and related technical primitives. The goal is to extract practical patterns for code-aware retrieval and conversational context management at repository scale. Findings feed ADR-002 and ADR-004, and should cross-reference CI-01/CI-03, RF-08, and PE-02.

## Research Questions
1. What explicit clues do Cursor docs provide about codebase indexing, symbol lookup, and retrieval boundaries?
2. How does Cursor appear to combine lexical signals, structural code understanding, and semantic retrieval for chat answers?
3. What role do context directives (`@` symbols, rules) play in query rewriting and retrieval scope control?
4. How might Cursor manage context budget and chunk ordering to mitigate lost-in-the-middle effects (cross-reference RF-07/RF-08)?
5. What indexing freshness behavior is observable after file edits, branch switches, and large refactors?
6. How does Cursor likely handle large repos, monorepos, and generated/vendor code exclusion?
7. What failure patterns are visible in community reports (missed symbols, stale context, irrelevant snippets)?
8. Which parts of Cursor behavior imply AST/LSP-backed intelligence versus embedding-only search?
9. How should LCS separate “must-have” patterns from black-box assumptions that cannot be validated?
10. What benchmark scenarios should emulate Cursor-like workflows for LCS evaluation (multi-file edits, code explanation, dependency tracing)?
11. What operational tradeoffs are implied by Cursor’s UX expectations (latency targets vs quality)?
12. Which design choices are portable to LCS MCP architecture and which are product-specific UX choices?

## Starting Sources
- Cursor features page — https://www.cursor.com/features
- Cursor docs home — https://docs.cursor.com/
- Cursor codebase indexing docs — https://docs.cursor.com/context/codebase-indexing
- Cursor `@` symbols docs — https://docs.cursor.com/context/@-symbols/basic
- Cursor rules/context docs — https://docs.cursor.com/context/rules
- Cursor chat docs — https://docs.cursor.com/chat/overview
- Cursor composer docs — https://docs.cursor.com/composer/overview
- Cursor MCP docs — https://docs.cursor.com/advanced/model-context-protocol
- Cursor changelog — https://www.cursor.com/changelog
- Cursor community forum — https://forum.cursor.com/
- LSP specification (technical baseline) — https://microsoft.github.io/language-server-protocol/

## What to Measure, Compare, or Evaluate
- Documented capabilities vs inferred architecture assumptions.
- Behavior tests: freshness lag, symbol resolution success, context relevance under long files.
- Failure-case catalog from public forum patterns.
- Pattern extraction for LCS: indexing cadence, retrieval scoping, context controls.
- Portability and risk scoring for each inferred design element.
- Proposed LCS experiments to validate inferred patterns independently.

## Definition of Done
- A structured reverse-engineering report distinguishes observed facts from hypotheses.
- High-confidence design patterns are extracted with explicit evidence links.
- Unverifiable assumptions are marked and mapped to validation experiments.
- LCS adoption recommendations are provided for ADR-002 and ADR-004.
- A test plan exists to validate borrowed patterns in LCS prototypes.

## How Findings Feed LCS Architecture Decisions
This research informs ADR-002/004 with pragmatic codebase retrieval and context-management patterns drawn from a successful product, while avoiding blind copying of opaque behavior. It provides experiment hypotheses for LCS to prove or disprove before implementation.
