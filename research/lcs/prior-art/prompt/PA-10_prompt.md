# Research Prompt: PA-10 Sourcegraph Cody (Code Intelligence + RAG)

## Research Objective
Analyze Sourcegraph Cody’s architecture signals for combining structural code intelligence with semantic retrieval and context-window management at codebase scale. The goal is to extract concrete design patterns for LCS code retrieval and context assembly while identifying operational tradeoffs and failure points. Findings feed ADR-002 and ADR-009, with cross-references to CI-08, RF-08, and PE-04.

## Research Questions
1. How does Cody integrate code search infrastructure (Zoekt/Sourcegraph indexing) with LLM context assembly?
2. What retrieval stack appears to be used for balancing exact symbol/path matches and semantic relevance?
3. How are structural signals (symbols, definitions, references) combined with textual signals at query time?
4. What context filtering and packing controls does Cody expose, and how do they address long-context degradation (cross-reference RF-07)?
5. How does Cody handle monorepos, large codebases, and indexing freshness under active development?
6. What observability and user feedback mechanisms exist for debugging low-quality responses?
7. What failure modes are documented (irrelevant context, stale index, missed references, latency spikes) and how are they mitigated?
8. How does Cody’s architecture separate retrieval-time logic from generation-time logic?
9. Which Cody patterns are directly applicable to LCS MCP tool responses and provenance requirements?
10. How do Cody strategies compare to Cursor and Zed in terms of structural vs semantic emphasis?
11. What performance envelopes are implied for acceptable developer UX at scale?
12. Which Cody-inspired patterns should be v1 requirements vs later optimizations for LCS?

## Starting Sources
- Sourcegraph Cody product page — https://sourcegraph.com/cody
- Sourcegraph Cody docs — https://sourcegraph.com/docs/cody
- Cody capabilities docs — https://sourcegraph.com/docs/cody/capabilities
- Cody context filters docs — https://sourcegraph.com/docs/cody/capabilities/context-filters
- Sourcegraph code search docs — https://sourcegraph.com/docs/code_search
- Zoekt repository — https://github.com/sourcegraph/zoekt
- Sourcegraph public snapshot repository — https://github.com/sourcegraph/sourcegraph-public-snapshot
- Cody public snapshot repository — https://github.com/sourcegraph/cody-public-snapshot
- Sourcegraph blog index — https://sourcegraph.com/blog
- LSP specification (structural baseline) — https://microsoft.github.io/language-server-protocol/
- ripgrep repository (lexical baseline comparator) — https://github.com/BurntSushi/ripgrep

## What to Measure, Compare, or Evaluate
- Architecture decomposition: indexing, retrieval, ranking, packing, generation interfaces.
- Structural vs semantic signal blending and ranking implications.
- Freshness and scaling behavior under large-repo update workloads.
- Context packing efficacy and failure under long prompts.
- Observability and debugging affordances for retrieval failures.
- LCS portability scoring for each major Cody pattern.
- Comparative matrix vs Cursor/Zed for code-assistant retrieval design.

## Definition of Done
- A Cody architecture study is produced with evidence-backed pattern extraction.
- Reusable LCS patterns are listed with implementation prerequisites and risks.
- Failure modes are mapped to concrete mitigations suitable for LCS.
- Cross-product comparison (Cursor/Zed/Cody) is included for triangulation.
- ADR-002 and ADR-009 receive explicit guidance on retrieval and context strategy.

## How Findings Feed LCS Architecture Decisions
This research informs ADR-002 retrieval architecture and ADR-009 context assembly by grounding decisions in a mature code intelligence product. It provides practical guidance on blending structural and semantic retrieval while maintaining low-latency, high-trust code assistance behavior.
