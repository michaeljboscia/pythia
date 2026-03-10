# Research Prompt: CI-05 Import and Dependency Graph Extraction (TypeScript/JavaScript at Scale)

## Research Objective
Design a reliable extraction pipeline for import and dependency graphs in TypeScript/JavaScript projects, including difficult real-world patterns such as barrel exports, path aliases, package subpath exports, and re-export chains. The research should produce a practical architecture for LCS graph ingestion that balances precision, completeness, and runtime cost. Findings feed ADR-005 and must interoperate with chunking/indexing assumptions from ADR-004.

## Research Questions
1. What dependency signals should be treated as first-class graph edges (`imports`, `re-exports`, `dynamic-import`, `type-only`, `runtime-require`, `peer-dependency`) and why?
2. How should the extractor resolve barrel exports (`index.ts`), nested re-export chains, and wildcard exports without creating duplicate or misleading edges?
3. How should `tsconfig` path aliases, monorepo workspaces, and package subpath exports be resolved deterministically?
4. What is the right division of labor between TypeScript Compiler API, ts-morph, and LSP data for dependency graph fidelity?
5. How should dynamic import patterns and conditional requires be represented when targets are non-deterministic?
6. What strategy handles external dependencies (`node_modules`) so graph signal remains useful without overwhelming local-project relationships?
7. How can the pipeline distinguish compile-time-only dependencies from runtime-critical dependencies for better retrieval reasoning?
8. What are the common false positives/false negatives in dependency extraction, and which ones are acceptable for LCS v1?
9. How should dependency edges be versioned and diffed across commits for living-corpus updates (cross-reference DM-05/DM-07)?
10. What performance optimizations are needed for incremental recomputation on changed files only?
11. How should generated code, transpiled outputs, and build artifacts be treated to avoid graph pollution?
12. What validation suite should be built to prevent regressions in extraction accuracy as language features evolve?

## Starting Sources
- TypeScript module resolution handbook — https://www.typescriptlang.org/docs/handbook/module-resolution.html
- TypeScript `paths` config reference — https://www.typescriptlang.org/tsconfig#paths
- Node.js package exports/subpath exports — https://nodejs.org/api/packages.html#subpath-exports
- TypeScript Compiler API guide — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- ts-morph documentation — https://ts-morph.com/
- Language Server Protocol specification — https://microsoft.github.io/language-server-protocol/
- dependency-cruiser repository — https://github.com/sverweij/dependency-cruiser
- Madge repository — https://github.com/pahen/madge
- tree-sitter docs (alternate parser path) — https://tree-sitter.github.io/tree-sitter/

## What to Measure, Compare, or Evaluate
- Edge-level precision/recall against a hand-labeled dependency truth set.
- Resolution success rate for aliases, barrel re-exports, and package subpath imports.
- Runtime cost: full-project extraction time, incremental update time, and memory usage.
- Graph usefulness metrics: cycle detection quality, orphan detection, and impact on code retrieval tasks.
- Noise control: proportion of external dependency edges vs internal architecture signal.
- Incremental correctness: how accurately changed files trigger minimal recomputation.
- Failure taxonomy: dynamic import ambiguity, unresolved symbols, generated-file contamination.

## Definition of Done
- A recommended extraction stack (APIs/tools + fallback order) is selected.
- Edge schema and semantics are documented with examples for each dependency type.
- Performance and accuracy thresholds for production readiness are defined.
- Incremental update strategy is specified for living-corpus operation.
- ADR-005 receives a concrete implementation plan and validation suite requirements.

## How Findings Feed LCS Architecture Decisions
This research defines the dependency-graph portion of ADR-005 and impacts ADR-004 chunk metadata because symbol/dependency IDs must be carried through indexing. It also improves retrieval explainability by enabling dependency-aware traversal rather than pure semantic similarity for code questions.
