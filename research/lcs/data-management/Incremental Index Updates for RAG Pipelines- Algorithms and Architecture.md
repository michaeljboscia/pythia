# Incremental Index Updates for RAG Pipelines: Algorithms and Architecture

**When a single file changes in a corpus of thousands, rebuilding every embedding and graph edge is wasteful — yet most RAG systems do exactly that.** The core engineering challenge is surgical: identify which chunks, vectors, and graph nodes derive from the modified file, remove them, and insert replacements without corrupting the broader index. This report examines the algorithms and database primitives that make incremental updates possible across the three layers of a modern RAG pipeline — chunking identity, deletion cascade, and vector/graph store consistency — grounding every claim in documentation, source code, and published research.

The stakes are practical. A financial-services team using the delete-and-reinsert pattern described below [cut their RAG update time from 14 hours to 8 minutes](https://particula.tech/blog/update-rag-knowledge-without-rebuilding) once they instrumented provenance metadata across their dual-store architecture. Delta indexing benchmarks show **3,500 docs/sec at 30ms latency** versus 500 docs/sec and 120ms latency for full reindexing across Elasticsearch-backed RAG systems. The gap only widens as corpus size grows.

---

## How chunk identity survives file edits

The first decision in any incremental pipeline is how to determine whether a chunk from a modified file is "the same" as one already in the index. Two paradigms compete: **position-based identity** and **content-based identity**. Each has a failure mode that can silently degrade a RAG system.

**Position-based identity** assigns chunk IDs as `{file_path}:{chunk_index}` — chunk 3 of `report.pdf` is always `report.pdf:3`. This is cheap to compute and trivial to implement. But it breaks catastrophically on insertion edits. Adding a paragraph in the middle of a document shifts every downstream chunk index, causing the system to treat unchanged text as new and triggering unnecessary re-embedding of every chunk after the edit point. File renames invalidate the entire document. There is no cross-document deduplication — identical boilerplate in two files produces two separate embedding sets.

**Content-based identity** hashes each chunk's normalized text (typically SHA-256) to produce the chunk ID. If the hash matches an existing entry, the embedding step is skipped entirely. [Microsoft's RAG enrichment architecture guide](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-enrichment-phase) recommends this approach explicitly: "An ID uniquely identifies a chunk. A unique ID is useful during processing to determine whether a chunk already exists in the store. An ID can be a hash of some key field." The critical advantage is **edit isolation** — modifying one paragraph changes only that chunk's hash; neighboring chunks with identical content retain their IDs and embeddings.

Content hashing has its own failure modes, however. Whitespace sensitivity means that reformatting a document (different line endings, an extra space after a period) produces new hashes for semantically identical content. The mitigation is text normalization before hashing: lowercase, strip whitespace, apply Unicode NFKC normalization. More fundamentally, **a content hash alone carries no provenance** — it cannot tell you which file produced the chunk. You need metadata alongside the hash to enable deletion cascades when a source file is removed entirely.

### Content-defined chunking borrows from backup deduplication

The most elegant solution to boundary stability comes from **content-defined chunking (CDC)**, an algorithm family developed for data deduplication in backup systems like restic and Borg. CDC uses a rolling hash (classically a [Rabin fingerprint](https://en.wikipedia.org/wiki/Rabin_fingerprint)) computed over a sliding window. At each byte position, the hash is checked against a mask condition (e.g., lowest N bits are zero). When the condition triggers, a chunk boundary is declared. Because **cut points depend only on the local content within the sliding window**, inserting bytes at the start of a file changes only the first chunk — all subsequent boundaries remain stable.

A [detailed demonstration using restic's chunker](https://blog.gopheracademy.com/advent-2018/split-data-with-cdc/) proved this property concretely: prepending 3 bytes ("foo") to a 100MB file changed only the first chunk; all 68 other chunks retained identical SHA-256 hashes. Modifying 6 bytes via `sed` affected a single chunk.

The [FastCDC algorithm (USENIX ATC '16)](https://www.usenix.org/system/files/conference/atc16/atc16-paper-xia.pdf) optimized this further by replacing the Rabin polynomial with a **Gear hash** — a lookup-table-based rolling hash where the update is simply `fp = (fp << 1) + Gear[byte]`. Combined with cut-point skipping (skip the minimum chunk size before checking the hash condition) and normalized chunking (two masks to regularize chunk-size distribution), FastCDC achieves **~10x throughput over Rabin-based CDC** with equivalent deduplication ratios. A production-quality Python implementation exists in the [`fastcdc` package](https://pypi.org/project/fastcdc/), maintained by the ISCC project (ISO 24138).

The tension for RAG pipelines is that **CDC boundaries are content-driven, not semantically driven**. A Gear-hash cut point might land in the middle of a sentence. The practical compromise is a hybrid: use structural/semantic chunking (split on headings, paragraphs, sentence boundaries) for semantic coherence, then apply content hashing to each semantic chunk for identity. This gives shift-resistance at the paragraph level — if structural boundaries don't move, chunk identities are stable — while maintaining the retrieval quality that semantic chunking provides.

### How the frameworks implement it

[LangChain's indexing API](https://python.langchain.com/v0.2/docs/how_to/indexing/) implements the most production-mature version of this pattern through its `RecordManager`. Each chunk is tracked with three fields: a **document hash** (SHA-1 of page_content + metadata), a **write timestamp**, and a **source ID** linking back to the origin file. On re-indexing, the hash is compared against the stored value — matched hashes are skipped, mismatches trigger deletion of the old record and insertion of the new one. The `cleanup="incremental"` mode scopes deletions to chunks sharing the same `source_id`, so processing a subset of the corpus never accidentally deletes chunks from unrelated files.

[LlamaIndex's `refresh_ref_docs()` method](https://docs.llamaindex.ai/en/stable/module_guides/indexing/document_management/) takes a similar approach. Documents carry a `doc_id` (set to the filename via `filename_as_id=True`), and a content hash stored in the docstore. On refresh, each document's hash is compared to the stored version. Changed documents trigger full delete-and-reinsert of all their nodes; unchanged documents are skipped. The method returns a boolean array indicating which documents were actually refreshed.

[LightRAG](https://github.com/HKUDS/LightRAG) uses `compute_mdhash_id(full_text, prefix="doc-")` — an MD5 hash of the entire document content — for deduplication at the document level. If a document with the same hash exists, the insert is silently skipped. Chunk-level IDs are similarly hash-based. Critically, LightRAG has **no native update primitive**; the documented pattern is `delete_by_doc_id()` followed by `ainsert()` with the new content.

---

## Deletion cascades when a source file changes

Identifying changed chunks is only half the problem. You must also find and remove every downstream artifact — embeddings in the vector store, nodes and edges in the knowledge graph — that derived from the old version. Without a systematic provenance chain, orphaned vectors accumulate silently, degrading retrieval precision with stale information the user believes was removed.

### The provenance chain requires a metadata registry

The minimum viable schema links four levels: **source file → document record → chunks → downstream artifacts**. A PostgreSQL metadata registry serves as the single source of truth:

```sql
CREATE TABLE document_registry (
  document_id  UUID PRIMARY KEY,
  file_path    TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,  -- SHA-256
  chunk_count  INTEGER,
  version      INTEGER DEFAULT 1,
  status       VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE chunk_registry (
  chunk_id       UUID PRIMARY KEY,
  document_id    UUID REFERENCES document_registry(document_id),
  chunk_index    INTEGER,
  content_hash   VARCHAR(64),
  embedding_id   VARCHAR(255),   -- point ID in vector DB
  graph_node_ids TEXT[],          -- Neo4j node element IDs
  created_at     TIMESTAMP DEFAULT NOW()
);
```

Every vector point and graph node also carries `source_document_id` as an indexed payload field or property. This denormalization enables direct deletion from each store without joining back to the registry.

### Graph cascade with DETACH DELETE

[Neo4j's `DETACH DELETE`](https://neo4j.com/docs/cypher-manual/current/clauses/delete/) is the primary cascade mechanism for graph cleanup. It removes a node and **all relationships connected to it** in a single operation — plain `DELETE` on a node with existing relationships throws a client error. For source-document cascades:

```cypher
MATCH (n) WHERE n.source_document_id = 'doc_abc123'
CALL { WITH n DETACH DELETE n } IN TRANSACTIONS OF 5000 ROWS;
```

The `CALL IN TRANSACTIONS` batching (Neo4j 4.4+) prevents transaction log overflow when deleting entities from large documents. For older versions, [APOC's `apoc.periodic.iterate`](https://neo4j.com/docs/apoc/current/graph-updates/data-deletion/) provides equivalent batched deletion.

Neo4j has **no built-in ORM-style cascade annotations** akin to JPA's `CascadeType.DELETE`. [GitHub issue #273 on neo4j-ogm](https://github.com/neo4j/neo4j-ogm/issues/273) requested this feature, but the Neo4j team's position, articulated by Michael Hunger, is that "cascading delete is tricky in a graph b/c you easily get to deleting the whole graph by just deleting one node." Application-level cascade logic via Cypher queries is the intended pattern.

### LightRAG's smart cleanup preserves shared knowledge

LightRAG's `delete_by_doc_id()` demonstrates a more nuanced cascade. Rather than blindly deleting every entity mentioned in a document, it checks whether each entity or relationship also appears in other documents. **Entities referenced by multiple source documents are preserved** — only their `source_id` metadata is updated to remove the deleted document's chunk references. Entities exclusive to the deleted document are fully removed. The system then [reconstructs affected descriptions from remaining documents](https://github.com/HKUDS/LightRAG), ensuring graph coherence after partial deletion.

This is materially different from Microsoft GraphRAG's approach. [Discussion #511 on the GraphRAG repository](https://github.com/microsoft/graphrag/discussions/511) reveals that GraphRAG has **no clean partial rebuild** — entities from a modified paragraph are woven into community structures with entities from the rest of the document, making surgical extraction impractical. The team's recommended approach is additive: new contradictory information is inserted as new nodes, and community summaries are regenerated to synthesize both old and new facts.

### The Zep/Graphiti temporal alternative

The [Zep temporal knowledge graph architecture](https://www.emergentmind.com/topics/zep-a-temporal-knowledge-graph-architecture) offers a third pattern: **soft invalidation with bitemporal modeling**. Every edge carries both an event timestamp and an ingestion timestamp. When new facts supersede old ones, edges are updated with invalidation flags and temporal bounds rather than deleted. Query-time filtering excludes stale edges. This avoids the cascade problem entirely at the cost of monotonically growing graph size, and achieved up to **18.5% enhanced accuracy on LongMemEval** by preserving historical context that hard deletion would destroy.

---

## Vector database upsert semantics differ substantially

The second store in a dual-store RAG architecture — the vector database — must support atomic replace-or-insert (upsert) operations to enable incremental updates without read-modify-write races. The four major options have meaningfully different consistency and performance characteristics.

### Qdrant: full-replace upsert with WAL durability

[Qdrant's upsert endpoint](https://api.qdrant.tech/api-reference/points/upsert-points) (`PUT /collections/{name}/points`) performs a **full replace-or-insert**: "Any point with an existing {id} will be overwritten." This is not a partial merge — you must supply the complete vector and payload. Partial updates require separate `set_payload` or `update_vectors` calls.

Qdrant writes to a **write-ahead log** before acknowledging, ensuring durability even on power loss. The `wait=true` parameter makes the call synchronous. Ordering guarantees are configurable: `weak`, `medium`, or `strong`. **All APIs are idempotent**, making retries safe. Point IDs can be 64-bit unsigned integers or UUIDs. Batch upserts accept both record-oriented and column-oriented formats with no documented size limit.

For RAG deletion cascades, Qdrant supports **filter-based deletion**:
```python
client.delete(
    collection_name="chunks",
    points_selector=models.FilterSelector(
        filter=models.Filter(must=[
            models.FieldCondition(
                key="source_document_id",
                match=models.MatchValue(value="doc_abc123")
            )
        ])
    )
)
```

### LanceDB: merge_insert with copy-on-write versioning

[LanceDB's `merge_insert`](https://lancedb.github.io/lancedb/) is the most flexible upsert primitive among the options. It splits rows into matched (key exists in both source and target), not-matched (source only), and not-matched-by-source (target only), with configurable actions for each:

```python
table.merge_insert("chunk_id") \
    .when_matched_update_all() \
    .when_not_matched_insert_all() \
    .execute(new_chunks_df)
```

LanceDB uses **copy-on-write versioning** via the Lance columnar format — each write creates a new version containing only the delta. Old versions persist for concurrent readers, with configurable cleanup (default 7-day retention). Deletions are **soft deletes**: rows are marked in deletion files and excluded from queries but not physically removed until compaction via `table.optimize()`.

A critical performance caveat: **updated rows are moved out of any existing vector index**. They remain searchable via brute-force scan, but queries slow down. After updating a large proportion of rows, an index rebuild is recommended. Additionally, `merge_insert` on unindexed tables hits a hard limit: it [cannot proceed when unindexed rows exceed 10,000](https://lancedb.github.io/lancedb/) without a scalar index on the join column.

### pgvector: ACID transactions with incremental HNSW

pgvector inherits **full PostgreSQL ACID compliance**, making it the only option with true multi-statement atomic transactions across vector and metadata operations:

```sql
BEGIN;
  DELETE FROM chunks WHERE document_id = 'doc_abc123';
  INSERT INTO chunks (chunk_id, document_id, content, embedding)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (chunk_id) DO UPDATE
    SET content = EXCLUDED.content, embedding = EXCLUDED.embedding;
COMMIT;
```

HNSW indexes in pgvector are **incrementally maintained** — they do not require rebuilding after inserts or updates. As [Jonathan Katz (pgvector contributor) confirmed](https://github.com/pgvector/pgvector/issues/855): "The HNSW algorithm is designed for adding data iteratively and does not require [indexing] an existing data set to achieve better recall." However, the performance cost is significant: community benchmarks on [GitHub issue #559](https://github.com/pgvector/pgvector/issues/559) report **5–8 seconds per insert on 1M-row tables with HNSW**, versus milliseconds without the index. Even updates to non-vector columns trigger HNSW index maintenance, with [issue #875](https://github.com/pgvector/pgvector/issues/875) showing 6 seconds for 10K row updates versus 58ms without the index. The practical workaround for bulk operations: drop the index, perform batch inserts, then recreate it.

IVFFlat indexes in pgvector present a different tradeoff. They require a training step (k-means clustering) and new inserts are assigned to existing clusters without updating centroids. Over time, recall degrades, requiring periodic `REINDEX INDEX CONCURRENTLY`.

### Chroma: brute-force buffer before HNSW integration

[Chroma's `collection.upsert()`](https://docs.trychroma.com/docs/collections/update-data) operates by string ID: existing IDs are updated, new IDs are inserted. Recently added vectors are immediately searchable via a **brute-force buffer** before being batch-integrated into the HNSW graph (configurable threshold, default 100 vectors). This means there is no HNSW rebuild delay for small incremental updates — the new vectors are simply scanned linearly alongside the indexed vectors.

Chroma supports filter-based deletion (`collection.delete(where={"source_file": "report.pdf"})`), making cascade operations straightforward. The main limitation is scale: Chroma is designed for up to tens of millions of embeddings on a single node.

---

## Keeping two stores consistent without distributed transactions

The hardest unsolved problem in dual-store RAG is ensuring that vector deletions and graph deletions either both succeed or both roll back. No cross-database ACID transaction exists between Qdrant and Neo4j. Three patterns address this with varying tradeoffs, all well-suited to Prefect orchestration.

### The saga pattern fits Prefect's task model

The [saga pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga) decomposes a distributed transaction into a sequence of local transactions, each with a compensating action on failure. For a RAG update:

```python
@flow
def update_document(doc_id: str, new_content: str):
    chunks = chunk_document(new_content)
    embeddings = generate_embeddings(chunks)
    
    # T1: Delete old vectors (compensate: restore from snapshot)
    old_vectors = snapshot_vectors(doc_id)
    delete_vectors(doc_id)
    
    try:
        # T2: Delete old graph nodes
        delete_graph_nodes(doc_id)  
    except Exception:
        restore_vectors(old_vectors)  # C1: compensate T1
        raise
    
    try:
        # T3: Insert new vectors + graph nodes
        upsert_vectors(chunks, embeddings, doc_id)
        insert_graph_nodes(chunks, doc_id)
    except Exception:
        # Compensate everything
        rollback_all(doc_id, old_vectors)
        raise
```

Prefect's built-in retry logic, state tracking, and task-level observability make it a natural saga orchestrator. Each task is idempotent; failed flows can be retried without side effects if upsert semantics are used throughout.

### The transactional outbox guarantees no lost events

The [transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) writes change events to an `outbox` table in the same PostgreSQL transaction as the metadata registry update. A Prefect worker polls the outbox and propagates changes to vector and graph stores. Because the event is committed atomically with the metadata change, **it is never lost** even if the downstream stores are temporarily unavailable. This pattern trades latency (eventual consistency) for reliability.

### Staging and swap for zero-downtime updates

The [staging pattern described by Particula](https://particula.tech/blog/update-rag-knowledge-without-rebuilding) inserts new vectors and graph nodes with a `status: 'staging'` metadata flag, invisible to production queries. Once all new artifacts are confirmed in both stores, old artifacts are deleted and the staging flag is flipped to `active`. This ensures **complete document coverage** even during the update window — at no point do queries see a partial document.

The choice between these patterns depends on consistency requirements. Financial and legal RAG systems typically need the staging pattern to avoid serving incomplete results. Internal knowledge bases can tolerate the brief inconsistency window of the saga pattern. All three are substantially better than the naive "delete everything, re-embed everything" approach.

---

## Practical architecture for a Prefect-orchestrated pipeline

Combining these findings, the recommended architecture for incremental RAG updates uses **content-hash chunk identity**, **provenance-tagged metadata**, and **saga-based dual-store updates**:

1. **Change detection**: File watcher or S3 event notification triggers a Prefect flow. SHA-256 of the file content is compared against the `document_registry` table.

2. **Semantic chunking with content hashing**: Split on structural boundaries (headings, paragraphs). Normalize each chunk's text (NFKC, strip whitespace, lowercase for hashing only). Compute `chunk_id = sha256(normalized_text)`. Compare against existing chunk hashes — **skip re-embedding for unchanged chunks**.

3. **Cascade deletion**: Query `chunk_registry` for the old document's chunks. Delete corresponding vector points by filter (`source_document_id`). Execute `DETACH DELETE` in Neo4j for graph nodes with the same provenance tag. For entities shared across documents, update `source_id` arrays rather than deleting.

4. **Upsert new artifacts**: Insert new vectors via Qdrant upsert or pgvector `INSERT ON CONFLICT`. Insert new graph nodes and edges. Update the metadata registry atomically.

5. **Validation**: Assert that `chunk_registry` row count matches vector store point count for the document. Assert that all expected graph entities exist.

One final caveat that none of the frameworks adequately document: **changing the chunking strategy, chunk size, overlap, or embedding model invalidates all existing chunk identities and requires a full re-index.** Content hashing only helps with incremental document changes, not configuration changes. Treat embedding model upgrades as schema migrations — plan for a parallel index build and atomic cutover.

---

## Conclusion

The algorithms for incremental RAG indexing are not novel — content-defined chunking dates to rsync, saga patterns to the 1987 SAGAS paper, and DETACH DELETE is basic Cypher. What is novel is their composition into a coherent pipeline that touches three heterogeneous stores. The key architectural insight is that **provenance metadata is the connective tissue**: every chunk, vector, and graph node must carry an indexed `source_document_id` that enables targeted cascade operations. Without this, incremental updates devolve into full rebuilds.

pgvector's ACID transactions offer the simplest consistency story if you can tolerate HNSW index maintenance overhead. Qdrant and LanceDB offer better vector performance but require application-level coordination via sagas or outbox patterns. For graph stores, LightRAG's smart cleanup — preserving shared entities while removing document-exclusive ones — is the most sophisticated cascade implementation available in open source, though its lack of a native update primitive and [known concurrency bugs](https://github.com/HKUDS/LightRAG/issues/1968) require careful orchestration. The gap between "works in a notebook" and "works in production with Prefect" is filled entirely by the metadata registry and the consistency patterns described here.

---

## Bibliography

1. **Qdrant Points Documentation** — https://qdrant.tech/documentation/concepts/points/ — Defines upsert semantics (full replace-or-insert), WAL durability model, point ID types (UUID/integer), and batch operation formats. Confirms all APIs are idempotent.

2. **Qdrant API Reference: Upsert Points** — https://api.qdrant.tech/api-reference/points/upsert-points — Technical specification for the `PUT /collections/{name}/points` endpoint, including `wait` and `ordering` parameters.

3. **LanceDB Update Documentation** — https://lancedb.github.io/lancedb/ — Documents `merge_insert` upsert pattern, soft-delete behavior, copy-on-write versioning, index-on-update behavior (updated rows moved out of index), and the 10,000 unindexed row limit.

4. **pgvector GitHub Repository** — https://github.com/pgvector/pgvector — README documents INSERT ON CONFLICT patterns with vector columns, HNSW/IVFFlat index characteristics, COPY bulk loading, and dimension limits.

5. **pgvector Issue #559: Insert Performance with HNSW** — https://github.com/pgvector/pgvector/issues/559 — Community benchmarks showing 5–8s per insert on 1M-row tables with HNSW index.

6. **pgvector Issue #875: Non-Vector Column Update Overhead** — https://github.com/pgvector/pgvector/issues/875 — Documents that updates to non-vector columns still trigger HNSW index maintenance (6s for 10K rows vs. 58ms without index).

7. **ChromaDB Update Documentation** — https://docs.trychroma.com/docs/collections/update-data — Documents `collection.upsert()` behavior, brute-force buffer before HNSW integration, and filter-based deletion.

8. **FastCDC: A Fast and Efficient Content-Defined Chunking Approach** — https://www.usenix.org/system/files/conference/atc16/atc16-paper-xia.pdf — USENIX ATC '16 paper introducing Gear hash, cut-point skipping, and normalized chunking. Achieves ~10x throughput over Rabin CDC.

9. **Content-Defined Chunking with restic** — https://blog.gopheracademy.com/advent-2018/split-data-with-cdc/ — Practical demonstration of CDC shift-resistance with concrete hash-stability measurements.

10. **fastcdc Python Package** — https://pypi.org/project/fastcdc/ — Production FastCDC implementation maintained by the ISCC (ISO 24138) project. ~135 MB/s throughput.

11. **LangChain Indexing API** — https://python.langchain.com/v0.2/docs/how_to/indexing/ — Documents RecordManager, hash-based change detection, and three cleanup modes (none, incremental, full).

12. **LlamaIndex Document Management** — https://docs.llamaindex.ai/en/stable/module_guides/indexing/document_management/ — Documents `refresh_ref_docs()`, `update_ref_doc()`, docstore hash comparison, and `RefDocInfo` tracking.

13. **LightRAG GitHub Repository** — https://github.com/HKUDS/LightRAG — Source code for `ainsert()`, `delete_by_doc_id()`, entity merging, and the MD5-based document deduplication system.

14. **LightRAG Paper** — https://arxiv.org/html/2410.05779v1 — Describes the incremental update algorithm: graph union of node sets V̂ ∪ V̂' and edge sets Ê ∪ Ê' with deduplication function D(·).

15. **LightRAG Issue #1968: Concurrent Insert Race Condition** — https://github.com/HKUDS/LightRAG/issues/1968 — Documents "Document content not found" errors from concurrent `ainsert` calls due to storage write races.

16. **Microsoft GraphRAG Discussion #511: Incremental Updates** — https://github.com/microsoft/graphrag/discussions/511 — Reveals that GraphRAG has no clean partial rebuild; new contradictory information is added as new nodes with community summary regeneration.

17. **Neo4j DELETE Documentation** — https://neo4j.com/docs/cypher-manual/current/clauses/delete/ — Defines DETACH DELETE behavior, CALL IN TRANSACTIONS batching for large deletions, and the constraint that plain DELETE requires zero relationships.

18. **Neo4j Large Delete Best Practices** — https://neo4j.com/developer/kb/large-delete-transaction-best-practices-in-neo4j/ — Recommends batched deletion in transactions of 10,000 rows and deleting relationships before nodes for dense graphs.

19. **Neo4j OGM Issue #273: Cascade Delete Feature Request** — https://github.com/neo4j/neo4j-ogm/issues/273 — Michael Hunger's explanation of why Neo4j avoids built-in cascade annotations.

20. **Microsoft Azure RAG Enrichment Phase** — https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-enrichment-phase — Recommends content-hash-based chunk IDs for deduplication.

21. **Particula: Update RAG Knowledge Without Rebuilding** — https://particula.tech/blog/update-rag-knowledge-without-rebuilding — Case study: 14-hour to 8-minute update times using metadata registry, SHA-256 change detection, and staging+swap pattern.

22. **Zep Temporal Knowledge Graph Architecture** — https://www.emergentmind.com/topics/zep-a-temporal-knowledge-graph-architecture — Describes bitemporal modeling for edge invalidation, achieving 18.5% accuracy improvement on LongMemEval.

23. **Incremental Updates in RAG for Dynamic Documents** — https://dasroot.net/posts/2026/01/incremental-updates-rag-dynamic-documents/ — Survey of delta indexing (3,500 docs/sec), document versioning, and LightRAG's 70% update processing time reduction.

24. **Azure Saga Pattern** — https://learn.microsoft.com/en-us/azure/architecture/patterns/saga — Defines saga orchestration with compensating transactions for distributed consistency.

25. **AWS Transactional Outbox Pattern** — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html — Documents the outbox table + CDC polling pattern for guaranteed event delivery across heterogeneous stores.

26. **Rabin Fingerprint (Wikipedia)** — https://en.wikipedia.org/wiki/Rabin_fingerprint — Defines the polynomial-over-GF(2) rolling hash used in classical CDC implementations.

27. **Gluster Deduplication: Rabin-Karp for Variable Chunking** — https://www.gluster.org/deduplication-part-1-rabin-karp-for-variable-chunking/ — Explains the data displacement problem that CDC solves.