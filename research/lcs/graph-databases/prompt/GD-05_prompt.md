# Research Prompt: GD-05 FalkorDB Evaluation

## Research Objective
Evaluate FalkorDB (formerly RedisGraph) as a lightweight, purely in-memory graph database alternative. The goal is to determine if storing the LCS Knowledge Graph entirely in RAM yields necessary latency benefits for real-time RAG operations, and whether its persistence and Cypher support are robust enough for production use.

## Research Questions
1. **Core Architecture:** How does FalkorDB utilize sparse adjacency matrices (using GraphBLAS) to represent the graph in memory? How does this linear algebra approach fundamentally differ mechanically from Neo4j's pointer chasing or Kuzu's factorized execution?
2. **In-Memory Constraints:** At 50,000 nodes and 250,000 edges with heavy string properties (e.g., markdown snippets attached to nodes), what is the exact RAM requirement? What happens when the system hits memory limits?
3. **Persistence Model:** Since it operates in-memory, how does FalkorDB persist data across restarts? Detail the Snapshot (RDB) and Append-Only File (AOF) mechanisms inherited from Redis. Are there risks of data loss on crash?
4. **Cypher Coverage:** FalkorDB supports openCypher. Are there any critical deviations, missing features, or non-standard syntax implementations compared to the Neo4j standard?
5. **LLM/RAG Integration:** FalkorDB heavily markets itself as the "Graph Database for GenAI" and "GraphRAG". Investigate their specific integrations (e.g., LangChain/LlamaIndex modules) and determine if they offer native vector indexing or if they rely on combining with Redis Search.
6. **Query Latency:** Is the latency of an in-memory graph traversal noticeably faster than an optimized embedded C++ engine (Kuzu) reading from an NVMe SSD for a graph of our scale?
7. **Node.js Ecosystem:** Evaluate the `falkordb-node` client. How does it manage connections, and what is the serialization overhead of pulling large subgraphs from the Redis memory space into the V8 runtime?
8. **Operational Deployment:** Does running FalkorDB require maintaining a full Redis stack infrastructure via Docker, or is it packaged as an embedded library?
9. **Graph Algorithms:** Does the GraphBLAS backend provide built-in execution of PageRank, Shortest Path, or Community Detection directly within the database?
10. **Vector Integration:** Investigate how FalkorDB handles vector embeddings as node properties and whether it supports HNSW-based vector similarity search within Cypher queries (e.g., `CALL db.idx.vector.queryNodes(...)`).

## Sub-Topics to Explore
- The GraphBLAS mathematical standard for graph operations.
- Redis modules ecosystem and the transition from RedisGraph to FalkorDB.
- GraphRAG reference architectures explicitly using FalkorDB.
- Benchmarks comparing sparse matrix multiplication traversal vs pointer chasing.

## Starting Sources
- **FalkorDB Official Website & Docs:** https://docs.falkordb.com/
- **FalkorDB GitHub:** https://github.com/FalkorDB/FalkorDB
- **GraphBLAS standard:** https://graphblas.org/
- **FalkorDB Node.js Client:** https://github.com/FalkorDB/falkordb-node
- **Blog/Whitepapers:** FalkorDB claims on GenAI and GraphRAG.
- **Redis Persistence Docs:** https://redis.io/topics/persistence (To understand the underlying save mechanisms).

## What to Measure & Compare
- Calculate the theoretical RAM footprint for the LCS graph (approx. 50MB of raw text data + 250k edges). How much overhead does the GraphBLAS matrix structure add?
- Write a Python/Node snippet demonstrating how a combined Vector + Graph query is executed in FalkorDB's specific dialect of Cypher.

## Definition of Done
A 3000-5000 word evaluation outlining the viability of an in-memory linear-algebra-based graph engine. The report must clearly state whether the theoretical speed advantages of in-memory execution outweigh the deployment complexity of a Redis-based stack compared to a simple embedded SQLite/Kuzu file.

## Architectural Implication
Feeds **ADR-001 (Graph DB Selection)**. If chosen, it mandates an in-memory architectural constraint, meaning the host machine must have sufficient RAM dedicated purely to the LCS graph, and dictates a specific Docker-based daemon setup.