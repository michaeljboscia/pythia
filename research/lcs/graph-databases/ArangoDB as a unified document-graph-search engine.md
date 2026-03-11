# ArangoDB as a unified document-graph-search engine

ArangoDB is a native multi-model database that unifies document, graph, key-value, and full-text search capabilities within a single C++ engine and one query language — AQL. For teams that would otherwise stitch together MongoDB, Neo4j, and Elasticsearch (the polyglot persistence pattern), ArangoDB collapses that stack into one process, one transaction boundary, and one query syntax. **As of version 3.12.7 (current stable, March 2024 series), the Community Edition includes every Enterprise feature**, subject to a 100 GiB dataset cap and a non-commercial-use license. The trade-off for this architectural convenience is measurable: purpose-built graph engines like Neo4j and the now-archived Kuzu consistently outperform ArangoDB on deep graph traversals, and ArangoDB cannot run as an embedded library.

## How one engine handles three data models

ArangoDB stores all data as JSON documents, serialized internally in [VelocyPack](https://en.wikipedia.org/wiki/ArangoDB) (a compact binary format), atop a [RocksDB storage engine](https://docs.arango.ai/arangodb/stable/concepts/data-models/). The multi-model trick is elegant in its simplicity: **document collections** hold ordinary JSON objects, while **edge collections** hold JSON documents with mandatory `_from` and `_to` attributes pointing at vertex `_id` values. There is no separate graph storage layer. A vertex is just a document; an edge is just a document with two extra system fields. This means every vertex carries the full richness of a JSON document — nested objects, arrays, arbitrary attributes — without any impedance mismatch between "graph data" and "document data."

AQL (ArangoDB Query Language) is a [declarative, SQL-like DML](https://docs.arangodb.com/3.13/aql/graphs/traversals/) that uses the `FOR` loop as a universal iterator across all models. A document scan looks like `FOR doc IN collection`, a graph traversal looks like `FOR v, e, p IN 1..3 OUTBOUND startVertex GRAPH "myGraph"`, and a full-text search looks like `FOR doc IN myView SEARCH ANALYZER(doc.text IN TOKENS("query", "text_en"), "text_en")`. The critical capability is that **these can be composed in a single AQL statement**. A query can begin with a `SEARCH` over an ArangoSearch View to find the top-10 most relevant documents by BM25 score, then use each result as a starting vertex for a graph traversal, then apply document-level filters and aggregations — all in one query, one round trip, one result set.

The search layer is powered by [ArangoSearch](https://docs.arango.ai/arangodb/stable/release-notes/version-3.12/whats-new-in-3-12/), integrated since version 3.4. It supports two View types: the traditional `arangosearch` Views (which define field-level links and analyzers per collection) and the newer `search-alias` Views (which reference inverted indexes defined at the collection level). Both expose BM25 and TF-IDF ranking, configurable text analyzers for tokenization and stemming across many languages, and the `BOOST()` function for relevance tuning. Both document and edge collections can be linked to Views, which as the [official documentation notes](https://github.com/arangodb/docs/blob/206fdbaf931afaf91e51fc8d897748f3ab875c96/3.6/arangosearch-views.md), means "graphs can be treated as flat and interconnected data structure simultaneously." Version 3.12 also introduced experimental [vector indexes](https://docs.arangodb.com/3.12/release-notes/version-3.12/whats-new-in-3-12/) for approximate nearest-neighbor search, adding a fourth query pattern to the same AQL surface.

### Transaction semantics across models

On a single server, [multi-document, multi-collection AQL queries are fully ACID](https://docs.arangodb.com/3.11/develop/transactions/limitations/) — and since graph operations are operations on document and edge collections, a single atomic transaction can insert vertices, create edges, update documents, and delete nodes. Stream Transactions (introduced in v3.5) allow explicit BEGIN/COMMIT/ABORT from client drivers for multi-step workflows.

One important caveat: **ArangoSearch Views are eventually consistent**, controlled by a [`commitIntervalMsec`](https://docs.arangodb.com/3.10/index-and-search/arangosearch/arangosearch-views-reference/) parameter (default 1000 ms). A combined query can execute SEARCH and graph traversals together, but the SEARCH portion reflects the View's last committed state, not the transaction's own uncommitted writes. For most read-heavy analytical workloads this is invisible; for write-then-immediately-search patterns, the one-second lag matters.

### Why this beats polyglot persistence

The practical advantages over running separate databases are substantial. There is no ETL pipeline between systems — a document stored in ArangoDB is [immediately usable as a graph vertex and searchable via Views](https://docs.arango.ai/arangodb/stable/concepts/data-models/) without data duplication. Cross-model consistency comes for free on single-server deployments rather than requiring distributed sagas across independent databases. Operationally, teams manage one backup strategy, one security perimeter, one upgrade cycle. A [2023 ACM SIGAPP paper](https://dl.acm.org/doi/10.1145/3555776.3577645) benchmarking ArangoDB against a MongoDB+Neo4j polyglot stack using UniBench found ArangoDB ~2× slower on document deletes but recommended it when availability requirements dominate.

The trade-off is specialization. ArangoDB's search is not Elasticsearch; its graph traversal is not Neo4j. For workloads that demand world-class performance in one model, a specialist database will likely win on raw speed. ArangoDB's value proposition is strongest when your data is inherently multi-model and you want to query across models in a single composable language.

## Graph traversal performance against Neo4j and Kuzu

Published benchmarks paint a consistent picture: **ArangoDB's graph traversal performance trails dedicated graph engines**, particularly on deep multi-hop queries, though it remains competitive for simpler patterns.

ArangoDB's [own December 2024 benchmark](https://arangodb.com/2024/12/benchmark-results-arangodb-vs-neo4j-arangodb-up-to-8x-faster-than-neo4j/) against Neo4j 5.19 on the wiki-Talk dataset (2.4M vertices, 5M edges) showed its Graph Analytics Engine (GAE) running **PageRank 2.8× faster** and **Label Propagation 8.5× faster** than Neo4j. However, the GAE is a separate Rust-based analytics engine that loads data from ArangoDB into memory for computation — it does not benchmark AQL's native query performance. The benchmark explicitly disclaims that "it does not evaluate data insertion times into ArangoDB or computational tasks performed by ArangoDB itself."

More telling is the academic evidence. A [2019 VLDB microbenchmark](https://www.vldb.org/pvldb/vol12/p390-lissandrini.pdf) by Lissandrini et al. tested seven graph databases on BFS traversals at depths 2–5. ArangoDB "excels only in few queries" — strong on key lookups (owing to its key-value core) and creation/update operations, but **"for retrievals and search, its performance is in general poor"** relative to Neo4j. A [2024 HICSS paper](https://arxiv.org/abs/2401.17482) by Sandell et al. similarly concluded that "Neo4j performs faster in querying connected data than MySQL and ArangoDB." The architectural reason is straightforward: ArangoDB simulates graph adjacency through standard secondary indexes on `_from`/`_to` fields, while Neo4j uses index-free adjacency with direct pointer-based traversal.

The [TigerGraph benchmark](https://info.tigergraph.com/benchmark) (2018–2019) stressed this gap further at scale. On a 2.4M-vertex Graph500 dataset, ArangoDB completed 1-hop queries but **timed out on 2-hop queries** (3-minute limit per seed) and could not complete PageRank or WCC within 24 hours on the larger Twitter dataset (61.6M vertices).

### How Kuzu compared before its archival

**No direct ArangoDB vs. Kuzu benchmark has been published.** However, both have been benchmarked against Neo4j, allowing indirect triangulation. An [independent community benchmark](https://github.com/prrao87/kuzudb-study) by Prashanth Rao tested Kuzu 0.9.0 against Neo4j 2025.03.0 on exactly the target range: **100K person nodes with ~2.4M edges**. On multi-hop path counting, Kuzu was **40–375× faster** than Neo4j. On aggregation queries involving graph traversals, Kuzu showed 2.4–10.8× speedups. Only on simple filtered lookups did Neo4j edge ahead.

Given that academic benchmarks consistently show ArangoDB slower than Neo4j on pure graph traversals, and Kuzu dramatically faster than Neo4j on the same class of queries, **Kuzu likely outperformed ArangoDB by one to two orders of magnitude on deep multi-hop traversals** within the 10K–100K node range. Kuzu's columnar storage, vectorized execution, and worst-case-optimal join algorithms were purpose-built for analytical graph workloads — a fundamentally different architecture from ArangoDB's document-centric index lookups.

A critical caveat: [KuzuDB was archived in October 2025](https://www.theregister.com/2025/10/14/kuzudb_abandoned/). The Kùzu Inc. team announced they were "working on something new," and the GitHub repository was marked read-only. Community forks (Bighorn by Kineviz, LadybugDB) have emerged, but their long-term viability is uncertain. Existing Kuzu releases (up to 0.11.3) remain usable under the MIT license.

ArangoDB has **never completed an LDBC Social Network Benchmark implementation** — a [GitHub issue](https://github.com/arangodb/arangodb/issues/11233) requesting this remains open, and a partial Stanford implementation was abandoned due to AQL complexity. This absence of standardized benchmark participation makes rigorous comparison difficult.

## Deployment realities for local development

ArangoDB is a **client-server database only**. It cannot be embedded as an in-process library like SQLite, DuckDB, or (the now-archived) Kuzu. Multiple [GitHub feature requests](https://github.com/arangodb/arangodb/issues/20875) for embedded mode have been declined; as an ArangoDB developer stated: "ArangoDB is implemented in C++, hence it will never be able to be ran inside a java process... It can be ran alongside with it as a separate process." For local development, it runs as a standalone server process communicating over HTTP (port 8529) or via client drivers.

### Resource footprint for small graphs

A fresh ArangoDB instance consumes approximately **300 MB of RAM and 5.6 GB of disk** with default configuration. A documented ["Spartan Mode"](https://arangodb.com/2016/03/put-arangodb-spartan-mode/) reduces this to roughly **110 MB RAM and under 1 GB disk** by tuning V8 contexts, WAL file sizes, and RocksDB buffer settings. The memory auto-configuration system allocates 256 MiB for caching when system RAM is under 4 GiB, scaling up proportionally on larger machines. Key tuning parameters include `--javascript.v8-contexts 2` and reduced RocksDB write buffer sizes, as [documented in the operations guide](https://docs.arango.ai/arangodb/stable/operations/administration/reduce-memory-footprint/).

The [official Docker image](https://hub.docker.com/_/arangodb) (`arangodb:3.12.7`, Alpine-based) is approximately **260 MB compressed** for the Community Edition and 334 MB for Enterprise. Both `amd64` and `arm64v8` architectures are supported. **Native binaries are Linux-only as of v3.12** — macOS and Windows developers must use Docker. CPU requirements include SSE 4.2 and AVX on x86-64 (Intel Sandy Bridge or newer) or ARMv8 with Neon on ARM.

For a 10K–100K node graph with typical document sizes, expect a working set of **500 MB–1 GB RAM** and **1–5 GB disk** including indexes and ArangoSearch Views, well within the capability of any modern development laptop.

### Licensing: powerful but restrictive

The [licensing landscape as of v3.12](https://docs.arango.ai/arangodb/3.12/features/) has three layers. Source code is under **BSL 1.1** (Business Source License), which permits non-commercial use and commercial use in non-production contexts, converting to Apache 2.0 four years after each release. Pre-compiled Community Edition binaries are under the **ArangoDB Community License**: free for non-commercial use and internal business purposes, with a **100 GiB dataset limit** — exceed it and the deployment enters read-only mode after two days of warnings, then [shuts down after two more days](https://docs.arango.ai/arangodb/3.12/features/). The **Enterprise Edition** requires a commercial agreement, removes the size cap, and permits commercial/production use.

The [v3.12.5 unification](https://arangodb.com/3-12-ce-changes-faq/) is strategically significant: Community now includes SmartGraphs, SatelliteCollections, encryption at rest, LDAP authentication, audit logging, and hot backups — features that were Enterprise-only through v3.12.4. This means **no feature gates for evaluation or non-commercial work**, but any commercial production deployment requires an Enterprise license. Notably, the Community License explicitly [prohibits embedding ArangoDB within other products](https://arango.ai/downloads/) or distributing it as part of a commercial tool.

For a local-first development tool shipping to end users, this licensing model creates friction. You cannot bundle ArangoDB inside your application, and the Community License bars commercial distribution. A tool that requires ArangoDB would need to instruct users to install it separately or run it via Docker as a sidecar process, and any commercial use triggers the Enterprise license requirement.

## Conclusion

ArangoDB's core strength is architectural unification. The ability to write a single AQL query that searches documents by BM25 relevance, traverses the resulting graph neighborhood, and applies document-level aggregations — without any data movement or ETL — is genuinely powerful and unique among production databases. The v3.12.5 feature unification makes the full capability set available for evaluation without license barriers.

The cost is clear in benchmarks: ArangoDB's index-based graph traversal cannot match the raw multi-hop performance of native graph engines. For workloads dominated by deep traversals on larger graphs, Neo4j will be faster, and embedded analytical graph engines (like the late Kuzu) were dramatically faster still. On 10K–100K node graphs, ArangoDB handles 1–2 hop queries comfortably, but performance degrades on deeper traversals relative to specialists.

The most important consideration for tool developers may be operational: **ArangoDB cannot embed** and **requires a separate server process**, and its licensing restricts commercial redistribution to Enterprise agreements. Teams building local-first tools should weigh whether the multi-model convenience justifies the server dependency and licensing complexity, or whether a lighter-weight combination (e.g., SQLite/DuckDB for documents + a dedicated graph library) better fits the embedded, distributable, commercially licensed niche that ArangoDB intentionally does not occupy.

## Bibliography

1. **ArangoDB Data Models Documentation** — https://docs.arango.ai/arangodb/stable/concepts/data-models/ — Core reference for how document, graph, and key-value models coexist in ArangoDB's unified architecture.

2. **ArangoDB AQL Graph Traversals Documentation** — https://docs.arangodb.com/3.13/aql/graphs/traversals/ — Definitive reference for graph traversal syntax, direction control, variable-depth queries, PRUNE, and path algorithms in AQL.

3. **ArangoDB SEARCH Operations in AQL** — https://docs.arangodb.com/3.13/aql/high-level-operations/search/ — Documentation for ArangoSearch SEARCH keyword integration with AQL, including View queries and ranking functions.

4. **arangosearch Views Reference** — https://docs.arangodb.com/3.10/index-and-search/arangosearch/arangosearch-views-reference/ — Technical reference for View configuration, commit intervals, eventual consistency model, and consolidation policies.

5. **ArangoDB Transactions Limitations** — https://docs.arangodb.com/3.11/develop/transactions/limitations/ — Authoritative source on ACID guarantees for single-server vs. cluster, stream transactions, and intermediate commit behavior.

6. **ArangoDB vs. Neo4j Benchmark (December 2024)** — https://arangodb.com/2024/12/benchmark-results-arangodb-vs-neo4j-arangodb-up-to-8x-faster-than-neo4j/ — Vendor benchmark of Graph Analytics Engine vs. Neo4j on wiki-Talk dataset showing 1.7×–8.5× speedups on graph algorithms.

7. **VLDB Microbenchmark: Lissandrini et al. (2019)** — https://www.vldb.org/pvldb/vol12/p390-lissandrini.pdf — Peer-reviewed academic benchmark of seven graph databases including ArangoDB and Neo4j, covering BFS traversals at depths 2–5.

8. **Sandell et al. (2024), HICSS** — https://arxiv.org/abs/2401.17482 — Academic comparison of ArangoDB, MySQL, and Neo4j performance on connected data queries, finding Neo4j faster on graph workloads.

9. **TigerGraph Benchmark Report** — https://info.tigergraph.com/benchmark — Vendor benchmark testing k-hop traversals across TigerGraph, Neo4j, ArangoDB, and others on Graph500 and Twitter datasets.

10. **Kuzu vs. Neo4j Community Benchmark (Prashanth Rao)** — https://github.com/prrao87/kuzudb-study — Independent benchmark on 100K-node graph showing Kuzu 2.4×–375× faster than Neo4j on various query types.

11. **KuzuDB Archived (The Register, October 2025)** — https://www.theregister.com/2025/10/14/kuzudb_abandoned/ — Reporting on KuzuDB's sudden archival and community response.

12. **ArangoDB Features and Capabilities (v3.12)** — https://docs.arango.ai/arangodb/3.12/features/ — Official documentation of Community vs. Enterprise Edition feature parity from v3.12.5 onward, licensing terms, and dataset limits.

13. **ArangoDB 3.12 CE Changes FAQ** — https://arangodb.com/3-12-ce-changes-faq/ — Explains the v3.12.5 unification of Community and Enterprise codebases and license implications.

14. **ArangoDB Embedded Mode Feature Requests** — https://github.com/arangodb/arangodb/issues/20875 — GitHub issue confirming ArangoDB does not and will not support in-process embedded operation.

15. **ArangoDB Spartan Mode (Resource Optimization)** — https://arangodb.com/2016/03/put-arangodb-spartan-mode/ — Guide to minimizing ArangoDB's memory and disk footprint for development environments.

16. **ArangoDB Docker Hub** — https://hub.docker.com/_/arangodb — Official Docker image with size, architecture, and configuration details for the current 3.12.7 release.

17. **ArangoDB NoSQL Performance Benchmark (2018)** — https://arangodb.com/2018/02/nosql-performance-benchmark-2018-mongodb-postgresql-orientdb-neo4j-arangodb/ — Vendor benchmark on Pokec dataset testing neighbor search and shortest path across five databases.

18. **ACM SIGAPP Multi-Model vs. Polyglot Persistence (2023)** — https://dl.acm.org/doi/10.1145/3555776.3577645 — Academic comparison of ArangoDB against MongoDB+Neo4j polyglot architecture using UniBench workloads.