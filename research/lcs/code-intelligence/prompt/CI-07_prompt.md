# Research Prompt: CI-07 AST-Based Code Analysis Fundamentals (AST, CFG, Data Flow)

## Research Objective
Establish the practical foundations needed to build LCS code intelligence on ASTs, control-flow graphs (CFG), and data-flow analysis rather than surface text alone. The goal is to define what level of static analysis is necessary for v1 versus deferred to v2, and how to avoid overbuilding. Findings feed ADR-004 (chunking/representation) and ADR-005 (relationship extraction).

## Research Questions
1. Which AST representations are most suitable for LCS workflows in TypeScript/JavaScript (TypeScript AST, Babel AST, tree-sitter CST/AST bridges), and what are compatibility tradeoffs?
2. What code relationships can be extracted accurately from AST-only analysis versus requiring CFG or data-flow layers?
3. When is CFG necessary for meaningful reasoning (branch-sensitive behavior, exception paths, async control flow), and when is it overkill?
4. What data-flow analyses are realistically implementable for LCS scope (definition-use chains, taint-like propagation, symbol lifetimes)?
5. How should async/await, callbacks, higher-order functions, and dynamic property access be represented to avoid false certainty?
6. What precision limits should be accepted in dynamic JavaScript environments, and how should uncertainty be encoded in graph edges?
7. How can static analysis outputs be chunked and indexed so retrieval can leverage structure without context bloat (cross-reference RF-09)?
8. Which existing ecosystems (CodeQL, ESLint, Semgrep) can be leveraged instead of building analysis primitives from scratch?
9. What are the compute/runtime costs for AST+CFG+data-flow pipelines on medium repositories, and what incremental strategies reduce cost?
10. How should analysis artifacts be versioned and invalidated when source files change (cross-reference DM-05/PE-03)?
11. What false positives and blind spots are most damaging to downstream retrieval trust?
12. What minimal “analysis depth profile” should be required for LCS v1 to unlock meaningful code-centric answers?

## Starting Sources
- tree-sitter documentation — https://tree-sitter.github.io/tree-sitter/
- Babel parser documentation — https://babel.dev/docs/babel-parser
- Babel traverse documentation — https://babel.dev/docs/babel-traverse
- TypeScript Compiler API guide — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- ESLint custom rules docs (AST traversal patterns) — https://eslint.org/docs/latest/extend/custom-rules
- CodeQL data flow analysis guide — https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/
- Semgrep rule syntax docs — https://semgrep.dev/docs/writing-rules/rule-syntax
- ts-morph documentation — https://ts-morph.com/
- LSP specification (semantic index integration) — https://microsoft.github.io/language-server-protocol/

## What to Measure, Compare, or Evaluate
- Extraction quality by analysis depth: AST-only vs AST+CFG vs AST+CFG+data-flow.
- Runtime economics: full analysis time, incremental re-analysis time, memory usage.
- Relationship yield: number and precision of call/dependency/symbol edges per approach.
- Query impact: improvement on code reasoning questions in evaluation harness.
- Uncertainty handling quality: frequency of overconfident incorrect edges.
- Maintainability: implementation complexity and tooling ecosystem leverage.
- Compatibility: behavior across TS features, transpiled JS, and mixed syntax projects.

## Definition of Done
- A clear analysis-depth recommendation is produced for v1 and v2.
- Edge taxonomy and confidence semantics are specified for outputs of each layer.
- Toolchain choices are documented with integration boundaries and fallback paths.
- Performance ceilings and incremental analysis strategy are defined.
- ADR-004/ADR-005 receive implementation-grade scope boundaries and constraints.

## How Findings Feed LCS Architecture Decisions
This research determines how structural code intelligence is represented in ADR-004 and extracted in ADR-005. It directly impacts retrieval fidelity for code-focused queries by deciding whether LCS can reason over semantics (flows, references, behavior hints) or only lexical/syntactic proximity.
