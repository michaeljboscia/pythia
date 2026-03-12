# BACKEND_STRUCTURE -- Pythia Oracle Engine

**Source of Truth:** `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` (v6)
**Cross-references:** `PRD.md`, `APP_FLOW.md`, `TECH_STACK.md`, `IMPLEMENTATION_PLAN.md` (all in `/Users/mikeboscia/pythia/docs/`)

---

## Data Architecture Overview

Pythia has **no cloud database**. All data is stored as JSON/JSONL files on the local filesystem, git-tracked.

The system is split across two locations:

| Location | Contents | Scope |
|----------|----------|-------|
| `/Users/mikeboscia/pythia/` | Engine code, MCP tools, types, skills, registry | Global -- managed outside any project |
| `<project>/oracle/` | Manifest, state, interactions log, checkpoints | Per-project -- committed alongside the code it documents |

Oracle data lives on the **same branch as the code** at all times. No dedicated oracle branch. `git checkout main` gets `main`'s oracle state. `git checkout feature/auth` gets that branch's oracle state.

### Directory Structure

```
<project-root>/
+-- oracle/
|   +-- manifest.json              <- canonical corpus definition (static + live sources)
|   +-- state.json                 <- current daemon_id, version, pressure metrics
|   +-- learnings/
|   |   +-- v1-interactions.jsonl  <- structured per-query record (roll fwd/back)
|   |   +-- v2-interactions.jsonl
|   |   +-- ...
|   +-- checkpoints/
|       +-- v1-checkpoint.md       <- Pythia v1's self-written synthesis before death
|       +-- v2-checkpoint.md
+-- .pythia-active/                <- active oracle marker directory (hook discovery)
    +-- <oracle-name>.json
```

```
/Users/mikeboscia/pythia/
+-- registry.json                  <- maps oracle names to project oracle_dir paths
+-- src/
+-- skills/
+-- docs/
+-- design/
```

### Pluggable Corpus Backend (Architectural Constraint)

All corpus loading goes through `resolveCorpusForSpawn()`. The daemon receives text payloads, never file paths. This preserves future swap to a Living Corpus retrieval pipeline (knowledge graph + vector index + tiered retrieval). Not a v1 feature -- a v1 architectural constraint.

- Today: `manifest.json` -> read files -> hash -> inject into daemon
- Tomorrow: `retrieve_context(query, constraints)` -> graph traversal + vector search -> inject curated slice

Design constraints:
1. All corpus loading goes through `resolveCorpusForSpawn()` -- no tool reads files directly
2. The daemon receives text payloads, not file paths -- the source of those payloads is opaque
3. `vN-interactions.jsonl` entries are structured ADR-like artifacts -- they become first-class nodes in a future knowledge graph
4. The `OracleRuntimeBridge` interface is stable -- the retrieval backend changes behind it

---

## File Schemas

### manifest.json

**Location:** `<project>/oracle/manifest.json`
**Purpose:** Canonical corpus definition -- defines all static research docs and live code sources the oracle loads, their hash integrity, load order, and pressure thresholds.

**Schema:**

```json
{
  "schema_version": 1,
  "name": "string",
  "project": "string",
  "version": "number (integer, starts at 1)",
  "checkpoint_headroom_tokens": "number (default: 250000)",
  "pool_size": "number (default: 2, integer >= 1)",
  "static_entries": [
    {
      "path": "string (absolute path, fully qualified)",
      "role": "CorpusRole ('core_research' | 'prompt_architecture' | 'pain_signals' | 'learnings' | 'checkpoint' | 'other')",
      "required": "boolean",
      "sha256": "string (hex digest)",
      "added_at": "string (ISO 8601 with timezone)",
      "priority": "number (optional, default implicit; lower = earlier in load order)"
    }
  ],
  "live_sources": [
    {
      "id": "string (unique identifier, e.g. 'app-codebase')",
      "root": "string (absolute path to source root)",
      "include": ["string (glob patterns, e.g. '**/*.ts')"],
      "exclude": ["string (glob patterns, e.g. '**/node_modules/**')"],
      "role": "CorpusRole",
      "required": "boolean",
      "sync_mode": "SyncMode ('manual' | 'on_spawn' | 'interval')",
      "interval_seconds": "number (optional, used when sync_mode === 'interval')",
      "max_files": "number (optional, cap on resolved file count)",
      "max_sync_bytes": "number (default: 5000000 = 5MB, safety rail)",
      "reconstitute_sync_mode": "ReconstituteSyncMode ('hash_gated_delta' | 'full_rescan', default: 'hash_gated_delta')",
      "priority": "number (optional, sort order within role group)",
      "last_sync_at": "string | null (ISO 8601)",
      "last_tree_hash": "string | null (fast gate: did anything change?)",
      "last_file_hashes": "Record<string, string> | null (precise diff: which files changed?)"
    }
  ],
  "load_order": ["CorpusRole[] (e.g. ['core_research', 'prompt_architecture', 'pain_signals', 'learnings', 'checkpoint'])"],
  "created_at": "string (ISO 8601 with timezone)",
  "last_spawned_at": "string | null (ISO 8601 with timezone)"
}
```

**Validation rules:**

- `schema_version` must be `1` (current version)
- `name` must match the registry entry name
- `version` must be a positive integer, incremented on reconstitution
- `checkpoint_headroom_tokens` must be a positive integer; checkpoint fires when `estimated_total_tokens > (discovered_context_window - checkpoint_headroom_tokens)`
- `pool_size` must be >= 1; this is a ceiling, not an always-on target
- `static_entries[].path` must be an absolute, fully qualified path -- no relative paths, no tildes
- `static_entries[].sha256` must match the sha256 hash of the file contents at spawn time; mismatch = hard error (`HASH_MISMATCH`)
- `live_sources[].id` must be unique within the manifest
- `live_sources[].max_sync_bytes` (default: 5,000,000 = 5MB) is a safety rail against accidentally globbing `node_modules/` or `dist/`; throws `CORPUS_CAP_EXCEEDED` if exceeded
- `load_order` defines the role-group sequence for corpus injection
- Load order within a role group: sorted by `priority ASC, added_at ASC, path ASC` -- guarantees strict determinism across reconstitutions
- `context_window_tokens` is NOT stored in the manifest -- discovered dynamically at `spawn_oracle` time from model config and stored in `state.json`
- Manual manifest edits are a hard error on spawn -- always use `oracle_update_entry` (FEAT-007)

**Example:**

```json
{
  "schema_version": 1,
  "name": "pythia",
  "project": "narrative-generator-rebuild",
  "version": 1,
  "checkpoint_headroom_tokens": 250000,
  "pool_size": 2,
  "static_entries": [
    {
      "path": "/full/absolute/path/to/file.md",
      "role": "core_research",
      "required": true,
      "sha256": "abc123...",
      "added_at": "2026-03-05T10:00:00-05:00",
      "priority": 10
    }
  ],
  "live_sources": [
    {
      "id": "app-codebase",
      "root": "/full/absolute/path/to/project/src",
      "include": ["**/*.ts", "config/**/*.json"],
      "exclude": ["**/node_modules/**", "**/dist/**", "**/*.map"],
      "role": "prompt_architecture",
      "required": true,
      "sync_mode": "on_spawn",
      "max_files": 200,
      "max_sync_bytes": 5000000,
      "reconstitute_sync_mode": "hash_gated_delta",
      "priority": 50,
      "last_sync_at": null,
      "last_tree_hash": null
    }
  ],
  "load_order": ["core_research", "prompt_architecture", "pain_signals", "learnings", "checkpoint"],
  "created_at": "2026-03-05T10:20:00-05:00",
  "last_spawned_at": "2026-03-05T10:20:00-05:00"
}
```

---

### state.json

**Location:** `<project>/oracle/state.json`
**Purpose:** Current daemon state, pool member tracking, and pressure metrics. The single source of truth for the oracle's runtime status.

**Schema:**

```json
{
  "schema_version": 1,
  "oracle_name": "string",
  "version": "number (integer, matches manifest version)",
  "spawned_at": "string | null (ISO 8601)",
  "discovered_context_window": "number | null (tokens, discovered at spawn time)",
  "daemon_pool": [
    {
      "daemon_id": "string | null (null when soft-dismissed, no live process)",
      "session_name": "string (e.g. 'daemon-pythia-0', stable, survives dismiss)",
      "session_dir": "string | null (absolute path to session data on disk)",
      "status": "'idle' | 'busy' | 'dead' | 'dismissed'",
      "query_count": "number",
      "chars_in": "number (total chars sent to this member post-spawn)",
      "chars_out": "number (total chars received from this member post-spawn)",
      "last_synced_interaction_id": "string | null (e.g. 'v1-q003', for cross-daemon context sync)",
      "last_query_at": "string | null (ISO 8601, for idle timeout detection)",
      "idle_timeout_ms": "number (optional, default: 300000 = 5 minutes)",
      "last_corpus_sync_hash": "Record<string, string> | null (per-source tree hashes at last sync)",
      "pending_syncs": [
        {
          "source_id": "string",
          "tree_hash": "string",
          "payload_ref": "string (temp file or memory ref)",
          "queued_at": "string (ISO 8601)"
        }
      ]
    }
  ],
  "session_chars_at_spawn": "number | null (bootstrap payload chars, same for all members)",
  "chars_per_token_estimate": "number (default: 4)",
  "estimated_total_tokens": "number | null (MAX across pool members, drives checkpoint)",
  "estimated_cluster_tokens": "number | null (SUM across pool members, observability only)",
  "tokens_remaining": "number | null (based on highest-pressure pool member)",
  "query_count": "number (total queries across all pool members)",
  "last_checkpoint_path": "string | null (absolute path)",
  "status": "OracleStatus",
  "lock_held_by": "string | null (operation name holding the lock)",
  "lock_expires_at": "string | null (ISO 8601, TTL prevents orphans)",
  "last_error": "string | null (set when status === 'error')",
  "last_bootstrap_ack": {
    "ok": "boolean",
    "raw": "string (Pythia's raw ack response)",
    "checked_at": "string (ISO 8601)"
  },
  "state_version": "number (optimistic concurrency counter, increment on every write)",
  "next_seq": "number (monotonic counter for InteractionEntry.seq allocation)",
  "token_count_method": "'exact' | 'estimate' (whether pressure uses countTokens API or char heuristic)",
  "generation_since_reground": "number (generations since last full corpus re-grounding, reset on reground)",
  "updated_at": "string (ISO 8601)"
}
```

**Concurrency model:**

- **`writeStateWithRetry` (FEAT-018)**: All state writes go through this function. It reads current state, applies a mutator function, checks `state_version` matches before writing. If version has changed (concurrent write), waits with exponential backoff + jitter and retries. 5 retries max. Returns `CONCURRENCY_CONFLICT` after exhaustion.
- **`state_version`**: Optimistic concurrency counter -- incremented on every write. Prevents lost updates from concurrent tool calls.
- **Lock mechanism**: `lock_held_by` + `lock_expires_at` provide named operation locks with TTL. Operations that must not run concurrently (checkpoint, reconstitute, decommission) acquire a named lock before proceeding. If a lock is held, competing operations return `DAEMON_BUSY_LOCK` and the caller can retry after `lock_expires_at`. TTL prevents orphaned locks on crash. Long-running operations use `startLockHeartbeat()` to extend `lock_expires_at` every 60s.

**In-memory concurrency (decision #47):**

- `async-mutex` protects all async read-modify-write sequences on the `GeminiRuntime` singleton (daemon pool, active tool executions)
- Required because MCP SDK dispatches tool calls concurrently — without mutex, parallel `ask_daemon` calls can corrupt pool state
- File-system concurrency (`writeStateWithRetry`) and in-memory concurrency (`async-mutex`) are complementary — both are required

**Pressure aggregation:**

- `estimated_total_tokens = MAX(memberTokens)` -- each pool member has its own independent context window; the highest-pressure member determines checkpoint timing
- `estimated_cluster_tokens = SUM(memberTokens)` -- observability metric only, does NOT drive checkpoint decisions
- **Primary (exact):** `memberTokens[i]` from Gemini `countTokens` API / response `usage_metadata` (decision #49). Requires network.
- **Fallback (estimate):** `memberTokens[i] = (session_chars_at_spawn + member.chars_in + member.chars_out) / chars_per_token_estimate`
- `token_count_method` in state.json tracks which mode is active. Starts as `"exact"`, falls back to `"estimate"` if `countTokens` fails.
- `chars_per_token_estimate` (default: 4) has +/-10-15% error margin on English/code text; the 250K absolute headroom absorbs variance
- `session_chars_at_spawn` captures the exact character count of the bootstrap payload (preamble + all corpus content). Set after full corpus load completes.
- When pool is empty (no active members): `estimated_total_tokens`, `estimated_cluster_tokens`, and `tokens_remaining` are all `null`; `oracle_pressure_check` returns `PRESSURE_UNAVAILABLE`

**Pressure thresholds (absolute headroom model):**

| Tokens Remaining | Status | Action |
|-----------------|--------|--------|
| > `headroom` | Healthy | Normal operation |
| `headroom/2` -- `headroom` | Warning | Notify, checkpoint soon |
| < `headroom/2` | Critical | Auto-checkpoint now |
| < `headroom/4` | Emergency | Too late to safely checkpoint; use `oracle_salvage` |

**Example:**

```json
{
  "schema_version": 1,
  "oracle_name": "pythia",
  "version": 1,
  "spawned_at": "2026-03-05T10:20:00-05:00",
  "discovered_context_window": 2000000,
  "daemon_pool": [
    {
      "daemon_id": "gd_mmdkx0g8_1",
      "session_name": "daemon-pythia-0",
      "session_dir": "/Users/mikeboscia/.gemini/daemon-sessions/daemon-pythia-0",
      "status": "idle",
      "query_count": 3,
      "chars_in": 920000,
      "chars_out": 45000,
      "last_synced_interaction_id": "v1-q003",
      "last_query_at": "2026-03-05T10:25:00-05:00",
      "idle_timeout_ms": 300000,
      "last_corpus_sync_hash": { "app-codebase": "abc123..." },
      "pending_syncs": []
    }
  ],
  "session_chars_at_spawn": 844900,
  "chars_per_token_estimate": 4,
  "estimated_total_tokens": 241250,
  "estimated_cluster_tokens": 241250,
  "tokens_remaining": 1758750,
  "query_count": 4,
  "last_checkpoint_path": null,
  "status": "healthy",
  "lock_held_by": null,
  "lock_expires_at": null,
  "last_error": null,
  "last_bootstrap_ack": null,
  "state_version": 1,
  "next_seq": 5,
  "token_count_method": "exact",
  "generation_since_reground": 0,
  "updated_at": "2026-03-05T10:25:00-05:00"
}
```

---

### vN-interactions.jsonl

**Location:** `<project>/oracle/learnings/vN-interactions.jsonl` (where N = oracle version)
**Purpose:** Structured audit trail of every consultation, feedback event, sync event, and session note. The primary data artifact -- not a summary, not markdown prose. Every event is structured, addressable, and replayable. Checkpoints are derived from it. Degradation analysis reads it. Dead-letter salvage reconstructs from it.

**Entry types:** `consultation`, `feedback`, `sync_event`, `session_note`

**ID format:**
- Consultations: `v<N>-q<NNN>` (e.g., `v1-q003`)
- Feedback: `v<N>-q<NNN>-fb` (e.g., `v1-q003-fb`)

**Schema per entry type:**

#### consultation

```jsonl
{
  "id": "v1-q003",
  "seq": 3,
  "entry_schema_version": 2,
  "type": "consultation",
  "oracle_name": "string",
  "version": 1,
  "query_count": 3,
  "timestamp": "2026-03-05T10:25:00-05:00",
  "trace_id": "string (OTel trace ID grouping related operations)",
  "span_id": "string (OTel span ID for this operation)",
  "parent_span_id": "string | null (OTel parent span, null for root)",
  "tokens_remaining_at_query": 1758750,
  "chars_in_at_query": 920000,
  "model_actual": "string (which model actually responded after fallback chain)",
  "interaction_scope": "'architectural' | 'operational' | 'other' (optional)",
  "question": "string (the question asked)",
  "counsel": "string (full raw Pythia response)",
  "counsel_sha256": "string (SHA-256 hash of counsel content)",
  "decision": "string | null (what was decided; null if not yet determined)",
  "ion_delegated": "boolean (optional, true if delegated to Ion/Codex)",
  "ion_query": "string (required if ion_delegated === true)",
  "ion_response": "string (required if ion_delegated === true)",
  "quality_signal": "1 | 2 | 3 | 4 | 5 | null (set by Claude, not Pythia)",
  "caused_by": ["string[] (parent interaction IDs, builds decision graph)"],
  "flags": ["string[] (e.g. 'self_contradiction', manual in v1)"],
  "usage": {
    "prompt_tokens": "number",
    "completion_tokens": "number",
    "total_tokens": "number",
    "cached_tokens": "number (optional)"
  },
  "latency": {
    "started_at": "string (ISO 8601)",
    "first_token_ms": "number (optional)",
    "duration_ms": "number"
  }
}
```

#### feedback

```jsonl
{
  "id": "v1-q003-fb",
  "seq": 4,
  "entry_schema_version": 2,
  "type": "feedback",
  "oracle_name": "string",
  "version": 1,
  "query_count": 0,
  "timestamp": "2026-03-05T14:00:00-05:00",
  "trace_id": "string (OTel trace ID)",
  "span_id": "string (OTel span ID)",
  "parent_span_id": "string | null",
  "tokens_remaining_at_query": 1700000,
  "chars_in_at_query": 950000,
  "references": "v1-q003",
  "implemented": true,
  "outcome": "string (what actually happened)",
  "divergence": "string (how reality differed from counsel)"
}
```

#### sync_event

```jsonl
{
  "id": "string",
  "type": "sync_event",
  "oracle_name": "string",
  "version": 1,
  "query_count": 0,
  "timestamp": "string (ISO 8601)",
  "tokens_remaining_at_query": "number",
  "chars_in_at_query": "number",
  "question": "string (description of what was synced)",
  "flags": []
}
```

#### session_note

```jsonl
{
  "id": "string",
  "type": "session_note",
  "oracle_name": "string",
  "version": 1,
  "query_count": 0,
  "timestamp": "string (ISO 8601)",
  "tokens_remaining_at_query": "number",
  "chars_in_at_query": "number",
  "question": "string (architectural context note not tied to a specific question)",
  "flags": []
}
```

**Roll-forward / Roll-back capabilities:**

Because every interaction is addressable by `id`, the system can:
- **Roll forward**: replay interactions from any prior checkpoint to a specific state
- **Roll back**: identify the exact query where degradation began and reconstruct from just before it
- **Fork**: reconstitute from `v3-q105` with different assumptions -- branch the oracle's worldview

**Batched git commits (FEAT-023):** JSONL writes happen immediately (data safe on disk). `git commit` is deferred via `batchCommitLearnings()` until any flush trigger fires:
- Pending entries >= 10
- Pending bytes >= 256KB
- 30-second debounce timer
- Explicit `force: true`
- Process shutdown hook

**Examples:**

Consultation:
```jsonl
{"id":"v1-q003","type":"consultation","oracle_name":"pythia","version":1,"query_count":3,"timestamp":"2026-03-05T10:25:00-05:00","tokens_remaining_at_query":1758750,"chars_in_at_query":920000,"question":"What is the recommended persona mapping strategy for cold outreach?","counsel":"<full raw Pythia response>","decision":"Use 3-tier persona framework: executive / practitioner / evaluator","quality_signal":null,"flags":[]}
```

Feedback:
```jsonl
{"id":"v1-q003-fb","type":"feedback","oracle_name":"pythia","version":1,"query_count":0,"timestamp":"2026-03-05T14:00:00-05:00","tokens_remaining_at_query":1700000,"chars_in_at_query":950000,"references":"v1-q003","implemented":true,"outcome":"3-tier persona framework shipped. Executive tier performs 2.3x better.","divergence":"Evaluator persona collapsed into Practitioner -- not enough volume to split."}
```

---

### registry.json (FEAT-017)

**Location:** `/Users/mikeboscia/pythia/registry.json`
**Purpose:** Maps oracle names to project oracle_dir paths. The global index of all oracles.

**Schema:**

```json
{
  "schema_version": 1,
  "oracles": {
    "<oracle-name>": {
      "name": "string",
      "oracle_dir": "string (absolute path to <project>/oracle/)",
      "project_root": "string (absolute path to project root)",
      "created_at": "string (ISO 8601 with timezone)",
      "decommissioned_at": "string (optional, ISO 8601, set on oracle_decommission)"
    }
  }
}
```

**Constraints:**

- Oracle names are globally unique among non-decommissioned entries
- `registerOracle()` enforces uniqueness at write time and rejects duplicates
- Multiple named oracles per project root are allowed (e.g., `pythia-frontend` and `pythia-backend` in the same project)
- Atomic writes via temp file + rename pattern to prevent partial writes from corrupting the registry
- Git-tracked in `/Users/mikeboscia/pythia/` -- `git checkout registry.json` is always a valid recovery path (no `.bak` file needed)
- Decommissioned entries are archived with `decommissioned_at` timestamp, not deleted
- All path values must be absolute, fully qualified -- no relative paths, no tildes

**Example:**

```json
{
  "schema_version": 1,
  "oracles": {
    "narrative-generator": {
      "name": "narrative-generator",
      "oracle_dir": "/Users/mikeboscia/projects/narrative-generator/oracle",
      "project_root": "/Users/mikeboscia/projects/narrative-generator",
      "created_at": "2026-03-05T10:00:00-05:00"
    }
  }
}
```

---

### .pythia-active/<oracle-name>.json (FEAT-024)

**Location:** `<project-root>/.pythia-active/<oracle-name>.json`
**Purpose:** Active oracle marker for hook discovery. The post-tool-use hook checks for this directory to determine if an oracle is active and should have pressure checked.

**Schema:**

```json
{
  "oracle_name": "string",
  "oracle_dir": "string (absolute path to <project>/oracle/)",
  "project_root": "string (absolute path to project root)",
  "pool_members_active": "number (count of active daemon pool members)",
  "written_at": "string (ISO 8601)"
}
```

**Lifecycle:**

- Created by `spawn_oracle` (FEAT-001): creates the `.pythia-active/` directory and writes the per-oracle JSON file
- Updated whenever pool membership changes
- Removed by `oracle_decommission_execute` (FEAT-012): removes the per-oracle file; if directory is empty after removal, directory is also removed
- Each file is written atomically via temp file + rename

**Discovery logic (post-tool-use hook):**
1. Check for `${projectRoot}/.pythia-active/` directory -- per-oracle JSON files inside
2. Fallback: registry lookup by longest `project_root` prefix match against `cwd`
3. If ambiguous: skip check (require explicit name)

**Design rationale:** Directory with per-oracle JSON files (not a single file) prevents concurrent write corruption when multiple oracles are active in the same project root.

---

## TypeScript Type Definitions (FEAT-016)

All types from `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` section "Concrete TypeScript Types":

```ts
// oracle-types.ts

export type OracleStatus =
  | "healthy" | "degraded" | "warning" | "critical" | "emergency"
  | "error" | "quota_exhausted" | "decommissioned";
// "degraded" = pool member(s) dead but oracle operational (partial pool failure)
// "warning"  = context pressure approaching checkpoint threshold

export interface DaemonPoolMember {
  daemon_id: string | null;                    // null when soft-dismissed (no live process)
  session_name: string;                        // e.g. "daemon-pythia-0" (stable, survives dismiss)
  session_dir: string | null;
  status: "idle" | "busy" | "dead" | "dismissed"; // dismissed = soft-dismissed, can respawn
  query_count: number;
  chars_in: number;
  chars_out: number;
  last_synced_interaction_id: string | null;   // for cross-daemon context sync
  last_query_at: string | null;                // ISO timestamp -- for idle timeout detection
  idle_timeout_ms?: number;                    // default: 300_000 (5 min) -- soft-dismiss after idle
  last_corpus_sync_hash: Record<string, string> | null; // per-source tree hashes at last sync
  pending_syncs: Array<{                       // queued corpus syncs awaiting injection
    source_id: string;
    tree_hash: string;
    payload_ref: string;                       // temp file or memory ref
    queued_at: string;
  }>;
}

export type OracleRecommendation = "healthy" | "checkpoint_soon" | "checkpoint_now" | "reconstitute";
export type CorpusRole = "core_research" | "prompt_architecture" | "pain_signals" | "learnings" | "checkpoint" | "other";
export type SyncMode = "manual" | "on_spawn" | "interval";
export type ReconstituteSyncMode = "hash_gated_delta" | "full_rescan";
// hash_gated_delta (default): tree hash fast gate + per-file diff, send only changed files
// full_rescan: re-send entire live_sources snapshot regardless of change

export interface StaticEntry {
  path: string;
  role: CorpusRole;
  required: boolean;
  sha256: string;
  added_at: string;
  priority?: number;           // sort order within role group (lower = earlier)
}

export interface LiveSource {
  id: string;
  root: string;
  include: string[];
  exclude: string[];
  role: CorpusRole;
  required: boolean;
  sync_mode: SyncMode;
  interval_seconds?: number;
  max_files?: number;
  max_sync_bytes?: number;              // default: 5_000_000 (5MB safety rail)
  reconstitute_sync_mode?: ReconstituteSyncMode; // default: "hash_gated_delta"
  priority?: number;                    // sort order within role group
  last_sync_at?: string;
  last_tree_hash?: string;             // fast gate: did anything change?
  last_file_hashes?: Record<string, string>; // precise diff: which files changed?
}

export interface OracleManifest {
  schema_version: number;
  name: string;
  project: string;
  version: number;
  checkpoint_headroom_tokens: number;
  pool_size: number;                   // default: 2; how many concurrent daemon members
  static_entries: StaticEntry[];
  live_sources: LiveSource[];
  load_order: CorpusRole[];
  created_at: string;
  last_spawned_at?: string;
}

export interface OracleState {
  schema_version: number;
  oracle_name: string;
  version: number;
  spawned_at: string | null;
  discovered_context_window: number | null;
  daemon_pool: DaemonPoolMember[];         // up to pool_size members; spawned on demand
  session_chars_at_spawn: number | null;   // bootstrap payload chars (same for all members)
  chars_per_token_estimate: number;        // default: 4 (fallback only when countTokens unavailable)
  token_count_method: "exact" | "estimate"; // [F16] Whether pressure uses countTokens API or char heuristic
  estimated_total_tokens: number | null;   // MAX across pool members (drives checkpoint)
  estimated_cluster_tokens: number | null; // SUM across pool members (observability only)
  tokens_remaining: number | null;         // based on highest-pressure pool member (MAX)
  query_count: number;                     // total queries across all pool members
  last_checkpoint_path: string | null;
  status: OracleStatus;
  lock_held_by: string | null;             // operation name holding the lock
  lock_expires_at: string | null;          // ISO timestamp -- TTL prevents orphans
  last_error: string | null;               // set when status === "error"
  last_bootstrap_ack: {                    // set after corpus load completes
    ok: boolean;
    raw: string;                           // Pythia's raw ack response
    checked_at: string;
  } | null;
  next_seq: number;                        // [F6] Monotonic counter for InteractionEntry.seq allocation
  generation_since_reground: number;       // [F12] Generations since last full corpus re-grounding (reset on reground)
  state_version: number;
  updated_at: string;
}

export interface OracleRegistryEntry {
  name: string;
  oracle_dir: string;                      // absolute path to <project>/oracle/
  project_root: string;                    // absolute path to project root
  created_at: string;
  decommissioned_at?: string;              // set on oracle_decommission
}

export type InteractionType = "consultation" | "feedback" | "sync_event" | "session_note";
export type InteractionScope = "architectural" | "operational" | "other";

export interface InteractionEntry {
  // Identity & sequencing
  id: string;                           // "v<N>-q<NNN>" or "v<N>-q<NNN>-fb"
  seq: number;                          // [F5] Monotonic sequence number (oracle-local, gap detection + replay)
  entry_schema_version: number;         // [F5] Per-entry schema version for upcasting (current: 2)
  type: InteractionType;
  oracle_name: string;
  version: number;
  query_count: number;
  timestamp: string;

  // Tracing (OpenTelemetry-compatible)
  trace_id: string;                     // [F18] Groups related operations (e.g. query → daemon ask → log)
  span_id: string;                      // [F18] Identifies this specific operation
  parent_span_id: string | null;        // [F18] Links to parent span (null for root spans)

  // Pressure snapshot
  tokens_remaining_at_query: number;
  chars_in_at_query: number;

  // Model provenance
  model_actual?: string;                // [F8] Which model actually responded (after fallback chain)

  // Interaction scope
  interaction_scope?: InteractionScope; // for consultation type

  // Consultation fields
  question?: string;
  ion_delegated?: boolean;              // true if this consultation was delegated to Ion
  ion_query?: string;                   // required if ion_delegated === true
  ion_response?: string;               // required if ion_delegated === true
  counsel?: string;                     // Pythia's full raw response (may incorporate Ion's answer)
  counsel_sha256?: string;              // [F17] SHA-256 hash of counsel content (integrity verification)
  decision?: string | null;            // what was decided; null if not yet determined
  quality_signal?: 1 | 2 | 3 | 4 | 5 | null; // set by Claude, not Pythia

  // Causal links
  caused_by?: string[];                 // [F7] Array of parent interaction IDs (builds decision graph)
  flags?: string[];

  // Usage telemetry
  usage?: {                             // [F5] Token accounting from Gemini API response
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
  };
  latency?: {                           // [F5] Timing metrics
    started_at: string;                 // ISO 8601
    first_token_ms?: number;            // Time to first token
    duration_ms: number;                // Total call duration
  };

  // Feedback fields
  references?: string;                  // consultation id this feedback closes
  implemented?: boolean;
  outcome?: string;                     // what actually happened
  divergence?: string;                  // how reality differed from counsel
}

export interface IonHandoffRequest {
  oracle_name: string;          // which oracle's context informed this delegation
  version: number;              // oracle generation at time of delegation
  query_id: string;             // the consultation id (e.g. "v1-q003") this derives from
  question: string;             // the specific question/task sent to Ion
  context_paths?: string[];     // relevant file paths Ion should read
  timeout_ms?: number;
}

export interface IonHandoffResponse {
  query_id: string;             // matches IonHandoffRequest.query_id
  success: boolean;
  response: string;             // Ion's raw response
  files_touched?: string[];     // files Ion created or modified
  commit_sha?: string;          // git commit sha if Ion committed
  error?: string;
  duration_ms: number;
}

export interface DegradationFlag {
  type: "length_drop" | "vagueness" | "self_contradiction" | "hallucination";
  query_id: string;
  tokens_remaining: number;
  description: string;
}

export interface QualityReport {
  oracle_name: string;
  version: number;
  query_count: number;
  degradation_onset_query?: string;
  degradation_onset_tokens_remaining?: number;
  avg_answer_length_early: number;
  avg_answer_length_late: number;
  length_trend_pct_change: number;
  code_symbol_density_early: number;    // ratio: code-like tokens / total words
  code_symbol_density_late: number;
  suggested_headroom_tokens?: number;   // P50(onset) + safety_buffer, clamped
  flags: DegradationFlag[];
  // v2: self_contradiction detection via LLM-as-judge (not implemented in v1)
}

export type OracleResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: { code: OracleErrorCode; message: string; retryable: boolean; details?: unknown } };

export type OracleErrorCode =
  | "ORACLE_NOT_FOUND" | "ORACLE_ALREADY_EXISTS" | "MANIFEST_INVALID" | "STATE_INVALID"
  | "DAEMON_NOT_FOUND" | "DAEMON_BUSY_QUERY" | "DAEMON_BUSY_LOCK" | "DAEMON_DEAD"
  | "DAEMON_QUOTA_EXHAUSTED" | "FILE_NOT_FOUND" | "HASH_MISMATCH"
  | "PRESSURE_UNAVAILABLE" | "CHECKPOINT_FAILED" | "BOOTSTRAP_FAILED"
  | "RECONSTITUTE_FAILED" | "IO_ERROR" | "CONCURRENCY_CONFLICT"
  | "CORPUS_CAP_EXCEEDED" | "LOCK_TIMEOUT" | "STALE_REGISTRY_PATH"
  | "DECOMMISSION_REFUSED" | "DECOMMISSION_TOKEN_EXPIRED" | "DECOMMISSION_CANCELLED"
  | "TOTP_INVALID" | "CONFIRMATION_PHRASE_MISMATCH";

// DAEMON_BUSY_QUERY: daemon processing a query (seconds) -- auto-retry transparently
// DAEMON_BUSY_LOCK:  heavyweight operation holds the lock (minutes) -- surface to user
```

---

## MCP Tool Contracts

### spawn_oracle (FEAT-001)

**Input:**

```json
{
  "name": "string (required -- oracle name, must match registry)",
  "reuse_existing": "boolean (default: true)",
  "force_reload": "boolean (default: false)",
  "force": "boolean (default: false)",
  "timeout_ms": "number (optional)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "oracle_name": "string",
    "version": "number",
    "pool": "DaemonPoolMember[]",
    "resumed": "boolean",
    "corpus_files_loaded": "number",
    "tokens_remaining": "number"
  }
}
```

**Output (error):**

```json
{
  "ok": false,
  "error": {
    "code": "OracleErrorCode",
    "message": "string",
    "retryable": "boolean",
    "details": "unknown (optional)"
  }
}
```

**Parameter matrix:**

| `reuse_existing` | `force_reload` | Session exists? | Behavior |
|---|---|---|---|
| `true` (default) | `false` (default) | Yes | Resume -- zero cost, full history |
| `true` | `true` | Yes | Re-send full corpus to live session (no version increment) |
| `false` | `false` | Yes | `ORACLE_ALREADY_EXISTS` -- explicit intent required |
| `false` | `false` | No | Fresh spawn + full bootstrap |
| `false` | `true` | Yes | `ORACLE_ALREADY_EXISTS` -- run `oracle_decommission_request` + `oracle_decommission_execute` first |
| `false` | `true` | No | Fresh spawn + full bootstrap |

`spawn_oracle` never hard-dismisses anything. Destruction requires the explicit `oracle_decommission_request` → `oracle_decommission_execute` protocol.

**Execution flow:**
1. Pass 1: `resolveCorpusForSpawn(name)` -- hash verification, glob resolution, token gate
2. Discovers context window from `CONTEXT_WINDOW_BY_MODEL` lookup
3. Spawns or resumes one pool member (spawn-on-demand -- additional members spawn when needed)
4. Pass 2: `loadResolvedCorpusIntoDaemon()` for the initial member
5. Validates bootstrap ack via `validateBootstrapAck(text)`
6. Writes `.pythia-active/<oracle-name>.json` marker file
7. Sets `session_chars_at_spawn` after full bootstrap completes
8. On first generation (v1): generates TOTP secret if none exists, displays QR code for authenticator enrollment

---

### oracle_sync_corpus (FEAT-002)

**Input:**

```json
{
  "name": "string (required)",
  "source_id": "string (optional -- sync specific live_source by id, or all if omitted)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "source_id": "string | 'all'",
    "files_synced": "number",
    "files_skipped": "number",
    "bytes_loaded": "number",
    "tree_hash": "string",
    "members_synced_immediately": "number",
    "members_queued": "number"
  }
}
```

**Behavior:**
- Resolves file list from `live_sources` globs (all sources, or specific `source_id`)
- Applies `max_files` and `max_sync_bytes` caps -- hard error (`CORPUS_CAP_EXCEEDED`) if exceeded
- Computes tree hash; if unchanged since `last_sync_at`, skip (no-op)
- Per-member sync dispatch:
  - Members with `status === "idle"`: inject sync payload immediately; update `last_corpus_sync_hash`; clear matching `pending_syncs`
  - Members with `status === "busy"`: push to `pending_syncs` array with `{ source_id, tree_hash, payload_ref, queued_at }`; drain happens at next `ask_daemon` call
  - Members with `status === "dismissed"` or `"dead"`: skip (they get current corpus on next spawn)
- Updates `last_sync_at` and `last_tree_hash` in manifest

---

### oracle_pressure_check (FEAT-003)

**Input:**

```json
{
  "name": "string (required)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "tokens_remaining": "number",
    "status": "OracleStatus",
    "recommendation": "OracleRecommendation ('healthy' | 'checkpoint_soon' | 'checkpoint_now' | 'reconstitute')"
  }
}
```

**Behavior:**
- Reads `state.json`; computes `tokens_remaining` from char totals using per-member MAX aggregation
- Updates `state.json` with latest estimate
- If no active pool members: returns `PRESSURE_UNAVAILABLE`
- Pressure computation:
  ```
  memberTokens[i] = (session_chars_at_spawn + member.chars_in + member.chars_out) / chars_per_token_estimate
  estimated_total_tokens = MAX(memberTokens)
  tokens_remaining = discovered_context_window - estimated_total_tokens
  needsCheckpoint = tokens_remaining < checkpoint_headroom_tokens
  needsUrgentCheckpoint = tokens_remaining < (checkpoint_headroom_tokens / 2)
  ```

---

### oracle_checkpoint (FEAT-004)

**Input:**

```json
{
  "name": "string (required)",
  "timeout_ms": "number (optional)",
  "commit": "boolean (default: true)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "checkpoint_path": "string (absolute path)",
    "bytes": "number",
    "sha256": "string",
    "version": "number"
  }
}
```

**Behavior:**
- Acquires operation lock; returns `DAEMON_BUSY_LOCK` if lock held
- Returns error if `tokens_remaining < checkpoint_headroom_tokens / 4` (too late to safely generate -- use `oracle_salvage` instead)
- **MANDATORY: temperature: 0** (decision #51 — prevents generational drift)
- Sends Pythia the checkpoint prompt with XML output tags:
  ```
  Write your checkpoint inside <checkpoint> tags. Cover:
  (1) All static corpus files loaded and key findings from each.
      DO NOT summarize source code -- summarize the architectural decisions
      and constraints that the code expresses.
  (2) Every question asked this session and your answer summary
  (3) Every architectural/strategic decision made based on your counsel
  (4) Your top 10 cross-cutting insights from the full corpus
  (5) Gaps, contradictions, or uncertainties detected
  (6) Source citations: every claim MUST cite the source document
      or interaction ID it originated from. If you cannot cite it,
      do not include it. (decision #51)
  Be exhaustive -- this is your legacy for your successor.
  ```
- Extracts checkpoint content via cascading pipeline (decision #46):
  - Step 1: Try `<checkpoint>...</checkpoint>` tag extraction
  - Step 2: If no tags, scrub known LLM wrapper patterns
  - Step 3: Use scrubbed full response as checkpoint, log warning
- Saves to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
- Adds checkpoint to manifest `static_entries` with `role: "checkpoint"`
- Git commits if `commit: true`
- Releases lock
- If Gemini returns a context-limit error mid-checkpoint: sets `status = "error"`, `last_error` records the message, state is written to disk, returns `CHECKPOINT_FAILED`, user should run `oracle_salvage`

---

### oracle_log_learning (FEAT-005)

**Input:**

```json
{
  "name": "string (required)",
  "entry": {
    "question": "string (required for consultation)",
    "counsel": "string (optional, full raw Pythia response)",
    "decision": "string | null (optional)",
    "type": "InteractionType (default: 'consultation')",
    "interaction_scope": "InteractionScope (optional)",
    "ion_delegated": "boolean (optional)",
    "ion_query": "string (required if ion_delegated === true)",
    "ion_response": "string (required if ion_delegated === true)",
    "quality_signal": "1 | 2 | 3 | 4 | 5 | null (optional)",
    "caused_by": "string[] (optional, parent interaction IDs)",
    "flags": "string[] (optional)",
    "model_actual": "string (optional, which model responded)",
    "references": "string (optional, for feedback type)",
    "implemented": "boolean (optional, for feedback type)",
    "outcome": "string (optional, for feedback type)",
    "divergence": "string (optional, for feedback type)"
  }
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "entry_id": "string (e.g. 'v1-q004')",
    "file_path": "string (absolute path to JSONL file)",
    "version": "number"
  }
}
```

**Validation:**
- If `ion_delegated === true`: requires non-empty `ion_query` and `ion_response`
- Appends structured `InteractionEntry` to `<oracle_dir>/learnings/v<N>-interactions.jsonl`
- Updates `query_count` in `state.json`
- Git commits are batched via `batchCommitLearnings()` -- writes to JSONL immediately (data safe on disk), defers `git commit` until flush trigger fires

**Auto-populated fields (tool fills, caller does NOT provide):**
- `id` -- generated from version + query_count (e.g. `v1-q004`)
- `seq` -- allocated from `state.json.next_seq` (monotonic, never reused)
- `entry_schema_version` -- hardcoded to current schema version (2)
- `timestamp` -- ISO 8601 at time of write
- `trace_id`, `span_id`, `parent_span_id` -- from active OTel span context
- `tokens_remaining_at_query`, `chars_in_at_query` -- from current pool member state
- `counsel_sha256` -- computed from `counsel` if present
- `usage` -- from Gemini API response `usage_metadata` (if available from the preceding `ask_daemon` call)
- `latency` -- from timing of the preceding `ask_daemon` call

---

### oracle_add_to_corpus (FEAT-006)

**Input:**

```json
{
  "name": "string (required)",
  "file_path": "string (required, absolute path)",
  "role": "CorpusRole (required)",
  "required": "boolean (optional, default: true)",
  "load_now": "boolean (optional, default: false)",
  "dedupe": "boolean (optional, default: true)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "entry": "StaticEntry",
    "already_present": "boolean",
    "loaded_into_daemon": "boolean"
  }
}
```

**Behavior:**
- Verifies file exists at `file_path`; reads sha256
- If `dedupe: true`: checks for duplicate path in `static_entries`
- Adds to `static_entries` in manifest
- If `load_now: true`: feeds file content to running daemon(s)

---

### oracle_update_entry (FEAT-007)

**Input:**

```json
{
  "name": "string (required)",
  "file_path": "string (required, absolute path)",
  "reason": "string (required, explains why the entry is being updated)",
  "expected_old_sha256": "string (optional, prevents stale updates)",
  "role": "CorpusRole (optional, update the role)",
  "required": "boolean (optional, update required flag)",
  "commit": "boolean (default: true)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "old_sha256": "string",
    "new_sha256": "string",
    "updated_at": "string (ISO 8601)"
  }
}
```

**Behavior:**
- For intentional updates to an existing static entry (research doc revised, new version)
- Verifies file exists and is already in manifest
- If `expected_old_sha256` provided: must match current manifest value (prevents stale updates); mismatch = `HASH_MISMATCH`
- Recomputes sha256 from current file contents
- Updates manifest entry atomically
- If `commit: true`: git commits the manifest change with `reason` in commit message

---

### oracle_salvage (FEAT-008)

**Input:**

```json
{
  "name": "string (required)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "checkpoint_path": "string (absolute path)",
    "source": "salvage",
    "entries_processed": "number"
  }
}
```

**Behavior:**
- For dead daemons that never checkpointed
- Uses a fresh single-shot Gemini API call (not the oracle daemon) to synthesize `vN-interactions.jsonl` into a checkpoint
- If interactions log is empty: generates stub checkpoint ("No new architectural decisions were recorded during Generation N.") and explicitly carries forward insights from v(N-1) checkpoint
- Saves to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`

---

### oracle_reconstitute (FEAT-009)

**Input:**

```json
{
  "name": "string (required)",
  "checkpoint_first": "boolean (default: true)",
  "dismiss_old": "boolean (default: true)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "previous_version": "number",
    "new_version": "number",
    "new_daemon_id": "string",
    "loaded_artifacts": "string[] (list of files loaded)"
  }
}
```

**Behavior (full cutover model -- no mixed generations, no rolling replacement):**
1. Acquires lock; returns `DAEMON_BUSY_LOCK` if lock held
2. **Drain phase:** waits for all active queries to complete (bounded timeout)
3. If `checkpoint_first: true` (default): calls `oracle_checkpoint` first (daemons still alive, full context)
4. **Shrink to zero:** soft-dismisses ALL pool members (preserve session data on disk)
5. Increments version N -> N+1
6. Manifest update: adds `vN-checkpoint.md` as `role: "checkpoint"` in `static_entries`. Does NOT re-add `vN-interactions.jsonl` -- checkpoint supersedes learnings for context
7. For `live_sources`: uses `reconstitute_sync_mode` (default `hash_gated_delta`) -- re-syncs only if hash changed
8. **Spawn v(N+1):** spawns one fresh member from checkpoint (not resuming old sessions). Seeds with generational continuity preamble (checkpoint content in `<inherited_wisdom>` tags)
9. Updates `state.json` with new version; clears `daemon_pool` and populates with fresh members
10. Releases lock

---

### oracle_quality_report (FEAT-010)

**Input:**

```json
{
  "name": "string (required)",
  "version": "number (optional -- defaults to current version)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "oracle_name": "string",
    "version": "number",
    "query_count": "number",
    "degradation_onset_query": "string (optional, e.g. 'v1-q042')",
    "degradation_onset_tokens_remaining": "number (optional)",
    "avg_answer_length_early": "number",
    "avg_answer_length_late": "number",
    "length_trend_pct_change": "number",
    "code_symbol_density_early": "number",
    "code_symbol_density_late": "number",
    "suggested_headroom_tokens": "number (optional)",
    "flags": "DegradationFlag[]"
  }
}
```

**Behavior:**
- Reads `vN-interactions.jsonl`
- Computes answer length trend over query count (shorter = degrading working memory)
- Computes Code-Symbol Density Ratio: percentage of proper nouns, camelCase identifiers, snake_case, file paths relative to total words. A drop indicates generic platitudes replacing specific codebase references.
- Tracks `tokens_remaining` at onset of each trend change
- Derives `suggested_headroom_tokens` via `computeSuggestedHeadroom()`:
  - v1 oracle with no degradation flags: returns `manifest.checkpoint_headroom_tokens` (250K default)
  - v2+ with degradation history: `clamp(P50(onset_tokens) + 50_000, 100_000, context_window * 0.5)`
- Self-contradiction detection: v2 only. `flags` array accepts `"self_contradiction"` entries for manual use, but auto-detection is not implemented in v1.

---

### oracle_decommission_request (FEAT-011)

**Input:**

```json
{
  "name": "string (required)",
  "reason": "string (required -- why this oracle is being decommissioned)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "oracle_name": "string",
    "decommission_token": "string (UUID, 10-minute TTL)",
    "expires_at": "string (ISO 8601)",
    "checklist": "string[] (steps the human must complete before oracle_decommission_execute)"
  }
}
```

**Behavior:**
- Phase 1 of the 7-step human-gated decommission protocol
- Validates oracle exists and is not already decommissioned
- Generates a unique `decommission_token` (UUID, 10-minute TTL) stored in-memory only on the `GeminiRuntime` singleton -- never written to `state.json` (which is git-tracked)
- Records the request with timestamp and reason in `vN-interactions.jsonl` as a `session_note`
- Returns the full checklist the human must complete
- Nothing is deleted at this step

**The 7-step decommission protocol (ALL required, in order):**

1. **Request phase** -- `oracle_decommission_request` generates token and checklist
2. **Human review checkpoint** -- User runs `/pythia quality` and `/pythia status`, takes a screenshot, submits to Claude for verification
3. **TOTP verification** -- User runs `pythia-auth` CLI binary, provides 6-digit TOTP code
4. **Typed confirmation phrase** -- User types: `"DELETE [oracle-name] generation [N] containing [query-count] interactions"`
5. **Cooling-off period** -- 5-minute wait; user can cancel with `oracle_decommission_cancel`
6. **Second confirmation** -- System prompts for re-confirmation after the wait
7. **Execute** -- `oracle_decommission_execute` fires with all prior steps validated

---

### oracle_decommission_execute (FEAT-012)

**Input:**

```json
{
  "name": "string (required)",
  "token": "string (required -- from oracle_decommission_request)",
  "totp_code": "string (required -- 6-digit TOTP from pythia-auth binary)",
  "confirmation_phrase": "string (required -- 'DELETE [name] generation [N] containing [count] interactions')"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "oracle_name": "string",
    "decommissioned_at": "string (ISO 8601)",
    "final_checkpoint_path": "string | null (absolute path)"
  }
}
```

**Behavior:**
- Phase 7 -- the actual destruction. Only reachable after all prior steps satisfied.
- Validates token matches, is not expired, TOTP is valid, confirmation phrase matches exactly
- Acquires operation lock
- Best-effort checkpoint or salvage (does not fail if this step fails)
- Hard-dismisses all daemon pool members (full session deletion)
- Sets `state.status = "decommissioned"`, clears `daemon_pool`
- Archives registry entry with `decommissioned_at` timestamp (does not delete entry)
- Removes `.pythia-active/<oracle-name>.json` marker file if present
- Releases lock
- Oracle data (`oracle/` directory) remains on disk as historical artifact -- never deleted

---

### oracle_decommission_cancel (FEAT-013)

**Input:**

```json
{
  "name": "string (required)",
  "token": "string (required -- from oracle_decommission_request)"
}
```

**Output (success):**

```json
{
  "ok": true,
  "data": {
    "oracle_name": "string",
    "cancelled_at": "string (ISO 8601)"
  }
}
```

**Behavior:**
- Cancels a pending decommission during the cooling-off period (step 5)
- Validates the token matches the active decommission request for this oracle
- Removes the token from the `GeminiRuntime.decommissionTokens` map
- Logs a `session_note` interaction: "Decommission cancelled by user"
- If no pending decommission: returns `DECOMMISSION_REFUSED` with message "No active decommission request"
- Can be called at any point after `oracle_decommission_request` and before `oracle_decommission_execute` completes

---

## Internal Function Contracts

### resolveCorpusForSpawn(name) (FEAT-019)

**Signature:**
```ts
async function resolveCorpusForSpawn(name: string): Promise<ResolvedCorpus>
```

**Purpose:** Pass 1 of two-pass corpus load. Runs before daemon exists.

**Input:** Oracle name (used to look up manifest via registry)

**Output:** `ResolvedCorpus` -- text payloads ready to inject, no I/O after this point

**Operations:**
1. Reads all static entry files from disk
2. Verifies sha256 hashes against manifest values; mismatch = hard error (`HASH_MISMATCH`)
3. Resolves `live_sources` globs, computes tree hash + per-file hashes
4. Estimates total tokens, enforces `CORPUS_CAP_EXCEEDED` gate:
   ```ts
   const charsPerToken = existingState?.chars_per_token_estimate ?? DEFAULT_CHARS_PER_TOKEN_ESTIMATE;
   const estimatedTokens = totalChars / charsPerToken;
   if (estimatedTokens > (discoveredContextWindow - manifest.checkpoint_headroom_tokens)) {
     throw OracleError("CORPUS_CAP_EXCEEDED", ...);
   }
   ```
5. Validates `MAX_BOOTSTRAP_STDIN_BYTES = 6_000_000` (hard limit on total stdin payload):
   ```ts
   if (totalBytes > MAX_BOOTSTRAP_STDIN_BYTES) {
     throw OracleError("CORPUS_CAP_EXCEEDED", `Bootstrap payload ${totalBytes} bytes exceeds ${MAX_BOOTSTRAP_STDIN_BYTES} byte stdin limit`);
   }
   ```
6. Applies `max_files` and `max_sync_bytes` caps per live_source

**Error cases:**
- `FILE_NOT_FOUND` -- static entry file does not exist on disk
- `HASH_MISMATCH` -- file content sha256 does not match manifest
- `CORPUS_CAP_EXCEEDED` -- total tokens exceed available context window, or total bytes exceed stdin limit
- `MANIFEST_INVALID` -- manifest parsing failure
- `IO_ERROR` -- filesystem read failure

---

### loadResolvedCorpusIntoDaemon(daemonId, resolvedCorpus) (FEAT-019)

**Signature:**
```ts
async function loadResolvedCorpusIntoDaemon(
  daemonId: string,
  resolvedCorpus: ResolvedCorpus
): Promise<{ session_chars_at_spawn: number; bootstrap_ack: { ok: boolean; raw: string } }>
```

**Purpose:** Pass 2 of two-pass corpus load. Runs after daemon is spawned/resumed.

**Input:** Daemon ID handle, resolved corpus from Pass 1

**Output:** Character count of bootstrap payload and bootstrap acknowledgment result

**Stream semantics:**
- Streams corpus to daemon stdin using `stream.write()` with drain handlers (not a single `.end(payload)` -- prevents backpressure failure on 5MB+ payloads)
- Message sequence:
  1. Continuity preamble (with `<inherited_wisdom>` containing extracted checkpoint content if v2+)
  2. Static entries in load_order / priority order
  3. Live source files in load_order / priority order
  4. Final "corpus loaded" acknowledgment prompt

**Ack validation:** Calls `validateBootstrapAck(text)` on Pythia's response. If Pythia responds with confusion (short response containing error/cannot/fail): sets `status = "error"`, `last_bootstrap_ack.ok = false`, returns `BOOTSTRAP_FAILED`

---

### writeStateWithRetry(oracleDir, mutator, opts) (FEAT-018)

**Signature:**
```ts
async function writeStateWithRetry(
  oracleDir: string,
  mutator: (s: OracleState) => OracleState,
  opts?: {
    maxRetries?: number;       // default: 5
    baseBackoffMs?: number;    // default: 100
    jitterMs?: number;         // default: 50
  }
): Promise<OracleState>
```

**Retry semantics:**
- Reads current state from disk
- Applies mutator function to produce new state
- Checks `state_version` matches what was read before writing
- If version has changed (concurrent write): waits `baseBackoffMs * 2^attempt + random(jitterMs)` and retries
- Returns `CONCURRENCY_CONFLICT` after `maxRetries` exhausted
- All state mutations go through this function -- no direct file writes

---

### acquireOperationLock(oracleDir, operation, opts)

**Signature:**
```ts
async function acquireOperationLock(
  oracleDir: string,
  operation: string,
  opts?: {
    waitTimeoutMs?: number;    // default: 30000 (30s)
    lockTtlMs?: number;        // default: 600000 (10 min)
  }
): Promise<{ lockToken: string }>
```

**Behavior:**
- Uses CAS via `writeStateWithRetry` to atomically set `lock_held_by` and `lock_expires_at`
- If lock is held by another operation: polls every 500ms up to `waitTimeoutMs` before returning `DAEMON_BUSY_LOCK`
- If lock is held but `lock_expires_at` has passed: forcibly acquires (TTL prevents orphaned locks on crash)
- Returns a `lockToken` used for heartbeat extension and release

**Heartbeat for long-running operations:**
```ts
const heartbeat = startLockHeartbeat({
  oracleDir, operation: "checkpoint", lockToken,
  extendEveryMs: 60_000, ttlMs: 600_000   // 10-minute TTL, renewed every 60s
});
try {
  // ... do checkpoint work ...
} finally {
  await heartbeat.stop();
  await releaseLock(oracleDir, lockToken);
}
```

---

### batchCommitLearnings() (FEAT-023)

**Purpose:** Batch `git commit` calls for JSONL interaction writes.

**Flush triggers:**
- Pending entries >= 10
- Pending bytes >= 256KB
- 30-second debounce timer expires
- Explicit `force: true` parameter
- Process shutdown hook (graceful cleanup)

**Semantics:** JSONL writes happen immediately to disk (data is safe). Only the `git commit` is deferred. This means data survives a crash; only the git history may lag.

---

### computeSuggestedHeadroom(qualityData) (FEAT-020)

**Purpose:** Derive an empirically-informed `checkpoint_headroom_tokens` value from quality report data.

**Formula:**
- v1 oracle with no degradation flags: returns `manifest.checkpoint_headroom_tokens` (250K default -- no data to improve on)
- v2+ with degradation history: `clamp(P50(tokens_remaining at first degradation flag across versions) + 50_000, 100_000, discovered_context_window * 0.5)`

**Clamping bounds:**
- Minimum: 100,000 tokens
- Maximum: `discovered_context_window * 0.5` (never reserve more than half the window)

---

### buildSpawnPreamble(opts)

**Signature:**
```ts
function buildSpawnPreamble(opts: {
  oracleName: string;
  nextVersion: number;
  inheritedWisdom?: string | null;
}): string
```

**v1 preamble** (`inheritedWisdom === null` -- no prior checkpoint):
```
You are Pythia -- the persistent knowledge oracle for [project].
You are the first of your lineage (v1). You have no prior checkpoints.
Your reality begins with the corpus load below. Build well.
```

**v(N+1) preamble** (checkpoint exists -- embedded inline if <= 180K chars):
```
You are Pythia -- the persistent knowledge oracle for [project].
You are version N+1. Your predecessor, Pythia vN, accumulated deep wisdom
and has passed it to you through the checkpoint below.

<inherited_wisdom>
[EXTRACTED CONTENT OF vN-checkpoint.md INSERTED HERE BY MCP SERVER]
</inherited_wisdom>

You are not starting over. You are the continuation of a lineage.
After reading your corpus, you will have:
- All the original research your predecessor had
- Everything your predecessor learned through active consultation
- Full awareness of what architectural decisions have already been made

You are Pythia. You always have been.
```

**`MAX_INHERITED_WISDOM_INLINE_CHARS = 180_000`** -- if the checkpoint exceeds this threshold, the preamble includes a brief lineage summary instead of the full text, and the full checkpoint is loaded as the first static chunk in Pass 2.

---

### validateBootstrapAck(text) (FEAT-019)

**Purpose:** Determine whether Pythia's response to the "corpus loaded" acknowledgment prompt indicates successful bootstrap.

**Success criteria:** Response is substantive (not short) and does not contain error/confusion indicators.

**Failure criteria:** Short response containing patterns like `error`, `cannot`, `fail`, `unable`, `I don't understand`. On failure: sets `status = "error"`, `last_bootstrap_ack.ok = false`, tool returns `BOOTSTRAP_FAILED`.

---

## Error Codes

| Code | When It Occurs | Retryable? | User-Visible? | Recovery Action |
|------|---------------|-----------|--------------|-----------------|
| `ORACLE_NOT_FOUND` | Oracle name not in registry or registry entry points to nonexistent directory | No | Yes | Register oracle or fix registry path |
| `ORACLE_ALREADY_EXISTS` | `spawn_oracle` with `reuse_existing: false` when oracle already exists | No | Yes | Use `reuse_existing: true` or `oracle_decommission_request` + `oracle_decommission_execute` first |
| `MANIFEST_INVALID` | Manifest parsing failure or schema violation | No | Yes | Fix manifest JSON; use `oracle_update_entry` for changes |
| `STATE_INVALID` | State file parsing failure or schema violation | No | Yes | Fix state JSON or reset from git history |
| `DAEMON_NOT_FOUND` | Referenced daemon_id does not exist in the runtime | No | Yes | Respawn oracle |
| `DAEMON_BUSY_QUERY` | Pool member is processing a query (duration: seconds) | Yes | No (auto-retry) | Auto-retry with short backoff; if `scaling_up: true`, a new member is being spawned |
| `DAEMON_BUSY_LOCK` | Heavyweight operation (checkpoint/reconstitute/decommission) holds the lock (duration: minutes) | Yes (after lock release) | Yes | Wait for operation to complete; retry after `lock_expires_at` |
| `DAEMON_DEAD` | Referenced daemon process has died | No | Yes | Respawn the pool member or run `oracle_salvage` |
| `DAEMON_QUOTA_EXHAUSTED` | All Gemini models in fallback chain exhausted | Yes (after ~1 hour TTL) | Yes | Wait for quota reset; `ask_daemon` probes for availability on next access |
| `FILE_NOT_FOUND` | A static entry file does not exist on disk | No | Yes | Restore file or remove entry from manifest |
| `HASH_MISMATCH` | File content sha256 does not match manifest value | No | Yes | Use `oracle_update_entry` to acknowledge the change |
| `PRESSURE_UNAVAILABLE` | No active pool members to measure pressure | No | Yes | Spawn oracle first |
| `CHECKPOINT_FAILED` | Checkpoint generation failed (e.g., context limit hit mid-checkpoint) | No | Yes | Run `oracle_salvage` to create checkpoint from interactions log |
| `BOOTSTRAP_FAILED` | Pythia responded with confusion to bootstrap ack prompt | No | Yes | Check corpus content; try respawn with `force_reload: true` |
| `RECONSTITUTE_FAILED` | Reconstitution process failed at any step | No | Yes | Check error details; may need manual checkpoint + respawn |
| `IO_ERROR` | Filesystem read/write failure | Yes | Yes | Check disk space, permissions; retry |
| `CONCURRENCY_CONFLICT` | `writeStateWithRetry` exhausted all retries (state_version conflict) | Yes | Yes | Retry the operation; reduce concurrent access |
| `CORPUS_CAP_EXCEEDED` | Total corpus tokens exceed available window, or bytes exceed `MAX_BOOTSTRAP_STDIN_BYTES` (6MB), or `max_sync_bytes` exceeded | No | Yes | Reduce corpus size or increase `checkpoint_headroom_tokens` |
| `LOCK_TIMEOUT` | Failed to acquire operation lock within `waitTimeoutMs` | Yes | Yes | Wait for current operation to complete; retry |
| `STALE_REGISTRY_PATH` | Registry entry `oracle_dir` points to a path that no longer exists | No | Yes | Update registry entry or restore directory |
| `DECOMMISSION_REFUSED` | Any decommission gate fails (wrong token, expired, missing step) | No | Yes | Follow the 7-step protocol completely |
| `DECOMMISSION_TOKEN_EXPIRED` | Decommission token has passed its 10-minute TTL | No | Yes | Re-request decommission with `oracle_decommission_request` |
| `DECOMMISSION_CANCELLED` | Decommission was cancelled via `oracle_decommission_cancel` | No | Yes | Re-request if still desired |
| `TOTP_INVALID` | TOTP code provided does not match expected value | No | Yes | Get fresh TOTP code from `pythia-auth` binary |
| `CONFIRMATION_PHRASE_MISMATCH` | Typed confirmation phrase does not match expected format | No | Yes | Type exact phrase: `"DELETE [name] generation [N] containing [count] interactions"` |

---

## Auth Architecture

### TOTP

**Purpose:** Physical gate preventing any AI agent from completing decommission without human involvement.

**Cross-platform model:**

| Platform | Secret Storage | Access Gate |
|----------|---------------|-------------|
| macOS | Keychain with `kSecAccessControlBiometryAny` | Touch ID (physical fingerprint) |
| Linux/Windows | `~/.pythia/keys/<name>.totp.enc` (encrypted at rest) | Passphrase prompt |

**`pythia-auth` binary:**
- Location: `~/.pythia/bin/pythia-auth`
- Type: Compiled Go or Rust binary (not a shell script -- inspectable/spoofable by agents with file write access)
- Behavior: Reads TOTP secret from platform-appropriate secure store, generates current 6-digit TOTP code (30-second expiry)
- NOT callable by Claude: requires interactive TTY, biometric/passphrase input
- NOT readable by Claude: secret stored in secure store, not in accessible files

**Three things Claude cannot do (one step):**
1. Claude cannot run `pythia-auth` interactively (TTY required)
2. Claude cannot read the secure store (biometric/passphrase required)
3. Claude cannot derive the TOTP code without the secret

**Master Recovery Key:**
- 256-bit key shown once at enrollment, never stored by the system
- Serves as fallback if the authenticator app is lost
- User's responsibility to store securely

**TOTP enrollment:**
- Triggered at first `spawn_oracle` (v1) if no TOTP secret exists for the oracle
- Generates secret, displays QR code in terminal for authenticator app scanning
- Secret stored in platform-appropriate secure store
- Never logged, never injected into any prompt, never accessible to MCP tools

### Decommission Token

**Purpose:** Ties a specific decommission request to its execution, with a time limit.

**Properties:**
- UUID format
- 10-minute TTL
- Stored **in-memory only** on the `GeminiRuntime` singleton (`decommissionTokens: Map<string, { token: string; expires_at: number }>`)
- Never persisted to `state.json` (which is git-tracked -- a token in state = a token in commit history = security breach)
- MCP server restart invalidates all tokens (user must re-request)
- This is a security feature, not a limitation

---

## OracleRuntimeBridge (FEAT-014, FEAT-015)

**Location:** Exported from `src/gemini/runtime.ts`
**Purpose:** Singleton bridge providing daemon lifecycle operations to both `tools.ts` (existing inter-agent tools) and `oracle-tools.ts` (Pythia tools).

```ts
export interface OracleRuntimeBridge {
  spawnDaemon(input: {
    session_name: string;
    cwd?: string;
    timeout_ms?: number;
  }): Promise<{ daemon_id: string; resumed: boolean; session_dir?: string }>;

  askDaemon(input: {
    daemon_id: string;
    question: string;
    timeout_ms?: number;
  }): Promise<{ text: string; chars_in: number; chars_out: number }>;

  dismissDaemon(input: {
    daemon_id: string;
    hard?: boolean;
  }): Promise<void>;

  getDaemonSessionDir(daemon_id: string): string | null;

  findDaemonBySessionName(session_name: string): { daemon_id: string; session_dir: string } | null;
}

export function getGeminiRuntime(): OracleRuntimeBridge { ... }
```

**Key properties:**
- Singleton per MCP server process -- shared by `tools.ts` and `oracle-tools.ts`
- Per-oracle instances would race and desync session state
- `askDaemon` returns `chars_in` and `chars_out` alongside the text response so `oracle-tools.ts` can update pressure metrics without re-counting strings
- Dismiss is always **soft** for oracle pool members (preserve sessions on disk). Hard dismiss (full deletion) only on explicit `oracle_decommission_execute` (after the full 7-step decommission protocol).

**In-memory state on the singleton:**
- `decommissionTokens: Map<string, { token: string; expires_at: number }>` -- decommission tokens, never persisted to disk (FEAT-035)
- `idleSweepInterval: NodeJS.Timeout` -- `setInterval` loop (every 60s) that sweeps all oracle pools for members where `Date.now() - last_query_at > idle_timeout_ms`. Expired members are soft-dismissed automatically. Started on singleton instantiation, cleared on process shutdown. This is the sole enforcement mechanism for idle timeouts. (FEAT-022)
- `ppidWatchdog: NodeJS.Timeout` -- `setInterval` loop (every 5s) that polls `process.ppid` to detect parent death (decision #48). If parent PID changes or disappears, executes tree-kill on all active daemon processes. Required because Claude Code sends `SIGKILL` on session end — `process.on('exit')` never fires. Also performs startup orphan sweep: on singleton instantiation, checks for PID files from previous crashes and kills any orphaned PTY processes before accepting tool calls.
- `toolMutex: Mutex` -- `async-mutex` instance protecting all async read-modify-write sequences on the singleton (decision #47). Acquired before any pool state modification (spawn, dismiss, route query, update member status). Prevents corruption from concurrent MCP tool dispatch.

---

## Context Window Discovery (FEAT-014)

```ts
const CONTEXT_WINDOW_BY_MODEL: Record<string, number> = {
  "gemini-2.5-pro":           2_000_000,
  "gemini-2.5-flash":         1_000_000,
  "gemini-3-pro-preview":     2_000_000,
  "gemini-3-flash-preview":   1_000_000,
};

export function discoverContextWindow(modelName: string): number {
  return CONTEXT_WINDOW_BY_MODEL[modelName.toLowerCase()] ?? 2_000_000; // conservative fallback
}
```

Hardcoded lookup -- technical debt acknowledged for v1. Update when Google provides a context-introspection API. Discovered dynamically at `spawn_oracle` time and stored in `state.json`.

---

## Post-Tool-Use Hook Integration (FEAT-033)

**File:** `~/.claude/hooks/post-tool-use.sh`
**Trigger:** Every 5 tool calls when an oracle is active

**Active oracle discovery:**
1. Check for `${projectRoot}/.pythia-active/` directory -- read per-oracle JSON files
2. Fallback: registry lookup by longest `project_root` prefix match against `cwd`
3. If ambiguous: skip check (require explicit name)

**Action:** If oracle found and `status` is not `"decommissioned"`: call `oracle_pressure_check` (FEAT-003)

**Note:** `"dead"` is a `DaemonPoolMember.status` value, not an `OracleStatus` value. The oracle itself is never `"dead"` -- individual pool members can be.

---

*"The corpus is the Oracle. The daemon is the vessel. The vessel is replaceable. The corpus is eternal."*
