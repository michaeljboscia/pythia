# Noosphere Requirements Interrogation: Cycle 3 Answers

## Q1 — DUPLICATE SECTION 13
**Decision:** The compact version (lines 394–474) is a hallucinated artifact from the previous generation step and MUST be deleted; the detailed dual-daemon version (13.1 - 13.20) is canonical.
**Rationale:** The detailed version contains the explicit architectural rationale and attributes decisions to specific research models (Codex/Gemini), providing the necessary historical context for future maintainers.

## Q2 — `last_modified` COLUMN NAME
**Decision:** The canonical column name in the Sprint 1 schema is `content_hash TEXT NOT NULL`.
**Rationale:** `last_modified` is semantically inaccurate as it implies an mtime timestamp. The column strictly stores the `algo:digest` string defined in Section 13.19. Section 6 must be patched to reflect this.

## Q3 — SECTION 4 STILL SAYS GIT HOOKS
**Decision:** Section 4 must be patched to remove all references to Git hooks and `git diff`.
**Rationale:** The master specification must be internally consistent. Leaving outdated architecture in the early sections creates confusion for developers implementing Sprint 1. The unified MTime/Hash File Scanner (Section 11.5) is the sole trigger.

## Q4 — `lcs_communities` IN SCHEMA DESPITE DEFERRAL
**Decision:** `lcs_communities` and `vec_communities` must be completely removed from the Section 6 canonical schema definition.
**Rationale:** Dead code and unused tables bloat the database and confuse the data model. They will be introduced via a forward-only migration when the Global Search feature is actually built in Sprint 2.

## Q5 — DUAL FTS SYNC CONTRACT GAP
**Decision:** The transaction block MUST execute two separate upserts:
```typescript
  // 4. Upsert to Keyword FTS virtual table
  db.run('INSERT OR REPLACE INTO fts_lcs_chunks_kw (id, content) VALUES (?, ?)', [id, content]);
  // 5. Upsert to Substring FTS virtual table
  db.run('INSERT OR REPLACE INTO fts_lcs_chunks_sub (id, content) VALUES (?, ?)', [id, content]);
```
**Rationale:** Both tables index the exact same content but apply different tokenization algorithms. They must be kept perfectly in sync within the atomic block.

## Q6 — `initial_context_query` IN `spawn_oracle`
**Decision:** The MCP server executes `lcs_investigate(initial_context_query, intent: "semantic")` internally, applies the RRF ranking, and injects the top-12 chunks into the `contextChunks` parameter of the ReasoningProvider's `spawn()` call.
**Rationale:** This fulfills the 180,000 character context cap constraint (Section 12.3) while ensuring the newly spawned daemon boots with immediate, highly relevant context without requiring an explicit second turn from Claude.

## Q7 — MADR RECONSTITUTION SIZE LIMIT
**Decision:** MADR stringification enforces a hard truncation limit of 100,000 characters (leaving 80K for the `initial_context_query`). If exceeded, it drops the oldest MADRs (by `timestamp` ASC) first.
**Rationale:** The system instruction cannot exceed the `spawn()` cap. Recent architectural decisions are statistically more likely to be relevant to current tasks than decisions made months ago. 

## Q8 — CROSS-ENCODER MODEL IDENTITY
**Decision:** The exact model is `mixedbread-ai/mxbai-rerank-xsmall-v1`, downloaded lazily via `@xenova/transformers`. If it fails to load, `lcs_investigate` returns a warning in its metadata header and falls back to pure RRF scoring.
**Rationale:** `mxbai-rerank-xsmall-v1` is optimized for code and runs locally via ONNX. A fallback ensures the system degrades gracefully rather than hard-crashing if the user lacks internet access on first boot.

## Q9 — `lcs_investigate` STRUCTURAL QUERY INPUT
**Decision:** For `intent: "structural"`, the `query` field must be a precise string matching a Canonical Node Identity (CNI) or an exact file path.
**Rationale:** Structural graph traversal (Recursive CTEs) requires a deterministic starting node. Natural language cannot be used to seed a graph walk. Claude Code is expected to use semantic search first to find the CNI, then execute a structural search to walk its edges.

## Q10 — IMPLEMENTS EDGE INSERTION ORDER
**Decision:** MADR insertion and `IMPLEMENTS` edge insertions occur within a single `BEGIN IMMEDIATE` transaction, with the MADR inserted first to secure the generated ID for the foreign key constraint.
**Rationale:** This guarantees absolute atomicity. If a specified `impacts_files` CNI does not exist in `lcs_chunks`, the SQLite `BEFORE INSERT` trigger on `graph_edges` will throw, and the entire transaction—including the MADR creation—will safely roll back.

## Q11 — ERROR CODE TAXONOMY AND TRANSPORT
**Decision:** Errors are returned as standard MCP JSON-RPC successful tool responses (`isError: true`), with the payload containing a structured string: `[ERROR_CODE] Human readable message`.
**Rationale:** This is the standard pattern defined by the Model Context Protocol for tool execution failures. Returning protocol-level `-32000` errors risks Claude Code interpreting it as a server crash rather than a controllable application state.

## Q12 — MIGRATION FILE LOCATION AND RUNNER
**Decision:** Migration files (`.sql`) are bundled in the npm package under `src/migrations/`. They are executed automatically by the MCP server process on connection open.
**Rationale:** This ensures the database schema is always exactly aligned with the running code version. Requiring the user to manually run `pythia migrate` after an `npm update` breaks the frictionless UX constraint.

## Q13 — `generation_id` SEMANTICS IN NOOSPHERE
**Decision:** `generation_id` increments dynamically whenever `spawn_oracle` is called. It serves purely as a monotonically increasing session epoch counter.
**Rationale:** In Noosphere, there is no explicit `reconstitute` operation because memory is structurally persisted to SQLite in real-time via `oracle_commit_decision`. The `generation_id` on a MADR simply tracks which session epoch birthed the decision.

## Q14 — `lcs_global_search` TOOL DISPOSITION
**Decision:** `lcs_global_search` must be completely removed from the v1 MCP tool manifest.
**Rationale:** Advertising a deferred tool wastes tokens. The LLM will waste turns trying to invoke it, only to receive `NOT_IMPLEMENTED`. The tool surface should exactly match the actual capabilities.

## Q15 — WAL MODE SETUP
**Decision:** Both Thread 0 (MCP Event Loop) and Thread 1 (Worker) must explicitly execute `PRAGMA journal_mode=WAL;` and `PRAGMA synchronous=NORMAL;` immediately after opening their SQLite connections.
**Rationale:** WAL mode is persistent on the database file, but setting it ensures it is active. More importantly, WAL mode is the only way SQLite allows concurrent readers (Thread 0) while a writer (Thread 1) holds an active transaction.

## Q16 — `pythia init` vs `pythia start` DISTINCTION
**Decision:** `pythia start` (or the MCP process booting) automatically handles schema creation, migrations, and warm-start indexing. `pythia init` simply creates an empty `.pythia/config.json` template if one does not exist.
**Rationale:** Consolidating DB operations into the main server boot sequence removes a mandatory CLI step for the user, aligning with the "works out of the box" constraint.

## Q17 — FTS DUAL-INDEX QUERY ROUTING HEURISTIC
**Decision:** The MCP server routes to the Trigram index *only* if the query string is enclosed in literal double quotes (e.g., `"login handler"`). All other queries route to the Unicode61 keyword index.
**Rationale:** This gives Claude Code explicit, deterministic control over the tokenization strategy without requiring a complex, brittle regex heuristic in the backend.

## Q18 — `deleted_at` COLUMN IN BASE SCHEMA
**Decision:** Section 6 must be updated to include `deleted_at TEXT NULL` in the canonical `CREATE TABLE lcs_chunks` definition.
**Rationale:** The master schema in Section 6 should represent the final desired state of the v1 database. Patching it later in Section 13 implies a migration that shouldn't exist for fresh installs.

## Q19 — OBSIDIAN WRITE PATH CONTRADICTION
**Decision:** The correct path is `<repo>/Pythia-Memories/`. Section 8 must be updated to remove the `.obsidian/` prefix.
**Rationale:** `.obsidian` is reserved for application configuration (themes, plugins). User markdown content belongs in standard visible directories within the vault.

## Q20 — `pythia_sessions` BASE SCHEMA MISSING `name` COLUMN
**Decision:** Section 11.3 must be updated to include `session_name TEXT UNIQUE NOT NULL` in its canonical definition.
**Rationale:** Similar to Q18, the initial schema definition should be complete and correct for v1, avoiding the confusion of defining a schema only to `ALTER` it two sections later.