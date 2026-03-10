# Research Prompt: CI-06 Test File Detection and Coverage Linking

## Research Objective
Build a robust methodology for identifying test files and linking them to source artifacts in LCS, then augment that linkage with coverage evidence where available. The research must address heterogeneous testing setups (Jest, Vitest, monorepos, custom conventions) and produce reliable graph edges for “what validates this code?” queries. Findings feed ADR-005.

## Research Questions
1. What heuristics reliably identify test files across naming conventions (`*.test.ts`, `*.spec.ts`, `__tests__`, integration/e2e directories) without overmatching?
2. How should configuration files (Jest/Vitest) be parsed to discover non-standard test roots, file extensions, and project-level overrides?
3. What is the best strategy to link tests to source: path heuristics, import graph tracing, `--findRelatedTests`, coverage maps, or hybrid scoring?
4. How should parameterized tests, shared fixtures, and helper utilities be modeled so linkage signal is not diluted?
5. What coverage artifacts (LCOV, Istanbul JSON, V8 coverage) are practical for LCS ingestion and long-term provenance tracking?
6. How should flaky tests, skipped tests, and failing tests be represented in graph metadata without misleading retrieval answers?
7. How can the pipeline distinguish true validation tests from smoke checks or snapshots that provide weak behavioral guarantees?
8. What is the minimum viable approach when runtime coverage data is unavailable (static-only inference fallback)?
9. How should monorepo/multi-project setups with multiple Jest/Vitest configs be normalized into one graph model?
10. What refresh strategy is needed to keep test-to-source links current as files move or tests are renamed (cross-reference DM-05)?
11. Which false-link errors are most damaging to LCS trust, and what confidence thresholds should gate edge creation?
12. How should CI-derived test outcomes be integrated so retrieval can answer “is this path currently tested and passing?”

## Starting Sources
- Jest configuration docs — https://jestjs.io/docs/configuration
- Jest CLI docs (`--findRelatedTests`) — https://jestjs.io/docs/cli#--findrelatedtests-spaceseparatedlistofsourc
- Jest coverage config (`collectCoverageFrom`) — https://jestjs.io/docs/29.7/configuration#collectcoveragefrom-array
- Vitest coverage guide — https://vitest.dev/guide/coverage.html
- Istanbul documentation — https://istanbul.js.org/
- NYC repository — https://github.com/istanbuljs/nyc
- LCOV documentation — https://lcov.readthedocs.io/
- TypeScript Compiler API guide — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- dependency-cruiser repository (graph-based linkage support) — https://github.com/sverweij/dependency-cruiser

## What to Measure, Compare, or Evaluate
- Test-file detection precision/recall on representative repos with varied conventions.
- Source-link accuracy: percentage of test edges that correctly map to owning source modules.
- Coverage-link completeness: proportion of source files with valid coverage-backed test edges.
- Confidence calibration: correlation between edge confidence score and correctness.
- Runtime overhead: scanning/parsing time, coverage ingestion time, incremental refresh cost.
- Drift resilience: link stability under file renames, moves, and refactors.
- Utility impact: improvement in answer quality for test-related queries in LCS evaluations.

## Definition of Done
- A layered detection/linking strategy is specified (heuristics + static analysis + optional runtime coverage).
- Edge schema includes source, evidence type, confidence, and freshness metadata.
- Minimum quality thresholds are defined for automatic edge creation vs “needs review.”
- Incremental update and stale-edge cleanup procedures are documented.
- ADR-005 receives implementation-ready guidance for test intelligence ingestion.

## How Findings Feed LCS Architecture Decisions
This work defines how ADR-005 represents verification relationships and strengthens code-query grounding in LCS. It also feeds ADR-010 evaluation design by enabling targeted testability/coverage query benchmarks and reliability signals.
