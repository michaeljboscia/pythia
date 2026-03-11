# IMPLEMENTATION PLAN — Pythia v1
**Version:** 2.0 (Full Merged System)
**Supersedes:** IMPLEMENTATION_PLAN.md (oracle engine only)
**Spec Reference:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md`
**This plan is written once and does not get modified during execution.**
**Date:** 2026-03-11

---

## Overview

Build strictly bottom-up. Each sprint delivers a working vertical slice with a concrete proof. No sprint begins until the previous sprint's proof passes.

| Sprint | Focus | Proof |
|---|---|---|
| 1 | Core Data Plane (SQLite + ONNX) | Embed a file, retrieve it by cosine similarity |
| 2 | Tree-sitter Fast Path + MCP scaffold | `lcs_investigate` returns AST-bounded chunks |
| 3 | Graph Engine + Slow Path (tsserver) | SQL CTE traverses from function A to function C via real tsserver edges |
| 4 | ReasoningProvider + Oracle tools | End-to-end: Claude asks → Pythia retrieves → MADR written to SQLite + Obsidian |
| 5 | Polish: CLI, GC, config, distribution | `npm install -g @pythia/lcs` → full cold-start works on a fresh machine |

---

## Sprint 1 — Core Data Plane

**Goal:** SQLite database exists, ONNX embedding works, basic retrieval works.
**Features:** FEAT-001 (partial), FEAT-013 (partial), FEAT-012 (partial)

### Step 1.1 — Project scaffold
**Files to create:**
- `package.json` (`@pythia/lcs`, ESM, `"type": "module"`)
- `tsconfig.json` (target: `ES2022`, `moduleResolution: bundler`)
- `src/index.ts` (empty entry point)
- `src/errors.ts` (full error code registry from BACKEND_STRUCTURE §Error Registry)
- `src/config.ts` (Zod schema + loader for `~/.pythia/config.json`)
- `.gitignore`

**Tests to write:**
- [ ] Config loader rejects missing required fields with `CONFIG_INVALID`
- [ ] Config loader accepts minimal valid config

### Step 1.2 — SQLite connection + pragma set
**Files to create:**
- `src/db/connection.ts` (opens SQLite, applies pragma set, exports `getDb()`)

**Pragma set (mandatory — both threads):**
```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;
```

**Tests to write:**
- [ ] Connection opens successfully
- [ ] WAL mode confirmed (`PRAGMA journal_mode` returns `wal`)
- [ ] Foreign keys confirmed enabled

### Step 1.3 — Migration runner
**Files to create:**
- `src/db/migrate.ts` (forward-only migration runner)
- `src/migrations/001-initial-schema.sql` (all tables: `lcs_chunks`, `vec_lcs_chunks`, `fts_lcs_chunks_kw`, `fts_lcs_chunks_sub`, `file_scan_cache`, `pythia_memories`, `pythia_sessions`, `pythia_transcripts`, `graph_edges`, `embedding_meta`)
- `src/migrations/002-graph-trigger.sql` (`trg_graph_edges_validate_before_insert`)

**Migration tracking table:**
```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  applied_at TEXT NOT NULL
);
```

**Tests to write:**
- [ ] Running migrations twice is idempotent
- [ ] All tables exist after migration
- [ ] `graph_edges` trigger aborts invalid inserts with `INVALID_GRAPH_ENDPOINT`

### Step 1.4 — ONNX embedding pipeline
**Files to create:**
- `src/indexer/embedder.ts` (loads `nomic-embed-text-v1.5` ONNX, runs inference, truncates to 256d)

**Model loading:**
- Cache to `~/.pythia/models/`
- First call downloads from HuggingFace Hub
- Returns `Float32Array` of length 256

**Tests to write:**
- [ ] Embedder returns Float32Array of length 256
- [ ] Same input → same output (deterministic)
- [ ] Model cached after first call

### Step 1.5 — Basic file chunking (regex/line-based — Tree-sitter in Sprint 2)
**Files to create:**
- `src/indexer/chunker-basic.ts` (split file into naive chunks for Sprint 1 proof only)

**Sprint 1 only:** This is a temporary scaffolding chunker, replaced in Sprint 2 by Tree-sitter.

### Step 1.6 — Atomic sync contract (upsert pipeline)
**Files to create:**
- `src/indexer/sync.ts` (implements §11.8 atomic sync contract)

**Pseudocode:**
```typescript
db.exec('BEGIN TRANSACTION');
// soft-delete old chunks for file_path
// delete stale vec/fts rows
// insert new chunks + vec + fts rows
// update file_scan_cache (immediately before COMMIT)
db.exec('COMMIT');
```

**Tests to write:**
- [ ] Soft-delete marks old chunks `is_deleted=1`
- [ ] New chunks inserted in same transaction
- [ ] Rollback on any insert failure leaves DB unchanged
- [ ] `file_scan_cache` updated in same transaction

### Sprint 1 Proof ✅
**Script:** `scripts/sprint1-proof.ts`
```typescript
// 1. Index a TypeScript file (basic chunks)
// 2. Run cosine similarity query against vec_lcs_chunks
// 3. Print top-3 results with scores
```
**Pass criteria:** Correct file retrieved as top-1 result for a query that exactly describes its content.

---

## Sprint 2 — Tree-sitter Fast Path + MCP Scaffold

**Goal:** Real AST-bounded chunks, MCP server running, `lcs_investigate` returns correct chunks.
**Features:** FEAT-002 (full), FEAT-004 (full), FEAT-005 (Sprint 2 scope: vector search only), FEAT-006

### Step 2.1 — Tree-sitter chunker
**Files to create:**
- `src/indexer/chunker-treesitter.ts`

**Chunk types to extract:** `function`, `class`, `method`, `interface`, `type`, `enum`, `namespace`, `module`
**CNI format:** `<path>::<type>::<name>` (see §11.1 for all edge cases: overloads, anonymous, default)
**`doc` chunks:** `.md`/`.mdx` files chunked by heading. CNI: `<path>::doc::<heading-slug>#L<line>` or `<path>::doc::default`
**`CONTAINS` edges:** Insert module→class, class→method hierarchy edges in same sync transaction
**Line numbers:** Extract `start_line` and `end_line` (0-based) from Tree-sitter AST node positions

**Tests to write:**
- [ ] `export function login() {}` → chunk_type=`function`, CNI=`src/auth.ts::function::login`
- [ ] `class AuthManager {}` → chunk_type=`class`, CNI=`src/auth.ts::class::AuthManager`
- [ ] `login()` method inside `AuthManager` → CNI=`src/auth.ts::class::AuthManager::method::login`
- [ ] `interface User {}` → chunk_type=`interface`
- [ ] `type UserId = string` → chunk_type=`type`
- [ ] `enum Role {}` → chunk_type=`enum`
- [ ] `namespace Auth {}` → chunk_type=`namespace`
- [ ] `README.md` with 3 headings → 3 doc chunks with correct CNIs
- [ ] `README.md` with no headings → 1 doc chunk with CNI `README.md::doc::default`
- [ ] Function overload `login#L45` disambiguation

### Step 2.2 — Dual FTS5 sync
**Files to modify:**
- `src/indexer/sync.ts` (add `fts_lcs_chunks_kw` and `fts_lcs_chunks_sub` inserts)

**Rule:** Plain `INSERT` (not `INSERT OR REPLACE`) for FTS5 tables. Delete-then-insert pattern.

**Tests to write:**
- [ ] Chunk appears in both FTS tables after upsert
- [ ] Stale chunk deleted from both FTS tables on file re-index

### Step 2.3 — CDC (file_scan_cache + mtime/hash)
**Files to create:**
- `src/indexer/cdc.ts` (mtime check → BLAKE3 hash check → queue file for indexing)
- `src/indexer/hasher.ts` (hash-wasm BLAKE3, Node.js SHA-256 fallback, `algo:digest` format)

**Binary file detection:** Read first 4096 bytes, skip if null byte found.
**Ignore semantics:** `ignore` npm package for full nested `.gitignore` semantics + `.pythiaignore` support.

**Tests to write:**
- [ ] File with unchanged mtime → not queued
- [ ] File with changed mtime + same BLAKE3 → not queued
- [ ] File with changed mtime + changed BLAKE3 → queued
- [ ] Binary file (null byte) → silently skipped
- [ ] `.gitignore` exclusions honored
- [ ] `.pythiaignore` exclusions honored
- [ ] `content_hash` format is `blake3:<hex>` or `sha256:<hex>`

### Step 2.4 — MCP server scaffold
**Files to create:**
- `src/index.ts` (MCP server entry point, stdio transport)
- `src/mcp/tools.ts` (tool registration — all 6 tools registered before any tool is used)

**Migration lifecycle:** Migrations run before tool registration.

**Tests to write:**
- [ ] MCP server starts without error
- [ ] All 6 tools registered (verify by listing tool names)

### Step 2.5 — `lcs_investigate` (Sprint 2: vector search only)
**Files to create:**
- `src/mcp/lcs-investigate.ts`
- `src/retrieval/hybrid.ts` (Sprint 2: vector only. Sprint 4: full RRF)

**Sprint 2 scope:** Vector search only. No FTS fusion, no RRF, no cross-encoder.
**Output format:** §14.13 block format exactly.
**Zero results handling:** `[METADATA: INDEX_EMPTY]` vs `[METADATA: NO_MATCH]` (detect empty corpus vs non-matching query)

**Tests to write:**
- [ ] Returns §14.13 formatted blocks
- [ ] Returns `[METADATA: INDEX_EMPTY]` when corpus is empty
- [ ] Returns `[METADATA: NO_MATCH]` when query matches nothing in a populated corpus
- [ ] Indexing-progress header prepended when `index_state != "ready"`

### Step 2.6 — `pythia_force_index` tool
**Files to create:**
- `src/mcp/force-index.ts`

**Path semantics:**
- Omitted → full workspace CDC scan
- Directory → subtree scan
- Specific file → force re-embed unconditionally (bypass hash check)
- Missing/absolute/traversal → `INVALID_PATH` error

**Tests to write:**
- [ ] `../` path → `INVALID_PATH`
- [ ] Absolute path → `INVALID_PATH`
- [ ] Nonexistent file → `INVALID_PATH`
- [ ] Specific file → unconditional re-embed (no mtime/hash check)
- [ ] Directory → recursive scan

### Sprint 2 Proof ✅
**Tool call:** `lcs_investigate({ query: "function that handles user authentication", intent: "semantic" })`
**Pass criteria:**
- Returns ≥1 chunk
- Chunk content is AST-bounded (starts and ends at function boundaries, not mid-line)
- `chunk_type=function` and CNI format is correct
- `start_line` and `end_line` are correct (verify against source)

---

## Sprint 3 — Graph Engine + Slow Path

**Goal:** `graph_edges` populated by real `tsserver` extraction. SQL CTE traversal works.
**Features:** FEAT-003 (full), FEAT-016 (full — Worker Thread supervisor)

### Step 3.1 — Worker Thread setup
**Files to create:**
- `src/indexer/worker.ts` (Worker Thread entry point)
- `src/indexer/worker-protocol.ts` (MainToWorker + WorkerToMain type definitions from §17.15)

**Message types:** Full bipartite protocol: `INDEX_BATCH`, `PAUSE`, `RESUME`, `DIE`, `PING` / `ACK`, `BATCH_STARTED`, `BATCH_COMPLETE`, `FILE_FAILED`, `PAUSED`, `HEARTBEAT`, `FATAL`

**`DIE` behavior:** Finish current file + commit active transaction → `ACK: DIE` → exit. Never mid-file abort.

**Tests to write:**
- [ ] `PING` → `ACK: PING`
- [ ] `INDEX_BATCH` → `ACK: INDEX_BATCH`, then `BATCH_STARTED`, then `BATCH_COMPLETE`
- [ ] `DIE` → `ACK: DIE`, then exit

### Step 3.2 — Worker Thread supervisor (circuit breaker)
**Files to create:**
- `src/indexer/supervisor.ts`

**Circuit breaker:** 3 crashes within 10 minutes → stop auto-restart. State is process-local.
**Recovery:** `pythia_force_index` within same process resets if batch succeeds. Process restart also resets.

**Tests to write:**
- [ ] 3 crashes within 10 min → auto-restart stops
- [ ] 4th crash → no restart attempted
- [ ] `pythia_force_index` with successful batch → circuit breaker resets

### Step 3.3 — `tsserver` integration (Slow Path)
**Files to create:**
- `src/indexer/slow-path.ts` (long-lived tsserver process, `getDefinitionAtPosition()`)

**`tsserver` lifecycle:** One per workspace, owned by Worker Thread. Restarts with Worker Thread on crash.
**JS support:** Inferred-project resolution (no `tsconfig.json` required for `.js`/`.jsx`)
**Edge types produced:** `CALLS`, `IMPORTS`, `RE_EXPORTS`

**Tests to write:**
- [ ] `import { login } from './auth'` → `IMPORTS` edge from importer to auth module
- [ ] `login()` call inside another function → `CALLS` edge
- [ ] `RE_EXPORTS` edge from barrel module to canonical symbol
- [ ] `.js` file without `tsconfig.json` → edges extracted correctly

### Step 3.4 — Graph CTE traversal
**Files to create:**
- `src/retrieval/graph.ts` (bidirectional BFS CTE, depth 6, cycle detection, 50-node cap)

**CTE:** Bidirectional by default. Both inbound + outbound edges per hop. Cycle detection via path string column. Cap: 50 nodes BFS order.

**Output:** §14.13 format blocks with `[DEPTH:N via EDGE_TYPE]` prefix per block.

**Tests to write:**
- [ ] Starting from function A: traversal reaches function C via CALLS chain
- [ ] Cycle detection: no infinite loop on circular dependency
- [ ] Depth limit: stops at 6 hops
- [ ] 50-node cap enforced

### Sprint 3 Proof ✅
**Pass criteria:** Using a real TypeScript file with cross-file dependencies:
1. Fast Path indexes both files (chunks in `lcs_chunks`)
2. Slow Path runs `tsserver` and produces real `CALLS` and `IMPORTS` edges
3. `lcs_investigate({ query: "src/auth.ts::function::login", intent: "structural" })` returns the correct call chain traversal
4. Edges come from actual `tsserver` extraction (NOT hand-inserted test edges)

---

## Sprint 4 — ReasoningProvider + Oracle Tools

**Goal:** Full oracle session lifecycle. End-to-end: question → retrieval → MADR → Obsidian.
**Features:** FEAT-005 (full hybrid), FEAT-007, FEAT-008, FEAT-009, FEAT-010, FEAT-011, FEAT-014, FEAT-015, FEAT-017

### Step 4.1 — Full hybrid retrieval (RRF + cross-encoder)
**Files to modify/create:**
- `src/retrieval/hybrid.ts` (add FTS fusion + RRF)
- `src/retrieval/reranker.ts` (cross-encoder: `Xenova/ms-marco-MiniLM-L-6-v2`)

**RRF:** `score = wv/(60+rank_vec) + wf/(60+rank_fts)`. Intent weights: semantic wv=0.7/wf=0.3; structural wv=0.3/wf=0.7.
**Cross-encoder:** Top-12 candidates. `truncation='only_second'`. ≤150ms target, hard fallback at 250ms → serve RRF order + `[METADATA: RERANKER_UNAVAILABLE]`.
**Score:** `sigmoid(logit)` → 0.0–1.0 float.

**FTS routing:** `fts_lcs_chunks_kw` first. Zero hits AND (double-quoted query OR contains `::`, `/`, `.`) → fallback to `fts_lcs_chunks_sub`.

**Tests to write:**
- [ ] RRF fusion produces correct rank ordering
- [ ] Intent weights applied correctly for semantic vs structural
- [ ] Cross-encoder fallback at 250ms timeout
- [ ] FTS routing: double-quoted query → trigram fallback
- [ ] FTS routing: CNI query (`::`) → trigram fallback

### Step 4.2 — ReasoningProvider interface + CliReasoningProvider
**Files to create:**
- `src/oracle/provider.ts` (interface definition)
- `src/oracle/cli-provider.ts` (Gemini CLI wrapper)

**Retry:** Exponential backoff: 1s, 5s, 15s → `PROVIDER_UNAVAILABLE`
**AUTH_INVALID:** Hard fail, no silent fallback.

**Tests to write:**
- [ ] Retry logic: 3 failures → `PROVIDER_UNAVAILABLE`
- [ ] AUTH_INVALID propagated immediately (no retry)

### Step 4.3 — Session management
**Files to create:**
- `src/oracle/session.ts` (session CRUD, generation_id logic, partial unique index enforcement)

**spawn_oracle logic:**
- Same name active/idle → return existing session_id (no secret in response)
- New name, no active session → create, return with secret
- New name, another active → `SESSION_ALREADY_ACTIVE`
- Idle session spawned → MADR reconstitution only (NOT transcript replay)

**Tests to write:**
- [ ] Idempotent attach: second spawn with same name returns existing session_id
- [ ] Race condition: concurrent same-name spawns → one wins via `BEGIN IMMEDIATE` + unique index
- [ ] `SESSION_ALREADY_ACTIVE` when different name attempted with active session
- [ ] `generation_id` increments only on genuine new generation (not on attach)

### Step 4.4 — `spawn_oracle` MCP tool
**Files to create:**
- `src/mcp/spawn-oracle.ts`

**Output format (exact):**
```json
{"session_id":"<uuid-v4>","status":"active","created":true,"generation_id":1,"decommission_secret":"<32-char-hex>"}
```
`decommission_secret` absent when `created: false` (attach to existing session).

**Tests to write:**
- [ ] New session: response includes `decommission_secret`
- [ ] Attach to existing: response omits `decommission_secret`
- [ ] `session_id` is valid UUID v4

### Step 4.5 — `ask_oracle` MCP tool
**Files to create:**
- `src/mcp/ask-oracle.ts`
- `src/oracle/reaper.ts` (inactivity reaper)

**Reaper:** `limits.session_idle_ttl_minutes` (default 30). Fires `dismiss()` on idle. Session → `idle`. Does NOT send `DIE` to Worker Thread.
**FIFO mutex:** Per-session promise chain queue. Max depth 5. 6th → `SESSION_BUSY`.
**Write-ahead:** User turn written BEFORE provider call.
**Context budget:** Preamble + transcript + context ≤ session cap. Trim by rank. Over cap → `CONTEXT_BUDGET_EXCEEDED`.

**Tests to write:**
- [ ] Write-ahead: user turn exists in DB even if provider call fails
- [ ] Queue depth 5: 6th concurrent call → `SESSION_BUSY`
- [ ] Idle session: auto-respawn from MADRs before responding
- [ ] Context budget enforcement

### Step 4.6 — `oracle_commit_decision` MCP tool
**Files to create:**
- `src/mcp/commit-decision.ts`
- `src/obsidian/writer.ts`
- `src/obsidian/retry.ts`

**Transaction:** `BEGIN IMMEDIATE` → MADR INSERT → IMPLEMENTS edges INSERT → COMMIT. Obsidian write is out-of-transaction.
**NOT idempotent:** Duplicate submissions create new MADR rows.
**Supersedes:** Both MADR INSERT and status UPDATE in single transaction.

**Tests to write:**
- [ ] MADR inserted with correct `seq`-derived `id` (`MADR-001`, `MADR-002`, etc.)
- [ ] `COUNT(*) + 1` is never used (verify by inserting with gaps — sequence must be monotonic from AUTOINCREMENT)
- [ ] IMPLEMENTS edge created for each file in `impacts_files`
- [ ] Invalid graph endpoint: aborts entire transaction including MADR
- [ ] Obsidian failure → MADR preserved in SQLite, retry job added

### Step 4.7 — `oracle_decommission` MCP tool
**Files to create:**
- `src/mcp/decommission.ts`

**Verification:** Argon2id (hash-wasm). memory_cost=65536, time_cost=3, parallelism=1.
**On success:** Hard-delete transcripts. Session row status → `decommissioned`, secrets → NULL.
**MADRs not deleted.**

**Tests to write:**
- [ ] Correct verification phrase → success
- [ ] Wrong phrase → hard failure (no transcripts deleted)
- [ ] Session name available for reuse after decommission
- [ ] MADRs survive decommission

### Step 4.8 — SdkReasoningProvider (Premium)
**Files to create:**
- `src/oracle/sdk-provider.ts` (using `@google/genai` SDK)

**Activation:** `reasoning.mode = "sdk"` in config + `GEMINI_API_KEY` present.

**Tests to write:**
- [ ] SDK provider selected when config has API key
- [ ] CLI provider selected when no API key

### Sprint 4 Proof ✅
**End-to-end integration test:**
1. Index a TypeScript repository
2. `spawn_oracle` → returns session with decommission_secret
3. `ask_oracle` with a question about the codebase → oracle returns grounded response
4. `oracle_commit_decision` with the decision → MADR-001 in SQLite + `Pythia/MADR-001-*.md` in vault
5. `oracle_decommission` with correct phrase → transcripts deleted, session decommissioned
6. New `spawn_oracle` with same name → succeeds (generation_id=2, new secret)

---

## Sprint 5 — CLI, GC, Config, Distribution

**Goal:** `npm install -g @pythia/lcs` works on a fresh machine. Full lifecycle tested.
**Features:** FEAT-018 (GC), FEAT-019 (Progressive Enhancement), FEAT-020 (CLI), FEAT-013 (full migration lifecycle)

### Step 5.1 — GC implementation
**Files to create:**
- `src/db/gc.ts`

**GC trigger:** Boot + after sync batches exceeding thresholds (>10,000 tombstones or >20% of total).
**GC transaction:** Delete `lcs_chunks` + `vec_lcs_chunks` + `fts_lcs_chunks_kw` + `fts_lcs_chunks_sub` in single transaction. Then `PRAGMA incremental_vacuum`.
**Retention:** `gc.deleted_chunk_retention_days` (default 30).

**Tests to write:**
- [ ] Chunks older than retention_days hard-deleted from all 4 tables
- [ ] Chunks younger than retention_days untouched
- [ ] GC runs at boot
- [ ] GC triggered after batch exceeds thresholds

### Step 5.2 — pythia CLI (`commander`)
**Files to create:**
- `src/cli/main.ts`
- `src/cli/init.ts` (`pythia init` — creates `.pythia/`, runs migrations, validates config, cold-start index)
- `src/cli/start.ts` (`pythia start` — launches MCP server, warm-start scan)
- `src/cli/mcp-install.ts` (`pythia mcp install claude-code` — idempotent, previews changes)
- `src/cli/migrate.ts` (`pythia migrate` — stack transition)

**`pythia init` idempotency:** Existing `.pythia/lcs.db` → run migrations only, exit silently.
**`pythia start` vs `pythia init`:** `start` ONLY launches MCP server. `init` ONLY bootstraps. They are separate commands.

**Tests to write:**
- [ ] `pythia init` on empty directory → creates `.pythia/lcs.db`
- [ ] `pythia init` on existing directory → runs migrations, does not destroy data
- [ ] `pythia mcp install claude-code` previews before applying (dry-run by default)
- [ ] `pythia start` launches MCP server on stdio

### Step 5.3 — Progressive enhancement adapters
**Files to create:**
- `src/indexer/vector-store.ts` (`VectorStore` interface + SQLite/Qdrant implementations)
- `src/retrieval/graph-store.ts` (`GraphStore` interface + SQLite CTE/FalkorDB implementations)

**Stack switch (pythia migrate):** Full re-embed from `lcs_chunks`. Old backend marked inactive.
**FalkorDB sidecar:** `child_process.spawn()`, TCP/HTTP socket, starts/stops with MCP server. Accessed through `GraphStore` interface.

**Tests to write:**
- [ ] `VectorStore` SQLite implementation: upsert + query
- [ ] `GraphStore` SQLite implementation: edge insert + CTE traversal
- [ ] Config switch selects correct implementation

### Step 5.4 — Migration lifecycle enforcement
**Files to modify:**
- `src/index.ts` (add migration check at MCP server connection open)
- `src/cli/init.ts` (verify migrations run at `pythia init`)
- `src/cli/start.ts` (verify migrations run at `pythia start`)

**All three lifecycle points must run migrations before any tools register.**

**Tests to write:**
- [ ] MCP server connection open → migration check runs (no-op if current)
- [ ] All 3 lifecycle points confirmed with integration test

### Step 5.5 — npm package bundling
**Files to create:**
- `scripts/build.ts` (esbuild/tsup bundler config)
- Updated `package.json` with `bin: { pythia: './dist/cli/main.js' }`

**Tests to write:**
- [ ] `npm pack` produces installable package
- [ ] `npm install -g` → `pythia --version` works
- [ ] `pythia init` runs successfully on fresh machine

### Sprint 5 Proof ✅
**Fresh machine test:**
1. `npm install -g @pythia/lcs`
2. `cd /some/typescript/project`
3. `pythia init` → runs migrations, cold-start indexes all files
4. `pythia mcp install claude-code` → previews config, applies on confirm
5. `pythia start` → MCP server running on stdio
6. Open Claude Code → `lcs_investigate` returns results immediately (using existing index)
7. Background warm-scan completes within reasonable time for repo size

---

## Dependency Map (What Blocks What)

```
Sprint 1 ←── Sprint 2 ←── Sprint 3 ←── Sprint 4 ←── Sprint 5
(SQLite)     (Tree-sitter) (tsserver)   (Oracle)     (CLI/GC)
   ↓              ↓             ↓            ↓
FEAT-001      FEAT-002      FEAT-003     FEAT-007    FEAT-020
FEAT-013      FEAT-004      FEAT-016     FEAT-008    FEAT-018
FEAT-012      FEAT-005*     FEAT-006     FEAT-009    FEAT-019
              FEAT-012      FEAT-012     FEAT-010
                                        FEAT-011
                                        FEAT-014
                                        FEAT-015
                                        FEAT-017
```

*FEAT-005 in Sprint 2 = vector-only. Full hybrid in Sprint 4.

---

## File Creation Checklist

### Sprint 1
- [ ] `package.json`
- [ ] `tsconfig.json`
- [ ] `src/index.ts`
- [ ] `src/errors.ts`
- [ ] `src/config.ts`
- [ ] `src/db/connection.ts`
- [ ] `src/db/migrate.ts`
- [ ] `src/migrations/001-initial-schema.sql`
- [ ] `src/migrations/002-graph-trigger.sql`
- [ ] `src/indexer/embedder.ts`
- [ ] `src/indexer/chunker-basic.ts`
- [ ] `src/indexer/sync.ts`
- [ ] `scripts/sprint1-proof.ts`

### Sprint 2
- [ ] `src/indexer/chunker-treesitter.ts`
- [ ] `src/indexer/cdc.ts`
- [ ] `src/indexer/hasher.ts`
- [ ] `src/mcp/tools.ts`
- [ ] `src/mcp/lcs-investigate.ts`
- [ ] `src/mcp/force-index.ts`
- [ ] `src/retrieval/hybrid.ts` (vector-only stub)

### Sprint 3
- [ ] `src/indexer/worker.ts`
- [ ] `src/indexer/worker-protocol.ts`
- [ ] `src/indexer/supervisor.ts`
- [ ] `src/indexer/slow-path.ts`
- [ ] `src/retrieval/graph.ts`

### Sprint 4
- [ ] `src/retrieval/hybrid.ts` (full RRF)
- [ ] `src/retrieval/reranker.ts`
- [ ] `src/oracle/provider.ts`
- [ ] `src/oracle/cli-provider.ts`
- [ ] `src/oracle/sdk-provider.ts`
- [ ] `src/oracle/session.ts`
- [ ] `src/oracle/reaper.ts`
- [ ] `src/mcp/spawn-oracle.ts`
- [ ] `src/mcp/ask-oracle.ts`
- [ ] `src/mcp/commit-decision.ts`
- [ ] `src/mcp/decommission.ts`
- [ ] `src/obsidian/writer.ts`
- [ ] `src/obsidian/retry.ts`

### Sprint 5
- [ ] `src/db/gc.ts`
- [ ] `src/cli/main.ts`
- [ ] `src/cli/init.ts`
- [ ] `src/cli/start.ts`
- [ ] `src/cli/mcp-install.ts`
- [ ] `src/cli/migrate.ts`
- [ ] `src/indexer/vector-store.ts`
- [ ] `src/retrieval/graph-store.ts`
- [ ] `scripts/build.ts`
