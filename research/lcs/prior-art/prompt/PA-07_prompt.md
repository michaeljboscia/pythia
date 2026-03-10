# Research Prompt: PA-07 LlamaIndex Knowledge Graph Integration

## Research Objective
Study how LlamaIndex integrates knowledge graphs with vector retrieval (PropertyGraphIndex, KnowledgeGraph-related APIs, graph retrievers) and extract design patterns relevant to LCS. The focus is on practical bridging of structured graph traversal and unstructured semantic retrieval under constrained context windows. Findings feed ADR-001 and ADR-002, with cross-references to KG-08, KG-09, and RF-08.

## Research Questions
1. What are the core LlamaIndex abstractions for graph-integrated retrieval and how do they compose with vector indexes?
2. How does PropertyGraphIndex model nodes/edges/properties, and what schema assumptions are embedded?
3. How are graph retrievers and vector retrievers combined at query time, and what fusion strategies are available?
4. How does LlamaIndex handle provenance/citation through graph and vector steps?
5. What extraction pipelines are expected for building graph structures from raw corpora, and what quality controls exist?
6. How does context assembly handle graph neighborhoods without overwhelming token budgets (cross-reference RF-07/RF-08)?
7. What limitations emerge for heterogeneous artifacts and code intelligence use cases?
8. Which patterns are mature and production-ready versus experimental in the ecosystem?
9. How do LlamaIndex graph patterns compare to GraphRAG/LightRAG design choices?
10. What operational and maintenance overhead appears when graph and vector indexes evolve independently?
11. How should LCS adopt these patterns while preserving database/tooling independence?
12. What implementation shortcuts from LlamaIndex should LCS avoid due to hidden coupling?

## Starting Sources
- LlamaIndex repository — https://github.com/run-llama/llama_index
- LlamaIndex docs home — https://docs.llamaindex.ai/
- Property Graph index guide — https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/
- Knowledge graph index API reference — https://docs.llamaindex.ai/en/stable/api_reference/indices/knowledge_graph/
- Retriever module guides — https://docs.llamaindex.ai/en/stable/module_guides/querying/retriever/retrievers/
- Vector store index guide — https://docs.llamaindex.ai/en/stable/module_guides/indexing/vector_store_index/
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- Microsoft GraphRAG repo (comparison) — https://github.com/microsoft/graphrag
- LightRAG repository (comparison) — https://github.com/HKUDS/LightRAG

## What to Measure, Compare, or Evaluate
- Abstraction mapping: how graph and vector layers interact in code and config.
- Retrieval fusion behavior: quality and latency implications.
- Schema portability: fit with LCS polymorphic node requirements.
- Provenance handling quality through multi-stage retrieval.
- Operational overhead: index sync, update flows, and failure modes.
- LCS portability matrix for each major LlamaIndex pattern.

## Definition of Done
- A concrete map of LlamaIndex graph+vector integration patterns is documented.
- Reusable architectural patterns are extracted with caveats.
- Limitations for LCS code/ADR-heavy workloads are explicitly identified.
- Comparative positioning against GraphRAG/LightRAG is included.
- ADR-001/002 receive actionable integration guidance.

## How Findings Feed LCS Architecture Decisions
This research helps ADR-001 and ADR-002 choose practical graph-vector bridging patterns while avoiding framework lock-in. It informs how LCS should expose graph-aware retrieval through MCP without sacrificing provenance or token efficiency.
