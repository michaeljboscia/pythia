# Research Prompt: PA-02 Microsoft GraphRAG Implementation (Code Study)

## Research Objective
Study the actual Microsoft GraphRAG codebase to understand implementation details behind graph building, community detection, indexing, and local/global retrieval orchestration. The objective is to extract implementation-grade decisions and limitations, not just summarize the paper. Findings feed ADR-001 and should cross-reference KG-01, KG-06, RF-10, and EQ-03.

## Research Questions
1. How is the GraphRAG indexing pipeline structured in code (entity extraction, relation extraction, community detection, summary generation, indexing artifacts)?
2. What algorithmic choices are hard-coded vs configurable, especially around community detection and hierarchical summarization?
3. How does GraphRAG handle graph schema and metadata for entities, relations, and communities?
4. What assumptions about source documents and domain ontology are embedded in implementation defaults?
5. How are local search and global search paths orchestrated at query time, and what triggers each mode?
6. What caching, batching, and parallelization mechanisms are used to control cost/latency?
7. How does the implementation handle failures in extraction/summarization stages and partial index states?
8. What evaluation scripts exist, which metrics are emphasized, and what quality blind spots remain?
9. How feasible is incremental re-indexing versus full rebuild in practical deployments?
10. What operational constraints (resource usage, pipeline duration, model dependencies) emerge from real code paths?
11. Which GraphRAG modules are reusable for LCS and which should be reimplemented with simpler constraints?
12. How does GraphRAG implementation compare with LightRAG and Cognee in complexity vs quality tradeoff?

## Starting Sources
- GraphRAG repository — https://github.com/microsoft/graphrag
- GraphRAG docs site — https://microsoft.github.io/graphrag/
- Microsoft research blog announcement — https://www.microsoft.com/en-us/research/blog/graphrag-new-tool-for-complex-data-discovery-now-on-github/
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- GraphRAG issues (operational edge cases) — https://github.com/microsoft/graphrag/issues
- Leiden algorithm paper (community detection context) — https://www.nature.com/articles/s41598-019-41695-z
- Louvain paper (baseline comparison) — https://arxiv.org/abs/0803.0476
- LightRAG repository (comparison baseline) — https://github.com/HKUDS/LightRAG
- RAG production pattern context — https://arxiv.org/abs/2005.11401

## What to Measure, Compare, or Evaluate
- Code-path mapping of indexing and query orchestration with complexity hotspots.
- Configuration surface vs opinionated defaults and hidden assumptions.
- Failure handling maturity: retries, partial failures, resume logic, corrupted artifacts.
- Resource/cost profile per pipeline stage and likely LCS-scale impacts.
- Incremental indexing feasibility and required engineering changes.
- Graph schema portability to LCS polymorphic node model (cross-reference KG-08).
- Adopt/adapt/reject matrix for GraphRAG subsystems.

## Definition of Done
- A module-level architecture report is produced from actual code inspection.
- Key algorithmic/operational decisions are extracted with file-level evidence.
- Risks and portability constraints for LCS are explicitly documented.
- Comparative insights against LightRAG/Cognee are included on critical dimensions.
- ADR-001 receives actionable implementation guidance.

## How Findings Feed LCS Architecture Decisions
This research grounds ADR-001 in proven implementation details and avoids paper-level abstraction errors. It clarifies which GraphRAG elements should shape LCS graph retrieval design and which should be simplified to fit LCS scale and operational constraints.
