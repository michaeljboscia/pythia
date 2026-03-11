# Qdrant as a vector database for RAG systems

Qdrant stands out among purpose-built vector databases as a Rust-native engine with uniquely strong filtered search capabilities, making it especially well-suited for retrieval-augmented generation workloads. Built entirely in Rust without garbage collection overhead, it delivers **sub-40ms p99 latencies at 99% recall** on multi-million vector collections while consuming roughly 9 GB of RAM per million OpenAI-scale (1536-dimensional) embeddings — a figure that drops to under 200 MB with binary quantization. What makes Qdrant particularly interesting for RAG is not raw speed alone but a collection of architectural decisions — filterable HNSW, named vectors, server-side hybrid search fusion, and atomic collection aliases — that directly address the messy realities of production retrieval pipelines. This report provides a grounded technical analysis of Qdrant's internals, features, and measured performance characteristics.

## How Qdrant's storage engine and HNSW index actually work

Qdrant organizes data through a six-layer architecture: API → Dispatcher → Storage → Collection → Shard → Segment. The [segment is the fundamental data container](https://qdrant.tech/documentation/concepts/storage/), holding independent vector storage, payload storage, vector indexes, payload indexes, and an internal-to-external ID mapper. Segments come in two flavors: appendable (read/write) and non-appendable (read/delete only, typically memory-mapped). At least one appendable segment exists per collection at all times. An optimizer continuously merges small segments, builds HNSW indexes, and converts segments to memory-mapped storage based on configurable thresholds.

All writes flow through a [write-ahead log (WAL)](https://qdrant.tech/documentation/concepts/points/) in a two-stage process. Data hits the WAL first — at which point it is durable even through power loss — then gets applied to segments asynchronously. Each segment tracks the version number of every point it contains, and any WAL entry with a sequence number below the point's current version gets silently skipped. This versioning scheme enables safe, idempotent replay after crashes.

A major architectural milestone arrived in [v1.13 with Gridstore](https://qdrant.tech/articles/gridstore-key-value-storage/), a custom Rust key-value store that replaced RocksDB for payload and sparse vector storage. RocksDB's LSM-tree compaction caused unpredictable latency spikes, and its generic key handling was overkill for Qdrant's sequential-ID access patterns. Gridstore uses a three-layer design — a data layer with fixed-size blocks and pointer-based lookup, a bitmask layer tracking used/free blocks, and a gaps layer managing higher-level free space. By [v1.17, RocksDB support was completely removed](https://github.com/qdrant/qdrant/releases/tag/v1.17.0).

### HNSW with payload-aware graph extensions

Qdrant uses [HNSW (Hierarchical Navigable Small World)](https://qdrant.tech/documentation/concepts/indexing/) as its sole dense vector index, chosen for two reasons: it is one of the fastest and most accurate ANN algorithms on [public benchmarks](https://github.com/erikbern/ann-benchmarks), and it is uniquely amenable to filter-aware modifications. The implementation exposes three key parameters: **`m` (default 16)** controlling edges per node, **`ef_construct` (default 100)** governing neighbor candidates during construction, and **`ef`** (defaults to `ef_construct`) setting search-time candidate evaluation breadth. The graph uses `m` edges for non-zero layers and `2m` for the dense zero layer, with points assigned to levels via geometric distribution.

The critical innovation is [filterable HNSW](https://qdrant.tech/articles/filtrable-hnsw/). Standard HNSW graphs "fall apart" under strict metadata filters because removing nodes breaks connectivity. Qdrant solves this by building **subgraphs per indexed payload value** and merging them into the main graph as additional edges. For a categorical filter like `brand = Apple`, the engine has already constructed a connected subgraph of Apple-tagged points, ensuring traversal remains efficient within that subset. For numerical ranges, the engine splits values into equal-sized buckets and connects neighboring buckets. For geo filters, it uses geohash identifiers as categories. The total edge count [increases by no more than 2x](https://qdrant.tech/articles/filtrable-hnsw/) regardless of how many payload categories exist.

At query time, a [per-segment query planner](https://qdrant.tech/documentation/concepts/indexing/) chooses strategy based on estimated filter cardinality. Weak filters (matching many points) use standard HNSW traversal that skips non-matching nodes. Strict filters matching few points below the `full_scan_threshold` (default 10,000 KB) bypass HNSW entirely, retrieving candidates from the payload index and brute-force rescoring. The middle ground — the problematic zone — leverages the filterable HNSW extensions. For cases where even filterable HNSW is insufficient (multiple simultaneous strict filters), [v1.16 introduced the ACORN algorithm](https://qdrant.tech/blog/qdrant-1.16.x/), which explores neighbors-of-neighbors (second hop) when direct neighbors are filtered out, based on the ACORN-1 paper.

One operational nuance matters: **Qdrant does not index payload fields by default**. Users must [explicitly create payload indexes](https://qdrant.tech/documentation/concepts/indexing/), ideally before uploading data, so the HNSW graph can incorporate filter-aware edges during construction rather than requiring costly segment reconstruction later.

## Quantization strategies and their recall-latency tradeoffs

Qdrant maintains quantized vectors [alongside originals](https://qdrant.tech/documentation/guides/quantization/), enabling a two-phase search: fast candidate retrieval on compressed vectors followed by optional rescoring against full-precision vectors. This design lets operators tune the recall-speed tradeoff at query time without re-indexing.

**Scalar quantization** (available since [v1.1](https://qdrant.tech/documentation/guides/quantization/)) converts float32 components to uint8, achieving **4x memory compression** with recall loss [typically under 1%](https://qdrant.tech/documentation/guides/quantization/). It leverages SIMD CPU instructions for fast 8-bit integer comparisons. Published benchmarks on the [Arxiv-titles-384-angular dataset](https://qdrant.tech/articles/scalar-quantization/) show precision dropping from 0.989 to 0.986 at `ef=128` while latency falls by 60.6%, and on [Gist-960](https://qdrant.tech/articles/scalar-quantization/) precision remains identical (0.802 vs 0.802) at `ef=128` with 44.2% latency reduction. In a memory-constrained scenario on slow network-attached disk, scalar quantization with rescoring boosted throughput from **2 RPS to 30 RPS** while maintaining 0.989 precision.

**Binary quantization** ([v1.5+](https://qdrant.tech/documentation/guides/quantization/)) reduces each component to a single bit — **32x compression** with up to **40x search speedup**. This extreme compression works only for high-dimensional vectors with centered component distributions. On the dbpedia dataset with OpenAI `text-embedding-ada-002` (1536d), binary quantization achieves [0.98 recall@100 with 4x oversampling](https://qdrant.tech/documentation/guides/quantization/); Cohere `embed-english-v2.0` (4096d) hits 0.98 recall@50 with just 2x oversampling. The memory impact is dramatic: [100K OpenAI vectors drop from 900 MB to 128 MB](https://qdrant.tech/articles/binary-quantization/).

The 2025 releases filled the gap between scalar and binary with **1.5-bit and 2-bit quantization** ([v1.15](https://qdrant.tech/documentation/guides/quantization/)). Two-bit quantization maps values into three buckets for **16x compression** and up to 20x speedup, performing well at 768–1024 dimensions. The 1.5-bit variant shares a zero-bit between value pairs for **24x compression** and up to 30x speedup, optimized for 1024–1536 dimensions. These intermediate options address binary quantization's weakness with near-zero vector components.

**Product quantization** ([v1.2+](https://qdrant.tech/documentation/guides/quantization/)) divides vectors into sub-vectors, quantizes each using k-means clustering with 256 centroids, and stores centroid indices as single bytes. It can achieve [up to 64x compression](https://qdrant.tech/articles/what-is-vector-quantization/) but comes with significant tradeoffs: distance calculations are not SIMD-friendly (actually slower than uncompressed in some cases), accuracy loss is higher (~0.7 vs baseline), and indexing requires codebook training.

**Asymmetric quantization** ([v1.15+](https://qdrant.tech/documentation/guides/quantization/)) uses different encodings for stored vectors versus queries — for instance, binary-quantized stored vectors paired with scalar-quantized queries. This preserves binary quantization's storage savings while improving precision, requiring less oversampling for equivalent recall.

The [official comparison table](https://qdrant.tech/documentation/guides/quantization/) summarizes the landscape:

| Method | Typical recall | Speed gain | Compression |
|--------|---------------|------------|-------------|
| Scalar (int8) | 0.99 | Up to 2x | 4x |
| Product | ~0.7 | 0.5x (slower) | Up to 64x |
| Binary (1-bit) | 0.95+ | Up to 40x | 32x |
| 1.5-bit | 0.95+ | Up to 30x | 24x |
| 2-bit | 0.95+ | Up to 20x | 16x |

At query time, three parameters control the tradeoff: `rescore` (re-evaluate top candidates against originals), `oversampling` (retrieve N× candidates from quantized index before rescoring), and `ignore` (skip quantization entirely). Higher oversampling monotonically improves recall at the cost of speed, and since [rescoring operates on a small candidate set](https://qdrant.tech/articles/binary-quantization/), the latency penalty is typically modest.

## Features that make Qdrant particularly suited for RAG

### Named vectors enable multi-representation retrieval

RAG pipelines frequently need multiple embeddings per document — a title vector for coarse retrieval, a chunk-level content vector for precision, or paired text and image embeddings. Qdrant's [named vectors](https://qdrant.tech/documentation/concepts/collections/) support this natively: each point can store arbitrarily many vectors, each with its own name, dimensionality, distance metric, HNSW configuration, and quantization settings. A single collection might contain a 1536-dimensional `content` vector using cosine distance alongside a 768-dimensional `summary` vector using dot product, each with independent index parameters. Search queries specify which named vector to use via the `using` parameter.

This goes beyond what most competitors offer. Pinecone supports only a single vector per record (using namespaces for partitioning, not multi-representation). Milvus added multiple vector field support but without Qdrant's per-vector configuration granularity. Qdrant also supports three [vector types within named vectors](https://qdrant.tech/documentation/concepts/vectors/): dense (standard float embeddings), sparse (for BM25/SPLADE-style keyword representations), and multivectors (for ColBERT-style late interaction models using `max_sim` comparison).

### Server-side hybrid search with configurable fusion

Since [v1.10, the Query API](https://qdrant.tech/documentation/concepts/hybrid-queries/) enables server-side hybrid search through a `prefetch` mechanism that runs multiple sub-queries and fuses their results. A typical RAG configuration prefetches results from both sparse and dense vectors, then combines them using either **Reciprocal Rank Fusion (RRF)** or **Distribution-Based Score Fusion (DBSF)**. RRF scores each result as `Σ 1/(k + rank)`, boosting items appearing near the top in multiple result sets. Version 1.17 added [weighted RRF](https://github.com/qdrant/qdrant/releases/tag/v1.17.0), letting operators assign custom weights to dense versus sparse signals.

Prefetches can be nested for multi-stage retrieval — for example, first retrieving candidates from quantized vectors, then rescoring against full-precision vectors, then reranking with ColBERT multivectors. This architecture keeps the entire retrieval pipeline server-side, eliminating round-trips that would add latency in a client-orchestrated approach.

### Collection aliases for zero-downtime model upgrades

When upgrading embedding models in production — a common RAG maintenance task — Qdrant's [collection aliases](https://qdrant.tech/documentation/concepts/collections/) enable blue-green deployments. An alias is an additional name for a collection, and all queries can use aliases interchangeably with collection names. The critical property: **alias switches are atomic**. A single API call can delete the old alias binding and create a new one, and since all changes happen atomically, no concurrent requests see an inconsistent state. The deployment pattern is straightforward: build a new collection with re-embedded vectors in the background, then atomically switch the production alias.

Neither Pinecone nor pgvector offers an equivalent mechanism. Weaviate has no native alias system. This feature eliminates the need for application-level routing logic or load balancer tricks during model migrations.

### Recommendation and discovery APIs

Beyond standard nearest-neighbor search, Qdrant's [Recommendation API](https://qdrant.tech/documentation/concepts/explore/) accepts both positive and negative example points, enabling preference-aware retrieval. Two strategies are available: `average_vector` computes a centroid from examples and runs standard search, while `best_score` evaluates each candidate against all examples individually, producing more diverse results. Since v1.6, [zero positive examples are supported](https://qdrant.tech/articles/new-recommendation-api/) — useful when you only know what a user dislikes. Cross-collection recommendations via the `lookup_from` parameter allow vectors from one collection to drive recommendations in another.

The [Discovery API](https://qdrant.tech/documentation/concepts/explore/) extends this further with context pairs that divide the vector space into preference zones. Combined with v1.17's [Relevance Feedback Query](https://qdrant.tech/blog/qdrant-1.17.x/), which adjusts scoring based on user feedback signals, these features support iterative retrieval refinement that goes well beyond simple similarity search.

### Snapshots and operational resilience

Qdrant [snapshots](https://qdrant.tech/documentation/concepts/snapshots/) are tar archives containing a collection's complete state — configuration, points, and payloads — at a specific moment. They can be stored locally or [directly on S3 since v1.10](https://qdrant.tech/documentation/concepts/snapshots/). Recovery supports three methods: from URL, from uploaded file, or at startup via CLI. A priority setting controls conflict resolution when restoring to non-empty nodes, choosing between snapshot-wins and replica-wins semantics. Collection aliases are deliberately excluded from snapshots and must be migrated separately — a design choice that prevents alias collisions during cross-cluster restores.

## Measured performance at scale

### Memory consumption follows a predictable formula

Qdrant's [capacity planning documentation](https://qdrant.tech/documentation/guides/capacity-planning/) provides a straightforward formula: `memory = 1.5 × vectors × dimensions × 4 bytes`, where the 1.5× multiplier accounts for HNSW graph overhead, point metadata, and temporary segments during optimization. For **1 million vectors at 1536 dimensions** (OpenAI embeddings), this works out to approximately **9.2 GB of RAM** with no quantization.

Quantization dramatically changes this equation. Scalar quantization (4x compression) reduces the vector portion to roughly **2.3 GB** including overhead. Binary quantization (32x compression) drops vector storage to approximately **192 MB** for one million 1536d vectors, though the HNSW graph itself still requires RAM unless placed on disk via `hnsw_config.on_disk = true`. At the extreme end, [Qdrant's memory consumption article](https://qdrant.tech/articles/memory-consumption/) demonstrates that 1.18 million 100-dimensional GloVe vectors can run in as little as **135 MB** with both vectors and HNSW on memory-mapped storage — though at a severe throughput cost of 0.33 RPS on network-attached disk, rising to 50 RPS on a high-IOPS SSD.

The recommended production configuration for memory optimization keeps quantized vectors in RAM (`always_ram: true`) while placing originals on disk (`on_disk: true`). This preserves fast candidate retrieval through quantized vectors while allowing rescoring against disk-resident originals with acceptable latency, since rescoring operates on a small candidate set.

### Query latency and throughput across benchmarks

Qdrant's performance numbers come from multiple sources with varying methodologies and biases, so interpreting them requires context.

**Qdrant's own benchmarks** (updated [January/June 2024](https://qdrant.tech/benchmarks/single-node-speed-benchmark/)) tested against Elasticsearch, Milvus, Redis, and Weaviate on an 8-vCPU, 32 GB Azure instance across four datasets including the critical `dbpedia-openai-1M-angular` (1M vectors, 1536d). Qdrant reported achieving the **highest requests per second and lowest latencies across nearly all scenarios** regardless of precision threshold, with a noted 4x RPS improvement over its own previous version on some datasets. Their benchmark code is open-source, though they acknowledge: "Even if we try to be objective, we are not experts in using all the existing vector databases."

A [third-party test by Particula.tech](https://particula.tech/blog/pinecone-vs-qdrant-comparison) on 10 million 1536-dimensional vectors found Qdrant Cloud delivering **22ms p95 latency** for top-10 retrieval versus Pinecone Serverless at 45ms. Filtered search showed a wider gap: **55ms p95** for Qdrant versus 120ms for Pinecone. Throughput ranged from 8,000–15,000 QPS for Qdrant against 5,000–10,000 for Pinecone. Indexing was twice as fast: approximately **2,778 vectors/second** (1M vectors in 6 minutes) versus Pinecone's 1,389 vectors/second.

The most rigorous independent benchmark comes from [TigerData (formerly Timescale)](https://www.tigerdata.com/blog/pgvector-vs-qdrant), testing 50 million 768-dimensional vectors at 99% recall using a fork of ANN-benchmarks. Qdrant achieved **30.75ms p50, 36.73ms p95, and 38.71ms p99** — remarkably tight tail latencies indicating consistent performance. However, pgvector with pgvectorscale delivered 11.4× higher throughput (471 QPS vs 41 QPS) via DiskANN's parallelism, though with much worse tail latency (74.60ms p99). This benchmark was produced by pgvectorscale's creators and should be evaluated accordingly, but the tight latency distribution Qdrant exhibits is a genuine architectural advantage attributable to Rust's lack of garbage collection pauses.

On the standardized [ann-benchmarks.com](https://ann-benchmarks.com/qdrant.html), Qdrant appears alongside hnswlib, FAISS, ScaNN, and others with recall-vs-QPS plots, though the results are presented as interactive charts rather than extractable tables. A separately reported figure places Qdrant at [626 QPS at 99.5% recall on 1 million vectors](https://qdrant.tech/blog/qdrant-benchmarks-2024/), described as roughly 3× faster than Elasticsearch on equivalent configurations.

### Filtered search is where Qdrant's architecture pays off

Qdrant's [filtered search benchmark](https://qdrant.tech/benchmarks/filtered-search-intro/) reveals performance characteristics that matter enormously for RAG systems, where metadata filtering (by document source, date range, user permissions, or tenant ID) accompanies virtually every query. The benchmark found that some competing engines suffer **accuracy collapse** under restrictive filters because their HNSW graphs lose connectivity. Qdrant's filterable HNSW extensions maintain graph navigability under filtering, and for very strict filters, the query planner's ability to bypass HNSW entirely and use payload index + brute force actually provides a **speed boost** — counter-intuitively, heavily filtered queries can be faster than unfiltered ones.

This architectural advantage is amplified by specialized index types introduced in recent versions. The [tenant index](https://qdrant.tech/documentation/concepts/indexing/) (`is_tenant: true`, v1.11+) optimizes on-disk data locality for multi-tenant workloads by co-locating tenant-specific data, reducing disk reads. The [principal index](https://qdrant.tech/documentation/concepts/indexing/) (`is_principal: true`) does the same for primary filter dimensions like timestamps. And [v1.16's tiered multitenancy](https://qdrant.tech/blog/qdrant-1.16.x/) allows promoting high-volume tenants to dedicated shards while keeping smaller tenants in shared segments.

## How Qdrant compares to the alternatives

The vector database landscape offers several viable options for RAG, each with distinct strengths. **Pinecone** provides a fully managed serverless experience with zero operational overhead but lacks named vectors, atomic collection aliases, and a recommendation API. Its single-vector-per-record model forces architectural workarounds for multi-representation retrieval. **Milvus** excels at billion-scale datasets with multiple index types (IVF, DiskANN, HNSW) and GPU support, but its heavier deployment footprint — multiple microservices, etcd dependency — makes it better suited for teams with dedicated data infrastructure engineers.

**Weaviate** offers strong built-in vectorization modules and GraphQL access, positioning it well for teams that want embedding generation handled by the database layer. However, [multiple comparison sources](https://liquidmetal.ai/casesAndBlogs/vector-comparison/) note higher memory consumption at scale versus Qdrant's Rust-based engine. **pgvector** represents the minimalist option — no new infrastructure, standard PostgreSQL tooling — and with pgvectorscale achieves impressive throughput, but lacks native hybrid search fusion, recommendation APIs, named vectors, and the operational features (aliases, snapshots) that smooth production RAG deployments.

Qdrant's Rust implementation delivers a concrete resource advantage. Without garbage collection, it avoids the latency spikes that Go-based (Weaviate, Milvus) and JVM-based engines exhibit under memory pressure. The [Qdrant team reports](https://qdrant.tech/documentation/concepts/storage/) 2–3× lower memory consumption compared to Go alternatives for equivalent workloads, and the tight p99/p50 latency ratios observed in independent benchmarks corroborate this claim.

## The distributed architecture and operational model

In distributed mode, Qdrant uses [Raft consensus](https://qdrant.tech/documentation/guides/distributed_deployment/) for cluster topology and collection structure management, while data operations use optimistic replication for speed. This split design — strong consistency for metadata, eventual consistency for data — prioritizes availability and throughput over strict linearizability for individual point writes. The `write_consistency_factor` parameter lets operators tune this tradeoff per request.

Collections are [horizontally sharded](https://qdrant.tech/documentation/guides/distributed_deployment/) with either automatic hash-ring distribution or user-defined shard keys for logical partitioning (e.g., by tenant or region). Each shard is managed by a `ShardReplicaSet` maintaining replicas across peers. Shard transfers between nodes support three methods: stream records (default), snapshot transfer, and WAL delta (for minimal data movement). Resharding — changing shard count without collection recreation — operates transparently with zero downtime.

The [v1.17 release](https://qdrant.tech/blog/qdrant-1.17.x/) introduced several operational refinements: delayed fan-outs to reduce tail latency in distributed queries, an update queue buffering up to 1 million pending changes, a `prevent_unoptimized` optimizer setting that throttles ingestion to match indexing capacity, and an indexed-only search mode that refuses to query unindexed segments. These features reflect growing production maturity, addressing the kinds of operational edge cases that only surface at scale.

As of February 2026, Qdrant has accumulated [over 29,400 GitHub stars](https://github.com/qdrant/qdrant/releases/tag/v1.17.0) and is used in production by organizations including [Tripadvisor](https://qdrant.tech/blog/2025-recap/) (powering AI Trip Planner across 1 billion reviews), [HubSpot](https://qdrant.tech/blog/2025-recap/) (Breeze AI assistant), and [OpenTable](https://qdrant.tech/blog/2025-recap/) (AI Concierge filtering 60,000+ restaurants). Official client libraries exist for [Python, TypeScript, Rust, Go, Java, and C#](https://github.com/qdrant/qdrant), with deep integrations into LangChain, LlamaIndex, and OpenAI's retrieval plugin.

## Conclusion

Qdrant's architecture reflects deliberate engineering choices that align well with RAG system requirements. The filterable HNSW implementation — not pre-filtering, not post-filtering, but in-algorithm filtering with payload-aware graph extensions — solves the metadata filtering problem that plagues simpler ANN implementations. The quantization hierarchy from scalar (4x, 0.99 recall) through binary (32x, 0.95+ recall) provides a practical compression-accuracy continuum that lets operators right-size memory costs. Named vectors and server-side hybrid search fusion with weighted RRF eliminate client-side orchestration complexity that adds latency and failure modes.

The performance data, triangulated across Qdrant's own benchmarks, independent ann-benchmarks entries, and third-party tests, consistently shows **sub-40ms tail latencies** at high recall on million-scale collections, with filtered search maintaining or even improving on unfiltered performance — a characteristic unique to Qdrant's approach. The main trade-off versus competitors is throughput at extreme scale: Milvus handles billion-vector collections more naturally, and pgvectorscale achieves higher QPS through DiskANN parallelism, though with worse tail latency.

For teams building RAG systems at the 1M–100M vector scale who need strong filtered search, multi-model embedding support, and operational features like blue-green deployment and hybrid search fusion, Qdrant represents one of the strongest available choices — particularly if tight, predictable tail latency matters more than maximum aggregate throughput.

## Bibliography

| Title | URL | Key Contribution |
|-------|-----|-----------------|
| Qdrant Indexing Documentation | https://qdrant.tech/documentation/concepts/indexing/ | HNSW parameters, payload index types, query planning strategy, filterable HNSW details |
| Qdrant Quantization Guide | https://qdrant.tech/documentation/guides/quantization/ | All quantization methods, compression ratios, accuracy/speed tables, search-time parameters |
| Qdrant Storage Concepts | https://qdrant.tech/documentation/concepts/storage/ | Segment architecture, WAL mechanics, vector/payload storage options, memory-mapped storage |
| Qdrant Collections Documentation | https://qdrant.tech/documentation/concepts/collections/ | Named vector configuration, aliases, distance metrics, optimizer settings |
| Qdrant Vectors Documentation | https://qdrant.tech/documentation/concepts/vectors/ | Dense/sparse/multivector types, data types (float32/float16/uint8) |
| Qdrant Hybrid Queries Documentation | https://qdrant.tech/documentation/concepts/hybrid-queries/ | Query API prefetch mechanism, RRF and DBSF fusion, multi-stage search |
| Qdrant Explore Documentation | https://qdrant.tech/documentation/concepts/explore/ | Recommendation API, Discovery API, context pairs |
| Qdrant Snapshots Documentation | https://qdrant.tech/documentation/concepts/snapshots/ | Snapshot creation/restore, S3 storage, priority settings |
| Qdrant Capacity Planning Guide | https://qdrant.tech/documentation/guides/capacity-planning/ | Memory estimation formula (1.5× multiplier) |
| Filterable HNSW Article | https://qdrant.tech/articles/filtrable-hnsw/ | Technical details of payload-aware HNSW graph extensions, edge budget (≤2x) |
| Scalar Quantization Article | https://qdrant.tech/articles/scalar-quantization/ | Benchmark data: precision/latency tables for Arxiv-titles-384, Gist-960 datasets |
| Binary Quantization Article | https://qdrant.tech/articles/binary-quantization/ | OpenAI/Cohere recall benchmarks, memory reduction (900MB→128MB for 100K vectors) |
| What is Vector Quantization | https://qdrant.tech/articles/what-is-vector-quantization/ | Product quantization mechanics, compression examples |
| Gridstore Key-Value Storage Article | https://qdrant.tech/articles/gridstore-key-value-storage/ | RocksDB replacement rationale, three-layer storage design |
| Qdrant Memory Consumption Article | https://qdrant.tech/articles/memory-consumption/ | Minimal RAM experiments: 135MB for 1.18M vectors with full mmap |
| New Recommendation API Article | https://qdrant.tech/articles/new-recommendation-api/ | Recommendation strategies (average_vector, best_score), zero-positive support |
| Qdrant 1.17 Release Blog | https://qdrant.tech/blog/qdrant-1.17.x/ | Relevance Feedback Query, delayed fan-outs, prevent_unoptimized optimizer |
| Qdrant 1.16 Release Blog | https://qdrant.tech/blog/qdrant-1.16.x/ | ACORN algorithm, tiered multitenancy, inline storage, AVX512 optimizations |
| Qdrant 1.14 Release Blog | https://qdrant.tech/blog/qdrant-1.14.x/ | Score-boosting reranker, incremental HNSW indexing |
| Qdrant Benchmarks 2024 | https://qdrant.tech/benchmarks/single-node-speed-benchmark/ | Official benchmark setup and results vs Elasticsearch, Milvus, Redis, Weaviate |
| Qdrant Filtered Search Benchmark | https://qdrant.tech/benchmarks/filtered-search-intro/ | Accuracy collapse in competitors under strict filtering |
| Qdrant 2025 Recap | https://qdrant.tech/blog/2025-recap/ | Production users (Tripadvisor, HubSpot, OpenTable), feature summary, 2026 roadmap |
| Qdrant GitHub Repository | https://github.com/qdrant/qdrant | Stars count, language, license, README, client libraries, integrations |
| Qdrant v1.17.0 Release Notes | https://github.com/qdrant/qdrant/releases/tag/v1.17.0 | Weighted RRF, audit logging, Qdrant Edge, RocksDB removal |
| Qdrant Distributed Deployment Docs | https://qdrant.tech/documentation/guides/distributed_deployment/ | Raft consensus, sharding, replication, shard transfer methods |
| ann-benchmarks.com Qdrant Entry | https://ann-benchmarks.com/qdrant.html | Standardized recall-vs-QPS plots for Qdrant |
| Particula.tech: Pinecone vs Qdrant | https://particula.tech/blog/pinecone-vs-qdrant-comparison | Third-party 10M vector benchmark: p95 latencies, indexing throughput, filtered search |
| TigerData: pgvector vs Qdrant | https://www.tigerdata.com/blog/pgvector-vs-qdrant | 50M vector ANN-benchmark fork: p50/p95/p99 latencies, throughput comparison |
| Qdrant Filterable HNSW Course | https://qdrant.tech/course/essentials/day-2/filterable-hnsw/ | Query planner strategy explanation, filter cardinality decision tree |
| Qdrant Optimization Guide | https://qdrant.tech/documentation/guides/optimize/ | Four optimization strategies: speed, memory, precision, throughput tuning |
| DeepWiki Qdrant System Architecture | https://deepwiki.com/qdrant/qdrant/2-system-architecture | Six-layer architecture, Actix-web/Tonic frameworks, consensus manager design |