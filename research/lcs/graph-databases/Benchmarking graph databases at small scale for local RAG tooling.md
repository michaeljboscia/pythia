# Benchmarking graph databases at small scale for local RAG tooling

**No standard graph benchmark targets the 10K–100K node range that local development tools actually need.** The two dominant benchmarks from the Linked Data Benchmark Council — SNB and Graphalytics — are engineered for datasets orders of magnitude larger, and scaling them down introduces artifacts that undermine result validity. For teams building RAG knowledge graphs on the developer desktop, custom micro-benchmarks modeled on primitive graph operators offer the most reliable path to meaningful comparison. Published small-scale results, though sparse, already reveal that embedded engines like Kuzu and in-memory systems like FalkorDB dramatically outperform client-server Neo4j at this scale — but the landscape shifted significantly when Kuzu was [archived in October 2025](https://github.com/kuzudb/kuzu), narrowing the practical choices.

## LDBC benchmarks were never designed for small graphs

The [LDBC Social Network Benchmark (SNB)](https://ldbcouncil.org/benchmarks/snb/) defines scale factors (SF) that correspond approximately to CSV output size in gibibytes. Its smallest standard scale factor, **SF0.1**, produces roughly 300K total nodes and 1.7M edges — already above the 100K ceiling relevant to local tooling. The [Spark-based data generator](https://github.com/ldbc/ldbc_snb_datagen_spark) technically supports SF0.003 (~3 MB), but this produces only dozens of Person nodes and was built for integration testing, not performance measurement. At SF1, the dataset contains approximately **3 million nodes and 17 million edges**, as [confirmed by Memgraph's analysis](https://memgraph.com/blog/benchgraph-backstory-the-untapped-potential).

The deeper problem is query parameter curation. SNB's [Interactive workload specification](https://ldbcouncil.org/ldbc_snb_docs/ldbc-snb-specification.pdf) includes 14 complex read queries designed with a [choke-point driven methodology](https://www.vldb.org/pvldb/vol16/p877-szarnyas.pdf) that assumes sufficient data density for meaningful selectivity ranges. At 10K nodes, many parameterized queries return empty results or degenerate to trivial scans, defeating the benchmark's purpose of exercising query optimizer and execution engine bottlenecks.

[LDBC Graphalytics](https://ldbcouncil.org/benchmarks/graphalytics/) is even less applicable. Its scale metric is computed as **Scale(n, m) = ⌊10 × log₁₀(n + m)⌋ / 10**, and its smallest T-shirt size (2XS) begins at scale 6.5, requiring approximately 3.16 million total vertices plus edges. A graph with 100K nodes and 500K edges yields a scale of just **5.7** — completely off the chart. The benchmark's [specification document](https://ldbcouncil.org/ldbc_graphalytics_docs/graphalytics_spec.pdf) targets "Large-Scale Graph Analysis on Parallel and Distributed Platforms," and its six core algorithms (BFS, PageRank, WCC, CDLP, LCC, SSSP) are measured using EVPS (Edges and Vertices Per Second), a throughput metric that becomes meaningless when total processing time drops below measurement noise on small datasets.

## Micro-benchmarks offer the right granularity

The most rigorous alternative comes from Lissandrini et al.'s 2018 paper ["Beyond Macrobenchmarks"](https://www.vldb.org/pvldb/vol12/p390-lissandrini.pdf), published in PVLDB. Their framework decomposes complex graph queries into **35 primitive operator classes** spanning load, create, read, update, delete, and traversal operations. The key insight is that "any complex query can be typically decomposed into a combination of primitive operations, thus its performance can be explained by the performance of the components implementing them." This methodology is inherently **scale-agnostic** — the same operator tests apply whether the graph has 10K or 10M nodes, and performance differences surface cleanly without the parameter curation problems that plague LDBC at small scales.

For the specific case of 10K–50K node graphs, the [socialsensor/graphdb-benchmarks](https://github.com/socialsensor/graphdb-benchmarks) project provides the closest existing precedent. It tested Neo4j, OrientDB, Titan, and Sparksee at exactly **1,000 to 50,000 nodes** across four workloads: Louvain community detection, bulk insertion, incremental insertion, and a query workload covering FindNeighbors, FindAdjacentNodes, and FindShortestPath. While the system roster is dated, the methodology — combining synthetic LFR-Benchmark data with real SNAP datasets — remains sound for designing a modern small-scale comparison.

For RAG knowledge graph benchmarking specifically, a custom micro-benchmark suite should test five core query patterns that map directly to retrieval operations: **multi-hop traversal** (following entity relationships 2–3 hops to gather context), **pattern matching with property filters** (finding entities matching typed constraints), **community detection** (identifying topic clusters for global summarization, following the [Microsoft GraphRAG approach](https://graphrag.com/concepts/intro-to-graphrag/)), **shortest path** (computing relationship distance between concepts), and **subgraph extraction** (pulling a bounded neighborhood around a seed entity for LLM context windows). These patterns correspond to the GraphRAG retrieval archetypes documented by Neo4j's [GraphRAG pattern catalog](https://graphrag.com/concepts/intro-to-graphrag/), including Graph-Enhanced Vector Search, Local Subgraph Retrieval, and Community Summary Retrieval.

## The metrics that matter for local development diverge from production benchmarks

Standard benchmarks focus on throughput and tail latency under concurrent load. For a local development tool running single-threaded queries against a small graph, **cold-start time and baseline memory footprint dominate the user experience** far more than p99 latency under concurrency.

Industry RAG latency targets suggest **P95 ≤ 300ms and P99 ≤ 600ms** for interactive applications, as [documented by ChatNexus's benchmarking guide](https://articles.chatnexus.io/knowledge-base/performance-benchmarking-establishing-rag-system-k/). But the graph retrieval step is only one component of a RAG pipeline — the LLM inference step typically consumes 1–2 seconds at P99 even after optimization, according to [practical RAG tuning case studies](https://apxml.com/courses/large-scale-distributed-rag/chapter-7-performance-tuning-benchmarking-distributed-rag/practice-optimize-distributed-rag-performance). This means the graph query budget for interactive RAG is roughly **50–200ms**, making absolute latency at P50 the primary metric rather than tail behavior.

A benchmarking framework for local RAG tooling should track six metrics in priority order: **cold-start time** (process launch to first query result), **memory footprint at idle** (baseline cost of running the database), **P50 query latency** (typical interactive experience), **P95 query latency** (worst-case interactive experience), **data ingestion throughput** (time to rebuild the knowledge graph from source), and **on-disk storage size** (relevant for version-controlled project databases). Traditional throughput metrics (QPS) matter less because local tools rarely execute concurrent queries.

## Published results reveal sharp architectural divides at small scale

The most methodologically sound small-scale comparison is [Prashanth Rao's kuzudb-study](https://thedataquarry.com/blog/embedded-db-2/), which tested Kuzu against Neo4j on a synthetic social network of **100,000 nodes and 2.4 million edges** on a MacBook Pro M2. Using pytest-benchmark with 5 warmup rounds and a minimum of 5 measured rounds, the study found Kuzu **5.4× to 188.7× faster** across nine query types. The most dramatic gap appeared on 2-hop traversal: counting all second-degree paths (58 million paths) took **19.1ms in Kuzu versus 3.45 seconds in Neo4j** — a 180× difference attributable to Kuzu's factorized execution engine, which compresses many-to-many join intermediates exponentially. Filtered multi-hop queries (Q7: 3-hop traversal with property predicates) showed a **24× speedup**. Simple filtered lookups still favored Kuzu at a more modest 1.8×. Data ingestion was **18× faster** in Kuzu. These results align with the [CIDR 2023 paper by Jin et al.](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf), which demonstrated that Kuzu's factorization and worst-case optimal joins outperform relational engines by over 10× on multi-hop graph patterns at low selectivities.

**Kuzu's archival in October 2025 complicates these findings significantly.** The [project was suddenly discontinued](https://www.theregister.com/2025/10/14/kuzudb_abandoned/) with minimal explanation, and its on-disk format was [never fully stabilized](https://biggo.com/news/202510130126_KuzuDB-embedded-graph-database-archived) across releases. A community fork called [Bighorn](https://github.com/kuzudb/kuzu) exists under Kineviz's stewardship, but its long-term viability is uncertain. For production tool selection, Kuzu's benchmark results demonstrate what's architecturally possible but no longer represent an actively maintained option.

FalkorDB's [published benchmarks](https://www.falkordb.com/blog/graph-database-performance-benchmarks-falkordb-vs-neo4j/) against Neo4j use the SNAP Pokec dataset (~1.6M nodes, 30M edges) — larger than our target range. On that workload, FalkorDB reports **P50 of 55ms versus Neo4j's 577ms** (10.5×), with the gap widening dramatically at tail latencies: **P99 of 136ms versus 46,924ms** (344×). FalkorDB attributes this stability to its GraphBLAS-based [sparse matrix execution model](https://docs.falkordb.com/design/), which performs traversals as matrix multiplications in native C, avoiding Neo4j's JVM garbage collection pauses. For GraphRAG workloads specifically, FalkorDB [claims P50 of 36ms and P99 of 83ms](https://www.falkordb.com/) with a **6× memory advantage** (100MB vs 600MB). These are vendor-produced numbers and should be independently verified, as [Max De Marzi's critique of graph database benchmarks](https://maxdemarzi.com/2023/01/11/bullshit-graph-database-performance-benchmarks/) demonstrated that Neo4j achieves P50 of 14ms and P99 of 28ms on properly configured, independently tested workloads.

Neo4j Community Edition carries inherent overhead at small scale. JVM startup takes **3–10 seconds** for a small database, as documented in [GitHub issue #10494](https://github.com/neo4j/neo4j/issues/10494). The cold page cache requires manual warming since Community Edition [lacks the active warmup feature](https://neo4j.com/developer/kb/warm-the-cache-to-improve-performance-from-cold-start/) available only in Enterprise. Baseline memory consumption starts at **500MB–1GB** before any data loads, driven by JVM heap overhead — a finding consistent with [Memgraph's comparison](https://memgraph.com/blog/memgraph-vs-neo4j-performance-benchmark-comparison) showing Neo4j consuming 2.2GB versus 400MB for identical workloads. The Community Edition also [scales poorly beyond 4 CPU cores](https://groups.google.com/g/neo4j/c/LNBZXxTQHLk), though this matters less for single-user local tooling.

SQLite with recursive CTEs represents the lightweight baseline, but **no formal benchmark comparing it to purpose-built graph databases exists**. Architectural analysis reveals fundamental limitations: recursive CTEs [cannot track visited nodes](https://sqlite.org/forum/info/3b309a9765636b79) within the recursion, causing exponential blowup on dense graphs. On a 1-million node tree, a recursive CTE sum took **7.7 seconds versus 3.9 seconds** for manually chained JOINs at known depth, per [SQLite Forum benchmarks](https://sqlite.org/forum/info/016a25083a9f8eb5c6532ed5a961eb7c2362f667cbca305f65dccb2e82170df7). Multiple practitioners report [performance becoming "abysmal"](https://lobste.rs/s/x0fk0a/simple_graph_graph_database_sqlite) beyond several million nodes, and the [SQLite documentation itself](https://sqlite.org/lang_with.html) recommends LIMIT clauses as safety bounds on recursion depth. For RAG knowledge graphs, SQLite-based approaches are characterized as viable for roughly [100–1,000 documents](https://dev.to/stephenc222/how-to-build-lightweight-graphrag-with-sqlite-53le) — mapping to perhaps 1K–10K nodes, which is the low end of our target range.

## Designing a valid small-scale benchmark

Given the gaps in existing benchmarks, teams building local RAG tooling should construct custom micro-benchmark suites informed by three principles. First, use the Lissandrini primitive operator decomposition as the structural template, selecting the subset of their 35 query classes that map to RAG retrieval patterns — particularly neighbor expansion (their Q22–Q25), k-hop traversal (Q26–Q29), shortest path (Q30–Q31), and pattern matching with predicates (Q32–Q35). Second, measure cold-start explicitly by timing from process spawn to first successful query return, which captures JVM startup, module loading, page cache state, and connection establishment. Third, generate test data using the [LDBC SNB Spark Datagen](https://github.com/ldbc/ldbc_snb_datagen_spark) at SF0.003–SF0.03 to produce schema-rich social network graphs in the 10K–100K node range, supplemented with synthetic embedding vectors and text properties to simulate RAG entity nodes.

The embedded-versus-client-server architectural divide creates the most consequential performance difference at this scale. FalkorDB's [FalkorDBLite](https://www.falkordb.com/blog/falkordblite-embedded-python-graph-database/) now offers an embedded option that communicates via Unix domain sockets rather than TCP, narrowing the gap. SQLite remains unbeatable on cold-start time and minimal footprint but lacks native graph traversal primitives. Neo4j's JVM overhead represents a fixed tax that is proportionally enormous when total query time is measured in single-digit milliseconds.

## Conclusion

The central finding is a mismatch between benchmark infrastructure and practical need. **LDBC's benchmarks are inapplicable below ~300K nodes**, and Graphalytics requires millions. Custom micro-benchmarks using the Lissandrini decomposition methodology, populated with scaled-down LDBC data, represent the most defensible approach. Among the databases studied, the embedded architecture consistently wins at small scale: Kuzu (now archived) demonstrated 19ms 2-hop traversals on 100K nodes where Neo4j required 3.4 seconds, and FalkorDB's matrix multiplication approach delivers sub-100ms P99 with minimal memory overhead. For teams selecting a graph database for local RAG tooling today, the critical benchmarking dimensions are cold-start time and idle memory — metrics that no published benchmark suite adequately captures, and that expose architectural choices (JVM vs. native, client-server vs. embedded) far more starkly than the throughput-focused measurements dominating the literature.

## Bibliography

**LDBC Social Network Benchmark Specification (v2.2.5)**
https://ldbcouncil.org/benchmarks/snb/
Defines scale factors, query workloads, and the choke-point driven methodology for benchmarking graph database systems on social network data.

**LDBC Graphalytics Benchmark Specification (v1.0.6)**
https://ldbcouncil.org/benchmarks/graphalytics/
Specifies six core graph algorithms (BFS, PageRank, WCC, CDLP, LCC, SSSP) with T-shirt size scaling system; establishes EVPS metric for large-scale graph processing platforms.

**LDBC SNB Spark Data Generator**
https://github.com/ldbc/ldbc_snb_datagen_spark
Supports scale factors as low as SF0.003; enables generation of schema-rich social network graphs for testing at arbitrary scales.

**Szarnyas et al., "The LDBC Social Network Benchmark: Business Intelligence Workload" (PVLDB 2023)**
https://www.vldb.org/pvldb/vol16/p877-szarnyas.pdf
Describes the BI workload design, choke-point methodology, and auditing process for LDBC SNB.

**Lissandrini et al., "Beyond Macrobenchmarks: Microbenchmark-based Graph Database Evaluation" (PVLDB 2018)**
https://www.vldb.org/pvldb/vol12/p390-lissandrini.pdf
Proposes 35 primitive operator classes for fine-grained graph database evaluation; demonstrates scale-agnostic methodology applicable to small datasets.

**socialsensor/graphdb-benchmarks**
https://github.com/socialsensor/graphdb-benchmarks
Tests graph databases at 1K–50K node scale with clustering, insertion, and query workloads; closest existing benchmark to 10K–100K target range.

**Rao, "Embedded Databases (2): KuzuDB" (The Data Quarry, 2023)**
https://thedataquarry.com/blog/embedded-db-2/
Independent benchmark of Kuzu vs. Neo4j on 100K nodes / 2.4M edges; reports 5.4×–188.7× speedups with detailed methodology and reproducible code.

**Jin et al., "Making RDBMSs Efficient on Graph Workloads Through Predefined Joins" (CIDR 2023)**
https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf
Academic evaluation of Kuzu's factorization and worst-case optimal joins against DuckDB and Umbra on LDBC-100 multi-hop queries.

**FalkorDB Performance Benchmarks: FalkorDB vs. Neo4j (2024)**
https://www.falkordb.com/blog/graph-database-performance-benchmarks-falkordb-vs-neo4j/
Vendor benchmark on SNAP Pokec dataset; reports P50/P90/P99 latency comparisons with open-source benchmark tooling.

**FalkorDB Design Documentation**
https://docs.falkordb.com/design/
Describes GraphBLAS-based sparse matrix execution model, CSC storage format, and Redis module architecture.

**FalkorDBLite: Embedded Python Graph Database**
https://www.falkordb.com/blog/falkordblite-embedded-python-graph-database/
Documents embedded deployment model using Unix domain sockets; targets local development and CI/CD workflows.

**Neo4j Cache Warming Knowledge Base Article**
https://neo4j.com/developer/kb/warm-the-cache-to-improve-performance-from-cold-start/
Documents cold-start page cache behavior and manual warming strategy; notes active warmup unavailable in Community Edition.

**De Marzi, "Bullshit Graph Database Performance Benchmarks" (2023)**
https://maxdemarzi.com/2023/01/11/bullshit-graph-database-performance-benchmarks/
Critical analysis of vendor-produced graph database benchmarks; provides independently measured Neo4j latency numbers.

**Memgraph vs. Neo4j Performance Benchmark**
https://memgraph.com/blog/memgraph-vs-neo4j-performance-benchmark-comparison
Compares C++ in-memory engine vs. JVM-based Neo4j; documents 5× memory overhead of JVM architecture.

**SQLite WITH Clause Documentation**
https://sqlite.org/lang_with.html
Official documentation of recursive CTE semantics; describes UNION vs. UNION ALL behavior for cycle prevention.

**SQLite Forum: BFS Traversal Performance**
https://sqlite.org/forum/info/3b309a9765636b79
Community discussion of exponential blowup in recursive CTE graph traversal; documents need for external visited-node tracking.

**SQLite Forum: Recursive CTE Tree Benchmark**
https://sqlite.org/forum/info/016a25083a9f8eb5c6532ed5a961eb7c2362f667cbca305f65dccb2e82170df7
Benchmark of recursive CTE vs. manual JOINs on 1M-node tree; establishes 2× overhead of recursive approach.

**KuzuDB Archival (October 2025)**
https://www.theregister.com/2025/10/14/kuzudb_abandoned/
Reports sudden archival of KuzuDB project; documents community reaction and fork activity.

**GraphRAG Pattern Catalog**
https://graphrag.com/concepts/intro-to-graphrag/
Catalogs RAG retrieval patterns including Graph-Enhanced Vector Search, Community Summary Retrieval, and Local Subgraph Extraction.

**ChatNexus RAG Performance Benchmarking Guide**
https://articles.chatnexus.io/knowledge-base/performance-benchmarking-establishing-rag-system-k/
Establishes industry SLA targets: P95 ≤ 300ms, P99 ≤ 600ms for interactive RAG applications.

**Dayarathna et al., "Benchmarking Graph Data Management and Processing Systems: A Survey" (2020)**
https://arxiv.org/pdf/2005.12873
Comprehensive survey covering 20 graph benchmarks over 15 years; identifies standard metrics and methodology gaps.