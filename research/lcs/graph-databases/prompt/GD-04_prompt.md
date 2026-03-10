# Research Prompt: GD-04 ArangoDB Evaluation

## Research Objective
Investigate ArangoDB as a potential "silver bullet" multi-model database for the Living Corpus System (LCS). The goal is to determine if its ability to simultaneously act as a document store, a graph database, and a full-text search engine reduces overall system complexity, or if it acts as a "jack of all trades, master of none" compared to purpose-built tools.

## Research Questions
1. **Multi-Model Architecture:** How does ArangoDB store data under the hood? Does it store graphs as linked documents, and how does this approach impact the speed of deep graph traversals compared to Neo4j's index-free adjacency or Kuzu's factorized execution?
2. **AQL (ArangoDB Query Language):** Analyze AQL. How does its syntax and ergonomics for variable-length graph traversals and pattern matching compare to Cypher? Is it intuitive for complex multi-hop queries?
3. **ArangoSearch (Full-Text & Vector):** How capable is the ArangoSearch engine? Can it fully replace the need for an inverted index (*RF-02*) and a vector database (*VD-01*)? Evaluate its support for HNSW indexes and BM25 sparse search.
4. **Foxx Microservices:** What is the Foxx framework? Could the LCS data ingestion pipeline or MCP server logic run directly *inside* the database as a Foxx microservice to eliminate network latency?
5. **Memory and Compute Footprint:** What are the hardware requirements for running the ArangoDB community edition in a Docker container? How does its C++ core compare in resource usage to Neo4j's JVM?
6. **Concurrency and Locking:** How does ArangoDB handle multi-document/multi-edge transactions? If we are rapidly updating graph edges and document metadata simultaneously, what locking mechanisms are triggered?
7. **Graph Algorithms:** Does ArangoDB natively support community detection, shortest path, or PageRank execution on the server side, or must the graph be pulled into application memory?
8. **Ecosystem and Bindings:** Evaluate the `arangojs` Node.js driver. Is it actively maintained, fully featured, and performant?
9. **Complexity Consolidation vs Lock-in:** By choosing ArangoDB, LCS consolidates three databases (Vector, Graph, Relational) into one. What are the specific lock-in risks associated with writing the entire retrieval pipeline in AQL?
10. **Scale Considerations:** Given LCS operates at a relatively small scale (50K documents/nodes), is a distributed multi-model database massive overkill, introducing configuration complexity without yielding scaling benefits?

## Sub-Topics to Explore
- Document-to-Graph projection (using Edge Collections).
- The RocksDB storage engine backend used by ArangoDB.
- Hybrid querying in AQL (e.g., combining a vector similarity search with a graph traversal in a single query).
- Community Edition limits (e.g., are specific search or graph features paywalled?).

## Starting Sources
- **ArangoDB Official Documentation:** https://www.arangodb.com/docs/stable/
- **AQL Graph Traversal Guide:** https://www.arangodb.com/docs/stable/aql/graphs-traversals.html
- **ArangoSearch and Vector Search:** https://www.arangodb.com/docs/stable/arangosearch.html
- **ArangoJS Driver:** https://github.com/arangodb/arangojs
- **Foxx Microservices Guide:** https://www.arangodb.com/docs/stable/foxx.html
- **Comparison:** ArangoDB vs Neo4j benchmarks (seek unbiased third-party benchmarks).
- **RocksDB architecture:** https://rocksdb.org/

## What to Measure & Compare
- Write a sample query in AQL that mimics a GraphRAG workflow: "Find the vector nearest neighbor to X, then traverse 2 hops outwards, and return the documents." Compare this to how the same logic would be orchestrated between Qdrant and Kuzu.
- Compare the Docker image size and idle memory usage of ArangoDB vs Neo4j.

## Definition of Done
A 3000+ word architectural assessment that decisively proves whether a multi-model database simplifies the LCS architecture or complicates it. The report must provide specific AQL examples demonstrating how LCS retrieval patterns would be implemented.

## Architectural Implication
Feeds **ADR-001 (Graph DB Selection)** and potentially overrides **ADR-002 (Vector DB Selection)**. Choosing ArangoDB implies a monolithic storage architecture, radically altering the entire ingestion and retrieval pipeline design.