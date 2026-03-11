## Q1
**Decision:** Yes. Delete the stale single `fts_lcs_chunks` definition from §6 and replace it with the canonical dual-table definitions: `fts_lcs_chunks_kw` and `fts_lcs_chunks_sub`.

**Rationale:** §13.2 established the dual-index design, §14.2 defined its sync contract, and §17.18 reaffirmed both table names as canonical. Leaving the single trigram table in §6 makes the primary schema section wrong.

## Q2
**Decision:** §13.8 is canonical. §11.4 should be updated to use `INTEGER PRIMARY KEY AUTOINCREMENT` plus `last_insert_rowid()` and should stop mentioning `COUNT(*) + 1`.

**Rationale:** `COUNT(*) + 1` is race-prone and was explicitly replaced by the atomic sequence design later codified in §17.2. The canonical schema must follow the race-free path.

## Q3
**Decision:** `pythia init` does not start the MCP server process; `pythia start` does. The "MCP Server is available immediately" line in §9 is stale and should be rewritten or removed.

**Rationale:** §16.4 explicitly assigns cold-start DB/bootstrap/index work to `pythia init` and server launch to `pythia start`. Queries cannot run immediately after `init` alone; they run once the server is started, with tools available before indexing finishes.

## Q4
**Decision:** No successful live `active` or `idle` session should ever have `NULL` in `decommission_hash` or `decommission_salt`. `NULL` is only legitimate for legacy/failed rows before a successful spawn commit, and for `decommissioned` rows after those fields are cleared.

**Rationale:** §13.9 says `spawn_oracle` always generates and stores the secret at spawn time, while §17.13 says decommission later clears those fields. So the current nullable schema is defensible, but not because healthy live rows are expected to be null.

## Q5
**Decision:** In the binding spec, `ON DELETE CASCADE` is effectively a safety net, not an actively used code path. There is no normative flow that hard-deletes a `pythia_sessions` row.

**Rationale:** §17.13 explicitly retains the session row and manually hard-deletes transcript rows during decommission. The cascade is harmless to keep, but current behavior does not rely on it.

## Q6
**Decision:** A session becomes `dead` when its live provider state is lost unexpectedly and the session can no longer be resumed safely, for example after daemon/process loss or an unrecoverable provider failure. `dead` is accidental termination; `decommissioned` is an intentional secure teardown.

**Rationale:** The spec defines explicit teardown semantics only for decommission, and §14.17/§16.7 treat provider-state loss as the trigger for a new generation later. That implies `dead` is the preserved lineage marker for abnormal loss, while `decommissioned` is the deliberate wipe state.

## Q7
**Decision:** This is acceptable. Cross-algorithm hash mismatches should force a re-index rather than trying to prove equivalence across BLAKE3 and SHA-256.

**Rationale:** §13.19 explicitly stores `algo:digest` so mixed algorithms never compare equal. That intentionally trades an occasional false-positive reindex for simple, correct CDC behavior.

## Q8
**Decision:** `lcs_investigate` must surface a machine-readable warning when it is serving FTS-only results because embeddings are stale; it should not degrade silently.

**Rationale:** §13.11 says the system serves FTS-only during re-embed, §13.13 standardized metadata headers for degraded index states, and §15.4 already uses metadata warnings for reranker degradation. Silent fallback would hide a material retrieval-quality loss from the caller.

## Q9
**Decision:** Use both, with the SQLite `BEFORE INSERT` trigger as the source of truth and application checks as an optimization. The trigger should abort when either `NEW.source_id` or `NEW.target_id` exists in neither `lcs_chunks` nor `pythia_memories`.

**Rationale:** §13.16 made the trigger canonical, and §14.10 explicitly frames application-side filtering as a performance precheck rather than the authority. In SQLite that means `NOT EXISTS` against both tables for source and target, followed by `RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT')`.

## Q10
**Decision:** It coalesces; it does not preempt. If `/src/auth.ts` is already in flight, the force-index request merges into the active job and that file must still receive unconditional refresh semantics within that merged run or an immediate replay right after it.

**Rationale:** §13.12 makes coalescing the concurrency rule, while §14.8 makes single-file `force_index` an unconditional override. The only consistent implementation is merged execution without duplicate concurrent work.

## Q11
**Decision:** `DIE` is for MCP server shutdown or supervisor teardown, not for the inactivity reaper. The worker should finish the current file/transaction boundary, acknowledge `DIE`, and then exit cleanly.

**Rationale:** The inactivity reaper applies to oracle sessions, not the shared indexing worker. Abruptly killing the worker mid-file would violate the spec's atomic sync model and risk partial derived-index corruption.

## Q12
**Decision:** `spawn_oracle` should return a JSON string envelope of the form `{"session_id":"...","status":"active|idle","created":true|false,"generation_id":N,"decommission_secret":"..."?}`. `decommission_secret` is present only when a new session is actually created.

**Rationale:** §15.16 requires a JSON-string response for structured control tools, §13.9 requires returning the secret once in the spawn response, and §15-R.1/§17.8 mean the caller also needs to know whether it attached to an existing session or created a new generation.

## Q13
**Decision:** Use lowercase hex for the 128-bit secret. The verification phrase should therefore be exactly `DECOMMISSION <session_id> <32-char-hex-secret>`.

**Rationale:** Hex is unambiguous, shell-safe, and easy for both humans and LLMs to copy without escaping issues. With a 36-character UUID session ID, the full phrase is 82 characters long.

## Q14
**Decision:** Keep `nomic-embed-text-v1.5`; the spec does not need a different default embedding model for the 256d path. The 256d output should be treated as Matryoshka-style truncation of the model's native vector.

**Rationale:** The spec repeatedly binds the default stack to 256d local vectors in §§4, 7, and 17, so the only coherent reading is that truncation is intended and valid. Changing models would ripple through multiple already-settled design decisions.

## Q15
**Decision:** Yes, those declarations should be indexed as chunks. Use `chunk_type` values `interface`, `type`, `enum`, and `namespace`, with CNIs `<path>::interface::<name>`, `<path>::type::<name>`, `<path>::enum::<name>`, and `<path>::namespace::<name>`.

**Rationale:** `interface` is already canonical in the schema, and omitting the other top-level TypeScript declaration forms would leave a structural blind spot in the index. Extending the same CNI grammar is the cleanest way to keep the taxonomy consistent.

## Q16
**Decision:** They get separate MCP server processes per Claude Code window/repository, even if both point at the same server binary. Per-repo isolation is enforced by process-local workspace root, process-local worker state, and each repo's own `.pythia/lcs.db`.

**Rationale:** The binary is shared, but the live server instance is not. A single shared in-memory server across unrelated repo windows would break the spec's one-active-session-per-repository model.

## Q17
**Decision:** Make the mtime cache SQLite-backed, not in-memory. Store it in a dedicated per-file table such as `file_scan_cache(file_path TEXT PRIMARY KEY, mtime_ns INTEGER NOT NULL, size_bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, last_scanned_at TEXT NOT NULL)`.

**Rationale:** An in-memory cache is lost on restart and defeats warm-start efficiency for large repos. A dedicated per-file table is cleaner than stuffing file-level mtime state into multi-row `lcs_chunks`.

## Q18
**Decision:** The MCP server tracks and enforces remaining context budget per turn. The `ReasoningProvider` receives already-trimmed `additionalContext`, not raw responsibility for budget management.

**Rationale:** §13.3 explicitly says the MCP server trims chunks by rank and returns `CONTEXT_BUDGET_EXCEEDED` if prompt plus transcript plus context still exceeds the session budget. That makes budget ownership server-side, even if provider-specific limits inform the calculation.

## Q19
**Decision:** "Connection open" means per MCP client attach, not just once per server process start. If a client disconnects and reconnects to a still-running server, the migration check runs again and should normally no-op.

**Rationale:** §16.6 lists `pythia start` and "MCP server connection open" as separate lifecycle hooks, so they cannot mean the same thing. The extra attach-time check is an upgrade safety net, not a second migration system.

## Q20
**Decision:** In Sprint 2, `lcs_investigate` is a minimal AST-bounded retrieval slice, not the full production hybrid pipeline. It should prove that Tree-sitter chunking works by returning correct AST-derived chunks using the simple retrieval substrate already built in Sprint 1.

**Rationale:** The full hybrid design is only specified later in §§13-17, so Sprint 2 cannot reasonably require vector plus FTS plus RRF plus cross-encoder parity. The Sprint 2 proof is about chunk correctness, not final-ranking sophistication.
