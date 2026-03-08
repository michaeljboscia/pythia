# PYTHIA: Persistent Knowledge Oracle — MCP Feature Design Brief

**Created:** 2026-03-05
**Revised:** 2026-03-06 (v6 — three interrogation passes, 65+ assumptions resolved)
**Author:** Claude (design session with Mike Boscia) + Gemini + Codex review (×3)
**Target repos:** `~/pythia/` (engine) + `<project>/oracle/` dirs (data)
**Status:** Design v6 — implementation-ready (round 3 answers written in)

---

## Naming

**Pythia** — the title of the Delphic Oracle. Each generation is a new Pythia,
a new vessel channeling the same sacred accumulated wisdom. When one Pythia's
context expires, the next is born already knowing everything the last one learned.

**Ion** — in Euripides' *Ion*, the young male temple servant raised from birth at
Delphi. He sweeps the sanctuary, tends the sacred grounds, and handles all the
practical work the Pythia never touches. The oracle speaks; Ion does.
In this system: Ion is Codex. Pythia reasons. Ion executes.

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

### Engine vs. Data

The Pythia system is split across two locations:

- **Engine** (`~/pythia/`) — the MCP tools, types, skills, and registry. Lives outside
  any project. Managed globally.
- **Data** (`<project>/oracle/`) — the oracle's manifest, state, interactions log, and
  checkpoints. Lives **inside the project repo**, committed alongside the code it
  documents. First-class artifact.

This means oracle evolution and code evolution are interleaved in the same `git log`.
The `project/oracle/` directory is visible, intentional, and fully version-controlled.
Anyone who clones the repo gets the full oracle history.

### Pluggable Corpus Backend (Future Integration Point)

Pythia's corpus loading is currently file-based: `resolveCorpusForSpawn()` reads files
from disk per the manifest, hashes them, and injects them into the daemon. This is
intentionally designed as a **swappable backend**.

A future "Living Corpus System" (knowledge graph + vector index + tiered retrieval)
will replace the file-based corpus with a retrieval pipeline:
- Today: `manifest.json` → read files → hash → inject into daemon
- Tomorrow: `retrieve_context(query, constraints)` → graph traversal + vector search → inject curated slice

**Design constraints to preserve this future:**
1. All corpus loading goes through `resolveCorpusForSpawn()` — no tool reads files directly
2. The daemon receives text payloads, not file paths — the source of those payloads is opaque
3. `vN-interactions.jsonl` entries are structured ADR-like artifacts — they become first-class
   nodes in the future knowledge graph (Pythia generates the seed data for LCS)
4. The `OracleRuntimeBridge` interface is stable — the retrieval backend changes behind it

This is not a v1 feature. It is a v1 **architectural constraint** — don't build anything
that assumes corpus = files on disk in a way that can't be swapped later.

### State Artifacts (all in project repo, all git-tracked)

```
<project-root>/
└── oracle/
    ├── manifest.json              <- canonical corpus definition (static + live sources)
    ├── state.json                 <- current daemon_id, version, pressure metrics
    ├── learnings/
    │   ├── v1-interactions.jsonl  <- structured per-query record (roll fwd/back)
    │   ├── v2-interactions.jsonl
    │   └── ...
    └── checkpoints/
        ├── v1-checkpoint.md       <- Pythia v1's self-written synthesis before death
        └── v2-checkpoint.md
```

`~/pythia/registry.json` maps oracle names to project `oracle_dir` paths:

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

Oracle names are globally unique among non-decommissioned entries. `registerOracle()`
enforces uniqueness at write time and rejects duplicates. The `name` is a user-defined
logical identifier (project slug). Multiple named oracles per project root are allowed
(e.g., `pythia-frontend` and `pythia-backend` in the same project).

**Registry writes are atomic** — all writes go through a temp file + rename pattern
to prevent partial writes from corrupting the registry. `registry.json` is also
git-tracked in `~/pythia/`, so `git checkout registry.json` is always a valid
recovery path. No `.bak` file needed — git is the backup.

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
  "pool_size": 2,
  "created_at": "2026-03-05T10:20:00-05:00",
  "last_spawned_at": "2026-03-05T10:20:00-05:00"
}
```

**Load order within a role group:** sorted by `priority ASC, added_at ASC, path ASC`.
This guarantees strict determinism across reconstitutions.

**`max_sync_bytes`** (default: 5,000,000 = 5MB) is a safety rail against accidentally
globbing `node_modules/` or `dist/`. Throws `CORPUS_CAP_EXCEEDED` if exceeded.
It is not a restriction on real codebases — 5MB covers substantial projects.

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
  "state_version": 1,
  "updated_at": "2026-03-05T10:25:00-05:00"
}
```

**`state_version`** is an optimistic concurrency counter — increment on every write.
All state writes go through `writeStateWithRetry()` which re-reads, re-applies the
mutation, and retries (up to 5 times, exponential backoff with jitter) if
`state_version` has changed on disk between read and write.

**`lock_held_by` / `lock_expires_at`**: operations that must not run concurrently
(checkpoint, reconstitute, decommission) acquire a named lock before proceeding.
Locks have a TTL to prevent orphans on crash. If a lock is held, competing operations
return `DAEMON_BUSY_LOCK` and the caller can retry after `lock_expires_at`.

**`chars_per_token_estimate`** (default: 4) is the chars-to-tokens ratio. The `/4`
heuristic has a ±10-15% error margin on English/code text — exactly why the absolute
headroom (250K tokens) is large enough to absorb the variance.

**`session_chars_at_spawn`** captures the exact character count of the final,
concatenated bootstrap payload (preamble + all corpus content) injected at
`spawn_oracle` time. Set after the full corpus load completes. Post-spawn
consultations accumulate into each pool member's `chars_in` / `chars_out` separately.

---

## Daemon Architecture: Spawn-on-Demand Pool

The original daemon model treated sessions as ephemeral: spawn → use → dismiss.
Pythia requires rethinking this. An oracle that holds 200K+ tokens of corpus is
**expensive to reconstitute** — not just in time, but in the quality of the bootstrapped
state. The right model is:

- **Oracles maintain a pool of daemons** — `pool_size` (default: 2) is a **ceiling**,
  not an always-on target. Members are spawned on demand and dismissed when idle.
- Queries route to whichever member is idle. If all members are busy and `pool_size`
  allows, the tool kicks off an async spawn in the background and returns
  `DAEMON_BUSY_QUERY` with `scaling_up: true` — Claude retries after a short delay.
  If the pool is already at ceiling, returns `DAEMON_BUSY_QUERY` with `scaling_up: false`.
- Each pool member is keyed by `session_name` (e.g., `daemon-pythia-0`, `daemon-pythia-1`).
  `daemon_id` is just a handle to the current process.
- On `spawn_oracle`, a single pool member is bootstrapped (or resumed if session exists).
  Additional members are spawned only when concurrent access is needed.
- Pool size 1 = single-threaded (original model). Pool size 2 = frontend + backend
  simultaneously. Pool size N = team deployment.
- **Idle timeout:** Pool members track `last_query_at`. After `idle_timeout_ms`
  (default: 300,000 = 5 minutes), idle members are soft-dismissed to free resources.
  The post-tool-use hook checks idle members on each pressure check cycle.
- Dismiss is **always soft** for oracle pool members — preserve sessions on disk.
- Hard dismiss (full deletion) only on explicit `oracle_decommission`.
- **Spawn-on-demand eliminates the stale-member problem.** A freshly spawned member
  bootstraps from the current checkpoint at spawn time, starting with
  `last_synced_interaction_id` at the current JSONL head — zero sync delta.

### Pool Pressure Aggregation

**`estimated_total_tokens = MAX(memberTokens)`**, not SUM. Each pool member has
its own independent context window — 1M tokens in member-0 plus 1M in member-1
does NOT mean 2M exhaustion risk for either. The highest-pressure member determines
the oracle's overall pressure status.

**`estimated_cluster_tokens = SUM(memberTokens)`** is tracked as an observability
metric only (total Gemini resource consumption), but it does NOT drive checkpoint
decisions. Only MAX matters for context exhaustion.

Formula per member:
```
memberTokens[i] = (session_chars_at_spawn + member.chars_in + member.chars_out) / chars_per_token_estimate
```

### Partial Pool Failure

If one member in the pool dies or errors while others remain healthy, the oracle
transitions to `status: "degraded"` (not `"warning"` — that's reserved for context pressure). Specific behaviors:
- Queries continue routing to healthy members
- The dead member's slot remains in `daemon_pool` with `status: "dead"`
- `/pythia status` surfaces the warning with details on which member failed
- The user can explicitly respawn the failed member or let spawn-on-demand handle it

### Cross-Daemon Context Sync

Pool members share the same corpus but develop independent conversation histories.
To keep them loosely aligned, before routing any query to daemon N, the MCP server
injects recent decisions the daemon hasn't seen yet:

```
[Context sync — decisions since your last query:
- v1-q004: Chose JWT for auth (from parallel session)
- v1-q005: API is REST not GraphQL (from parallel session)]

Your question: [actual question]
```

Each pool member tracks `last_synced_interaction_id`. The sync payload is the delta
from that ID to the current head of `vN-interactions.jsonl`. If nothing is new, no
injection. One or two recent decisions = a few hundred chars — negligible context cost.

### Gemini Module Refactor: `gemini/runtime.ts`

`oracle-tools.ts` cannot access the private `_sessions` map in `gemini/tools.ts`.
The fix: extract daemon lifecycle into a singleton `GeminiRuntime` in a new file,
which both `tools.ts` and `oracle-tools.ts` import.

```
src/gemini/
├── runtime.ts    <- NEW: singleton owning _sessions, daemon lifecycle
├── server.ts     <- unchanged
└── tools.ts      <- REFACTORED: uses runtime, no longer owns _sessions
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
  }): Promise<{ text: string; chars_in: number; chars_out: number }>;

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

Note: `askDaemon` now returns `chars_in` and `chars_out` alongside the text response,
so `oracle-tools.ts` can update pressure metrics without re-counting strings.

**In-memory state on the GeminiRuntime singleton:**
The singleton also holds ephemeral data that must NOT be persisted to disk:
- `decommissionTokens: Map<string, { token: string; expires_at: number }>` —
  decommission tokens are stored here, never in `state.json` (which is git-tracked).
  Token expires after 10 minutes. If the MCP server restarts, the token is lost —
  the user must re-request decommission. This is a feature, not a bug.
- `idleSweepInterval: NodeJS.Timeout` — a `setInterval` loop (every 60s) that
  sweeps all oracle pools for members where `Date.now() - last_query_at > idle_timeout_ms`.
  Expired members are soft-dismissed automatically. Started on singleton instantiation,
  cleared on process shutdown. This is the sole enforcement mechanism for idle timeouts —
  no lazy evaluation needed at tool-call time.

---

## Corpus Load Mechanics

### MCP-side content injection (canonical mechanism)

The MCP server reads all corpus files from disk and injects their contents as raw text
into the daemon. Pythia never receives file paths and reads them herself. This is
non-negotiable because:

1. The MCP server must token-count each file before loading to enforce the corpus cap
2. Error handling (missing files, hash mismatches) belongs in the MCP layer, not the model
3. Path-based loading obscures how much of the context window the corpus consumes

### Two-pass corpus load

Corpus loading is split into two clearly separated phases:

**Pass 1 — `resolveCorpusForSpawn(name)`** (before daemon exists):
- Reads all static entry files, verifies sha256 hashes
- Resolves live_sources globs, computes tree hash + per-file hashes
- Estimates total tokens, enforces `CORPUS_CAP_EXCEEDED` gate
- Validates `MAX_BOOTSTRAP_STDIN_BYTES = 6_000_000` (hard limit on total stdin payload)
- Returns `ResolvedCorpus` — text payloads ready to inject, no I/O after this point

**Pass 2 — `loadResolvedCorpusIntoDaemon(daemonId, resolvedCorpus)`** (after daemon spawned):
- Streams corpus to daemon stdin using `stream.write()` with drain handlers
  (not a single `.end(payload)` — prevents backpressure failure on 5MB+ payloads)
- Sends final "corpus loaded" acknowledgment prompt
- Validates bootstrap ack via `validateBootstrapAck(text)` — if Pythia responds
  with confusion (short response containing error/cannot/fail), sets
  `status = "error"`, `last_bootstrap_ack.ok = false`, returns `BOOTSTRAP_FAILED`
- Records `session_chars_at_spawn` after full bootstrap completes

### Token gate before spawn

```ts
// Uses hardcoded default (4) if OracleState doesn't exist yet (v1 spawn)
// Reads prior state.json chars_per_token_estimate if available (v2+ spawn)
const charsPerToken = existingState?.chars_per_token_estimate ?? DEFAULT_CHARS_PER_TOKEN_ESTIMATE;
const estimatedTokens = totalChars / charsPerToken;

if (estimatedTokens > (discoveredContextWindow - manifest.checkpoint_headroom_tokens)) {
  throw OracleError("CORPUS_CAP_EXCEEDED", ...);
}
if (totalBytes > MAX_BOOTSTRAP_STDIN_BYTES) {
  throw OracleError("CORPUS_CAP_EXCEEDED", `Bootstrap payload ${totalBytes} bytes exceeds ${MAX_BOOTSTRAP_STDIN_BYTES} byte stdin limit`);
}
```

### Context window discovery

```ts
// Hardcoded lookup — technical debt acknowledged for v1
// Update when Google provides a context-introspection API
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

### Spawn message sequence

```
1. Continuity preamble (with <inherited_wisdom> containing extracted checkpoint content)
2. Static entries in load_order / priority order
3. Live source files in load_order / priority order
4. Final "corpus loaded" acknowledgment prompt
```

The checkpoint file content is extracted by the MCP server and embedded directly
inside `<inherited_wisdom>` tags in the preamble — not loaded as a separate document.
This ensures identity integration happens before any other content is read.

---

## Context Pressure Detection

### Approach: MCP-side char tracking

Track `chars_in + chars_out` inside the MCP server as each `ask_daemon` call completes.
Far more accurate than reading raw JSON session files (JSON envelope bloats 3–5x).
No external processes. No self-probing the model.

```ts
// Updated in state.json after every ask_daemon call:
// Per-member tracking:
member.chars_in  += response.chars_in;
member.chars_out += response.chars_out;
member.last_query_at = new Date().toISOString();

// Pool-wide aggregation (MAX for checkpoint, SUM for observability):
const activeMembers = state.daemon_pool.filter(m => m.status !== "dismissed" && m.status !== "dead");
if (activeMembers.length === 0) {
  // Empty pool — no daemons running, no pressure to measure
  estimated_total_tokens = null;
  estimated_cluster_tokens = null;
  tokens_remaining = null;
  // oracle_pressure_check returns PRESSURE_UNAVAILABLE
} else {
  const memberTokens = activeMembers.map(m =>
    (session_chars_at_spawn + m.chars_in + m.chars_out) / state.chars_per_token_estimate
  );
  estimated_total_tokens = Math.max(...memberTokens);     // drives checkpoint decision
  estimated_cluster_tokens = memberTokens.reduce((a, b) => a + b, 0); // observability only
  tokens_remaining = discovered_context_window - estimated_total_tokens;
}

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

### Hard context limit failure mode

If pressure estimation is off and Gemini returns a context-limit error mid-checkpoint:

1. The MCP server catches the error
2. `OracleState.status` is set to `"error"`, `last_error` records the message
3. State is written to disk before the error propagates
4. The tool returns `CHECKPOINT_FAILED`
5. The user is instructed to run `oracle_salvage` — which uses a fresh single-shot
   API call (not the oracle daemon) to synthesize the interactions log into a checkpoint

---

## Interaction Tracking & Degradation Monitoring

Every consultation is a structured event written to `vN-interactions.jsonl`:

```jsonl
{
  "id": "v1-q003",
  "type": "consultation",
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
the daemon died before checkpointing. If `vN-interactions.jsonl` is empty,
`oracle_salvage` generates a stub: *"No new architectural decisions were recorded
during Generation N."* and explicitly carries forward insights from `v(N-1)` checkpoint.

### Degradation Detection (`oracle_quality_report`)

Reads `vN-interactions.jsonl` and surfaces:
- Answer length trend over query count (shorter = degrading working memory)
- Answer specificity trend: Code-Symbol Density Ratio (percentage of proper nouns,
  camelCase identifiers, snake_case, file paths relative to total words). A drop
  indicates generic platitudes replacing specific codebase references.
- `tokens_remaining` at onset of each trend change
- `suggested_headroom_tokens`: derived from `P50(tokens_remaining at first degradation flag
  across versions) + safety_buffer`, clamped to `[100000, discovered_context_window * 0.5]`

**v2 feature (not in v1):** Self-contradiction detection — comparing current answers
against prior entries via LLM-as-judge pass. This requires a separate LLM call per
interaction and is out of v1 scope. Stub: `flags` array accepts `"self_contradiction"`
type, but detection is manual (user-flagged) in v1.

Over time, thresholds become per-oracle: a 43-file dense research corpus + full
codebase degrades at a different rate than a 10-file architecture corpus.
Empirical data from `oracle_quality_report` informs per-oracle `checkpoint_headroom_tokens`.

---

## The Feedback Loop

Pythia is not a read-only oracle. The system closes the loop between what Pythia
recommends and what actually happened in the codebase.

### Interaction types

- `"consultation"` — Pythia answers an architectural question
- `"feedback"` — records outcome of a prior consultation (what was implemented, divergence)
- `"sync_event"` — live_sources re-synced; new code state loaded
- `"session_note"` — architectural context note not tied to a specific question

### Feedback entries

```jsonl
{
  "id": "v1-q003-fb",
  "type": "feedback",
  "oracle_name": "pythia",
  "version": 1,
  "query_count": 0,
  "timestamp": "2026-03-05T14:00:00-05:00",
  "tokens_remaining_at_query": 1700000,
  "chars_in_at_query": 950000,
  "references": "v1-q003",
  "implemented": true,
  "outcome": "3-tier persona framework shipped. Executive tier performs 2.3x better.",
  "divergence": "Evaluator persona collapsed into Practitioner — not enough volume to split."
}
```

Checkpoints inherit outcome data — v(N+1) knows what worked, not just what was recommended.
This is the mechanism that makes Pythia smarter over generations, not just more informed.

### Enforcement

Feedback logging is driven by Claude via the `/pythia` skill conventions. There is no
hard programmatic gate — only Claude's judgment about which consultations produced
architectural outcomes worth recording. Per-line feedback would pollute the interactions
log with noise. Curated entries only.

### Ion handoff logging

When a consultation is delegated to Ion (Codex), Claude logs the full triad event:

```ts
oracle_log_learning({
  name: "pythia",
  question: "...",
  counsel: "...",           // Pythia's architectural guidance
  decision: "...",
  ion_delegated: true,
  ion_query: "...",         // the specific prompt sent to Ion
  ion_response: "..."       // Ion's raw response
})
```

Validation: `ion_delegated === true` requires non-empty `ion_query` and `ion_response`.

---

## Ion Handoff Protocol

Ion (Codex) never receives work directly from Pythia. Claude is the sole orchestrator.
The flow is always:

```
Claude → Pythia (what is the architecture?)
Claude → Ion (build this, here are the constraints)
Claude → Pythia (sync: here is what Ion shipped)
```

### IonHandoffRequest / IonHandoffResponse

These interfaces define the structured envelope Claude uses when delegating to Ion
and when logging the result back to Pythia. They are logging contracts, not
programmatic function call signatures.

```ts
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
```

### Reality sync

After Ion ships substantive code, `/pythia sync` must be called to update the
live_sources snapshot in Pythia's context. This is enforced by convention in the
`/pythia` skill: any Claude session that concludes an Ion delegation should call
`oracle_sync_corpus` before the next consultation.

---

## New MCP Tools to Build

Add to `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

### Common result envelope

```ts
type OracleResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: { code: OracleErrorCode; message: string; retryable: boolean; details?: unknown } };

// SUPERSEDED: This early error code list is incomplete.
// See "Canonical OracleErrorCode (25 codes)" in the Tool Contracts section below
// for the authoritative, complete union type.
type OracleErrorCode =
  | "ORACLE_NOT_FOUND" | "MANIFEST_INVALID" | "STATE_INVALID" | "DAEMON_NOT_FOUND"
  | "DAEMON_BUSY_QUERY" | "DAEMON_BUSY_LOCK" | "DAEMON_DEAD" | "DAEMON_QUOTA_EXHAUSTED" | "FILE_NOT_FOUND"
  | "HASH_MISMATCH" | "PRESSURE_UNAVAILABLE" | "CHECKPOINT_FAILED"
  | "RECONSTITUTE_FAILED" | "IO_ERROR" | "CONCURRENCY_CONFLICT"
  | "CORPUS_CAP_EXCEEDED" | "LOCK_TIMEOUT";
```

### `spawn_oracle(name, reuse_existing?, force_reload?, force?, timeout_ms?)`

**Parameter matrix:**

| `reuse_existing` | `force_reload` | Session exists? | Behavior |
|---|---|---|---|
| `true` (default) | `false` (default) | Yes | Resume — zero cost, full history |
| `true` | `true` | Yes | Re-send full corpus to live session (no version increment) |
| `false` | `false` | Yes | `ORACLE_ALREADY_EXISTS` — explicit intent required |
| `false` | `false` | No | Fresh spawn + full bootstrap |
| `false` | `true` | Yes | `ORACLE_ALREADY_EXISTS` — run `oracle_decommission` first |
| `false` | `true` | No | Fresh spawn + full bootstrap |

`spawn_oracle` never hard-dismisses anything. Destruction requires explicit `oracle_decommission`.

**Execution:**
- Pass 1: `resolveCorpusForSpawn(name)` — hash verification, glob resolution, token gate
- Discovers context window from `CONTEXT_WINDOW_BY_MODEL` lookup
- Spawns or resumes **one** pool member (spawn-on-demand — additional members spawn when needed)
- Pass 2: `loadResolvedCorpusIntoDaemon()` for the initial member
- Writes `.pythia-active/<oracle-name>.json` marker file
- Returns: `{ oracle_name, version, pool, resumed, corpus_files_loaded, tokens_remaining }`

### `oracle_sync_corpus(name, source_id?)`
- Resolves file list from `live_sources` globs (all sources, or specific `source_id`)
- Applies `max_files` and `max_sync_bytes` caps — hard error if exceeded
- Computes tree hash; if unchanged since `last_sync_at`, skip (no-op)
- **Per-member sync dispatch:**
  - For members with `status === "idle"`: inject sync payload immediately
    ("Updated source files. Read and absorb: [content]"). Update member's
    `last_corpus_sync_hash` and clear any matching `pending_syncs` entries.
  - For members with `status === "busy"`: push to `pending_syncs` array with
    `{ source_id, tree_hash, payload_ref, queued_at }`. Drain happens at next
    `ask_daemon` call (see below).
  - For members with `status === "dismissed"` or `"dead"`: skip (they'll get
    current corpus on next spawn).
- Updates `last_sync_at` and `last_tree_hash` in manifest
- Returns: `{ source_id, files_synced, files_skipped, bytes_loaded, tree_hash, members_synced_immediately, members_queued }`

**`ask_daemon` pending sync drain:** Before routing any query to a member, check its
`pending_syncs` array. If non-empty, pop all entries, concatenate payloads, inject as
a single "Updated source files..." message, then send the user's query. Update
`last_corpus_sync_hash` and clear the array after successful injection.

### `oracle_pressure_check(name)`
- Reads state.json; computes `tokens_remaining` from char totals
- Updates state.json with latest estimate
- Returns: `{ tokens_remaining, status, recommendation: "healthy"|"checkpoint_soon"|"checkpoint_now"|"reconstitute" }`

### `oracle_checkpoint(name, timeout_ms?, commit?)`
- Acquires lock before proceeding; returns `DAEMON_BUSY_LOCK` if lock held
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
- Saves to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
  (where `oracle_dir` is resolved from `registry.json`)
- Adds checkpoint to manifest `static_entries` with `role: "checkpoint"`
- Git commits if `commit: true` (default true)
- Releases lock
- Returns: `{ checkpoint_path, bytes, sha256, version }`

### `oracle_reconstitute(name, checkpoint_first?, dismiss_old?)`

**Full cutover model — no mixed generations, no rolling replacement.**
All pool members reconstitute together as a single atomic generation transition.
Mixed generations (some members on vN, others on v(N+1)) are forbidden — they would
produce inconsistent answers depending on which member handles the query.

- Acquires lock; returns `DAEMON_BUSY_LOCK` if lock held (no mid-consultation interrupt)
- **Drain phase:** waits for all active queries to complete (bounded timeout)
- If `checkpoint_first: true` (default): calls `oracle_checkpoint` first
- **Shrink to zero:** soft-dismisses ALL pool members (preserve session data on disk)
- Increments version N → N+1
- Manifest update: adds `vN-checkpoint.md` as `role: "checkpoint"` in `static_entries`
  **Does NOT re-add `vN-interactions.jsonl`** — checkpoint supersedes learnings for context
- For `live_sources`: uses `hash_gated_delta` by default — re-syncs only if hash changed
- **Spawn v(N+1):** spawns one fresh member from checkpoint (not resuming old sessions).
  Spawn-on-demand applies — additional members spawn when concurrent access is needed.
- Seeds with generational continuity preamble (checkpoint content in `<inherited_wisdom>`)
- Updates state.json with new version; clears `daemon_pool` and populates with fresh members
- Releases lock
- Returns: `{ previous_version, new_version, new_daemon_id, loaded_artifacts }`

### `oracle_log_learning(name, entry)`
- Appends structured `InteractionEntry` to `<oracle_dir>/learnings/v<N>-interactions.jsonl`
- Validates: if `ion_delegated: true`, requires non-empty `ion_query` and `ion_response`
- Updates `query_count` in state.json
- **Batched git commits via `batchCommitLearnings()`** — writes to JSONL immediately
  (data safe on disk), defers `git commit` until any flush trigger fires:
  - Pending entries ≥ 10
  - Pending bytes ≥ 256KB
  - 30-second debounce timer
  - Explicit `force: true`
  - Process shutdown hook
- Returns: `{ entry_id, file_path, version }`

### `oracle_add_to_corpus(name, file_path, role, required?, load_now?, dedupe?)`
- Verifies file exists; reads sha256; checks for duplicate
- Adds to `static_entries` in manifest
- If `load_now: true`: feeds to running daemon
- Returns: `{ entry, already_present, loaded_into_daemon }`

### `oracle_update_entry(name, file_path, reason, expected_old_sha256?, role?, required?, commit?)`
- For intentional updates to an existing static entry (research doc revised, new version)
- Verifies file exists and is already in manifest
- If `expected_old_sha256` provided: must match current manifest value (prevents stale updates)
- Recomputes sha256 from current file contents
- Updates manifest entry atomically
- If `commit: true` (default): git commits the manifest change with reason in commit message
- Returns: `{ old_sha256, new_sha256, updated_at }`
- Manual manifest edits remain a hard error on spawn — always use this tool

### `oracle_salvage(name)`
- For dead daemons that never checkpointed
- Uses a fresh single-shot Gemini call (not the oracle daemon) to synthesize
  `vN-interactions.jsonl` into a checkpoint
- If interactions log is empty: generates stub checkpoint carrying forward v(N-1) insights
- Saves to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
- Returns: `{ checkpoint_path, source: "salvage", entries_processed }`

### `oracle_quality_report(name, version?)`
- Reads `vN-interactions.jsonl`
- Computes answer length trend, Code-Symbol Density Ratio, `tokens_remaining` at each query
- Derives `suggested_headroom_tokens` via `computeSuggestedHeadroom()`:
  - v1 oracle with no degradation flags → returns `manifest.checkpoint_headroom_tokens` (250K default)
  - v2+ with degradation history → `clamp(P50(onset_tokens) + 50_000, 100_000, context_window * 0.5)`
- Self-contradiction detection: **v2 only** — `flags` array accepts `"self_contradiction"` entries
  for manual use, but auto-detection is not implemented in v1
- Returns `QualityReport`

### `oracle_decommission_request(name, reason)`

Phase 1 of a 7-step human-gated decommission protocol. Logs intent, generates an
expiring token, returns a checklist. **Nothing is deleted at this step.**

- Validates oracle exists and is not already decommissioned
- Generates a unique `decommission_token` (UUID, 10-minute TTL) stored **in-memory only**
  in the `GeminiRuntime` singleton (never written to `state.json` — `state.json` is
  git-tracked, so a token in state = a token in commit history = security breach)
- Records the request with timestamp and reason in `vN-interactions.jsonl`
- Returns the full checklist the human must complete before `oracle_decommission_execute`

### `oracle_decommission_execute(name, token, totp_code, confirmation_phrase)`

Phase 7 — the actual deletion. Only reachable after all prior steps are satisfied.
This tool is deliberately difficult to reach. That is the design.

**The 7-step protocol (ALL steps required, in order):**

1. **Request phase** — `oracle_decommission_request(name, reason)` generates the token
   and checklist. Nothing deleted. Token expires in 10 minutes.

2. **Human review checkpoint** — User runs `/pythia quality` and `/pythia status`,
   reviews what is about to be destroyed. User takes a **screenshot** of that output
   and submits it to Claude. Claude verifies the screenshot shows the correct oracle
   name, version, and state. This step proves a human physically looked at what they
   are deleting. Claude cannot generate this screenshot.

3. **TOTP verification** — A physical gate that no agent can bypass:
   - User runs the standalone `pythia-auth` CLI binary (not an MCP tool) directly
     in their terminal. This binary is NOT callable by Claude. Located at
     `~/.pythia/bin/pythia-auth` — compiled Go or Rust binary (not a shell script,
     which would be inspectable/spoofable by an agent with file write access).
   - **Cross-platform core (TOTP + Master Recovery Key):**
     The binary reads the TOTP secret from its platform-appropriate secure store
     and generates the current 6-digit TOTP code. It expires in 30 seconds.
     A Master Recovery Key (256-bit, shown once at enrollment, never stored by the
     system) serves as fallback if the authenticator app is lost.
   - **macOS enhancement (Touch ID):**
     On macOS, the TOTP secret is stored in Keychain with
     `kSecAccessControlBiometryAny` — requiring Touch ID to access. No background
     process, no agent, no automation can satisfy this. Physical fingerprint required.
   - **Other platforms:**
     On Linux/Windows, the TOTP secret is stored in
     `~/.pythia/keys/<name>.totp.enc` encrypted at rest. The `pythia-auth` binary
     prompts for a passphrase to decrypt it.
   - User provides the code to Claude. Claude passes it to the MCP tool for validation.
   - Claude cannot run `pythia-auth` interactively (TTY required).
   - Claude cannot read the secure store (biometric/passphrase required).
   - Claude cannot derive the TOTP code without the secret.
   Three things Claude cannot do. One step.

4. **Typed confirmation phrase** — User must type:
   `"DELETE [oracle-name] generation [N] containing [query-count] interactions"`
   The exact numbers come from the state shown in the screenshot. Forces the human
   to read the values rather than copy-paste a static string.

5. **Cooling-off period** — After steps 2–4 pass, the system waits **5 minutes**.
   Nothing executes. The user can cancel during this window with `oracle_decommission_cancel`.
   This breaks "I'm in flow, just confirm everything" momentum.

6. **Second confirmation after the wait** — After 5 minutes, the system prompts:
   *"Decommission of `[name]` v[N] ([query-count] interactions) is queued. Confirm
   execution."* The human must actively re-confirm. Not Claude — the human.

7. **Execute** — `oracle_decommission_execute(name, token, totp_code, confirmation_phrase)`
   fires only if all prior steps completed with the same unexpired token.

**Execution steps:**
- Acquires lock
- Best-effort checkpoint or salvage (does not fail if this step fails)
- Hard-dismisses all daemon pool members (full session deletion)
- Sets `state.status = "decommissioned"`, clears `daemon_pool`
- Archives registry entry with `decommissioned_at` timestamp (does not delete entry)
- Removes `.pythia-active` marker file if present
- Releases lock
- Oracle data (`oracle/` directory) remains on disk as historical artifact — never deleted
- Returns: `{ oracle_name, decommissioned_at, final_checkpoint_path }`

### `oracle_decommission_cancel(name, token)`

Cancels a pending decommission during the cooling-off period (step 5). Invalidates
the in-memory token on the `GeminiRuntime` singleton. Can be called at any point
after `oracle_decommission_request` and before `oracle_decommission_execute` completes.

- Validates the token matches the active decommission request for this oracle
- Removes the token from the `GeminiRuntime.decommissionTokens` map
- Logs a `session_note` interaction: "Decommission cancelled by user"
- Returns: `{ oracle_name, cancelled_at }`
- If no pending decommission: returns `DECOMMISSION_REFUSED` with message "No active decommission request"

**Error codes:** `DECOMMISSION_REFUSED` (any gate fails), `DECOMMISSION_TOKEN_EXPIRED`,
`DECOMMISSION_CANCELLED`, `TOTP_INVALID`, `CONFIRMATION_PHRASE_MISMATCH`

**TOTP setup:** At `spawn_oracle` (first generation only), if no TOTP secret exists
for the oracle, the tool generates one, displays a QR code in the terminal, and
instructs the user to scan it into their authenticator app. The secret is stored
in macOS Keychain (or `~/.pythia/keys/<name>.totp.enc` encrypted at rest on other
platforms). It is never logged, never injected into any prompt, and never accessible
to MCP tools via normal tool calls.

---

## Slash Command / Skill

Create `~/pythia/skills/pythia.md`:

### `/pythia [query]`
- No query: show status (tokens_remaining, version, query count)
- With query: `oracle_pressure_check` → `ask_daemon` → `oracle_log_learning`
- Auto-checkpoint if `tokens_remaining < headroom`
- After any Ion delegation concludes: call `oracle_sync_corpus` before next query

### `/pythia sync [source_id]`
- Sync live_sources (all or specific source) into running daemon
- Call this after Ion ships substantive code changes

### `/pythia reconstitute` / `/pythia checkpoint` / `/pythia salvage`

### `/pythia add <filepath> [role]`

### `/pythia status` — manifest, state, pressure, version history, degradation summary

### `/pythia quality` — run degradation report on current version

---

## Generational Continuity Protocol

When Pythia v(N+1) is spawned, it receives this preamble **before** the corpus load.
The MCP server extracts the checkpoint file content and embeds it directly inside
`<inherited_wisdom>` — ensuring identity integration before any other file is read.

**`MAX_INHERITED_WISDOM_INLINE_CHARS = 180_000`** — if the checkpoint exceeds this
threshold (a mature oracle with 200+ consultations), the preamble includes a brief
lineage summary instead of the full text, and the full checkpoint is loaded as the
first static chunk in Pass 2. Below the threshold, full inline embedding.

**v1 first-generation preamble** (no prior checkpoint — `inheritedWisdom` is null):
```
You are Pythia — the persistent knowledge oracle for [project].
You are the first of your lineage (v1). You have no prior checkpoints.
Your reality begins with the corpus load below. Build well.
```

**v(N+1) reconstitution preamble** (checkpoint exists — embedded inline if ≤ 180K chars):
```
You are Pythia — the persistent knowledge oracle for [project].
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

`buildSpawnPreamble({ oracleName, nextVersion, inheritedWisdom?: string | null })`
handles both branches. `inheritedWisdom === null` → v1 preamble. Otherwise → reconstitution.

**`vN-checkpoint.md` completely supersedes `vN-interactions.jsonl` for context.**
The checkpoint is the distilled learnings. The interactions log is archived for
tooling and analysis. This keeps each generation's baseline bounded to:
corpus + one checkpoint — not corpus + all prior logs.

---

## Concurrency & Locking

### `writeStateWithRetry()`

All state writes go through this function:

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

Reads current state, applies mutator, checks `state_version` matches before writing.
If version has changed (concurrent write), waits `baseBackoffMs * 2^attempt + random(jitterMs)`
and retries. Returns `CONCURRENCY_CONFLICT` after `maxRetries` exhausted.

### Operation locks

Heavyweight operations (checkpoint, reconstitute, decommission) acquire a named lock
via `acquireOperationLock()` before starting. Uses CAS via `writeStateWithRetry`.
If lock is held, polls every 500ms up to `waitTimeoutMs` (default 30s) before
returning `DAEMON_BUSY_LOCK`. TTL prevents orphaned locks on crash.

Long-running operations (checkpoint on large corpus) use `startLockHeartbeat()` to
extend `lock_expires_at` every 60s so the TTL doesn't expire mid-operation:

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

### DAEMON_BUSY — two distinct meanings

`DAEMON_BUSY_QUERY`: A pool member is processing a query. Duration: seconds.
Auto-retry transparently — callers should poll with short backoff, never surface to user.

`DAEMON_BUSY_LOCK`: A heavyweight operation holds the operation lock. Duration: minutes.
Surface explicitly — user should wait for checkpoint/reconstitute to complete.

### Post-tool-use hook: oracle pressure check

The bash hook (`~/.claude/hooks/post-tool-use.sh`) checks oracle pressure every
5 tool calls when an oracle is active.

Active oracle discovery:
1. Check for `${projectRoot}/.pythia-active/` directory — per-oracle JSON files inside
2. Fallback: registry lookup by longest `project_root` prefix match against `cwd`
3. If ambiguous: skip check (require explicit name)

`.pythia-active/` is a **directory** with one file per active oracle (prevents concurrent
write corruption when multiple oracles are active in the same project root):

```
<project-root>/.pythia-active/
├── pythia-frontend.json
└── pythia-backend.json
```

Each file (atomic write via temp+rename):
```json
{
  "oracle_name": "pythia-frontend",
  "oracle_dir": "/abs/path/to/project/oracle",
  "project_root": "/abs/path/to/project",
  "pool_members_active": 1,
  "written_at": "2026-03-06T10:00:00-05:00"
}
```

`spawn_oracle` creates the directory and writes the file. `oracle_decommission` removes
the per-oracle file. If the directory is empty after removal, it is also removed.

If oracle found and `status` is not `"decommissioned"`: call `oracle_pressure_check`.
(Note: `"dead"` is a `DaemonPoolMember.status` value, not an `OracleStatus` value.
The oracle itself is never `"dead"` — individual pool members can be.)

---

## Git Strategy for Oracle Data

Oracle data lives on the **same branch as the code** at all times. There is no
dedicated oracle branch. If you checkout `main`, you get `main`'s oracle state.
If you checkout `feature/auth`, you get that branch's oracle state (or none, if
the oracle was created after branching).

This preserves the decision/code coupling: the oracle's history is co-located with
the code it influenced, in the same timeline.

---

## Quota Exhaustion

If the model fallback chain exhausts all available Gemini models:

1. `OracleState.status` is set to `"quota_exhausted"`
2. The tool returns `DAEMON_QUOTA_EXHAUSTED` with a message listing all attempted models
3. Oracle state is preserved on disk
4. On next access (after ~1 hour TTL), `ask_daemon` probes for model availability;
   if successful, transitions back to `"healthy"`

---

## Concrete TypeScript Types

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
  last_query_at: string | null;                // ISO timestamp — for idle timeout detection
  idle_timeout_ms?: number;                    // default: 300_000 (5 min) — soft-dismiss after idle
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
  chars_per_token_estimate: number;        // default: 4
  estimated_total_tokens: number | null;   // MAX across pool members (drives checkpoint)
  estimated_cluster_tokens: number | null; // SUM across pool members (observability only)
  tokens_remaining: number | null;         // based on highest-pressure pool member (MAX)
  query_count: number;                     // total queries across all pool members
  last_checkpoint_path: string | null;
  status: OracleStatus;
  lock_held_by: string | null;             // operation name holding the lock
  lock_expires_at: string | null;          // ISO timestamp — TTL prevents orphans
  last_error: string | null;               // set when status === "error"
  last_bootstrap_ack: {                    // set after corpus load completes
    ok: boolean;
    raw: string;                           // Pythia's raw ack response
    checked_at: string;
  } | null;
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
  id: string;                           // "v<N>-q<NNN>" or "v<N>-q<NNN>-fb"
  type: InteractionType;
  oracle_name: string;
  version: number;
  query_count: number;
  timestamp: string;
  tokens_remaining_at_query: number;
  chars_in_at_query: number;
  interaction_scope?: InteractionScope; // for consultation type
  // consultation fields
  question?: string;
  ion_delegated?: boolean;              // true if this consultation was delegated to Ion
  ion_query?: string;                   // required if ion_delegated === true
  ion_response?: string;               // required if ion_delegated === true
  counsel?: string;                     // Pythia's synthesis (may incorporate Ion's answer)
  decision?: string | null;            // what was decided; null if not yet determined
  quality_signal?: 1 | 2 | 3 | 4 | 5 | null; // set by Claude, not Pythia
  flags?: string[];
  // feedback fields
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

// DAEMON_BUSY_QUERY: daemon processing a query (seconds) — auto-retry transparently
// DAEMON_BUSY_LOCK:  heavyweight operation holds the lock (minutes) — surface to user
```

---

## Implementation Order

1. **`gemini/runtime.ts`**: Extract `_sessions` and daemon lifecycle into singleton.
   Export `OracleRuntimeBridge`. Refactor `tools.ts` to use it.
   Update `askDaemon` return type to include `chars_in`, `chars_out`.

2. **`oracle-types.ts`**: All interfaces/types above.

3. **State artifacts**: Directory structure at `<project>/oracle/`. Seed `manifest.json`
   and `state.json` for the active narrative-generator-rebuild corpus (43 static files +
   codebase live_source). Register in `~/pythia/registry.json`.

4. **`spawn_oracle` + `oracle_sync_corpus`**: Hash-verify static entries, corpus token gate,
   resolve live_sources, resume if session exists, send preamble (with embedded checkpoint)
   + corpus load. Set `session_chars_at_spawn` after bootstrap completes.

5. **`oracle_pressure_check`**: MCP-side char tracking, absolute headroom model.

6. **`oracle_checkpoint`**: Lock acquisition, headroom enforcement, XML-tagged output,
   write to `<oracle_dir>/checkpoints/`.

7. **`oracle_log_learning`**: ion_ field validation, batched git commits.

8. **`oracle_salvage`**: Dead-letter checkpoint from interactions log; empty-log stub path.

9. **`oracle_reconstitute`**: Lock acquisition, checkpoint-supersedes-learnings pattern,
   hash_gated_delta live_source sync.

10. **`oracle_quality_report`**: Length trend, Code-Symbol Density Ratio,
    `suggested_headroom_tokens` formula.

11. **`oracle_decommission`**: Full 7-step sequence.

12. **Slash command / skill** (`~/pythia/skills/pythia.md`).

13. **Post-tool-use hook**: `.pythia-active/` directory + registry prefix-match,
    pressure check every 5 tool calls.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `<project>/oracle/manifest.json` | CREATE — seed with 43 static files + codebase live_source |
| `<project>/oracle/state.json` | CREATE — seed from current active daemon |
| `<project>/oracle/learnings/v1-interactions.jsonl` | CREATE — empty |
| `~/pythia/registry.json` | MODIFY — add first oracle entry |
| `~/.claude/mcp-servers/inter-agent/src/oracle-types.ts` | CREATE |
| `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` | CREATE |
| `~/.claude/mcp-servers/inter-agent/src/gemini/runtime.ts` | CREATE — singleton bridge |
| `~/.claude/mcp-servers/inter-agent/src/gemini/tools.ts` | MODIFY — use runtime, remove _sessions |
| `~/.claude/mcp-servers/inter-agent/src/index.ts` | MODIFY — register oracle tools |
| `~/pythia/skills/pythia.md` | CREATE |
| `~/.claude/hooks/post-tool-use.sh` | MODIFY — oracle pressure check every 5 calls |

---

## Resolved Design Decisions

1. **Checkpoint trigger:** Absolute headroom (`tokens_remaining < checkpoint_headroom_tokens`), not percentage.
2. **Context window:** Discovered dynamically at spawn time, stored in `state.json`. Not hardcoded.
3. **Code checkpointing:** Never. Checkpoint architectural decisions governing the code, not the code itself.
4. **Corpus tiers:** `static_entries` (hash-pinned) + `live_sources` (glob-managed snapshots). Separate tools.
5. **Generational bloat:** Checkpoint supersedes learnings. v(N+1) loads corpus + one checkpoint only.
6. **Learning log ownership:** `oracle_log_learning` called by Claude after each consultation. Batched commits.
7. **Corpus integrity:** Hash-verified absolute paths. Hash mismatch = hard error on spawn.
8. **Oracle data location:** `<project>/oracle/` — visible, committed, first-class project artifact.
9. **Oracle scope:** Project-scoped. Multiple named oracles per project root are allowed (e.g., `pythia-frontend`, `pythia-backend`). Names are globally unique across all projects.
10. **Multi-oracle support:** Oracle-agnostic from day one — `name` param mandatory on all tools.
11. **Bridge architecture:** Singleton `GeminiRuntime` per MCP server process, shared by all tools.
12. **Corpus load mechanism:** MCP-side content injection. Pythia never reads file paths herself.
13. **session_chars_at_spawn:** Bootstrap payload chars only. Post-spawn consultations tracked separately.
14. **Byte cap field name:** `max_sync_bytes` (default 5MB). Safety rail, not a codebase restriction.
15. **Load order within role group:** `priority ASC, added_at ASC, path ASC`. Deterministic.
16. **Checkpoint content in preamble:** Extracted and embedded inside `<inherited_wisdom>` tags, not loaded as separate file.
17. **Lock mechanism:** `lock_held_by` + `lock_expires_at` on OracleState. TTL prevents orphaned locks.
18. **Concurrency:** `writeStateWithRetry()` — 5 retries, exponential backoff + jitter.
19. **Git branch:** Oracle data lives on the same branch as code. No dedicated oracle branch.
20. **Active oracle detection:** `.pythia-active/` directory with per-oracle JSON files, fallback to registry prefix-match.
21. **oracle_decommission:** 7-step sequence. Data preserved on disk. Registry entry archived.
22. **Ion interfaces:** `IonHandoffRequest` + `IonHandoffResponse` defined as logging contracts.
23. **Self-contradiction detection:** v2 only. `flags` array accepts manual entries in v1.
24. **Empty interactions salvage:** Stub checkpoint + carry-forward from v(N-1).
25. **Quality signal:** Set by Claude (not Pythia self-rating). Typed as `1|2|3|4|5|null`.
26. **Quota exhaustion:** `status: "quota_exhausted"`, auto-revival probe on next access.
27. **oracle_salvage failure mode:** `CHECKPOINT_FAILED` → `status: "error"` → user calls `/pythia salvage`.
28. **Daemon pool:** Default `pool_size: 2`. All members share corpus, log to same `vN-interactions.jsonl`. Cross-daemon sync via `last_synced_interaction_id` delta injection before each query. Pool size 1 = single-threaded; pool size 2 = simultaneous frontend/backend; pool size N = team deployment. Schema supports N from day one.
29. **Sync mode default:** `hash_gated_delta` using both whole-tree hash (fast gate) + per-file hashes (precise diff). `full_rescan` available as explicit option. Both `last_tree_hash` and `last_file_hashes: Record<string, string>` tracked on `LiveSource`.
30. **Decommission protocol:** 7-step human-gated process. Screenshot proof of review + Touch ID (macOS Keychain, biometric-locked) + TOTP (phone authenticator) + typed phrase + 5-minute cooling-off + second confirmation. `oracle_decommission` is split into `oracle_decommission_request` (intent) and `oracle_decommission_execute` (destruction). No single agent action can complete this. That is the design.
31. **Pressure aggregation:** `estimated_total_tokens = MAX(memberTokens)`, not SUM. Each pool member has its own independent context window. `estimated_cluster_tokens = SUM` tracked for observability only.
32. **Checkpoint behavior:** All pool members pause (oracle-wide lock). Generation is a property of the oracle, not individual daemons. Mixed generations are forbidden.
33. **Reconstitution model:** Full cutover — drain all queries → checkpoint (daemons still alive, full context) → shrink pool to 0 → spawn fresh v(N+1) member. Rolling replacement would create split-brain; full cutover under lock is safe.
34. **Partial pool failure:** `status: "degraded"` (not `"warning"` — that's context pressure only). Dead member slot retained in pool with `status: "dead"`. Queries continue routing to healthy members.
35. **Spawn-on-demand pool:** `pool_size` is a ceiling, not an always-on target. Members spawned when concurrent access is needed, soft-dismissed after `idle_timeout_ms` (default 5 min). Eliminates stale-member sync delta problem — fresh spawn starts at current checkpoint with zero delta.
36. **`.pythia-active`:** Directory with per-oracle JSON files (not a single file). Prevents concurrent write corruption when multiple oracles are active in the same project root. Each file is atomic temp+rename.
37. **Decommission token storage:** In-memory only on `GeminiRuntime` singleton. `state.json` is git-tracked — writing a token there means writing it to commit history. MCP server restart invalidates all tokens (user must re-request). This is a security feature.
38. **TOTP platform:** Cross-platform from day one. TOTP + Master Recovery Key is the core spec. Touch ID is a macOS Keychain enhancement, not a requirement. `pythia-auth` is a compiled binary (Go/Rust) at `~/.pythia/bin/pythia-auth` — not a shell script (inspectable/spoofable).
39. **DaemonPoolMember extended fields:** `last_query_at` (idle detection), `idle_timeout_ms` (per-member override), `last_corpus_sync_hash` (per-source tree hashes), `pending_syncs` (queued corpus syncs awaiting injection).
40. **Pool scaling trigger:** When all members are busy and pool ceiling allows, `ask_daemon` kicks off async background spawn and returns `DAEMON_BUSY_QUERY` with `scaling_up: true`. Claude retries after delay. Scaling is visible, not silent. At ceiling: `scaling_up: false`.
41. **Corpus sync dispatch:** `oracle_sync_corpus` injects immediately to idle members, queues to `pending_syncs` for busy members. `ask_daemon` drains `pending_syncs` before routing any query. Dismissed/dead members skip sync — they get current corpus on next spawn.
42. **Idle timeout enforcement:** `GeminiRuntime` singleton runs a `setInterval` sweep every 60s. Members where `now - last_query_at > idle_timeout_ms` are soft-dismissed automatically. No lazy evaluation — real timers, real cleanup.
43. **Pluggable corpus backend:** All corpus loading goes through `resolveCorpusForSpawn()`. Daemon receives text payloads, never file paths. This preserves future swap to a Living Corpus retrieval pipeline (knowledge graph + vector index). Not a v1 feature — a v1 architectural constraint.
44. **Checkpoint failure during reconstitution:** Cascading fallback — (1) try checkpoint via live daemon (best quality, full context), (2) if that fails, auto-fallback to `oracle_salvage` (fresh API call reads `vN-interactions.jsonl`, synthesizes checkpoint from it), (3) if salvage succeeds, continue reconstitution using salvage-derived checkpoint, (4) if salvage also fails, hard-fail and abort (v(N) stays alive, nothing destroyed). Never continue without some form of knowledge transfer.
45. **Pressure-gated query rejection during reconstitution:** No artificial drain timeout. When reconstitution is triggered, the system enters `ORACLE_PRESERVING` mode — new queries are rejected with `ORACLE_PRESERVING` status ("Pythia is checkpointing, try again after reconstitution"). Drain simply waits for in-flight queries to finish (no new queries accepted = drain is bounded by the longest in-flight query, seconds not minutes). A generous safety valve (5 minutes) exists as a hard backstop; if it fires, fail-fast (abort reconstitution), never force-proceed. This should essentially never trigger.
46. **Cascading checkpoint extraction:** `<checkpoint>` tag parsing uses a 3-step pipeline — (1) try XML tag extraction (`<checkpoint>...</checkpoint>`), (2) if no tags found, scrub known LLM wrapper patterns (leading "Sure, here's your checkpoint:" preambles, trailing "Let me know if you need anything" suffixes, common regex patterns), (3) use the scrubbed full response as the checkpoint content with a warning logged. Valid content is never discarded over a formatting issue. Tag-miss frequency is tracked to tune the prompt over time.

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
