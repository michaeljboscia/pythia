# PRD — Pythia v1
**Version:** 2.0 (Full Merged System — Oracle Engine + LCS)
**Supersedes:** PRD.md (oracle engine only)
**Spec Reference:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md`
**Date:** 2026-03-11

---

## Product Overview

Pythia is a self-updating, deterministic digital twin of a codebase equipped with a persistent AI reasoning daemon. It runs entirely locally as an MCP server, uses a dual-engine indexer (Tree-sitter + TypeScript LSP) to map any codebase into a hybrid vector-graph database (SQLite), and gives Claude Code the context required to reason across thousands of files without hallucination or context window exhaustion.

**Primary user:** Individual developer who installs Pythia globally via npm and uses it within Claude Code.
**Distribution:** `npm install -g @pythia/lcs` → `pythia init` → `pythia start` → `pythia mcp install claude-code`

---

## The $0 vs Premium Tiers

| Component | $0 Default (Zero Config) | Premium (API Keys Required) |
|---|---|---|
| Embeddings | `nomic-embed-text-v1.5` (ONNX local) | Voyage AI `voyage-code-3` |
| Vector dimensions | 256d Float32 | 1024d Binary Quantized |
| Vector store | `sqlite-vec` (in SQLite) | Qdrant (local Docker or cloud) |
| Graph store | SQLite recursive CTEs | FalkorDBLite (Python sidecar) |
| Reasoning engine | Gemini CLI wrapper | `@google/genai` SDK (KV cache) |
| Monthly cost | **$0.00** | ~$11.00 |

---

## Feature Registry

### FEAT-001 — Core SQLite Database Schema
**Priority:** P0 — Sprint 1
**Description:** The unified `.pythia/lcs.db` database holds all code chunks, vectors, episodic memory, sessions, transcripts, and graph edges in a single SQLite file.
**Tables required:** `lcs_chunks`, `vec_lcs_chunks`, `fts_lcs_chunks_kw`, `fts_lcs_chunks_sub`, `file_scan_cache`, `pythia_memories`, `pythia_sessions`, `pythia_transcripts`, `graph_edges`, `embedding_meta`
**Acceptance criteria:**
- [ ] Database created at `.pythia/lcs.db` relative to workspace root
- [ ] All tables created via forward-only migration scripts in `src/migrations/`
- [ ] Every SQLite connection sets: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`
- [ ] `graph_edges` BEFORE INSERT trigger `trg_graph_edges_validate_before_insert` prevents phantom endpoints
- [ ] `embedding_meta` singleton row absent until first successful full vector build

---

### FEAT-002 — Fast Path Indexer (Tree-sitter Chunking + ONNX Embedding)
**Priority:** P0 — Sprint 2
**Description:** Parses TypeScript/JavaScript source files via Tree-sitter, extracts AST-bounded chunks, embeds them via `nomic-embed-text-v1.5` ONNX pipeline, and upserts to SQLite atomically.
**Chunk types extracted:** `function`, `class`, `method`, `interface`, `type`, `enum`, `namespace`, `module`, `doc`
**Acceptance criteria:**
- [ ] Tree-sitter extracts all 9 chunk types with correct `start_line`/`end_line` (0-based)
- [ ] CNI format: `<path>::<type>::<name>` (see §11.1 for full CNI spec)
- [ ] `doc` chunks: `.md`/`.mdx` files chunked by heading. CNI: `<path>::doc::<heading-slug>#L<line>` or `<path>::doc::default`
- [ ] Embedding: `nomic-embed-text-v1.5` ONNX, first 256 floats (Matryoshka truncation)
- [ ] All writes inside single `BEGIN TRANSACTION` (atomic sync contract §11.8)
- [ ] `file_scan_cache` updated at end of same transaction (immediately before COMMIT)
- [ ] `CONTAINS` edges (module→class, class→method) inserted in same transaction
- [ ] Per-file latency < 100ms

---

### FEAT-003 — Slow Path Graph Builder (tsserver CALLS/IMPORTS)
**Priority:** P0 — Sprint 3
**Description:** TypeScript Compiler API (`tsserver`) resolves cross-file symbol references and generates `CALLS` and `IMPORTS` edges in `graph_edges`. Runs asynchronously in a Worker Thread after the Fast Path completes a batch.
**Acceptance criteria:**
- [ ] One long-lived `tsserver` process per workspace, owned by the Worker Thread
- [ ] Supports `.js` and `.jsx` via `tsserver` inferred-project resolution (no `tsconfig.json` required)
- [ ] Non-JS/TS files skipped silently
- [ ] Edges inserted via the BEFORE INSERT trigger (polymorphic endpoint validation)
- [ ] Sprint 3 proof: real `tsserver` produces real `CALLS` and `IMPORTS` edges from actual TypeScript source (hand-inserted edges do NOT satisfy Sprint 3 proof gate)

---

### FEAT-004 — FTS5 Dual-Index (Keyword + Trigram)
**Priority:** P0 — Sprint 2
**Description:** Two parallel FTS5 virtual tables serve different query shapes. `fts_lcs_chunks_kw` (unicode61 with code tokenchars) for exact symbol matching. `fts_lcs_chunks_sub` (trigram) for substring/path/CNI fallback.
**Exact tokenizer for kw:** `tokenize="unicode61 tokenchars '._:/#<>?!-'"`
**Routing:** Query `fts_lcs_chunks_kw` first. If zero hits AND (query enclosed in double quotes OR contains `::`, `/`, `.`), run `fts_lcs_chunks_sub` fallback. No `limit` parameter exposed.
**Acceptance criteria:**
- [ ] Both tables populated synchronously with every chunk upsert
- [ ] Sequential dual-query routing implemented in `lcs_investigate` handler
- [ ] Routing is transparent to the caller (no parameter)
- [ ] Both tables deleted and re-inserted (not INSERT OR REPLACE) on chunk update

---

### FEAT-005 — `lcs_investigate` MCP Tool (Hybrid Retrieval)
**Priority:** P0 — Sprint 2 (basic vector only), Sprint 4 (full hybrid)
**Description:** Primary retrieval tool. Runs hybrid search: top-30 vector + top-30 FTS, weighted RRF fusion, top-12 through cross-encoder re-ranker.
**Input:** `{ query: string; intent: "semantic" | "structural" }`
**Output:** Plain-text blocks (§14.13 format). Structural adds `[DEPTH:N via EDGE]` prefix per block, capped at 50 nodes BFS.
**RRF formula:** `score = wv/(60 + rank_vec) + wf/(60 + rank_fts)`
**Intent weights:** `semantic` → `wv=0.7, wf=0.3`; `structural` → `wv=0.3, wf=0.7`
**Cross-encoder:** `Xenova/ms-marco-MiniLM-L-6-v2`, target ≤150ms, hard fallback at 250ms (serve RRF order)
**Structural input:** Must be exact CNI or repo-relative file path. Natural language rejected.
**Acceptance criteria:**
- [ ] `intent: "semantic"` → hybrid vector+FTS → RRF → cross-encoder → top-12
- [ ] `intent: "structural"` → bidirectional BFS CTE, depth ≤6, cycle detection, 50-node cap
- [ ] 12-chunk cap is fixed and internal — no `limit` parameter
- [ ] Metadata headers prepended for degraded states (see §13.13, §18.8)
- [ ] Zero results: `[METADATA: INDEX_EMPTY]` vs `[METADATA: NO_MATCH]` distinguished
- [ ] Cross-encoder lazy-downloaded to `~/.pythia/models/` on first call
- [ ] Cross-encoder failure: `[METADATA: RERANKER_UNAVAILABLE]` + serve RRF order

**Output format (per chunk):**
```
--- CHUNK {rank} score={score}
PATH: {file_path}
CNI: {id}
TYPE: {chunk_type}
LINES: {start_line}-{end_line}
```{language}
{content}
```
```

---

### FEAT-006 — `pythia_force_index` MCP Tool
**Priority:** P0 — Sprint 2
**Description:** Manually triggers indexing pipeline for a path or the full workspace.
**Input:** `{ path?: string }` (optional — repo-relative file, directory, or omit for full workspace)
**Path semantics:**
- Omitted: full-workspace CDC scan (mtime/hash)
- Directory: recurse subtree, mtime/hash per file
- Specific file: force re-embed unconditionally (bypass hash check)
- Missing/outside workspace: return `INVALID_PATH` JSON-RPC error immediately
**Coalescing:** If target file already in-flight, merge with `priority=manual` flag. Return `[STATUS: INDEX_MERGED]`.
**On completion:** Triggers same GC check as any other sync batch.
**Acceptance criteria:**
- [ ] Absolute paths and `../` traversal rejected with `INVALID_PATH`
- [ ] Process-local mutex prevents concurrent sync work
- [ ] `priority=manual` coalescing preserves unconditional re-embed semantics
- [ ] GC threshold check runs after batch completes

---

### FEAT-007 — `spawn_oracle` MCP Tool
**Priority:** P0 — Sprint 4
**Description:** Creates or attaches to a stateful reasoning session. One active session per repository at a time.
**Input:** `{ session_name: string; initial_context_query: string }`
**Output:** `{"session_id":"<uuid-v4>","status":"active","created":true|false,"generation_id":N,"decommission_secret":"<32-char-hex>"}` — `decommission_secret` present only when `created: true`
**Session logic:**
- Same name, session active/idle: attach, return existing session_id (no secret)
- New name, no active session: create new generation, return with secret
- New name, another session active: return `SESSION_ALREADY_ACTIVE` error
**Idle reactivation:** Re-spawns provider from accepted MADRs only (NOT transcript replay — §14.5)
**Decommission secret:** 128-bit random, returned once. Store only Argon2id hash + salt.
**Verification phrase:** `DECOMMISSION <session_id> <32-char-hex>`
**Acceptance criteria:**
- [ ] UUID v4 for session_id
- [ ] `BEGIN IMMEDIATE` + partial unique index prevents race conditions
- [ ] MADR preamble packed newest-first up to 120,000 char cap
- [ ] `initial_context_query` resolved via internal pipeline into 60,000 char bootstrap context
- [ ] `spawn()` cap: 180,000 chars total
- [ ] `generation_id` increments only on genuine new generation
- [ ] Inactivity reaper: dismiss after `limits.session_idle_ttl_minutes` (default 30)

---

### FEAT-008 — `ask_oracle` MCP Tool
**Priority:** P0 — Sprint 4
**Description:** Sends a message to an active oracle session and returns the response.
**Input:** `{ session_id: string; message: string; additional_context_query?: string }`
**Output:** Provider response string.
**Context injection:** `additional_context_query` resolved synchronously before provider call (internal pipeline, not public `lcs_investigate`). Max 12 chunks / 48,000 chars.
**Concurrency:** Per-session FIFO mutex, max queue depth 5. 6th concurrent call returns `SESSION_BUSY`.
**Transcript:** User turn written BEFORE provider call (write-ahead). Model turn written after success.
**Acceptance criteria:**
- [ ] `CONTEXT_BUDGET_EXCEEDED` if preamble + transcript + context exceeds session budget
- [ ] Retry: provider wraps calls with exponential backoff (1s, 5s, 15s)
- [ ] `AUTH_INVALID` is a hard failure — no silent fallback to CLI
- [ ] Idle session: auto-respawn from MADRs before responding

---

### FEAT-009 — `oracle_commit_decision` MCP Tool
**Priority:** P0 — Sprint 4
**Description:** Permanently records an architectural decision as a MADR in SQLite and writes it to the Obsidian vault.
**Input:** `{ title: string; problem: string; drivers: string[]; options: string[]; decision: string; impacts_files: string[]; supersedes_madr?: string }`
**Output:** `madr_id` (e.g., `MADR-012`)
**Transaction:** `BEGIN IMMEDIATE` → INSERT pythia_memories → INSERT IMPLEMENTS edges → COMMIT (atomic). Obsidian write is out-of-transaction side effect.
**MADR ID:** `printf('MADR-%03d', last_insert_rowid())` inside same transaction
**NOT idempotent in v1:** Duplicate submissions create new MADR rows (no heuristic deduplication)
**Obsidian filename:** `MADR-%03d-<slug>.md` (slug: lowercase ASCII, 64-char max, `untitled` fallback)
**Obsidian failure:** Log, surface `[METADATA: OBSIDIAN_DISABLED]`, add to retry queue, DO NOT rollback MADR
**Supersedes chain:** Both MADR INSERT and `status='superseded'` UPDATE in same transaction
**Acceptance criteria:**
- [ ] IMPLEMENTS edges: `impacts_files` paths resolved to module CNIs (`<path>::module::default`)
- [ ] File CNIs only in `impacts_files` (no symbol CNIs in v1)
- [ ] Vault write fails gracefully, queued at `<repo>/.pythia/obsidian-retry-queue.json`
- [ ] Retry queue: max 5 retries, exponential backoff (1m, 5m, 15m, 30m, 1h)

---

### FEAT-010 — `oracle_decommission` MCP Tool
**Priority:** P0 — Sprint 4
**Description:** Securely wipes an oracle session's temporary state.
**Input:** `{ session_id: string; verification_phrase: string }`
**Verification phrase:** `DECOMMISSION <session_id> <32-char-hex>`. Hash mismatch is a hard failure.
**On success:**
- Hard-delete all `pythia_transcripts` rows (secure wipe)
- Retain `pythia_sessions` row with `status='decommissioned'`, decommission fields cleared to NULL
- MADRs in `pythia_memories` are NOT deleted — they persist across generations
**Acceptance criteria:**
- [ ] Argon2id verification: memory_cost=65536 KiB, time_cost=3, parallelism=1
- [ ] Session name becomes available for reuse (partial unique index only covers active/idle)
- [ ] Returns success string after wipe complete

---

### FEAT-011 — ReasoningProvider Interface (CLI + SDK)
**Priority:** P0 — Sprint 4
**Description:** Abstraction over any AI daemon/model. v1 implements `CliReasoningProvider` (Gemini CLI) and `SdkReasoningProvider` (Gemini SDK). Provider selected by presence of `GEMINI_API_KEY` in config.
**Interface methods:** `spawn(sessionName, systemInstruction, contextChunks)`, `ask(sessionId, prompt, additionalContext?)`, `dismiss(sessionId)`
**Future stub:** `LocalReasoningProvider` (Ollama) — reserved, not implemented
**Acceptance criteria:**
- [ ] Instantiated based on config, not hardcoded
- [ ] `AUTH_INVALID` hard-fails with no silent fallback
- [ ] Retry: 1s, 5s, 15s exponential backoff before `PROVIDER_UNAVAILABLE`

---

### FEAT-012 — Change Data Capture (CDC)
**Priority:** P0 — Sprint 1/2
**Description:** Unified MTime/Hash File Scanner determines which files need re-indexing without Git hooks or polling.
**Algorithm:** Scan directory → mtime check against `file_scan_cache` → if mtime changed, BLAKE3 hash → compare to `content_hash` → if different, trigger Tree-sitter pipeline.
**Hash format:** `algo:digest` (e.g., `blake3:abc123...` or `sha256:def456...`). Mixed-algorithm records never compare equal.
**Hashing:** `hash-wasm` WASM (BLAKE3). Fallback on WASM failure: Node.js `crypto` SHA-256.
**Binary detection:** Read first 4096 bytes, skip file if null byte found.
**Ignore semantics:** Full nested `.gitignore` semantics via `ignore` npm package. Repo-root `.pythiaignore` additionally supported (gitignore syntax, cannot un-ignore `.gitignore` patterns).
**Acceptance criteria:**
- [ ] `file_scan_cache` is the CDC authority — never `lcs_chunks.content_hash`
- [ ] Cache updated in same transaction as chunk operations, immediately before COMMIT
- [ ] `.pythiaignore` is repo-root only and cannot override `.gitignore` exclusions
- [ ] Untracked files, uncommitted edits handled correctly

---

### FEAT-013 — Forward-Only Schema Migration Runner
**Priority:** P0 — Sprint 1
**Description:** SQL migration files in `src/migrations/` are bundled in the npm package and applied in order at three lifecycle points.
**Lifecycle points:** `pythia init`, `pythia start`, MCP server connection open (no-op if current)
**All migrations run before any tool is registered.**
**pythia init idempotency:** If `.pythia/lcs.db` exists, runs migrations only and exits silently. Wipe requires manual `rm -rf .pythia`.
**Acceptance criteria:**
- [ ] Migration applied at all three lifecycle points
- [ ] Per-attach migrations are no-ops if schema is already current
- [ ] Forward-only: no destructive migrations on durable tables
- [ ] `lcs_chunks`, `pythia_memories`, `pythia_sessions`, `pythia_transcripts` migrated in-place
- [ ] Derived tables (`vec_lcs_chunks`, `fts_lcs_chunks_*`, `graph_edges`) may be dropped and rebuilt

---

### FEAT-014 — Obsidian Vault Integration (Glass Memory Layer)
**Priority:** P1 — Sprint 4
**Description:** Pythia writes MADR files to an Obsidian vault as a passive read-only UI layer.
**Write target:** `<repo>/Pythia/` directory inside resolved vault root. `.obsidian/` directory is vault detection marker only — never written to.
**Vault detection:** `obsidian_vault_path` in config, or scan for `.obsidian/` at workspace root.
**No vault configured:** `OBSIDIAN_DISABLED` — silent, no retry queue
**Vault configured but inaccessible:** `[METADATA: OBSIDIAN_UNAVAILABLE]` — write queued for retry
**MADR frontmatter:** YAML frontmatter mapping all `pythia_memories` columns for Dataview plugin compatibility.
**Retry queue:** `<repo>/.pythia/obsidian-retry-queue.json`, atomic-replace write (fsync + rename), loaded on MCP server restart
**Acceptance criteria:**
- [ ] MADR filename: `MADR-012-auth-middleware-decision.md`
- [ ] Frontmatter includes: `madr_id`, `title`, `status`, `timestamp`, `generation_id`, `decision_outcome`
- [ ] Queue max 5 retries: 1m, 5m, 15m, 30m, 1h backoff, then drop

---

### FEAT-015 — Session Inactivity Reaper
**Priority:** P0 — Sprint 4
**Description:** Automatically calls `dismiss()` on sessions idle longer than `limits.session_idle_ttl_minutes` (default: 30).
**Effect:** Session transitions to `idle`. Provider state (KV cache or CLI process) is freed.
**Resume:** A subsequent `ask_oracle` on an `idle` session re-spawns provider from MADRs.
**Scope:** Applies to oracle sessions only. Does NOT affect the Worker Thread (`DIE` message handles that).
**Acceptance criteria:**
- [ ] TTL configurable via `limits.session_idle_ttl_minutes`
- [ ] Reaper sends `DIE` only on MCP server shutdown (SIGTERM), NOT for idle sessions
- [ ] Idle session resurrection: MADR-based reconstitution, NOT transcript replay

---

### FEAT-016 — Worker Thread Supervisor (Circuit Breaker)
**Priority:** P0 — Sprint 3
**Description:** The MCP server supervises the Slow Path Worker Thread.
**On crash:** Mark `degraded`, restart with exponential backoff.
**Circuit breaker:** After 3 crashes within 10 minutes, stop auto-restart. Serve Fast Path only. `lcs_investigate` surfaces `[METADATA: SLOW_PATH_DEGRADED]`.
**Recovery:** Manual `pythia_force_index` or process restart.
**Worker message protocol:** Full bipartite protocol (§17.15): `INDEX_BATCH`, `PAUSE`, `RESUME`, `DIE`, `PING` → `ACK`, `BATCH_STARTED`, `BATCH_COMPLETE`, `FILE_FAILED`, `PAUSED`, `HEARTBEAT`, `FATAL`
**Acceptance criteria:**
- [ ] Circuit breaker state is process-local (resets on restart)
- [ ] `pythia_force_index` within same process can clear degraded state if batch succeeds
- [ ] `DIE` = MCP server graceful shutdown only. Worker finishes current file + commits before exit.

---

### FEAT-017 — Context Budget Management
**Priority:** P0 — Sprint 4
**Description:** The MCP server tracks and enforces context budget per turn. The ReasoningProvider receives already-trimmed input.
**Per-ask budget:** MCP server sums preamble + transcript + proposed additionalContext, trims by rank, returns `CONTEXT_BUDGET_EXCEEDED` if still over cap.
**Spawn budget:** 180,000 chars total. MADR preamble: 120,000 chars (newest-first). Bootstrap context: 60,000 chars.
**Ask context cap:** 12 chunks / 48,000 chars.
**Acceptance criteria:**
- [ ] Server-side trimming before provider call
- [ ] `CONTEXT_BUDGET_EXCEEDED` returned as JSON-RPC error, not silent drop

---

### FEAT-018 — Soft-Delete GC
**Priority:** P1 — Sprint 2
**Description:** Chunks marked `is_deleted=1` are retained 30 days then hard-purged.
**GC trigger:** Every boot + after any sync batch where tombstones exceed 10,000 rows or 20% of total chunk count.
**GC transaction:** Hard-delete from `lcs_chunks` + `vec_lcs_chunks` + `fts_lcs_chunks_kw` + `fts_lcs_chunks_sub` in single transaction. Then `PRAGMA incremental_vacuum`.
**`RE_EXPORTS` edges:** Deleted immediately inside sync transaction when source/target soft-deleted. Do not wait for GC.
**Configurable:** `gc.deleted_chunk_retention_days` in config schema.
**Acceptance criteria:**
- [ ] GC runs at boot and after large sync batches
- [ ] Virtual table deletions inside same transaction as `lcs_chunks` hard-delete

---

### FEAT-019 — Progressive Enhancement ($0 vs Premium)
**Priority:** P1 — Sprint 5
**Description:** `VectorStore` and `GraphStore` adapter interfaces route to local (SQLite) or premium (Qdrant/FalkorDB) backends based on config.
**Stack switch:** Full re-embed from `lcs_chunks`. Old backend marked inactive (not dropped). `pythia migrate` CLI orchestrates.
**FalkorDB sidecar:** Python process spawned via `child_process.spawn()`, TCP/HTTP socket, starts/stops with MCP server.
**Acceptance criteria:**
- [ ] `VectorStore` interface hides SQLite vs Qdrant
- [ ] `GraphStore` interface hides SQLite CTEs vs FalkorDB
- [ ] Stack switch does NOT destroy `lcs_chunks` or `pythia_memories`

---

### FEAT-020 — pythia CLI
**Priority:** P0 — Sprint 1/5
**Description:** Command-line interface for bootstrapping and managing Pythia.
**Commands:**
- `pythia init` — creates `.pythia/`, runs migrations, validates config, cold-start index. Does NOT start MCP server.
- `pythia start` — launches MCP server process, runs pending migrations, warm-start background scan
- `pythia mcp install claude-code` — idempotent, previews config changes before applying
- `pythia migrate` — orchestrates stack transitions ($0 ↔ Premium)
**Acceptance criteria:**
- [ ] `pythia init` fully idempotent (existing DB → runs migrations only)
- [ ] `pythia mcp install claude-code` previews to stdout before modifying `~/.claude.json`
- [ ] MCP server starts listening only after `pythia start` (never after `pythia init`)

---

### FEAT-021 — `lcs_global_search` (DEFERRED to v2)
**Priority:** DEFERRED
**Description:** Thematic community search via Leiden algorithm on `lcs_communities` table.
**Reserved v2 signature:** `{ query: string, max_communities?: number }`
**Status:** NOT implemented in v1. NOT registered as a tool. No stub.

---

## Error Code Registry

| Code | Range | Error |
|---|---|---|
| Auth/Config | -32010 to -32019 | `AUTH_INVALID`, `CONFIG_INVALID` |
| Session | -32020 to -32039 | `SESSION_ALREADY_ACTIVE`, `SESSION_BUSY`, `SESSION_NOT_FOUND` |
| Provider/Context | -32040 to -32059 | `PROVIDER_UNAVAILABLE`, `CONTEXT_BUDGET_EXCEEDED` |
| Indexing/Storage | -32060 to -32089 | `INVALID_GRAPH_ENDPOINT`, `INDEX_BATCH_FAILED`, `FULL_REINDEX_REQUIRED`, `INVALID_PATH` |

Non-fatal metadata returned in success body as `[METADATA: CODE]` prefix lines: `OBSIDIAN_DISABLED`, `OBSIDIAN_UNAVAILABLE`, `INDEX_ALREADY_RUNNING`, `CROSS_ENCODER_UNAVAILABLE`, `VECTOR_INDEX_STALE`, `RERANKER_UNAVAILABLE`, `SLOW_PATH_DEGRADED`, `INDEX_EMPTY`, `NO_MATCH`

---

## Out of Scope for v1

- `lcs_global_search` / Leiden community detection
- `oracle_reconstitute` tool (generation epoch is managed by `spawn_oracle` logic)
- `LocalReasoningProvider` (Ollama/LM Studio)
- Homebrew or standalone binary packaging
- Multi-repo shared daemon
- Team/cloud deployment
- Symbol-level `impacts_nodes` in `oracle_commit_decision`
