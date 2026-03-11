## Q1 — Soft-delete zombie accumulation
**Decision:** Soft-deleted `lcs_chunks` rows are retained for 30 days, then hard-purged by a GC job that runs at startup and after any sync batch that leaves either more than 10,000 tombstones or more than 20% tombstone ratio.
**Rationale:** `is_deleted` is a short-lived tombstone for transactional safety, not permanent history. The durable record is the transcript and MADR layer, while vectors/FTS/graph are rebuildable derived indexes. GC must also delete matching rows from `vec_lcs_chunks`, `fts_lcs_chunks`, and `graph_edges`, then run `PRAGMA incremental_vacuum`.

## Q2 — FTS5 trigram vs. keyword mismatch
**Decision:** ⚠️ Use a dual-index approach: `fts_lcs_chunks_kw` with `unicode61` and code-friendly `tokenchars`, plus `fts_lcs_chunks_sub` with `trigram`, and let `lcs_investigate` query keyword FTS first and trigram only as an explicit substring fallback.
**Rationale:** Trigram alone is wrong for code search because it over-matches identifiers and destroys exact-token precision. The keyword index handles normal `MATCH` queries and BM25 ranking, while the trigram index is only used when the query is quoted or clearly substring-oriented. `lcs_investigate` semantics are: exact/keyword query on `fts_lcs_chunks_kw`, optional substring query on `fts_lcs_chunks_sub`, then hybrid fusion with vector results.

## Q3 — The `ask()` context injection ceiling
**Decision:** `ask()` accepts at most 12 `additionalContext` chunks and 48,000 serialized characters total, and the MCP server must reject or trim anything beyond that before the provider call.
**Rationale:** Without a hard ceiling, callers can silently blow up the provider context window and turn every `ask()` into an unbounded prompt assembly problem. The server owns the budget, not the caller. If 50 chunks are supplied, only the top-ranked chunks that fit inside 48,000 characters survive; if prompt plus transcript plus context still exceed the session budget, `ask_oracle` returns `CONTEXT_BUDGET_EXCEEDED`.

## Q4 — Worker Thread crash isolation
**Decision:** The MCP server must supervise the Slow Path Worker Thread, mark indexing as degraded on crash, automatically restart it with capped exponential backoff, and trip a circuit breaker after 3 crashes in 10 minutes.
**Rationale:** A background Worker cannot be treated as fire-and-forget because unhandled exceptions, OOMs, and native crashes are normal failure modes in long-lived indexers. The MCP server stays alive, the Fast Path remains available, and `lcs_investigate` reports that structural results may be stale while the Slow Path is recovering. After the third crash, auto-restarts stop and only a manual `pythia_force_index` or process restart clears the degraded state.

## Q5 — CNI collision in monorepos
**Decision:** Re-exports do not get duplicate symbol CNIs; the defining symbol keeps the canonical CNI and the re-export site is represented as a module-level alias edge to that canonical node.
**Rationale:** Duplicating CNIs for the same logical function fractures graph traversal, ranking, and future refactors. The source of truth for `login` is the file where it is defined, not every barrel file that re-exports it. Add a `RE_EXPORTS` edge from `packages/auth/src/index.ts::module::default` to `packages/auth/src/utils.ts::function::login`.

## Q6 — Graph query depth limit
**Decision:** Structural graph traversal is capped at depth 6 and uses recursive CTE cycle detection by carrying a visited-path string and rejecting any next hop already present in that path.
**Rationale:** Depth 6 is deep enough to cross module boundaries and follow realistic call chains without turning every query into a repo-wide explosion. The recursive query must materialize `(node_id, depth, path)` and stop when `depth >= 6` or the candidate target already exists in `path`. Circular graphs are therefore finite and deterministic.

## Q7 — `pythia_transcripts` content schema
**Decision:** `content` must be JSON with role-specific schemas: `user` is `{ "text": string }`, `model` is `{ "text": string, "provider": string, "model": string, "finish_reason": string, "usage"?: { ... } }`, `system` is `{ "kind": string, "text": string, "metadata"?: object }`, and `tool` is `{ "tool_name": string, "tool_call_id": string, "input": object, "output": object|null, "status": "success"|"error", "error_code"?: string, "duration_ms": number }`.
**Rationale:** Concatenated blobs are useless for replay, auditing, and future analytics. Tool calls need input and output stored separately so the session can be reconstructed exactly and partial failures can be diagnosed. System messages are not free-form prose; they are typed events such as `spawn_preamble`, `reaper_notice`, or `context_trim_notice`.

## Q8 — MADR ID collision under concurrent writes
**Decision:** MADR IDs are generated atomically from an `INTEGER PRIMARY KEY AUTOINCREMENT` column named `seq`, and the public `id` is a stored generated column `printf('MADR-%03d', seq)` created in the same insert transaction.
**Rationale:** `COUNT(*) + 1` is a race and must die. The safe contract is a single-row insert that lets SQLite allocate `seq`, then exposes the formatted human ID with zero client-side guessing. If generated columns are unavailable in the target SQLite build, the fallback is `INSERT ...; SELECT last_insert_rowid(); UPDATE ...` inside `BEGIN IMMEDIATE`.

## Q9 — `oracle_decommission` verification phrase contract
**Decision:** ⚠️ `spawn_oracle` must generate a per-session random decommission secret, return it once as part of the spawn response, store only its hash in `pythia_sessions`, and require the caller to submit the exact phrase `DECOMMISSION <session_id> <secret>` to `oracle_decommission`.
**Rationale:** A fixed constant or deterministic phrase derived from the session ID is not verification; it is decoration. The secret is created at spawn time with 128 bits of entropy, hashed with Argon2id or scrypt in SQLite-backed session metadata, and never shown again after spawn. `oracle_decommission` compares the submitted phrase to the stored hash and hard-fails on mismatch.

## Q10 — Obsidian vault path resolution
**Decision:** The workspace root is the repository root containing `.pythia/`, `obsidian_vault_path` in `~/.pythia/config.json` may override the vault target, and if no valid vault with `.obsidian/` exists then Obsidian mirroring is disabled rather than auto-creating one.
**Rationale:** Using the transient shell `cwd` is wrong in multi-repo environments and creates nondeterministic write targets. The repo root is stable, and a configured vault path is the only legitimate override. When no vault exists, `oracle_commit_decision` still writes to SQLite and returns `OBSIDIAN_DISABLED` in its metadata instead of polluting the repo with a fake `.obsidian/` tree.

## Q11 — Embedding model version pinning
**Decision:** Embedding compatibility is pinned by a persisted fingerprint `{ provider, model_name, model_revision, dimensions, normalization }`, and any fingerprint mismatch forces a full vector re-index before mixed-version similarity search is allowed.
**Rationale:** Embeddings from different model revisions are not comparable, so partial reuse is invalid. Store the active fingerprint in a dedicated `embedding_meta` table and stamp each vector build with it. On startup, if the runtime fingerprint differs from the stored one, mark the vector index stale, serve FTS-only results until rebuild finishes, and then swap the new index into service.

## Q12 — `pythia_force_index` atomicity
**Decision:** `pythia_force_index` and background sync share a single exclusive indexing queue guarded by a process-local mutex, and overlapping requests are coalesced rather than run concurrently.
**Rationale:** Two indexers writing chunks, vectors, FTS rows, and graph edges at the same time is a corruption invitation even if SQLite serializes individual transactions. The coordinator owns all sync work. If a force-index arrives mid-sync, it is appended to the queue or merged into the live job if the path overlaps.

## Q13 — Cold start indexing progress reporting
**Decision:** `lcs_investigate` must prepend machine-readable indexing metadata on every response while cold-start sync is incomplete, and no separate `pythia_status` tool is added in v1.
**Rationale:** The caller needs the signal at the exact moment of retrieval, not by remembering to call another tool first. The response header must include at least `index_state`, `indexed_files`, `total_files`, `percent_complete`, and `last_sync_at`. Once the index reaches 100%, the header collapses to `index_state=ready`.

## Q14 — Premium stack migration path
**Decision:** ⚠️ The 256d `vec_lcs_chunks` table remains the local-only backend, Premium mode uses a separate 1024d Qdrant collection, and switching stacks triggers a full re-embed from `lcs_chunks` into the newly selected backend before that backend becomes active.
**Rationale:** There is no reason to contort SQLite into holding the Premium vectors when the Premium contract already says Qdrant owns vector storage. The migration procedure is: detect backend change, mark vector search as rebuilding, stream all live chunks through the new embedder into the new backend, atomically flip the active backend flag, and optionally drop the stale local `vec_lcs_chunks` table after success. Raw chunks remain untouched because SQLite is the source of truth.

## Q15 — `session_name` vs `session_id` duality
**Decision:** `session_name` and `session_id` are different, `pythia_sessions` must add a `name TEXT NOT NULL` column, and active-session lookups are by `name` while all foreign keys use the opaque `id`.
**Rationale:** Human-friendly names are for idempotent reuse and operator comprehension; opaque IDs are for durable identity. The current schema is missing the `name` field required by `spawn_oracle`. Add a partial unique index on `(name)` for rows whose status is `active` or `idle`.

## Q16 — Graph edge validation enforcement point
**Decision:** Validation is enforced by SQLite triggers, and any invalid `graph_edges` insert aborts the entire transaction with `INVALID_GRAPH_ENDPOINT`.
**Rationale:** This is integrity logic, so it belongs in the database, not in whichever application path happened to write the edge first. A `BEFORE INSERT` trigger must assert that both endpoints exist in either `lcs_chunks` or `pythia_memories`. Because graph writes already sit inside a sync transaction, a single bad edge rolls back the batch cleanly.

## Q17 — LSP server lifecycle
**Decision:** The Worker Thread owns one long-lived `tsserver` process per workspace, reuses it across batches, and restarts it on crash while re-queueing the interrupted files.
**Rationale:** Spawning `tsserver` per file is gratuitous latency and throws away precisely the project graph that makes LSP useful. The MCP server should not own `tsserver` directly; the Slow Path worker does, because that keeps semantic analysis isolated from the RPC event loop. If `tsserver` dies mid-batch, the worker marks the affected files dirty, restarts the server with backoff, and retries them.

## Q18 — Config schema and validation
**Decision:** `~/.pythia/config.json` must be validated at startup against a strict schema containing `workspace_path`, optional `obsidian_vault_path`, `reasoning`, `embeddings`, `vector_store`, `graph_store`, `limits`, `indexing`, and `gc`, and missing required fields are a hard startup error.
**Rationale:** The minimum concrete shape is `{ workspace_path, obsidian_vault_path?, reasoning: { mode: "cli"|"sdk", gemini_api_key? }, embeddings: { mode: "local"|"voyage", model, revision }, vector_store: { mode: "sqlite"|"qdrant" }, graph_store: { mode: "sqlite"|"falkor" }, limits: { spawn_chars_max, ask_context_chars_max }, indexing: { scan_on_start, max_worker_restarts }, gc: { deleted_chunk_retention_days } }`. Validate it with Zod or TypeBox before any provider or indexer boots. Invalid premium credentials or unsupported backend combinations fail fast with a typed config error.

## Q19 — BLAKE3 hash dependency
**Decision:** Use `hash-wasm` for BLAKE3 via WASM with no native compilation step, and permit SHA-256 fallback only if the active hash algorithm is persisted and compared explicitly.
**Rationale:** A native addon for file hashing is needless operational fragility in a local MCP tool. `hash-wasm` gives deterministic BLAKE3 without a compiler toolchain, which is the right default. If WASM initialization fails, the scanner may fall back to Node `crypto` SHA-256, but `last_modified` must become `algo:digest` so mixed algorithms never compare as equal.

## Q20 — `lcs_investigate` ranking algorithm
**Decision:** `lcs_investigate` uses weighted Reciprocal Rank Fusion over the top 30 vector hits and top 30 keyword-FTS hits, then the MCP server cross-encoder re-ranks only the top 12 fused candidates before formatting the final output.
**Rationale:** Raw cosine similarity and BM25 are not commensurate, so weighted linear blending is brittle. Use `score = wv/(60 + rank_vec) + wf/(60 + rank_fts)`, with `wv=0.7` and `wf=0.3` for `intent="semantic"` and `wv=0.3` and `wf=0.7` for `intent="structural"`. The cross-encoder is a second-stage re-ranker owned by the MCP server, not part of first-pass retrieval.
