# Research Prompt: GD-02 SQLite as Graph Store

## Research Objective
Execute a rigorous and highly critical evaluation of using SQLite to model, store, and traverse the LCS Knowledge Graph. The goal is to determine if a simple adjacency list schema backed by recursive Common Table Expressions (CTEs) is sufficient for a 5K-50K node graph, thereby eliminating the need to introduce a specialized graph database dependency entirely.

## Research Questions
1. **Adjacency List Modeling:** How do you optimally design an SQLite schema to represent a Labeled Property Graph (*KG-03*)? Compare a universal `Edges` table versus dynamically generated tables for each edge type (e.g., `Edges_CALLS`, `Edges_CONTAINS`).
2. **Recursive CTE Mechanics:** How exactly do recursive CTEs (`WITH RECURSIVE`) work in SQLite? Break down the execution model (anchor member, recursive member) and explain how SQLite manages the intermediate working tables.
3. **Variable-Length Path Simulation:** Translate a Cypher query like `MATCH (a)-[:CALLS*1..3]->(b)` into a pure SQLite recursive CTE. Evaluate the verbosity, readability, and maintainability of the resulting SQL.
4. **Performance Limits:** At what specific depth or node count do recursive CTEs in SQLite begin to experience catastrophic performance degradation? (e.g., does depth=5 on a highly connected graph cause memory thrashing?)
5. **Cycle Detection:** Cypher automatically prevents infinite loops by not traversing the same edge twice in a path. How must cycle detection be manually implemented in a SQLite recursive CTE, and what is the performance overhead of maintaining the path array?
6. **Polymorphic Property Storage:** How should node properties be stored when the schema is dynamic? Evaluate the tradeoffs of using a monolithic JSON column (JSON1 extension) versus an Entity-Attribute-Value (EAV) table pattern for querying specific property values.
7. **Concurrency and WAL Mode:** If the background ingestion daemon (*PE-01*) is writing hundreds of new edges, how does SQLite's Write-Ahead Log (WAL) mode handle concurrent long-running recursive read queries (*PE-02*)? Will `SQLITE_BUSY` errors occur?
8. **Graph Algorithms:** How do you implement basic graph algorithms like Shortest Path (Dijkstra) or Connected Components in pure SQL? Is it practical, or does it force pulling the entire graph into application memory (e.g., NetworkX)?
9. **Tooling Ecosystem:** How easily can existing Python/Node visualization and analysis tools digest graph data pulled directly from a relational table versus a native graph DB connector?
10. **The Complexity Tradeoff:** Does the operational simplicity of using a built-in SQLite engine outweigh the immense cognitive load of writing and maintaining complex recursive SQL queries for every graph traversal feature?

## Sub-Topics to Explore
- Multi-dimensional indexing in SQLite for JSON properties.
- Query planning and the `EXPLAIN QUERY PLAN` output for recursive CTEs.
- "Graph over Relational" libraries or ORMs (e.g., EdgeDB concepts applied to SQLite).
- Memory-mapped I/O implications for large recursive working sets.

## Starting Sources
- **SQLite WITH RECURSIVE documentation:** https://www.sqlite.org/lang_with.html
- **SQLite JSON1 Extension:** https://www.sqlite.org/json1.html
- **Blog:** "Graphs in SQLite" / "Trees and Hierarchies in SQL" - https://cjauvin.blogspot.com/2013/09/graphs-in-sqlite.html
- **StackOverflow/HackerNews discussions:** Debates on "Neo4j vs PostgreSQL recursive queries".
- **Paper:** "The case against specialized graph analytics engines" (often argues relational is enough) - https://cidrdb.org/cidr2015/Papers/CIDR15_Paper20.pdf
- **Graph traversal with SQL:** https://www.sqlpac.com/en/documents/sql-server-postgresql-mysql-mariadb-sqlite-hierarchies-graph-traversal-recursive-ctes.html
- **SQLite WAL Mode docs:** https://www.sqlite.org/wal.html

## What to Measure & Compare (Hands-On Execution)
- Load the exact same 50,000 node / 250,000 edge dataset from *GD-01* into SQLite.
- Write and execute a recursive CTE to find the shortest path between two distant nodes. Compare the execution time, query plan, and code complexity directly against the Kuzu Cypher equivalent.
- Measure read latency while a separate process concurrently inserts 1,000 edges per second into the SQLite database.

## Definition of Done
A 3000+ word brutally honest assessment of SQLite's viability as a graph engine. The report must contain explicit, optimized SQL code for LCS's primary traversal patterns and conclusively determine if SQLite "hits a wall" before the 50K node threshold.

## Architectural Implication
This is a **P0 BLOCKER** for **ADR-001 (Graph DB Selection)**. If SQLite is sufficient, LCS avoids adding a complex C++ native dependency (Kuzu) or a heavy JVM dependency (Neo4j), vastly simplifying the deployment topology.