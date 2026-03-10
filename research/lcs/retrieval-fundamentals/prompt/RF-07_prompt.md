# Research Prompt: RF-07 Lost-in-the-Middle (P0)

## Research Objective
Quantify and explain lost-in-the-middle degradation for LCS workloads, then identify mitigation strategies that improve grounded answer quality without unacceptable token/latency cost. The study must combine paper-level evidence with reproducible LCS-specific experiments across model families, context lengths, and artifact mixes. Findings feed ADR-009 and should explicitly cross-reference NL-04 and RF-08.

## Research Questions
1. How large is the answer-quality drop when key evidence is placed in the middle versus beginning/end of context for LCS query classes?
2. Which model families and context-window sizes show the steepest positional degradation curves?
3. How does degradation differ for code-heavy, ADR-heavy, and mixed artifact prompts?
4. Which mechanisms from attention/positioning theory best explain observed failures (cross-reference NL-04)?
5. How do chunk count, separator style, and metadata headers affect middle-position neglect?
6. Do high-quality reranked chunks still fail if packed in middle positions?
7. Which mitigations work best: edge duplication, long-context reordering, query-focused summaries, hierarchical prompting, or multi-pass retrieval?
8. What token/latency cost does each mitigation add, and what is the quality-per-token frontier?
9. How can LCS detect positional failures automatically in production telemetry (cross-reference EQ-06)?
10. What failure signatures indicate mitigation overfitting to benchmark tasks rather than real workloads?
11. How should packing policy adapt by question type (fact lookup vs synthesis vs multi-hop)?
12. What minimum evidence should block ADR-009 decisions for production rollout?

## Starting Sources
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- Lost in the Middle code — https://github.com/nelson-liu/lost-in-the-middle
- RoFormer (RoPE) — https://arxiv.org/abs/2104.09864
- ALiBi paper — https://arxiv.org/abs/2108.12409
- Attention Is All You Need — https://arxiv.org/abs/1706.03762
- LongBench benchmark repo — https://github.com/THUDM/LongBench
- LangChain long-context reorder — https://python.langchain.com/docs/how_to/long_context_reorder/
- LlamaIndex node postprocessors — https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/
- RAG production baseline paper — https://arxiv.org/abs/2005.11401

## What to Measure, Compare, or Evaluate
- Position sensitivity curves by placing gold evidence at 10%, 50%, and 90% context positions.
- Quality metrics: grounded correctness, citation fidelity, and omission error rate.
- Ablation of mitigation strategies under fixed retrieval/reranking outputs.
- Cost/latency impact per mitigation across small/medium/large context budgets.
- Robustness under distractor-heavy contexts and near-duplicate evidence.
- Cross-model variance and confidence intervals for reproducibility.

## Definition of Done
- A reproducible experiment harness and dataset split are documented.
- Degradation and mitigation curves are reported with statistical confidence.
- A default packing mitigation policy is specified for ADR-009 with fallback rules.
- Production detection signals are defined for positional-failure monitoring.
- Open risks and unresolved model-specific edge cases are explicitly listed.

## How Findings Feed LCS Architecture Decisions
This research sets ADR-009 guardrails for context assembly and directly informs RF-08 packing strategy defaults. It also provides mechanistic grounding from NL-04 and evaluation hooks for continuous monitoring under EQ-06.
