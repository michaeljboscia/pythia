# Research Prompt: KG-01 GraphRAG Paper (Microsoft, 2024)

## Research Objective
Execute a comprehensive technical reading of Microsoft's GraphRAG paper (2024). The objective is to understand how community detection over knowledge graphs enables both "local" (entity-specific) and "global" (corpus-wide synthesis) search, and to determine if this architecture is required to solve the interrogation-crossover problem in LCS.

## Research Questions
1. How exactly does Microsoft's GraphRAG pipeline extract entities and relationships from raw text? Do they use zero-shot LLM prompts, few-shot, or specialized parsing models?
2. What community detection algorithm (e.g., Leiden, Louvain) is used to cluster nodes, and how do these hierarchical communities facilitate "global" answering (summarization over the entire corpus)?
3. How does the paper handle resolving coreferences and entity deduplication across disparate documents (e.g., "the vector db" in doc A vs "Qdrant" in doc B)?
4. What is the explicit prompt structure or mechanism used during the "local search" phase to combine retrieved graph context (nodes/edges) with vector-retrieved text chunks before passing to the LLM?
5. How does the paper benchmark performance? What specific multi-hop or synthesis queries demonstrate GraphRAG outperforming baseline naive RAG?
6. What are the documented or implied costs (token consumption, latency) of the indexing phase (graph construction) versus the querying phase?

## Starting Sources
- **GraphRAG Paper:** "From Local to Global: A Graph RAG Approach to Query-Focused Summarization" (Microsoft) - https://arxiv.org/abs/2404.16130
- **Microsoft Research Blog:** https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/
- **GraphRAG GitHub Repository:** https://github.com/microsoft/graphrag

## What to Measure & Compare
- Estimate the token cost of building a GraphRAG index for a 100,000 token corpus based on the paper's extraction methodologies.
- Contrast the "Global Search" workflow in GraphRAG against a standard "Map-Reduce" summarizing chain in LangChain.

## Definition of Done
A detailed technical breakdown of the GraphRAG architecture. It must explicitly identify the components of GraphRAG that are necessary for LCS (e.g., community summaries) versus those that are over-engineered for a highly structured codebase/ADR corpus. 

## Architectural Implication
This is a **P0 BLOCKER** for **ADR-001 (Graph DB Selection)**. It determines whether LCS needs a robust property graph capable of running community detection algorithms, or if a simpler relational linking model is sufficient.