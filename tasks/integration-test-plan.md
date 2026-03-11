# Pythia v1 — Integration Test Plan
**Generated:** 2026-03-11
**Sources:** Gemini daemon (behavioral) + Codex daemon (technical)
**Supersedes:** 2026-03-09 oracle engine integration plan (separate system)
**Coverage:** 60 scenarios across 7 behavioral dimensions + 7 technical dimensions

---

## Harness Assumptions

- New suites live under `src/__tests__/integration/*.test.ts` and `src/__tests__/performance/*.test.ts`
- **Vitest** throughout. Use `describe.sequential()` for all lock-sensitive SQLite tests.
- Use **real on-disk SQLite files** (not `:memory:`) for WAL and contention tests.
- Available test stubs/hooks to use:
  - `PYTHIA_TEST_EMBED_STUB=1` — deterministic embedding, no model download
  - `PYTHIA_TEST_RERANKER_STUB=1` — deterministic reranker logits
  - `__setRerankerTestHooks` — injectable latency controls
  - injectable `searchImpl`, `ensureSessionActiveImpl`, `writer`, `retryQueue`
- Every integration test opens a fresh DB via `openDb(tempPath)` + `runMigrations(db)`.
- Spawn real Worker Threads where timing/order matters. Use fakes only for pure supervisor logic.

---

## Recommended Rollout Order

1. **Smoke suite first** — IT-T-016 to IT-T-025 (validates basic wiring, <5s total)
2. **Concurrency** — IT-T-001 to IT-T-004 (SQLite lock behavior)
3. **Retrieval integrity** — IT-T-005 to IT-T-010 (pipeline chain)
4. **Worker failures** — IT-T-011 to IT-T-015 (crash/pause/resume)
5. **Performance floors** — IT-T-026 to IT-T-029
6. **Oracle lifecycle** — IT-T-030

---

## PART A — BEHAVIORAL TESTS (Gemini)
*Validates spec invariants, error contracts, ordering guarantees, idempotency.*

---

### A1. End-to-End Flows

#### IT-B-101: First-Time Setup & Boot
- **State:** Empty workspace, no `.pythia/` directory. Valid global config.
- **Action:** `pythia init`, then `pythia start`.
- **Assert:** `init` creates `.pythia/lcs.db`, runs migrations, cold-start index. `start` launches MCP server and warm-scan.
- **Anti-assert:** `pythia init` must NOT start the MCP server or register any tools.

#### IT-B-102: Warm Attach Progress Header
- **State:** MCP server running. `indexing.scan_on_start=true`. Warm-scan in progress.
- **Action:** Call `lcs_investigate({ query: "test", intent: "semantic" })` during scan.
- **Assert:** Response prepends `[METADATA: index_state=indexing indexed_files=... percent_complete=...]`.
- **Anti-assert:** Tool must NOT block waiting for the index to finish.

#### IT-B-103: Code Investigation (Hybrid Search)
- **State:** Index fully populated. Vector and FTS indexes current.
- **Action:** `lcs_investigate({ query: "auth token", intent: "semantic" })`.
- **Assert:** Routes to vector + `fts_lcs_chunks_kw`, fuses via RRF (wv=0.7/wf=0.3), re-ranks top 12 via cross-encoder, outputs `--- CHUNK` blocks.
- **Anti-assert:** Must NOT route to `fts_lcs_chunks_sub` unless zero kw hits AND structural syntax detected.

#### IT-B-104: Code Investigation (Graph Traversal)
- **State:** `CONTAINS`, `CALLS`, and `IMPORTS` edges populated in `graph_edges`.
- **Action:** `lcs_investigate({ query: "src/auth.ts::function::login", intent: "structural" })`.
- **Assert:** Bidirectional BFS CTE, depth ≤ 6, returns `[DEPTH:N via EDGE]` prefixed blocks, capped at 50 nodes.
- **Anti-assert:** Must NOT enter infinite loops (cycle detection path string must block revisits).

#### IT-B-105: Oracle Session Lifecycle (Spawn & Ask)
- **State:** Valid config with `GEMINI_API_KEY`. No active sessions.
- **Action:** `spawn_oracle({ session_name: "test-session" })`, then two `ask_oracle` calls.
- **Assert:** Spawn returns `created:true` + 32-hex `decommission_secret`. Ask returns responses. Transcripts saved to `pythia_transcripts`.
- **Anti-assert:** Decommission secret must NOT be stored in plaintext in the DB (only Argon2id hash).

#### IT-B-106: File Change Detection & Index Sync (CDC)
- **State:** `src/app.ts` is fully indexed.
- **Action:** Modify `src/app.ts` on disk. Trigger background sync.
- **Assert:** Detected via mtime + BLAKE3. Old chunks set `is_deleted=1` + `deleted_at`. Derived rows (vec, fts, edges) deleted. New chunks inserted. `file_scan_cache` updated.
- **Anti-assert:** Indexer must NOT use Git hooks or `lcs_chunks.content_hash` for change detection.

#### IT-B-107: Garbage Collection Purge
- **State:** 500 chunks with `is_deleted=1` and `deleted_at` 31 days ago.
- **Action:** Start MCP server (triggers boot GC).
- **Assert:** 500 chunks hard-deleted from `lcs_chunks`. `vec_lcs_chunks`, `fts_lcs_chunks_kw`, `fts_lcs_chunks_sub` rows deleted in same transaction.
- **Anti-assert:** Unexpired tombstones (10 days old) must NOT be deleted.

---

### A2. Contract Violations

#### IT-B-201: Graph Edge Integrity — DB Trigger Is The Guard
- **State:** `lcs_chunks` has CNI `A` but not `B`.
- **Action:** `INSERT INTO graph_edges (source_id, target_id, edge_type) VALUES ('A', 'B', 'CALLS')`.
- **Assert:** `trg_graph_edges_validate_before_insert` aborts with `INVALID_GRAPH_ENDPOINT`.
- **Anti-assert:** Application-layer checks are NOT the sole barrier. The trigger must catch it independently.

#### IT-B-202: Hash Algorithm Collision Prevention
- **State:** File indexed with BLAKE3. BLAKE3 then fails, system falls back to SHA-256.
- **Action:** Re-scan the same unmodified file.
- **Assert:** `blake3:abc...` !== `sha256:def...` → CDC treats file as modified, forces re-index.
- **Anti-assert:** Indexer must NOT strip the `algo:` prefix or falsely assume file is unmodified.

#### IT-B-203: FTS Routing — Quoted Query Must Use Trigram
- **State:** Populated indexes.
- **Action:** `lcs_investigate` with a double-quoted query string.
- **Assert:** FTS routes to `fts_lcs_chunks_sub` (trigram), not `fts_lcs_chunks_kw`.
- **Anti-assert:** Quoted string must NOT be run against the keyword index.

#### IT-B-204: Nested `.gitignore` Semantics
- **State:** Root `.gitignore` ignores `dist/`. `packages/ui/.gitignore` ignores `build/`.
- **Action:** Full sync.
- **Assert:** Both `dist/` and `packages/ui/build/` excluded from traversal.
- **Anti-assert:** Root-only optimization must NOT ignore nested gitignores.

---

### A3. Error Path Coverage

#### IT-B-301: AUTH_INVALID (−32010)
- **Action:** `spawn_oracle` with invalid `GEMINI_API_KEY`.
- **Assert:** Provider throws 401 → MCP returns `-32010 AUTH_INVALID`.
- **Anti-assert:** Must NOT silently fall back to CLI provider.

#### IT-B-302: CONFIG_INVALID (−32011)
- **Action:** `~/.pythia/config.json` missing `workspace_path`. Run `pythia start`.
- **Assert:** Zod validation fails. Process hard-crashes on boot.

#### IT-B-303: SESSION_ALREADY_ACTIVE (−32020)
- **State:** Session `alpha` is active.
- **Action:** `spawn_oracle` for `beta` (different name).
- **Assert:** Returns `-32020 SESSION_ALREADY_ACTIVE`. `alpha` remains operational.

#### IT-B-304: SESSION_BUSY (−32021)
- **State:** 5 `ask_oracle` requests in-flight on session `alpha`.
- **Action:** Fire 6th concurrent request.
- **Assert:** Immediate `-32021 SESSION_BUSY` for the 6th call.

#### IT-B-305: SESSION_NOT_FOUND (−32022)
- **Action:** `ask_oracle` with nonexistent UUID.
- **Assert:** Returns `-32022 SESSION_NOT_FOUND`.

#### IT-B-306: PROVIDER_UNAVAILABLE (−32040)
- **State:** Network fully disconnected.
- **Action:** `ask_oracle`.
- **Assert:** 3 retries (1s, 5s, 15s) → `-32040 PROVIDER_UNAVAILABLE`.

#### IT-B-307: CONTEXT_BUDGET_EXCEEDED (−32041)
- **State:** Session with 120k chars MADRs + 40k chars transcript.
- **Action:** `ask_oracle` that pushes total >180k chars.
- **Assert:** Chunks trimmed. If still over, returns `-32041 CONTEXT_BUDGET_EXCEEDED`.

#### IT-B-308: INVALID_GRAPH_ENDPOINT (−32060)
- **Action:** `oracle_commit_decision` with `impacts_files: ["src/does_not_exist.ts"]`.
- **Assert:** Trigger fails. Transaction rolls back. MADR NOT saved. Returns `-32060`.

#### IT-B-309/310: Circuit Breaker Trip
- **State:** Worker crashes 3× in 10 minutes.
- **Assert:** Breaker trips. `lcs_investigate` returns results with `[METADATA: SLOW_PATH_DEGRADED]`.

#### IT-B-311: INVALID_PATH (−32063)
- **Action:** `pythia_force_index({ path: "../outside_repo" })`.
- **Assert:** Immediate `-32063 INVALID_PATH`. Zero DB interaction.

---

### A4. Obsidian Writer Invariants

#### IT-B-401: SQLite Commit Precedes Obsidian Write
- **State:** Vault configured. Disk full or permissions denied on vault path.
- **Action:** `oracle_commit_decision`.
- **Assert:** SQLite COMMIT succeeds, `madr_id` generated. Obsidian write fails. Job queued in retry queue. Response contains `[METADATA: OBSIDIAN_UNAVAILABLE]`.
- **Anti-assert:** MADR row in SQLite must NOT be rolled back due to vault failure.

#### IT-B-402: Unconfigured vs Inaccessible Vault
- **State A:** `obsidian_vault_path` empty.
- **Assert A:** Returns `[METADATA: OBSIDIAN_DISABLED]`. No retry job queued.
- **State B:** Path configured but missing on disk.
- **Assert B:** Returns `[METADATA: OBSIDIAN_UNAVAILABLE]`. Job IS queued.

#### IT-B-403: Atomic Retry Queue Writes
- **Action:** Background retry loop updates the retry queue.
- **Assert:** Uses `tmp file → fsync → rename` pattern.
- **Anti-assert:** Must NOT write directly to the active `.json` file.

#### IT-B-404: Deterministic Slug Generation
- **Action:** Commit decision with title `Auth & Middleware: Super_Cool!!!`
- **Assert:** Filename is strictly `MADR-xxx-auth-middleware-super-cool.md`.

#### IT-B-405: Superseded MADR Updates
- **State:** `MADR-001` exists.
- **Action:** Commit `MADR-002` with `supersedes_madr: "MADR-001"`.
- **Assert:** `MADR-001` frontmatter updated to `status: superseded`, strikethrough blockquote prepended. `MADR-002` contains supersedes notice.

---

### A5. Oracle Session Lifecycle

#### IT-B-501: Idle Reconstitution — NO Transcript Replay
- **State:** Session `alpha` is `idle`. 5 transcript turns exist. 2 accepted MADRs.
- **Action:** `ask_oracle` for `alpha`.
- **Assert:** Provider spawned with 2 MADRs in `systemInstruction`. Transcript turns NOT fed to provider during spawn.
- **Anti-assert:** Transcripts are an offline audit log ONLY, never for LLM state recreation.

#### IT-B-502: Attach to Active Session
- **State:** Session `alpha` active.
- **Action:** `spawn_oracle({ session_name: "alpha" })`.
- **Assert:** Returns existing UUID, `created: false`. `decommission_secret` completely ABSENT from response.

#### IT-B-503: Decommission Secure Wipe
- **State:** Session `alpha` has transcripts.
- **Action:** `oracle_decommission` with valid phrase.
- **Assert:** All `pythia_transcripts` for `alpha` hard-deleted. Status → `decommissioned`. Hash/salt → NULL.
- **Anti-assert:** `pythia_memories` (MADRs) from this session must NOT be deleted.

---

### A6. Ordering Guarantees

#### IT-B-601: `seq` AUTOINCREMENT Atomicity
- **Action:** Two concurrent `oracle_commit_decision` requests.
- **Assert:** Both receive unique sequential IDs (`MADR-013`, `MADR-014`).
- **Anti-assert:** Must NOT use `SELECT COUNT(*) + 1` (race condition assigns same ID twice).

#### IT-B-602: Write-Ahead Transcript Contract
- **State:** Active session.
- **Action:** `ask_oracle`. Provider call hangs/times out.
- **Assert:** `pythia_transcripts` contains the `role: 'user'` row. No `role: 'model'` row for this turn.
- **Anti-assert:** User turn must NOT be buffered and written only on model success.

#### IT-B-603: `file_scan_cache` Transaction Boundary
- **Action:** Worker processes `src/app.ts`. Chunks inserted. `graph_edges` trigger fails → ROLLBACK.
- **Assert:** `file_scan_cache.mtime` and `content_hash` NOT updated.
- **Anti-assert:** Cache must not be committed outside the chunk transaction.

#### IT-B-604: `RE_EXPORTS` Deletion Timing
- **Action:** Barrel module `index.ts` soft-deleted by indexer.
- **Assert:** Associated `RE_EXPORTS` edges hard-deleted immediately within the sync transaction.
- **Anti-assert:** Must NOT wait for 30-day GC run (phantom graph traversal risk).

---

### A7. Idempotency Contracts

#### IT-B-701: `pythia init` Idempotency
- **State:** Valid `.pythia/lcs.db` with data.
- **Action:** `pythia init` run again.
- **Assert:** Migrations run (forward-only), data intact, exits silently.

#### IT-B-702: `oracle_commit_decision` Non-Idempotency
- **Action:** Identical payload sent twice.
- **Assert:** Two separate MADR rows with distinct IDs.
- **Anti-assert:** Must NOT attempt semantic deduplication in v1.

#### IT-B-703: Migration "Connection Open" Idempotency
- **State:** Schema at version `003`.
- **Action:** Client disconnect + reconnect.
- **Assert:** Migration runner detects current version, no-ops, no errors.

#### IT-B-704: Coalesced `pythia_force_index`
- **State:** Background warm-scan actively processing `src/app.ts`.
- **Action:** `pythia_force_index({ path: "src/app.ts" })`.
- **Assert:** Returns `[STATUS: INDEX_MERGED]`. Job tagged `priority=manual`, bypasses hash check.

---

## PART B — TECHNICAL TESTS (Codex)
*Concurrency hazards, pipeline integrity, worker failure modes, smoke tests, perf floors.*

---

### B1. Cross-Sprint Regression Matrix

| Base Sprint Subsystem | Regressed By | Specific Regression to Guard Against | Primary Test IDs |
|---|---|---|---|
| Sprint 1: DB, migrations, atomic sync | Sprint 2: Tree-sitter, dual FTS, MCP retrieval | Stale vec/FTS rows after re-index, early cache commits, `INDEX_EMPTY`/`NO_MATCH` semantics | IT-T-003, IT-T-005, IT-T-007, IT-T-010, IT-T-021, IT-T-022 |
| Sprint 2: Fast path + FTS + investigate | Sprint 3: Worker thread + slow-path edges | Worker batching causes duplicate index writes, `DIE`/`PAUSE` corrupts per-file atomicity, invalid endpoints abort whole file instead of per-edge skip | IT-T-011, IT-T-012, IT-T-013, IT-T-015, IT-T-023 |
| Sprint 3: Worker/supervisor/graph | Sprint 4: Oracle sessions, MADR writes | Main-thread oracle writes contend with worker writes, write-ahead transcript rows lost, graph + MADR edge writes deadlock or partially commit | IT-T-001, IT-T-002, IT-T-004, IT-T-009, IT-T-030 |
| Sprint 4: Oracle lifecycle + fusion | Sprint 5: GC, CLI lifecycle | Boot-time GC damages live session state, decommissioned names fail to reuse after restart, performance collapses after packaging | IT-T-018, IT-T-025, IT-T-029, IT-T-030 |

---

### B2. SQLite Concurrency Hazards

#### IT-T-001 — `BEGIN IMMEDIATE` Serializes Contending Writers
- **File:** `src/__tests__/integration/sqlite-concurrency.integration.test.ts`
- **Setup:** Two `better-sqlite3` connections to same WAL file.
- **Assert:** Writer B cannot interleave with writer A. Writer B succeeds after A commits. No torn rows in `lcs_chunks` or `file_scan_cache`.

```ts
describe.sequential("IT-T-001 BEGIN IMMEDIATE contention", () => {
  it("serializes two writers against the same sqlite file", async () => {
    // open dbA and dbB against same temp database
    // hold BEGIN IMMEDIATE on dbA
    // attempt write on dbB from a second task/thread
    // release dbA and assert dbB completes after lock release
    // assert final row set is complete and non-duplicated
  });
});
```

#### IT-T-002 — Worker Writes Do Not Starve Main-Thread Reads
- **File:** `src/__tests__/integration/sqlite-concurrency.integration.test.ts`
- **Assert:** Read queries continue during worker writes under WAL. No `SQLITE_BUSY` on read path. Row counts transition between committed snapshots only — never partial.

```ts
describe.sequential("IT-T-002 worker write vs main read", () => {
  it("keeps reads non-blocking while the worker owns write transactions", async () => {
    // seed repo files; spawn real worker + start INDEX_BATCH
    // poll from main-thread read connection during indexing
    // assert reads succeed and only observe committed file states
  });
});
```

#### IT-T-003 — `file_scan_cache` Rolls Back With File Transaction
- **File:** `src/__tests__/integration/sqlite-concurrency.integration.test.ts`
- **Assert:** After rollback: old live chunks remain, `vec_lcs_chunks`/FTS/`graph_edges` unchanged, `file_scan_cache.content_hash` stays at prior value.

```ts
describe.sequential("IT-T-003 atomic sync rollback ordering", () => {
  it("never advances file_scan_cache when file re-index fails", async () => {
    // seed one indexed file and cache row
    // inject failure after derived-table mutation begins
    // run indexFile and expect rejection
    // assert old chunk rows + cache row still describe the old file version
  });
});
```

#### IT-T-004 — Session FIFO Queue Preserves Write-Ahead Order Under Concurrency
- **File:** `src/__tests__/integration/sqlite-concurrency.integration.test.ts`
- **Assert:** First 5 concurrent `ask_oracle` calls queue. 6th fails with `SESSION_BUSY`. User transcript rows exist before provider completions. Turn indexes monotonic and gap-free.

```ts
describe.sequential("IT-T-004 ask_oracle FIFO queue", () => {
  it("enforces depth=5 and preserves write-ahead transcript ordering", async () => {
    // seed one active session
    // block provider promises to build queue pressure
    // fire 6 concurrent asks
    // assert first five enqueue, sixth rejects, user turns persisted in order
  });
});
```

---

### B3. Retrieval Pipeline Integrity

#### IT-T-005 — Full Chain: Vector → KW FTS → RRF → Reranker
- **File:** `src/__tests__/integration/retrieval-pipeline.integration.test.ts`
- **Assert:** Vector and FTS candidate sets union correctly. Fused candidates capped at 12. Reranker reorders fused results (not raw vector results). Final scores in `(0, 1)`.

```ts
describe("IT-T-005 full retrieval chain", () => {
  it("fuses vector and FTS candidates before reranking", async () => {
    // seed chunks across vec + fts
    // stub embedQuery + reranker logits
    // call search()
    // assert final order reflects RRF then reranker, not vector rank alone
  });
});
```

#### IT-T-006 — Vector Unavailable Falls Back to FTS-Only With Metadata
- **Assert:** Retrieval returns FTS hits. Output prefixed `[METADATA: VECTOR_INDEX_STALE]`. No hard failure if lexical path healthy.

#### IT-T-007 — Trigram Fallback Only on Zero KW Hits + Structural Syntax
- **Assert:** Trigram consulted ONLY for `::`, `/`, `.`, or quoted queries when kw returns zero. If kw has hits, trigram is never consulted.

```ts
describe("IT-T-007 FTS routing", () => {
  it("falls back to trigram only after zero keyword hits on structural-looking queries", async () => {
    // seed kw miss / sub hit case
    // spy on kw and sub query paths
    // assert routing behavior for semantic and structural-shaped queries
  });
});
```

#### IT-T-008 — RRF Weights Differ by Intent
- **Assert:** `semantic` ranks vector-only chunks higher. `structural` ranks FTS-only chunks higher. Denominator fixed at `60 + rank` for both.

#### IT-T-009 — Reranker Timeout Preserves Fused Order + Emits Metadata
- **Assert:** Timeout at 250ms returns pre-rerank order unchanged. `[METADATA: RERANKER_UNAVAILABLE]` appended. No candidates dropped.

```ts
describe("IT-T-009 reranker timeout", () => {
  it("returns fused order unchanged when reranking exceeds 250ms", async () => {
    // stub model promise that never resolves
    // run lcsInvestigate handler
    // assert result order matches fused order and RERANKER_UNAVAILABLE in output
  }, 1_000);
});
```

#### IT-T-010 — Dangling Derived-Index Rows Filtered Before Output
- **State:** `vec`/FTS entries exist for soft-deleted or missing `lcs_chunks` rows.
- **Assert:** Dangling IDs excluded from output. No throw on orphaned rows. `INDEX_EMPTY` vs `NO_MATCH` semantics preserved correctly.

---

### B4. Worker Thread Failure Modes

#### IT-T-011 — `DIE` Waits for Current File Transaction to Finish
- **Assert:** `ACK: DIE` arrives only after file commit. DB state is either full file results or prior state — never partial. Worker exits `0`.

```ts
describe.sequential("IT-T-011 DIE mid-file", () => {
  it("finishes the in-flight file before ACKing DIE", async () => {
    // spawn worker with slowed index path
    // send INDEX_BATCH then DIE while first file is active
    // assert ACK ordering and atomic final db state
  });
});
```

#### IT-T-012 — `PAUSE`/`RESUME` Stops Between Files, Not Inside One
- **Assert:** `PAUSED` does not interrupt current file. Second file does not start until `RESUME`. First file commits once; second commits only after resume.

#### IT-T-013 — Worker Crash Recovery: No Duplicate Durable Rows
- **Assert:** Supervisor respawns worker. Already-committed file NOT duplicated. Uncommitted file either retried from scratch or left untouched — never partial.

```ts
describe.sequential("IT-T-013 crash recovery", () => {
  it("recovers from a worker crash without duplicating or tearing indexed files", async () => {
    // inject worker exit(1) at controlled point
    // let supervisor restart
    // assert row counts and file_scan_cache reflect exactly-once durable behavior per file
  });
});
```

#### IT-T-014 — Circuit Breaker Opens at 3 Crashes, Resets After Clean Batch
- **Assert:** First 2 crashes restart. 3rd crash opens breaker. Successful batch after window prunes crash log and allows restart again.

#### IT-T-015 — Per-Edge `INVALID_GRAPH_ENDPOINT` Skipped; Unexpected DB Errors Escalate
- **Assert:** Invalid endpoints logged/skipped, batch completes. Non-trigger DB errors emit `FILE_FAILED` or `FATAL`. Successful chunks remain committed.

---

### B5. Smoke Tests (<5s total, no Gemini CLI)

| ID | Description | Key Assert |
|---|---|---|
| IT-T-016 | Config loads from minimal valid file | `loadConfig` succeeds, defaults present |
| IT-T-017 | DB opens with WAL and `sqlite-vec` | `journal_mode=wal`, `foreign_keys=1`, `vec_version()` returns |
| IT-T-018 | Migrations idempotent at startup | Two consecutive `runMigrations` calls succeed |
| IT-T-019 | Tree-sitter emits module + function chunk on TS file | Correct CNI format |
| IT-T-020 | CDC reports one changed file | One `FileChange` with `algo:digest` format |
| IT-T-021 | One-file index populates all core tables | `lcs_chunks`, `vec_lcs_chunks`, both FTS, `file_scan_cache` all have rows |
| IT-T-022 | `lcs_investigate` returns `INDEX_EMPTY` on empty corpus | Exact metadata text |
| IT-T-023 | Worker responds to `PING` | Real worker returns `ACK: PING` |
| IT-T-024 | Oracle spawns and answers with stub provider | Transcript rows written for user + model turns |
| IT-T-025 | Clean corpus does not trigger GC | `shouldRunGc()=false`, `chunksDeleted=0` |

---

### B6. Regression Test Matrix

| Subsystem | Test IDs | Sprint | Guards Against |
|---|---|---|---|
| DB pragmas / WAL / sqlite-vec | IT-T-017, IT-T-001, IT-T-002 | 1 | Lock regressions, missing vec extension, read starvation |
| Migrations / startup lifecycle | IT-T-018, IT-T-030 | 1 | Startup drift, schema mismatch after new features |
| Atomic sync contract | IT-T-003, IT-T-021 | 1 | Early cache commits, partial file re-index |
| CDC | IT-T-020, IT-T-003 | 2 | Stale mtimes, false negatives under rollback |
| Tree-sitter fast path | IT-T-019, IT-T-021 | 2 | CNI drift, missing module chunks, bad line bounds |
| Dual FTS indexes | IT-T-005, IT-T-007, IT-T-010 | 2 | Bad routing, orphan rows, search latency regressions |
| `lcs_investigate` metadata | IT-T-006, IT-T-009, IT-T-010, IT-T-022 | 2 | Wrong degraded-mode, bad empty/no-match semantics |
| Worker protocol | IT-T-011, IT-T-012, IT-T-023 | 3 | Bad DIE/PAUSE ordering, protocol regressions |
| Supervisor / circuit breaker | IT-T-013, IT-T-014 | 3 | Restart storms, dropped batches, unrecoverable loops |
| Slow path / graph edges | IT-T-015 | 3 | Whole-file abort on invalid endpoints |
| Graph traversal | IT-T-005, IT-T-015 | 3 | Stale graph refs, structural retrieval corruption |
| Retrieval fusion / reranker | IT-T-005 to IT-T-010 | 4 | Bad RRF weights, timeout regressions, broken fallbacks |
| Oracle session queue / transcripts | IT-T-004, IT-T-024, IT-T-030 | 4 | Dropped user turns, queue races, context path regressions |
| MADR commit / decommission | IT-T-030 | 4 | Partial decision commits, session-name reuse breakage |
| GC | IT-T-025, IT-T-029 | 5 | Live-row deletion, slow cleanup, boot-time regressions |

---

### B7. Performance Floor Tests

#### IT-T-026 — Warm Embed Latency < 500ms
- **File:** `src/__tests__/performance/performance-floor.test.ts`
- After `warmEmbedder()` in `beforeAll`, `embedQuery()` completes `<500ms`.

```ts
describe.sequential("IT-T-026 warm embed latency", () => {
  beforeAll(async () => { await warmEmbedder(); });
  it("keeps warm embedQuery under 500ms", async () => {
    const t0 = performance.now();
    await embedQuery("authentication middleware");
    expect(performance.now() - t0).toBeLessThan(500);
  }, 2_000);
});
```

#### IT-T-027 — Keyword FTS Query < 10ms
- **Setup:** ~5–10k live chunks in both FTS tables.
- **Assert:** kw FTS match on a common symbol path completes `<10ms`.

#### IT-T-028 — Reranker 12-Candidate Window < 250ms
- After `initReranker()` in `beforeAll`, `rerank()` over 12 passages completes `<250ms`.

```ts
describe.sequential("IT-T-028 reranker floor", () => {
  beforeAll(async () => { await initReranker(cfg.models.cache_dir); });
  it("reranks 12 candidates under 250ms", async () => {
    const t0 = performance.now();
    await rerank("auth middleware", candidates12);
    expect(performance.now() - t0).toBeLessThan(250);
  }, 2_000);
});
```

#### IT-T-029 — GC Over 10k Tombstones < 1s
- **Setup:** 10k+ tombstoned `lcs_chunks` + matching derived rows.
- **Assert:** `runGc()` completes `<1000ms`, `chunksDeleted = 10_000`.

---

### B8. Full Oracle Lifecycle

#### IT-T-030 — End-to-End Oracle Lifecycle (Stub Provider)
- **File:** `src/__tests__/integration/oracle-lifecycle.integration.test.ts`
- **Setup:** Seeded repo chunks, temp Obsidian vault path, deterministic provider stub.

```ts
describe.sequential("IT-T-030 oracle lifecycle", () => {
  it("covers spawn -> ask -> commit -> decommission -> respawn", async () => {
    // spawn_oracle → assert created:true + secret present
    // ask_oracle → assert transcripts written, context retrieved from lcs
    // oracle_commit_decision → assert MADR-001 + IMPLEMENTS edges + vault/retry side effect
    // oracle_decommission → assert transcript wipe, pythia_memories survive
    // spawn same name → assert generation_id=2, new secret issued
  }, 10_000);
});
```

---

## TOP 5 HARDEST-TO-TEST SCENARIOS

### #1 — IT-T-013: Worker Crash Recovery ⚠️ HARDEST
The failure must land precisely between `BATCH_STARTED`, per-file commit boundaries, and supervisor restart logic. Without a controlled crash injection point inside the real worker binary, the test is nondeterministic.

**Solution:** Add a `__PYTHIA_CRASH_AFTER_FILE_N` environment variable (test-only) that causes the worker to exit(1) after committing exactly N files. Supervisor's restart logic then runs against a predictable partially-committed state.

### #2 — IT-T-011: `DIE` Mid-File
Needs a reproducible in-flight window inside real Worker Thread execution. Too fast: `DIE` arrives post-commit and the test trivially passes. Too artificial: the test no longer models production.

**Solution:** A slow-path stub that holds open a transaction via a semaphore. Test controls the semaphore — releases it after `DIE` is sent to verify `ACK: DIE` is delayed until the transaction commits.

### #3 — IT-T-002: Worker Write vs Main Read Timing
WAL behavior is deterministic; scheduler timing is not. Proving "committed snapshots only" without arbitrary `sleep()` calls requires Worker Thread cooperation.

**Solution:** Worker emits a `FILE_COMMITTED` message after each file commit. Main thread reader runs between these events and verifies it only ever sees full committed file states.

### #4 — IT-T-028: Reranker Performance Floor
ONNX latency is hardware-sensitive. The 250ms threshold is calibrated for Apple Silicon with ONNX WASM JIT warm. Same test on slower CI hosts may flap.

**Solution:** Add `PYTHIA_TEST_RERANKER_PERF_FLOOR_MS` env override so CI can use a relaxed threshold (e.g., 500ms) without changing the source test.

### #5 — IT-T-029: GC Performance Floor
Deletion cost depends on page layout, prior fragmentation, and disk speed. A test seeding exactly 10k tombstones with short synthetic content may not stress the same code path as real production data (different page density, different FTS posting list shape).

**Solution:** Seed chunks with realistic content lengths (~300–800 chars) and real-looking CNI strings to approximate production page utilization.

---

## Files to Create

```
src/__tests__/integration/
  smoke.integration.test.ts               (IT-T-016 to IT-T-025)
  sqlite-concurrency.integration.test.ts  (IT-T-001 to IT-T-004)
  retrieval-pipeline.integration.test.ts  (IT-T-005 to IT-T-010)
  worker-failure.integration.test.ts      (IT-T-011 to IT-T-015)
  oracle-lifecycle.integration.test.ts    (IT-T-030)
src/__tests__/performance/
  performance-floor.test.ts               (IT-T-026 to IT-T-029)
```

**Total:** 60 scenarios — 30 behavioral (IT-B), 30 technical (IT-T)
