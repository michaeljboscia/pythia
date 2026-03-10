# Research Prompt: GD-01 Kuzu Deep Dive

## Research Objective
Execute an intensive, hands-on evaluation of Kuzu, an embedded, heavily optimized graph database written in C++. The objective is to determine if its embedded architecture, strict Cypher compatibility, and variable-length path traversal speeds make it the definitive choice for the Living Corpus System (LCS) Knowledge Graph, bypassing the operational overhead of standalone servers like Neo4j.

## Research Questions
1. **Embedded Architecture:** How does Kuzu's embedded, serverless architecture (similar to DuckDB/SQLite) fundamentally differ from client-server graph databases? What are the implications for deploying LCS as a standalone desktop daemon (*PE-01*)?
2. **Cypher Compatibility:** How complete is Kuzu's implementation of openCypher compared to Neo4j (*GD-03*)? Are there specific edge-case query patterns (e.g., complex graph projections or APOC-style algorithms) that fail in Kuzu?
3. **Data Ingestion & Bulk Load:** How fast can Kuzu ingest a 50,000-node, 200,000-edge graph from raw CSV/Parquet files versus line-by-line programmatic inserts via the Node.js bindings?
4. **Node.js/Python Bindings:** Evaluate the stability and performance of the Kuzu Node.js bindings. Is the IPC overhead negligible, and how does it handle returning massive result sets (e.g., a subgraph of 1,000 nodes) to the JavaScript V8 context?
5. **Variable-Length Path Queries:** Given the requirements defined in *KG-05* (Graph Traversal Algorithms), how does Kuzu optimize unbounded or deeply-bounded (e.g., `*1..5`) path traversals mechanically? Does it use factorized query execution?
6. **Concurrency and Mutability:** How does Kuzu handle concurrent read/write operations (*PE-02*)? If the LCS background daemon is constantly updating edges (adding new PR links), will it block concurrent read queries from the MCP server?
7. **Storage Format and Memory Footprint:** Analyze Kuzu's on-disk storage format. What is the disk space required for 50K polymorphic nodes and 200K edges? What is the RAM footprint when the database is idle vs under heavy traversal load?
8. **Schema Definition:** Kuzu requires strict up-front schema definitions (unlike Neo4j). How difficult is it to model polymorphic artifacts (where a `Document` node might have drastically different properties than a `Code` node) within these strict constraints (*KG-03*)?
9. **Schema Migrations:** How does Kuzu handle schema migrations? If LCS introduces a new relationship type (`SUPERSEDES`), does it require a complete rebuild of the database files, or can it be altered dynamically?
10. **Failure Modes:** Under what specific conditions does Kuzu panic, corrupt, or OOM? Test the boundaries of its memory management by deliberately writing poorly constrained recursive queries.

## Sub-Topics to Explore
- Factorized query execution in property graphs.
- Vector search integration (Kuzu's capabilities vs dedicated vector DBs like Qdrant - *VD-01*).
- Node/Edge table structured representation under the hood.
- Handling of recursive relationships (e.g., a folder contains a folder).

## Starting Sources
- **KuzuDB Official Website & Docs:** https://kuzudb.com/
- **Kuzu GitHub Repository:** https://github.com/kuzu-data/kuzu
- **Paper:** "Kùzu Graph Database Management System" - https://arxiv.org/abs/2306.02506
- **Node.js API Reference:** https://kuzudb.com/docs/client-apis/nodejs/
- **Cypher Query Language Reference:** https://opencypher.org/
- **LDBC SNB Benchmark Data:** https://github.com/ldbc/ldbc_snb_datagen_spark (for generating test data).
- **DuckDB Architecture (for comparison):** https://duckdb.org/why_duckdb
- **Blog:** Kuzu's engineering blog regarding factorized execution.

## What to Measure & Compare (Hands-On Execution)
- Build a Python or Node.js script to generate a synthetic dataset of 50,000 nodes (representing files, functions, and PRs) and 250,000 edges.
- Measure the execution time of a depth-4 variable-length query (`MATCH (a:Function)-[:CALLS*1..4]->(b:Function)`) in Kuzu versus the identical recursive CTE executed in SQLite (*GD-02*).
- Measure the cold-start initialization time of the database from disk.

## Definition of Done
A 3000-5000 word technical deep dive and benchmarking report. The document must explicitly validate or invalidate Kuzu as the primary graph engine for LCS, providing concrete code examples of how to initialize the schema, ingest data, and execute complex graph queries via its Node.js bindings.

## Architectural Implication
This is a **P0 BLOCKER** for **ADR-001 (Graph DB Selection)**. If Kuzu performs perfectly, it negates the need for SQLite graph hacks or heavy Java-based Neo4j servers, defining the storage topology of the entire semantic layer.