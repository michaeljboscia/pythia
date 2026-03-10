# Research Prompt: GD-06 Graph DB Benchmarking at Small Scale

## Research Objective
Establish a rigorous, reproducible, and mathematically sound methodology for benchmarking graph databases specifically at the "small scale" (5,000 to 50,000 nodes). The objective is to design the exact benchmark suite that will be used to definitively select the engine for ADR-001, avoiding irrelevant enterprise-scale tests that don't reflect LCS's local, daemonized reality.

## Research Questions
1. **The Scale Fallacy:** Most graph benchmarks (like LDBC SNB) operate on millions or billions of nodes. Why do performance characteristics at billions of nodes fail to accurately predict performance at 50,000 nodes? How does CPU cache locality change the equation at small scales?
2. **LCS Query Archetypes:** Identify and formally define the 4-5 core graph traversal patterns LCS will actually execute (e.g., Shortest path between a codebase file and an ADR; Finding the 2-hop neighborhood of a modified function; Identifying highly-connected "god class" nodes).
3. **Data Generation:** How can we programmatically generate a synthetic test graph that accurately mirrors the topology of a real software project (power-law distribution of imports, dense clusters of documentation, isolated utility files)?
4. **Latency vs Throughput:** For a single-user MCP server, which metric matters more: absolute p99 latency of a complex variable-length query, or concurrent QPS (Queries Per Second)?
5. **Memory Profiling:** What specific OS-level tools (e.g., `valgrind`, `htop`, Node's `process.memoryUsage()`) and methodologies should be used to measure the true RAM and VRAM footprint of embedded DBs (Kuzu, SQLite) vs containerized DBs (Neo4j, ArangoDB)?
6. **Cold Start Penalty:** How do we accurately measure and simulate the "cold start" query time (when the graph must be paged from disk to memory) versus "warm" cached queries?
7. **Write Amplification:** When simulating the background indexing daemon (*PE-01*), how do we benchmark the impact of bulk edge insertions (e.g., a git commit adding 100 new call graph edges) on concurrent read latency?
8. **Graph Shape Impact:** How does the density of the graph (average degree of nodes) impact the traversal speed of Kuzu vs SQLite CTEs vs Neo4j? What happens when testing a sparse graph vs a highly connected graph?
9. **Benchmarking Harness:** What testing framework should be built to execute these tests fairly? How do we ensure Node.js event loop blocking or IPC serialization overhead doesn't skew the underlying database metrics?
10. **Vector Integration Testing:** If testing vector+graph queries, how do we benchmark the hybrid execution planner? (e.g., does the DB filter vectors first, or traverse the graph first?)

## Sub-Topics to Explore
- Power-law (Barabási–Albert model) network generation algorithms for realistic code graphs.
- LDBC Social Network Benchmark (SNB) Interactive Workload specifications (adapting them for small scale).
- IPC (Inter-Process Communication) overhead in Node.js native addons.
- Cross-referencing vector benchmarking standards from *VD-06*.

## Starting Sources
- **LDBC (Linked Data Benchmark Council):** https://ldbcouncil.org/benchmarks/snb/
- **Paper:** "The Graph Traversal Benchmark (GTB)" or similar literature on graph benchmarking.
- **Kuzu Benchmark Suite:** Look at how Kuzu authors benchmarked against Neo4j in their paper.
- **NetworkX Generators:** https://networkx.org/documentation/stable/reference/generators.html (for generating synthetic topologies).
- **Node.js Performance API:** https://nodejs.org/api/perf_hooks.html

## What to Measure & Compare
- Design a specific JSON schema for the benchmark queries and results (e.g., Query Type, Execution Time, Memory Delta, Result Size).
- Write a Python/NetworkX script that generates a 50K node "LCS-like" synthetic graph and exports it as standard CSVs (Nodes.csv, Edges.csv) to be ingested by all candidate databases.

## Definition of Done
A 3000+ word rigorous methodology document. It must deliver a complete, reproducible blueprint for the benchmark test: the exact schema, the data generation strategy, the specific Cypher/SQL queries to be run, and the scripts/tools required to measure memory and latency without bias.

## Architectural Implication
Feeds **ADR-001 (Graph DB Selection)**. This document ensures that the final database selection is based on empirical, LCS-specific data rather than marketing claims, preventing a costly architectural mistake early in the build phase.