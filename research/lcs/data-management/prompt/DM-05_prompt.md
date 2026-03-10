# Research Prompt: DM-05 Incremental Indexing Strategies

## Research Objective
Design the exact pipeline logic for incremental indexing. The objective is to determine how LCS processes a list of changed files (provided by CDC or Git Hooks), computes the delta, cleanly updates the vector (*VD-01*) and graph (*GD-01*) databases without creating orphaned nodes or duplicate vectors, and guarantees eventual consistency.

## Research Questions
1. **The Ingestion Pipeline:** Map the exact step-by-step pipeline when a file is modified. (e.g., 1. Parse AST -> 2. Generate Chunks -> 3. Hash Chunks -> 4. Embed new chunks -> 5. Delete old chunks from Vector DB -> 6. Re-map Graph edges).
2. **Chunk Hashing & Deduplication:** If a developer adds a single line to a 500-line file, how do we avoid re-embedding the entire file? Evaluate strategies for hashing individual chunks (using MD5/SHA256) and only sending unrecognized hashes to the embedding API (*EM-02*).
3. **Graph Edge Deletion (The Orphan Problem):** If `FileA` previously imported `FileB`, but the new commit removes that import, how does the ingestion pipeline know to delete the specific `IMPORTS` edge in the graph? Does it require querying the graph for the old state first, or doing a full replace of all outgoing edges from `FileA`?
4. **Vector DB Upsert Mechanics:** In databases like Qdrant or LanceDB, how do we tie vector payloads to a specific file so we can issue a `DELETE FROM vectors WHERE file_path = 'src/auth.ts'` before inserting the new chunks?
5. **Handling File Deletions:** When a `git rm` occurs, what is the cascade logic? Must we delete the graph node, all connected edges, and all associated vectors? What happens to ADRs (*KG-08*) that explicitly referenced the deleted file?
6. **Handling File Renames:** If `utils.ts` is renamed to `helpers.ts`, how do we migrate the graph node and vectors without incurring the cost of a full delete/re-embed cycle? How do we detect a rename vs a delete+create?
7. **Consistency Guarantees:** If the daemon crashes during step 4 of the ingestion pipeline, the graph might be updated but the vectors aren't. How do we implement transactional safety or a "reconciliation loop" to detect and fix desynchronized states?
8. **Concurrency Control:** If the MCP Server (*MC-05*) queries the database *while* the incremental indexer is actively deleting and upserting chunks, how do we prevent the LLM from receiving partial, broken data (*PE-02*)?
9. **Rate Limiting and Backoff:** When incrementally embedding 50 changed files via an external API (OpenAI/Voyage), how must the indexer handle 429 Rate Limit errors without failing the entire job?
10. **Background Job Persistence:** Should incremental indexing jobs be stored in a lightweight persistent queue (e.g., SQLite table, Redis, or BullMQ) to survive daemon restarts?

## Sub-Topics to Explore
- Content-Defined Chunking (CDC - storage deduplication concept, distinct from Change Data Capture).
- Blue-Green index swapping for individual files.
- Qdrant/LanceDB atomic upsert capabilities.
- Rollback mechanisms for failed ingestions.

## Starting Sources
- **Qdrant Points API:** https://qdrant.tech/documentation/concepts/points/ (for delete/upsert logic).
- **Restic / BorgBackup internals:** For understanding how content-defined chunking and hashing deduplicates data.
- **Neo4j / Kuzu Transaction docs:** How to atomically update a subgraph.
- **Node.js BullMQ or basic async queues:** https://docs.bullmq.io/

## What to Measure & Compare
- Write out the pseudo-code logic for a "File Modified" event. Compare the database operation count for (A) Querying old state, diffing, and applying targeted updates vs (B) Blanket deleting all entities associated with `file.ts` and re-inserting from scratch.
- Benchmark the time to SHA256 hash 1,000 code chunks in Node.js to prove that hash-based deduplication is faster than network API calls.

## Definition of Done
A 3000-5000 word algorithmic blueprint. The document must provide the exact logic flow (flowchart or rigorous pseudo-code) for handling Create, Update, Delete, and Rename events, explicitly defining how orphaned vectors and broken graph edges are prevented.

## Architectural Implication
Feeds **ADR-006 (Live State Ingestion)**. This is the hardest software engineering challenge of the system. Getting this wrong means the LCS databases will slowly accumulate corrupted, duplicated, or orphaned data, causing retrieval quality to permanently degrade over time.