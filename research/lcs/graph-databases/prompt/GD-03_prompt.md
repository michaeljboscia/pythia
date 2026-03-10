# Research Prompt: GD-03 Neo4j Evaluation

## Research Objective
Investigate Neo4j, the industry-standard enterprise graph database, to determine if its maturity, vast ecosystem, and advanced graph algorithms justify the substantial operational overhead, JVM memory requirements, and licensing constraints for a localized, single-user system like LCS.

## Research Questions
1. **JVM Overhead and Resource Consumption:** What is the absolute minimum viable memory (RAM) and CPU footprint required to run Neo4j Community Edition via Docker? How does this compare to an embedded engine like Kuzu (*GD-01*)?
2. **Cypher Expressiveness:** What advanced Cypher features (e.g., pattern comprehensions, complex graph projections, specific APOC functions) are unique to Neo4j and unavailable in embedded alternatives? Are these features critical for LCS traversal algorithms (*KG-05*)?
3. **The Bolt Protocol:** How does the binary Bolt protocol handle IPC/network communication between the Node.js MCP server and the Neo4j container? What is the serialization latency when returning massive graph sub-trees compared to local memory access?
4. **Community vs Enterprise:** What specific features (e.g., role-based access control, online backups, specific APOC algorithms, scalability limits) are restricted to the Enterprise edition? Does Community edition pose any hard blockers for LCS?
5. **Graph Data Science (GDS) Library:** Evaluate the Neo4j GDS library. If LCS needs to run PageRank or Louvain community detection (*KG-06*), how easily can GDS execute this on the live database, and is it available in the Community edition?
6. **Vector Search Integration:** Neo4j recently added native vector indexes. Can Neo4j effectively serve as the *only* database for LCS, housing both the Knowledge Graph and the Vector Embeddings (*VD-01*/*VD-02*), eliminating the need for Qdrant/LanceDB?
7. **Operational Complexity:** What is the lifecycle management like? How do you back up, restore, and migrate a Neo4j database programmatically via a daemon process?
8. **Schema-Free Nature:** Neo4j is inherently schema-free. How does this impact ingestion reliability? Must we build an application-level ODM (Object-Graph Mapper) to ensure node properties remain consistent?
9. **Query Planning and Profiling:** Analyze the Neo4j `PROFILE` command output. How effectively does its cost-based optimizer handle highly-connected "supernodes" (e.g., the `React` import node) compared to relational engines?
10. **Startup Time:** For a daemonized background process that might spin up and down, what is the cold-start boot time of the Neo4j JVM container?

## Sub-Topics to Explore
- The history and limitations of the APOC (Awesome Procedures on Cypher) library.
- Node.js Official Neo4j Driver mechanics (session management, connection pooling).
- The transition from index-free adjacency to modern pointer structures in Neo4j.
- Neo4j's exact implementation of vector similarity search (HNSW vs Flat).

## Starting Sources
- **Neo4j Official Docs:** https://neo4j.com/docs/
- **Neo4j Node.js Driver:** https://github.com/neo4j/neo4j-javascript-driver
- **Neo4j Vector Search Announcement:** https://neo4j.com/docs/cypher-manual/current/indexes-for-vector-search/
- **Neo4j Graph Data Science Library:** https://neo4j.com/docs/graph-data-science/current/
- **Bolt Protocol Specification:** https://7687.org/
- **APOC Documentation:** https://neo4j.com/labs/apoc/
- **Docker Hub Neo4j Image:** specifically looking at startup scripts and ENV vars.

## What to Measure & Compare
- Benchmark the Docker container boot time and idle RAM footprint of `neo4j:latest`.
- Compare the code required to run a local PageRank using Python NetworkX (extracting from SQLite) vs running `gds.pageRank.stream` directly within Neo4j.
- Run a benchmark test assessing the QPS (Queries Per Second) of Neo4j's native vector index versus Qdrant at 50,000 vectors.

## Definition of Done
A 3000-5000 word evaluation outlining the exact cost/benefit ratio of adopting Neo4j. The report must provide a definitive "Yes" or "No" on whether LCS should accept the JVM/Docker operational burden in exchange for enterprise-grade graph tooling and unified vector search.

## Architectural Implication
Feeds **ADR-001 (Graph DB Selection)**. If chosen, LCS architecture moves from an embedded, single-process design to a multi-container microservice architecture, heavily impacting deployment, testing, and lifecycle management.