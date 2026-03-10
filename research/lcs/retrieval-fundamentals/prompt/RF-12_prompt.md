# Research Prompt: RF-12 Context Compression (Extractive vs Abstractive) (P2)

## Research Objective
Evaluate context compression techniques for LCS to determine where compression improves relevance and where it introduces fidelity loss or citation breakage. The research should provide policy-level rules for if/when compression is allowed under different query classes and confidence states. Findings feed ADR-009 and cross-reference RF-08 and RF-07.

## Research Questions
1. When does compression improve answer quality by reducing distractor load, and when does it remove critical evidence?
2. How do extractive and abstractive compression methods compare on fidelity, traceability, and hallucination risk?
3. What compression ratios are safe by task type (lookup, synthesis, multi-hop, code explanation)?
4. How do LLMLingua variants compare with generic summarization-based compression?
5. Should compression occur pre-rerank, post-rerank, or only in final packing stage?
6. How should compression preserve provenance and chunk-level citations?
7. What automatic checks can detect over-compression or semantic drift before generation?
8. How does compression interact with positional bias and middle-loss mitigation (RF-07/RF-08)?
9. What are latency/token cost break-even points for compression pipelines?
10. Which edge cases are high risk: contradictory evidence, numerically dense content, long code snippets?
11. How should fallback behavior work when fidelity checks fail?
12. What default compression policy should ADR-009 encode for v1 versus v2?

## Starting Sources
- LLMLingua paper — https://arxiv.org/abs/2310.05736
- LLMLingua-2 paper — https://arxiv.org/abs/2403.12968
- LLMLingua repository — https://github.com/microsoft/LLMLingua
- LangChain contextual compression — https://python.langchain.com/docs/how_to/contextual_compression/
- LlamaIndex node postprocessors — https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/
- Self-RAG paper — https://arxiv.org/abs/2310.11511
- CRAG paper — https://arxiv.org/abs/2401.15884
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- LongBench repository — https://github.com/THUDM/LongBench

## What to Measure, Compare, or Evaluate
- Fidelity metrics: claim retention, citation preservation, contradiction introduction rate.
- Utility metrics: downstream answer correctness/groundedness before vs after compression.
- Efficiency metrics: token reduction, latency overhead, cost-per-query changes.
- Placement ablation: pre-rerank vs post-rerank vs final-window compression.
- Safety checks performance: false-pass and false-fail rates for fidelity validators.
- Risk profiling by query class and artifact type.

## Definition of Done
- A compression decision table is produced by query type and risk level.
- At least one extractive and one abstractive method are benchmarked end-to-end.
- Fidelity guardrails and automatic rejection criteria are defined.
- A default ADR-009 compression policy (including no-compress conditions) is specified.
- Monitoring hooks for compression-induced regressions are documented.

## How Findings Feed LCS Architecture Decisions
This research defines whether context compression is optional or standard in ADR-009 and under what controls. It ties compression strategy to packing policy (RF-08) and positional robustness concerns (RF-07), ensuring quality gains are not bought with silent fidelity loss.
