# Research Prompt: RF-08 Context Window Packing Strategies

## Research Objective
Determine the highest-yield context packing strategy for LCS given known primacy/recency biases and mixed artifact retrieval (code, docs, ADRs, logs). The goal is to move from ad hoc chunk concatenation to a measurable packing policy that maximizes grounded answer quality under strict token budgets. The output should translate directly into implementable packing algorithms and defaults for ADR-009.

## Research Questions
1. Which packing orders outperform naive relevance sorting: edge-biased ordering, query-intent grouping, chronology-first, type-clustered, or interleaved diversity packing?
2. When should LCS place synthesis-critical chunks at the front vs end, and does the optimal placement differ for single-hop vs multi-hop questions?
3. How should packing handle cross-artifact dependencies (for example, ADR decision + code implementation + test evidence) so related chunks are not separated by irrelevant context?
4. Does intentional redundancy (duplicating top evidence near both head and tail) improve answer accuracy enough to justify added token cost?
5. How do section separators, provenance headers, and per-chunk metadata labels affect model grounding and citation behavior?
6. What packing strategy best resists distractor interference when multiple highly similar chunks compete for attention?
7. How sensitive are outcomes to reranker confidence calibration errors (for example, if rank 2 is truly better than rank 1 for synthesis)?

## Starting Sources
- Lost in the Middle paper (position bias foundation) — https://arxiv.org/abs/2307.03172
- LangChain long-context reorder guide — https://python.langchain.com/docs/how_to/long_context_reorder/
- LlamaIndex node postprocessor docs (reordering/metadata-aware postprocessing) — https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/node_postprocessors/
- LlamaIndex optimization basics (token budget and retrieval controls) — https://docs.llamaindex.ai/en/stable/optimizing/basic_strategies/basic_strategies/
- Cohere rerank overview (ranking confidence in packing pipelines) — https://docs.cohere.com/docs/rerank-overview
- LongBench benchmark repository (long-context eval tasks) — https://github.com/THUDM/LongBench

## What to Measure, Compare, or Evaluate
- Packing strategy bake-off: compare at least five ordering algorithms under fixed retriever/reranker outputs.
- Grounded answer quality: factual correctness, citation precision/recall, and hallucination rate.
- Token efficiency: quality-per-1k-context-tokens and marginal gain per additional chunk.
- Interference robustness: performance under deliberately injected near-duplicate distractors.
- Dependency coherence: percent of answers that correctly combine required multi-artifact evidence.
- Runtime behavior: added pre-processing latency and complexity of each packing algorithm.

## Definition of Done
- A ranked packing strategy leaderboard exists with confidence intervals and clear winners by query class.
- A production-ready default policy is specified with deterministic tie-break rules and fallback behavior.
- Token budget tiers are defined (for example, small/medium/large contexts) with packing variants for each tier.
- A monitoring spec is written for packing regressions (what to log and alert on in production).
- A concrete implementation plan exists for LCS MCP tool responses and ADR-009 updates.

## How Findings Feed LCS Architecture Decisions
Results define the core packing engine contract in ADR-009 and shape how retriever and reranker outputs are serialized for the generation layer. Findings also influence ADR-007 tool response schema design (metadata needed for packing) and determine whether LCS should support adaptive packing per query class instead of a single global policy.
