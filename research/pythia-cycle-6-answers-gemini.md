# Noosphere Requirements Interrogation: Cycle 6 Answers

## Q1 — Single `fts_lcs_chunks` in §6 Schema
**Decision:** The single `fts_lcs_chunks` definition must be deleted from §6 and replaced with the dual-table definitions (`fts_lcs_chunks_kw` and `fts_lcs_chunks_sub`).
**Rationale:** §13.2 clearly establishes the dual FTS5 index strategy to support both exact keyword and substring matching. Section 6 serves as the canonical schema definition and must be updated to reflect the true, final state of the database.

## Q2 — Stale MADR ID Generation in §11.4
**Decision:** §13.8 is canonical; §11.4 must be updated to reflect the `seq INTEGER PRIMARY KEY AUTOINCREMENT` logic.
**Rationale:** §13.8 was explicitly adopted to solve the TOCTOU race condition inherent in `COUNT(*) + 1`. Leaving stale, race-condition-prone logic in §11.4 creates conflicting implementation instructions.

## Q3 — `pythia init` vs `pythia start` Server Launch
**Decision:** `pythia init` does NOT start the MCP server process; it only bootstraps the database and runs the first cold-start full index in the foreground.
**Rationale:** §16.4 states `pythia init` kicks off the first cold-start full index. Starting an MCP server is the job of the MCP client (Claude Code) invoking `pythia start`. The "available immediately" language in §9 is incorrect and must be removed.

## Q4 — Nullable Decommission Columns in `pythia_sessions`
**Decision:** The `decommission_hash` and `decommission_salt` columns must remain nullable to support the `decommissioned` state.
**Rationale:** §17.13 explicitly states that when a session is decommissioned, the decommission-secret fields are cleared to allow name reuse and preserve lineage without leaving orphaned security material. Therefore, the columns must be nullable.

## Q5 — `pythia_transcripts` ON DELETE CASCADE
**Decision:** `ON DELETE CASCADE` is dead code in the current design and should be removed from the schema.
**Rationale:** §17.13 establishes that session rows are retained with `status='decommissioned'`, and transcripts are explicitly hard-deleted by `oracle_decommission`. There is no defined code path that hard-deletes a session row, making the cascade unnecessary. ⚠️ (Codex may argue to keep it as a database-level safety net for manual cleanup).

## Q6 — Definition of `dead` Session Status
**Decision:** A session becomes `dead` if the MCP server restarts and finds an `active` or `idle` session, or if the ReasoningProvider encounters an unrecoverable fatal error (e.g., `AUTH_INVALID`).
**Rationale:** `decommissioned` is a deliberate user-initiated state wipe. `dead` represents an aborted or abandoned session that cannot safely be resumed because the provider's KV cache or CLI process was lost unexpectedly.

## Q7 — BLAKE3 to SHA-256 Fallback CDC Mismatch
**Decision:** Yes, the false-positive re-index caused by an algorithm fallback hash mismatch is an acceptable behavior.
**Rationale:** §13.19 mandates the `algo:digest` format precisely so the system doesn't incorrectly assume a hash match across different algorithms. A one-time re-index of the file is a perfectly acceptable trade-off compared to building complex cross-algorithm CDC tracking.

## Q8 — FTS-Only Fallback Degradation Warning
**Decision:** `lcs_investigate` must surface a warning in its metadata header: `[METADATA: VECTOR_INDEX_STALE]` when serving FTS-only results.
**Rationale:** Per §14.13, the output format supports metadata headers. The LLM caller needs to know why semantic retrieval might be performing poorly during a model migration so it can adapt its reasoning or wait.

## Q9 — `graph_edges` Trigger Validation Enforcing
**Decision:** The schema must use a `BEFORE INSERT` trigger containing `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id=NEW.source_id) AND NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id=NEW.source_id) THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT') END`.
**Rationale:** SQLite foreign keys cannot easily reference multiple possible tables conditionally (polymorphism). The trigger, as decided in §13.16, is the correct and only way to enforce database-level referential integrity across the union of `lcs_chunks` and `pythia_memories`.

## Q10 — `pythia_force_index` Overlapping Sync Behavior
**Decision:** The `force_index` request coalesces into the running sync job by upgrading the specific file's status in the active queue to `priority=manual` (forcing an unconditional re-embed), and returns `INDEX_ALREADY_RUNNING; REQUEST_MERGED`.
**Rationale:** §13.12 and §14.8 must combine. Single-writer concurrency (SQLite) means it must coalesce, but the "unconditional re-embed" semantics of the manual path must be preserved and applied to the file in the active batch. ⚠️ (Codex might argue for preempting the batch for manual requests, but coalescing is safer).

## Q11 — Worker Thread `DIE` Message Trigger
**Decision:** `DIE` is triggered strictly by MCP server graceful shutdown (e.g., SIGTERM); the Worker Thread finishes its current file, commits the active SQLite transaction, and then exits.
**Rationale:** Aborting mid-file would roll back the entire batch. Since the sync contract uses atomic transactions, letting the current file/batch finish ensures progress is saved before the process fully terminates.

## Q12 — `spawn_oracle` Output Envelope
**Decision:** `spawn_oracle` returns a structured JSON string: `{"session_id": "uuid", "decommission_secret": "secret_string", "status": "active"}`.
**Rationale:** §15.16 established that control tools must return JSON. The `decommission_secret` must be returned exactly once here, as mandated by §14.9. The original §5 definition is stale and superseded.

## Q13 — Verification Phrase Encoding and Format
**Decision:** The secret is encoded as a **hex** string (32 characters), making the full verification phrase `DECOMMISSION <uuid> <32-char-hex>`.
**Rationale:** Hex is universally supported, unambiguous, and avoids the special-character escaping issues that LLMs sometimes face with Base64 in JSON payloads.

## Q14 — `nomic-embed-text-v1.5` 256d Truncation
**Decision:** Yes, `nomic-embed-text-v1.5` explicitly supports Matryoshka Representation Learning (MRL) and can be safely truncated to 256d without changing models.
**Rationale:** This was thoroughly established in the embedding model research and is a primary reason Nomic was selected for the default $0 stack. The ONNX pipeline simply slices the first 256 floats.

## Q15 — CNI for Additional TypeScript Constructs
**Decision:** They are indexed as chunks with `chunk_type` set to `interface`, `type`, `enum`, or `namespace`, using the CNI format `<uri>::<chunk_type>::<name>`.
**Rationale:** These are critical structural components of a TypeScript codebase. Tree-sitter extracts them natively, and extending the CNI taxonomy ensures the graph accurately tracks type dependencies.

## Q16 — Per-Repo Isolation in Claude Code
**Decision:** Each Claude Code window launches a completely separate MCP server process, scoped to the specific repository's CWD.
**Rationale:** The MCP protocol operates over stdio per client connection. There is no shared daemon process across different repositories. Isolation is implicitly enforced by process boundaries and the separate `.pythia/lcs.db` files in each repo.

## Q17 — SQLite MTime Cache Implementation
**Decision:** The mtime cache is stored in SQLite by adding an `mtime INTEGER` column directly to the `lcs_chunks` table.
**Rationale:** A full BLAKE3 hash scan of a large repo on every Claude Code boot is unacceptably slow. Adding the mtime to `lcs_chunks` prevents schema bloat and keeps CDC tracking (hash + mtime) centralized, avoiding unnecessary joins.

## Q18 — Context Budget Tracking
**Decision:** The `ReasoningProvider` implementation tracks the context budget dynamically per turn, summing the tokenizer lengths (or char counts) of the transcript, preamble, and proposed chunks, trimming the injected chunks if necessary.
**Rationale:** Only the provider knows the exact size of the active session's transcript and the specific context window limit of the active LLM. The MCP server passes up to 48K chars; the provider trims if the global budget is stressed.

## Q19 — Migration "Connection Open" Semantics
**Decision:** "Connection open" means once per MCP server **process start**, executed synchronously before the MCP server begins listening for JSON-RPC messages on stdio.
**Rationale:** Since stdio MCP servers are 1:1 with the client process (Claude Code), the server process lifecycle perfectly mirrors the client attach lifecycle. Running migrations once at process boot guarantees safety without redundant checks.

## Q20 — `lcs_investigate` in Sprint 2
**Decision:** In Sprint 2, `lcs_investigate` implements **only basic vector search**, deferring the FTS, RRF, and cross-encoder steps to a later sprint.
**Rationale:** Sprints must deliver progressive vertical slices. Sprint 1 builds vectors; Sprint 2 proves Tree-sitter bounds. The hybrid FTS/RRF/Rerank pipeline is an optimization layer that should be implemented after the core vector/AST RAG flow is verified.