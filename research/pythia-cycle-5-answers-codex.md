## Q1 — `lcs_chunks` Complete Schema
**Decision:** The canonical `lcs_chunks` table is:
```sql
CREATE TABLE lcs_chunks (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    chunk_type TEXT NOT NULL,
    content TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    is_deleted BOOLEAN DEFAULT 0,
    deleted_at TEXT NULL,
    content_hash TEXT NOT NULL
);
```
**Rationale:** §6 already carries `start_line`, `end_line`, `deleted_at`, and `content_hash`, and §11.8 inserts against that exact column set. No later binding resolution adds or removes any `lcs_chunks` columns, so this is the final v1 durable schema.

## Q2 — `pythia_memories` Complete Schema
**Decision:** The canonical `pythia_memories` table is:
```sql
CREATE TABLE pythia_memories (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    generation_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    context_and_problem TEXT NOT NULL,
    decision_drivers TEXT NOT NULL,
    considered_options TEXT NOT NULL,
    decision_outcome TEXT NOT NULL,
    supersedes_madr TEXT,
    FOREIGN KEY (supersedes_madr) REFERENCES pythia_memories(id)
);
```
**Rationale:** §13.8 makes `seq` the SQLite sequence source, and SQLite only allows `AUTOINCREMENT` on the true `INTEGER PRIMARY KEY`. The public `id` remains the stable MADR identifier, but it is a unique text field derived from `seq` inside the same transaction.

## Q3 — Canonical Embedding Metadata Table
**Decision:** The canonical table name is `embedding_meta`, and the only valid v1 definition is:
```sql
CREATE TABLE embedding_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    normalization TEXT NOT NULL,
    indexed_at TEXT NOT NULL
);
```
**Rationale:** §6 and §13.11 both use `embedding_meta`, and no binding section ever adopts `pythia_metadata`. `pythia_metadata` is naming drift and should not appear in migrations, code, or docs.

## Q4 — `obsidian-retry-queue.json` Write Safety
**Decision:** The retry queue is written with a single-writer atomic replace flow: serialize to `<file>.tmp`, `fsync` it, then rename it over `obsidian-retry-queue.json`; if startup finds malformed JSON, the file is quarantined as `.corrupt` and a fresh empty queue is created.
**Rationale:** §15.1 deliberately keeps retry jobs out of SQLite, so file durability has to be handled at the filesystem level. Atomic rename prevents mid-write corruption, and quarantining malformed JSON avoids boot loops while preserving the bad file for manual inspection.

## Q5 — FTS Routing Ownership
**Decision:** The MCP server’s internal retrieval logic inside `lcs_investigate` owns FTS routing, and it uses single-pass sequential routing: `fts_lcs_chunks_kw` first, then `fts_lcs_chunks_sub` only for quoted queries or punctuation-heavy zero-hit fallback.
**Rationale:** §16.5 already makes the fallback transparent to the caller and does not introduce a separate public planner abstraction. Parallel dual-query wastes work and breaks the intended keyword-first precision bias.

## Q6 — `pythia_force_index` and GC
**Decision:** Yes, `pythia_force_index` runs the same post-batch GC check as every other sync batch and triggers GC immediately after completion only if the §13.1 tombstone thresholds are exceeded.
**Rationale:** §13.1 says GC runs at boot and after sync batches that cross the retention thresholds. `pythia_force_index` is a sync batch, so excluding it would contradict the binding GC policy.

## Q7 — `lcs_investigate` Zero Results
**Decision:** `lcs_investigate` returns a successful plain-text no-result response and differentiates `INDEX_EMPTY` from `NO_MATCH`, using `[METADATA: INDEX_EMPTY]` plus `[NO_RESULTS] No indexed chunks available yet.` for an empty corpus and `[METADATA: NO_MATCH]` plus `[NO_RESULTS] No matching chunks found.` when the corpus exists but nothing matched.
**Rationale:** Zero results are not an exceptional condition, so this should not be a JSON-RPC error. The distinction matters because §13.13 already established machine-readable indexing metadata, and “nothing indexed yet” is operationally different from “query missed existing data.” 

## Q8 — Concurrent `spawn_oracle` Same-Name Race
**Decision:** No explicit application lock is added; `spawn_oracle` relies on the partial unique index inside a `BEGIN IMMEDIATE` transaction, and the loser catches the uniqueness failure and then returns the existing winner’s `session_id`.
**Rationale:** The database is already the concurrency authority for active session names via `idx_pythia_sessions_active_name`. Adding a second application-level lock just duplicates that authority without improving correctness.

## Q9 — MADR Supersedes Chain
**Decision:** When `supersedes_madr` is supplied, the MCP server inserts the new MADR and updates the older MADR to `status='superseded'` in the same `BEGIN IMMEDIATE` transaction, and the caller must provide the `supersedes_madr` value explicitly rather than the server inferring it.
**Rationale:** The server should enforce chain integrity, not guess architectural intent heuristically. Doing both writes atomically guarantees there is never a window where conflicting MADRs remain simultaneously `accepted`.

## Q10 — Cross-Encoder Input Format
**Decision:** ⚠️ The reranker receives 12 `(query, passage)` pairs where `query` is the raw `lcs_investigate` query and `passage` is chunk content tokenized with `truncation='only_second'` at the model max length, so passages are effectively truncated rather than sent unbounded.
**Rationale:** §14.7 fixes both the model and the latency budget, which means reranker inputs must have deterministic upper bounds. Letting the tokenizer truncate only the passage preserves the full query while avoiding unpredictable latency from arbitrarily large chunks.

## Q11 — `pythia_transcripts` Write Timing
**Decision:** User turns are write-ahead and model turns are write-after: the `user` transcript row is inserted before the provider call begins, and the `model` row is inserted only after the provider returns.
**Rationale:** This matches event-sourcing intent and preserves the fact that a user asked something even if the provider crashes. §15.15 already tolerates turn gaps, so an interrupted turn is represented honestly instead of being silently lost.

## Q12 — `RE_EXPORTS` Edge Deletion on Soft Delete
**Decision:** `RE_EXPORTS` edges are deleted immediately inside the sync transaction when a barrel file is soft-deleted; they are not preserved until GC.
**Rationale:** §13.5 makes `RE_EXPORTS` a structural edge, and §15.17 requires structural edges to be severed at soft-delete time to prevent phantom traversal. Waiting for GC would leave the graph observably wrong for up to 30 days.

## Q13 — `oracle_decommission` Transcript Fate
**Decision:** `oracle_decommission` hard-deletes all `pythia_transcripts` rows for the session and soft-deletes the `pythia_sessions` row by setting `status='decommissioned'` and clearing any live decommission-secret fields.
**Rationale:** The tool is explicitly a secure wipe of temporary state, so transcripts cannot survive it. Keeping the session row preserves lineage and still allows name reuse because the partial unique index only covers `active` and `idle`.

## Q14 — Structural Traversal Direction
**Decision:** ⚠️ For `intent: "structural"`, traversal is bidirectional by default, walking both inbound and outbound edges up to depth 6, and v1 does not add a new public `direction` parameter.
**Rationale:** §5 and §16.8 keep the tool surface intentionally small, and exact CNI or file-path anchors already bound the search space. Returning inbound and outbound neighborhoods together is more useful than guessing one direction, and it avoids a late v1 schema change.

## Q15 — Worker Thread Message Protocol
**Decision:** The exact protocol is: Main→Worker sends `INDEX_BATCH`, `PAUSE`, `RESUME`, `DIE`, and `PING`; Worker→Main sends `ACK`, `BATCH_STARTED`, `BATCH_COMPLETE`, `FILE_FAILED`, `PAUSED`, `HEARTBEAT`, and `FATAL`.
```text
Main -> Worker
{ type: "INDEX_BATCH", batch_id: string, files: string[], reason: "boot"|"warm"|"force" }
{ type: "PAUSE", batch_id?: string }
{ type: "RESUME" }
{ type: "DIE" }
{ type: "PING" }

Worker -> Main
{ type: "ACK", ack: "INDEX_BATCH"|"PAUSE"|"RESUME"|"DIE"|"PING", batch_id?: string }
{ type: "BATCH_STARTED", batch_id: string, total_files: number }
{ type: "BATCH_COMPLETE", batch_id: string, succeeded: number, failed: number, duration_ms: number }
{ type: "FILE_FAILED", batch_id: string, file: string, error_code: string, detail: string }
{ type: "PAUSED", batch_id?: string }
{ type: "HEARTBEAT", batch_id?: string, timestamp: string, in_flight_file?: string }
{ type: "FATAL", batch_id?: string, error_code: string, detail: string }
```
**Rationale:** The supervisor in §13.4 needs explicit heartbeat and fatal-state reporting, not implicit worker death detection only. Typed messages also make pause, retry, and crash-recovery behavior testable instead of relying on ad hoc event payloads.

## Q16 — `pythia_force_index` Path Validation
**Decision:** `path` must be repository-relative and remain inside the workspace root after normalization; absolute paths, outside-root traversals, and nonexistent paths all fail immediately with `INVALID_PATH`.
**Rationale:** §14.8 defines `path` semantically as a workspace file or subtree selector, not a general filesystem pointer. Silent coercion of absolute paths or traversal outside the repo would be a security and determinism bug.

## Q17 — `last_modified` Column Rename
**Decision:** Yes, the column should be and now is canonically named `content_hash`; `last_modified` must be removed from all normative schema text.
**Rationale:** §13.19 made the stored value `algo:digest`, which is plainly a hash fingerprint rather than a timestamp. Keeping the old name would mislead both implementors and migration logic.

## Q18 — Virtual Table GC Transaction Boundary
**Decision:** Yes, `vec_lcs_chunks`, `fts_lcs_chunks_kw`, and `fts_lcs_chunks_sub` deletions occur inside the same SQLite transaction as the `lcs_chunks` hard deletes during GC.
**Rationale:** §11.8 and §13.1 both treat derived-index cleanup as part of atomic consistency maintenance, not an eventual side job. Splitting those deletes into separate transactions would reintroduce the exact drift the sync contract was created to prevent.

## Q19 — Future `lcs_global_search` Interface
**Decision:** ⚠️ The future signature is `lcs_global_search({ query: string, max_communities?: number }) -> string`, returning plain-text thematic community summaries with supporting community IDs and representative CNIs rather than raw chunk dumps.
**Rationale:** §11.7 defers the feature, but it also frames it as community-summary retrieval rather than another low-level chunk search. Keeping the output plain text preserves the D-81 response model, and `max_communities` prevents the future tool from becoming another unbounded context firehose.

## Q20 — Final v1 MCP Tool Count
**Decision:** The final v1 MCP tool count is **6**: `lcs_investigate`, `pythia_force_index`, `spawn_oracle`, `ask_oracle`, `oracle_commit_decision`, and `oracle_decommission`.
**Rationale:** §5 lists six tools, §14.6 removes `lcs_global_search`, and §15-R.1 rejects `oracle_reconstitute`. The “Seven MCP Tools” wording in §15-R.1 is a typo; the binding manifest is the six-tool list in §5.
