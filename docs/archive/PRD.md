# PRD -- Pythia Persistent Knowledge Oracle

**Version:** 1.0
**Created:** 2026-03-08
**Source of Truth:** `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` (v6)
**Status:** Implementation-ready

---

## Project Overview

Pythia is a system for spawning, maintaining, and reconstituting persistent Gemini daemon oracles that serve as living knowledge bases for long-running projects. An oracle loads a large research corpus once, answers architectural questions across sessions, detects when its context window is under pressure, checkpoints its accumulated learnings to disk, and reconstitutes itself across generations -- each version inheriting everything its predecessors learned.

Pythia is implemented as a first-class feature addition to the existing inter-agent MCP server (`~/.claude/mcp-servers/inter-agent/`) with a companion slash command skill. There is no UI -- all interaction occurs through MCP tools invoked by Claude Code and `/pythia` slash commands. The engine lives at `~/pythia/` while per-project oracle data lives at `<project>/oracle/`, committed alongside the code it documents.

---

## Target Users

**Primary:** Claude Code (the AI coding assistant) -- spawns oracles, routes queries, logs learnings, triggers checkpoints and reconstitutions via MCP tools.

**Secondary:** The human developer (Mike Boscia) -- interacts via `/pythia` slash commands in the Claude Code CLI, reviews quality reports, approves decommissions via TOTP/biometric gates, and curates the corpus manifest.

**Tertiary:** Sibling agents (Gemini daemons, Codex) -- may be delegated implementation work by Claude based on Pythia's architectural counsel (the "Ion" pattern).

---

## Success Criteria

1. **Context persistence across sessions:** An oracle spawned on day 1 retains all corpus knowledge and accumulated learnings when resumed on day 30 without re-reading source files.
2. **Zero-loss generational continuity:** When an oracle reconstitutes from v1 to v2, the successor demonstrates awareness of all prior architectural decisions, confirmed by checkpoint content validation.
3. **Pressure detection accuracy:** Context pressure estimates remain within +/-15% of actual Gemini context usage, validated by comparing estimated tokens to model error onset.
4. **Checkpoint trigger reliability:** Auto-checkpoint fires before context exhaustion in 100% of cases where the oracle is actively monitored (post-tool-use hook running).
5. **Corpus integrity:** Hash verification catches 100% of modified-without-update files at spawn time; no silent corpus drift.
6. **Degradation visibility:** `oracle_quality_report` detects answer length degradation and code-symbol density drops with sufficient lead time to checkpoint before quality loss becomes irrecoverable.
7. **Decommission safety:** No oracle can be destroyed without completing all 7 steps of the decommission protocol, including physical human verification (TOTP + screenshot + typed confirmation).

---

## Out of Scope (v1)

- **Self-contradiction detection via LLM-as-judge:** The `flags` array accepts `"self_contradiction"` entries for manual use, but automated detection requires a separate LLM call per interaction and is deferred to v2.
- **Pluggable corpus backend (Living Corpus System):** v1 is file-based. The architecture preserves a swap point (`resolveCorpusForSpawn()`) for a future knowledge graph + vector index backend, but the retrieval pipeline is not built in v1.
- **Branchable reasoning / timeline forking:** The data model supports roll-forward/roll-back by interaction ID, but the tooling to fork an oracle's worldview at an arbitrary point is v2+.
- **Interval-based live source sync:** `sync_mode: "interval"` is defined in the type system but not enforced in v1. Only `"manual"` and `"on_spawn"` are implemented.
- **Web UI or dashboard:** All interaction is CLI-based via MCP tools and slash commands.
- **Multi-user / team deployment:** `pool_size > 2` is schema-supported but not tested or documented for team use in v1.
- **Fine-tuning dataset export:** `vN-interactions.jsonl` is structured for future use as training data, but no export tooling is built in v1.

---

## Feature Requirements

### MCP Tools

---

#### FEAT-001: spawn_oracle

**Priority:** P0
**Dependencies:** FEAT-014, FEAT-015, FEAT-016, FEAT-017, FEAT-019
**User Story:** As Claude Code, I need to spawn or resume a persistent Gemini oracle so I can consult a project's full research corpus across sessions without re-loading files.

**Description:**
Spawns a new oracle or resumes an existing one by name. Performs a two-pass corpus load: Pass 1 (`resolveCorpusForSpawn`) reads and hash-verifies all static entries, resolves live source globs, estimates tokens, and enforces the corpus cap gate. Pass 2 (`loadResolvedCorpusIntoDaemon`) streams the resolved corpus into the daemon via stdin with backpressure-safe drain handlers. On resume, the existing Gemini session is reattached with zero cost. On fresh spawn, a generational continuity preamble is sent before corpus load, with checkpoint content embedded in `<inherited_wisdom>` tags for reconstituted generations.

**Parameters:** `name` (required), `reuse_existing` (default: true), `force_reload` (default: false), `force` (optional), `timeout_ms` (optional)

**Acceptance Criteria:**
- [ ] Looks up oracle by `name` in `~/pythia/registry.json`; returns `ORACLE_NOT_FOUND` if not registered
- [ ] With `reuse_existing: true` (default) and an existing Gemini session, resumes the session with zero corpus re-load
- [ ] With `reuse_existing: true, force_reload: true` and an existing session, re-sends the full corpus to the live session without incrementing the version
- [ ] With `reuse_existing: false` and an existing session, returns `ORACLE_ALREADY_EXISTS` (does not silently overwrite)
- [ ] With `reuse_existing: false` and no existing session, performs a fresh spawn with full bootstrap
- [ ] Pass 1 verifies sha256 hashes of all `static_entries`; returns `HASH_MISMATCH` on any discrepancy
- [ ] Pass 1 resolves all `live_sources` globs and computes tree hash + per-file hashes
- [ ] Pass 1 enforces token gate: estimated tokens must not exceed `discovered_context_window - checkpoint_headroom_tokens`; returns `CORPUS_CAP_EXCEEDED` if exceeded
- [ ] Pass 1 enforces `MAX_BOOTSTRAP_STDIN_BYTES = 6_000_000`; returns `CORPUS_CAP_EXCEEDED` if exceeded
- [ ] Corpus files are loaded in deterministic order: by `load_order` role sequence, then within each role by `priority ASC, added_at ASC, path ASC`
- [ ] Pass 2 streams corpus to daemon stdin using `stream.write()` with drain handlers (not a single `.end(payload)`)
- [ ] Pass 2 validates bootstrap acknowledgment via `validateBootstrapAck(text)`: confusion responses set `status = "error"`, `last_bootstrap_ack.ok = false`, and return `BOOTSTRAP_FAILED`
- [ ] Context window is discovered dynamically from `CONTEXT_WINDOW_BY_MODEL` lookup, not hardcoded in manifest
- [ ] Sets `session_chars_at_spawn` to the exact character count of the final concatenated bootstrap payload after full corpus load completes
- [ ] Writes `.pythia-active/<oracle-name>.json` marker file to project root (atomic temp+rename)
- [ ] For v1 first-generation spawn (no prior checkpoint), sends the v1 preamble: "You are the first of your lineage"
- [ ] For v(N+1) reconstituted spawn, embeds checkpoint content inside `<inherited_wisdom>` tags in preamble if checkpoint is <= `MAX_INHERITED_WISDOM_INLINE_CHARS` (180,000); otherwise loads full checkpoint as first static chunk in Pass 2
- [ ] Returns `{ oracle_name, version, pool, resumed, corpus_files_loaded, tokens_remaining }`
- [ ] Never hard-dismisses any existing daemon; destruction requires the explicit `oracle_decommission_request` → `oracle_decommission_execute` protocol
- [ ] On first generation spawn, generates TOTP secret, displays QR code, and stores secret in platform-appropriate secure store if no TOTP secret exists for the oracle

---

#### FEAT-002: oracle_sync_corpus

**Priority:** P0
**Dependencies:** FEAT-001, FEAT-016, FEAT-018
**User Story:** As Claude Code, I need to sync live source code changes into a running oracle so Pythia stays aware of code changes after Ion (Codex) ships substantive updates.

**Description:**
Re-resolves file lists from `live_sources` globs (all sources or a specific `source_id`), computes tree hash for change detection, and injects changed files into running daemon pool members. Idle members receive sync payloads immediately; busy members get queued syncs drained before their next query.

**Parameters:** `name` (required), `source_id` (optional)

**Acceptance Criteria:**
- [ ] Resolves file list from `live_sources` globs matching the specified `source_id` or all sources if omitted
- [ ] Applies `max_files` and `max_sync_bytes` caps; returns hard error if either is exceeded
- [ ] Computes tree hash; if unchanged since `last_sync_at`, returns no-op without injecting content
- [ ] For pool members with `status === "idle"`: injects sync payload immediately and updates `last_corpus_sync_hash`
- [ ] For pool members with `status === "busy"`: pushes to `pending_syncs` array with `{ source_id, tree_hash, payload_ref, queued_at }`
- [ ] For pool members with `status === "dismissed"` or `"dead"`: skips (they receive current corpus on next spawn)
- [ ] Updates `last_sync_at` and `last_tree_hash` in manifest after successful sync
- [ ] Returns `{ source_id, files_synced, files_skipped, bytes_loaded, tree_hash, members_synced_immediately, members_queued }`
- [ ] Pending syncs are drained before the next `ask_daemon` call: all pending entries are concatenated and injected as a single "Updated source files..." message before the user's query

---

#### FEAT-003: oracle_pressure_check

**Priority:** P0
**Dependencies:** FEAT-016, FEAT-018, FEAT-020
**User Story:** As Claude Code, I need to check an oracle's context window pressure so I can trigger checkpoints before quality degrades.

**Description:**
Reads `state.json`, computes `tokens_remaining` from character totals using the `MAX(memberTokens)` aggregation across pool members, updates state with the latest estimate, and returns a status recommendation.

**Parameters:** `name` (required)

**Acceptance Criteria:**
- [ ] Reads current `state.json` for the named oracle
- [ ] Uses `countTokens` API as primary pressure signal when available; falls back to char heuristic (decision #49)
- [ ] Tracks active mode in `state.json.token_count_method` (`"exact"` or `"estimate"`)
- [ ] Computes `estimated_total_tokens = MAX(memberTokens)` across active (non-dismissed, non-dead) pool members
- [ ] Computes `estimated_cluster_tokens = SUM(memberTokens)` for observability
- [ ] Computes `tokens_remaining = discovered_context_window - estimated_total_tokens`
- [ ] If no active pool members exist, returns `PRESSURE_UNAVAILABLE`
- [ ] Updates `state.json` with latest pressure estimates
- [ ] Returns status `"healthy"` when `tokens_remaining > checkpoint_headroom_tokens`
- [ ] Returns status `"warning"` and recommendation `"checkpoint_soon"` when `tokens_remaining` is between `checkpoint_headroom_tokens / 2` and `checkpoint_headroom_tokens`
- [ ] Returns status `"critical"` and recommendation `"checkpoint_now"` when `tokens_remaining < checkpoint_headroom_tokens / 2`
- [ ] Returns `{ tokens_remaining, status, recommendation }`

---

#### FEAT-004: oracle_checkpoint

**Priority:** P0
**Dependencies:** FEAT-001, FEAT-016, FEAT-018
**User Story:** As Claude Code, I need to trigger a checkpoint so Pythia's accumulated knowledge is preserved before context pressure causes degradation.

**Description:**
Acquires an operation lock, sends Pythia a structured checkpoint prompt with XML output tags, extracts the `<checkpoint>` content from the response, saves it to disk, adds it to the manifest as a static entry, and optionally git commits.

**Parameters:** `name` (required), `timeout_ms` (optional), `commit` (default: true)

**Acceptance Criteria:**
- [ ] Acquires operation lock before proceeding; returns `DAEMON_BUSY_LOCK` if lock is held by another operation
- [ ] Returns error if `tokens_remaining < checkpoint_headroom_tokens / 4` (too late for safe checkpoint; directs user to `oracle_salvage` instead)
- [ ] Sends checkpoint prompt at **temperature: 0** (decision #51 — prevents generational drift)
- [ ] Prompt requests content inside `<checkpoint>` tags, covering: static corpus key findings, all Q&A summaries, architectural decisions made, top 10 cross-cutting insights, gaps/contradictions, and source citations for every claim (decision #51)
- [ ] Prompt explicitly instructs: do NOT summarize source code -- summarize architectural decisions and constraints the code expresses
- [ ] Extracts checkpoint via cascading pipeline (decision #46): tags → scrub LLM wrappers → use full response with warning
- [ ] Saves checkpoint to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
- [ ] Adds checkpoint file to manifest `static_entries` with `role: "checkpoint"`
- [ ] Git commits the checkpoint and manifest changes when `commit: true`
- [ ] Releases the operation lock in all exit paths (success and failure)
- [ ] Uses `startLockHeartbeat()` to extend lock TTL every 60s for long-running checkpoints
- [ ] Returns `{ checkpoint_path, bytes, sha256, version }`

---

#### FEAT-005: oracle_log_learning

**Priority:** P0
**Dependencies:** FEAT-016, FEAT-018, FEAT-023
**User Story:** As Claude Code, I need to log each consultation and its outcome to the interactions JSONL so the oracle's knowledge is preserved across generations and available for degradation analysis.

**Description:**
Appends a structured `InteractionEntry` to `vN-interactions.jsonl`. Supports consultation, feedback, sync_event, and session_note types. Validates Ion handoff fields. Uses batched git commits to minimize commit overhead.

**Parameters:** `name` (required), `entry` (required: structured InteractionEntry fields)

**Acceptance Criteria:**
- [ ] Appends a valid `InteractionEntry` JSON line to `<oracle_dir>/learnings/v<N>-interactions.jsonl`
- [ ] Assigns sequential interaction ID in format `v<N>-q<NNN>` for consultations, `v<N>-q<NNN>-fb` for feedback
- [ ] Allocates monotonic `seq` from `state.json.next_seq` (research finding F5/F6 — gap detection + deterministic replay)
- [ ] Auto-populates: `entry_schema_version`, `timestamp`, `trace_id`/`span_id`/`parent_span_id` (from OTel context, decision #50), `counsel_sha256`, `usage` (from Gemini API), `latency` (from ask_daemon timing)
- [ ] Validates: if `ion_delegated: true`, requires non-empty `ion_query` and `ion_response`; returns error if validation fails
- [ ] Updates `query_count` and increments `next_seq` in `state.json` via `writeStateWithRetry()`
- [ ] Records `tokens_remaining_at_query` and `chars_in_at_query` from current state
- [ ] Writes to JSONL file immediately (data safe on disk before git commit)
- [ ] Defers git commit via `batchCommitLearnings()` until any flush trigger fires: pending entries >= 10, pending bytes >= 256KB, 30-second debounce timer, explicit `force: true`, or process shutdown hook
- [ ] Supports all four interaction types: `"consultation"`, `"feedback"`, `"sync_event"`, `"session_note"`
- [ ] Returns `{ entry_id, file_path, version }`

---

#### FEAT-006: oracle_add_to_corpus

**Priority:** P1
**Dependencies:** FEAT-001, FEAT-016
**User Story:** As Claude Code, I need to add a new research document to an oracle's corpus so Pythia can incorporate new knowledge sources.

**Description:**
Verifies the file exists, computes its sha256, checks for duplicates in the manifest, adds it to `static_entries`, and optionally loads it into the running daemon immediately.

**Parameters:** `name` (required), `file_path` (required), `role` (required), `required` (optional), `load_now` (optional), `dedupe` (optional)

**Acceptance Criteria:**
- [ ] Verifies the file at `file_path` exists on disk; returns `FILE_NOT_FOUND` if missing
- [ ] Computes sha256 hash of the file contents
- [ ] Checks for duplicate entry in manifest `static_entries` by path; returns `already_present: true` if found (not an error)
- [ ] Adds entry to `static_entries` with specified `role`, `required`, current timestamp as `added_at`, and computed `sha256`
- [ ] If `load_now: true` and a daemon is running: feeds the file content to the running daemon
- [ ] If `load_now: true` and no daemon is running: returns success with `loaded_into_daemon: false`
- [ ] Git commits the manifest change
- [ ] Returns `{ entry, already_present, loaded_into_daemon }`

---

#### FEAT-007: oracle_update_entry

**Priority:** P1
**Dependencies:** FEAT-016, FEAT-018
**User Story:** As Claude Code, I need to update an existing corpus entry's hash when a research document is intentionally revised, without triggering a hash mismatch error on next spawn.

**Description:**
For intentional updates to an existing static entry. Verifies the file exists and is already in the manifest. If `expected_old_sha256` is provided, validates it matches the current manifest value to prevent stale updates. Recomputes sha256 from current file contents and updates the manifest atomically.

**Parameters:** `name` (required), `file_path` (required), `reason` (required), `expected_old_sha256` (optional), `role` (optional), `required` (optional), `commit` (default: true)

**Acceptance Criteria:**
- [ ] Verifies the file exists on disk; returns `FILE_NOT_FOUND` if missing
- [ ] Verifies the file path is already present in manifest `static_entries`; returns error if not found
- [ ] If `expected_old_sha256` is provided: validates it matches the current manifest sha256; returns `HASH_MISMATCH` if it does not match (prevents concurrent stale updates)
- [ ] Recomputes sha256 from current file contents on disk
- [ ] Updates the manifest entry with new sha256 and current timestamp
- [ ] If `role` or `required` provided, updates those fields as well
- [ ] Git commits the manifest change with the `reason` in the commit message when `commit: true`
- [ ] Returns `{ old_sha256, new_sha256, updated_at }`
- [ ] Manual manifest edits (editing manifest.json directly) remain a hard error on next spawn -- this tool is the only sanctioned update path

---

#### FEAT-008: oracle_salvage

**Priority:** P0
**Dependencies:** FEAT-016, FEAT-018
**User Story:** As Claude Code, I need to recover a checkpoint from a dead daemon that never checkpointed, so the oracle's learnings are not permanently lost.

**Description:**
Uses a fresh single-shot Gemini API call (not the oracle daemon, which is dead) to synthesize `vN-interactions.jsonl` into a checkpoint. If the interactions log is empty, generates a stub checkpoint that carries forward insights from the v(N-1) checkpoint.

**Parameters:** `name` (required)

**Acceptance Criteria:**
- [ ] Does NOT use the oracle daemon for synthesis (the daemon is assumed dead)
- [ ] Uses a fresh single-shot Gemini API call to process the interactions log
- [ ] Reads `<oracle_dir>/learnings/v<N>-interactions.jsonl` and passes it to the synthesis call
- [ ] If interactions log is empty: generates a stub checkpoint with text "No new architectural decisions were recorded during Generation N" and carries forward insights from `v(N-1)-checkpoint.md` if it exists
- [ ] Saves the synthesized checkpoint to `<oracle_dir>/checkpoints/v<N>-checkpoint.md`
- [ ] Returns `{ checkpoint_path, source: "salvage", entries_processed }`

---

#### FEAT-009: oracle_reconstitute

**Priority:** P0
**Dependencies:** FEAT-001, FEAT-004, FEAT-016, FEAT-018, FEAT-019
**User Story:** As Claude Code, I need to reconstitute an oracle into a new generation so it gets a fresh context window while retaining all accumulated knowledge.

**Description:**
Full atomic generation cutover from vN to v(N+1). Acquires lock, drains active queries, optionally checkpoints, soft-dismisses all pool members, increments version, spawns a fresh member from checkpoint with generational continuity preamble. Mixed generations are forbidden -- all pool members reconstitute together.

**Parameters:** `name` (required), `checkpoint_first` (default: true), `dismiss_old` (optional)

**Acceptance Criteria:**
- [ ] Acquires operation lock; returns `DAEMON_BUSY_LOCK` if lock is held
- [ ] Drain phase: sets `ORACLE_PRESERVING` to reject new queries, waits for in-flight queries to complete (decision #45); 5-minute safety valve fails fast, never force-proceeds
- [ ] If `checkpoint_first: true` (default): calls `oracle_checkpoint` before proceeding; if checkpoint fails, auto-fallback to `oracle_salvage` (decision #44); if salvage also fails, hard-fail and abort reconstitution
- [ ] Soft-dismisses ALL pool members (preserves session data on disk, does not hard-delete)
- [ ] Increments version from N to N+1 in state and manifest
- [ ] Adds `vN-checkpoint.md` as `role: "checkpoint"` in manifest `static_entries`
- [ ] Does NOT re-add `vN-interactions.jsonl` to the manifest (checkpoint supersedes learnings for context efficiency)
- [ ] For `live_sources`: uses `hash_gated_delta` by default -- re-syncs only files whose hash has changed
- [ ] Spawns one fresh pool member from checkpoint (not resuming old sessions); spawn-on-demand applies for additional members
- [ ] Seeds the new member with the generational continuity preamble containing checkpoint content in `<inherited_wisdom>` tags
- [ ] Updates `state.json` with new version, clears `daemon_pool` and populates with fresh member(s)
- [ ] Releases operation lock in all exit paths
- [ ] Returns `{ previous_version, new_version, new_daemon_id, loaded_artifacts }`

---

#### FEAT-010: oracle_quality_report

**Priority:** P1
**Dependencies:** FEAT-005, FEAT-016
**User Story:** As Claude Code, I need to analyze an oracle's degradation patterns so I can tune checkpoint headroom thresholds based on empirical data.

**Description:**
Reads `vN-interactions.jsonl` and computes answer length trends, Code-Symbol Density Ratio, and `tokens_remaining` at each query. Derives `suggested_headroom_tokens` from degradation onset data across generations.

**Parameters:** `name` (required), `version` (optional: defaults to current version)

**Acceptance Criteria:**
- [ ] Reads `vN-interactions.jsonl` for the specified version
- [ ] Computes average answer length for early queries vs. late queries (shorter late answers indicate degrading working memory)
- [ ] Computes Code-Symbol Density Ratio: percentage of proper nouns, camelCase identifiers, snake_case identifiers, and file paths relative to total words; a drop indicates generic responses replacing specific codebase references
- [ ] Records `tokens_remaining` at the onset of each detected trend change
- [ ] For v1 oracle with no degradation flags: returns `suggested_headroom_tokens` equal to `manifest.checkpoint_headroom_tokens` (250K default)
- [ ] For v2+ with degradation history: computes `suggested_headroom_tokens = clamp(P50(onset_tokens) + 50_000, 100_000, context_window * 0.5)`
- [ ] Self-contradiction detection is NOT implemented in v1; `flags` array accepts `"self_contradiction"` entries only for manual user-flagged entries
- [ ] Returns a `QualityReport` object with: `oracle_name`, `version`, `query_count`, `degradation_onset_query`, `degradation_onset_tokens_remaining`, `avg_answer_length_early`, `avg_answer_length_late`, `length_trend_pct_change`, `code_symbol_density_early`, `code_symbol_density_late`, `suggested_headroom_tokens`, `flags`

---

#### FEAT-011: oracle_decommission_request

**Priority:** P1
**Dependencies:** FEAT-014, FEAT-016, FEAT-018
**User Story:** As Claude Code, I need to initiate a decommission request so the human can review what will be destroyed before any deletion occurs.

**Description:**
Phase 1 of the 7-step human-gated decommission protocol. Logs intent, generates an expiring token stored in-memory only on the GeminiRuntime singleton (never in git-tracked state.json), and returns a checklist of required steps.

**Parameters:** `name` (required), `reason` (required)

**Acceptance Criteria:**
- [ ] Validates oracle exists and is not already decommissioned
- [ ] Generates a unique decommission token (UUID) with 10-minute TTL
- [ ] Stores token in-memory only on the `GeminiRuntime` singleton's `decommissionTokens` map -- never written to `state.json` or any git-tracked file
- [ ] Records the decommission request with timestamp and reason as a `session_note` in `vN-interactions.jsonl`
- [ ] Returns the full 7-step checklist the human must complete before `oracle_decommission_execute`
- [ ] If MCP server restarts before execute, the token is lost and the user must re-request (security feature)
- [ ] Returns `{ oracle_name, token (for passing to execute), expires_at, checklist }`

---

#### FEAT-012: oracle_decommission_execute

**Priority:** P1
**Dependencies:** FEAT-011, FEAT-014, FEAT-016, FEAT-018, FEAT-034, FEAT-035
**User Story:** As Claude Code, I need to execute a decommission after the human has completed all 7 verification steps, permanently destroying the oracle's daemon sessions while preserving historical data.

**Description:**
Phase 7 of the decommission protocol. Validates all prior steps (screenshot reviewed, TOTP verified, confirmation phrase matches, cooling-off period elapsed, second confirmation received). Only then proceeds with hard-dismissing all daemon pool members, archiving the registry entry, and removing the active marker.

**Parameters:** `name` (required), `token` (required), `totp_code` (required), `confirmation_phrase` (required)

**Acceptance Criteria:**
- [ ] Validates the `token` matches an active, non-expired decommission request for this oracle on the `GeminiRuntime` singleton
- [ ] Returns `DECOMMISSION_TOKEN_EXPIRED` if the 10-minute TTL has elapsed
- [ ] Validates `totp_code` against the oracle's TOTP secret stored in the platform-appropriate secure store
- [ ] Returns `TOTP_INVALID` if the TOTP code does not match
- [ ] Validates `confirmation_phrase` matches the exact format: `"DELETE [oracle-name] generation [N] containing [query-count] interactions"` with correct values from current state
- [ ] Returns `CONFIRMATION_PHRASE_MISMATCH` if the phrase does not match
- [ ] Acquires operation lock before any destructive action
- [ ] Performs best-effort checkpoint or salvage before deletion (does not fail the overall operation if this step fails)
- [ ] Hard-dismisses all daemon pool members (full session deletion, not soft-dismiss)
- [ ] Sets `state.status = "decommissioned"` and clears `daemon_pool`
- [ ] Archives registry entry by adding `decommissioned_at` timestamp (does not delete the registry entry)
- [ ] Removes `.pythia-active/<oracle-name>.json` marker file if present; removes the directory if empty after removal
- [ ] Does NOT delete the `oracle/` directory -- data remains on disk as historical artifact
- [ ] Releases operation lock
- [ ] Returns `{ oracle_name, decommissioned_at, final_checkpoint_path }`

---

#### FEAT-013: oracle_decommission_cancel

**Priority:** P1
**Dependencies:** FEAT-011, FEAT-014
**User Story:** As a user, I need to cancel a pending decommission during the cooling-off period so I can abort the process if I change my mind.

**Description:**
Cancels a pending decommission by invalidating the in-memory token. Can be called at any point after `oracle_decommission_request` and before `oracle_decommission_execute` completes.

**Parameters:** `name` (required), `token` (required)

**Acceptance Criteria:**
- [ ] Validates the `token` matches an active decommission request for the named oracle
- [ ] If no pending decommission exists: returns `DECOMMISSION_REFUSED` with message "No active decommission request"
- [ ] Removes the token from the `GeminiRuntime.decommissionTokens` map
- [ ] Logs a `session_note` interaction: "Decommission cancelled by user" to `vN-interactions.jsonl`
- [ ] Returns `{ oracle_name, cancelled_at }`

---

### Infrastructure

---

#### FEAT-014: GeminiRuntime Singleton

**Priority:** P0
**Dependencies:** None (foundational)
**User Story:** As the MCP server, I need a shared singleton that owns daemon lifecycle so both `tools.ts` and `oracle-tools.ts` can manage daemons without conflicting over the private `_sessions` map.

**Description:**
Extract the `_sessions` map and daemon lifecycle functions (spawn, ask, dismiss) from `gemini/tools.ts` into a new `gemini/runtime.ts` file. The singleton owns all daemon state and exposes it via the `OracleRuntimeBridge` interface. Both the existing inter-agent tools and the new oracle tools import from this shared singleton.

**Acceptance Criteria:**
- [ ] New file created at `~/.claude/mcp-servers/inter-agent/src/gemini/runtime.ts`
- [ ] `_sessions` map moved from `tools.ts` to `runtime.ts`
- [ ] Singleton pattern: one `GeminiRuntime` instance per MCP server process, obtained via `getGeminiRuntime()`
- [ ] `tools.ts` refactored to use `getGeminiRuntime()` instead of its own `_sessions` -- all existing inter-agent functionality preserved
- [ ] Singleton holds ephemeral in-memory state: `decommissionTokens: Map<string, { token: string; expires_at: number }>` (never persisted to disk)
- [ ] Singleton holds `idleSweepInterval: NodeJS.Timeout` (see FEAT-022)
- [ ] Singleton holds `ppidWatchdog: NodeJS.Timeout` — polls `process.ppid` every 5s to detect parent death, executes tree-kill on all daemons (decision #48)
- [ ] Singleton holds `toolMutex: Mutex` — `async-mutex` instance protecting all async read-modify-write on pool state (decision #47)
- [ ] On startup: performs orphan sweep — checks for PID files from previous crashes, kills orphaned PTY processes before accepting tool calls (decision #48)
- [ ] All existing tests pass after refactor

---

#### FEAT-015: OracleRuntimeBridge Interface

**Priority:** P0
**Dependencies:** FEAT-014
**User Story:** As the oracle tools module, I need a stable API to spawn, query, and dismiss daemons without depending on internal implementation details of the Gemini runtime.

**Description:**
A TypeScript interface exported from `gemini/runtime.ts` defining the contract between the oracle tools and the daemon lifecycle. The interface is explicitly designed to remain stable as the runtime implementation evolves.

**Acceptance Criteria:**
- [ ] Interface exported as `OracleRuntimeBridge` from `gemini/runtime.ts`
- [ ] Defines `spawnDaemon(input: { session_name, cwd?, timeout_ms? }): Promise<{ daemon_id, resumed, session_dir? }>`
- [ ] Defines `askDaemon(input: { daemon_id, question, timeout_ms? }): Promise<{ text, chars_in, chars_out }>` -- note: `chars_in` and `chars_out` are part of the return type so oracle-tools can update pressure metrics without re-counting strings
- [ ] Defines `dismissDaemon(input: { daemon_id, hard? }): Promise<void>`
- [ ] Defines `getDaemonSessionDir(daemon_id: string): string | null`
- [ ] Defines `findDaemonBySessionName(session_name: string): { daemon_id, session_dir } | null` -- needed for oracle resume to find running daemons by their stable session name
- [ ] `getGeminiRuntime()` returns an object implementing `OracleRuntimeBridge`

---

#### FEAT-016: Type Definitions (oracle-types.ts)

**Priority:** P0
**Dependencies:** None (foundational)
**User Story:** As a developer, I need all oracle-related TypeScript types defined in one place so the codebase has a single source of truth for data shapes.

**Description:**
All TypeScript interfaces, types, and enums for the oracle system defined in `oracle-types.ts`. Includes state types, manifest types, interaction types, quality report types, error codes, and result envelope.

**Acceptance Criteria:**
- [ ] File created at `~/.claude/mcp-servers/inter-agent/src/oracle-types.ts`
- [ ] Defines `OracleStatus` union type: `"healthy" | "degraded" | "warning" | "critical" | "emergency" | "error" | "quota_exhausted" | "decommissioned"`
- [ ] Defines `DaemonPoolMember` interface with all fields: `daemon_id`, `session_name`, `session_dir`, `status` (`"idle" | "busy" | "dead" | "dismissed"`), `query_count`, `chars_in`, `chars_out`, `last_synced_interaction_id`, `last_query_at`, `idle_timeout_ms`, `last_corpus_sync_hash`, `pending_syncs`
- [ ] Defines `OracleRecommendation`, `CorpusRole`, `SyncMode`, `ReconstituteSyncMode` types
- [ ] Defines `StaticEntry`, `LiveSource`, `OracleManifest`, `OracleState`, `OracleRegistryEntry` interfaces
- [ ] Defines `InteractionType`, `InteractionScope`, `InteractionEntry` types with all fields including Ion handoff fields (`ion_delegated`, `ion_query`, `ion_response`)
- [ ] Defines `IonHandoffRequest` and `IonHandoffResponse` interfaces (logging contracts)
- [ ] Defines `DegradationFlag` and `QualityReport` interfaces
- [ ] Defines `OracleResult<T>` generic envelope type with success/error branches
- [ ] Defines `OracleErrorCode` union type with all error codes including decommission-specific codes

---

#### FEAT-017: Registry Management

**Priority:** P0
**Dependencies:** FEAT-016
**User Story:** As the oracle system, I need a central registry mapping oracle names to project paths so any tool can resolve an oracle's data directory from its name.

**Description:**
The registry at `~/pythia/registry.json` maps oracle names to `OracleRegistryEntry` objects containing `oracle_dir` and `project_root` paths. Oracle names are globally unique among non-decommissioned entries. All registry writes use atomic temp-file + rename to prevent partial writes.

**Acceptance Criteria:**
- [ ] Registry file located at `~/pythia/registry.json` with `schema_version: 1`
- [ ] `registerOracle()` enforces global uniqueness of names among non-decommissioned entries; rejects duplicates
- [ ] Multiple named oracles per project root are allowed (e.g., `pythia-frontend` and `pythia-backend` in the same project)
- [ ] All registry writes use temp-file + rename pattern (atomic writes, no partial corruption)
- [ ] Registry is git-tracked in `~/pythia/` -- `git checkout registry.json` is a valid recovery path
- [ ] Decommissioned entries are archived with `decommissioned_at` timestamp, not deleted
- [ ] Returns `STALE_REGISTRY_PATH` if the `oracle_dir` path in the registry no longer exists on disk

---

#### FEAT-018: State Management

**Priority:** P0
**Dependencies:** FEAT-016
**User Story:** As the oracle system, I need atomic, concurrency-safe state writes so multiple tool calls cannot corrupt `state.json`.

**Description:**
All state writes go through `writeStateWithRetry()`, which reads current state, applies a mutator function, checks `state_version` for concurrent modification, and retries with exponential backoff + jitter on conflict. Operation locks with TTL prevent concurrent heavyweight operations.

**Acceptance Criteria:**
- [ ] `writeStateWithRetry()` implemented with signature: `(oracleDir, mutator, opts?) => Promise<OracleState>`
- [ ] Reads current state, applies mutator, compares `state_version` before writing
- [ ] If `state_version` has changed between read and write, retries with exponential backoff (`baseBackoffMs * 2^attempt + random(jitterMs)`)
- [ ] Default: 5 retries, 100ms base backoff, 50ms jitter
- [ ] Returns `CONCURRENCY_CONFLICT` after all retries exhausted
- [ ] Increments `state_version` on every successful write
- [ ] `acquireOperationLock()` implemented using CAS via `writeStateWithRetry()`
- [ ] Lock stored in `lock_held_by` (operation name) and `lock_expires_at` (ISO timestamp TTL)
- [ ] If lock is held, polls every 500ms up to `waitTimeoutMs` (default 30s), then returns `DAEMON_BUSY_LOCK`
- [ ] `startLockHeartbeat()` extends `lock_expires_at` every 60s for long-running operations (prevents TTL expiry mid-operation)
- [ ] Lock heartbeat uses 10-minute TTL, renewed every 60s
- [ ] Stale locks (past `lock_expires_at`) can be force-acquired

---

#### FEAT-019: Corpus Loading Pipeline

**Priority:** P0
**Dependencies:** FEAT-014, FEAT-015, FEAT-016
**User Story:** As the oracle system, I need a deterministic, hash-verified corpus loading pipeline so every spawn produces an identical context state.

**Description:**
Two-pass loading: Pass 1 (`resolveCorpusForSpawn`) handles all I/O and validation before a daemon exists. Pass 2 (`loadResolvedCorpusIntoDaemon`) streams the resolved corpus into the daemon with backpressure-safe writes. The split ensures the daemon is never spawned if the corpus is invalid.

**Acceptance Criteria:**
- [ ] `resolveCorpusForSpawn(name)` reads all static entry files and verifies sha256 hashes
- [ ] Returns `HASH_MISMATCH` with details for any static entry whose on-disk hash differs from manifest
- [ ] Resolves live_sources globs, computes tree hash + per-file hashes
- [ ] Estimates total tokens using `chars / chars_per_token_estimate`
- [ ] Enforces corpus cap: `estimatedTokens > (discoveredContextWindow - checkpointHeadroomTokens)` returns `CORPUS_CAP_EXCEEDED`
- [ ] Enforces stdin cap: total bytes > `MAX_BOOTSTRAP_STDIN_BYTES` (6,000,000) returns `CORPUS_CAP_EXCEEDED`
- [ ] Returns `ResolvedCorpus` containing text payloads ready to inject, with no further I/O required
- [ ] `loadResolvedCorpusIntoDaemon(daemonId, resolvedCorpus)` streams content using `stream.write()` with drain handlers (not a single `.end(payload)`)
- [ ] Sends final "corpus loaded" acknowledgment prompt after all content is streamed
- [ ] Validates bootstrap ack: if response indicates confusion, sets `status = "error"`, `last_bootstrap_ack.ok = false`, returns `BOOTSTRAP_FAILED`
- [ ] Corpus is loaded in deterministic order: by `load_order` role sequence, then within each role by `priority ASC, added_at ASC, path ASC`
- [ ] All corpus loading goes through `resolveCorpusForSpawn()` -- no tool reads files directly (preserves future pluggable backend swap point)

---

#### FEAT-020: Context Pressure Detection

**Priority:** P0
**Dependencies:** FEAT-015, FEAT-016, FEAT-018
**User Story:** As the oracle system, I need accurate context pressure tracking so checkpoints trigger at the right time.

**Description:**
MCP-side character tracking updated after every `ask_daemon` call. Per-member `chars_in` and `chars_out` tracked independently. Pool-wide pressure uses MAX aggregation (not SUM) since each pool member has its own independent context window.

**Acceptance Criteria:**
- [ ] After every `ask_daemon` call, updates the responding member's `chars_in` and `chars_out` in `state.json`
- [ ] Updates member's `last_query_at` timestamp
- [ ] **Primary (exact):** Uses Gemini `countTokens` API / response `usage_metadata` for per-member token counts (decision #49)
- [ ] **Fallback (estimate):** Per-member `(session_chars_at_spawn + member.chars_in + member.chars_out) / chars_per_token_estimate` when `countTokens` unavailable
- [ ] Tracks active mode in `state.json.token_count_method` (`"exact"` or `"estimate"`)
- [ ] `estimated_total_tokens = MAX(memberTokens)` across active members (drives checkpoint decisions)
- [ ] `estimated_cluster_tokens = SUM(memberTokens)` across active members (observability only, does NOT drive checkpoint)
- [ ] `tokens_remaining = discovered_context_window - estimated_total_tokens`
- [ ] Absolute headroom model: checkpoint triggers when `tokens_remaining < checkpoint_headroom_tokens`, not at a percentage threshold
- [ ] When no active pool members exist, sets pressure fields to null and reports `PRESSURE_UNAVAILABLE`

---

#### FEAT-021: Cross-Daemon Context Sync

**Priority:** P1
**Dependencies:** FEAT-005, FEAT-015, FEAT-016
**User Story:** As the oracle system, I need to keep pool members loosely aligned on architectural decisions so queries routed to different members produce consistent answers.

**Description:**
Before routing any query to a pool member, the MCP server injects recent decisions the member has not seen. Each member tracks `last_synced_interaction_id`. The sync payload is the delta from that ID to the current head of `vN-interactions.jsonl`. Negligible context cost for recent decisions.

**Acceptance Criteria:**
- [ ] Before routing a query to daemon N, reads `vN-interactions.jsonl` entries after member N's `last_synced_interaction_id`
- [ ] Formats new decisions as a prefixed context sync block: `[Context sync -- decisions since your last query: ...]`
- [ ] Prepends the sync block to the user's question before calling `ask_daemon`
- [ ] If no new decisions exist since the member's last query, no sync injection occurs (zero overhead)
- [ ] Updates `last_synced_interaction_id` on the member after successful query
- [ ] Only includes `consultation` and `feedback` type entries in the sync (not `sync_event` or `session_note`)

---

#### FEAT-022: Idle Timeout Enforcement

**Priority:** P1
**Dependencies:** FEAT-014, FEAT-015
**User Story:** As the oracle system, I need to automatically dismiss idle pool members to free resources when they have not been queried for a configurable period.

**Description:**
A `setInterval` loop on the GeminiRuntime singleton sweeps all oracle pools every 60 seconds. Members where `Date.now() - last_query_at > idle_timeout_ms` are soft-dismissed. This is the sole enforcement mechanism for idle timeouts.

**Acceptance Criteria:**
- [ ] `setInterval` loop started on GeminiRuntime singleton instantiation, running every 60 seconds
- [ ] Sweep checks all registered oracle pools for members where idle time exceeds `idle_timeout_ms` (default: 300,000 = 5 minutes)
- [ ] Expired members are soft-dismissed (session preserved on disk, can respawn)
- [ ] Member status updated to `"dismissed"`, `daemon_id` set to `null`
- [ ] Interval is cleared on process shutdown
- [ ] Soft-dismissed members can be respawned on next demand (spawn-on-demand pattern)

---

#### FEAT-023: Batched Git Commits

**Priority:** P1
**Dependencies:** FEAT-005
**User Story:** As the oracle system, I need to batch git commits for interaction logging so individual consultations do not each trigger a separate commit.

**Description:**
`batchCommitLearnings()` debounce mechanism that writes JSONL immediately (data safe on disk) but defers the git commit until a flush trigger fires.

**Acceptance Criteria:**
- [ ] JSONL entries are written to disk immediately on each `oracle_log_learning` call (data is safe before any batching logic)
- [ ] Git commit is deferred and batched, firing on any of these triggers:
  - Pending entries >= 10
  - Pending bytes >= 256KB
  - 30-second debounce timer expires
  - Explicit `force: true` parameter on `oracle_log_learning`
  - Process shutdown hook
- [ ] Commit message includes the count of batched entries
- [ ] No data loss if the process crashes between JSONL write and git commit (JSONL is already on disk)

---

#### FEAT-024: .pythia-active Marker Files

**Priority:** P1
**Dependencies:** FEAT-001
**User Story:** As the post-tool-use hook, I need a fast way to discover which oracles are active in the current project without reading the registry or state files.

**Description:**
Per-oracle JSON files written to `<project-root>/.pythia-active/` directory. Each file is written atomically (temp+rename). The directory structure prevents concurrent write corruption when multiple oracles are active in the same project root.

**Acceptance Criteria:**
- [ ] `spawn_oracle` creates `<project-root>/.pythia-active/` directory if it does not exist
- [ ] `spawn_oracle` writes `<project-root>/.pythia-active/<oracle-name>.json` with fields: `oracle_name`, `oracle_dir`, `project_root`, `pool_members_active`, `written_at`
- [ ] File writes use atomic temp-file + rename pattern
- [ ] `oracle_decommission_execute` removes the per-oracle file; removes the directory if empty after removal
- [ ] Each oracle gets its own file (e.g., `pythia-frontend.json`, `pythia-backend.json`) -- no single shared file
- [ ] `.pythia-active/` should be added to `.gitignore` (ephemeral runtime state, not project data)

---

### Slash Command / Skill

---

#### FEAT-025: /pythia [query]

**Priority:** P0
**Dependencies:** FEAT-001, FEAT-003, FEAT-005
**User Story:** As a developer using Claude Code, I need a simple slash command to consult the oracle so I can get architectural guidance without manually calling individual MCP tools.

**Description:**
The primary slash command for oracle consultation. With no query, shows status. With a query, performs the full consultation flow: pressure check, ask daemon, log learning. Auto-triggers checkpoint if pressure is critical.

**Acceptance Criteria:**
- [ ] With no query argument: displays oracle status (tokens_remaining, version, query count, pool status)
- [ ] With a query: calls `oracle_pressure_check` first
- [ ] If pressure is critical: auto-triggers `oracle_checkpoint` before answering the query
- [ ] Routes query to an idle pool member via `ask_daemon`
- [ ] After receiving response, calls `oracle_log_learning` with the consultation entry
- [ ] After any Ion delegation concludes: prompts to call `oracle_sync_corpus` before next query
- [ ] Displays Pythia's response to the user with relevant metadata (version, tokens remaining)

---

#### FEAT-026: /pythia sync [source_id]

**Priority:** P1
**Dependencies:** FEAT-002
**User Story:** As a developer, I need a slash command to sync live source changes into the oracle after code changes.

**Acceptance Criteria:**
- [ ] Calls `oracle_sync_corpus` with the specified `source_id` or all sources if omitted
- [ ] Displays sync results: files synced, files skipped, bytes loaded, members synced immediately vs. queued

---

#### FEAT-027: /pythia checkpoint

**Priority:** P1
**Dependencies:** FEAT-004
**User Story:** As a developer, I need a slash command to manually trigger a checkpoint.

**Acceptance Criteria:**
- [ ] Calls `oracle_checkpoint` for the active oracle
- [ ] Displays checkpoint result: path, size, version

---

#### FEAT-028: /pythia reconstitute

**Priority:** P1
**Dependencies:** FEAT-009
**User Story:** As a developer, I need a slash command to manually trigger reconstitution.

**Acceptance Criteria:**
- [ ] Calls `oracle_reconstitute` for the active oracle
- [ ] Displays reconstitution result: previous version, new version, loaded artifacts

---

#### FEAT-029: /pythia salvage

**Priority:** P1
**Dependencies:** FEAT-008
**User Story:** As a developer, I need a slash command to recover a checkpoint from a dead oracle.

**Acceptance Criteria:**
- [ ] Calls `oracle_salvage` for the active oracle
- [ ] Displays salvage result: checkpoint path, source, entries processed

---

#### FEAT-030: /pythia add filepath [role]

**Priority:** P1
**Dependencies:** FEAT-006
**User Story:** As a developer, I need a slash command to add a file to the oracle's corpus.

**Acceptance Criteria:**
- [ ] Calls `oracle_add_to_corpus` with the specified `file_path` and `role`
- [ ] Validates the file path is absolute (fully qualified)
- [ ] Displays result: whether file was already present, whether it was loaded into running daemon

---

#### FEAT-031: /pythia status

**Priority:** P0
**Dependencies:** FEAT-001, FEAT-003
**User Story:** As a developer, I need a comprehensive status display for the oracle.

**Acceptance Criteria:**
- [ ] Displays manifest information: name, project, version, corpus size, static entry count, live source count
- [ ] Displays state information: pool status (per-member daemon_id, status, query_count, chars_in/out), tokens_remaining, estimated_total_tokens, status
- [ ] Displays version history: all prior checkpoint paths and versions
- [ ] Displays degradation summary from most recent quality report (if available)
- [ ] Flags any partial pool failures (members with `status: "dead"`)

---

#### FEAT-032: /pythia quality

**Priority:** P1
**Dependencies:** FEAT-010
**User Story:** As a developer, I need a slash command to run a degradation analysis on the current oracle version.

**Acceptance Criteria:**
- [ ] Calls `oracle_quality_report` for the active oracle's current version
- [ ] Displays: answer length trend, code-symbol density trend, degradation onset point, suggested headroom tokens, all flags

---

### Integration

---

#### FEAT-033: Post-Tool-Use Pressure Check Hook

**Priority:** P1
**Dependencies:** FEAT-003, FEAT-024
**User Story:** As the system, I need automatic pressure monitoring so context exhaustion is detected without manual checks.

**Description:**
The existing bash hook at `~/.claude/hooks/post-tool-use.sh` is extended to check oracle pressure every 5 tool calls when an oracle is active.

**Acceptance Criteria:**
- [ ] Hook checks for active oracles every 5 tool calls (not every tool call, to limit overhead)
- [ ] Active oracle discovery: first checks `${projectRoot}/.pythia-active/` directory for per-oracle JSON files
- [ ] Fallback discovery: registry lookup by longest `project_root` prefix match against current working directory
- [ ] If ambiguous (multiple oracles, no clear match): skips check (requires explicit name)
- [ ] If oracle found and `status` is not `"decommissioned"`: calls `oracle_pressure_check`
- [ ] If pressure check returns `"checkpoint_now"`: emits a warning to Claude's context prompting auto-checkpoint
- [ ] Does not call pressure check for oracles with `status === "decommissioned"`

---

#### FEAT-034: pythia-auth CLI Binary

**Priority:** P1
**Dependencies:** None (standalone binary)
**User Story:** As a user, I need a physical authentication gate for destructive operations so no AI agent can autonomously delete an oracle.

**Description:**
Standalone compiled binary (Go or Rust, not a shell script) at `~/.pythia/bin/pythia-auth`. Reads TOTP secret from platform-appropriate secure store, generates 6-digit TOTP code with 30-second validity. On macOS, the TOTP secret is stored in Keychain with `kSecAccessControlBiometryAny` requiring Touch ID. On other platforms, encrypted at rest with passphrase.

**Acceptance Criteria:**
- [ ] Binary located at `~/.pythia/bin/pythia-auth`
- [ ] Compiled binary (Go or Rust), not a shell script (prevents agent inspection/spoofing)
- [ ] Cannot be executed by Claude Code (requires interactive TTY)
- [ ] On macOS: reads TOTP secret from Keychain with biometric (`kSecAccessControlBiometryAny`) -- requires physical Touch ID
- [ ] On Linux/Windows: reads TOTP secret from `~/.pythia/keys/<name>.totp.enc` encrypted at rest; prompts for passphrase to decrypt
- [ ] Generates standard 6-digit TOTP code with 30-second window
- [ ] Master Recovery Key (256-bit) generated at enrollment, shown once, never stored by the system -- serves as fallback if authenticator app is lost
- [ ] TOTP setup occurs at first `spawn_oracle` for an oracle: generates secret, displays QR code, stores in secure store

---

#### FEAT-035: 7-Step Decommission Protocol

**Priority:** P1
**Dependencies:** FEAT-011, FEAT-012, FEAT-013, FEAT-034
**User Story:** As the system, I need a multi-gate decommission protocol so oracle destruction requires verified human intent at every stage.

**Description:**
The complete 7-step protocol orchestrated across `oracle_decommission_request`, human actions, and `oracle_decommission_execute`. No single agent action can complete the full protocol.

**Acceptance Criteria:**
- [ ] Step 1 (Request): `oracle_decommission_request` generates token and checklist; nothing deleted
- [ ] Step 2 (Human review): User runs `/pythia quality` and `/pythia status`, takes screenshot, submits to Claude; Claude verifies screenshot shows correct oracle name, version, and state
- [ ] Step 3 (TOTP): User runs `pythia-auth` binary directly in terminal (not callable by Claude); provides 6-digit code to Claude; Claude passes code to MCP tool for validation
- [ ] Step 4 (Confirmation phrase): User types `"DELETE [oracle-name] generation [N] containing [query-count] interactions"` with exact values from the state shown in the screenshot
- [ ] Step 5 (Cooling-off): System waits 5 minutes; user can cancel with `oracle_decommission_cancel` during this window
- [ ] Step 6 (Second confirmation): After 5 minutes, system prompts for re-confirmation; requires active human re-confirmation, not Claude confirmation
- [ ] Step 7 (Execute): `oracle_decommission_execute` fires only if all prior steps completed with the same unexpired token
- [ ] Oracle data (`oracle/` directory) is never deleted -- remains as historical artifact
- [ ] Three things Claude cannot do in step 3: run `pythia-auth` interactively, read the secure store, derive the TOTP code without the secret

---

### Non-Functional Requirements

---

#### Performance

- **Spawn time (resume):** Near-instantaneous when reattaching to an existing Gemini session (zero corpus re-load)
- **Spawn time (fresh):** Bounded by corpus size and stdin streaming speed; 5MB corpus should bootstrap in under 60 seconds
- **Context window capacity:** System designed for 2M token context windows (current Gemini Pro); automatically adapts to larger windows (3M/4M/5M) as they become available via `CONTEXT_WINDOW_BY_MODEL` lookup
- **Pressure check overhead:** Reads and updates `state.json` only; no daemon interaction; sub-second execution
- **Checkpoint duration:** Bounded by daemon response time for a large synthesis prompt; expected 30-120 seconds depending on corpus size
- **Idle timeout:** Default 5 minutes (`idle_timeout_ms: 300_000`); configurable per pool member
- **Idle sweep interval:** Every 60 seconds via `setInterval` on the GeminiRuntime singleton
- **Post-tool-use hook frequency:** Pressure check every 5 tool calls (not every call) to minimize latency impact
- **Batched git commits:** JSONL writes are immediate; git commits batched with 30-second debounce, 10-entry threshold, or 256KB threshold

#### Security

- **Decommission protocol:** 7-step human-gated process requiring TOTP (physical authenticator), biometric (Touch ID on macOS), screenshot proof, typed confirmation with dynamic values, 5-minute cooling-off period, and second confirmation
- **TOTP secret storage:** macOS Keychain with `kSecAccessControlBiometryAny` (biometric required); other platforms use passphrase-encrypted file at `~/.pythia/keys/<name>.totp.enc`
- **Decommission tokens:** Stored in-memory only on GeminiRuntime singleton; never written to git-tracked files; 10-minute TTL; lost on MCP server restart (forces re-request)
- **pythia-auth binary:** Compiled Go/Rust (not shell script); requires interactive TTY; cannot be invoked by Claude Code
- **Master Recovery Key:** 256-bit key shown once at enrollment, never stored by the system
- **No corpus path exposure to model:** Pythia receives text content, never file paths; the MCP server handles all file I/O

#### Reliability

- **Optimistic concurrency:** All state writes go through `writeStateWithRetry()` with CAS check on `state_version`; 5 retries with exponential backoff + jitter
- **Operation locks:** Heavyweight operations (checkpoint, reconstitute, decommission) acquire named locks with TTL to prevent orphans on crash
- **Lock heartbeat:** Long-running operations extend lock TTL every 60s via `startLockHeartbeat()` to prevent premature expiry
- **Partial pool failure:** Oracle transitions to `status: "degraded"` (not fatal); queries continue routing to healthy members; dead member slot retained with `status: "dead"`
- **Quota exhaustion:** Oracle transitions to `status: "quota_exhausted"`; auto-revival probe on next access after ~1 hour TTL
- **Hard context limit failure:** If Gemini returns a context-limit error mid-checkpoint, state is written to disk before error propagates; `oracle_salvage` provides recovery path
- **Bootstrap validation:** `validateBootstrapAck()` detects confusion responses and sets `status: "error"` with `last_bootstrap_ack.ok = false`
- **Crash recovery for commits:** JSONL is written to disk immediately; git commit can be re-attempted; no data loss window between disk write and commit
- **Registry recovery:** `registry.json` is git-tracked; `git checkout registry.json` is a valid recovery path

#### Data Integrity

- **Hash verification:** All static entries verified against sha256 at spawn time; `HASH_MISMATCH` is a hard error
- **Optimistic concurrency counter:** `state_version` incremented on every write; concurrent writers detected and retried
- **Atomic file writes:** Registry writes and `.pythia-active` marker files use temp-file + rename pattern
- **Deterministic corpus loading:** Files loaded in strict order: `load_order` role sequence, then `priority ASC, added_at ASC, path ASC`
- **Checkpoint supersedes learnings:** v(N+1) loads corpus + one checkpoint, not corpus + all prior interaction logs; prevents generational bloat
- **Tree hash + per-file hash:** Live sources use both `last_tree_hash` (fast gate for any change) and `last_file_hashes` (precise diff for which files changed)
- **Max sync caps:** `max_files` and `max_sync_bytes` (default 5MB) prevent accidental inclusion of `node_modules` or `dist`; hard error if exceeded
- **Manual manifest edits prohibited:** Editing `manifest.json` directly is a hard error on next spawn; `oracle_update_entry` is the only sanctioned update path

---

## Cross-References

The following companion documents provide additional architectural detail:

- `/Users/mikeboscia/pythia/docs/APP_FLOW.md` -- End-to-end flow diagrams for spawn, query, checkpoint, reconstitution, and decommission
- `/Users/mikeboscia/pythia/docs/TECH_STACK.md` -- Technology choices, runtime dependencies, and model compatibility matrix
- `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE.md` -- File layout for `oracle-tools.ts`, `oracle-types.ts`, `gemini/runtime.ts`, and integration points with the existing MCP server
- `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md` -- Phased build order, dependency graph, and milestone definitions
