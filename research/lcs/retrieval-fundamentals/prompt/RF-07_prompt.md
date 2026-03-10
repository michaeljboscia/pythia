# Research Prompt: RF-07 Lost-in-the-Middle in Long-Context LLMs

## Research Objective
Establish a decision-grade understanding of the lost-in-the-middle effect and its practical impact on LCS answer quality when retrieved evidence is packed into long contexts. Quantify how evidence position affects retrieval-grounded QA performance across model families and context lengths, then identify mitigations with reproducible gains. The output must directly inform ADR-009 (Context Assembly and Packing Policy).

## Research Questions
1. What is the measured performance drop when the same supporting passage is placed at the beginning, middle, or end of context, and how large is the delta by task type (fact lookup vs synthesis vs multi-hop reasoning)?
2. Which model families show the steepest middle-position degradation, and which are most robust at 16k, 32k, 128k, and 200k+ token windows?
3. Does the degradation pattern change when context includes heterogeneous artifact types (code snippets, ADR text, logs, and prose) rather than homogeneous passages?
4. How does retrieval quality interact with positional bias: does stronger top-k relevance compensate for middle placement, or does position dominate regardless of retrieval score?
5. Which mitigations are empirically validated: result reordering, evidence duplication near edges, query-focused summaries, section headers, or hierarchical prompting?
6. What are the failure signatures in production traces (high-confidence wrong answers, citation mismatch, omission of central evidence), and how can LCS detect them automatically?
7. What is the token-cost vs quality tradeoff for each mitigation, and which mitigation set is Pareto-optimal for LCS latency and budget constraints?

## Starting Sources
- Lost in the Middle: How Language Models Use Long Contexts (Liu et al.) — https://arxiv.org/abs/2307.03172
- Official benchmark code for Lost in the Middle — https://github.com/nelson-liu/lost-in-the-middle
- LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding — https://github.com/THUDM/LongBench
- RAG original paper (for baseline retrieval-grounded generation assumptions) — https://arxiv.org/abs/2005.11401
- LlamaIndex node postprocessors (for practical reordering/compression hooks) — https://docs.llamaindex.ai/en/stable/module_guides/querying/node_postprocessors/
- LangChain long-context reordering strategy docs — https://python.langchain.com/docs/how_to/long_context_reorder/

## What to Measure, Compare, or Evaluate
- Position sensitivity curve: answer correctness and citation correctness when gold evidence is inserted at 0-10%, 45-55%, and 90-100% of context.
- Degradation slope by model/context window: delta in exact match / judge score between edge and middle positions.
- Citation fidelity: percent of answers that cite the relevant chunk ID when evidence is in middle positions.
- Mitigation ablation matrix: reorder only, duplicate only, reorder+duplicate, reorder+summary, hierarchical prompts.
- Cost/latency overhead: added tokens, median latency, p95 latency, and throughput impact per mitigation.
- Robustness under noise: effect of adding distractor chunks with high lexical overlap.

## Definition of Done
- A reproducible experiment protocol exists with fixed datasets, prompts, and scoring rules.
- The report includes degradation curves by position and model, not just anecdotal examples.
- At least two mitigation strategies are shown to provide statistically meaningful improvement over baseline packing.
- A recommended default packing policy for LCS is stated with explicit quality, latency, and token-cost rationale.
- Open risks are documented (for example, model-specific brittleness or unresolved edge cases in mixed code+prose contexts).

## How Findings Feed LCS Architecture Decisions
This research sets hard requirements for ADR-009 context assembly: ordering policy, duplication rules, and truncation strategy. It also constrains retriever/reranker interfaces to emit fields needed for packing heuristics (salience, dependency group, artifact type), and defines telemetry signals LCS should log to detect positional-failure regressions in production.
