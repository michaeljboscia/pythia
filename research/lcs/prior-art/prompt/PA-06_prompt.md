# Research Prompt: PA-06 LangChain RAG Patterns (What’s Standard vs Over-Engineered)

## Research Objective
Systematically evaluate LangChain’s RAG patterns, components, and abstractions to identify which are useful reference architectures for LCS and which introduce unnecessary complexity. The goal is to extract stable patterns for ingestion, splitting, retrieval, reranking, and orchestration while flagging abstraction overhead that can hurt reliability. Findings feed all ADRs, with strongest links to ADR-002, ADR-004, ADR-007, and ADR-010.

## Research Questions
1. Which LangChain RAG architecture patterns are widely adopted and robust in production versus experimental?
2. How do document loaders and splitter abstractions map to LCS artifact diversity (code, ADRs, logs, docs)?
3. What retriever composition patterns (multi-query, compression, hybrid) are effective, and where do they fail under real workloads?
4. How do LangChain evaluation and observability integrations support continuous quality control (cross-reference EQ-01/EQ-06)?
5. Which chain/agent abstractions add flexibility versus introducing brittle complexity and debugging difficulty?
6. How should LCS treat LangChain as reference vs dependency: adopt interfaces, borrow concepts, or avoid heavy coupling?
7. What failure modes recur in LangChain-based RAG systems (tool loops, context bloat, hidden retries, silent fallback behavior)?
8. Which features are essential for LCS v1 and which are over-engineered for current scope?
9. How do LangChain patterns compare with LlamaIndex patterns for graph+vector integration (cross-reference PA-07)?
10. What operational controls (timeouts, retries, tracing, version pinning) are required when using LangChain-style composition?
11. How does LangChain support MCP-era tool/resource separation and where are gaps?
12. What minimal, testable architecture should LCS adopt inspired by LangChain without inheriting framework lock-in?

## Starting Sources
- LangChain repository — https://github.com/langchain-ai/langchain
- LangChain docs home — https://python.langchain.com/docs/
- LangChain RAG concept docs — https://python.langchain.com/docs/concepts/rag/
- LangChain retrieval concept docs — https://python.langchain.com/docs/concepts/retrieval/
- LangChain text splitter concepts — https://python.langchain.com/docs/concepts/text_splitters/
- LangChain evaluation concepts — https://python.langchain.com/docs/concepts/evaluation/
- LangSmith SDK repository (observability) — https://github.com/langchain-ai/langsmith-sdk
- OpenEvals repository — https://github.com/langchain-ai/openevals
- RAG paper baseline — https://arxiv.org/abs/2005.11401
- CRAG paper — https://arxiv.org/abs/2401.15884

## What to Measure, Compare, or Evaluate
- Pattern inventory: core components, maturity level, and failure susceptibility.
- Complexity cost: lines of glue code, debugging surface, runtime overhead.
- Quality impact: retrieval/answer metrics for representative patterns.
- Observability readiness: tracing, failure attribution, and testability.
- Coupling risk: ability to swap components without large rewrites.
- LCS-fit matrix: adopt as-is, adapt, or avoid for each major pattern.

## Definition of Done
- A curated LangChain pattern catalog is produced with maturity and risk ratings.
- Recommended LCS subset is defined with explicit non-goals.
- Over-engineered patterns for LCS scope are explicitly rejected with rationale.
- Integration guidelines are documented to preserve portability.
- All-ADR implications are summarized with concrete decision hooks.

## How Findings Feed LCS Architecture Decisions
This research prevents framework-driven overdesign and helps ADRs adopt proven compositional patterns selectively. It informs ADR-004 ingestion abstractions, ADR-002 retrieval orchestration, ADR-007 tool surface design, and ADR-010 evaluation instrumentation.
