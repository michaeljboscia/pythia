# Research Prompt: NL-04 Transformer Attention and Positional Encoding (RoPE, ALiBi, Lost-in-the-Middle Root Causes)

## Research Objective
Build a practical understanding of long-context attention behavior and positional encoding choices (RoPE, ALiBi, related variants) to explain and mitigate lost-in-the-middle degradation in LCS context assembly. The goal is not model training, but architecture-level guidance on context ordering, compression, and evaluation. Findings feed ADR-009 and should cross-reference RF-07, RF-08, and EQ-03.

## Research Questions
1. How do self-attention and positional encoding jointly shape token salience across long contexts?
2. What are the mathematical and empirical differences between RoPE and ALiBi in long-range generalization?
3. Which empirical findings best explain primacy/recency bias and middle-position neglect?
4. How do different model families behave under identical position-shift experiments?
5. What context packing strategies are theoretically supported by attention behavior (cross-reference RF-08)?
6. How do chunk count, separator tokens, and metadata headers influence effective attention allocation?
7. What role does context compression play in reducing attention dilution versus introducing information loss?
8. How should LCS benchmark positional robustness during retriever/packer changes?
9. What edge cases worsen attention failures (highly similar chunks, long code blocks, repeated boilerplate)?
10. Which mitigations are low-cost and production-feasible vs research-heavy?
11. How do extended-context techniques (position interpolation, extrapolation hacks) affect reliability?
12. What concrete guardrails should ADR-009 specify based on these findings?

## Starting Sources
- Attention Is All You Need — https://arxiv.org/abs/1706.03762
- RoFormer (RoPE) paper — https://arxiv.org/abs/2104.09864
- ALiBi paper — https://arxiv.org/abs/2108.12409
- Position Interpolation paper — https://arxiv.org/abs/2306.15595
- Lost in the Middle paper — https://arxiv.org/abs/2307.03172
- LongBench benchmark repo — https://github.com/THUDM/LongBench
- YaRN long-context scaling paper — https://arxiv.org/abs/2309.00071
- NTK-aware scaled RoPE note/paper context — https://arxiv.org/abs/2306.15595
- FlashAttention-2 paper (attention compute constraints) — https://arxiv.org/abs/2307.08691

## What to Measure, Compare, or Evaluate
- Position sensitivity curves with fixed evidence moved across context locations.
- Accuracy/citation changes across packing policies and context lengths.
- Mitigation ablations: reorder, duplicate, summarize, hierarchical prompts.
- Failure rates on long code+prose blended contexts.
- Cost impact of mitigation policies (tokens, latency, rerun rate).
- Correlation between positional robustness metrics and production answer quality.

## Definition of Done
- A practical attention-behavior memo links theory to actionable packing rules.
- Position-robustness test protocol is defined for ongoing regression tests.
- ADR-009 mitigation defaults and no-go patterns are explicitly documented.
- Open risks are listed where model-specific behavior remains unpredictable.
- Evaluation hooks are defined for EQ-06 continuous monitoring.

## How Findings Feed LCS Architecture Decisions
This research supplies ADR-009 with mechanistic justification for context assembly policies, reducing trial-and-error tuning. It also tightens RF-07 mitigation decisions and provides positional robustness checks for release gating under ADR-010.
