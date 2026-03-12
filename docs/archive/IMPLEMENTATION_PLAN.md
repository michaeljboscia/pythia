# IMPLEMENTATION_PLAN -- Pythia Oracle Engine

**Status:** Locked. This plan was written once and does not get modified during execution.
**Design Doc:** `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` (v6)
**Date:** 2026-03-08

---

## Overview

Pythia is a generational oracle engine that manages persistent Gemini daemon sessions loaded with a project's full research corpus. It detects context pressure, checkpoints learnings before exhaustion, and reconstitutes across generations -- each version inheriting everything its predecessors learned.

**Where the code goes:**

| Component | Location |
|-----------|----------|
| Type definitions | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-types.ts` |
| MCP tool handlers | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` |
| GeminiRuntime singleton | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/runtime.ts` |
| Gemini tools (refactored) | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/tools.ts` |
| MCP server entry (modified) | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/server.ts` |
| Skill file | `/Users/mikeboscia/pythia/skills/pythia.md` |
| Registry | `/Users/mikeboscia/pythia/registry.json` |
| Post-tool-use hook (modified) | `/Users/mikeboscia/.claude/hooks/post-tool-use.sh` |
| pythia-auth binary | `/Users/mikeboscia/.pythia/bin/pythia-auth` |
| Oracle data (per-project) | `<project-root>/oracle/` (manifest.json, state.json, learnings/, checkpoints/) |

**Dependency chain:** Phase 1 (foundation) feeds Phase 2 (core ops), which feeds Phase 3 (lifecycle). Phase 4 (analysis/corpus mgmt) and Phase 5 (decommission/security) depend on Phase 3. Phase 6 (integration) depends on Phases 4 and 5.

**Total scope:** 13 MCP tools, 1 skill file, 3 new source files, 2 modified source files, 1 hook modification, 1 compiled binary (pythia-auth).

---

## Phase 1: Foundation (Runtime Extraction + Types)

### Step 1.1: GeminiRuntime Singleton (FEAT-014, FEAT-015)

**Files to create:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/runtime.ts`

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/tools.ts` -- remove `_sessions` Map, `_sessionCounter`, `_genSessionId()`, `_sanitizeSessionName()`, `_cleanupSession()`, and all daemon lifecycle logic. Import from `runtime.ts` instead.

**What to implement:**

1. **GeminiRuntime class (singleton):**
   - Private `_sessions: Map<string, GeminiSession>` (moved from `tools.ts`)
   - Private `_sessionCounter: number` (moved from `tools.ts`)
   - `decommissionTokens: Map<string, { token: string; oracle_name: string; expires_at: number }>` -- in-memory only, never persisted
   - `idleSweepInterval: NodeJS.Timeout` -- `setInterval(60_000)` sweeping all oracle pools for idle members. Started on singleton instantiation, cleared on process shutdown.
   - Singleton accessor: `getGeminiRuntime(): GeminiRuntime`

2. **OracleRuntimeBridge interface (exported):**
   - `spawnDaemon(input: { session_name: string; cwd?: string; timeout_ms?: number }): Promise<{ daemon_id: string; resumed: boolean; session_dir?: string }>`
   - `askDaemon(input: { daemon_id: string; question: string; timeout_ms?: number }): Promise<{ text: string; chars_in: number; chars_out: number }>`
   - `dismissDaemon(input: { daemon_id: string; hard?: boolean }): Promise<void>`
   - `getDaemonSessionDir(daemon_id: string): string | null`
   - `findDaemonBySessionName(session_name: string): { daemon_id: string; session_dir: string } | null`

3. **Move helper functions from `tools.ts`:**
   - `_genSessionId()`, `_sanitizeSessionName()`, `_cleanupSession()`
   - `makeProgressLogger()` (or keep in tools.ts with a re-export)
   - `executeWithFallback()`, `spawnWithFallback()` -- daemon-lifecycle-related model-fallback wrappers

4. **Update `askDaemon` return type:**
   - Current: returns `{ text: string }`
   - New: returns `{ text: string; chars_in: number; chars_out: number }`
   - `chars_in` = length of question string sent to daemon
   - `chars_out` = length of text response received
   - This enables `oracle-tools.ts` to update pressure metrics without re-counting

5. **Process shutdown hook:**
   - `process.on("SIGTERM", ...)` / `process.on("SIGINT", ...)` to clear `idleSweepInterval`

**Tests:**
- [ ] Existing `spawn_daemon`, `ask_daemon`, `dismiss_daemon`, `list_daemons` MCP tools still work identically after refactor (behavioral parity)
- [ ] `findDaemonBySessionName("daemon-test-0")` returns correct daemon when session exists
- [ ] `findDaemonBySessionName("nonexistent")` returns `null`
- [ ] `askDaemon` response includes `chars_in` and `chars_out` with correct values
- [ ] `getGeminiRuntime()` returns the same instance on repeated calls (singleton guarantee)
- [ ] `decommissionTokens` Map is accessible and starts empty
- [ ] `idleSweepInterval` is running after singleton instantiation
- [ ] MCP server starts and connects without errors after refactor

**Features:** FEAT-014, FEAT-015

---

### Step 1.2: Type Definitions (FEAT-016)

**Files to create:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-types.ts`

**What to implement:**

All types from the design doc Section "Concrete TypeScript Types":

1. **Status and role types:**
   - `OracleStatus` -- `"healthy" | "degraded" | "warning" | "critical" | "emergency" | "error" | "quota_exhausted" | "decommissioned"`
   - `OracleRecommendation` -- `"healthy" | "checkpoint_soon" | "checkpoint_now" | "reconstitute"`
   - `CorpusRole` -- `"core_research" | "prompt_architecture" | "pain_signals" | "learnings" | "checkpoint" | "other"`
   - `SyncMode` -- `"manual" | "on_spawn" | "interval"`
   - `ReconstituteSyncMode` -- `"hash_gated_delta" | "full_rescan"`
   - `InteractionType` -- `"consultation" | "feedback" | "sync_event" | "session_note"`
   - `InteractionScope` -- `"architectural" | "operational" | "other"`

2. **Data structures:**
   - `DaemonPoolMember` -- with all fields: `daemon_id`, `session_name`, `session_dir`, `status`, `query_count`, `chars_in`, `chars_out`, `last_synced_interaction_id`, `last_query_at`, `idle_timeout_ms`, `last_corpus_sync_hash`, `pending_syncs`
   - `StaticEntry` -- `path`, `role`, `required`, `sha256`, `added_at`, `priority`
   - `LiveSource` -- `id`, `root`, `include`, `exclude`, `role`, `required`, `sync_mode`, `interval_seconds`, `max_files`, `max_sync_bytes`, `reconstitute_sync_mode`, `priority`, `last_sync_at`, `last_tree_hash`, `last_file_hashes`
   - `OracleManifest` -- `schema_version`, `name`, `project`, `version`, `checkpoint_headroom_tokens`, `pool_size`, `static_entries`, `live_sources`, `load_order`, `created_at`, `last_spawned_at`
   - `OracleState` -- `schema_version`, `oracle_name`, `version`, `spawned_at`, `discovered_context_window`, `daemon_pool`, `session_chars_at_spawn`, `chars_per_token_estimate`, `estimated_total_tokens`, `estimated_cluster_tokens`, `tokens_remaining`, `query_count`, `last_checkpoint_path`, `status`, `lock_held_by`, `lock_expires_at`, `last_error`, `last_bootstrap_ack`, `state_version`, `updated_at`
   - `OracleRegistryEntry` -- `name`, `oracle_dir`, `project_root`, `created_at`, `decommissioned_at`
   - `InteractionEntry` -- all fields including optional Ion handoff fields
   - `IonHandoffRequest` -- `oracle_name`, `version`, `query_id`, `question`, `context_paths`, `timeout_ms`
   - `IonHandoffResponse` -- `query_id`, `success`, `response`, `files_touched`, `commit_sha`, `error`, `duration_ms`

3. **Quality and degradation:**
   - `DegradationFlag` -- `type`, `query_id`, `tokens_remaining`, `description`
   - `QualityReport` -- all fields including early/late metrics, suggested headroom, flags array

4. **Result envelope:**
   - `OracleResult<T>` -- discriminated union: `{ ok: true; data: T; warnings?: string[] } | { ok: false; error: { code: OracleErrorCode; message: string; retryable: boolean; details?: unknown } }`
   - `OracleErrorCode` -- full union of all error codes from design doc (25 codes total)

5. **Constants:**
   - `DEFAULT_CHARS_PER_TOKEN_ESTIMATE = 4`
   - `MAX_BOOTSTRAP_STDIN_BYTES = 6_000_000`
   - `MAX_INHERITED_WISDOM_INLINE_CHARS = 180_000`
   - `DEFAULT_CHECKPOINT_HEADROOM_TOKENS = 250_000`
   - `DEFAULT_POOL_SIZE = 2`
   - `DEFAULT_IDLE_TIMEOUT_MS = 300_000`
   - `DEFAULT_MAX_SYNC_BYTES = 5_000_000`
   - `CONTEXT_WINDOW_BY_MODEL: Record<string, number>` -- hardcoded lookup table

**Tests:**
- [ ] All types compile without errors (`tsc --noEmit`)
- [ ] No circular dependency between `oracle-types.ts`, `runtime.ts`, and `oracle-tools.ts`
- [ ] Constants are exported and accessible from `oracle-tools.ts`
- [ ] `OracleResult<T>` discriminated union works correctly with type narrowing

**Features:** FEAT-016

---

### Step 1.3: Registry + State Management (FEAT-017, FEAT-018)

**Files to create/modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- create file; initial content is registry/state utility functions

**What to implement:**

1. **Registry management (`/Users/mikeboscia/pythia/registry.json`):**
   - `readRegistry(): Promise<OracleRegistry>` -- reads and parses `registry.json`
   - `registerOracle(entry: OracleRegistryEntry): Promise<void>` -- adds entry, enforces name uniqueness among non-decommissioned oracles, atomic write (temp + rename)
   - `lookupOracle(name: string): Promise<OracleRegistryEntry | null>` -- returns entry or null
   - `updateRegistryEntry(name: string, patch: Partial<OracleRegistryEntry>): Promise<void>` -- for decommission timestamp, etc.
   - Registry path: `REGISTRY_PATH = "/Users/mikeboscia/pythia/registry.json"` (configurable via env var)

2. **State management (`<oracle_dir>/state.json`):**
   - `readState(oracleDir: string): Promise<OracleState>` -- reads and validates
   - `writeStateWithRetry(oracleDir: string, mutator: (s: OracleState) => OracleState, opts?: { maxRetries?: number; baseBackoffMs?: number; jitterMs?: number }): Promise<OracleState>` -- optimistic concurrency control:
     - Read current state from disk
     - Apply mutator function
     - Check `state_version` matches what was read
     - If version changed (concurrent write): wait `baseBackoffMs * 2^attempt + random(jitterMs)`, re-read, re-apply mutator, retry
     - After `maxRetries` (default: 5) exhausted: throw `CONCURRENCY_CONFLICT`
     - All writes use temp file + rename pattern (atomic)
   - `initState(oracleDir: string, oracleName: string): Promise<OracleState>` -- creates initial state.json for v1

3. **Operation locking:**
   - `acquireOperationLock(oracleDir: string, operation: string, opts?: { waitTimeoutMs?: number; lockTtlMs?: number }): Promise<{ lockToken: string }>` -- uses CAS via `writeStateWithRetry`. Polls every 500ms up to `waitTimeoutMs` (default: 30s). Returns `DAEMON_BUSY_LOCK` if lock held and timeout exceeded. Lock TTL (default: 600_000 = 10min) prevents orphans on crash.
   - `releaseLock(oracleDir: string, lockToken: string): Promise<void>` -- clears `lock_held_by` and `lock_expires_at` only if lockToken matches
   - `startLockHeartbeat(opts: { oracleDir: string; operation: string; lockToken: string; extendEveryMs?: number; ttlMs?: number }): { stop: () => Promise<void> }` -- extends `lock_expires_at` every `extendEveryMs` (default: 60_000) to prevent expiry during long operations. Returns a handle with `stop()` to clean up the interval.

4. **Manifest management:**
   - `readManifest(oracleDir: string): Promise<OracleManifest>` -- reads and validates schema_version
   - `writeManifest(oracleDir: string, manifest: OracleManifest): Promise<void>` -- atomic write (temp + rename)

5. **Atomic file write utility:**
   - `atomicWriteFile(filePath: string, content: string): Promise<void>` -- writes to temp file in same directory, then `rename()`. Ensures no partial writes corrupt state.

**Tests:**
- [ ] `registerOracle()` writes entry to registry and can be read back by `lookupOracle()`
- [ ] `registerOracle()` rejects duplicate name among non-decommissioned entries
- [ ] `registerOracle()` allows reuse of a decommissioned oracle name
- [ ] `writeStateWithRetry()` succeeds on first attempt when no concurrent writes
- [ ] `writeStateWithRetry()` retries and succeeds when concurrent write detected (simulate by modifying `state_version` between read and write)
- [ ] `writeStateWithRetry()` throws `CONCURRENCY_CONFLICT` after `maxRetries` exhausted
- [ ] `acquireOperationLock()` succeeds on unlocked state
- [ ] `acquireOperationLock()` blocks and retries when lock is held by another operation
- [ ] `acquireOperationLock()` returns `DAEMON_BUSY_LOCK` after `waitTimeoutMs` exceeded
- [ ] Lock TTL expiration allows re-acquisition by competing operation
- [ ] `startLockHeartbeat()` extends `lock_expires_at` at the configured interval
- [ ] `releaseLock()` only clears lock if lockToken matches (no silent misrelease)
- [ ] `atomicWriteFile()` does not leave partial content on crash (verified by checking temp file cleanup)
- [ ] `readManifest()` throws `MANIFEST_INVALID` on malformed JSON

**Features:** FEAT-017, FEAT-018

---

## Phase 2: Core Oracle Operations

### Step 2.1: Corpus Loading Pipeline (FEAT-019)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add corpus resolution and loading functions

**What to implement:**

1. **`resolveCorpusForSpawn(name: string): Promise<ResolvedCorpus>`** (Pass 1 -- before daemon exists):
   - Reads manifest via `readManifest()`
   - For each `static_entry`:
     - Read file from disk
     - Compute sha256 hash
     - If hash does not match manifest `sha256`: throw `HASH_MISMATCH` with file path and expected vs actual hash
     - If file does not exist: throw `FILE_NOT_FOUND`
   - For each `live_source`:
     - Resolve globs against `root` directory (respecting `include` and `exclude`)
     - Enforce `max_files` cap
     - Read all resolved files
     - Enforce `max_sync_bytes` cap on total bytes
     - Compute per-file hashes and tree hash (sorted hash of all file hashes)
   - Sort entries by `load_order` role priority, then by `priority ASC, added_at ASC, path ASC` within each role group
   - Estimate total tokens: `totalChars / chars_per_token_estimate`
   - Token gate: if `estimatedTokens > (discoveredContextWindow - manifest.checkpoint_headroom_tokens)`, throw `CORPUS_CAP_EXCEEDED`
   - Stdin byte gate: if `totalBytes > MAX_BOOTSTRAP_STDIN_BYTES (6_000_000)`, throw `CORPUS_CAP_EXCEEDED`
   - Returns `ResolvedCorpus` object: sorted text payloads ready to inject, total chars, total bytes, file count, tree hashes per live_source

2. **`loadResolvedCorpusIntoDaemon(daemonId: string, resolvedCorpus: ResolvedCorpus, runtime: OracleRuntimeBridge): Promise<LoadResult>`** (Pass 2 -- after daemon spawned):
   - Iterates through resolved corpus entries in load order
   - For each entry: calls `runtime.askDaemon()` with the file content as the question, prefixed with injection markers (e.g., `"[Corpus file: <path>]\n<content>"`)
   - Uses `stream.write()` with drain handlers for large payloads (prevents backpressure failure on 5MB+ payloads)
   - After all entries: sends final "corpus loaded" acknowledgment prompt
   - Validates bootstrap ack via `validateBootstrapAck(text)`: checks Pythia's response for confusion signals (short response containing error/cannot/fail keywords). If validation fails: sets `status = "error"`, `last_bootstrap_ack.ok = false`, returns `BOOTSTRAP_FAILED`
   - Records `session_chars_at_spawn` = total chars of concatenated bootstrap payload

3. **`discoverContextWindow(modelName: string): number`:**
   - Hardcoded lookup from `CONTEXT_WINDOW_BY_MODEL` constant in `oracle-types.ts`
   - Unknown model: returns 2,000,000 (conservative fallback)

4. **`buildSpawnPreamble(opts: { oracleName: string; project: string; nextVersion: number; inheritedWisdom?: string | null }): string`:**
   - If `inheritedWisdom === null` or `undefined`: v1 first-generation preamble
   - If `inheritedWisdom` length <= `MAX_INHERITED_WISDOM_INLINE_CHARS (180_000)`: full inline embedding inside `<inherited_wisdom>` tags
   - If `inheritedWisdom` exceeds threshold: brief lineage summary in preamble, full checkpoint loaded as first static chunk in Pass 2

5. **`validateBootstrapAck(text: string): boolean`:**
   - Returns `false` if response is short (< 100 chars) and contains confusion markers: "error", "cannot", "fail", "unable", "don't understand"
   - Returns `true` otherwise (Pythia acknowledged successfully)

6. **`computeTreeHash(fileHashes: Record<string, string>): string`:**
   - Sort file paths alphabetically
   - Concatenate all `path:hash` pairs
   - Return sha256 of the concatenated string

**Tests:**
- [ ] `resolveCorpusForSpawn()` throws `HASH_MISMATCH` when a static entry file has been modified since manifest creation
- [ ] `resolveCorpusForSpawn()` throws `FILE_NOT_FOUND` when a static entry file is missing
- [ ] `resolveCorpusForSpawn()` throws `CORPUS_CAP_EXCEEDED` when total estimated tokens exceed `context_window - headroom`
- [ ] `resolveCorpusForSpawn()` throws `CORPUS_CAP_EXCEEDED` when total bytes exceed `MAX_BOOTSTRAP_STDIN_BYTES`
- [ ] `resolveCorpusForSpawn()` enforces `max_files` per live_source
- [ ] `resolveCorpusForSpawn()` enforces `max_sync_bytes` per live_source
- [ ] Resolved entries are sorted correctly: by role order from `load_order`, then `priority ASC, added_at ASC, path ASC`
- [ ] `loadResolvedCorpusIntoDaemon()` sends all corpus content to the daemon
- [ ] `validateBootstrapAck()` returns `false` on short confused responses
- [ ] `validateBootstrapAck()` returns `true` on normal ack responses
- [ ] `buildSpawnPreamble()` generates v1 preamble when `inheritedWisdom` is null
- [ ] `buildSpawnPreamble()` embeds checkpoint inline when under 180K chars
- [ ] `buildSpawnPreamble()` uses brief summary when checkpoint exceeds 180K chars
- [ ] `computeTreeHash()` produces deterministic output for same set of files regardless of insertion order

**Features:** FEAT-019

---

### Step 2.2: spawn_oracle (FEAT-001)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `spawn_oracle` handler
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/server.ts` -- register oracle tools

**What to implement:**

1. **MCP tool `spawn_oracle` with parameters:**
   - `name: string` (required) -- oracle name, must match registry entry
   - `reuse_existing?: boolean` (default: `true`) -- resume existing session if found
   - `force_reload?: boolean` (default: `false`) -- re-send corpus to live session
   - `force?: boolean` (default: `false`) -- reserved for future use
   - `timeout_ms?: number` (default: 300_000)

2. **Parameter matrix (6 combinations):**

   | `reuse_existing` | `force_reload` | Session exists? | Behavior |
   |---|---|---|---|
   | `true` (default) | `false` (default) | Yes | Resume -- zero cost, full history |
   | `true` | `true` | Yes | Re-send full corpus to live session (no version increment) |
   | `false` | `false` | Yes | `ORACLE_ALREADY_EXISTS` -- explicit intent required |
   | `false` | `false` | No | Fresh spawn + full bootstrap |
   | `false` | `true` | Yes | `ORACLE_ALREADY_EXISTS` -- run `oracle_decommission_request` + `oracle_decommission_execute` first |
   | `false` | `true` | No | Fresh spawn + full bootstrap |

3. **Fresh spawn flow:**
   - Look up oracle in registry via `lookupOracle(name)`
   - Read manifest from `oracle_dir`
   - Pass 1: `resolveCorpusForSpawn(name)` -- hash verification, glob resolution, token gate
   - Discover context window from `discoverContextWindow()` using current Gemini model
   - Build preamble via `buildSpawnPreamble()` (v1 or reconstitution depending on checkpoint existence)
   - Spawn one pool member via `runtime.spawnDaemon({ session_name: "daemon-<name>-0", cwd: project_root })`
   - Pass 2: `loadResolvedCorpusIntoDaemon()` -- stream corpus into daemon
   - Write `state.json` via `initState()` with version=1, session_chars_at_spawn, discovered_context_window
   - Create `.pythia-active/<oracle-name>.json` marker file (atomic write via temp+rename)
   - Return: `{ oracle_name, version, pool: [member_info], resumed: false, corpus_files_loaded, tokens_remaining }`

4. **Resume flow (reuse_existing=true, session exists):**
   - Find daemon by session name via `runtime.findDaemonBySessionName()`
   - If found: return immediately with current state
   - If not found (daemon died): re-spawn with full bootstrap from latest checkpoint

5. **Force reload flow (reuse_existing=true, force_reload=true):**
   - Resolve corpus, re-send to live daemon via Pass 2 only
   - Update `session_chars_at_spawn` in state

6. **`.pythia-active/` marker file:**
   - Directory: `<project_root>/.pythia-active/`
   - File: `<oracle-name>.json` containing `{ oracle_name, oracle_dir, project_root, pool_members_active, written_at }`
   - Created on spawn, removed on decommission

**Tests:**
- [ ] Fresh spawn creates `state.json` with correct version, context window, and session chars
- [ ] Fresh spawn creates registry entry via `registerOracle()`
- [ ] Fresh spawn creates `.pythia-active/<name>.json` marker file
- [ ] Resume with `reuse_existing=true` returns immediately when session exists (no re-bootstrap)
- [ ] Resume re-spawns when session exists in state but daemon is dead
- [ ] `force_reload=true` re-sends corpus to live session without version increment
- [ ] `reuse_existing=false` with existing session returns `ORACLE_ALREADY_EXISTS`
- [ ] `ORACLE_NOT_FOUND` when oracle name not in registry and no manifest exists
- [ ] Spawn initializes pool with exactly 1 member (spawn-on-demand)
- [ ] Pool member has correct `session_name` format: `"daemon-<name>-0"`

**Features:** FEAT-001, FEAT-024

---

### Step 2.3: oracle_sync_corpus (FEAT-002, FEAT-021)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `oracle_sync_corpus` handler

**What to implement:**

1. **MCP tool `oracle_sync_corpus` with parameters:**
   - `name: string` (required)
   - `source_id?: string` -- specific live_source to sync; if omitted, sync all

2. **Sync logic:**
   - Read manifest; resolve glob for target live_source(s)
   - Enforce `max_files` and `max_sync_bytes` caps -- hard error if exceeded
   - Compute tree hash for each source
   - If tree hash unchanged since `last_tree_hash`: skip (no-op return)
   - If tree hash changed: compute per-file hashes, determine delta (new/changed/deleted files)

3. **Per-member dispatch:**
   - Members with `status === "idle"`: inject sync payload immediately via `runtime.askDaemon()` with message: `"[Updated source files for <source_id>. Read and absorb:]\n<content>"`
   - Members with `status === "busy"`: push to `pending_syncs` array: `{ source_id, tree_hash, payload_ref, queued_at }`. Payload is stored as temp file or in-memory string.
   - Members with `status === "dismissed"` or `"dead"`: skip -- they get current corpus on next spawn
   - Update synced members' `last_corpus_sync_hash[source_id]` and clear matching `pending_syncs` entries

4. **ask_daemon pending sync drain (modification to query routing):**
   - Before routing any query to a pool member, check its `pending_syncs` array
   - If non-empty: pop all entries, concatenate payloads, inject as single "Updated source files..." message, then send user's query
   - Update `last_corpus_sync_hash` for each drained source_id

5. **Manifest updates:**
   - Update `last_sync_at` and `last_tree_hash` (and `last_file_hashes`) on the synced `LiveSource` entry

6. **Return:** `{ source_id, files_synced, files_skipped, bytes_loaded, tree_hash, members_synced_immediately, members_queued }`

**Tests:**
- [ ] No-op when tree hash unchanged (returns `files_synced: 0`)
- [ ] Idle members receive immediate sync injection
- [ ] Busy members get `pending_syncs` entries queued
- [ ] Dismissed and dead members are skipped (no error, no injection)
- [ ] `pending_syncs` drain happens before query routing in `ask_daemon`
- [ ] `max_files` cap throws error when exceeded
- [ ] `max_sync_bytes` cap throws error when exceeded
- [ ] `last_sync_at` and `last_tree_hash` updated in manifest after sync
- [ ] Partial source sync (specific `source_id`) only processes the named source
- [ ] Cross-daemon sync context injection format matches design doc specification

**Features:** FEAT-002, FEAT-021

---

### Step 2.4: oracle_pressure_check (FEAT-003, FEAT-020)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `oracle_pressure_check` handler

**What to implement:**

1. **MCP tool `oracle_pressure_check` with parameters:**
   - `name: string` (required)

2. **Pressure computation:**
   - Read `state.json`
   - Filter active members: `status !== "dismissed" && status !== "dead"`
   - If no active members: return `PRESSURE_UNAVAILABLE` (no daemons running)
   - Per-member token estimate: `(session_chars_at_spawn + member.chars_in + member.chars_out) / chars_per_token_estimate`
   - `estimated_total_tokens = Math.max(...memberTokens)` (MAX drives checkpoint decision)
   - `estimated_cluster_tokens = memberTokens.reduce((a, b) => a + b, 0)` (SUM for observability)
   - `tokens_remaining = discovered_context_window - estimated_total_tokens`

3. **Status transitions (absolute headroom model):**

   | Tokens Remaining | Status | Recommendation |
   |---|---|---|
   | > `checkpoint_headroom_tokens` | `"healthy"` | `"healthy"` |
   | `headroom/2` -- `headroom` | `"warning"` | `"checkpoint_soon"` |
   | < `headroom/2` | `"critical"` | `"checkpoint_now"` |
   | After checkpoint complete | -- | `"reconstitute"` |

4. **State update:**
   - Write updated `estimated_total_tokens`, `estimated_cluster_tokens`, `tokens_remaining`, `status` to state via `writeStateWithRetry()`

5. **Return:** `{ tokens_remaining, estimated_total_tokens, estimated_cluster_tokens, status, recommendation, pool_member_count, highest_pressure_member }`

**Tests:**
- [ ] Returns `PRESSURE_UNAVAILABLE` when daemon pool is empty (all dismissed/dead)
- [ ] Returns `"healthy"` status when `tokens_remaining > headroom`
- [ ] Transitions to `"warning"` when `tokens_remaining` between `headroom/2` and `headroom`
- [ ] Transitions to `"critical"` when `tokens_remaining < headroom/2`
- [ ] `estimated_total_tokens` uses MAX aggregation (not SUM)
- [ ] `estimated_cluster_tokens` uses SUM aggregation
- [ ] State is updated on disk after each pressure check
- [ ] Recommendation values match the status transitions exactly
- [ ] Returns correct `highest_pressure_member` session_name

**Features:** FEAT-003, FEAT-020

---

## Phase 3: Lifecycle Management

### Step 3.1: oracle_log_learning (FEAT-005, FEAT-023)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `oracle_log_learning` handler and batched commit logic

**What to implement:**

1. **MCP tool `oracle_log_learning` with parameters:**
   - `name: string` (required)
   - `question: string` (required for consultations)
   - `counsel: string` (Pythia's response)
   - `decision?: string | null`
   - `type?: InteractionType` (default: `"consultation"`)
   - `interaction_scope?: InteractionScope`
   - `quality_signal?: 1 | 2 | 3 | 4 | 5 | null`
   - `ion_delegated?: boolean` (default: `false`)
   - `ion_query?: string` (required if `ion_delegated=true`)
   - `ion_response?: string` (required if `ion_delegated=true`)
   - `references?: string` (for feedback type)
   - `implemented?: boolean` (for feedback type)
   - `outcome?: string` (for feedback type)
   - `divergence?: string` (for feedback type)
   - `force?: boolean` (force immediate git commit)

2. **Entry construction:**
   - Generate ID: `"v<version>-q<NNN>"` for consultations, `"v<version>-q<NNN>-fb"` for feedback
   - Populate all `InteractionEntry` fields including timestamp, `tokens_remaining_at_query`, `chars_in_at_query`
   - Append as JSONL (one JSON object per line) to `<oracle_dir>/learnings/v<N>-interactions.jsonl`

3. **Validation:**
   - If `ion_delegated === true`: require non-empty `ion_query` and `ion_response`. Reject with descriptive error if missing.
   - Validate `type` is a valid `InteractionType`

4. **Batched git commits via `batchCommitLearnings()`:**
   - JSONL write to disk is immediate (data safe on disk)
   - Git commit is deferred until any flush trigger fires:
     - Pending entries >= 10
     - Pending bytes >= 256KB
     - 30-second debounce timer
     - Explicit `force: true` parameter
     - Process shutdown hook
   - Track pending count and bytes in module-level state
   - On flush: `git add <interactions_file> && git commit -m "oracle(<name>): log N interactions"`

5. **State update:**
   - Increment `query_count` in `state.json` via `writeStateWithRetry()`

6. **Return:** `{ entry_id, file_path, version, committed: boolean }`

**Tests:**
- [ ] Appends valid JSONL entry to correct file path: `<oracle_dir>/learnings/v<N>-interactions.jsonl`
- [ ] Generated ID follows format: `"v1-q001"`, `"v1-q002"`, etc.
- [ ] Feedback entries get `-fb` suffix: `"v1-q003-fb"`
- [ ] Validates `ion_delegated=true` requires non-empty `ion_query` and `ion_response`
- [ ] Rejects `ion_delegated=true` with empty `ion_query`
- [ ] JSONL is valid (each line parses as independent JSON)
- [ ] Batch commit triggers at 10 pending entries
- [ ] Batch commit triggers at 256KB pending bytes
- [ ] Batch commit triggers at 30-second timer
- [ ] `force: true` triggers immediate commit
- [ ] `query_count` increments correctly in state

**Features:** FEAT-005, FEAT-023

---

### Step 3.2: oracle_checkpoint (FEAT-004)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `oracle_checkpoint` handler

**What to implement:**

1. **MCP tool `oracle_checkpoint` with parameters:**
   - `name: string` (required)
   - `timeout_ms?: number` (default: 600_000 -- checkpoints can take 2-3 minutes on large corpora)
   - `commit?: boolean` (default: `true`)

2. **Pre-conditions:**
   - Acquire operation lock via `acquireOperationLock(oracleDir, "checkpoint")`. Return `DAEMON_BUSY_LOCK` if lock held.
   - Start lock heartbeat via `startLockHeartbeat()` (extend every 60s, TTL 10min)
   - Read state; verify `tokens_remaining >= checkpoint_headroom_tokens / 4`. If too late: release lock, return `CHECKPOINT_FAILED` with message "Too late for checkpoint -- use oracle_salvage instead"
   - If no active daemon in pool: release lock, return `DAEMON_NOT_FOUND`

3. **Checkpoint execution:**
   - Send checkpoint prompt to Pythia via `runtime.askDaemon()`:
     ```
     Write your checkpoint inside <checkpoint> tags. Cover:
     (1) All static corpus files loaded and key findings from each.
         DO NOT summarize source code -- summarize the architectural decisions
         and constraints that the code expresses.
     (2) Every question asked this session and your answer summary
     (3) Every architectural/strategic decision made based on your counsel
     (4) Your top 10 cross-cutting insights from the full corpus
     (5) Gaps, contradictions, or uncertainties detected
     Be exhaustive -- this is your legacy for your successor.
     ```
   - Extract content between `<checkpoint>` and `</checkpoint>` tags from response
   - If tags not found: attempt to use full response as checkpoint content (log warning)

4. **Checkpoint persistence:**
   - Save to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
   - Compute sha256 of checkpoint content
   - Add checkpoint to manifest `static_entries` with `role: "checkpoint"`, `required: true`
   - Update `last_checkpoint_path` in state

5. **Git commit (if `commit: true`):**
   - `git add` checkpoint file and manifest
   - `git commit -m "oracle(<name>): v<N> checkpoint (<query_count> consultations)"`

6. **Cleanup:**
   - Stop lock heartbeat
   - Release lock

7. **Error handling:**
   - If Gemini returns context-limit error: set `status = "error"`, `last_error`, write state, return `CHECKPOINT_FAILED`, instruct user to run `oracle_salvage`

8. **Return:** `{ checkpoint_path, bytes, sha256, version }`

**Tests:**
- [ ] Lock prevents concurrent checkpoint operations
- [ ] Rejects with `CHECKPOINT_FAILED` when `tokens_remaining < headroom/4` (too late)
- [ ] Rejects with `DAEMON_NOT_FOUND` when no active daemon in pool
- [ ] Extracts `<checkpoint>` tags correctly from response
- [ ] Cascading extraction (decision #46): tries `<checkpoint>` tags → scrubs LLM wrapper patterns → uses full response with warning
- [ ] Saves checkpoint to correct path: `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
- [ ] Adds checkpoint entry to manifest `static_entries` with `role: "checkpoint"`
- [ ] Updates `last_checkpoint_path` in state
- [ ] Git commits checkpoint and manifest when `commit: true`
- [ ] Sets `status: "error"` and returns `CHECKPOINT_FAILED` on Gemini context-limit error
- [ ] Lock heartbeat extends TTL during long checkpoint operations
- [ ] Lock is released in `finally` block even on error

**Features:** FEAT-004

---

### Step 3.3: oracle_reconstitute (FEAT-009)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `oracle_reconstitute` handler

**What to implement:**

1. **MCP tool `oracle_reconstitute` with parameters:**
   - `name: string` (required)
   - `checkpoint_first?: boolean` (default: `true`)
   - `dismiss_old?: boolean` (default: `true`)

2. **Full cutover model (atomic generation transition):**

   a. **Lock acquisition:**
   - Acquire operation lock for `"reconstitute"`. Return `DAEMON_BUSY_LOCK` if held.
   - Start lock heartbeat.

   b. **Query gate + drain phase (decision #45):**
   - Set oracle status to `ORACLE_PRESERVING` — reject new queries with "Pythia is checkpointing, try again after reconstitution"
   - Wait for all in-flight queries to complete (no new queries accepted = drain bounded by longest in-flight query)
   - Safety valve: 5-minute hard backstop. If exceeded: release lock, return `RECONSTITUTE_FAILED`. Never force-proceed.

   c. **Checkpoint phase with cascading fallback (if `checkpoint_first: true`, decision #44):**
   - Call `oracle_checkpoint` internally (daemons still alive with full context)
   - If checkpoint fails: auto-fallback to `oracle_salvage` (fresh API call reads `vN-interactions.jsonl`, synthesizes checkpoint)
   - If salvage succeeds: continue reconstitution using salvage-derived checkpoint
   - If salvage also fails: hard-fail, abort reconstitution entirely (release lock, return `RECONSTITUTE_FAILED`, v(N) stays alive)

   d. **Shrink to zero:**
   - Soft-dismiss ALL pool members via `runtime.dismissDaemon({ hard: false })` (preserve session data on disk)
   - Clear `daemon_pool` in state

   e. **Version increment:**
   - Read current version N from state
   - Set version = N + 1
   - Manifest update: ensure `vN-checkpoint.md` is in `static_entries` with `role: "checkpoint"`
   - Do NOT add `vN-interactions.jsonl` -- checkpoint supersedes learnings for context

   f. **Live source sync:**
   - For each `live_source`: use `reconstitute_sync_mode` (default: `hash_gated_delta`)
   - `hash_gated_delta`: re-sync only if tree hash changed since last sync
   - `full_rescan`: re-send entire snapshot regardless

   g. **Spawn v(N+1):**
   - Build preamble with `inheritedWisdom` extracted from `vN-checkpoint.md` content (embedded in `<inherited_wisdom>` tags)
   - Spawn one fresh member with session name `"daemon-<name>-0"` (not resuming old sessions)
   - Load corpus via full two-pass pipeline
   - Spawn-on-demand applies: additional members spawn when concurrent access is needed

   h. **State finalization:**
   - Write new state with version N+1, fresh `daemon_pool`, reset `query_count`, `session_chars_at_spawn`, etc.
   - Release lock

3. **Return:** `{ previous_version, new_version, new_daemon_id, checkpoint_path, loaded_artifacts: { static_files, live_source_files, total_chars } }`

**Tests:**
- [ ] Lock prevents concurrent reconstitution
- [ ] Drain phase waits for busy members to complete queries
- [ ] Query gate rejects new queries during reconstitution (ORACLE_PRESERVING, decision #45)
- [ ] Drain waits for in-flight queries without artificial timeout; 5-min safety valve fails fast
- [ ] Checkpoint is taken before dismiss when `checkpoint_first: true`; auto-fallback to salvage on failure (decision #44)
- [ ] All pool members are soft-dismissed (not hard-dismissed)
- [ ] Version increments correctly: N -> N+1
- [ ] v(N+1) preamble includes `<inherited_wisdom>` with checkpoint content
- [ ] `vN-interactions.jsonl` is NOT re-loaded as corpus (checkpoint supersedes)
- [ ] `vN-checkpoint.md` IS in manifest `static_entries` with `role: "checkpoint"`
- [ ] New member gets fresh session name (not resuming old session)
- [ ] `hash_gated_delta` only re-syncs changed live_sources
- [ ] `full_rescan` re-sends all live_source content regardless of hash
- [ ] State reset: `query_count` = 0, `estimated_total_tokens` recalculated from bootstrap only
- [ ] Lock released in `finally` even on error

**Features:** FEAT-009

---

### Step 3.4: oracle_salvage (FEAT-008)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `oracle_salvage` handler

**What to implement:**

1. **MCP tool `oracle_salvage` with parameters:**
   - `name: string` (required)

2. **Salvage logic:**
   - Read `vN-interactions.jsonl` from `<oracle_dir>/learnings/`
   - **If log is non-empty:**
     - Use a fresh single-shot Gemini call (NOT the oracle daemon -- it may be dead) via `executeWithFallback()`
     - Prompt: provide the full interactions log and ask Gemini to synthesize a checkpoint from it, covering all decisions, insights, and architectural reasoning
     - Save synthesized checkpoint to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
   - **If log is empty (zero interactions):**
     - Check if `v(N-1)-checkpoint.md` exists
     - If yes: generate stub checkpoint carrying forward v(N-1) insights: "No new architectural decisions were recorded during Generation N. All wisdom from Generation N-1 remains current."
     - If no prior checkpoint: generate minimal stub: "Generation N had no consultations and no prior checkpoint to inherit."
   - Add checkpoint to manifest `static_entries`

3. **Return:** `{ checkpoint_path, source: "salvage", entries_processed }`

**Tests:**
- [ ] Synthesizes checkpoint from non-empty interactions log via fresh Gemini call
- [ ] Uses `executeWithFallback()` (not oracle daemon) for synthesis
- [ ] Generates stub checkpoint when interactions log is empty
- [ ] Stub carries forward v(N-1) insights when prior checkpoint exists
- [ ] Stub handles no-prior-checkpoint case gracefully
- [ ] Saves to correct path: `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
- [ ] Adds checkpoint to manifest `static_entries`

**Features:** FEAT-008

---

## Phase 4: Analysis + Corpus Management

### Step 4.1: oracle_quality_report (FEAT-010)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add `oracle_quality_report` handler

**What to implement:**

1. **MCP tool `oracle_quality_report` with parameters:**
   - `name: string` (required)
   - `version?: number` (default: current version from state)

2. **Metrics computation from `vN-interactions.jsonl`:**

   a. **Answer length trend:**
   - Split interactions into early half and late half
   - Compute `avg_answer_length_early` and `avg_answer_length_late`
   - Compute `length_trend_pct_change = (late - early) / early * 100`
   - Decreasing length = potential degradation signal

   b. **Code-Symbol Density Ratio:**
   - For each interaction's `counsel` field: count code-like tokens (camelCase identifiers, snake_case, file paths, proper nouns containing dots/slashes) vs. total words
   - `code_symbol_density_early` and `code_symbol_density_late` = ratio of code tokens to total words
   - Decreasing density = generic platitudes replacing specific codebase references

   c. **Degradation onset detection:**
   - Identify the first query where both length and density drop below a threshold (configurable)
   - Record `degradation_onset_query` ID and `degradation_onset_tokens_remaining` at that point

   d. **Suggested headroom computation via `computeSuggestedHeadroom()`:**
   - v1 oracle with no degradation flags: return `manifest.checkpoint_headroom_tokens` (250K default)
   - v2+ with degradation history across versions: `clamp(P50(onset_tokens_across_versions) + 50_000, 100_000, discovered_context_window * 0.5)`

   e. **Flags array:**
   - Auto-detect `"length_drop"` and `"vagueness"` flags
   - `"self_contradiction"` detection: v2 only -- stub in v1, accept manual entries via `flags` array on `InteractionEntry`
   - `"hallucination"` detection: v2 only -- same stub approach

3. **Return:** `QualityReport` object with all computed fields

**Tests:**
- [ ] Computes average answer length correctly for early and late halves
- [ ] Computes `length_trend_pct_change` correctly (positive = longer, negative = shorter)
- [ ] Computes Code-Symbol Density Ratio correctly on sample data with known code tokens
- [ ] `suggested_headroom_tokens` returns manifest default for v1 with no degradation
- [ ] `suggested_headroom_tokens` uses P50 + 50K safety buffer for v2+ with degradation history
- [ ] Clamps suggested headroom to `[100_000, context_window * 0.5]`
- [ ] Auto-detects `"length_drop"` flag when late answers are significantly shorter
- [ ] Auto-detects `"vagueness"` flag when code symbol density drops significantly
- [ ] Handles empty interactions log gracefully (returns report with zero counts)
- [ ] Reads correct version's interactions file when `version` parameter specified

**Features:** FEAT-010

---

### Step 4.2: oracle_add_to_corpus + oracle_update_entry (FEAT-006, FEAT-007)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add both handlers

**What to implement:**

1. **MCP tool `oracle_add_to_corpus` with parameters:**
   - `name: string` (required)
   - `file_path: string` (required, absolute path)
   - `role: CorpusRole` (required)
   - `required?: boolean` (default: `true`)
   - `priority?: number` (default: `10`)
   - `load_now?: boolean` (default: `false`)
   - `dedupe?: boolean` (default: `true`)

2. **add_to_corpus logic:**
   - Verify file exists at `file_path`; throw `FILE_NOT_FOUND` if missing
   - Compute sha256 hash of file content
   - If `dedupe: true`: check if path already exists in manifest `static_entries`
     - If already present: return `{ entry, already_present: true, loaded_into_daemon: false }`
   - Add new `StaticEntry` to manifest: `{ path, role, required, sha256, added_at: now, priority }`
   - Write manifest atomically
   - If `load_now: true` and daemon is running: inject file content into daemon via `runtime.askDaemon()`
   - Return: `{ entry, already_present: false, loaded_into_daemon }`

3. **MCP tool `oracle_update_entry` with parameters:**
   - `name: string` (required)
   - `file_path: string` (required, absolute path)
   - `reason: string` (required -- why the update is happening)
   - `expected_old_sha256?: string` (optional but recommended -- prevents stale updates)
   - `role?: CorpusRole` (optional -- update role)
   - `required?: boolean` (optional -- update required flag)
   - `commit?: boolean` (default: `true`)

4. **update_entry logic:**
   - Verify file exists at `file_path`
   - Find entry in manifest `static_entries` by path; throw error if not found
   - If `expected_old_sha256` provided: verify it matches current manifest sha256. If mismatch: throw `HASH_MISMATCH` with "Stale update -- manifest has <actual>, you expected <expected>"
   - Recompute sha256 from current file contents on disk
   - Update manifest entry: new sha256, optional role/required changes
   - Write manifest atomically
   - If `commit: true`: git commit with message: `"oracle(<name>): update entry <basename> -- <reason>"`
   - Return: `{ old_sha256, new_sha256, updated_at }`

**Tests:**
- [ ] `oracle_add_to_corpus` verifies file exists before adding
- [ ] `oracle_add_to_corpus` computes correct sha256
- [ ] `oracle_add_to_corpus` detects duplicate when `dedupe: true`
- [ ] `oracle_add_to_corpus` injects into daemon when `load_now: true` and daemon running
- [ ] `oracle_add_to_corpus` does not inject when `load_now: false`
- [ ] `oracle_update_entry` validates file is already in manifest
- [ ] `oracle_update_entry` validates `expected_old_sha256` when provided
- [ ] `oracle_update_entry` rejects stale update with `HASH_MISMATCH`
- [ ] `oracle_update_entry` recomputes sha256 from disk content (not from parameter)
- [ ] `oracle_update_entry` git commits with reason in message when `commit: true`
- [ ] Manual manifest edits (bypassing `oracle_update_entry`) cause `HASH_MISMATCH` on next spawn

**Features:** FEAT-006, FEAT-007

---

### Step 4.3: Idle Timeout Enforcement (FEAT-022)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/runtime.ts` -- implement idle sweep in GeminiRuntime singleton

**What to implement:**

1. **Idle sweep interval on `GeminiRuntime` singleton:**
   - `setInterval(60_000)` loop that runs on singleton instantiation
   - On each tick:
     - Read registry to find all active (non-decommissioned) oracles
     - For each oracle: read `state.json`, check each pool member
     - For members where `status !== "dismissed" && status !== "dead"`: check `Date.now() - Date.parse(last_query_at) > idle_timeout_ms`
     - If idle: soft-dismiss via `this.dismissDaemon({ daemon_id, hard: false })`
     - Update member status to `"dismissed"` in state.json
     - Log: `"[pythia] Idle-dismissed pool member <session_name> for oracle <name> (idle ${elapsedMinutes}m)"`

2. **Process shutdown cleanup:**
   - Clear interval on `SIGTERM`/`SIGINT`
   - Flush any pending batched commits before exit

**Tests:**
- [ ] Idle sweep runs every 60 seconds (verify interval is set)
- [ ] Soft-dismisses members whose `last_query_at` exceeds `idle_timeout_ms`
- [ ] Does NOT dismiss members whose `last_query_at` is within `idle_timeout_ms`
- [ ] Does NOT dismiss members with `status === "dismissed"` or `"dead"` (no double-dismiss)
- [ ] Updates member status to `"dismissed"` in state.json after dismissal
- [ ] Handles missing/invalid `last_query_at` gracefully (skip member, do not crash)
- [ ] Interval is cleared on process shutdown

**Features:** FEAT-022

---

## Phase 5: Decommission + Security

### Step 5.1: oracle_decommission_request + cancel (FEAT-011, FEAT-013)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add both handlers

**What to implement:**

1. **MCP tool `oracle_decommission_request` with parameters:**
   - `name: string` (required)
   - `reason: string` (required)

2. **Request logic:**
   - Validate oracle exists and is not already decommissioned
   - Generate unique `decommission_token` (UUID v4, 10-minute TTL)
   - Store token in-memory ONLY on `GeminiRuntime.decommissionTokens` Map: `{ token, oracle_name, expires_at: Date.now() + 600_000 }`
   - Token is NEVER written to `state.json` (which is git-tracked -- token in state = token in commit history = security breach)
   - Record decommission request in `vN-interactions.jsonl` as a `"session_note"` type entry
   - Return checklist for human completion:
     ```
     Decommission requested for oracle "<name>" v<N>.
     Token expires in 10 minutes.

     Required steps before oracle_decommission_execute:
     1. Run /pythia quality and /pythia status
     2. Take a screenshot of the output
     3. Run pythia-auth in your terminal to get TOTP code
     4. Type confirmation phrase: "DELETE <name> generation <N> containing <query_count> interactions"
     5. Wait 5 minutes (cooling-off period)
     6. Confirm execution when prompted

     Token: <token>
     ```

3. **MCP tool `oracle_decommission_cancel` with parameters:**
   - `name: string` (required)
   - `token: string` (required)

4. **Cancel logic:**
   - Validate token matches active decommission request for this oracle in `GeminiRuntime.decommissionTokens`
   - If no pending decommission: return `DECOMMISSION_REFUSED` with "No active decommission request"
   - Remove token from `decommissionTokens` Map
   - Log `"session_note"` interaction: "Decommission cancelled by user"
   - Return: `{ oracle_name, cancelled_at }`

**Tests:**
- [ ] Token is generated as valid UUID v4 with 10-minute TTL
- [ ] Token is stored in-memory only (NOT in state.json)
- [ ] Token in `decommissionTokens` Map has correct oracle_name and expiration
- [ ] Returns complete checklist with oracle-specific values (name, version, query_count)
- [ ] Rejects request for non-existent oracle with `ORACLE_NOT_FOUND`
- [ ] Rejects request for already-decommissioned oracle with `DECOMMISSION_REFUSED`
- [ ] Cancel invalidates token in memory
- [ ] Cancel logs session_note interaction
- [ ] Cancel returns `DECOMMISSION_REFUSED` when no active request exists
- [ ] MCP server restart clears all pending tokens (security feature -- cannot persist across restarts)

**Features:** FEAT-011, FEAT-013

---

### Step 5.2: oracle_decommission_execute (FEAT-012, FEAT-035)

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- add handler

**What to implement:**

1. **MCP tool `oracle_decommission_execute` with parameters:**
   - `name: string` (required)
   - `token: string` (required)
   - `totp_code: string` (required -- 6-digit code from pythia-auth)
   - `confirmation_phrase: string` (required -- exact match)

2. **7-step validation (ALL must pass, in order):**

   a. **Token validation:**
   - Look up token in `GeminiRuntime.decommissionTokens`
   - If not found: return `DECOMMISSION_TOKEN_EXPIRED` (covers both expired and never-requested)
   - If expired (`Date.now() > expires_at`): remove from Map, return `DECOMMISSION_TOKEN_EXPIRED`
   - If `oracle_name` on token does not match `name` parameter: return `DECOMMISSION_REFUSED`

   b. **TOTP verification:**
   - Read TOTP secret from secure store: macOS Keychain (`kSecAccessControlBiometryAny`) or `~/.pythia/keys/<name>.totp.enc`
   - Validate `totp_code` against current TOTP window (30-second interval, allow +/- 1 window for clock skew)
   - If invalid: return `TOTP_INVALID`

   c. **Confirmation phrase match:**
   - Expected: `"DELETE <name> generation <N> containing <query_count> interactions"`
   - Compare case-sensitively
   - If mismatch: return `CONFIRMATION_PHRASE_MISMATCH` with hint showing expected format

   d. **Execute decommission:**
   - Acquire operation lock for `"decommission"`
   - Best-effort checkpoint or salvage (does not fail if this step fails)
   - Hard-dismiss ALL daemon pool members via `runtime.dismissDaemon({ hard: true })` (full session deletion)
   - Set `state.status = "decommissioned"`, clear `daemon_pool`
   - Archive registry entry: set `decommissioned_at` timestamp (does NOT delete entry)
   - Remove `.pythia-active/<name>.json` marker file if present
   - If `.pythia-active/` directory is empty after removal: remove directory too
   - Release lock

3. **Data preservation:**
   - Oracle data (`<project>/oracle/` directory) remains on disk -- never deleted
   - Only the daemon sessions are destroyed

4. **Return:** `{ oracle_name, decommissioned_at, final_checkpoint_path }`

**Tests:**
- [ ] Refuses with `DECOMMISSION_TOKEN_EXPIRED` when token not found
- [ ] Refuses with `DECOMMISSION_TOKEN_EXPIRED` when token has expired
- [ ] Refuses with `DECOMMISSION_REFUSED` when token oracle_name does not match
- [ ] Refuses with `TOTP_INVALID` when TOTP code is wrong
- [ ] Refuses with `CONFIRMATION_PHRASE_MISMATCH` when phrase does not match exactly
- [ ] Succeeds when all gates pass: valid token + valid TOTP + exact phrase
- [ ] Hard-dismisses all pool members (full session deletion)
- [ ] Sets `state.status = "decommissioned"`
- [ ] Archives registry entry with `decommissioned_at` timestamp
- [ ] Registry entry is NOT deleted (archival only)
- [ ] Oracle data directory remains on disk after decommission
- [ ] `.pythia-active/<name>.json` marker file is removed
- [ ] Best-effort checkpoint does not block decommission if it fails

**Features:** FEAT-012, FEAT-035

---

### Step 5.3: pythia-auth CLI Binary (FEAT-034)

**Files to create:**
- `/Users/mikeboscia/pythia/cmd/pythia-auth/main.go` (or Rust equivalent at `/Users/mikeboscia/pythia/src/pythia-auth/main.rs`)
- Binary output: `/Users/mikeboscia/.pythia/bin/pythia-auth`

**What to implement:**

1. **Compiled binary (Go or Rust) -- not a shell script:**
   - Shell scripts are inspectable/spoofable by an agent with file write access
   - Compiled binary is opaque to agent tooling

2. **TOTP generation (cross-platform core):**
   - Read TOTP secret from platform-appropriate secure store
   - Generate current 6-digit TOTP code (RFC 6238, SHA-1, 30-second interval)
   - Display code with countdown timer showing remaining validity
   - Exit after code is displayed

3. **macOS enhancement (Touch ID):**
   - TOTP secret stored in macOS Keychain with `kSecAccessControlBiometryAny`
   - Accessing the secret requires Touch ID -- no background process, no agent, no automation can satisfy this
   - Physical fingerprint required

4. **Other platforms (Linux/Windows):**
   - TOTP secret stored in `~/.pythia/keys/<name>.totp.enc` encrypted at rest
   - `pythia-auth` prompts for passphrase to decrypt
   - Interactive TTY required (Claude cannot run this)

5. **Master Recovery Key:**
   - 256-bit key shown once at enrollment, never stored by the system
   - Used as fallback if authenticator app is lost

6. **TOTP enrollment (first-time setup):**
   - Called during first `spawn_oracle` for a given oracle
   - Generates TOTP secret
   - Displays QR code in terminal for authenticator app scanning
   - Stores secret in platform-appropriate secure store
   - Shows Master Recovery Key once

**Tests:**
- [ ] Binary compiles and runs on macOS (arm64)
- [ ] Generates valid 6-digit TOTP codes that match the RFC 6238 spec
- [ ] TOTP codes change every 30 seconds
- [ ] Cannot be run without interactive TTY (fails gracefully if piped)
- [ ] macOS: requires Touch ID to access Keychain entry
- [ ] Enrollment generates QR code output and stores secret
- [ ] Master Recovery Key is displayed once and not stored

**Features:** FEAT-034

---

## Phase 6: Integration

### Step 6.1: Slash Command / Skill (FEAT-025 through FEAT-032)

**Files to create:**
- `/Users/mikeboscia/pythia/skills/pythia.md`

**What to implement:**

Skill file defining the `/pythia` slash command with subcommands:

1. **`/pythia [query]`** (FEAT-025):
   - No query: show status (tokens_remaining, version, query count, pool state)
   - With query: `oracle_pressure_check` -> route to idle pool member via `ask_daemon` -> `oracle_log_learning`
   - Auto-checkpoint if `recommendation === "checkpoint_now"`
   - After any Ion delegation concludes: call `oracle_sync_corpus` before next query

2. **`/pythia sync [source_id]`** (FEAT-026):
   - Call `oracle_sync_corpus` with optional `source_id`
   - Display sync results: files synced, bytes loaded, members updated

3. **`/pythia checkpoint`** (FEAT-027):
   - Call `oracle_checkpoint`
   - Display checkpoint path, bytes, sha256

4. **`/pythia reconstitute`** (FEAT-028):
   - Call `oracle_reconstitute`
   - Display version transition, new daemon info

5. **`/pythia salvage`** (FEAT-029):
   - Call `oracle_salvage`
   - Display salvage results

6. **`/pythia add <filepath> [role]`** (FEAT-030):
   - Call `oracle_add_to_corpus` with file_path and role
   - Default role: `"other"`

7. **`/pythia status`** (FEAT-031):
   - Display: manifest summary, state (version, pool, pressure), registry entry, degradation summary
   - Show each pool member's status, query count, chars in/out, idle time

8. **`/pythia quality`** (FEAT-032):
   - Call `oracle_quality_report`
   - Display: length trend, code symbol density, suggested headroom, flags

**Skill file conventions:**
- Oracle name auto-detection from `.pythia-active/` directory in current project root
- If multiple oracles active: require explicit `--name <oracle>` parameter
- Pressure check runs automatically before every query (step 1 of `/pythia [query]`)
- After Ion delegation: skill conventions remind Claude to call `oracle_sync_corpus`

**Tests:**
- [ ] `/pythia` with no args shows status output
- [ ] `/pythia <query>` routes through pressure check -> ask -> log learning pipeline
- [ ] `/pythia sync` calls oracle_sync_corpus and displays results
- [ ] `/pythia checkpoint` calls oracle_checkpoint
- [ ] `/pythia reconstitute` calls oracle_reconstitute
- [ ] `/pythia salvage` calls oracle_salvage
- [ ] `/pythia add` calls oracle_add_to_corpus with correct parameters
- [ ] `/pythia status` displays comprehensive oracle state
- [ ] `/pythia quality` displays quality report metrics
- [ ] Auto-pressure-check fires on every `/pythia <query>` call
- [ ] Auto-sync reminder fires after Ion delegation

**Features:** FEAT-025 through FEAT-032

---

### Step 6.2: Post-Tool-Use Pressure Hook (FEAT-033)

**Files to modify:**
- `/Users/mikeboscia/.claude/hooks/post-tool-use.sh` -- add oracle pressure check section

**What to implement:**

1. **Active oracle discovery:**
   - Check for `${projectRoot}/.pythia-active/` directory
   - If found: read per-oracle JSON files to get oracle names and `oracle_dir` paths
   - Fallback: scan `registry.json` for longest `project_root` prefix match against current `cwd`
   - If ambiguous (multiple oracles, no clear winner): skip check (require explicit name)

2. **Pressure check frequency:**
   - Counter: every 5 tool calls, trigger pressure check
   - Use a counter file or environment variable to track call count
   - On trigger: call `oracle_pressure_check` for each active oracle
   - If `recommendation === "checkpoint_now"`: emit warning to Claude's output

3. **Skip conditions:**
   - If oracle `status === "decommissioned"`: skip
   - If no active oracles found: skip entirely (no error)
   - If pressure check fails (oracle daemon dead, etc.): log warning, do not block tool execution

**Tests:**
- [ ] Discovers active oracle from `.pythia-active/` directory
- [ ] Falls back to registry prefix match when `.pythia-active/` not present
- [ ] Triggers pressure check every 5 tool calls (not every call)
- [ ] Emits warning when `recommendation === "checkpoint_now"`
- [ ] Skips gracefully when no active oracles found
- [ ] Does not block tool execution on pressure check failure
- [ ] Handles multiple active oracles (checks each one)

**Features:** FEAT-033

---

### Step 6.3: MCP Server Registration

**Files to modify:**
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/server.ts` -- import and register oracle tools
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` -- export `registerOracleTools(server: McpServer)` function

**What to implement:**

1. **Tool registration function:**
   - `registerOracleTools(server: McpServer): void` -- registers all 13 oracle MCP tools:
     - `spawn_oracle` (FEAT-001)
     - `oracle_sync_corpus` (FEAT-002)
     - `oracle_pressure_check` (FEAT-003)
     - `oracle_checkpoint` (FEAT-004)
     - `oracle_log_learning` (FEAT-005)
     - `oracle_add_to_corpus` (FEAT-006)
     - `oracle_update_entry` (FEAT-007)
     - `oracle_salvage` (FEAT-008)
     - `oracle_reconstitute` (FEAT-009)
     - `oracle_quality_report` (FEAT-010)
     - `oracle_decommission_request` (FEAT-011)
     - `oracle_decommission_execute` (FEAT-012)
     - `oracle_decommission_cancel` (FEAT-013)

2. **Server entry point update:**
   - In `server.ts`: import `registerOracleTools` from `../oracle-tools.js`
   - Call `registerOracleTools(server)` after `registerGeminiTools(server)`

3. **Tool naming convention:**
   - All oracle tools prefixed with `oracle_` (except `spawn_oracle`)
   - MCP tool names match the function names exactly
   - Zod schemas for all parameters

**Tests:**
- [ ] All 13 tools appear in MCP tool listing (`server.listTools()`)
- [ ] Server starts without errors after registration
- [ ] Each tool has a valid Zod schema for parameter validation
- [ ] Tools are callable via MCP protocol (basic smoke test for each)
- [ ] No name collisions with existing Gemini tools

**Features:** All MCP tools (FEAT-001 through FEAT-013)

---

## Dependency Graph

```
Phase 1: Foundation
  Step 1.1: GeminiRuntime Singleton (FEAT-014, FEAT-015)
  Step 1.2: Type Definitions (FEAT-016)                    [parallel with 1.1]
  Step 1.3: Registry + State Management (FEAT-017, FEAT-018) [depends on 1.2]
      |
      v
Phase 2: Core Oracle Operations
  Step 2.1: Corpus Loading Pipeline (FEAT-019)              [depends on 1.1, 1.2, 1.3]
  Step 2.2: spawn_oracle (FEAT-001, FEAT-024)               [depends on 2.1]
  Step 2.3: oracle_sync_corpus (FEAT-002, FEAT-021)         [depends on 2.1, 2.2]
  Step 2.4: oracle_pressure_check (FEAT-003, FEAT-020)      [depends on 1.3]
      |
      v
Phase 3: Lifecycle Management
  Step 3.1: oracle_log_learning (FEAT-005, FEAT-023)        [depends on 1.3]
  Step 3.2: oracle_checkpoint (FEAT-004)                     [depends on 2.2, 2.4]
  Step 3.3: oracle_reconstitute (FEAT-009)                   [depends on 3.2]
  Step 3.4: oracle_salvage (FEAT-008)                        [depends on 3.1]
      |
      v
Phase 4: Analysis + Corpus Management                 Phase 5: Decommission + Security
  Step 4.1: oracle_quality_report (FEAT-010)              Step 5.1: decommission_request/cancel
            [depends on 3.1]                                        (FEAT-011, FEAT-013)
  Step 4.2: add_to_corpus / update_entry                            [depends on 1.3]
            (FEAT-006, FEAT-007) [depends on 1.3]         Step 5.2: decommission_execute
  Step 4.3: Idle Timeout (FEAT-022)                                 (FEAT-012, FEAT-035)
            [depends on 1.1]                                        [depends on 5.1]
      |                                                   Step 5.3: pythia-auth binary
      |                                                             (FEAT-034) [independent]
      v                                                       |
Phase 6: Integration                                          |
  Step 6.1: Slash Command / Skill (FEAT-025--032)    <--------+
            [depends on all tools]
  Step 6.2: Post-Tool-Use Hook (FEAT-033)
            [depends on 2.4]
  Step 6.3: MCP Server Registration
            [depends on all tools]
```

**Parallelization opportunities:**
- Steps 1.1 and 1.2 can be implemented in parallel
- Steps 2.3 and 2.4 can be implemented in parallel (both depend on 2.1/2.2 but not on each other)
- Phase 4 and Phase 5 can be implemented in parallel (independent dependency chains)
- Step 5.3 (pythia-auth binary) is fully independent and can be built at any time

---

## Estimated Complexity

| Phase | Steps | Complexity | Rationale |
|-------|-------|------------|-----------|
| Phase 1: Foundation | 3 | **High** | Refactoring a live MCP server without breaking existing tools. Singleton extraction. Optimistic concurrency control. |
| Phase 2: Core Operations | 4 | **High** | Corpus loading pipeline is the most complex single component. Two-pass load, hash verification, glob resolution, backpressure handling. |
| Phase 3: Lifecycle | 4 | **High** | Checkpoint and reconstitute are the heart of the system. Full atomic generation transition with drain, lock, dismiss, spawn. |
| Phase 4: Analysis + Corpus | 3 | **Medium** | Quality report is mostly computation. Add/update are straightforward CRUD. Idle sweep is a timer. |
| Phase 5: Decommission | 3 | **Medium** | Token management is simple. TOTP validation is standard. The pythia-auth binary is a standalone project. |
| Phase 6: Integration | 3 | **Low** | Skill file is documentation. Hook is a bash script addition. Registration is import + call. |

**Total new artifacts:**
- 3 new TypeScript source files (`runtime.ts`, `oracle-types.ts`, `oracle-tools.ts`)
- 2 modified TypeScript source files (`tools.ts`, `server.ts`)
- 1 new skill file (`pythia.md`)
- 1 modified bash hook (`post-tool-use.sh`)
- 1 compiled binary (`pythia-auth`)
- Per-project: `oracle/` directory with manifest.json, state.json, learnings/, checkpoints/

---

## Cross-References

| Document | Location | Relation |
|----------|----------|----------|
| Design Doc (v6) | `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` | Authoritative spec. All types, schemas, and tool signatures defined here. |
| README | `/Users/mikeboscia/pythia/README.md` | Project overview, architecture diagram, dependency notes. |
| Registry | `/Users/mikeboscia/pythia/registry.json` | Maps oracle names to project oracle_dir paths. Modified by registerOracle(). |
| Existing MCP server | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/tools.ts` | Contains `_sessions` Map and daemon lifecycle to be extracted into `runtime.ts`. |
| Existing MCP entry | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/server.ts` | Entry point modified to register oracle tools. |
| Shared types | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/shared/types.ts` | Existing inter-agent protocol types. Oracle types are separate in `oracle-types.ts`. |
| Model fallback | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/model-fallback.ts` | Fallback chain used by corpus loading and salvage (fresh Gemini calls). |
| Post-tool-use hook | `/Users/mikeboscia/.claude/hooks/post-tool-use.sh` | Modified to add oracle pressure check every 5 tool calls. |

---

## FEAT-ID Reference Index

| FEAT-ID | Name | Phase.Step | Description |
|---------|------|------------|-------------|
| FEAT-001 | spawn_oracle | 2.2 | Spawn or resume an oracle with full corpus bootstrap |
| FEAT-002 | oracle_sync_corpus | 2.3 | Sync live_sources into running daemon pool |
| FEAT-003 | oracle_pressure_check | 2.4 | Compute and return context pressure metrics |
| FEAT-004 | oracle_checkpoint | 3.2 | Generate and save Pythia's self-written checkpoint |
| FEAT-005 | oracle_log_learning | 3.1 | Append structured interaction to JSONL log |
| FEAT-006 | oracle_add_to_corpus | 4.2 | Add new static entry to manifest |
| FEAT-007 | oracle_update_entry | 4.2 | Update existing static entry hash and metadata |
| FEAT-008 | oracle_salvage | 3.4 | Synthesize checkpoint from interactions log for dead daemon |
| FEAT-009 | oracle_reconstitute | 3.3 | Full generational transition: vN -> v(N+1) |
| FEAT-010 | oracle_quality_report | 4.1 | Compute degradation metrics from interactions log |
| FEAT-011 | oracle_decommission_request | 5.1 | Phase 1: generate decommission token and checklist |
| FEAT-012 | oracle_decommission_execute | 5.2 | Phase 7: validated destruction of oracle sessions |
| FEAT-013 | oracle_decommission_cancel | 5.1 | Cancel pending decommission and invalidate token |
| FEAT-014 | GeminiRuntime singleton | 1.1 | Extract daemon lifecycle into shared singleton |
| FEAT-015 | OracleRuntimeBridge | 1.1 | Interface for oracle-tools to access daemon operations |
| FEAT-016 | oracle-types.ts | 1.2 | All TypeScript type definitions and constants |
| FEAT-017 | Registry management | 1.3 | Oracle name -> project dir mapping with atomic writes |
| FEAT-018 | State management | 1.3 | Optimistic concurrency, operation locks, atomic writes |
| FEAT-019 | Corpus loading | 2.1 | Two-pass pipeline: resolve + inject with hash verification |
| FEAT-020 | Pressure detection | 2.4 | MCP-side char tracking, absolute headroom model |
| FEAT-021 | Cross-daemon sync | 2.3 | Interaction delta injection before query routing |
| FEAT-022 | Idle timeout | 4.3 | Automatic soft-dismiss of idle pool members |
| FEAT-023 | Batched commits | 3.1 | Deferred git commits for interaction logging |
| FEAT-024 | .pythia-active markers | 2.2 | Per-oracle active state files for hook discovery |
| FEAT-025 | /pythia [query] | 6.1 | Query slash command with auto-pressure-check |
| FEAT-026 | /pythia sync | 6.1 | Sync slash command |
| FEAT-027 | /pythia checkpoint | 6.1 | Checkpoint slash command |
| FEAT-028 | /pythia reconstitute | 6.1 | Reconstitute slash command |
| FEAT-029 | /pythia salvage | 6.1 | Salvage slash command |
| FEAT-030 | /pythia add | 6.1 | Add-to-corpus slash command |
| FEAT-031 | /pythia status | 6.1 | Status display slash command |
| FEAT-032 | /pythia quality | 6.1 | Quality report slash command |
| FEAT-033 | Pressure hook | 6.2 | Post-tool-use pressure check integration |
| FEAT-034 | pythia-auth | 5.3 | Compiled TOTP binary for decommission security |
| FEAT-035 | Decommission protocol | 5.2 | 7-step human-gated destruction sequence |
