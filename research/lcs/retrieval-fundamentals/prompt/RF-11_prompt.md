# Research Prompt: RF-11 Query Decomposition Strategies (P1)

## Research Objective
Determine whether query decomposition materially improves LCS multi-hop retrieval and synthesis, and define when decomposition should be triggered versus avoided. The study must compare decomposition families under realistic latency and reliability constraints, with explicit orchestration implications. Findings feed ADR-007 and cross-reference MC-03 and EQ-05.

## Research Questions
1. How do least-to-most, step-back, decomposed prompting, and retrieval-interleaved reasoning compare on multi-hop recall?
2. What decomposition depth is optimal before error propagation outweighs retrieval gains?
3. How should LCS decide decomposition triggers (classifier, heuristic, confidence-based gating)?
4. What output schema should decomposers emit for deterministic tool orchestration (MC-03 linkage)?
5. How does decomposition interact with graph traversal retrieval and hybrid search strategies?
6. What latency/cost overhead is acceptable for decomposition in interactive workflows?
7. Which decomposition failures are most damaging (bad subquestion drift, redundant hops, dead-end plans)?
8. How robust are strategies under adversarial or ambiguous queries (EQ-05 linkage)?
9. Does decomposition reduce hallucination or just redistribute retrieval errors?
10. How should fallback behavior work when decomposition outputs low-confidence subqueries?
11. Which tasks benefit most: reasoning chains, dependency tracing, decision lineage reconstruction?
12. Should decomposition be default-off, default-on, or adaptive by query class in ADR-007?

## Starting Sources
- Least-to-Most Prompting — https://arxiv.org/abs/2205.10625
- Decomposed Prompting — https://arxiv.org/abs/2210.02406
- IRCoT paper — https://arxiv.org/abs/2212.10509
- Step-Back prompting — https://arxiv.org/abs/2310.06117
- Self-Ask paper — https://arxiv.org/abs/2210.03350
- LongBench repo — https://github.com/THUDM/LongBench
- HotpotQA site — https://hotpotqa.github.io/
- LangChain retrieval concepts — https://python.langchain.com/docs/concepts/retrieval/
- GraphRAG paper (multi-hop global/local context) — https://arxiv.org/abs/2404.16130

## What to Measure, Compare, or Evaluate
- Multi-hop evidence recall and chain-completion rate.
- End-task correctness and citation fidelity under each strategy.
- Latency/cost overhead per decomposition step.
- Failure attribution by stage: decomposition vs retrieval vs synthesis.
- Trigger policy precision/recall for “needs decomposition.”
- Robustness under ambiguous and adversarial question sets.

## Definition of Done
- A benchmark comparison across decomposition strategies is completed.
- A trigger policy and orchestration contract are defined for ADR-007.
- Latency/quality thresholds are documented for production gating.
- Failure-safe fallback and abort rules are specified.
- Risks and anti-patterns are codified with mitigation guidance.

## How Findings Feed LCS Architecture Decisions
This research determines whether ADR-007 includes a first-class query planner and how decomposition integrates with MCP tool orchestration. It also informs adversarial testing design in EQ-05 and context assembly behavior in ADR-009.
