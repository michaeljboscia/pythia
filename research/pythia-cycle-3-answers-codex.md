## Q1 — DUPLICATE SECTION 13
**DECISION:** The detailed dual-daemon decision block is canonical, and the redundant duplicate should be deleted. In the current file, the actionable duplication is actually the Cycle 3 block under Section 14, which appears twice; the spec should end up with one authoritative Cycle 2 section and one authoritative Cycle 3 section.

**RATIONALE:** Normative architecture decisions cannot exist in duplicate. The detailed block includes the adopted decision plus provenance and rationale, which is what engineering needs. ⚠️ DISAGREE with Gemini on the exact diagnosis: this is not just a "compact Section 13 vs detailed Section 13" problem; the current file also duplicates the entire Section 14 block and that duplicate must be removed too.

## Q2 — `last_modified` COLUMN NAME
**DECISION:** The canonical Sprint 1 column name is `content_hash TEXT NOT NULL`, storing the `algo:digest` value.

**RATIONALE:** Section 11.5 defines the field as a hash-comparison primitive, not a timestamp, and Section 13.19 further tightens the format to `algo:digest`. `last_modified` is semantically wrong and should be patched in Section 6.

## Q3 — SECTION 4 STILL SAYS GIT HOOKS
**DECISION:** Section 4 should be patched to remove the Git-hook and `git diff` language. It is not historical context; it is stale normative text.

**RATIONALE:** Section 11.5 explicitly replaces that trigger model with the unified mtime/hash scanner. Leaving the old wording in an early architecture section creates implementation ambiguity for Sprint 1.

## Q4 — `lcs_communities` IN SCHEMA DESPITE DEFERRAL
**DECISION:** `lcs_communities` and `vec_communities` should be removed from the canonical Sprint 1 schema definition entirely, not left as live placeholders.

**RATIONALE:** Section 11.7 says they are removed from Sprint 1. If they are deferred, they do not belong in the active schema block. Future reintroduction should happen through a forward migration when `lcs_global_search` actually exists.

## Q5 — DUAL FTS SYNC CONTRACT GAP
**DECISION:** The sync transaction must write both FTS tables, and it should use explicit delete-then-insert semantics, not `INSERT OR REPLACE`.

**RATIONALE:** Section 13.2 creates two FTS tables, and Section 14.2 already resolves the contract: both `fts_lcs_chunks_kw` and `fts_lcs_chunks_sub` are updated inside the same transaction. ⚠️ DISAGREE with Gemini here: `INSERT OR REPLACE` is the wrong contract for these FTS tables.

```typescript
db.exec("BEGIN TRANSACTION");
try {
  db.run("UPDATE lcs_chunks SET is_deleted = 1, deleted_at = ? WHERE file_path = ?", [now, file]);

  for (const staleId of staleChunkIds) {
    db.run("DELETE FROM vec_lcs_chunks WHERE id = ?", [staleId]);
    db.run("DELETE FROM fts_lcs_chunks_kw WHERE id = ?", [staleId]);
    db.run("DELETE FROM fts_lcs_chunks_sub WHERE id = ?", [staleId]);
  }

  for (const chunk of newChunks) {
    db.run("INSERT INTO lcs_chunks (id, file_path, chunk_type, content, is_deleted, deleted_at, content_hash) VALUES (?, ?, ?, ?, 0, NULL, ?)", [chunk.id, chunk.filePath, chunk.type, chunk.content, chunk.contentHash]);
    db.run("INSERT INTO vec_lcs_chunks (id, embedding) VALUES (?, ?)", [chunk.id, chunk.embedding]);
    db.run("INSERT INTO fts_lcs_chunks_kw (id, content) VALUES (?, ?)", [chunk.id, chunk.content]);
    db.run("INSERT INTO fts_lcs_chunks_sub (id, content) VALUES (?, ?)", [chunk.id, chunk.content]);
  }

  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
```

## Q6 — `initial_context_query` IN `spawn_oracle`
**DECISION:** `initial_context_query` is resolved synchronously by the MCP server through the internal retrieval pipeline equivalent to `lcs_investigate` with `intent: "semantic"`. The retrieved chunks are passed as `contextChunks` to `ReasoningProvider.spawn()`, not injected into the `systemInstruction`.

**RATIONALE:** Section 9.3 already reserves `systemInstruction` for persisted MADR memory. Retrieval results belong in `contextChunks`, which is exactly what the `spawn()` interface exposes. ⚠️ DISAGREE with Gemini on the mechanism: this should use the internal retrieval pipeline, not the public MCP tool surface, and the binding limit is a char budget, not "top 12 no matter what." Sprint 1 should reserve up to 60,000 characters for this bootstrap retrieval payload after MADR packing.

## Q7 — MADR RECONSTITUTION SIZE LIMIT
**DECISION:** Apply a deterministic bootstrap budget: pack accepted MADRs into the `systemInstruction` newest-first until a 120,000-character MADR cap is reached, then stop. Reserve the remaining bootstrap budget for `initial_context_query` context chunks and fixed preamble overhead.

**RATIONALE:** The current spec has the right idea, but no overflow policy. A binding truncation rule is required once the memory set grows. Newest-first is the right bias because accepted architectural decisions are time-sensitive and superseded thinking should already be excluded by status. ⚠️ DISAGREE with Gemini on the exact split: the system should enforce an explicit MADR budget inside the total bootstrap budget rather than a vague "drop oldest until under cap" rule with no reserved room model.

## Q8 — CROSS-ENCODER MODEL IDENTITY
**DECISION:** The cross-encoder is `cross-encoder/ms-marco-MiniLM-L-6-v2`, exported to ONNX, loaded lazily, and cached locally. If it fails to load or exceeds the latency budget, `lcs_investigate` falls back to fused RRF ordering without reranking.

**RATIONALE:** Section 14.7 already resolves this explicitly. It is local/ONNX in v1, and the failure mode is graceful degradation to RRF-only ranking. ⚠️ DISAGREE with Gemini's model choice; the spec's bound decision is `ms-marco-MiniLM-L-6-v2`, not `mixedbread-ai/mxbai-rerank-xsmall-v1`.

## Q9 — `lcs_investigate` STRUCTURAL QUERY INPUT
**DECISION:** For `intent: "structural"`, the `query` field must be an exact CNI or a repository-relative file path that the server canonicalizes to a module CNI. Natural-language structural queries are not valid starting nodes.

**RATIONALE:** Recursive graph traversal needs a deterministic anchor. The correct flow is semantic search first, structural traversal second. If the query is a file path, map it to `file::module::default`; if it is already a CNI, traverse from that node.

## Q10 — IMPLEMENTS EDGE INSERTION ORDER
**DECISION:** Yes. `oracle_commit_decision` must insert the MADR row first, derive its public ID in that same transaction, then insert `IMPLEMENTS` edges. All of it happens inside one `BEGIN IMMEDIATE` transaction.

**RATIONALE:** Section 13.8 requires same-transaction MADR ID generation, and Section 13.16 requires endpoint validation before insert. The MADR row must therefore exist before `graph_edges` inserts run, and the whole unit should roll back if any `IMPLEMENTS` target is invalid.

## Q11 — ERROR CODE TAXONOMY AND TRANSPORT
**DECISION:** True failures are returned as JSON-RPC/MCP error objects with structured `error.data.error_code`; they are not encoded as success-body strings. Non-fatal conditions such as `OBSIDIAN_DISABLED` stay in successful response metadata. The canonical registry lives in code, e.g. `src/errors.ts`.

**RATIONALE:** Section 14.20 already answers this. Machine-branchable error handling requires typed error objects, not `[ERROR_CODE] ...` strings inside normal success payloads. ⚠️ DISAGREE with Gemini here: `isError: true` plus a formatted string is not the canonical contract adopted by the spec.

## Q12 — MIGRATION FILE LOCATION AND RUNNER
**DECISION:** Forward-only SQL migrations should live in the package source tree, e.g. `src/migrations/`, and be emitted with the build artifact. A shared migrator runs on every database-open path: `pythia init`, `pythia start`, and direct MCP server boot.

**RATIONALE:** The migration set belongs to the code version, not the repository workspace. Running migrations only on "connection open" is too implicit, and running them only on `init` is too brittle for upgrades. ⚠️ DISAGREE with Gemini on the runner: startup should invoke migrations before tool service begins, not hide schema mutation behind a client attach event.

## Q13 — `generation_id` SEMANTICS IN NOOSPHERE
**DECISION:** `generation_id` increments only when a new oracle generation is created from persisted MADRs after the prior live state is gone or intentionally reconstituted. It does not increment on every `spawn_oracle` call, and an idempotent spawn that returns the existing active session does not create a new generation.

**RATIONALE:** Section 14.17 already binds this as a lineage epoch, not a session counter. Noosphere does have reconstitution semantics even without a separate public `reconstitute` tool; `spawn_oracle` performs that role when it has to instantiate a new generation from durable memory. ⚠️ DISAGREE with Gemini's "increments every spawn" answer.

## Q14 — `lcs_global_search` TOOL DISPOSITION
**DECISION:** Remove `lcs_global_search` from the v1 MCP tool surface entirely. Do not register it, and do not ship a stub.

**RATIONALE:** Section 11.7 defers the feature and Section 14.6 makes the v1 status explicit. A deferred tool should not consume tokens in discovery or generate useless "not implemented" turns.

## Q15 — WAL MODE SETUP
**DECISION:** The database runs in WAL mode. The DB initialization path is responsible for flipping the file to `PRAGMA journal_mode=WAL`, and every SQLite connection opened by both Thread 0 and Thread 1 should run its connection init pragmas on open, including `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout`, and `foreign_keys=ON`.

**RATIONALE:** WAL is a file-level mode, so one connection can enable it, but issuing the pragma on both connections is safe and idempotent. That gives deterministic setup after first boot, file replacement, or test harness recreation while preserving the required reader/writer concurrency model.

## Q16 — `pythia init` vs `pythia start` DISTINCTION
**DECISION:** `pythia init` bootstraps the repository: create `.pythia/` if missing, create/open the database, run all pending migrations, and kick off the first full cold index. `pythia start` launches the MCP server against an existing repo, runs pending migrations if needed, and then performs warm-start background scanning if enabled.

**RATIONALE:** Section 9 already says `init` creates the database and performs cold start indexing. `start` is the runtime command, but it still has to be migration-safe for upgraded installs. ⚠️ DISAGREE with Gemini: `init` cannot be reduced to "write a config template" without contradicting the boot sequence in the spec itself.

## Q17 — FTS DUAL-INDEX QUERY ROUTING HEURISTIC
**DECISION:** No new public `mode` parameter is added in v1. The server routes to `fts_lcs_chunks_sub` when the query contains an explicit quoted substring, or when keyword FTS produces no hits for a punctuation-heavy token and trigram fallback is needed; otherwise it uses `fts_lcs_chunks_kw`.

**RATIONALE:** Section 13.2 says trigram is for "quoted or substring-oriented" queries, which implies backend routing logic, not public API expansion. Quoted-only routing is too narrow because path fragments, CNI slices, and punctuation-dense symbols can also require substring fallback. ⚠️ DISAGREE with Gemini's quoted-only rule.

## Q18 — `deleted_at` COLUMN IN BASE SCHEMA
**DECISION:** Section 6 should include `deleted_at TEXT NULL` in the base `lcs_chunks` schema from the start, and upgraded repos should receive it via a forward migration.

**RATIONALE:** The 30-day tombstone retention policy cannot be implemented correctly with `is_deleted` alone; the system needs deletion time. For fresh installs, the canonical schema should already include the field instead of forcing the reader to infer an unstated later patch.

## Q19 — OBSIDIAN WRITE PATH CONTRADICTION
**DECISION:** The write destination should be `<resolved_vault_root>/Pythia/` by default. If the repository root is the Obsidian vault root, that becomes `<repo>/Pythia/`. `.obsidian/` is only used to detect that a path is a vault; it is not the content destination.

**RATIONALE:** Section 13.10 already treats `.obsidian/` as a vault marker. Markdown user content should not be written into Obsidian's hidden config directory. ⚠️ DISAGREE with Gemini's invented `Pythia-Memories` folder name; the correct fix is to move writes out of `.obsidian/`, not invent a new folder contract absent from the spec.

## Q20 — `pythia_sessions` BASE SCHEMA MISSING `name` COLUMN
**DECISION:** Section 11.3 should be updated to show the final v1 schema directly: `name TEXT NOT NULL` belongs in the base definition, and the partial unique index from Section 13.15 remains the migration/index rule for existing databases.

**RATIONALE:** The spec should present the canonical end-state schema in its primary table definition, not a pre-patch form that is corrected later. ⚠️ DISAGREE with Gemini on the exact schema: the field name should be `name`, not `session_name`, and uniqueness belongs in the partial index, not as a blanket `UNIQUE` column constraint.
