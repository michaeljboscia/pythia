# Neo4j as the foundation for RAG knowledge graphs

**Neo4j is the most mature property graph database available for building Retrieval-Augmented Generation systems**, combining native graph storage, a declarative query language, built-in vector search, and a comprehensive graph algorithm library in a single platform. Its index-free adjacency architecture delivers O(1) per-hop traversal independent of total graph size, making it well-suited for the multi-hop context expansion that RAG pipelines demand. However, engineers evaluating Neo4j must navigate a complex licensing landscape — the Community Edition's GPL v3 license carries specific obligations for embedding scenarios — and understand that raw traversal performance on analytical workloads lags behind some in-memory competitors. This report provides a detailed technical assessment across architecture, performance, Cypher query patterns, deployment options, licensing implications, and Graph Data Science capabilities relevant to building a production RAG knowledge graph system.

## How index-free adjacency enables constant-time graph traversal

Neo4j's defining architectural feature is **index-free adjacency**: each node physically stores direct pointers to its adjacent relationships, making traversal a memory pointer dereference rather than an index lookup. The storage engine separates graph data into dedicated fixed-size record files. In the legacy record format, [node records occupy 15 bytes each](https://neo4j.com/developer/kb/understanding-data-on-disk/), containing pointers to the first relationship ID, first property ID, and label store. [Relationship records are 34 bytes](https://neo4j.com/developer/kb/understanding-data-on-disk/), storing start/end node IDs, relationship type, and four pointers forming a doubly-linked list connecting each relationship to the previous and next relationships of both its start and end nodes. [Property records use 41 bytes](https://neo4j.com/developer/kb/understanding-data-on-disk/) with a 32-byte payload divided into four 8-byte blocks, where short values (booleans, integers, short strings) are inlined directly.

The traversal mechanism is elegant in its simplicity. Given a node ID, Neo4j calculates the byte offset as `nodeId × record_size`, achieving [O(1) lookup into the node store file](https://neo4j.com/blog/cypher-and-gql/native-vs-non-native-graph-technology/). The node record yields a pointer to its first relationship, from which the engine iterates through the doubly-linked relationship chain. This means [traversal time is proportional to the subgraph touched, not the total graph size](https://neo4j.com/blog/cypher-and-gql/native-vs-non-native-graph-technology/) — a property that becomes critical when extracting local context from million-node knowledge graphs. For high-degree nodes, Neo4j employs relationship groups that organize chains by type, preventing full-chain scans on heavily connected entities.

Neo4j 5.14 introduced the **block format**, which became [the default for Enterprise Edition in Neo4j 5.22](https://neo4j.com/docs/operations-manual/current/database-internals/store-formats/) and represents a generational shift. Rather than maintaining separate linked-list stores, the block format co-locates node data, relationships, and properties in a **128-byte static block per node**. This block inlines [up to 10 labels, 6–7 properties, and up to 5 relationships](https://neo4j.com/docs/operations-manual/current/database-internals/store-formats/) directly with each node, dramatically reducing pointer chasing. Properties under approximately 31 bytes are stored inline. The result is [roughly 40% better performance when the graph fits in memory](https://medium.com/neo4j/try-neo4js-next-gen-graph-native-store-format-def10148c007), with some operations improving by an order of magnitude due to increased page cache efficiency and reduced fragmentation.

## Traversal latency ranges from sub-millisecond to seconds depending on depth

Published benchmarks paint a nuanced performance picture. The most widely cited results come from the *Neo4j In Action* benchmark using **1 million users and approximately 50 million relationships**. At [2 hops, Neo4j completed traversal in 10 milliseconds](https://neo4j.com/news/how-much-faster-is-a-graph-database-really/) versus MySQL's 16ms — modest improvement. At [3 hops, Neo4j took 168 milliseconds versus MySQL's 30.3 seconds](https://neo4j.com/news/how-much-faster-is-a-graph-database-really/), a 180× speedup. At 4 hops, the gap became **1.36 seconds versus 1,543 seconds** — over three orders of magnitude. At 5 hops, MySQL failed to complete while Neo4j finished in 2.13 seconds. These numbers demonstrate the fundamental advantage: relational join costs compound exponentially with depth, while graph traversal costs scale linearly with the touched subgraph.

More recent third-party benchmarks introduce important caveats. The [Memgraph benchmark using the Pokec social network dataset](https://memgraph.com/blog/memgraph-vs-neo4j-performance-benchmark-comparison) showed Neo4j Community Edition at **27.96ms for 1-hop expansion** (99th percentile, cold run) and approximately 3.1 seconds for 4-hop expansion — considerably slower than Memgraph's in-memory C++ architecture. This benchmark used default Community Edition configuration without page cache tuning, a significant caveat for interpreting the results.

For the LDBC Social Network Benchmark — the industry-standard graph workload — results are mixed. An [academic study (arXiv:1907.07405)](https://arxiv.org/abs/1907.07405) found that Neo4j was "user-friendly and suitable for small queries" but could not complete 13 of 25 BI queries at scale factor 1000 within reasonable time, while TigerGraph outperformed it by two or more orders of magnitude on complex analytical queries. Neo4j's own [LDBC demonstration used scale factor 1000 (~2.7 billion nodes)](https://neo4j.com/fosdem20/) primarily to showcase Fabric sharding capabilities rather than as a competitive benchmark.

In production RAG scenarios, [Neo4j reports that over 99% of queries return in tens of milliseconds](https://neo4j.com/blog/neo4j-real-world-performance/) for well-modeled transactional workloads. The practical implication for RAG is clear: **1–3 hop neighborhood expansion around anchor entities** — the core retrieval pattern — operates well within interactive latency budgets on graphs up to millions of nodes, provided data is properly indexed and the working set fits in page cache.

## Cypher patterns that power RAG retrieval pipelines

Cypher provides several query patterns directly applicable to RAG systems, progressing from simple entity lookup through multi-hop expansion to hybrid vector-graph retrieval.

**Entity lookup** forms the starting point. Indexed property matches use [inline property maps or WHERE clauses](https://neo4j.com/docs/cypher-manual/current/queries/concepts/): `MATCH (e:Entity {name: $entityName}) RETURN e`. For fuzzy matching, Neo4j's [full-text indexes powered by Apache Lucene](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/full-text-indexes/) support tokenized text matching with relevance scoring: `CALL db.index.fulltext.queryNodes("entityIndex", $searchTerm) YIELD node, score`. These indexes support Lucene query syntax including AND/OR operators, phrase matching, and property-specific search.

**Variable-length path traversal** is the critical RAG pattern for context expansion. Cypher's path quantifiers specify hop ranges directly: [`MATCH (start:Entity {name: $name})-[*1..3]-(context) RETURN context`](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-patterns/). Neo4j 5+ introduced [quantified path patterns](https://neo4j.com/docs/cypher-manual/current/queries/basic/) with inline predicates: `MATCH p = (a:Person)-[r:KNOWS WHERE r.since < 2020]->{1,4}(:Person) RETURN p`. For connecting multiple entities, the [`allShortestPaths` function](https://neo4j.com/developer/kb/all-shortest-paths-between-set-of-nodes/) finds connecting subgraphs: `MATCH path = allShortestPaths((n)-[*..4]-(m)) RETURN path`.

**Vector search combined with graph traversal** defines the core GraphRAG pattern. Since [Neo4j 5.11 (GA in 5.13)](https://markpollack.github.io/spring-ai-0.7.1/api/vectordbs/neo4j.html), native vector indexes backed by Apache Lucene's HNSW implementation support [cosine and Euclidean similarity metrics](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/vector-indexes/). Creating a vector index is straightforward: `CREATE VECTOR INDEX moviePlots FOR (m:Movie) ON m.embedding OPTIONS {indexConfig: {vector.dimensions: 1536, vector.similarity_function: 'cosine'}}`. The [procedure-based query API](https://neo4j.com/developer/genai-ecosystem/vector-search/) chains seamlessly into graph traversal:

```cypher
CALL db.index.vector.queryNodes('embeddings', 10, $queryVector)
YIELD node AS chunk, score
MATCH (chunk)<-[:FROM_CHUNK]-(entity)-[r:!FROM_CHUNK]-{1,2}(neighbor)
RETURN chunk.text, collect(DISTINCT neighbor) AS context, score
```

This pattern — vector search finds the entry point, then Cypher fans out to collect structured context — represents the [most effective GraphRAG retrieval approach](https://neo4j.com/blog/developer/graphrag-field-guide-rag-patterns/). As of [Neo4j 2026.01](https://neo4j.com/docs/cypher-manual/current/indexes/syntax/), the newer `SEARCH` clause provides a more integrated syntax: `SEARCH n IN (VECTOR INDEX idx FOR $vec LIMIT 10) SCORE AS s`.

## Community Edition is GPL v3 — what that means for MCP server developers

Neo4j offers three deployment paths with distinct licensing implications. Understanding these is critical for any engineer embedding or connecting to Neo4j from an MCP server.

**Neo4j Community Edition** is [licensed under GPL v3](https://github.com/neo4j/neo4j) and includes ACID transactions, full Cypher support, native graph storage, full-text search, and Bolt protocol access — but is [limited to a single database per instance](https://neo4j.com/docs/operations-manual/current/introduction/) with no clustering, no hot backups, no role-based access control, and no enterprise Cypher runtime. **Neo4j Enterprise Edition** uses a [proprietary commercial license](https://neo4j.com/open-core-and-neo4j/) adding clustering, multiple databases, RBAC, hot backups, and the block format storage engine. Pricing requires contacting Neo4j sales.

**Neo4j Desktop** provides a valuable middle ground: it includes a [free Developer License of Neo4j Enterprise Edition](https://neo4j.com/docs/desktop/current/) with all Enterprise capabilities, restricted to individual use on a single machine. This makes it ideal for local RAG development and prototyping.

**AuraDB**, Neo4j's managed cloud service, offers tiered pricing. The [free tier supports up to 200,000 nodes and 400,000 relationships](https://neo4j.com/cloud/platform/aura-graph-database/faq/) — sufficient for prototyping. [AuraDB Professional starts at $65/month](https://neo4j.com/pricing/) with consumption-based billing. AuraDB Business Critical provides 99.95% uptime SLA with 3-zone availability.

The GPL v3 licensing question is the most consequential technical decision for MCP server developers, and the answer hinges on a critical distinction. **GPL v3 copyleft obligations are triggered only by distribution** — conveying copies to others — [not by running the software as a service](https://blog.blackwell-systems.com/posts/gpl-agpl-copyleft-guide/). This is fundamentally different from AGPL v3, which adds a network-use trigger. Neo4j Community Edition uses GPL v3, not AGPL.

For an MCP server that **connects to Neo4j via the Bolt protocol** (the standard architecture), the analysis is straightforward. The [FSF's GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html) states that "pipes, sockets, and command-line arguments are communication mechanisms normally used between two separate programs." The MCP server and Neo4j are separate programs communicating via TCP sockets on port 7687. The [Neo4j Python driver is licensed under Apache 2.0](https://pypi.org/project/neo4j/), introducing zero copyleft obligations. **Your MCP server code does not become a derivative work of Neo4j and can use any license.**

For an MCP server that **embeds Neo4j Community in-process and distributes the combined binary**, GPL v3 obligations apply to the entire combined work. However, if you embed Neo4j but only **run it on your own servers without distributing**, [GPL v3 is not triggered because there is no distribution](https://en.wikipedia.org/wiki/GNU_General_Public_License) — the "SaaS loophole" that AGPL was specifically created to close. The practical recommendation: **connect via Bolt driver for maximum licensing flexibility**, using `pip install neo4j` (Apache 2.0) and treating Neo4j as a separate service.

## Graph Data Science algorithms enable structural intelligence for RAG

The [Neo4j Graph Data Science (GDS) library](https://neo4j.com/docs/graph-data-science/current/introduction/) provides parallel implementations of graph algorithms exposed as Cypher procedures. The community edition is free (licensed under [GPL v3](https://github.com/neo4j/graph-data-science)) and includes all algorithms, while the enterprise edition adds unlimited concurrency, Apache Arrow data import, and model persistence. All algorithms operate in four modes: **stream** (return results), **stats** (return summary), **mutate** (update in-memory graph), and **write** (persist to database).

**Community detection** algorithms are essential for the global retrieval strategy in GraphRAG systems. The [Louvain algorithm](https://neo4j.com/docs/graph-data-science/current/algorithms/louvain/) performs hierarchical clustering by greedily optimizing modularity, configurable via `maxLevels`, `maxIterations`, and `tolerance` parameters. The [Leiden algorithm](https://neo4j.com/docs/graph-data-science/current/algorithms/leiden/) improves on Louvain by addressing its tendency to produce poorly-connected communities, periodically breaking down communities into smaller well-connected subgroups. Both support `seedProperty` for deterministic initialization and `includeIntermediateCommunities` to expose the hierarchical structure. The API pattern is consistent:

```cypher
CALL gds.leiden.write('myGraph', {
  writeProperty: 'communityId',
  gamma: 1.0,
  theta: 0.01,
  includeIntermediateCommunities: true
})
YIELD communityCount, modularity, ranLevels
```

These community assignments directly enable the [Microsoft GraphRAG pattern](https://neo4j.com/blog/developer/graphrag-field-guide-rag-patterns/) of generating LLM summaries per community for hierarchical global retrieval: `MATCH (c:__Community__) WHERE c.level = $level RETURN c.full_content`.

**PageRank** provides [transitive influence scoring](https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/) useful for re-ranking RAG retrieval results by entity importance. The algorithm supports weighted edges, configurable damping factor (default **0.85**), and personalized variants via `sourceNodes`. In a RAG pipeline, PageRank scores serve as an authority signal alongside vector similarity — nodes with higher PageRank represent more central, well-connected knowledge that may be more relevant to ambiguous queries.

**Node similarity algorithms** include [neighborhood-based similarity](https://neo4j.com/docs/graph-data-science/current/algorithms/node-similarity/) (Jaccard, Overlap, Cosine) computed from shared neighbors, and [K-Nearest Neighbors (KNN)](https://graphacademy.neo4j.com/courses/graph-data-science-fundamentals/1-graph-algorithms/9-similarity/) computed from node properties including embedding vectors. GDS also provides [standalone similarity functions](https://neo4j.com/docs/graph-data-science/current/algorithms/similarity-functions/) — `gds.similarity.cosine()`, `gds.similarity.jaccard()`, `gds.similarity.euclidean()` — callable directly in Cypher for ad-hoc comparisons.

## Graph embeddings bridge structural and semantic representations

GDS provides [four node embedding algorithms](https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/) — FastRP, Node2Vec, GraphSAGE, and HashGNN — each with distinct trade-offs for RAG integration.

**FastRP (Fast Random Projection)** is the [workhorse for production graph embeddings](https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/fastrp/). It uses sparse random projections for dimensionality reduction, producing embeddings where each node's representation depends on a neighborhood of radius equal to the number of iterations. FastRP is extremely fast and memory-efficient, and uniquely supports incorporating node properties via `featureProperties` with a `propertyRatio` parameter controlling the balance between structural and feature-based signals. Configuration is straightforward: `CALL gds.fastRP.mutate('myGraph', {embeddingDimension: 128, iterationWeights: [0.0, 1.0, 1.0], featureProperties: ['age'], propertyRatio: 0.5})`.

**Node2Vec** uses [second-order biased random walks](https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/node2vec/) followed by a skip-gram neural network to learn representations. The `returnFactor` (p) and `inOutFactor` (q) parameters control the exploration pattern — low q encourages BFS-like local exploration while high q enables DFS-like global exploration. Node2Vec captures richer structural nuances than FastRP but is slower and non-deterministic, making it [best suited for exploratory analysis](https://github.com/danb-neo4j/gds-guide/blob/main/embeddings/node2vec.md).

**GraphSAGE** is the only [inductive embedding method](https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/graph-sage/) available in GDS (currently in beta). Unlike FastRP and Node2Vec, GraphSAGE learns a function to generate embeddings by sampling and aggregating features from local neighborhoods, meaning it can produce embeddings for new nodes without retraining. It requires a two-step API — train then predict — and depends on node feature properties as input. This makes it the strongest choice for knowledge graphs with frequent entity additions, though the training overhead is significant.

The integration pattern for combining graph embeddings with RAG retrieval is well-established. Generate FastRP or Node2Vec embeddings and write them as node properties. Create Neo4j vector indexes on these embeddings. At query time, use vector similarity search for initial candidate retrieval, then [traverse the knowledge graph via Cypher](https://neo4j.com/blog/developer/rag-tutorial/) for structured context enrichment. The [GDS Python client (`graphdatascience`)](https://neo4j.com/docs/graph-data-science-client/current/), licensed under Apache 2.0, provides a Pythonic interface mirroring the Cypher procedure API:

```python
from graphdatascience import GraphDataScience
gds = GraphDataScience("bolt://localhost:7687", auth=("neo4j", "password"))
G, _ = gds.graph.project("myGraph", {"Entity": {"properties": ["textEmbedding"]}},
                          {"RELATED_TO": {"properties": ["weight"]}})
gds.fastRP.mutate(G, embeddingDimension=128, mutateProperty="graphEmbedding")
```

## The neo4j-graphrag package unifies the retrieval stack

The [neo4j-graphrag Python package](https://neo4j.com/docs/neo4j-graphrag-python/current/) (installed via `pip install neo4j-graphrag`) is Neo4j's first-party library for building GraphRAG applications. It provides a retriever taxonomy covering the major patterns: **VectorRetriever** for pure embedding search, **VectorCypherRetriever** for [vector search chained with graph traversal](https://neo4j.com/blog/developer/graph-traversal-graphrag-python-package/), **HybridRetriever** for combined vector and [full-text keyword search](https://medium.com/neo4j/hybrid-retrieval-for-graphrag-applications-using-the-neo4j-genai-python-package-fddfafe06ff3), **HybridCypherRetriever** for hybrid search plus graph expansion, and **Text2CypherRetriever** for LLM-generated Cypher queries. The package also integrates directly with [LangChain via `langchain-neo4j`](https://neo4j.com/labs/genai-ecosystem/langchain/) and [LlamaIndex via `Neo4jPropertyGraphStore`](https://neo4j.com/labs/genai-ecosystem/llamaindex/).

The VectorCypherRetriever pattern is particularly powerful. It accepts a `retrieval_query` parameter containing Cypher that runs after vector search, with the matched node bound as `node`:

```python
retriever = VectorCypherRetriever(
    driver=driver,
    index_name="entity-embeddings",
    embedder=embedder,
    retrieval_query="""
        MATCH (node)<-[:FROM_CHUNK]-(entity)-[r:!FROM_CHUNK]-{1,2}(neighbor)
        RETURN node.text + collect(neighbor.name) AS context
    """
)
```

This single retriever call executes vector ANN search, traverses the graph for structural context, and returns enriched results ready for LLM consumption — combining three database paradigms (vector, graph, document) in one query.

## Conclusion

Neo4j occupies a unique position for RAG knowledge graph systems by unifying property graph storage, vector search, full-text indexing, and graph algorithms in a single platform. Its index-free adjacency architecture delivers predictable **sub-100ms latency for 2–3 hop traversals** on million-node graphs — the sweet spot for RAG context expansion. The block format storage engine introduced in Neo4j 5.x further improves this by co-locating nodes, relationships, and properties for 40% better in-memory performance.

The licensing picture favors the client-server architecture. Connecting to Neo4j Community Edition via the Apache 2.0-licensed Bolt driver imposes **zero copyleft obligations** on your application code. Only in-process embedding combined with binary distribution triggers GPL v3 requirements. For development, Neo4j Desktop provides free Enterprise Edition capabilities.

The GDS library's community detection (Leiden), centrality (PageRank), and embedding algorithms (FastRP, GraphSAGE) provide the structural intelligence layer that distinguishes GraphRAG from naive vector-only retrieval. FastRP embeddings capture graph topology, Leiden communities enable hierarchical summarization, and PageRank provides authority-based re-ranking — all callable from Python via the Apache 2.0-licensed GDS client. The neo4j-graphrag package ties these capabilities together with retriever abstractions that chain vector search into graph traversal in a single call. For a senior engineer building a RAG system that needs structured knowledge alongside semantic search, Neo4j offers the most complete single-platform solution available, provided the workload stays within its transactional query strengths rather than demanding global analytical computation.

## Bibliography

**Neo4j Native vs. Non-Native Graph Technology.** https://neo4j.com/blog/cypher-and-gql/native-vs-non-native-graph-technology/ — Explains index-free adjacency, O(1) traversal, and native graph processing architecture.

**Understanding Data on Disk (Neo4j Knowledge Base).** https://neo4j.com/developer/kb/understanding-data-on-disk/ — Documents fixed-size record formats: 15B nodes, 34B relationships, 41B properties, 128B overflow strings/arrays.

**Neo4j Store Formats (Operations Manual).** https://neo4j.com/docs/operations-manual/current/database-internals/store-formats/ — Describes block format architecture, 128B per-node blocks, property inlining, and migration from record format.

**Try Neo4j's Next-Gen Graph-Native Store Format (David Pond, Neo4j Blog).** https://medium.com/neo4j/try-neo4js-next-gen-graph-native-store-format-def10148c007 — Reports ~40% performance improvement for block format over record format when graph fits in memory.

**How Much Faster Is a Graph Database Really? (Neo4j).** https://neo4j.com/news/how-much-faster-is-a-graph-database-really/ — Summarizes *Neo4j In Action* benchmark: 10ms at 2 hops, 168ms at 3 hops, 1.36s at 4 hops on 1M-node/50M-relationship graph.

**Memgraph vs. Neo4j Performance Benchmark.** https://memgraph.com/blog/memgraph-vs-neo4j-performance-benchmark-comparison — Third-party benchmark using Pokec dataset; shows Neo4j Community Edition cold-run latencies for expansion queries.

**LDBC Social Network Benchmark: Neo4j vs. TigerGraph (arXiv:1907.07405).** https://arxiv.org/abs/1907.07405 — Academic LDBC SNB implementation comparing Neo4j and TigerGraph at scale factors SF-1 through SF-1000.

**Neo4j Real-World Performance.** https://neo4j.com/blog/neo4j-real-world-performance/ — Production case reporting 99%+ of queries returning in tens of milliseconds.

**Neo4j Cypher Manual: Variable-Length Patterns.** https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-patterns/ — Syntax reference for multi-hop traversal patterns used in RAG context expansion.

**Neo4j Cypher Manual: Full-Text Indexes.** https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/full-text-indexes/ — Documentation for Lucene-backed full-text search indexes, creation syntax, and query procedures.

**Neo4j Cypher Manual: Vector Indexes.** https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/vector-indexes/ — Native vector index documentation covering HNSW configuration, similarity functions, and query syntax.

**Neo4j Vector Search Developer Guide.** https://neo4j.com/developer/genai-ecosystem/vector-search/ — Practical guide for combining vector search with graph traversal in Cypher.

**Introducing Neo4j Native Vector Data Type.** https://neo4j.com/blog/developer/introducing-neo4j-native-vector-data-type/ — Documents first-class VECTOR type introduced in Neo4j 2025.10 with FLOAT32/FLOAT64 support.

**Neo4j GitHub Repository.** https://github.com/neo4j/neo4j — Confirms GPL v3 license for Community Edition and commercial license for Enterprise Edition.

**Neo4j Open-Core and Licensing FAQ.** https://neo4j.com/open-core-and-neo4j/ — Official explanation of Community (GPL v3) vs. Enterprise (commercial) licensing, plus Apache 2.0 for all native drivers.

**GPL v3 vs. AGPL Copyleft Guide.** https://blog.blackwell-systems.com/posts/gpl-agpl-copyleft-guide/ — Explains distribution-triggered copyleft in GPL v3 versus network-use trigger in AGPL v3.

**GNU GPL FAQ (Free Software Foundation).** https://www.gnu.org/licenses/gpl-faq.html — Authoritative guidance on derivative works, linking, network communication, and aggregate distribution under GPL.

**Neo4j Desktop Manual.** https://neo4j.com/docs/desktop/current/ — Documents free Developer License of Enterprise Edition for individual use on a single machine.

**AuraDB FAQ.** https://neo4j.com/cloud/platform/aura-graph-database/faq/ — Free tier limits (200K nodes, 400K relationships), Professional and Business Critical tier details.

**Neo4j Python Driver (PyPI).** https://pypi.org/project/neo4j/ — Confirms Apache 2.0 license for the official Python driver connecting via Bolt protocol.

**Neo4j GDS Library Introduction.** https://neo4j.com/docs/graph-data-science/current/introduction/ — Overview of algorithm categories, community vs. enterprise editions, and execution modes.

**Neo4j GDS: Louvain Algorithm.** https://neo4j.com/docs/graph-data-science/current/algorithms/louvain/ — API reference for hierarchical community detection including configuration options and Cypher procedure syntax.

**Neo4j GDS: Leiden Algorithm.** https://neo4j.com/docs/graph-data-science/current/algorithms/leiden/ — Documentation for Leiden community detection with gamma/theta parameters and hierarchical output.

**Neo4j GDS: PageRank.** https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/ — PageRank implementation details, personalized PageRank via sourceNodes, and normalization options.

**Neo4j GDS: Node Embeddings.** https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/ — Overview of FastRP, Node2Vec, GraphSAGE, and HashGNN embedding algorithms.

**Neo4j GDS: FastRP.** https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/fastrp/ — Fast Random Projection documentation including featureProperties, propertyRatio, and iterationWeights configuration.

**Neo4j GDS: Node2Vec.** https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/node2vec/ — Random walk-based embedding with returnFactor/inOutFactor parameters.

**Neo4j GDS: GraphSAGE.** https://neo4j.com/docs/graph-data-science/current/machine-learning/node-embeddings/graph-sage/ — Inductive embedding method documentation including two-step train/predict API.

**Neo4j GDS Python Client.** https://neo4j.com/docs/graph-data-science-client/current/ — Apache 2.0-licensed Python client mirroring GDS Cypher procedure API.

**Neo4j GraphRAG Python Package.** https://neo4j.com/docs/neo4j-graphrag-python/current/ — First-party retriever abstractions: VectorRetriever, VectorCypherRetriever, HybridRetriever, HybridCypherRetriever, Text2CypherRetriever.

**GraphRAG Field Guide: RAG Patterns.** https://neo4j.com/blog/developer/graphrag-field-guide-rag-patterns/ — Catalogs retrieval patterns including Cypher templates, vector+graph hybrid, and community summary strategies.

**Graph Traversal with GraphRAG Python Package.** https://neo4j.com/blog/developer/graph-traversal-graphrag-python-package/ — VectorCypherRetriever implementation guide with retrieval_query patterns.

**Hybrid Retrieval for GraphRAG (Neo4j Blog).** https://medium.com/neo4j/hybrid-retrieval-for-graphrag-applications-using-the-neo4j-genai-python-package-fddfafe06ff3 — HybridRetriever combining vector index and full-text index for GraphRAG applications.

**LangChain Neo4j Integration.** https://neo4j.com/labs/genai-ecosystem/langchain/ — Neo4jVector, Neo4jGraph, and CypherQAChain integration documentation.

**LlamaIndex Neo4j Integration.** https://neo4j.com/labs/genai-ecosystem/llamaindex/ — Neo4jPropertyGraphStore and retriever integration for LlamaIndex GraphRAG pipelines.