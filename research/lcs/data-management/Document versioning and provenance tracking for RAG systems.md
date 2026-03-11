# Document versioning and provenance tracking for RAG systems

RAG systems that cannot trace when and where their knowledge originated are fundamentally untrustworthy. **The immutable-append model — storing every version of every document chunk as a timestamped, content-hashed record — is the architecturally superior choice for RAG knowledge bases that require provenance**, despite costing 3–10× more storage than mutable-overwrite. This approach makes temporal queries ("what did the system know at time T?") a native O(1) operation rather than an afterthought requiring audit tables and change-data-capture infrastructure. When combined with git commit SHAs as immutable version anchors and structured provenance metadata in vector database payloads, this architecture delivers cryptographically verifiable traceability from every generated answer back to its exact source text. Two recent research systems — VersionRAG and LiveVectorLake — validate this approach, achieving **90% accuracy on version-aware QA** and **85–90% reduction in re-processing costs** during incremental updates, respectively.

## The case for immutable-append over mutable-overwrite

The versioning debate for RAG knowledge bases mirrors a decades-old architectural tension in database design. Mutable-overwrite systems (standard SQL UPDATE-in-place with timestamps) keep storage bounded and simplify current-state queries — you never filter out historical records because they don't exist. Immutable-append systems (event sourcing, Datomic-style temporal records) preserve every state transition as an atomic fact, enabling full temporal reconstruction at the cost of monotonically growing storage.

**Datomic**, Rich Hickey's immutable database, demonstrates the append-only model at its most principled. Every piece of data is stored as a [datom](https://docs.datomic.com/datomic-overview.html) — a five-tuple of `[entity, attribute, value, transaction, added?]` where `added?` is a boolean distinguishing assertions from retractions. As Hickey wrote, "since one can't change the past, this implies that the database accumulates facts, rather than updates places." When someone "changes" their address, Datomic records the new address fact and retracts the old one — both remain in the log permanently. Temporal queries use [`d/as-of`](https://docs.datomic.com/datomic-overview.html) to obtain an immutable database snapshot at any past transaction, and `d/history` to retrieve the complete timeline of assertions and retractions for any entity. Datomic maintains [four persistent tree indexes](https://docs.datomic.com/operation/architecture.html) (EAVT, AEVT, AVET, VAET) whose nodes are immutable segments cacheable anywhere without invalidation logic — a critical performance property when serving high-throughput RAG queries.

**XTDB** (formerly Crux) extends this model with first-class [bitemporality](https://docs.xtdb.com/intro/what-is-xtdb.html). Where Datomic natively tracks only transaction-time (when facts were recorded) and requires application-level modeling for valid-time (when facts are true in the real world), XTDB automatically maintains four temporal columns on every table: `_system_from`, `_system_to`, `_valid_from`, and `_valid_to`. This distinction matters for RAG: a compliance document published January 15 but ingested January 20 has different valid-time and system-time — and queries like "what policy was in effect on January 17?" require bitemporal reasoning. XTDB supports [SQL:2011 temporal queries](https://docs.xtdb.com/about/time-in-xtdb.html) including `FOR VALID_TIME AS OF` and `FOR ALL SYSTEM_TIME`, plus Allen interval algebra operators for period comparisons. Its v2 architecture stores data in Apache Arrow columnar format on commodity object storage, [partitioning current and historical data](https://xtdb.com/blog/building-a-bitemp-index-1-taxonomy) so that "as-of-now" queries barely touch historical segments.

The storage cost tradeoff is real but manageable. Immutable systems grow monotonically — every edit creates new records rather than overwriting old ones. As [Hydrolix's analysis notes](https://hydrolix.io/glossary/immutability/), "without careful retention management, this can cause exponential data growth." But as Pat Helland argued in his influential ACM Queue paper, ["the truth is the log. The database is a cache of a subset of the log."](https://queue.acm.org/detail.cfm?id=2884038) The mitigation strategies are well-understood: periodic snapshots (Martin Fowler's [event sourcing pattern](https://martinfowler.com/eaaDev/EventSourcing.html) recommends overnight snapshots with event replay from the latest snapshot on crash recovery), retention policies that expire versions beyond a configurable window, and XTDB's approach of partitioning hot current data from cold historical data across storage tiers.

Query complexity diverges sharply between the two models. Immutable-append systems answer "what did the system know at time T?" with a single index lookup — Datomic's `d/as-of(t)` dereferences a root pointer in the persistent tree, effectively **O(1) for snapshot access**. Mutable systems require [slowly-changing dimension tables, triggers, or change-data-capture pipelines](https://www.odbms.org/2015/10/the-rise-of-immutable-data-stores/) — all of which add latency, complexity, and failure modes. For a RAG system where provenance auditing is a core requirement (tracing a generated answer back to the exact document version that informed it), the immutable model's native temporality eliminates an entire category of infrastructure.

## Structuring provenance metadata for vector databases

Provenance metadata must be stored alongside every vector embedding in the knowledge base, and each major vector database handles this differently. The metadata schema should capture six dimensions: **source identity** (where did this content come from?), **version identity** (which version?), **content identity** (what exactly is in this chunk?), **temporal identity** (when was it created, last verified?), **processing identity** (how was it embedded?), and **validity status** (is it current?).

A comprehensive provenance payload looks like this:

```json
{
  "source_file": "compliance_policy_v3.md",
  "document_id": "doc_7f3a9b",
  "git_sha": "a1b2c3d4e5f6789...",
  "chunk_hash": "sha256:e3b0c44298fc1c149...",
  "chunk_index": 5,
  "page_number": 12,
  "section_header": "5.3 Data Retention Requirements",
  "created_at": "2025-10-21T11:28:00Z",
  "last_verified_at": "2026-01-15T09:00:00Z",
  "source_modified_at": "2025-10-20T09:00:00Z",
  "extraction_model_version": "text-embedding-3-small-v2",
  "chunking_config_hash": "sha256:f4a7b2...",
  "is_current": true,
  "valid_from": "2025-10-20T00:00:00Z",
  "valid_to": null
}
```

**[Qdrant](https://qdrant.tech/documentation/concepts/payload/)** offers the most flexible metadata model among leading vector databases. Each point carries an arbitrary JSON payload with no hard per-point size limit — constrained only by hardware and a configurable REST API request limit (default **32MB**). Qdrant supports [typed payload indexes](https://qdrant.tech/documentation/concepts/indexing/) on keyword, integer, float, datetime, boolean, UUID, geo, and full-text fields. Creating datetime indexes on `created_at` and `last_verified_at` enables efficient temporal filtering. The [`on_disk_payload`](https://qdrant.tech/documentation/concepts/storage/) option stores large payloads in RocksDB rather than RAM, reducing memory costs 5–10× while keeping indexed fields in memory for fast filtered search. Qdrant's filterable HNSW integrates [payload filtering directly into graph traversal](https://qdrant.tech/articles/vector-search-filtering/), and the ACORN algorithm handles moderate-selectivity filters without falling back to brute force.

**[Weaviate](https://docs.weaviate.io/weaviate/search/filters)** takes a schema-first approach, requiring typed property definitions per collection. It automatically tracks `creationTimeUnix` and `lastUpdateTimeUnix` for every object — useful baseline temporal metadata without custom implementation. Weaviate builds [roaring bitmap indexes](https://docs.weaviate.io/weaviate/starter-guides/managing-resources/indexing) per property with configurable `indexFilterable` and `indexRangeFilters` flags. Range filters on date properties use bitmap slice indexing, making temporal range queries efficient. Since v1.34, Weaviate defaults to the ACORN filter strategy for pre-filtered vector search.

**[Pinecone](https://docs.pinecone.io/guides/data/understanding-metadata)** is the most constrained: metadata must be a flat JSON object (no nesting), with a hard limit of **40KB per record**. Supported types are limited to strings, integers (stored as 64-bit floats), floats, booleans, and string arrays. Filter operators follow MongoDB syntax (`$eq`, `$gt`, `$in`, etc.) with a maximum of **10,000 values per `$in`/`$nin` clause**. Pinecone's [single-stage filtering](https://docs.pinecone.io/guides/search/filter-by-metadata) merges vector and metadata indexes, avoiding the accuracy problems of post-filtering, but highly selective filters on serverless indexes may not satisfy `top_k` if matching clusters are sparse.

For production deployments, the recommendation is to store only filtering-relevant metadata in the vector database and keep full provenance records (complete git blame output, document processing logs) in a relational or graph database linked by `chunk_id`. Index only the fields actually used in filter queries — unnecessary indexes waste RAM. **Content hashing with SHA-256** serves double duty: the `chunk_hash` field enables deduplication (skip re-embedding unchanged chunks) and integrity verification (detect tampering or corruption). The [LiveVectorLake architecture](https://arxiv.org/html/2601.05270) demonstrated that content-addressable hashing reduces re-processing to **10–15% of chunks per update** versus 100% for full re-indexing.

## Git as an immutable provenance backbone

Git's content-addressable object model provides a natural provenance backbone for documentation-sourced RAG systems. Every commit SHA is a cryptographic hash of the entire repository snapshot — changing any file content, metadata, or parent reference produces a different hash. With Git 2.51 (August 2025), [SHA-256 became the default](https://cybersecuritynews.com/git-2-51-released/) for new repositories, strengthening this guarantee against collision attacks. A RAG chunk that stores `(commit_sha, file_path, line_start, line_end)` as its provenance record can always be dereferenced to the exact source text via `git show <sha>:<filepath>`.

**[`git blame`](https://git-scm.com/docs/git-blame)** enables line-level attribution — annotating each line with the commit that last modified it, its author, and timestamp. The `--porcelain` flag produces machine-readable output with full 40-byte SHAs, author metadata, and line mappings, making it suitable for automated provenance extraction. The `-L <start>,<end>` flag restricts blame to specific line ranges, and `-C` detects content copied across files — essential for tracking knowledge that migrates between documents during reorganization. For a RAG chunk mapped to lines 45–72 of `policy.md`, `git blame --porcelain -L 45,72 policy.md` returns per-line attribution that can populate provenance metadata: the most recent commit date becomes `last_verified_at`, and the oldest commit date indicates content stability.

**[`git log`](https://git-scm.com/docs/git-log)** complements blame with file-level and line-range change frequency analysis. The command `git log --format="%H %at" --follow -- <file>` produces a chronological list of every commit touching a file (following renames), enabling hot-spot detection: files with high change frequency need more aggressive re-indexing schedules. The `-L :<funcname>:<file>` option traces the evolution of a specific function or section across history — directly applicable to tracking how a particular chunk's source text evolved over time. The pickaxe option (`-S <string>`) finds commits that changed the number of occurrences of a specific string, useful for detecting when key terms or definitions were added or removed.

Performance costs vary dramatically with repository scale. On typical files in medium repositories, `git blame` completes in under one second. On the Linux kernel (200K+ commits), blame for a typical file takes about **4 seconds**, but a 30,000-line file with 3,000 touching commits requires [50–145 seconds](https://public-inbox.org/git/CABXAcUzoNJ6s3=2xZfWYQUZ_AUefwP=5UVUgMnafKHHtufzbSA@mail.gmail.com/T/) depending on pack file configuration — and `git repack -Adf --depth=20 --window=200` yields a 3× improvement. Facebook's internal repository (4 million commits) showed [blame times of 44 minutes cold cache, 11 minutes warm](https://public-inbox.org/git/CB5074CF.3AD7A%25joshua.redstone@fb.com/T/). For programmatic access, **libgit2 is roughly 14× slower than the git CLI** for blame operations — [gitui benchmarks](https://github.com/extrawurst/gitui/issues/673) showed 197 seconds via libgit2 versus 14 seconds via CLI on the same Linux kernel file. Shell-out to the git binary is the pragmatic choice for blame-heavy workloads.

Remote API access introduces rate limits that constrain provenance extraction at scale. The [GitHub REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) allows **5,000 requests per hour** with authentication (60 unauthenticated), with search endpoints capped at 30 requests per minute. The GraphQL API provides **5,000 points per hour** with a 500,000-node limit per query. [GitLab](https://docs.gitlab.com/security/rate_limits/) defaults to **7,200 requests per hour** (120/minute) for authenticated users. For knowledge bases with thousands of documents, the most practical approach is cloning the repository locally and running git operations against the local copy, reserving API calls for webhook-triggered incremental updates.

## What RAG frameworks provide today — and what they don't

Neither LangChain nor LlamaIndex provides built-in provenance tracking, creating a gap that custom infrastructure must fill. [LangChain's `Document` class](https://api.python.langchain.com/en/latest/documents/langchain_core.documents.base.Document.html) stores `page_content` (string) and `metadata` (arbitrary dict), with metadata preserved through text splitting — each child chunk inherits parent metadata plus a `start_index` character offset. But there is no version chain, no temporal tracking, and no change detection. The optional `id` field (added in v0.2.11) supports deduplication but not versioning.

[LlamaIndex](https://docs.llamaindex.ai/en/stable/module_guides/indexing/document_management/) comes closer with its `refresh_ref_docs()` method, which compares documents by `doc_id` and detects text content changes, only re-indexing modified documents. It also provides rich [metadata extraction pipelines](https://docs.llamaindex.ai/en/stable/module_guides/indexing/metadata_extraction/) — `SummaryExtractor`, `KeywordExtractor`, `EntityExtractor` — that can enrich chunk metadata automatically. The `excluded_embed_metadata_keys` and `excluded_llm_metadata_keys` controls allow selective metadata exposure to embedding models versus LLMs. However, when a document is updated, **old nodes are deleted and replaced** — there is no mechanism to retain historical versions or perform point-in-time queries.

**[VersionRAG](https://arxiv.org/abs/2510.08109)** (Huwiler et al., October 2025) is the first framework to explicitly model document versioning for retrieval-augmented generation. It constructs a hierarchical graph during indexing that captures version sequences, explicit and implicit changes between versions, and version-specific content boundaries. A query router classifies user intent (version-specific, cross-version comparison, or change detection) and routes to specialized retrieval paths. On the VersionQA benchmark (100 questions across 34 versioned technical documents), VersionRAG achieved **90% overall accuracy** versus 58% for naive RAG and 64% for GraphRAG, with 60% accuracy on implicit change detection where baselines scored 0–10%. Remarkably, it consumed **97% fewer indexing tokens** than GraphRAG ($0.17 versus $6.67 in API costs).

## Graph-based provenance and the W3C PROV model

Graph databases offer the most expressive provenance representation, modeling the full lineage from source document through chunking, embedding, and retrieval as a traversable network. The [W3C PROV-O ontology](https://www.w3.org/TR/prov-o/) provides a standardized vocabulary built on three core concepts: **Entities** (documents, chunks, embeddings), **Activities** (chunking, embedding, retrieval), and **Agents** (pipelines, users, models). Key relationships include `wasGeneratedBy` (chunk generated by chunking activity), `wasDerivedFrom` (chunk derived from document version), and critically `wasRevisionOf` (new chunk is a revision of previous chunk) — directly modeling version chains.

In [Neo4j](https://medium.com/neo4j/getting-started-with-provenance-and-neo4j-b50f666d8656), these PROV concepts map naturally to property graph nodes and relationships with temporal properties. A practical RAG provenance graph would represent: `(SourceDocument)-[:HAS_VERSION]->(DocVersion)-[:CHUNKED_BY]->(ChunkingActivity)-[:PRODUCED]->(Chunk)-[:EMBEDDED_BY]->(EmbeddingActivity)-[:PRODUCED]->(Embedding)`. Neo4j supports [bitemporal versioning patterns](https://medium.com/neo4j/keeping-track-of-graph-changes-using-temporal-versioning-3b0f854536fa) with `validFrom`/`validTo` timestamp pairs on both business-time and processing-time dimensions. The [CORE memory system](https://blog.getcore.me/building-a-knowledge-graph-memory-system-with-10m-nodes-architecture-failures-and-hard-won-lessons/) demonstrates this at scale with 10M+ nodes, using reified statements where every fact becomes a first-class node with `validAt` and `invalidAt` timestamps, enabling temporal reasoning and contradiction detection.

The graph approach excels at multi-hop provenance queries that would be awkward in flat metadata: "Which embedding model version was used for chunks retrieved in this response?" or "Show me all chunks derived from documents authored by person X that were modified in the last 30 days." The [SAT-Graph RAG system](https://www.arxiv.org/pdf/2505.00039v5) for legal norms demonstrates this by distinguishing abstract legal "Works" from their versioned, time-stamped "Expressions" and reifying legislative events as first-class graph nodes, enabling point-in-time retrieval with full provenance reconstruction.

## Embedding drift is the silent provenance failure

Even perfect metadata provenance fails if embeddings silently diverge from their source text's semantic meaning. [Embedding drift](https://decompressed.io/learn/embedding-drift) occurs when the same text produces structurally different vectors over time — due to model updates, partial re-embedding (mixing vectors from different model versions), or preprocessing changes. The most dangerous cause is **partial re-embedding**: updating some chunks with a new model version while leaving others embedded with the old version creates a vector space where cosine similarity no longer reflects semantic similarity. Relevant chunks that previously appeared at retrieval position 2 can drop to position 15.

Detection requires re-embedding sample documents periodically and comparing against stored vectors — a cosine distance exceeding **0.02** indicates meaningful drift. Prevention demands treating the embedding model version as provenance metadata stored with every vector. The `extraction_model_version` field in chunk metadata is not optional — it is the key that determines whether an entire index needs rebuilding. When model versions change, the correct approach is [full re-embedding into a new index](https://dev.to/dowhatmatters/embedding-drift-the-quiet-killer-of-retrieval-quality-in-rag-systems-4l5m), swapped atomically, never mixing embedding generations within the same collection.

## Practical architecture for production provenance

The convergence of these technologies suggests a three-layer provenance architecture. The **source layer** uses git as the canonical document store, with commit SHAs providing immutable version anchors and `git blame`/`git log` providing line-level attribution and change frequency signals. The **metadata layer** stores structured provenance in vector database payloads (source identity, version identity, content hash, temporal fields, processing identity) with appropriate indexes on filtered fields. The **lineage layer** uses a graph database with W3C PROV-compatible schema to represent the full processing pipeline from source document through chunking and embedding to retrieval, enabling complex provenance queries across the entire system.

Content hashing with SHA-256 ties these layers together: the `chunk_hash` in the vector database payload can be verified against the git blob hash for the source range, creating a cryptographic chain from generated answer to exact source text. When combined with bitemporal tracking (distinguishing when content became valid from when it entered the system), this architecture answers the fundamental provenance question — "what did the system know, and when did it know it?" — with precision that audit-critical applications demand.

## Bibliography

- **Datomic Overview Documentation** — https://docs.datomic.com/datomic-overview.html — Describes the datom model, append-only transaction semantics, and temporal query APIs (d/as-of, d/history).

- **Datomic Cloud Architecture** — https://docs.datomic.com/operation/architecture.html — Details the four persistent tree indexes (EAVT, AEVT, AVET, VAET), immutable segment caching, and transactor/peer separation.

- **Jepsen Analysis of Datomic Pro** — https://jepsen.io/analyses/datomic-pro-1.0.7075 — Independent consistency analysis covering Datomic's storage model, serialized transactions, and compare-and-set commit protocol.

- **Rich Hickey, "Datomic Information Model" (InfoQ)** — https://www.infoq.com/articles/Datomic-Information-Model/ — Foundational article on Datomic's design philosophy of accumulating facts rather than updating places.

- **XTDB "What is XTDB"** — https://docs.xtdb.com/intro/what-is-xtdb.html — Explains first-class bitemporality with system-time and valid-time dimensions, SQL:2011 temporal queries.

- **XTDB "Time in XTDB"** — https://docs.xtdb.com/about/time-in-xtdb.html — Details temporal query syntax, Allen interval algebra operators, and default temporal behavior.

- **XTDB Blog: "Building a Bitemporal Index"** — https://xtdb.com/blog/building-a-bitemp-index-1-taxonomy — Explains XTDB's indexing strategy for partitioning current versus historical data.

- **Martin Fowler, "Event Sourcing"** — https://martinfowler.com/eaaDev/EventSourcing.html — Canonical definition of event sourcing pattern: append-only event log, temporal query via replay, snapshot optimization.

- **Martin Fowler, "What do you mean by Event-Driven?"** — https://martinfowler.com/articles/201701-event-driven.html — Distinguishes four event-driven patterns including event sourcing; discusses replay limitations with external systems.

- **Microsoft Azure, "Event Sourcing Pattern"** — https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing — Production guidance on event sourcing tradeoffs: eventual consistency, compensating events, idempotency requirements.

- **Pat Helland, "Immutability Changes Everything" (ACM Queue)** — https://queue.acm.org/detail.cfm?id=2884038 — Foundational argument that "the truth is the log" and immutable storage simplifies distributed systems.

- **Qdrant Payload Documentation** — https://qdrant.tech/documentation/concepts/payload/ — Describes schemaless JSON payloads, supported types, and CRUD operations on point metadata.

- **Qdrant Filtering Documentation** — https://qdrant.tech/documentation/concepts/filtering/ — Details must/must_not/should filter logic, condition types, and array handling.

- **Qdrant Indexing Documentation** — https://qdrant.tech/documentation/concepts/indexing/ — Covers payload index types, HNSW filtering integration, and ACORN algorithm for moderate-selectivity filters.

- **Weaviate Search Filters Documentation** — https://docs.weaviate.io/weaviate/search/filters — Documents filter operators, boolean combinators, and built-in temporal field filtering.

- **Weaviate Indexing Guide** — https://docs.weaviate.io/weaviate/starter-guides/managing-resources/indexing — Explains inverted index configuration, roaring bitmap indexes, and range filter indexing.

- **Pinecone Metadata Documentation** — https://docs.pinecone.io/guides/data/understanding-metadata — Covers 40KB metadata limit, supported types, flat JSON constraint, and MongoDB-style query operators.

- **Pinecone Metadata Filtering** — https://docs.pinecone.io/guides/search/filter-by-metadata — Details single-stage filtering architecture and serverless index behavior with selective filters.

- **Git Blame Documentation** — https://git-scm.com/docs/git-blame — Official reference for line-level attribution, porcelain output format, -L/-C/-M flags, and --incremental streaming.

- **Git Log Documentation** — https://git-scm.com/docs/git-log — Official reference for change history, --follow, --diff-filter, -S pickaxe, -L line-range history, and custom format strings.

- **GitHub REST API Rate Limits** — https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api — Documents 5,000 requests/hour authenticated, 60 unauthenticated, secondary rate limits, and point costs.

- **GitLab Rate Limits** — https://docs.gitlab.com/security/rate_limits/ — Default 7,200 requests/hour authenticated, per-endpoint limits.

- **Git Hash Function Transition** — https://git-scm.com/docs/hash-function-transition — Documents SHA-256 transition from SHA-1 and interoperability design.

- **Git 2.51 Release (SHA-256 Default)** — https://cybersecuritynews.com/git-2-51-released/ — Reports SHA-256 becoming default for new repositories.

- **libgit2 Blame Performance Issues** — https://github.com/libgit2/libgit2/issues/3027 — Documents blame timeouts on large repos; GitLab reports "orders of magnitude" slower than CLI.

- **gitui libgit2 Benchmarks** — https://github.com/extrawurst/gitui/issues/673 — Quantifies libgit2 blame at 197s vs git CLI at 14s on Linux kernel.

- **Huwiler et al., "VersionRAG" (arXiv:2510.08109)** — https://arxiv.org/abs/2510.08109 — First framework for version-aware RAG; 90% accuracy on VersionQA benchmark vs 58% naive RAG.

- **LiveVectorLake (arXiv:2601.05270)** — https://arxiv.org/html/2601.05270 — Dual-tier temporal knowledge base with SHA-256 content-addressable chunk sync; 10-15% re-processing per update.

- **SAT-Graph RAG (arXiv:2505.00039)** — https://www.arxiv.org/pdf/2505.00039v5 — Ontology-driven Graph RAG for temporal legal documents with point-in-time retrieval.

- **W3C PROV-O Ontology** — https://www.w3.org/TR/prov-o/ — W3C Recommendation for provenance interchange: Entity/Activity/Agent model with wasGeneratedBy, wasDerivedFrom, wasRevisionOf relationships.

- **LangChain Document API Reference** — https://api.python.langchain.com/en/latest/documents/langchain_core.documents.base.Document.html — Documents the Document class with page_content, metadata dict, and optional id field.

- **LlamaIndex Document Management** — https://docs.llamaindex.ai/en/stable/module_guides/indexing/document_management/ — Describes insert/update/delete/refresh operations and ref_doc_info lineage tracking.

- **LlamaIndex Metadata Extraction** — https://docs.llamaindex.ai/en/stable/module_guides/indexing/metadata_extraction/ — Documents SummaryExtractor, KeywordExtractor, EntityExtractor, and custom extractor patterns.

- **Neo4j Provenance with PROV** — https://medium.com/neo4j/getting-started-with-provenance-and-neo4j-b50f666d8656 — Demonstrates mapping W3C PROV concepts to Neo4j property graph nodes and relationships.

- **Neo4j Temporal Versioning** — https://medium.com/neo4j/keeping-track-of-graph-changes-using-temporal-versioning-3b0f854536fa — Patterns for uni-temporal and bi-temporal versioning in Neo4j property graphs.

- **CORE Memory System (10M+ Nodes)** — https://blog.getcore.me/building-a-knowledge-graph-memory-system-with-10m-nodes-architecture-failures-and-hard-won-lessons/ — Production temporal knowledge graph with reified statements, validAt/invalidAt timestamps, and contradiction detection.