# Research Prompt: RF-12 Context Compression (Extractive vs Abstractive)

## Research Objective
Determine when context compression improves LCS answer quality and when it damages fidelity, with explicit guidance for compression policy under token constraints. Compare extractive compression, abstractive summarization, and selective-context approaches on grounded QA tasks with citation requirements. The deliverable must define safe compression boundaries for ADR-009.

## Research Questions
1. In LCS-like workloads, when does compression improve outcomes (less distraction, better focus) versus harm outcomes (dropped facts, broken provenance)?
2. How do extractive and abstractive compressors compare on factual retention, citation traceability, and hallucination risk?
3. What compression ratios are safe for different query classes (fact lookup, synthesis, multi-hop reasoning, code explanation)?
4. How does LLMLingua/LLMLingua-2 performance compare to generic summarization prompts and heuristic sentence filtering?
5. Should compression happen before reranking, after reranking, or only at final context assembly time?
6. How can LCS verify compressed context fidelity automatically (claim-level entailment checks, citation preservation checks, checksum-like evidence maps)?
7. What is the operational cost of compression (extra model calls, latency, complexity), and where is the break-even point?

## Starting Sources
- LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models — https://arxiv.org/abs/2310.05736
- LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression — https://arxiv.org/abs/2403.12968
- Microsoft LLMLingua repository — https://github.com/microsoft/LLMLingua
- LangChain contextual compression retriever docs — https://python.langchain.com/docs/how_to/contextual_compression/
- LlamaIndex node postprocessors and optimization docs — https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/
- Self-RAG paper (self-critique and retrieval-aware generation context) — https://arxiv.org/abs/2310.11511

## What to Measure, Compare, or Evaluate
- Fidelity metrics: claim retention rate, citation preservation rate, and contradiction/introduction error rate.
- Utility metrics: downstream answer correctness and groundedness before vs after compression.
- Efficiency metrics: context-token reduction, added compression latency, and total cost per answered query.
- Compression-ratio sweep: quality at 0.9x, 0.7x, 0.5x, and 0.3x retained-token budgets.
- Placement ablation: pre-rerank compression, post-rerank compression, final-window compression only.
- Safety checks: false-positive confidence cases where compressed context appears coherent but is wrong.

## Definition of Done
- A decision table exists mapping query type -> compression strategy -> max safe compression ratio.
- At least one extractive and one abstractive method are benchmarked on the same evaluation set.
- A fidelity guardrail spec is written (automatic checks required before compressed context is accepted).
- A clear default policy is provided for LCS v1, including “no-compress” conditions.
- ADR-009 receives explicit implementation rules, thresholds, and monitoring requirements.

## How Findings Feed LCS Architecture Decisions
This research defines whether compression is mandatory, optional, or prohibited by default in ADR-009. It also influences ADR-010 evaluation design by adding fidelity-specific regression tests and determines what metadata LCS must preserve through retrieval and packing to keep compression auditable.
