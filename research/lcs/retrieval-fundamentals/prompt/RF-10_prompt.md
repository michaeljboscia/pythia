# Research Prompt: RF-10 RAG Production Patterns (P0)

## Research Objective
Map proven production RAG architecture patterns and anti-patterns relevant to LCS, emphasizing what survives real workloads, changing corpora, and operational constraints. The study should produce a pragmatic implementation roadmap with phased complexity, not an academic survey alone. Findings feed all ADRs and cross-reference PA-06 and EQ-01.

## Research Questions
1. Which production RAG components are consistently high-value (hybrid retrieval, reranking, validation, caching, canary evals)?
2. What benchmark-strong patterns fail in production and why?
3. Which failure modes dominate real systems (stale context, citation mismatch, false confidence, pipeline drift)?
4. How do mature systems enforce grounding and refusal behavior under uncertainty?
5. What observability practices best correlate quality regressions with root causes?
6. How do teams balance latency, quality, and cost across retriever/reranker/generator stages?
7. Which deployment patterns reduce blast radius for retrieval/index/model changes?
8. What governance practices keep retrieval quality from silently degrading over time?
9. How do framework-heavy stacks (PA-06) compare with lean custom stacks operationally?
10. Which patterns are must-have for LCS v1 versus explicit v2 deferrals?
11. How should LCS treat graph-enhanced RAG patterns from KG/PA domains in production?
12. What explicit anti-pattern list should be codified before ADR implementation?

## Starting Sources
- RAG foundational paper — https://arxiv.org/abs/2005.11401
- Self-RAG paper — https://arxiv.org/abs/2310.11511
- CRAG paper — https://arxiv.org/abs/2401.15884
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- LangChain RAG concepts — https://python.langchain.com/docs/concepts/rag/
- LlamaIndex docs — https://docs.llamaindex.ai/
- Haystack docs — https://docs.haystack.deepset.ai/docs/intro
- Pinecone RAG series — https://www.pinecone.io/learn/series/rag/
- RAGAS docs — https://docs.ragas.io/
- OpenAI Evals repo — https://github.com/openai/evals

## What to Measure, Compare, or Evaluate
- Pattern efficacy matrix: quality lift, latency cost, implementation complexity.
- Failure-mode prevalence and severity under production-like workloads.
- Recovery/readiness scoring: rollback safety, observability, reproducibility.
- Cost-per-quality comparisons across architecture variants.
- Transferability assessment to LCS constraints and roadmap phases.
- Framework dependency risk (lock-in, debugging overhead).

## Definition of Done
- A production pattern catalog is produced with adopt/defer/reject recommendations.
- A failure playbook maps symptoms to mitigation actions.
- A phased LCS roadmap (v1/v1.5/v2) is explicitly defined.
- Release-gate criteria are aligned with EQ-01/EQ-06 metrics.
- All ADRs receive concrete inputs and dependency assumptions.

## How Findings Feed LCS Architecture Decisions
This research supplies cross-ADR implementation discipline by translating real-world RAG lessons into explicit design constraints. It anchors architecture choices in operational reality and provides the quality-control backbone needed for iterative LCS rollout.
