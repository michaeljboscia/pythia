# PYTHIA: Persistent Knowledge Oracle — MCP Feature Design Brief

**Created:** 2026-03-05
**Revised:** 2026-03-05 (v3 — second twin review pass)
**Author:** Claude (design session with Mike Boscia) + Gemini + Codex review (×2)
**Target repos:** `~/.claude/mcp-servers/inter-agent/` + `~/.claude/`
**Status:** Design v3 — final design, ready for implementation

---

## Naming

**Pythia** — the title of the Delphic Oracle. Each generation is a new Pythia,
a new vessel channeling the same sacred accumulated wisdom. When one Pythia's
context expires, the next is born already knowing everything the last one learned.

The corpus is the Oracle. The daemon is the vessel. The vessel is replaceable.
The corpus is eternal.

---

## What We're Building

A system for spawning, maintaining, and reconstituting a persistent Gemini daemon
("Pythia") that serves as a living knowledge base for a long-running project. Pythia
loads a large research corpus once, answers questions across sessions, detects when
its context is under pressure, checkpoints its learnings to disk, and reconstitutes
itself across generations — each version inheriting everything its predecessors learned.

This is a first-class feature addition to the inter-agent MCP server
(`~/.claude/mcp-servers/inter-agent/`) and a new slash command/skill.

### Horizon Note

Gemini's context window is on an upward trajectory: 2M today, 3M/4M/5M ahead.
This system is designed to get *better* over time, not fight against limits.
As the window grows, reconstitution becomes less frequent, generations last longer,
and the corpus + running code + Q&A all fit in a single Pythia simultaneously.
Design for permanence — not survival.

### The Larger Pattern: Version Control for Latent Space

Git tracks **what**. Jira/Linear tracks **who/when**. Nothing tracks **why** —
the reasoning, discarded alternatives, and architectural intent that lives only
in the developer's head or in transient chat logs. Pythia makes it permanent
and addressable.

In 2–3 years this becomes:
- **Context poisoning immune system**: `oracle_quality_report` detects hallucination
  onset, auto-rolls back to the last clean interaction, forks the timeline
- **Fine-tuning dataset**: `vN-interactions.jsonl` is high-signal, project-specific
  training data for bespoke smaller models — Pythia becomes a distillation engine
- **Branchable reasoning**: "Reconstitute from v3-q105, assume Postgres not Mongo"
  — fork the oracle's worldview at any interaction point, simulate alternate
  architectural realities

This is a continuous integration pipeline for architectural reasoning.
The JSONL logging and absolute headroom model are the bedrock it all stands on.

---

## Core Problems Being Solved

1. **Context pressure is invisible** — a daemon loaded with 200K tokens of corpus
   silently loses fidelity as Q&A exchanges accumulate. Nobody knows until it gives
   a wrong answer.

2. **Reconstitution is manual and lossy** — when a daemon dies, re-loading files
   from a memory of file paths works once, but the Q&A history and decisions made
   are lost forever.

3. **Generational learning is impossible** — Pythia v1 counseled decisions. Pythia v2
   has no idea what those decisions were. Each generation starts dumber than it
   should.

4. **No corpus integrity** — no manifest, no hashes, no guarantee that "load the
   corpus" loads the same files in the same order with the same content as last time.

5. **No degradation visibility** — no way to know when and why Pythia's answer quality
   degraded, making threshold tuning impossible without empirical data.

---

## Architecture

### State Artifacts (all on disk, all git-tracked)

```
~/.claude/oracles/
└── <oracle-name>/
    ├── manifest.json              ← canonical corpus definition (static + live sources)
    ├── state.json                 ← current daemon_id, version, pressure metrics
    ├── learnings/
    │   ├── v1-interactions.jsonl  ← structured per-query record (roll fwd/back)
    │   ├── v2-interactions.jsonl
    │   └── ...
    └── checkpoints/
        ├── v1-checkpoint.md       ← Pythia v1's self-written synthesis before death
        └── v2-checkpoint.md
```

**Key design decision:** `vN-interactions.jsonl` is the primary audit trail —
not a summary, not markdown prose. Every consultation is a structured, addressable,
replayable event. Checkpoints are derived from it. Degradation analysis reads it.
Dead-letter salvage reconstructs from it if the daemon dies without a clean checkpoint.

### manifest.json schema

The corpus is split into two tiers:
- **`static_entries`**: hash-pinned research docs, manually managed, loaded once
- **`live_sources`**: glob-based code roots, snapshot-managed, re-synced on spawn or change

They load differently, degrade differently, and checkpoint differently.
Critically: **code is never checkpointed** — architectural decisions *governing*
the code are. Code is already checkpointed perfectly by Git.

```json
{
  "schema_version": 1,
  "name": "pythia",
  "project": "narrative-generator-rebuild",
  "version": 1,
  "checkpoint_headroom_tokens": 250000,
  "static_entries": [
    {
      "path": "/full/absolute/path/to/file.md",
      "role": "core_research | prompt_architecture | pain_signals | learnings | checkpoint | other",
      "required": true,
      "sha256": "abc123...",
      "added_at": "2026-03-05T10:00:00-05:00"
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
      "max_total_bytes": 500000,
      "last_sync_at": null,
      "last_tree_hash": null
    }
  ],
  "load_order": ["core_research", "prompt_architecture", "pain_signals", "learnings", "checkpoint"],
  "created_at": "2026-03-05T10:20:00-05:00",
  "last_spawned_at": "2026-03-05T10:20:00-05:00"
}
```

**Note:** `context_window_tokens` is NOT stored in the manifest. It is discovered
dynamically at `spawn_oracle` time from the model config and stored in `state.json`.
This allows the system to automatically adapt as Gemini's context window grows —
no manual reconfiguration required.

**`checkpoint_headroom_tokens`** (default: 250,000) is the single pressure trigger.
Checkpoint fires when: `estimated_total_tokens > (discovered_context_window - checkpoint_headroom_tokens)`.
At 2M window: checkpoints with 250K left. At 10M window: still 250K left.
Scales automatically across all window sizes.

### state.json schema

```json
{
  "schema_version": 1,
  "oracle_name": "pythia",
  "session_name": "daemon-pythia",
  "daemon_id": "gd_mmdkx0g8_1",
  "version": 1,
  "spawned_at": "2026-03-05T10:20:00-05:00",
  "session_dir": "/Users/mikeboscia/.gemini/daemon-sessions/daemon-pythia",
  "discovered_context_window": 2000000,
  "session_chars_at_spawn": 844900,
  "chars_in_total": 920000,
  "chars_out_total": 45000,
  "estimated_total_tokens": 241250,
  "tokens_remaining": 1758750,
  "query_count": 3,
  "last_checkpoint_path": null,
  "status": "healthy",
  "state_version": 1,
  "updated_at": "2026-03-05T10:25:00-05:00"
}
```

**`state_version`** is an optimistic concurrency counter — increment on every write.
Concurrent tools check that the version they read matches before writing; otherwise retry.
This prevents `manifest.json`/`state.json` corruption under parallel tool calls.

---

## Daemon Architecture: Persistent, Not Disposable

The original daemon model treated sessions as ephemeral: spawn → use → dismiss.
Pythia requires rethinking this. An oracle that holds 200K+ tokens of corpus is
**expensive to reconstitute** — not just in time, but in the quality of the bootstrapped
state. The right model is:

- **Daemons are long-lived first-class entities**, keyed by `session_name` not `daemon_id`
- `session_name` is the stable identity. `daemon_id` is just a handle to the current process
- On `spawn_oracle`, if a session with that `session_name` exists on disk, **resume it**
  (zero-cost, instant, full history preserved) — don't bootstrap fresh
- Dismiss is **always soft** for oracle daemons — preserve the session on disk
- Hard dismiss (full deletion) only on explicit `oracle_decommission`

### Gemini Module Refactor: `gemini/runtime.ts`

`oracle-tools.ts` cannot access the private `_sessions` map in `gemini/tools.ts`.
The fix: extract daemon lifecycle into a singleton `GeminiRuntime` in a new file,
which both `tools.ts` and `oracle-tools.ts` import.

```
src/gemini/
├── runtime.ts    ← NEW: singleton owning _sessions, daemon lifecycle
├── server.ts     ← unchanged
└── tools.ts      ← REFACTORED: uses runtime, no longer owns _sessions
```

### OracleRuntimeBridge (exported from `gemini/runtime.ts`)

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
  }): Promise<{ text: string }>;

  dismissDaemon(input: {
    daemon_id: string;
    hard?: boolean;
  }): Promise<void>;

  getDaemonSessionDir(daemon_id: string): string | null;

  // Needed for oracle resume: find a running daemon by its stable session name
  findDaemonBySessionName(session_name: string): { daemon_id: string; session_dir: string } | null;
}

// Singleton — one bridge per MCP server process, shared by tools.ts and oracle-tools.ts
export function getGeminiRuntime(): OracleRuntimeBridge { ... }
```

**Bridge is a singleton per MCP server process.** Per-oracle instances would race
and desync session state.

---

## Context Pressure Detection

### Approach: MCP-side char tracking

Track `chars_in + chars_out` inside the MCP server as each `ask_daemon` call completes.
Far more accurate than reading raw JSON session files (JSON envelope bloats 3–5x).
No external processes. No self-probing the model.

```ts
// Updated in state.json after every ask_daemon call:
chars_in_total  += prompt.length;
chars_out_total += response.length;
estimated_total_tokens = (chars_in_total + chars_out_total + session_chars_at_spawn) / 4;
tokens_remaining = discovered_context_window - estimated_total_tokens;

// Single trigger — absolute headroom, not percentage:
const needsCheckpoint = tokens_remaining < manifest.checkpoint_headroom_tokens;
const needsUrgentCheckpoint = tokens_remaining < (manifest.checkpoint_headroom_tokens / 2);
```

### Pressure model (absolute headroom)

| Tokens Remaining | Status | Action |
|-----------------|--------|--------|
| > `headroom` | Healthy | Normal operation |
| `headroom/2` – `headroom` | Warning | Notify, checkpoint soon |
| < `headroom/2` | Critical | **Auto-checkpoint now** |
| Checkpoint complete | — | Reconstitute into v(N+1) |

This scales across all window sizes. At 2M: checkpoints with 250K left.
At 10M: still 250K left. Both get the same quality checkpoint.

---

## Interaction Tracking & Degradation Monitoring

Every consultation is a structured event written to `vN-interactions.jsonl`:

```jsonl
{
  "id": "v1-q003",
  "oracle_name": "pythia",
  "version": 1,
  "query_count": 3,
  "timestamp": "2026-03-05T10:25:00-05:00",
  "tokens_remaining_at_query": 1758750,
  "chars_in_at_query": 920000,
  "question": "What is the recommended persona mapping strategy for cold outreach?",
  "counsel": "<full raw Pythia response>",
  "decision": "Use 3-tier persona framework: executive / practitioner / evaluator",
  "quality_signal": null,
  "flags": []
}
```

### Roll-forward / Roll-back

Because every interaction is addressable by `id`, the system can:
- **Roll forward**: replay interactions from any prior checkpoint to a specific state
- **Roll back**: identify the exact query where degradation began and reconstruct
  from just before it
- **Fork**: reconstitute from `v3-q105` with different assumptions — branch the oracle's
  worldview and simulate alternate architectural realities

`oracle_salvage` can synthesize a checkpoint from `vN-interactions.jsonl` even if
the daemon died before checkpointing. The learnings log is always the source of truth.

### Degradation Detection (`oracle_quality_report`)

Reads `vN-interactions.jsonl` and surfaces:
- Answer length trend over query count (shorter = degrading working memory)
- Answer specificity trend (vague = losing corpus fidelity)
- Self-contradiction detection (compared to earlier answers)
- `tokens_remaining` at onset of each trend change

Over time, thresholds become per-oracle: a 43-file dense research corpus + full
codebase degrades at a different rate than a 10-file architecture corpus.
Empirical data from `oracle_quality_report` informs per-oracle `checkpoint_headroom_tokens`.

---

## New MCP Tools to Build

Add to `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

### Common result envelope

```ts
type OracleResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: { code: OracleErrorCode; message: string; retryable: boolean; details?: unknown } };

type OracleErrorCode =
  | "ORACLE_NOT_FOUND" | "MANIFEST_INVALID" | "STATE_INVALID" | "DAEMON_NOT_FOUND"
  | "DAEMON_BUSY" | "DAEMON_DEAD" | "FILE_NOT_FOUND" | "HASH_MISMATCH"
  | "PRESSURE_UNAVAILABLE" | "CHECKPOINT_FAILED" | "RECONSTITUTE_FAILED"
  | "IO_ERROR" | "CONCURRENCY_CONFLICT" | "CORPUS_CAP_EXCEEDED";
```

### `spawn_oracle(name, reuse_existing?, force_reload?, timeout_ms?)`
- Reads manifest; verifies sha256 of all `required: true` static entries
- Calls `runtime.spawnDaemon(session_name: "daemon-<name>")` — resumes if exists
- Resolves `live_sources` via `oracle_sync_corpus` (on_spawn sources)
- Discovers `context_window_tokens` from model config, stores in state.json
- Sends generational continuity preamble + corpus load (in `load_order`)
- Records `session_dir`, `session_chars_at_spawn`, `discovered_context_window`
- Returns: `{ oracle_name, version, daemon_id, resumed, corpus_files_loaded, tokens_remaining }`

### `oracle_sync_corpus(name, source_id?)`
- Resolves file list from `live_sources` globs (all sources, or specific `source_id`)
- Applies `max_files` and `max_total_bytes` caps — hard error if exceeded
- Computes tree hash; if unchanged since `last_sync_at`, skip (no-op)
- Loads only changed/new files into daemon: "Updated source files. Read and absorb: [paths]"
- Updates `last_sync_at` and `last_tree_hash` in manifest
- Returns: `{ source_id, files_synced, files_skipped, bytes_loaded, tree_hash }`

### `oracle_pressure_check(name)`
- Reads state.json; computes `tokens_remaining` from char totals
- Updates state.json with latest estimate
- Returns: `{ tokens_remaining, status, recommendation: "healthy"|"checkpoint_soon"|"checkpoint_now"|"reconstitute" }`

### `oracle_checkpoint(name, timeout_ms?, commit?)`
- Enforced: returns error if `tokens_remaining < checkpoint_headroom_tokens / 4`
  (too late to safely generate — use `oracle_salvage` instead)
- Sends Pythia the checkpoint prompt with XML output tags:
  ```
  Write your checkpoint inside <checkpoint> tags. Cover:
  (1) All static corpus files loaded and key findings from each.
      DO NOT summarize source code — summarize the architectural decisions
      and constraints that the code expresses.
  (2) Every question asked this session and your answer summary
  (3) Every architectural/strategic decision made based on your counsel
  (4) Your top 10 cross-cutting insights from the full corpus
  (5) Gaps, contradictions, or uncertainties detected
  Be exhaustive — this is your legacy for your successor.
  ```
- Extracts `<checkpoint>...</checkpoint>` from response
- Saves to `~/.claude/oracles/<name>/checkpoints/v<N>-checkpoint.md`
- Adds checkpoint to manifest `static_entries` with `role: "checkpoint"`
- Git commits if `commit: true` (default true)
- Uses job-store for async mode (`job_mode: "async"`)
- Returns: `{ checkpoint_path, bytes, sha256, version }`

### `oracle_reconstitute(name, checkpoint_first?, dismiss_old?)`
- If `checkpoint_first: true` (default): calls `oracle_checkpoint` first
- Increments version N → N+1
- Manifest update: adds `vN-checkpoint.md` as `role: "checkpoint"` in `static_entries`
  **Does NOT re-add `vN-interactions.jsonl`** — checkpoint supersedes learnings
- Calls `spawn_oracle(name)` — loads corpus + single checkpoint only
- Seeds with generational continuity preamble
- Soft-dismisses old daemon; updates state.json
- Returns: `{ previous_version, new_version, new_daemon_id, loaded_artifacts }`

### `oracle_log_learning(name, question, counsel, decision, source_daemon_id?)`
- Appends structured `InteractionEntry` to `v<N>-interactions.jsonl`
- Updates `query_count`, `chars_in_total`, `chars_out_total` in state.json
- **Batched git commits** — write N entries, commit once per batch (not per-entry)
  to avoid `index.lock` collisions under rapid queries
- Returns: `{ entry_id, file_path, version }`

### `oracle_add_to_corpus(name, file_path, role, required?, load_now?, dedupe?)`
- Verifies file exists; reads sha256; checks for duplicate
- Adds to `static_entries` in manifest
- If `load_now: true`: feeds to running daemon
- Returns: `{ entry, already_present, loaded_into_daemon }`

### `oracle_salvage(name)`
- For dead daemons that never checkpointed
- Uses a fresh single-shot Gemini call (not the oracle daemon) to synthesize
  `vN-interactions.jsonl` into a checkpoint
- Saves to `checkpoints/v<N>-checkpoint.md`
- Returns: `{ checkpoint_path, source: "salvage", entries_processed }`

### `oracle_quality_report(name, version?)`
- Reads `vN-interactions.jsonl`
- Computes answer length trend, `tokens_remaining` at each query, degradation onset
- Returns `QualityReport` — empirical data for tuning `checkpoint_headroom_tokens`

---

## Slash Command / Skill

Create `~/.claude/skills/pythia.md`:

### `/pythia [query]`
- No query: show status (tokens_remaining, version, query count)
- With query: `oracle_pressure_check` → `ask_daemon` → `oracle_log_learning`
- Auto-checkpoint if `tokens_remaining < headroom`

### `/pythia sync [source_id]`
- Sync live_sources (all or specific source) into running daemon

### `/pythia reconstitute` / `/pythia checkpoint` / `/pythia salvage`

### `/pythia add <filepath> [role]`

### `/pythia status` — manifest, state, pressure, version history, degradation summary

### `/pythia quality` — run degradation report on current version

---

## Generational Continuity Protocol

When Pythia v(N+1) is spawned, it receives this preamble **before** the corpus load:

```
You are Pythia — the persistent knowledge oracle for [project].
You are version N+1. Your predecessor, Pythia vN, accumulated deep wisdom
and has passed it to you through the checkpoint in your corpus.

<inherited_wisdom>
Everything vN learned from the research corpus, every question it was asked,
every decision it counseled, and every insight it synthesized is in
vN-checkpoint.md — which you will read as part of your corpus load.
</inherited_wisdom>

You are not starting over. You are the continuation of a lineage.
After reading your corpus, you will have:
- All the original research your predecessor had
- Everything your predecessor learned through active consultation
- Full awareness of what architectural decisions have already been made

You are Pythia. You always have been.
```

**`vN-checkpoint.md` completely supersedes `vN-interactions.jsonl` for context.**
The checkpoint is the distilled learnings. The interactions log is archived for
tooling and analysis. This keeps each generation's baseline bounded to:
corpus + one checkpoint — not corpus + all prior logs.

---

## Concrete TypeScript Types

```ts
// oracle-types.ts
export type OracleHealth = "healthy" | "warning" | "critical" | "emergency";
export type OracleRecommendation = "healthy" | "checkpoint_soon" | "checkpoint_now" | "reconstitute";
export type CorpusRole = "core_research" | "prompt_architecture" | "pain_signals" | "learnings" | "checkpoint" | "other";
export type SyncMode = "manual" | "on_spawn" | "interval";

export interface StaticEntry {
  path: string;
  role: CorpusRole;
  required: boolean;
  sha256: string;
  added_at: string;
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
  max_total_bytes?: number;
  last_sync_at?: string;
  last_tree_hash?: string;
}

export interface OracleManifest {
  schema_version: number;
  name: string;
  project: string;
  version: number;
  checkpoint_headroom_tokens: number;
  static_entries: StaticEntry[];
  live_sources: LiveSource[];
  load_order: CorpusRole[];
  created_at: string;
  last_spawned_at?: string;
}

export interface OracleState {
  schema_version: number;
  oracle_name: string;
  session_name: string;
  daemon_id: string | null;
  version: number;
  spawned_at: string | null;
  session_dir: string | null;
  discovered_context_window: number | null;
  session_chars_at_spawn: number | null;
  chars_in_total: number;
  chars_out_total: number;
  estimated_total_tokens: number | null;
  tokens_remaining: number | null;
  query_count: number;
  last_checkpoint_path: string | null;
  status: OracleHealth;
  state_version: number;
  updated_at: string;
}

export interface InteractionEntry {
  id: string;                           // "v<N>-q<NNN>"
  oracle_name: string;
  version: number;
  query_count: number;
  timestamp: string;
  tokens_remaining_at_query: number;
  chars_in_at_query: number;
  question: string;
  counsel: string;                      // full raw Pythia response
  decision: string;                     // what was decided based on counsel
  quality_signal: number | null;        // 1-5 explicit rating, null if not rated
  flags: string[];
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
  suggested_headroom_tokens?: number;   // empirically derived recommendation
  flags: DegradationFlag[];
}

export type OracleResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: { code: OracleErrorCode; message: string; retryable: boolean; details?: unknown } };

export type OracleErrorCode =
  | "ORACLE_NOT_FOUND" | "MANIFEST_INVALID" | "STATE_INVALID" | "DAEMON_NOT_FOUND"
  | "DAEMON_BUSY" | "DAEMON_DEAD" | "FILE_NOT_FOUND" | "HASH_MISMATCH"
  | "PRESSURE_UNAVAILABLE" | "CHECKPOINT_FAILED" | "RECONSTITUTE_FAILED"
  | "IO_ERROR" | "CONCURRENCY_CONFLICT" | "CORPUS_CAP_EXCEEDED";
```

---

## Implementation Order

1. **`gemini/runtime.ts`**: Extract `_sessions` and daemon lifecycle into singleton.
   Export `OracleRuntimeBridge`. Refactor `tools.ts` to use it.

2. **`oracle-types.ts`**: All interfaces/types above.

3. **State artifacts**: Directory structure, seed `manifest.json` and `state.json`
   for the active narrative-generator-rebuild corpus (43 static files + codebase live_source).

4. **`spawn_oracle` + `oracle_sync_corpus`**: Hash-verify static entries, resolve
   live_sources, resume if session exists, send preamble + corpus load.

5. **`oracle_pressure_check`**: MCP-side char tracking, absolute headroom model.

6. **`oracle_checkpoint`**: headroom enforcement, XML-tagged output, async via job-store.

7. **`oracle_log_learning`**: Batched git commits.

8. **`oracle_salvage`**: Dead-letter checkpoint from interactions log.

9. **`oracle_reconstitute`**: checkpoint-supersedes-learnings pattern.

10. **`oracle_quality_report`**: Degradation analysis + `suggested_headroom_tokens`.

11. **Slash command / skill** (`~/.claude/skills/pythia.md`).

12. **Post-tool-use hook**: Check pressure every N tool calls when oracle is active.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `~/.claude/oracles/pythia/manifest.json` | CREATE — seed with 43 static files + codebase live_source |
| `~/.claude/oracles/pythia/state.json` | CREATE — seed from current active daemon |
| `~/.claude/oracles/pythia/learnings/v1-interactions.jsonl` | CREATE — empty |
| `~/.claude/mcp-servers/inter-agent/src/oracle-types.ts` | CREATE |
| `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` | CREATE |
| `~/.claude/mcp-servers/inter-agent/src/gemini/runtime.ts` | CREATE — singleton bridge |
| `~/.claude/mcp-servers/inter-agent/src/gemini/tools.ts` | MODIFY — use runtime, remove _sessions |
| `~/.claude/mcp-servers/inter-agent/src/index.ts` | MODIFY — register oracle tools |
| `~/.claude/skills/pythia.md` | CREATE |
| `~/.claude/hooks/post-tool-use.sh` | MODIFY — oracle pressure check |

---

## Resolved Design Decisions

1. **Checkpoint trigger:** Absolute headroom (`tokens_remaining < checkpoint_headroom_tokens`), not percentage.
2. **Context window:** Discovered dynamically at spawn time, stored in `state.json`. Not hardcoded.
3. **Code checkpointing:** Never. Checkpoint architectural decisions governing the code, not the code itself.
4. **Corpus tiers:** `static_entries` (hash-pinned) + `live_sources` (glob-managed snapshots). Separate tools.
5. **Generational bloat:** Checkpoint supersedes learnings. v(N+1) loads corpus + one checkpoint only.
6. **Learning log ownership:** `oracle_log_learning` called by Claude after each consultation. Batched commits.
7. **Corpus integrity:** Hash-verified absolute paths. Hash mismatch = hard error on spawn.
8. **Context Caching API:** Implement in v1 — natural fit for static corpus separation.
9. **Oracle scope:** Project-scoped. One Pythia per project.
10. **Multi-oracle support:** Oracle-agnostic from day one — `name` param mandatory on all tools.
11. **Bridge architecture:** Singleton `GeminiRuntime` per MCP server process, shared by all tools.

---

## Background: Why This Was Built

The immediate trigger was loading 43 research files (~111,662 words, ~844K chars)
into a Gemini daemon for the GTM Machine narrative generator rebuild. The corpus
loaded successfully in one shot. But the question arose: what happens when this
session ages, context fills, or the daemon needs to be rebuilt?

The answer became a full generational oracle architecture. The name "Pythia"
was chosen because each historical Pythia was a new woman who channeled the
same divine accumulated wisdom at Delphi — a new vessel, the same oracle.
That's exactly the pattern: new daemon, same Pythia, richer than the last.

---

*"The corpus is the Oracle. The daemon is the vessel. The vessel is replaceable.
The corpus is eternal."*
