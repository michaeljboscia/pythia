# Kuzu: a columnar embedded graph database for local-first knowledge graphs

*Created: March 11, 2026*

Kuzu is—or was—the most architecturally interesting embedded graph database to emerge in the 2020s, combining columnar storage, factorized query processing, and worst-case optimal joins into a single in-process engine optimized for analytical graph workloads. Developed at the University of Waterloo by Semih Salihoğlu's research group and commercialized by Kùzu Inc. in 2023, the system delivered **up to 374× faster query execution than Neo4j** on multi-hop traversal benchmarks while requiring zero server infrastructure. For local-first knowledge graph applications — offline-capable systems where a graph database runs embedded alongside application logic — Kuzu represented a genuine leap forward: a `pip install kuzu` or `npm install kuzu` that turned any laptop into an analytical graph engine rivaling dedicated servers. The project was [archived on October 10, 2025](https://github.com/kuzudb/kuzu), the same day Apple [acquired Kùzu Inc.](https://9to5mac.com/2026/02/11/kuzu-database-company-joins-apples-list-of-recent-acquisitions/) for undisclosed terms. The final release, v0.11.3, remains fully usable and installable, with community forks already emerging. This analysis examines the technical foundations that made Kuzu exceptional, its empirically demonstrated performance envelope, and the practical realities of deploying it in production knowledge graph systems.

---

## How Kuzu reimagines graph storage as structured tables

The foundational design decision in Kuzu is its **structured property graph model** — a deliberate departure from the schema-optional approach used by Neo4j and most other graph databases. Where Neo4j allows arbitrary labels and properties to be attached to nodes at runtime, Kuzu requires explicit table definitions before any data enters the system. As the [official documentation states](https://docs.kuzudb.com/cypher/data-definition/create-table/): "Kuzu uses the term table rather than label because, unlike other graph systems, Kuzu is ultimately a relational system in the sense that it stores and processes sets of tuples." Node tables are created with typed columns and mandatory primary keys (`CREATE NODE TABLE User(name STRING, age INT64, PRIMARY KEY (name))`), and relationship tables explicitly declare their endpoint types (`CREATE REL TABLE Follows(FROM User TO User, since INT64)`).

This design makes Kuzu look deceptively relational, and that is precisely the point. The [CIDR 2023 paper](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf) by Feng et al. explains the rationale: "We allow nodes and edges to have a single label, which allows us to model them as single relations." By treating each node label as a typed relation and each relationship type as a join table, Kuzu can apply decades of relational optimization techniques — cost-based join ordering, predicate pushdown, vectorized execution — to graph workloads. The strict schema also enables columnar compression and SIMD operations that would be impossible on schemaless property bags.

Internally, node properties are stored in **vanilla column files** — one file per property, with values stored contiguously for cache-friendly sequential scans. Relationships receive a more specialized treatment: they are stored in [**Compressed Sparse Row (CSR) adjacency list indices**](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf), double-indexed for both forward and backward traversals. The CIDR paper describes this as: "Edges are double indexed and stored in CSR-based adjacency list indices... which are the core join indices in the system to join node records." Edge properties sit in parallel CSR structures, ensuring that scanning a node's neighbors and their properties remains sequential in both directions. This double-indexing imposes a storage overhead compared to single-direction indices, but it guarantees that traversals in either direction avoid random I/O.

All data is organized into **NodeGroups** — horizontal partitions of **131,072 rows** (64 × 2048), conceptually equivalent to Parquet RowGroups. As described in the [v0.1.0 release blog](https://blog.kuzudb.com/post/kuzu-0.1.0-release/): "A NodeGroup is equivalent to a Parquet RowGroup, which represents a horizontal partition of a table consisting of k many nodes. Each k nodes' data are managed and compressed as a unit on disk files." All column data is stored in a single file (`data.kz`), and a [buffer manager](https://docs.kuzudb.com/developer-guide/database-internal/) with **4KB pages** and a GClock eviction strategy mediates access between disk and memory. Starting with [v0.11.0](https://blog.kuzudb.com/post/kuzu-0.11.0-release/), the entire database — catalog, WAL, data — resides in a single file on disk, following the model established by SQLite and DuckDB.

The contrast with Neo4j's architecture is stark. Neo4j uses what it calls ["native graph storage"](https://neo4j.com/blog/cypher-and-gql/native-vs-non-native-graph-technology/) — a linked-list structure where each node physically stores pointers to its adjacent relationships, and each relationship stores pointers to the next relationship for both its source and target nodes. This "index-free adjacency" approach optimizes single-hop traversals by making each neighbor lookup a single pointer chase. But it stores properties in a row-oriented format and processes queries one record at a time. Kuzu inverts these tradeoffs: neighbor lookups require CSR index scans rather than pointer chasing, but property access, filtering, and aggregation benefit enormously from columnar layout, [vectorized processing in batches of 2048 tuples](https://thedataquarry.com/blog/embedded-db-2/), and SIMD acceleration. For analytical graph queries — the kind common in knowledge graph applications — the columnar approach wins decisively.

---

## openCypher with factorized execution under the hood

Kuzu implements [**openCypher**](https://docs.kuzudb.com/get-started/cypher-intro/) as its query language — "the most widely adopted, fully-specified, declarative and open graph query language," as one [third-party analysis](https://thedataquarry.com/blog/embedded-db-2/) describes it. The team has pursued near-complete feature parity with Neo4j's Cypher dialect, extending openCypher with DDL statements for structured properties, a `LOAD FROM` clause for external data sources, and recursive path syntax supporting `SHORTEST` and `ALL SHORTEST` modifiers. The [differences from Neo4j's Cypher](https://docs.kuzudb.com/cypher/difference/) are primarily additive rather than restrictive: Kuzu requires schema definitions that Neo4j does not, but its query syntax for pattern matching, filtering, aggregation, and path-finding is immediately familiar to anyone who has used Neo4j.

The query execution pipeline follows a [classic DBMS architecture](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf): an ANTLR4-based parser generates a parse tree, a binder resolves types against the system catalog, a dynamic programming-based join optimizer generates physical plans, and a vectorized processor executes them using morsel-driven parallelism. But the critical innovation is **factorized query processing**, arguably Kuzu's most important contribution to graph database engineering.

The problem factorization solves is intermediate result explosion. Consider a 2-hop traversal: `MATCH (a)-[]->(b)-[]->(c) RETURN a, b, c`. If node `b` has `k` incoming edges from `a`-type nodes and `k` outgoing edges to `c`-type nodes, a traditional block-based processor would materialize **k² tuples** — every combination of `a` and `c` connected through `b`. Kuzu instead represents intermediate results as [factorized vectors](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf): "Intermediate relations passed between operators [are represented] as factorized vectors... The intermediate tuples that factorized vector groups represent is the Cartesian product of the sets of tuples in each vector group." Instead of k² flat tuples, the system stores **2k** factorized entries. One [third-party analysis](https://thedataquarry.com/blog/embedded-db-2/) found that "in the real dataset, the data reduction due to factorization is more like 100x, and this only grows as we traverse greater depths in the graph."

Enabling factorized processing while maintaining sequential disk access required a novel join operator called **ASP-Join (Accumulate-Semijoin-Probe)**. The CIDR paper describes its three-pipeline design: Pipeline 1 accumulates factorized probe tuples and constructs semijoin filters; Pipeline 2 builds a hash table on the build side, using semijoin filters to read only necessary data sequentially; Pipeline 3 re-scans the factorized tuples and probes the hash table. "ASP-Join is the core join operator in Kùzu and is also at the core of our novel multiway worst-case optimal join algorithm." For cyclic queries — triangle detection, clique finding, and other patterns common in knowledge graphs — Kuzu extends ASP-Join into a **worst-case optimal (WCO) join** that intersects sorted adjacency lists, avoiding the exponential blowup that binary joins suffer on cyclic patterns.

The optimizer uses a cost metric based on the number of factorized tuples rather than flat tuples, modeling each MATCH clause as an equi-join graph. For each subquery, it keeps the best plan for each possible factorization structure, choosing between hash join, S-Join, or ASP-Join based on the factorization structures of sub-plans and whether sideways information passing (SIP) can be applied. Parallelism follows the [morsel-driven model](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf) introduced by Leis et al.: "Parallel tasks run copies of the same pipeline and coordinate to get morsels of node IDs/properties to scan until no morsels remain."

---

## Benchmark evidence: where Kuzu dominates and where it does not

### The CIDR 2023 academic benchmarks

The foundational performance evidence comes from the [CIDR 2023 paper](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf), which benchmarked Kuzu against DuckDB v0.4.0 and Umbra on the **LDBC Social Network Benchmark at scale factor 100** (LDBC-100). The setup used dual Intel E5-2670 CPUs, 256 GB RAM, 8 threads per system, and a 64GB buffer manager. Each query ran 3 times with the fastest runtime reported and a timeout of 1000 seconds.

On acyclic microbenchmark queries (1-hop, 2-hop, and 3-hop joins), Kuzu outperformed DuckDB and Umbra by **more than 10× at low selectivities** (highly selective predicates). At high selectivities (100% — full table scans with no filtering), the columnar analytical engines converged in performance, though Kuzu's ASP-Join remained within **3.3× of the best performer**. On 2-hop and 3-hop queries over many-to-many edges, Kuzu consistently dominated. The paper notes that DuckDB's optimizer sometimes chose poor plans — for instance, joining two large tables without predicates on query IS06 of the LDBC SNB BI workload. On cyclic queries (triangle detection on web-BerkStan and LiveJournal graphs), Kuzu outperformed Umbra at low selectivities via its WCO joins. Neo4j Community Edition was benchmarked but found "not competitive with the other systems on the majority of queries" and was omitted from the published results.

### Third-party benchmarks on 100K-node graphs

The most relevant benchmarks for local-first knowledge graph applications come from Prashanth Rao's [detailed comparative study](https://thedataquarry.com/blog/embedded-db-2/), with an [updated version on GitHub](https://github.com/prrao87/kuzudb-study) testing Kuzu v0.9.0 against Neo4j 2025.03.0 on an M3 MacBook Pro with 36 GB RAM. The graph contained **100K person nodes and approximately 2.4 million edges** across five relationship types — a scale representative of personal knowledge graphs.

Data ingestion told the first story: Kuzu loaded all nodes and edges in **0.58 seconds**, versus **30.64 seconds** for Neo4j — a **52.8× speedup**. The query results revealed a nuanced performance profile. On aggregation queries (top 3 most-followed persons), Kuzu was **10.8× faster**. On multi-hop traversals with filters (persons age 30–40 per country), Kuzu achieved a **2.8× advantage**. But on simple point-lookup queries with minimal filtering (men in London interested in fine dining), **Neo4j was nearly 2× faster** — reflecting Kuzu's OLAP orientation versus Neo4j's OLTP-optimized index-free adjacency.

The most dramatic results appeared on path-counting queries. Query 8, counting all second-degree connections (a 2-hop path explosion), completed in **8.6 milliseconds** on Kuzu versus **3.22 seconds** on Neo4j — a **374× speedup**. This is factorized query processing in action: where Neo4j must materialize and count every path individually, Kuzu represents the intermediate results as compressed factorized vectors, avoiding the combinatorial explosion entirely.

### Large-scale performance validation

Kuzu's [v0.7.0 release benchmarks](https://blog.kuzudb.com/post/kuzu-0.7.0-release/) demonstrated scaling well beyond knowledge-graph sizes. On an LDBC SF-1000 Person-Knows subgraph (**3.2 million nodes, 202 million edges**), single-source shortest path completed in **0.32 seconds** on 32 threads. On the Graph500-30 benchmark (**448 million nodes, 17 billion edges**, 495GB on disk), the same algorithm completed in **13.5 seconds** — down from a timeout of over 10 minutes in the previous version. The [v0.10.0 release](https://blog.kuzudb.com/post/kuzu-0.10.0-release/) added native graph algorithms (PageRank, Louvain, weakly connected components, k-core decomposition) that are both disk-based and parallel, completing on graphs with **9.4 billion edges** within seconds.

For the 10K–100K node range typical of personal knowledge graphs, the practical takeaway is clear: virtually all queries complete in **under 200 milliseconds**, with most analytical queries finishing in **single-digit to low double-digit milliseconds**. At this scale, Kuzu's startup overhead and schema rigidity matter more than raw throughput. The system is dramatically overprovisioned for small knowledge graphs — which is precisely what makes it attractive for applications that might grow.

---

## Running Kuzu in-process: from Python notebooks to production pipelines

### Embedding in Python and Node.js

Kuzu's deployment model mirrors SQLite and DuckDB: the entire database engine runs as a library linked into the host process. In Python, the setup is three lines: `import kuzu; db = kuzu.Database("./mydb"); conn = kuzu.Connection(db)`. The [Python API](https://docs.kuzudb.com/client-apis/python/) provides synchronous execution via `conn.execute()`, asynchronous execution via `AsyncConnection`, and direct result conversion to Pandas DataFrames (`get_as_df()`), Polars (`get_as_pl()`), PyArrow tables (`get_as_arrow()`), NetworkX graphs (`get_as_networkx()`), and PyTorch Geometric data objects (`get_as_torch_geometric()`). The [Node.js API](https://docs.kuzudb.com/client-apis/nodejs/) follows the same pattern with both async (`conn.query()`) and sync (`conn.querySync()`) interfaces. Additional bindings exist for Rust, Go, Java, C++, Swift, and — notably for local-first applications — a [WebAssembly package](https://www.npmjs.com/package/@kuzu/kuzu-wasm) that runs Kuzu entirely in the browser.

The `Database` constructor accepts several performance-relevant parameters. **`buffer_pool_size`** controls the in-memory page cache (default: ~80% of system RAM). **`max_num_threads`** caps query parallelism. **`max_db_size`** defaults to **8TB**. Compression is enabled by default. A `read_only` mode supports safe concurrent reading. Since [v0.11.0](https://blog.kuzudb.com/post/kuzu-0.11.0-release/), the database is a single file on disk — a property that makes it trivially copyable, versionable, and syncable for offline-first architectures.

### Concurrency model and its constraints

Kuzu provides **serializable ACID transactions** backed by a write-ahead log (WAL), using an MVCC protocol inspired by HyPer's design. The [concurrency model](https://kuzudb.github.io/docs/concurrency/) has important constraints for production deployments. Within a single process, multiple `Connection` objects can issue concurrent read and write queries against the same `Database` object — the transaction manager handles isolation. However, **only one read-write process** can access a database file at a time (enforced via file locking). Multiple read-only processes can open the same file concurrently, but a read-write process and a separate read-only process cannot coexist on the same file simultaneously.

This single-writer architecture is the most significant production limitation. Applications requiring multi-process write access must either serialize writes through an API server (the Kuzu team provided a [Docker-based Express.js server](https://github.com/kuzudb/api-server) for this purpose) or redesign around a single-process model. Bulk imports via `COPY FROM` impose an additional constraint: they block all other writes for the duration of the operation, behaving more like initial data loading than incremental updates. Auto-checkpointing is configurable via `auto_checkpoint` and `checkpoint_threshold` parameters, with crash recovery handled automatically through WAL replay on database reopen.

### Schema evolution and data management

Schema evolution in Kuzu supports the operations most knowledge graph applications require: [**adding properties**](https://docs.kuzudb.com/cypher/data-definition/) (`ALTER TABLE User ADD age INT64 DEFAULT 0`), dropping properties, renaming tables, and renaming properties. These operations execute as DDL statements through Cypher. However, more complex structural changes — such as adding new FROM/TO endpoint pairs to existing relationship tables — had [limited support](https://github.com/kuzudb/kuzu/issues/2922) and required workarounds. Schema inspection is available through built-in functions like `CALL show_tables() RETURN *` and `CALL table_info('tableName') RETURN *`, and the `EXPORT DATABASE` command can generate a `schema.cypher` file for versioning.

Data import supports [CSV, Parquet, JSON, NumPy arrays, Pandas DataFrames, Polars DataFrames, and PyArrow tables](https://docs.kuzudb.com/import/). External databases — PostgreSQL, DuckDB, SQLite — can be attached as read-only data sources. The system can also scan Iceberg and Delta Lake datasets. Export supports CSV, Parquet, and JSON via `COPY ... TO` statements. For full database backup, `EXPORT DATABASE` produces a portable bundle of schema definitions, data files, and import scripts that can be `IMPORT DATABASE`'d into a new instance — the recommended path for version migration, since the storage format changed between major releases and backward compatibility was not guaranteed.

### Fitness for local-first knowledge graph systems

For the specific use case of local-first knowledge graphs, Kuzu's characteristics align well with core requirements. The single-file database format enables straightforward synchronization via file-level mechanisms (rsync, Dropbox, git-lfs). The embedded architecture eliminates server management overhead entirely. Integration with the LLM ecosystem is well-developed: [LangChain's `KuzuGraphStore`](https://github.com/kuzudb/baml-kuzu-demo), LlamaIndex's knowledge graph integration, and CocoIndex's [real-time knowledge graph construction pipeline](https://cocoindex.io/blogs/kuzu-integration) all demonstrate production-ready patterns for Graph RAG applications. Built-in [HNSW vector indexes](https://docs.kuzudb.com/client-apis/python/) enable hybrid queries combining vector similarity search with graph traversal — a pattern increasingly central to retrieval-augmented generation systems.

The strict schema requirement, while initially seeming like a limitation for knowledge graphs (which often deal with heterogeneous, evolving entity types), is in practice a forcing function for cleaner data modeling. When entity types and relationships are explicitly declared, queries benefit from type-aware optimization, and data integrity issues surface at insertion time rather than query time. For knowledge graphs with well-defined ontologies — organizational knowledge bases, scientific literature graphs, personal information management systems — this tradeoff strongly favors Kuzu's approach.

---

## The Apple acquisition changes the calculus

The elephant in the room is Kuzu's future. Apple [signed the acquisition agreement on October 9, 2025](https://9to5mac.com/2026/02/11/kuzu-database-company-joins-apples-list-of-recent-acquisitions/), and the GitHub repository was archived the following day. The website went offline. The extension server was shut down (though v0.11.3 bundles the four most commonly used extensions — algo, fts, json, and vector — pre-installed). The ~10-person team, led by Salihoğlu, joined Apple. The acquisition was disclosed through the EU's Digital Markets Act registry and [confirmed by multiple outlets](https://betakit.com/apple-strikes-deal-to-acquire-canadian-database-software-startup-kuzu/) in February 2026.

For teams evaluating Kuzu today, the implications are nuanced. The v0.11.3 release is fully functional, installable via pip and npm, and carries no license restrictions (MIT license). The codebase is frozen but complete. Community forks are emerging. However, there will be **no security patches, no bug fixes, and no new features** from the original team. Storage format migration between versions — already a manual process — will never be automated further. Anyone building production systems on Kuzu must accept the maintenance burden of a frozen dependency or commit to a fork.

The acquisition also validates Kuzu's technical approach. Apple's interest presumably lies in the embedded columnar graph engine's applicability to on-device intelligence — knowledge graphs powering Siri, Spotlight, and the broader Apple Intelligence ecosystem. The factorized query processing, disk-based operation with minimal memory footprint, and single-file storage format are all properties that translate directly to mobile and edge computing constraints.

---

## Conclusion

Kuzu represents a genuine architectural advancement in graph database design. Its combination of **columnar storage, factorized query processing, worst-case optimal joins, and morsel-driven parallelism** produces an engine that is not merely incrementally faster than Neo4j on analytical workloads, but categorically different in its performance characteristics — particularly on the multi-hop traversals and pattern matching central to knowledge graph applications. At the 10K–100K node scale typical of personal and team knowledge graphs, Kuzu delivers sub-200ms response times on virtually all query patterns while running as a zero-configuration embedded library.

The structured property graph model — strict schemas enforced at table creation — is both Kuzu's greatest strength and its most consequential design choice. It enables the columnar optimizations and vectorized execution that produce those benchmark numbers, but it requires upfront ontology design that schema-optional databases do not. For knowledge graph applications with well-defined entity types, this is a favorable tradeoff. For exploratory, schema-evolving use cases, it demands more discipline.

The practical deployment story was compelling before the acquisition: a single `pip install` or `npm install`, a single file on disk, ACID transactions, and rich ecosystem integrations for LLM-powered knowledge graph construction. The Apple acquisition freezes this story in amber. Kuzu v0.11.3 remains the most capable embedded graph database available for local-first applications, but teams choosing it today are adopting a technology whose future lies either in Apple's proprietary ecosystem or in the hands of community forks yet to prove their viability.

---

## Bibliography

**Feng, X., Jin, G., Chen, Z., Liu, C., & Salihoğlu, S.** "KÙZU Graph Database Management System." CIDR 2023.
https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf
*The foundational system paper describing Kuzu's architecture, factorized query processing, ASP-Join operator, worst-case optimal joins, and LDBC-100 benchmark results against DuckDB and Umbra.*

**Salihoğlu, S.** "Kùzu: A Database Management System For 'Beyond Relational' Workloads." SIGMOD Record, September 2023.
https://dl.acm.org/doi/10.1145/3631504.3631514
*Overview paper positioning Kuzu's structured property graph model within the broader database systems landscape.*

**Rao, P.** "Embedded databases (2): Kùzu, an extremely fast embedded graph database." The Data Quarry, September 2023.
https://thedataquarry.com/blog/embedded-db-2/
*Detailed third-party benchmark comparing Kuzu v0.0.8 against Neo4j v5.11.0 on a 100K-node social network graph, with analysis of factorized execution and vectorized processing.*

**Rao, P.** "kuzudb-study." GitHub repository, updated 2025.
https://github.com/prrao87/kuzudb-study
*Updated benchmark code and results comparing Kuzu v0.9.0 against Neo4j 2025.03.0, showing revised performance numbers including cases where Neo4j outperforms Kuzu on OLTP-style queries.*

**Kuzu Documentation.** "Data Definition — Create Table." kuzudb.com.
https://docs.kuzudb.com/cypher/data-definition/create-table/
*Official documentation on the structured property graph model, node table and relationship table creation, and schema enforcement requirements.*

**Kuzu Documentation.** "Database Internal." kuzudb.com.
https://docs.kuzudb.com/developer-guide/database-internal/
*Developer guide describing internal storage structures: BufferManager, Column, NodeGroup, RelTable, WAL, and hash index components.*

**Kuzu Documentation.** "Differences from Neo4j's Cypher." kuzudb.com.
https://docs.kuzudb.com/cypher/difference/
*Documentation of Kuzu's openCypher extensions and divergences from Neo4j's Cypher implementation, including schema requirements.*

**Kuzu Team.** "Kuzu v0.7.0 Release." blog.kuzudb.com, November 2024.
https://blog.kuzudb.com/post/kuzu-0.7.0-release/
*Release blog documenting large-scale benchmarks on LDBC-1000 and Graph500-30 datasets, zone maps implementation, and data spilling to disk.*

**Kuzu Team.** "Kuzu v0.1.0 Release." blog.kuzudb.com.
https://blog.kuzudb.com/post/kuzu-0.1.0-release/
*Release blog introducing the NodeGroup architecture and single-file column data storage.*

**Kuzu Team.** "Kuzu v0.10.0 Release." blog.kuzudb.com, May 2025.
https://blog.kuzudb.com/post/kuzu-0.10.0-release/
*Release blog introducing native graph algorithms (PageRank, Louvain, WCC, SCC, k-core) with benchmarks on graphs with 9.4 billion edges.*

**Kuzu Team.** "Kuzu v0.11.0 Release." blog.kuzudb.com, July 2025.
https://blog.kuzudb.com/post/kuzu-0.11.0-release/
*Release blog documenting the migration to single-file database format.*

**Kuzu Documentation.** "Concurrency." kuzudb.com.
https://kuzudb.github.io/docs/concurrency/
*Official documentation on Kuzu's transaction model, MVCC implementation, and multi-process concurrency constraints.*

**Kuzu Documentation.** "Python Client API." kuzudb.com.
https://docs.kuzudb.com/client-apis/python/
*Python API reference including Database constructor parameters, Connection methods, and result conversion functions.*

**Kuzu Documentation.** "Node.js Client API." kuzudb.com.
https://docs.kuzudb.com/client-apis/nodejs/
*Node.js API reference including async and sync query interfaces.*

**9to5Mac.** "Kuzu database company joins Apple's list of recent acquisitions." February 11, 2026.
https://9to5mac.com/2026/02/11/kuzu-database-company-joins-apples-list-of-recent-acquisitions/
*Reporting on Apple's acquisition of Kùzu Inc., disclosed through the EU Digital Markets Act registry.*

**BetaKit.** "Apple strikes deal to acquire Canadian database software startup Kuzu." February 2026.
https://betakit.com/apple-strikes-deal-to-acquire-canadian-database-software-startup-kuzu/
*Reporting on the acquisition, including context on Kùzu Inc.'s founding at the University of Waterloo.*

**Neo4j.** "Native vs. Non-Native Graph Technology." neo4j.com.
https://neo4j.com/blog/cypher-and-gql/native-vs-non-native-graph-technology/
*Neo4j's description of its native graph storage architecture, used for comparative analysis.*