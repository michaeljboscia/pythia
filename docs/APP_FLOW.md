# APP_FLOW -- Pythia Oracle Engine

**Cross-references:** PRD.md, TECH_STACK.md, BACKEND_STRUCTURE.md, IMPLEMENTATION_PLAN.md (all in `/Users/mikeboscia/pythia/docs/`)
**Design source of truth:** `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md`

---

## Overview

Pythia is a headless MCP server with no UI. All interaction occurs through MCP tool calls invoked by Claude Code (the orchestrator) or through `/pythia` slash command aliases that expand to those same tool calls. There are no screens, no routes, no HTTP endpoints. The "user journeys" are daemon lifecycle flows; the "screens" are tool call sequences and daemon states; the "routes" are MCP tool routing decisions made by the oracle engine.

The system is split across two locations:
- **Engine** (`/Users/mikeboscia/pythia/`) -- MCP tools, types, skills, and the global registry
- **Data** (`<project>/oracle/`) -- per-project manifest, state, interactions log, and checkpoints; committed alongside the code the oracle documents

Claude is the sole orchestrator. Pythia (Gemini daemon) reasons. Ion (Codex) executes. Claude bridges all three and logs everything.

---

## Oracle Lifecycle States

### Oracle-Level Status (`OracleStatus` in FEAT-016: oracle-types.ts)

```
                                     +-----------------+
                                     |  unregistered   |
                                     | (no registry    |
                                     |  entry exists)  |
                                     +--------+--------+
                                              |
                              spawn_oracle (FEAT-001)
                              registers in registry.json
                                              |
                                              v
                                     +--------+--------+
                              +----->|    healthy      |<-----+
                              |      | tokens_remaining|      |
                              |      | > headroom      |      |
                              |      +---+----+----+---+      |
                              |          |    |    |          |
                   auto-revival     press.|  member|     reconstitute
                   probe succeeds   rises |  dies  |     completes
                              |          v    |    |          |
                              |   +------+--+ |  +-v--------+-+
                              |   | warning | |  | degraded   |
                              |   | headroom| |  | pool member|
                              |   | /2 to   | |  | dead, but  |
                              |   | headroom| |  | others OK  |
                              |   +----+----+ |  +------+-----+
                              |        |      |         |
                              |   press.|    member     queries route
                              |   below |    dies      to healthy
                              |   h/2   |              members
                              |        v               |
                              |   +----+----+          |
                              |   | critical|          |
                              |   | < h/2   |          |
                              |   | AUTO-   |          |
                              |   | CKPT    |          |
                              |   +----+----+          |
                              |        |               |
                              |   checkpoint           |
                              |   succeeds             |
                              |        |               |
                              |        v               |
                              |   reconstitute --------+
                              |   (FEAT-009)
                              |        |
                              |   checkpoint
                              |   fails
                              |        |
                              |        v
                              |   +----+------+
                              |   | emergency |
                              |   | < h/4     |
                              |   | too late  |
                              |   | for ckpt  |
                              |   +----+------+
                              |        |
                              |        v
                              |   oracle_salvage
                              |   (FEAT-008)
                              |        |
                              |        v
                              |   +----+----+
                              |   | recon-  |
                              |   | stitut- |
                              |   | ing     |
                              |   +----+----+
                              |        |
                              |        | success
                              |        +---> (back to healthy)
                              |
                     +--------+--------+       +------------------+
                     | quota_exhausted |       |      error       |
                     | all models fail |       | bootstrap failed |
                     | auto-probe on   |       | checkpoint fail  |
                     | next access     |       | hard context hit |
                     +-----------------+       +--------+---------+
                                                        |
                                                  oracle_salvage
                                                  (FEAT-008)
                                                        |
                                                        v
                                               (manual recovery)

                     +------------------+
                     | decommissioned   |
                     | 7-step protocol  |
                     | (FEAT-035)       |
                     | data preserved   |
                     | registry archived|
                     +------------------+
```

**State definitions:**

| Status | Meaning | Trigger |
|--------|---------|---------|
| `healthy` | Normal operation, tokens_remaining > headroom | Spawn completes, reconstitute completes, auto-revival succeeds |
| `warning` | Context pressure approaching threshold (headroom/2 to headroom) | `oracle_pressure_check` (FEAT-003) detects encroachment |
| `critical` | Context pressure below headroom/2, auto-checkpoint fires | `oracle_pressure_check` detects critical threshold |
| `emergency` | Context pressure below headroom/4, too late for safe checkpoint | `oracle_pressure_check` detects emergency threshold; checkpoint already failed or headroom insufficient for checkpoint |
| `degraded` | One or more pool members dead, but oracle still operational | Pool member crash (not context pressure -- that is `warning`/`critical`) |
| `error` | Bootstrap failed, checkpoint failed mid-write, or hard context limit hit | `BOOTSTRAP_FAILED`, `CHECKPOINT_FAILED`, hard Gemini context error |
| `quota_exhausted` | All Gemini models in fallback chain exhausted | Model fallback chain fully exhausted |
| `decommissioned` | Oracle permanently retired via 7-step protocol | `oracle_decommission_execute` (FEAT-012) completes |

---

## Daemon Pool Member States

Each oracle maintains a pool of up to `pool_size` (default: 2) Gemini daemon members. Members are managed individually but checkpoint/reconstitute as a unit.

### Member-Level Status (`DaemonPoolMember.status` in FEAT-016)

```
                  spawn_oracle or
                  on-demand scaling
                        |
                        v
                  +-----+-----+
           +----->|   idle    |<-----+
           |      | awaiting  |      |
           |      | queries   |      |
           |      +-----+-----+      |
           |            |             |
           |       ask_daemon    query completes
           |       routes query  successfully
           |            |             |
           |            v             |
           |      +-----+-----+      |
           |      |   busy    +------+
           |      | processing|
           |      | query     |
           |      +-----+-----+
           |            |
           |       daemon crashes
           |       or API error
           |            |
           |            v
           |      +-----+-----+
           |      |   dead    |
           |      | slot kept |
           |      | in pool   |
           |      +-----------+
           |
      respawn or
      on-demand
           |
           |      +-----+-----+
           +------|  dismissed |
                  | soft-dismiss|
                  | session on |
                  | disk, no   |
                  | live process|
                  +------------+
```

**Transition rules:**

| From | To | Trigger |
|------|-----|---------|
| (none) | `idle` | `spawn_oracle` (FEAT-001) bootstraps member, or on-demand scaling spawns new member |
| `idle` | `busy` | `ask_daemon` routes a query to this member |
| `busy` | `idle` | Query completes successfully |
| `busy` | `dead` | Daemon crashes, API error, or hard context limit hit |
| `idle` | `dismissed` | Idle timeout sweep (FEAT-022) fires after `idle_timeout_ms` (default 5 min) |
| `idle` | `dismissed` | `oracle_reconstitute` (FEAT-009) soft-dismisses all members before version increment |
| `dismissed` | `idle` | Respawned on next concurrent access need (spawn-on-demand) |
| `dead` | `idle` | Explicit respawn or spawn-on-demand |

**Key invariant:** `dismissed` preserves the Gemini session on disk (can resume). `dead` means the process is gone unexpectedly. Hard dismiss (full session deletion) only happens during `oracle_decommission_execute` (FEAT-012).

---

## Primary Flows

### Flow 1: First-Time Oracle Setup

**Precondition:** User has created `<project>/oracle/manifest.json` with static_entries and live_sources defined. No registry entry exists yet.

**Slash command:** `/pythia [query]` (FEAT-025) or direct `spawn_oracle` (FEAT-001) call.

```
Step 1: User creates <project>/oracle/manifest.json
        - Defines static_entries with absolute file paths, sha256 hashes, roles
        - Defines live_sources with glob patterns, roots, caps
        - Sets pool_size, checkpoint_headroom_tokens
        - Creates <project>/oracle/learnings/ directory (empty)
        - Creates <project>/oracle/checkpoints/ directory (empty)

Step 2: Claude invokes spawn_oracle(name)
        |
        v
Step 3: Registry lookup (FEAT-017)
        - Reads /Users/mikeboscia/pythia/registry.json
        - Oracle name not found --> proceed with fresh spawn
        - Registers oracle: writes entry with name, oracle_dir, project_root, created_at
        - Atomic write via temp file + rename
        |
        v
Step 4: Corpus resolution -- Pass 1: resolveCorpusForSpawn(name) (FEAT-019)
        - Reads manifest.json from oracle_dir
        - Validates manifest schema (schema_version, required fields)
        - For each static_entry:
          - Reads file from disk
          - Computes sha256, compares against manifest value
          - HASH_MISMATCH --> hard error, spawn aborts
          - FILE_NOT_FOUND --> hard error if required: true
        - For each live_source:
          - Resolves globs against root directory
          - Applies include/exclude filters
          - Enforces max_files and max_sync_bytes caps
          - CORPUS_CAP_EXCEEDED if exceeded
          - Computes tree hash + per-file hashes
        - Sorts all entries by load_order role priority, then by:
          priority ASC, added_at ASC, path ASC (deterministic)
        - Estimates total tokens: totalChars / chars_per_token_estimate
        - Token gate: if estimatedTokens > (discoveredContextWindow - checkpoint_headroom_tokens)
          --> CORPUS_CAP_EXCEEDED
        - Byte gate: if totalBytes > MAX_BOOTSTRAP_STDIN_BYTES (6MB)
          --> CORPUS_CAP_EXCEEDED
        - Returns ResolvedCorpus (text payloads ready to inject)
        |
        v
Step 5: Context window discovery (FEAT-014)
        - Looks up model name in CONTEXT_WINDOW_BY_MODEL hardcoded table
        - Stores discovered value in state.json
        |
        v
Step 6: Daemon spawn (FEAT-014, FEAT-015)
        - Calls GeminiRuntime.spawnDaemon() for first pool member
          (session_name: "daemon-<oracle-name>-0")
        - One member only -- additional members spawn on demand
        |
        v
Step 7: Corpus injection -- Pass 2: loadResolvedCorpusIntoDaemon() (FEAT-019)
        - Builds v1 preamble (no inherited_wisdom -- first generation):
          "You are Pythia -- the persistent knowledge oracle for [project].
           You are the first of your lineage (v1). You have no prior checkpoints.
           Your reality begins with the corpus load below. Build well."
        - Streams preamble + corpus payloads via stream.write() with drain handlers
          (not a single .end(payload) -- prevents backpressure on 5MB+ payloads)
        - Sends final "corpus loaded" acknowledgment prompt
        - Validates bootstrap ack via validateBootstrapAck()
          - If Pythia responds with confusion --> BOOTSTRAP_FAILED,
            status = "error", last_bootstrap_ack.ok = false
        - Records session_chars_at_spawn
        |
        v
Step 8: State initialization (FEAT-018)
        - Creates <project>/oracle/state.json with:
          version: 1, status: "healthy", daemon_pool with one member,
          session_chars_at_spawn, tokens_remaining, etc.
        - Writes .pythia-active/<oracle-name>.json marker (FEAT-024)
        |
        v
Step 9: TOTP enrollment (first generation only)
        - If no TOTP secret exists for this oracle name:
          - Generates TOTP secret
          - Displays QR code in terminal for authenticator app
          - Stores secret in macOS Keychain (biometric-locked) or
            ~/.pythia/keys/<name>.totp.enc (encrypted, other platforms)
        |
        v
Step 10: Return result
         { oracle_name, version: 1, pool: [...], resumed: false,
           corpus_files_loaded, tokens_remaining }
```

**Error paths:**

| Error | Code | Recovery |
|-------|------|----------|
| File missing from static_entries | `FILE_NOT_FOUND` | Fix path in manifest, re-run spawn |
| Hash mismatch on static entry | `HASH_MISMATCH` | Update sha256 in manifest via `oracle_update_entry` (FEAT-007) |
| Glob resolves too many files | `CORPUS_CAP_EXCEEDED` | Adjust max_files/max_sync_bytes in manifest |
| Total corpus exceeds context window | `CORPUS_CAP_EXCEEDED` | Remove entries, increase checkpoint_headroom, or wait for larger context window |
| Bootstrap payload > 6MB stdin limit | `CORPUS_CAP_EXCEEDED` | Reduce corpus size |
| Pythia fails to acknowledge bootstrap | `BOOTSTRAP_FAILED` | Check corpus content, retry spawn |
| Registry write conflict | `CONCURRENCY_CONFLICT` | Automatic retry via writeStateWithRetry (5 retries) |

---

### Flow 2: Normal Consultation

**Precondition:** Oracle is spawned and healthy. At least one pool member is idle or available.

**Slash command:** `/pythia "What is the recommended auth strategy?"` (FEAT-025)

```
Step 1: Claude invokes /pythia "question" or oracle_pressure_check + ask_daemon directly
        |
        v
Step 2: Pressure check (FEAT-003, FEAT-020)
        - Reads state.json
        - Computes tokens_remaining from char totals:
          memberTokens[i] = (session_chars_at_spawn + member.chars_in + member.chars_out)
                            / chars_per_token_estimate
          estimated_total_tokens = MAX(memberTokens)  [drives checkpoint decision]
          tokens_remaining = discovered_context_window - estimated_total_tokens
        - Evaluates pressure model:
          > headroom           --> "healthy"
          headroom/2 to headroom --> "warning" (checkpoint_soon)
          < headroom/2         --> "critical" (checkpoint_now / auto-checkpoint)
        - Updates state.json with latest estimates
        - If critical: auto-triggers oracle_checkpoint (Flow 4) before proceeding
        |
        v
Step 3: Pool member selection
        - Scans daemon_pool for members with status === "idle"
        - If idle member found --> select it, set status = "busy"
        - If NO idle member found:
          A) If pool_size ceiling allows another member:
             - Kicks off async background spawn
             - Returns DAEMON_BUSY_QUERY with scaling_up: true
             - Claude retries after short delay
          B) If pool at ceiling:
             - Returns DAEMON_BUSY_QUERY with scaling_up: false
             - Claude waits for a member to free up
        |
        v
Step 4: Pending sync drain (FEAT-021)
        - Before routing query, check selected member's pending_syncs array
        - If non-empty: pop all entries, concatenate payloads, inject as single
          "Updated source files..." message
        - Update last_corpus_sync_hash, clear pending_syncs
        |
        v
Step 5: Cross-daemon context sync (FEAT-021)
        - Read member's last_synced_interaction_id
        - Read vN-interactions.jsonl from that ID to current head
        - If delta exists, inject summary before the query:
          "[Context sync -- decisions since your last query:
           - v1-q004: Chose JWT for auth (from parallel session)
           - v1-q005: API is REST not GraphQL (from parallel session)]
           Your question: [actual question]"
        - If no delta: inject question directly
        |
        v
Step 6: Ask daemon (FEAT-015)
        - Calls GeminiRuntime.askDaemon(daemon_id, question)
        - Returns { text, chars_in, chars_out }
        - Updates member: chars_in += response.chars_in,
          chars_out += response.chars_out, last_query_at = now
        - Sets member status back to "idle"
        |
        v
Step 7: Log learning (FEAT-005)
        - Claude invokes oracle_log_learning with structured InteractionEntry:
          { id: "v1-q004", type: "consultation", question, counsel, decision, ... }
        - Appends to <oracle_dir>/learnings/vN-interactions.jsonl
        - Triggers batched git commit (FEAT-023) if flush conditions met
        - Updates query_count in state.json
        - Updates member's last_synced_interaction_id
        |
        v
Step 8: Return counsel to Claude
        - Claude uses Pythia's response to inform next action
        - If Ion delegation needed: Claude sends to Ion, then calls /pythia sync
```

**Error paths:**

| Condition | Behavior |
|-----------|----------|
| All members busy, pool at ceiling | `DAEMON_BUSY_QUERY` (scaling_up: false) -- Claude waits |
| All members busy, scaling possible | `DAEMON_BUSY_QUERY` (scaling_up: true) -- Claude retries after delay |
| Pool is empty (all dismissed/dead) | Spawn-on-demand triggers fresh member bootstrap |
| Member crashes mid-query | Member status = "dead", oracle status = "degraded", Claude retries on healthy member |
| Quota exhausted on API call | Oracle status = "quota_exhausted", `DAEMON_QUOTA_EXHAUSTED` returned |
| Pressure is critical | Auto-checkpoint fires before query proceeds (may add latency) |

---

### Flow 3: Corpus Sync

**Precondition:** Oracle is spawned. Ion (Codex) has shipped code changes that affect live_sources.

**Slash command:** `/pythia sync` or `/pythia sync app-codebase` (FEAT-026)

```
Step 1: Claude invokes oracle_sync_corpus(name, source_id?) (FEAT-002)
        |
        v
Step 2: Resolve live_sources
        - If source_id provided: resolve only that live_source entry
        - If omitted: resolve all live_sources from manifest
        - For each source:
          - Re-run glob resolution against root directory
          - Apply include/exclude filters
          - Enforce max_files and max_sync_bytes caps
          - CORPUS_CAP_EXCEEDED if exceeded
          - Compute tree hash from resolved file list
        |
        v
Step 3: Hash comparison (fast gate)
        - Compare new tree_hash against last_tree_hash stored on the LiveSource
        - If unchanged --> skip (no-op), return early
        - If changed --> compute per-file hashes for precise diff
        |
        v
Step 4: Per-member sync dispatch
        For each pool member:
        |
        +-- status === "idle":
        |   - Inject sync payload immediately:
        |     "Updated source files. Read and absorb: [changed file contents]"
        |   - Update member's last_corpus_sync_hash
        |   - Clear any matching pending_syncs entries
        |
        +-- status === "busy":
        |   - Push to member's pending_syncs array:
        |     { source_id, tree_hash, payload_ref, queued_at }
        |   - Will drain at next ask_daemon call (Step 4 of Flow 2)
        |
        +-- status === "dismissed" or "dead":
            - Skip (they get current corpus on next spawn)
        |
        v
Step 5: Update manifest metadata
        - Set last_sync_at = now
        - Set last_tree_hash = new tree hash
        - Set last_file_hashes = new per-file hash map
        |
        v
Step 6: Return result
        { source_id, files_synced, files_skipped, bytes_loaded,
          tree_hash, members_synced_immediately, members_queued }
```

**Error paths:**

| Error | Code | Recovery |
|-------|------|----------|
| Glob exceeds max_files | `CORPUS_CAP_EXCEEDED` | Adjust manifest caps or exclude patterns |
| Glob exceeds max_sync_bytes | `CORPUS_CAP_EXCEEDED` | Adjust manifest caps or exclude patterns |
| Source root does not exist | `FILE_NOT_FOUND` | Fix root path in manifest |
| State write conflict | `CONCURRENCY_CONFLICT` | Automatic retry (writeStateWithRetry) |

---

### Flow 4: Checkpoint

**Precondition:** Oracle is spawned and has at least one live pool member with sufficient headroom to generate a checkpoint.

**Trigger:** Auto-triggered by pressure check at critical threshold, or manual via `/pythia checkpoint` (FEAT-027).

**MCP tool:** `oracle_checkpoint(name, timeout_ms?, commit?)` (FEAT-004)

```
Step 1: Lock acquisition
        - Calls acquireOperationLock("checkpoint")
        - Uses CAS via writeStateWithRetry
        - If lock held by another operation --> DAEMON_BUSY_LOCK
        - Lock has TTL to prevent orphans on crash
        - Starts lock heartbeat (extend every 60s, 10-min TTL)
        |
        v
Step 2: Headroom verification
        - Check tokens_remaining against checkpoint_headroom_tokens / 4
        - If tokens_remaining < headroom / 4:
          --> Too late to safely generate a checkpoint
          --> Return error, instruct user to run oracle_salvage (FEAT-008)
        |
        v
Step 3: Checkpoint prompt generation
        - Sends Pythia the checkpoint prompt with XML output tags:
          "Write your checkpoint inside <checkpoint> tags. Cover:
           (1) All static corpus files loaded and key findings from each.
               DO NOT summarize source code -- summarize the architectural
               decisions and constraints that the code expresses.
           (2) Every question asked this session and your answer summary
           (3) Every architectural/strategic decision made based on your counsel
           (4) Your top 10 cross-cutting insights from the full corpus
           (5) Gaps, contradictions, or uncertainties detected
           Be exhaustive -- this is your legacy for your successor."
        |
        v
Step 4: Response extraction (cascading pipeline)
        - Step 4a: Try XML tag extraction: parse <checkpoint>...</checkpoint>
        - Step 4b: If no tags found: scrub known LLM wrapper patterns
          - Strip leading preamble ("Sure, here's your checkpoint:", "Here is the checkpoint:", etc.)
          - Strip trailing boilerplate ("Let me know if you need anything else", etc.)
          - Apply common regex patterns for LLM prefix/suffix removal
        - Step 4c: Use scrubbed full response as checkpoint content, log warning
          - Track tag-miss frequency to tune the prompt over time
        - Valid content is never discarded over a formatting issue
        |
        v
Step 5: File write
        - Saves to <oracle_dir>/checkpoints/v<N>-checkpoint.md
        - Computes sha256 of saved file
        |
        v
Step 6: Manifest update
        - Adds checkpoint to manifest static_entries:
          { path: checkpoint_path, role: "checkpoint", sha256: hash, ... }
        |
        v
Step 7: Git commit (if commit: true, which is the default)
        - Commits checkpoint file + updated manifest
        |
        v
Step 8: State update
        - Sets last_checkpoint_path in state.json
        - Updates state_version
        |
        v
Step 9: Lock release
        - Stops heartbeat
        - Releases operation lock via releaseLock()
        |
        v
Step 10: Return result
         { checkpoint_path, bytes, sha256, version }
```

**Error paths:**

| Error | Code | Recovery |
|-------|------|----------|
| Lock held by another operation | `DAEMON_BUSY_LOCK` | Wait for lock_expires_at, retry |
| Too little headroom remaining | Error (headroom < h/4) | Use `oracle_salvage` (FEAT-008) instead |
| Gemini hits hard context limit mid-checkpoint | `CHECKPOINT_FAILED` | status = "error", use `oracle_salvage` |
| `<checkpoint>` tags missing from response | Warning logged | Cascading extraction: scrub LLM wrappers, use full response (decision #46) |
| Lock heartbeat fails | Lock expires, competing op may proceed | Retry checkpoint |

---

### Flow 5: Reconstitution (Generation Cutover)

**Precondition:** Checkpoint exists (or checkpoint_first: true will create one). Oracle is at critical pressure or user explicitly requests cutover.

**Slash command:** `/pythia reconstitute` (FEAT-028)

**MCP tool:** `oracle_reconstitute(name, checkpoint_first?, dismiss_old?)` (FEAT-009)

```
Step 1: Lock acquisition
        - Acquires operation lock (same as checkpoint)
        - DAEMON_BUSY_LOCK if held
        |
        v
Step 2: Query gate + drain phase (decision #45)
        - Sets oracle status to ORACLE_PRESERVING -- new queries rejected
          with "Pythia is checkpointing, try again after reconstitution"
        - Waits for all in-flight queries across all pool members to complete
        - No artificial timeout -- since no NEW queries are accepted, drain
          is bounded by the longest in-flight query (seconds, not minutes)
        - Safety valve: 5-minute hard backstop. If this fires, fail-fast
          (abort reconstitution, release lock, return RECONSTITUTE_FAILED).
          Never force-proceed. This should essentially never trigger.
        |
        v
Step 3: Checkpoint with fallback (if checkpoint_first: true, which is the default)
        - Calls oracle_checkpoint internally (Flow 4, steps 2-10)
        - Daemons are still alive with full context at this point
        - This is the last act of generation N
        - If checkpoint fails: auto-fallback to oracle_salvage (decision #44)
          - Fresh single-shot Gemini API call reads vN-interactions.jsonl
          - Synthesizes a checkpoint from the structured interaction history
          - If salvage succeeds: continue reconstitution using salvage-derived checkpoint
          - If salvage also fails: hard-fail, abort reconstitution entirely
            (v(N) stays alive, nothing destroyed, return RECONSTITUTE_FAILED)
        |
        v
Step 4: Shrink to zero
        - Soft-dismisses ALL pool members (preserve session data on disk)
        - Sets each member status = "dismissed"
        - Generation N is now complete
        |
        v
Step 5: Version increment
        - N --> N+1
        - Updates manifest version
        |
        v
Step 6: Manifest update for new generation
        - Adds vN-checkpoint.md as role: "checkpoint" in static_entries
          (if not already added by the checkpoint step)
        - Does NOT re-add vN-interactions.jsonl -- checkpoint supersedes
          learnings for context purposes
        - For live_sources with reconstitute_sync_mode: "hash_gated_delta":
          - Re-syncs only if tree hash has changed since last sync
        - For live_sources with reconstitute_sync_mode: "full_rescan":
          - Re-sends entire snapshot regardless
        |
        v
Step 7: Spawn v(N+1)
        - Spawns one fresh pool member (not resuming old sessions)
        - Builds reconstitution preamble with <inherited_wisdom>:
          "You are Pythia -- the persistent knowledge oracle for [project].
           You are version N+1. Your predecessor, Pythia vN, accumulated deep
           wisdom and has passed it to you through the checkpoint below.
           <inherited_wisdom>
           [EXTRACTED CONTENT OF vN-checkpoint.md]
           </inherited_wisdom>
           You are not starting over. You are the continuation of a lineage."
        - If checkpoint > MAX_INHERITED_WISDOM_INLINE_CHARS (180K chars):
          - Preamble includes brief lineage summary instead
          - Full checkpoint loaded as first static chunk in Pass 2
        - Full corpus load follows (Pass 2)
        - Bootstrap ack validation
        |
        v
Step 8: State reset
        - Clears daemon_pool, populates with fresh member
        - Resets session_chars_at_spawn from new bootstrap
        - Creates new vN+1-interactions.jsonl (empty)
        - Sets status = "healthy"
        |
        v
Step 9: Lock release
        |
        v
Step 10: Return result
         { previous_version: N, new_version: N+1,
           new_daemon_id, loaded_artifacts }
```

**Error paths:**

| Error | Code | Recovery |
|-------|------|----------|
| Lock held | `DAEMON_BUSY_LOCK` | Wait and retry |
| Checkpoint fails during reconstitute | Auto-fallback to `oracle_salvage` | Salvage synthesizes checkpoint from interactions log; if salvage also fails: `RECONSTITUTE_FAILED`, abort (decision #44) |
| New daemon fails bootstrap | `BOOTSTRAP_FAILED` | status = "error", investigate corpus |
| Safety valve timeout (5 min) | `RECONSTITUTE_FAILED` | Fail-fast, abort reconstitution. Never force-proceed (decision #45) |

**Key invariant:** Mixed generations are forbidden. All pool members reconstitute together as a single atomic generation transition. This prevents split-brain where different members give inconsistent answers based on different generation states.

---

### Flow 6: Salvage (Dead Daemon Recovery)

**Precondition:** Daemon died without a clean checkpoint. Interactions log may or may not have entries.

**Slash command:** `/pythia salvage` (FEAT-029)

**MCP tool:** `oracle_salvage(name)` (FEAT-008)

```
Step 1: Claude invokes oracle_salvage(name)
        |
        v
Step 2: Read interactions log
        - Opens <oracle_dir>/learnings/vN-interactions.jsonl
        - Parses all entries for current version N
        |
        v
Step 3: Branch on log contents
        |
        +-- Log has entries:
        |   - Uses a FRESH single-shot Gemini API call (NOT the oracle daemon)
        |   - Sends all interaction entries as input
        |   - Prompt: "Synthesize these interactions into a checkpoint document"
        |   - Extracts <checkpoint> from response
        |
        +-- Log is empty:
            - Generates stub checkpoint:
              "No new architectural decisions were recorded during Generation N."
            - Explicitly carries forward insights from v(N-1) checkpoint
              (reads v(N-1)-checkpoint.md if it exists)
        |
        v
Step 4: Save checkpoint
        - Writes to <oracle_dir>/checkpoints/vN-checkpoint.md
        - Computes sha256
        |
        v
Step 5: Return result
        { checkpoint_path, source: "salvage", entries_processed }
```

**Error paths:**

| Condition | Behavior |
|-----------|----------|
| Interactions log does not exist | Creates stub checkpoint with v(N-1) carry-forward |
| Interactions log is empty | Creates stub checkpoint with v(N-1) carry-forward |
| Fresh Gemini API call fails (quota) | `CHECKPOINT_FAILED` -- retry later |
| No v(N-1) checkpoint exists (v1 death with no interactions) | Minimal stub: "Generation 1 produced no recorded decisions" |

**Why a fresh API call?** The oracle daemon is dead -- its context is gone. Salvage uses a separate, stateless Gemini call that does not touch the oracle's pool or state. It reads only the JSONL file.

---

### Flow 7: Decommission (7-Step Protocol) (FEAT-035)

**The nuclear option.** Deliberately difficult to execute. No single agent action can complete the full sequence.

**MCP tools:** `oracle_decommission_request` (FEAT-011), `oracle_decommission_execute` (FEAT-012), `oracle_decommission_cancel` (FEAT-013)

```
STEP 1: Request Phase
        Claude invokes oracle_decommission_request(name, reason) (FEAT-011)
        |
        - Validates oracle exists, is not already decommissioned
        - Generates UUID decommission_token (10-minute TTL)
        - Token stored IN-MEMORY ONLY on GeminiRuntime singleton (FEAT-014)
          (NEVER written to state.json -- state.json is git-tracked)
        - Records request as session_note in vN-interactions.jsonl
        - Returns checklist for human to complete
        |
        v
STEP 2: Human Review Checkpoint
        User runs /pythia quality (FEAT-032) and /pythia status (FEAT-031)
        |
        - User takes a SCREENSHOT of the output
        - User submits screenshot to Claude
        - Claude verifies screenshot shows correct oracle name, version, state
        - This proves a human physically examined what is about to be destroyed
        - Claude CANNOT generate this screenshot
        |
        v
STEP 3: TOTP Verification (FEAT-034)
        User runs pythia-auth CLI binary directly in their terminal
        |
        - Located at ~/.pythia/bin/pythia-auth (compiled Go/Rust binary)
        - NOT callable by Claude (requires TTY)
        - macOS: reads TOTP secret from Keychain (Touch ID / biometric required)
        - Other platforms: decrypts ~/.pythia/keys/<name>.totp.enc (passphrase)
        - Generates 6-digit TOTP code (30-second expiry)
        - User provides code to Claude
        - Three things Claude cannot do:
          1. Run pythia-auth interactively
          2. Read the secure store
          3. Derive the TOTP code without the secret
        |
        v
STEP 4: Typed Confirmation Phrase
        User must type exactly:
        "DELETE [oracle-name] generation [N] containing [query-count] interactions"
        |
        - Numbers come from the state shown in the screenshot (Step 2)
        - Forces the human to read the actual values
        - Not a copy-paste-able static string
        |
        v
STEP 5: Cooling-Off Period (5 minutes)
        System waits. Nothing executes.
        |
        - User can cancel at any time with oracle_decommission_cancel(name, token)
          (FEAT-013)
        - Cancel invalidates the in-memory token
        - Cancel logs session_note: "Decommission cancelled by user"
        - This step breaks "I'm in flow, just confirm everything" momentum
        |
        v
STEP 6: Second Confirmation After Wait
        System prompts: "Decommission of [name] v[N] ([query-count] interactions)
        is queued. Confirm execution."
        |
        - The HUMAN must actively re-confirm (not Claude)
        |
        v
STEP 7: Execute
        Claude invokes oracle_decommission_execute(name, token, totp_code,
        confirmation_phrase) (FEAT-012)
        |
        - Validates: token matches, not expired, TOTP valid, phrase matches
        - Any gate failure --> DECOMMISSION_REFUSED (specific sub-code)
        |
        - Acquires operation lock
        - Best-effort checkpoint or salvage (does NOT fail if this step fails)
        - Hard-dismisses all pool members (full session deletion)
        - Sets state.status = "decommissioned"
        - Clears daemon_pool
        - Archives registry entry (adds decommissioned_at, does NOT delete)
        - Removes .pythia-active/<oracle-name>.json marker
        - Releases lock
        |
        v
        Return: { oracle_name, decommissioned_at, final_checkpoint_path }

        Oracle data (<project>/oracle/) remains on disk permanently.
        Registry entry remains with decommissioned_at timestamp.
        Nothing is deleted from the filesystem -- only daemon processes are killed.
```

**Cancel path (available at any point between Step 1 and Step 7):**

```
Claude invokes oracle_decommission_cancel(name, token) (FEAT-013)
  - Validates token matches active decommission request
  - Removes token from GeminiRuntime.decommissionTokens map
  - Logs session_note: "Decommission cancelled by user"
  - Returns { oracle_name, cancelled_at }
  - If no pending decommission: DECOMMISSION_REFUSED
```

**Error codes specific to decommission:**

| Code | Meaning |
|------|---------|
| `DECOMMISSION_REFUSED` | Any gate check failed |
| `DECOMMISSION_TOKEN_EXPIRED` | 10-minute TTL elapsed |
| `DECOMMISSION_CANCELLED` | User cancelled during cooling-off |
| `TOTP_INVALID` | TOTP code incorrect or expired |
| `CONFIRMATION_PHRASE_MISMATCH` | Typed phrase does not match expected |

---

### Flow 8: Quality Report

**Precondition:** Oracle has recorded interactions in the current generation's JSONL.

**Slash command:** `/pythia quality` (FEAT-032)

**MCP tool:** `oracle_quality_report(name, version?)` (FEAT-010)

```
Step 1: Claude invokes oracle_quality_report(name, version?)
        - If version omitted: uses current version from state.json
        |
        v
Step 2: Read interactions log
        - Opens <oracle_dir>/learnings/v<N>-interactions.jsonl
        - Parses all consultation entries (type === "consultation")
        |
        v
Step 3: Compute answer length trend
        - Divides interactions into early half and late half
        - Computes average answer (counsel) length for each half
        - Calculates length_trend_pct_change
        - Significant drop indicates degrading working memory
        |
        v
Step 4: Compute Code-Symbol Density Ratio
        - For each answer: counts proper nouns, camelCase identifiers,
          snake_case, file paths relative to total words
        - Computes early vs. late density
        - Drop indicates generic platitudes replacing specific codebase references
        |
        v
Step 5: Track tokens_remaining at each query
        - From tokens_remaining_at_query field in each interaction
        - Identifies inflection points where quality metrics changed
        |
        v
Step 6: Compute suggested_headroom_tokens via computeSuggestedHeadroom()
        - v1 oracle with no degradation flags:
          Returns manifest.checkpoint_headroom_tokens (250K default)
        - v2+ with degradation history across versions:
          clamp(P50(onset_tokens) + 50_000, 100_000, context_window * 0.5)
        |
        v
Step 7: Compile flags
        - Auto-detected: "length_drop", "vagueness" (from metrics above)
        - Manual: "self_contradiction", "hallucination" (user-set in v1,
          auto-detected in v2 via LLM-as-judge)
        |
        v
Step 8: Return QualityReport
        { oracle_name, version, query_count, degradation_onset_query,
          degradation_onset_tokens_remaining, avg_answer_length_early,
          avg_answer_length_late, length_trend_pct_change,
          code_symbol_density_early, code_symbol_density_late,
          suggested_headroom_tokens, flags }
```

---

## Background Processes

### Idle Timeout Sweep (FEAT-022)

Managed by the `GeminiRuntime` singleton (FEAT-014).

```
Lifecycle:
  - Started: on GeminiRuntime singleton instantiation
  - Interval: setInterval every 60 seconds
  - Stopped: on MCP server process shutdown (clearInterval)

Each sweep iteration:
  1. Iterate all registered oracles in registry.json
  2. For each oracle, read state.json
  3. For each pool member with status === "idle":
     - Compute: Date.now() - Date.parse(member.last_query_at)
     - If elapsed > member.idle_timeout_ms (default 300,000 = 5 min):
       - Soft-dismiss the member via GeminiRuntime.dismissDaemon(daemon_id, hard: false)
       - Set member status = "dismissed" in state.json
       - member.daemon_id = null (no live process)
       - Session preserved on disk (can resume)
  4. Skip members with status !== "idle" (busy, dead, dismissed)

Edge cases:
  - member.last_query_at is null (just spawned, never queried):
    Use member spawn timestamp as baseline
  - Multiple oracles active: sweep checks all of them independently
  - State write conflict during sweep: writeStateWithRetry handles it
```

### Batched Git Commits (FEAT-023)

Learning entries are written to JSONL immediately (data safe on disk). Git commits are deferred and batched.

```
Flush triggers (any one fires the commit):
  1. Pending entries >= 10
  2. Pending bytes >= 256KB
  3. 30-second debounce timer expires
  4. Explicit force: true flag on oracle_log_learning call
  5. Process shutdown hook (flush before exit)

Implementation:
  - batchCommitLearnings() maintains per-oracle counters:
    { pendingCount, pendingBytes, lastFlushAt, debounceTimer }
  - On each oracle_log_learning call:
    1. Write JSONL entry to disk (immediate, synchronous)
    2. Increment pendingCount, pendingBytes
    3. Reset debounce timer (30s)
    4. Check trigger conditions
    5. If any trigger met: git add + git commit for oracle_dir
  - Commit message format:
    "oracle(<name>): log N interactions (vM-qXXX to vM-qYYY)"
```

### Post-Tool-Use Pressure Hook (FEAT-033)

Integrated into the existing Claude Code hook system at `/Users/mikeboscia/.claude/hooks/post-tool-use.sh`.

```
Trigger: Every 5 tool calls (counter maintained in hook state)

Discovery sequence:
  1. Check for <projectRoot>/.pythia-active/ directory (FEAT-024)
     - Contains per-oracle JSON files with oracle_name, oracle_dir
     - If found: use listed oracle(s)
  2. Fallback: Registry lookup (FEAT-017)
     - Match cwd against longest project_root prefix in registry.json
     - If ambiguous (multiple matches): skip check (require explicit name)
  3. If no oracle found: no-op

For each discovered oracle (if status !== "decommissioned"):
  1. Call oracle_pressure_check(name) (FEAT-003)
  2. Evaluate recommendation:
     - "healthy": no action
     - "checkpoint_soon": log warning to Claude's output
     - "checkpoint_now": auto-trigger oracle_checkpoint (FEAT-004)
     - "reconstitute": auto-trigger oracle_reconstitute (FEAT-009)

Note: "dead" is a DaemonPoolMember.status, not an OracleStatus.
The oracle itself is never "dead" -- individual pool members can be.
```

---

## Error Recovery Flows

### Member Crash

```
Detection:
  - GeminiRuntime.askDaemon() throws an unrecoverable error
  - API returns error indicating session is dead

Recovery:
  1. Set member.status = "dead" in state.json
  2. If any other member is healthy: set oracle status = "degraded"
  3. If NO other member is healthy: oracle needs attention
  4. Dead member's slot remains in daemon_pool (not removed)
  5. Queries route to healthy members only
  6. /pythia status (FEAT-031) surfaces which member failed
  7. Recovery options:
     a) Explicit respawn of the failed member's session_name
     b) Spawn-on-demand replaces it when concurrent access is needed
     c) oracle_reconstitute (FEAT-009) replaces entire pool
```

### Lock Orphan

```
Scenario: Operation (checkpoint/reconstitute/decommission) crashes mid-execution,
          leaving the lock held with no process to release it.

Prevention:
  - Every lock has a TTL (lock_expires_at in state.json)
  - Long operations use startLockHeartbeat() to extend TTL every 60s

Recovery:
  1. Competing operation calls acquireOperationLock()
  2. Reads lock_expires_at from state.json
  3. If Date.now() > Date.parse(lock_expires_at):
     - Lock is expired, treated as free
     - New operation claims the lock via CAS
  4. If lock is not expired:
     - Returns DAEMON_BUSY_LOCK
     - Caller polls every 500ms up to waitTimeoutMs (default 30s)
     - After timeout: LOCK_TIMEOUT
```

### Concurrent State Write

```
Mechanism: writeStateWithRetry() (FEAT-018)

  1. Read state.json, note state_version
  2. Apply mutator function to state
  3. Before writing: re-read state.json
  4. If state_version on disk !== state_version we read in step 1:
     - Another writer modified state between our read and write
     - Wait: baseBackoffMs * 2^attempt + random(jitterMs)
       (default: 100ms * 2^N + random(50ms))
     - Re-read state, re-apply mutator, retry
  5. After 5 retries (default maxRetries): return CONCURRENCY_CONFLICT
  6. On success: increment state_version, write atomically
```

### Quota Exhaustion

```
Detection:
  - Model fallback chain (gemini-3-pro-preview -> gemini-2.5-pro ->
    gemini-3-flash-preview -> gemini-2.5-flash) fully exhausted
  - All models return quota/rate-limit errors

Handling:
  1. Set oracle status = "quota_exhausted"
  2. Return DAEMON_QUOTA_EXHAUSTED with list of attempted models
  3. Oracle state preserved on disk (no data loss)
  4. No automatic retries -- wait for quota reset

Auto-revival:
  - On next access (any tool call targeting this oracle):
    - Probe: attempt a minimal API call to check model availability
    - If successful: transition status back to "healthy"
    - Quota state persists in ~/.gemini/quota-state.json with 1-hour TTL
```

### Bootstrap Failure

```
Detection:
  - validateBootstrapAck(text) checks Pythia's response after corpus load
  - Failure indicators: short response containing error/cannot/fail keywords

Handling:
  1. Set status = "error"
  2. Set last_bootstrap_ack = { ok: false, raw: <response>, checked_at: <now> }
  3. Write state to disk before error propagates
  4. Return BOOTSTRAP_FAILED

Recovery:
  - Investigate corpus content (corrupted file? encoding issue?)
  - Fix the issue and retry spawn_oracle
  - If corpus itself is valid: may indicate Gemini model issue, retry later
```

---

## Data Dependencies

### File Map

| File | Location | Created By | Read By | Written By |
|------|----------|------------|---------|------------|
| `registry.json` | `/Users/mikeboscia/pythia/registry.json` | First `spawn_oracle` call | All oracle tools (FEAT-001 through FEAT-013), pressure hook (FEAT-033) | `spawn_oracle` (FEAT-001), `oracle_decommission_execute` (FEAT-012) |
| `manifest.json` | `<project>/oracle/manifest.json` | User (manual creation) | `spawn_oracle` (FEAT-001), `oracle_sync_corpus` (FEAT-002), `oracle_checkpoint` (FEAT-004), `oracle_reconstitute` (FEAT-009) | `oracle_add_to_corpus` (FEAT-006), `oracle_update_entry` (FEAT-007), `oracle_checkpoint` (FEAT-004), `oracle_reconstitute` (FEAT-009) |
| `state.json` | `<project>/oracle/state.json` | `spawn_oracle` (FEAT-001) | All oracle tools, pressure hook (FEAT-033), idle sweep (FEAT-022) | `spawn_oracle` (FEAT-001), `oracle_pressure_check` (FEAT-003), `oracle_checkpoint` (FEAT-004), `oracle_log_learning` (FEAT-005), `oracle_reconstitute` (FEAT-009), `oracle_decommission_execute` (FEAT-012), idle sweep (FEAT-022), all ask_daemon calls |
| `vN-interactions.jsonl` | `<project>/oracle/learnings/` | `spawn_oracle` (FEAT-001) creates empty; `oracle_reconstitute` (FEAT-009) creates new generation | `oracle_quality_report` (FEAT-010), `oracle_salvage` (FEAT-008), cross-daemon sync (FEAT-021), `oracle_checkpoint` (FEAT-004) | `oracle_log_learning` (FEAT-005), `oracle_decommission_request` (FEAT-011), `oracle_decommission_cancel` (FEAT-013) |
| `vN-checkpoint.md` | `<project>/oracle/checkpoints/` | `oracle_checkpoint` (FEAT-004) or `oracle_salvage` (FEAT-008) | `oracle_reconstitute` (FEAT-009) for preamble injection, `spawn_oracle` (FEAT-001) for v2+ | `oracle_checkpoint` (FEAT-004), `oracle_salvage` (FEAT-008) |
| `.pythia-active/<name>.json` | `<project>/.pythia-active/` | `spawn_oracle` (FEAT-001) | Pressure hook (FEAT-033) | `spawn_oracle` (FEAT-001), `oracle_decommission_execute` (FEAT-012) removes |

### Per-Tool Data Requirements

| Tool (FEAT-ID) | Reads | Writes | Requires Lock |
|-----------------|-------|--------|---------------|
| `spawn_oracle` (FEAT-001) | registry.json, manifest.json, all corpus files, existing state.json (if any), prior checkpoint (if v2+) | registry.json, state.json, .pythia-active marker | No (creates fresh state) |
| `oracle_sync_corpus` (FEAT-002) | manifest.json (live_sources), state.json (pool members), source files on disk | state.json (member sync hashes, pending_syncs), manifest.json (last_sync_at, last_tree_hash) | No |
| `oracle_pressure_check` (FEAT-003) | state.json (char counters, pool), manifest.json (checkpoint_headroom_tokens) | state.json (estimates, status) | No |
| `oracle_checkpoint` (FEAT-004) | state.json, manifest.json | checkpoint file, manifest.json (new static_entry), state.json (last_checkpoint_path) | Yes |
| `oracle_log_learning` (FEAT-005) | state.json (version, query_count) | vN-interactions.jsonl, state.json (query_count) | No |
| `oracle_add_to_corpus` (FEAT-006) | manifest.json, target file | manifest.json (new static_entry) | No |
| `oracle_update_entry` (FEAT-007) | manifest.json, target file | manifest.json (updated sha256) | No |
| `oracle_salvage` (FEAT-008) | vN-interactions.jsonl, v(N-1)-checkpoint.md (fallback) | vN-checkpoint.md | No |
| `oracle_reconstitute` (FEAT-009) | state.json, manifest.json, checkpoint, corpus files | state.json (new version, pool), manifest.json (checkpoint entry, version), new interactions file | Yes |
| `oracle_quality_report` (FEAT-010) | vN-interactions.jsonl, manifest.json | None (read-only) | No |
| `oracle_decommission_request` (FEAT-011) | state.json, registry.json | vN-interactions.jsonl (session_note), in-memory token | No |
| `oracle_decommission_execute` (FEAT-012) | state.json, in-memory token | state.json (decommissioned), registry.json (archived), removes .pythia-active marker | Yes |
| `oracle_decommission_cancel` (FEAT-013) | in-memory token | vN-interactions.jsonl (session_note), in-memory token (removed) | No |

### Slash Command to Tool Mapping

| Slash Command | Expands To |
|---------------|------------|
| `/pythia` (no args) (FEAT-025) | `oracle_pressure_check` --> display status |
| `/pythia [query]` (FEAT-025) | `oracle_pressure_check` --> select member --> `ask_daemon` --> `oracle_log_learning` |
| `/pythia sync [source_id]` (FEAT-026) | `oracle_sync_corpus(name, source_id?)` |
| `/pythia checkpoint` (FEAT-027) | `oracle_checkpoint(name)` |
| `/pythia reconstitute` (FEAT-028) | `oracle_reconstitute(name)` |
| `/pythia salvage` (FEAT-029) | `oracle_salvage(name)` |
| `/pythia add <path> [role]` (FEAT-030) | `oracle_add_to_corpus(name, path, role)` |
| `/pythia status` (FEAT-031) | Read manifest + state + registry, display summary |
| `/pythia quality` (FEAT-032) | `oracle_quality_report(name)` |

---

## Appendix: Complete State Transition Table

### Oracle Status Transitions

| From | To | Trigger | Tool/Process |
|------|----|---------|--------------|
| (none) | `healthy` | Fresh spawn completes with valid bootstrap ack | `spawn_oracle` (FEAT-001) |
| `healthy` | `warning` | tokens_remaining drops below headroom | `oracle_pressure_check` (FEAT-003) |
| `healthy` | `degraded` | Pool member dies while others remain healthy | ask_daemon failure detection |
| `healthy` | `error` | Bootstrap fails on force_reload | `spawn_oracle` (FEAT-001) |
| `healthy` | `quota_exhausted` | All Gemini models exhausted | Model fallback chain |
| `warning` | `healthy` | Checkpoint + reconstitute completes | `oracle_reconstitute` (FEAT-009) |
| `warning` | `critical` | tokens_remaining drops below headroom/2 | `oracle_pressure_check` (FEAT-003) |
| `critical` | `healthy` | Reconstitution completes | `oracle_reconstitute` (FEAT-009) |
| `degraded` | `healthy` | Dead member respawned or pool back to full health | spawn-on-demand or explicit respawn |
| `error` | `healthy` | Successful retry of spawn/checkpoint | `spawn_oracle` (FEAT-001) or manual fix |
| `quota_exhausted` | `healthy` | Auto-revival probe succeeds on next access | ask_daemon probe |
| Any (except decommissioned) | `decommissioned` | 7-step protocol completes | `oracle_decommission_execute` (FEAT-012) |

### Pool Member Status Transitions

| From | To | Trigger | Tool/Process |
|------|----|---------|--------------|
| (none) | `idle` | Member spawned and bootstrapped | `spawn_oracle` (FEAT-001), on-demand scaling |
| `idle` | `busy` | Query routed to this member | ask_daemon routing |
| `busy` | `idle` | Query completes successfully | ask_daemon return |
| `busy` | `dead` | Daemon crashes or API error | ask_daemon failure |
| `idle` | `dismissed` | Idle timeout fires | Idle sweep (FEAT-022) |
| `idle` | `dismissed` | Reconstitute dismisses all | `oracle_reconstitute` (FEAT-009) |
| `dismissed` | `idle` | Respawned on demand | spawn-on-demand |
| `dead` | `idle` | Explicit respawn or on-demand | spawn-on-demand |
| Any | (removed) | Hard dismiss during decommission | `oracle_decommission_execute` (FEAT-012) |
