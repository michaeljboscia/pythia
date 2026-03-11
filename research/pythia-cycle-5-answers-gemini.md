# Noosphere Design Spec Interrogation — Cycle 5 Answers

## Q1 — `lcs_chunks` schema with line numbers
**Decision:** The canonical schema incorporates all soft-delete and AST bounds changes into a single definition:
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
**Rationale:** This unifies the Cycle 2 CDC hash rename (`content_hash`), the Cycle 2 GC policy (`is_deleted`, `deleted_at`), and the Cycle 4 AST line numbers (`start_line`, `end_line`) into the final durable schema.

## Q2 — `pythia_memories` complete schema
**Decision:** The `seq` column becomes the actual `PRIMARY KEY`, while the formatted `id` string becomes a `UNIQUE` constraint:
```sql
CREATE TABLE pythia_memories (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    generation_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    context_and_problem TEXT NOT NULL,
    decision_drivers TEXT NOT NULL,
    considered_options TEXT NOT NULL,
    decision_outcome TEXT NOT NULL,
    supersedes_madr TEXT,
    FOREIGN KEY(supersedes_madr) REFERENCES pythia_memories(id)
);
```
**Rationale:** SQLite only permits `AUTOINCREMENT` on an `INTEGER PRIMARY KEY`. To support atomic string ID generation (e.g. `MADR-012`), the sequence column must be the true primary key, while `id` is enforced as unique.

## Q3 — `embedding_meta` table vs `pythia_metadata` naming conflict
**Decision:** `embedding_meta` is the canonical and exclusive name for this table.
**Rationale:** `embedding_meta` is explicitly defined in the §6 schema block and aligns perfectly with its single purpose of fingerprinting the vector model. Introducing `pythia_metadata` retroactively would create unnecessary schema ambiguity.

## Q4 — `obsidian-retry-queue.json` race condition
**Decision:** Writes to the queue use an atomic rename strategy (write to `.tmp` file, then `fs.renameSync`); on startup, if the file contains malformed JSON, it is renamed to `.corrupt` and a fresh empty queue is initialized.
**Rationale:** Atomic renames prevent partial writes during a power loss or crash. If an older non-atomic write left a corrupted file, clearing it prevents a permanent boot-loop while keeping the corrupted data available for manual review.

## Q5 — FTS query routing heuristic implementation
**Decision:** The `lcs_investigate` MCP tool handler owns a single-pass sequential routing logic: it queries `fts_lcs_chunks_kw` first, and if 0 hits are returned AND the query contains CNI/path punctuation (`::`, `/`, `.`), it automatically executes a second query against `fts_lcs_chunks_sub`.
**Rationale:** The application layer must handle the routing because SQLite FTS5 cannot conditionally branch virtual table targets natively. Quoted queries bypass the keyword index and route directly to the trigram index.

## Q6 — `pythia_force_index` and the GC run
**Decision:** Yes, `pythia_force_index` triggers the GC run upon completion, provided the tombstone thresholds (>10,000 rows or >20% deleted) are met.
**Rationale:** §13.1 mandates GC "after any sync batch" that exceeds the threshold. `pythia_force_index` explicitly invokes a sync batch, so it is subject to the exact same hygiene checks as the warm-start background sync.

## Q7 — `lcs_investigate` response when no results found
**Decision:** It returns a successful plain-text response containing strictly: `[NO_RESULTS] No matching chunks found.`
**Rationale:** "No results" is a semantically valid search outcome, not an error. Throwing a JSON-RPC error would force the LLM into an exception-handling loop rather than simply concluding the code doesn't exist. If the index is empty, the `index_state` metadata header will clarify that.

## Q8 — `spawn_oracle` idempotency race
**Decision:** Concurrent `spawn_oracle` calls with the same name both attempt to `INSERT` within an atomic transaction; one succeeds, and the other hits a `SQLITE_CONSTRAINT_UNIQUE` violation, which it catches, subsequently querying and returning the existing `session_id`.
**Rationale:** Relying on the SQLite partial unique index (`idx_pythia_sessions_active_name`) guarantees robust concurrency control without needing complex application-level mutexes for session creation.

## Q9 — MADR supersedes chain integrity
**Decision:** The MCP server atomically updates the older MADR's status to `superseded` in the exact same `BEGIN IMMEDIATE` transaction as the new MADR `INSERT`. The LLM caller provides the `supersedes_madr` ID in the tool input.
**Rationale:** The LLM knows which decision it is rewriting, so it must supply the superseded ID. The MCP server ensures transaction atomicity so there are never two "accepted" MADRs contradicting each other in the same chain.

## Q10 — Cross-encoder input format
**Decision:** The input pairs are formatted as `(query, passage)` where the `query` is the exact `lcs_investigate` user input string, and the `passage` is the raw, untruncated `content` field of the retrieved chunk.
**Rationale:** The ONNX cross-encoder tokenizer natively and safely truncates passages to its maximum context window (e.g., 512 tokens). Passing the full chunk allows the model to handle the truncation optimally without brittle JavaScript substring math.

## Q11 — `pythia_transcripts` write timing
**Decision:** The `user` message is written to `pythia_transcripts` immediately upon receiving `ask_oracle`, and the `model` message is written only after the provider successfully responds.
**Rationale:** This Event Sourcing approach ensures the user's query is durably recorded even if the LLM provider times out or crashes. A transcript gap (user message without a following model message) accurately reflects an interrupted turn.

## Q12 — `RE_EXPORTS` edge and the GC policy
**Decision:** `RE_EXPORTS` edges originating from or targeting a soft-deleted module are deleted **immediately** during the sync transaction, they do not wait for the 30-day GC run.
**Rationale:** §15.17 firmly establishes that structural graph edges must be severed immediately upon soft-delete to prevent graph queries from traversing phantom architecture.

## Q13 — `oracle_decommission` and transcript fate
**Decision:** The `pythia_sessions` row is retained and updated to `status='decommissioned'`, but all associated rows in `pythia_transcripts` are permanently hard-deleted.
**Rationale:** Decommissioning is a secure wipe of conversational state. Retaining the session row prevents name reuse collisions and preserves the lineage audit trail, while wiping the transcripts fulfills the tool's core privacy guarantee.

## Q14 — `lcs_investigate` `intent` parameter routing to graph
**Decision:** Structural traversal defaults to traversing **both** inbound and outbound edges up to depth 6, but the `lcs_investigate` tool schema will add an optional `direction: "inbound" | "outbound" | "both"` parameter.
**Rationale:** Understanding architecture requires knowing both dependencies ("what calls this") and dependents ("what does this call"). An optional direction flag allows the LLM to prune the tree if the bidirectional graph is too noisy. ⚠️ *Codex review note: This introduces a minor addition to the v1 tool schema, but is strictly necessary for usability.*

## Q15 — Worker Thread message protocol
**Decision:** The Main thread sends `{ type: "INDEX_BATCH", files: string[] }`, `{ type: "PAUSE" }`, and `{ type: "DIE" }`. The Worker sends `{ type: "BATCH_COMPLETE", count: number }`, `{ type: "FILE_FAILED", file: string, error: string }`, and `{ type: "HEARTBEAT" }`.
**Rationale:** A bipartite message protocol is essential for the crash supervisor to monitor the Slow Path. Regular `HEARTBEAT` messages allow the MCP server to detect and restart stalled `tsserver` processes before they trigger an OOM kill.

## Q16 — `pythia_force_index` `path` validation
**Decision:** The path is resolved relative to the workspace root; if it navigates outside the workspace (e.g., `../`), or if the path does not physically exist on disk, the tool immediately returns an `INVALID_PATH` JSON-RPC error.
**Rationale:** Strict path containment prevents directory traversal attacks where the LLM might attempt to index or leak sensitive files outside the managed repository scope.

## Q17 — `lcs_chunks.last_modified` format update
**Decision:** The column must be explicitly named `content_hash` in the finalized schema.
**Rationale:** As indicated in the §6 schema definition, the column stores a BLAKE3/SHA-256 digest (`algo:digest`), not a timestamp. `content_hash` is the accurate, non-misleading name.

## Q18 — `vec_lcs_chunks` and `fts_lcs_chunks` virtual table cleanup on GC
**Decision:** The GC cleanup executes standard `DELETE` statements against `vec_lcs_chunks` and `fts_lcs_chunks` within the exact same atomic transaction as the `lcs_chunks` hard delete.
**Rationale:** SQLite `vec0` and `FTS5` virtual tables natively support synchronized deletions. Enforcing this within the same transaction guarantees the vector and keyword indexes never drift from the base durable table.

## Q19 — `lcs_global_search` future spec
**Decision:** The future v2 signature will be `input: { query: string }` and `output: string`, where the output is a synthesized, high-level thematic markdown summary rather than a list of raw code chunks.
**Rationale:** Even though it is deferred to v2, cementing the contract now ensures that current architectural decisions—specifically context window management—are designed to support a dense summary projection later.

## Q20 — Complete tool count for v1
**Decision:** The exact final tool count for v1 is **6**. The tools are: `lcs_investigate`, `pythia_force_index`, `spawn_oracle`, `ask_oracle`, `oracle_commit_decision`, and `oracle_decommission`.
**Rationale:** §5 lists exactly these six tools. §11.7 officially removed `lcs_global_search`, and the binding resolution in §15-R.1 explicitly rejected the addition of `oracle_reconstitute`. No other tools exist in v1.
