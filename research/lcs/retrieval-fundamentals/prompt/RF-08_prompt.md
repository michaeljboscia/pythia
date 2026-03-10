# Research Prompt: RF-08 Context Window Packing Strategies (P0)

## Research Objective
Design and validate an LCS context packing policy that maximizes grounded answer quality under token budgets, explicitly accounting for primacy/recency bias and heterogeneous evidence dependencies. The research should produce a ranked strategy set with deterministic rules by query type and budget tier. Findings feed ADR-009 and cross-reference RF-07 and MC-04.

## Research Questions
1. Which packing orders outperform naive relevance sort: head-tail interleave, dependency-clustered, chronology-aware, type-aware, or diversity-first ordering?
2. When should LCS place strongest evidence at both edges versus a single front-loaded strategy?
3. How should packing preserve cross-artifact dependency chains (ADR decision -> code implementation -> tests/logs)?
4. How do packing strategies interact with reranker confidence errors and score uncertainty?
5. What chunk metadata is required from retrievers to support robust packing decisions (cross-reference MC-04)?
6. How should budget-aware truncation be done without severing key evidence chains?
7. Do explicit section boundaries and provenance tags improve model grounding in packed contexts?
8. What failure modes emerge when packing mixed code and prose (format switching, context fragmentation)?
9. How should packing adapt between single-hop and multi-hop queries?
10. Which strategy is most robust against adversarial distractors and near-duplicate chunks?
11. How much additional latency/complexity is acceptable for adaptive packing?
12. What objective test suite should gate changes to packing policy in production?

## Starting Sources
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- LangChain long-context reorder — https://python.langchain.com/docs/how_to/long_context_reorder/
- LangChain contextual compression docs — https://python.langchain.com/docs/how_to/contextual_compression/
- LlamaIndex node postprocessors — https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/
- LlamaIndex optimization basics — https://docs.llamaindex.ai/en/stable/optimizing/basic_strategies/basic_strategies/
- Cohere rerank overview — https://docs.cohere.com/docs/rerank-overview
- LongBench repo — https://github.com/THUDM/LongBench
- GraphRAG paper (global/local synthesis context) — https://arxiv.org/abs/2404.16130
- Self-RAG paper — https://arxiv.org/abs/2310.11511

## What to Measure, Compare, or Evaluate
- Head-to-head strategy leaderboard on fixed retrieval outputs.
- Metrics: grounded answer correctness, citation precision/recall, hallucination rate.
- Token efficiency: quality gain per additional 1k tokens.
- Dependency-chain preservation rate across artifact types.
- Latency overhead from packing logic and pre-processing.
- Robustness against distractor injection and ambiguity.

## Definition of Done
- A production-ready packing policy is specified for ADR-009 with deterministic tie-breakers.
- Budget-tier variants (small/medium/large context) are defined and benchmarked.
- Required retriever metadata contract for packers is documented (MC-04 linkage).
- Regression suite and canary checks are defined for policy updates.
- Explicit anti-patterns and no-go packing behaviors are listed.

## How Findings Feed LCS Architecture Decisions
Results define ADR-009 packing engine behavior and MC-04 context-budget interfaces. They operationalize RF-07 mitigation findings into implementable, measurable rules for production context assembly.
