# Research Prompt: RF-10 RAG Production Patterns and Failure Modes

## Research Objective
Map the gap between academic RAG performance claims and what actually works in production systems that serve real users, noisy corpora, and evolving data. Build a practical pattern catalog for LCS covering retrieval architecture, guardrails, observability, and failure handling. The result should guide cross-ADR decisions, not just retrieval components.

## Research Questions
1. Which production RAG architecture patterns are consistently used by mature systems (two-stage retrieval, hybrid search, reranking, tool-augmented grounding, query rewriting)?
2. What are the highest-frequency production failure modes (hallucinated citations, stale context, wrong chunk selected, over-compression, context overflow), and how are they mitigated?
3. Which benchmark wins fail to transfer to production and why (domain mismatch, query distribution shift, weak evaluation sets, prompt overfitting)?
4. How do production teams enforce grounding quality: citation validation, answer abstention thresholds, source-attribution constraints, or verifier passes?
5. What operational patterns reduce incident rate: canary index rollouts, shadow evaluation, regression test suites, and offline replay against golden queries?
6. How are latency and cost budgets managed in practice across retriever, reranker, and generator stages?
7. What organizational/process patterns matter most (quality ownership, continuous eval cadence, incident postmortems, ADR discipline)?
8. Which patterns are over-engineered for an LCS v1 scope and should be deferred to later phases?

## Starting Sources
- Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks (foundational RAG paper) — https://arxiv.org/abs/2005.11401
- Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection — https://arxiv.org/abs/2310.11511
- CRAG: Corrective Retrieval Augmented Generation — https://arxiv.org/abs/2401.15884
- LangChain retrieval and RAG docs — https://python.langchain.com/docs/concepts/retrieval/
- LlamaIndex framework docs (retrieval/query orchestration patterns) — https://docs.llamaindex.ai/
- Haystack docs (production pipeline patterns and components) — https://docs.haystack.deepset.ai/docs/intro
- Pinecone RAG engineering guide series — https://www.pinecone.io/learn/series/rag/

## What to Measure, Compare, or Evaluate
- Pattern efficacy matrix: quality, latency, complexity, and failure resilience per architecture pattern.
- Failure-mode frequency and severity taxonomy from case studies and open-source issue trackers.
- Cost model: per-query token/compute budget by stage and sensitivity to traffic growth.
- Operational maturity scorecard: observability, rollback safety, drift detection, and test coverage.
- Transferability score: how well each pattern fits LCS constraints (single project corpus, mixed artifact types, MCP interface).

## Definition of Done
- A production pattern catalog exists with recommended, optional, and deferred patterns for LCS.
- A failure mode playbook is documented with detection signals and concrete mitigations.
- Explicit anti-patterns are identified (what not to implement in v1 despite benchmark appeal).
- A phased implementation sequence is defined (v1 baseline, v1.5 hardening, v2 advanced controls).
- Clear ADR inputs are written for all impacted areas (retrieval, graph, MCP, evaluation, operations).

## How Findings Feed LCS Architecture Decisions
This research informs all core ADRs by defining the minimum viable production architecture and hardening roadmap. It sets guardrails for ADR-002/003/004/009 technical choices, feeds ADR-010 monitoring and evaluation requirements, and influences ADR-006 event/update mechanics by identifying freshness-related failure patterns.
