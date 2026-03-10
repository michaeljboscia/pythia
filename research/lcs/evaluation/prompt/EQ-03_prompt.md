# Research Prompt: EQ-03 Multi-Hop QA Benchmarks (HotpotQA, MuSiQue, 2WikiMultiHopQA)

## Research Objective
Evaluate how well established multi-hop QA benchmarks can stress-test LCS’s ability to retrieve and synthesize evidence across multiple documents and artifact types. The study should identify what these benchmarks capture, what they miss for code/ADR-heavy corpora, and how to adapt or extend them for LCS-specific evaluation. Findings feed ADR-010 and should cross-reference RF-10, KG-01, and RF-11.

## Research Questions
1. What reasoning patterns are emphasized by HotpotQA, MuSiQue, and 2WikiMultiHopQA, and how do their task designs differ?
2. What constitutes “good” performance today on these benchmarks for modern RAG systems and where are practical ceilings?
3. Which benchmark characteristics transfer to LCS (cross-document reasoning) and which do not (Wikipedia-only entity style, limited code artifacts)?
4. How should supporting-fact supervision be used to evaluate retrieval versus generation separately?
5. How do these benchmarks expose failure modes such as shortcut reasoning, evidence omission, and confident wrong synthesis?
6. What modifications are needed to make benchmark tasks reflect LCS multi-artifact reasoning (code+ADR+docs+logs)?
7. How do graph-based retrieval approaches (GraphRAG-style) perform relative to flat retrieval on multi-hop tasks (cross-reference KG-01)?
8. How should answer scoring be adjusted for partial correctness and citation completeness in multi-hop settings?
9. What is the impact of context-window packing and lost-in-the-middle effects on multi-hop benchmark scores (cross-reference RF-07/RF-08)?
10. Which benchmark subset should be used for fast regression checks versus deep periodic evaluations?
11. What data contamination or leakage risks exist when using public benchmark datasets with modern LLMs?
12. Should LCS create an internal multi-hop benchmark derived from corpus-native tasks (handoff to EQ-04)?

## Starting Sources
- HotpotQA project site — https://hotpotqa.github.io/
- HotpotQA paper page (ACL Anthology) — https://aclanthology.org/D18-1259/
- MuSiQue repository — https://github.com/stonybrooknlp/musique
- MuSiQue paper page — https://aclanthology.org/2022.tacl-1.31/
- 2WikiMultiHopQA repository — https://github.com/Alab-NII/2wikimultihop
- 2WikiMultiHopQA paper (arXiv) — https://arxiv.org/abs/2011.01060
- BEIR repository (benchmark adaptation patterns) — https://github.com/beir-cellar/beir
- GraphRAG paper (local/global retrieval for multi-hop synthesis) — https://arxiv.org/abs/2404.16130
- CRAG paper (retrieval correction framing) — https://arxiv.org/abs/2401.15884
- Self-RAG paper — https://arxiv.org/abs/2310.11511

## What to Measure, Compare, or Evaluate
- Retrieval metrics: supporting-fact recall/precision, chain completeness, hop-wise recall.
- Answer metrics: exact match/F1, judge-based correctness, citation completeness.
- Failure breakdown: missed hop, wrong bridge entity, hallucinated hop, context overload.
- Method comparison: flat dense retrieval vs hybrid retrieval vs graph-enhanced retrieval.
- Robustness tests: adversarial distractors and ambiguous bridge entities.
- Transferability assessment from public benchmarks to LCS internal task distribution.
- Evaluation cost and runtime for routine vs deep benchmark runs.

## Definition of Done
- A benchmark suitability report ranks HotpotQA/MuSiQue/2Wiki for LCS relevance.
- A recommended multi-hop evaluation protocol is defined with task subsets and scoring rules.
- Gap analysis identifies what internal benchmark construction must cover beyond public datasets.
- A clear target band for “good enough” multi-hop performance is proposed for LCS milestones.
- ADR-010 receives concrete guidance on multi-hop quality gates and benchmark cadence.

## How Findings Feed LCS Architecture Decisions
This research shapes ADR-010’s multi-hop evaluation strategy and influences retrieval architecture decisions in ADR-002/ADR-001 by exposing where flat retrieval fails. It also informs RF-11 query decomposition requirements when multi-hop misses are driven by query-planning weaknesses.
