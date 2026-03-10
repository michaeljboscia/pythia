# Research Prompt: KG-05 Graph Traversal Algorithms

## Research Objective
Analyze standard graph traversal algorithms (BFS, DFS, shortest path) and their application to Information Retrieval. The goal is to determine exactly what graph query patterns the LCS system needs to support in order to answer complex, multi-hop questions across the code/doc boundary.

## Research Questions
1. How do Breadth-First Search (BFS) and Depth-First Search (DFS) translate into RAG retrieval patterns? When would you use one over the other to expand context around a retrieved node?
2. What is a "variable-length path query" in Cypher (e.g., `MATCH (a)-[*1..3]->(b)`), and what are the performance implications of unconstrained depth traversals on highly connected nodes?
3. How can cycle detection algorithms prevent infinite loops when traversing dependency graphs or import trees?
4. In the context of LCS, how would a "Shortest Path" algorithm be utilized? (e.g., finding the conceptual link between "Feature X specification" and "Database table Y").
5. How does PageRank or Eigenvector Centrality help identify the most "important" or "foundational" files in a codebase, and can this be used to re-rank vector search results?
6. How do graph databases optimize these traversals compared to executing recursive CTEs in SQLite?

## Starting Sources
- **Neo4j Graph Algorithms Documentation:** https://neo4j.com/docs/graph-data-science/current/algorithms/
- **NetworkX Python Library Docs:** https://networkx.org/documentation/stable/reference/algorithms/traversal.html
- **KuzuDB Query Language (Cypher) Docs:** specifically around recursive joins - https://kuzudb.com/

## What to Measure & Compare
- Benchmark the execution time of a depth-4 traversal on a highly connected node using a dedicated graph DB (Cypher) versus a relational database using recursive SQL.
- Compare the memory footprint of keeping an entire codebase graph in NetworkX (Python RAM) versus querying an embedded database like Kuzu.

## Definition of Done
A catalog of required query patterns for LCS. The document must list 3-5 specific Cypher (or equivalent) queries that map to real-world LCS user questions, proving that the traversal algorithms are necessary and defining the bounds (e.g., max depth) required to prevent runaway queries.

## Architectural Implication
Feeds **ADR-001 (Graph DB Selection)**. If the required queries rely heavily on complex algorithms like PageRank or unbounded variable-length paths, it rules out SQLite and forces the adoption of a dedicated graph engine like Kuzu or Neo4j.