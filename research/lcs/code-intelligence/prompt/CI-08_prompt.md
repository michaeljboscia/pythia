# Research Prompt: CI-08 Code Search in Practice (Sourcegraph, GitHub Code Search, Cursor, Cody)

## Research Objective
Study production code-search systems to identify proven architectural patterns and anti-patterns for repository-scale retrieval in LCS. Compare how Sourcegraph, GitHub code search, Cursor, and Cody combine indexing, ranking, structural signals, and context assembly. The deliverable should translate external lessons into actionable decisions for ADR-002 and ADR-004.

## Research Questions
1. What index structures and retrieval stacks do production code search systems use (trigram, inverted index, symbol index, embeddings, hybrid pipelines)?
2. How do these systems balance lexical precision (exact symbol/path match) with semantic relevance for natural-language developer queries?
3. What ranking features appear most predictive in practice (path signals, symbol type, recency, repo importance, structural proximity, query intent)?
4. How do Sourcegraph and GitHub code search handle large monorepos, incremental indexing, and near-real-time freshness?
5. What architectural clues are available for Cursor/Cody context assembly, and which capabilities appear to rely on structural code intelligence versus semantic retrieval?
6. How do production systems expose explainability to users (why this result ranked high) and what can LCS borrow for trust?
7. What known failure modes occur (identifier ambiguity, stale index, semantic drift, over-broad regex hits), and what mitigations are used?
8. How do these systems treat generated files, vendored code, and binary artifacts to reduce noise?
9. Which patterns are directly portable to LCS scope and which require infrastructure that is unjustified for v1?
10. How do operational tradeoffs change between single-repo local usage and multi-repo cloud-scale products?
11. What retrieval telemetry do mature systems capture to continuously improve ranking quality (cross-reference EQ-06, RF-10)?
12. Where should LCS deliberately diverge because its core task includes ADR/document reasoning alongside code search?

## Starting Sources
- Sourcegraph code search docs — https://sourcegraph.com/docs/code_search
- Zoekt repository (Sourcegraph’s search engine) — https://github.com/sourcegraph/zoekt
- Sourcegraph Cody product docs — https://sourcegraph.com/cody
- GitHub engineering blog on new code search — https://github.blog/2023-02-06-the-technology-behind-githubs-new-code-search/
- GitHub Code Search syntax docs — https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax
- ripgrep repository (baseline local code search engine) — https://github.com/BurntSushi/ripgrep
- Cursor features page (public product capabilities) — https://cursor.com/features
- Language Server Protocol specification — https://microsoft.github.io/language-server-protocol/
- TypeScript Compiler API guide — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API

## What to Measure, Compare, or Evaluate
- Pattern extraction matrix: index types, ranking signals, freshness strategy, and context assembly approach per system.
- LCS-fit scoring: portability, implementation complexity, expected quality impact, and operational burden.
- Benchmark design: code search query set for identifier, symbol, dependency, and intent-based questions.
- Hybrid strategy tests: lexical-only vs semantic-only vs fused retrieval on LCS code corpora.
- Freshness performance: indexing lag and stale-result rate under simulated commit streams.
- Explainability quality: ability to produce user-facing rationales for ranked results.
- Noise suppression effectiveness: generated/vendor exclusion strategies and false positive reduction.

## Definition of Done
- A comparative architecture report is produced with reusable patterns, non-portable patterns, and anti-patterns.
- A recommended LCS code search stack is defined (minimum viable + optional enhancements).
- Ranking signal priorities and telemetry requirements are documented.
- A benchmark plan exists for ongoing code-search relevance regression testing.
- ADR-002 and ADR-004 receive concrete decisions and implementation sequencing guidance.

## How Findings Feed LCS Architecture Decisions
This research informs ADR-002 retrieval architecture (lexical/semantic/hybrid strategy) and ADR-004 code indexing design. It also provides evaluation inputs for ADR-010 by defining practical code-search quality benchmarks and failure signals rooted in real production systems.
