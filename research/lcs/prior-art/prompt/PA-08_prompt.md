# Research Prompt: PA-08 GitHub Copilot Workspace Architecture (Reverse Engineering)

## Research Objective
Investigate public information on Copilot Workspace to infer architecture patterns for codebase-scale context acquisition, planning, and multi-file edit execution. The goal is to extract reliable design lessons for LCS code intelligence and context assembly while clearly separating known facts from speculation. Findings feed ADR-004 and should cross-reference CI-08, RF-08, and MC-05.

## Research Questions
1. What concrete architecture claims are publicly documented for Copilot Workspace’s planning and code editing workflow?
2. How does Workspace appear to gather repository context for generating implementation plans?
3. What signals suggest use of structural analysis (symbols, dependencies, tests) vs pure semantic retrieval?
4. How are multi-file edit proposals likely grounded and validated before application?
5. What role do user-confirmed plans play in reducing hallucinated edits and context drift?
6. How might Workspace manage context window limits for large repos while preserving implementation intent?
7. What can be inferred about freshness and synchronization when files change during an interactive session?
8. How should LCS adapt planning-oriented context retrieval patterns without coupling to GitHub-specific product assumptions?
9. What failure modes are likely in plan-to-edit systems (missing dependencies, stale assumptions, unsafe refactors)?
10. Which missing public details require LCS to design experiments instead of copying behavior?
11. How do Workspace patterns compare with Cursor/Cody approaches to context assembly?
12. What minimal plan-aware retrieval features should be considered for LCS v2?

## Starting Sources
- GitHub Copilot Workspace launch post — https://github.blog/news-insights/product-news/github-copilot-workspace/
- GitHub Next Copilot Workspace project page — https://githubnext.com/projects/copilot-workspace/
- GitHub Copilot docs hub — https://docs.github.com/en/copilot
- About GitHub Copilot — https://docs.github.com/en/copilot/about-github-copilot
- Copilot Chat concept docs — https://docs.github.com/en/copilot/concepts/about-github-copilot-chat
- Copilot Chat docs section — https://docs.github.com/en/copilot/github-copilot-chat/about-github-copilot-chat
- Responsible use of Copilot features — https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features
- GitHub code search technology post (context indexing baseline) — https://github.blog/2023-02-06-the-technology-behind-githubs-new-code-search/
- LSP specification (structural analysis baseline) — https://microsoft.github.io/language-server-protocol/

## What to Measure, Compare, or Evaluate
- Evidence grading: documented fact vs plausible inference vs unknown.
- Pattern extraction for plan generation, context retrieval, and multi-file edit grounding.
- Comparative matrix vs Cursor/Cody behavior hypotheses.
- Risk analysis for adopting plan-aware retrieval in LCS.
- Proposed prototype experiments to validate high-value inferred patterns.
- Context-budget strategy implications for large repositories.

## Definition of Done
- A reverse-engineering report is produced with confidence-tagged findings.
- High-confidence reusable patterns are identified for ADR-004.
- Unknowns are converted into explicit LCS validation experiments.
- Product-specific assumptions are separated from general architectural lessons.
- A recommendation is made on whether plan-aware retrieval should be v1, v1.5, or v2.

## How Findings Feed LCS Architecture Decisions
This research informs ADR-004 on whether and how LCS should support plan-aware context retrieval for multi-file tasks. It also provides constraints for MCP interface design if plan stages need distinct retrieval modes and provenance guarantees.
