# Session Log: mikeboscia/personal/core/tooling/pythia

**Feature:** oracle-engine
**Generated:** 2026-03-05 EST
**Session:** v1 — founding design session

---

## TAXONOMY

| Level | Value |
|-------|-------|
| Owner | mikeboscia |
| Client | personal |
| Domain | core/tooling |
| Repo | pythia |
| Feature | oracle-engine |

---

## OVERALL GOAL

Design and establish the Pythia persistent knowledge oracle system — a generational
daemon architecture that gives projects a living, versioned knowledge base with full
architectural reasoning history. Stands up the `~/pythia/` repo and locks the v4 design spec.

---

## WHAT WAS ACCOMPLISHED THIS SESSION

### 1. Full Design Spec (v1 → v4)
Four design iterations, two twin review passes:

**v1 (starting point):** Basic oracle concept — daemon + manifest + checkpoint
**v2 (post twin review 1):**
- Checkpoint threshold moved to 70%
- `vN-interactions.jsonl` as primary audit trail (not markdown)
- MCP-side char tracking (not `wc -c` on JSON files)
- `oracle_salvage` for dead-letter recovery
- Schema versioning + optimistic concurrency (`state_version`)
- `OracleRuntimeBridge` export needed from `gemini/tools.ts`
- Context Caching API in v1

**v3 (post twin review 2):**
- **Absolute headroom model** replaces percentage thresholds:
  `tokens_remaining < checkpoint_headroom_tokens` (default 250K)
  Scales automatically as Gemini context window grows (2M→5M→10M)
- **Static vs Live corpus split**: `static_entries` (hash-pinned research) + `live_sources` (glob-based code)
- Code is never checkpointed — architectural decisions governing the code are
- `gemini/runtime.ts` singleton extracted (bridge between oracle-tools and gemini session registry)
- `oracle_sync_corpus` tool added
- `discovered_context_window` stored in state.json (dynamic, not hardcoded)

**v4 (Ion + feedback loop):**
- **Ion** = Codex in the Pythia mythology. Ion is the temple servant from Euripides —
  the oracle speaks, Ion does the practical work.
- **Pythia reasons. Ion executes.**
- **Claude is sole orchestrator** — Pythia does NOT call Ion directly. Flow:
  Claude → Pythia (approach?) → Claude → Ion (build this) → Claude → Pythia (sync)
- **Feedback loop**: `InteractionEntry` now has `type` field:
  `"consultation" | "feedback" | "sync_event" | "session_note"`
- Feedback entries close the loop: `implemented`, `outcome`, `divergence`
- Checkpoints inherit outcome data — v(N+1) knows what worked, not just what was recommended
- Ion handoff requires structured envelope: `task_type`, `objective`, `artifacts`,
  `constraints`, `acceptance_criteria`, `decision_boundary`

### 2. The Core Insight Named
**"Version Control for Latent Space"**
- Git tracks what was made (artifacts)
- Pythia tracks why it was made (reasoning, decisions, outcomes)
- `vN-interactions.jsonl` is the enabling primitive: addressable, replayable, forkable
- 2-3 year trajectory: context poisoning immune system, fine-tuning dataset, branchable reasoning

### 3. Engine/Data Architecture Locked
- **Engine**: `~/pythia/` (top-level repo, not under ~/projects/)
- **Data**: each project's `oracle/` directory (committed inside the project repo)
- **Registry**: `~/pythia/registry.json` maps oracle names → project `oracle_dir` paths
- The oracle is **inside** (data, history, artifacts) and **outside** (engine, tooling) the project simultaneously
- No continuous check-in — snapshot gates at: spawn, explicit `/pythia sync`, reconstitution

### 4. Repo Created
- `~/pythia/` initialized, GitHub repo live: `https://github.com/michaeljboscia/pythia`
- First commit: scaffold + design doc v3
- Design doc v4 committed with Ion + feedback loop

---

## KEY DESIGN DECISIONS

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pressure trigger | Absolute headroom (250K tokens) | Scales with growing context windows automatically |
| Corpus tiers | static_entries + live_sources | Code and research have different update cadences |
| Code in checkpoint | Never | Code is Git's job. Checkpoint architectural decisions only |
| Ion orchestration | Claude is sole orchestrator | Pythia→Ion direct call creates black-box chain; Claude translates |
| No continuous check-in | Snapshot gates only | Diffs are context poisoning; coherent wholes > accumulated patches |
| Oracle data location | Inside project repo (oracle/) | Oracle artifacts belong to the project they document |
| Daemon persistence | Keyed by session_name, always soft-dismiss | Oracles are expensive to reconstitute; don't discard them |
| Feedback entries | Curated architectural outcomes only | Per-line feedback would bloat interactions log with noise |

---

## WHAT WORKS (DESIGN CONFIRMED)

- Design doc v4 at `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md`
- Repo at `https://github.com/michaeljboscia/pythia`
- Twin validation: two full review passes with Gemini + Codex
- All 6 original open questions resolved
- Ion mechanics validated by Codex (from its own perspective as Ion)

---

## WHAT DOESN'T EXIST YET (NEXT SESSION)

- `src/oracle-types.ts` — all TypeScript interfaces
- `src/gemini/runtime.ts` — singleton bridge (first code to write)
- `src/oracle-tools.ts` — MCP tool implementations
- `skills/pythia.md` — slash command
- `~/.claude/hooks/post-tool-use.sh` modification — oracle pressure check
- Seed `manifest.json` + `state.json` for narrative-generator-rebuild oracle (43 files)

---

## TRIAD ROLES

| Character | System | Role |
|-----------|--------|------|
| **Pythia** | Gemini | Reasons — holds corpus, answers architectural questions |
| **Ion** | Codex | Executes — code correctness, generation, algorithm specifics |
| **Claude** | Claude | Orchestrates — sole coordinator between Pythia and Ion |

---

## CRITICAL PATHS

| Asset | Path |
|-------|------|
| Pythia repo | `/Users/mikeboscia/pythia/` |
| GitHub | `https://github.com/michaeljboscia/pythia` |
| Design doc | `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` |
| Registry | `/Users/mikeboscia/pythia/registry.json` |
| Inter-agent MCP (dependency) | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/` |
| Gemini tools (to refactor) | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/tools.ts` |

---

## SESSION ACTIVITY LOG

| Time | Action | Outcome |
|------|--------|---------|
| 11:00 | Read inter-agent MCP source (cli-executor, job-store, gemini/tools, model-fallback) | Full orientation to existing infrastructure |
| 11:05 | Read Pythia design doc v1 | Understood starting state |
| 11:10 | Spawned Gemini + Codex twins for first review pass | Both daemons active |
| 11:20 | Twin review 1 received | 12 major design improvements identified |
| 11:25 | Design doc updated to v2 | Checkpoint threshold, JSONL audit trail, MCP char tracking, salvage, schema_version |
| 11:35 | Twin review 2 fired (same daemons) | Absolute headroom model, static/live corpus split, runtime.ts singleton |
| 11:45 | Design doc updated to v3 | Final architecture locked |
| 11:50 | ~/pythia/ repo created, GitHub repo live | `https://github.com/michaeljboscia/pythia` |
| 12:00 | Ion concept developed | Codex = Ion, Pythia reasons, Ion executes |
| 12:10 | Feedback loop designed | consultation/feedback/sync_event/session_note interaction types |
| 12:15 | Design doc updated to v4 | Ion + feedback loop committed |
| 12:20 | Twin review 3 fired (Ion delineation) | Claude as sole orchestrator confirmed; structured Ion handoff envelope required |
| 12:30 | Dismissed both daemons (soft) | Gemini session preserved as pythia-design-review |

---

## NOTES FOR NEXT SESSION

1. **Start with `src/gemini/runtime.ts`** — this is the foundation. Extract `_sessions`
   from `gemini/tools.ts` into a singleton. Export `OracleRuntimeBridge`. Everything else depends on it.
2. **Seed the narrative-generator-rebuild oracle** — 43 research files are already loaded
   in a running Gemini daemon. Capture that as the first real `manifest.json` for a live oracle.
3. **Ion structured handoff envelope** is a design gap still needing formal TypeScript shape —
   add `IonHandoffRequest` and `IonHandoffResponse` interfaces to `oracle-types.ts`
4. **Feedback entries: curated only** — the system must enforce that feedback is logged for
   architectural outcomes, not implementation minutiae. This is a prompt/skill constraint, not a code constraint.
5. **Reality sync hook**: after Ion ships substantive code, `/pythia sync` must fire automatically
   or be explicitly called. This is the critical gap Gemini identified.

---

*"The corpus is the Oracle. The daemon is the vessel. The vessel is replaceable. The corpus is eternal."*
| 12:27 | Staged: mikeboscia--personal_core_tooling_pythia_oracle-engine_20260305_v1_claude.md (+182/-0 (new)) | ✓ | |
| 15:13 | Git commit aeb9ee5: session(claude): oracle-engine v1 — founding design session | COMMITTED | |
| 10:12 | Staged: pythia-persistent-oracle-design.md (+483/-80) | ✓ | |

---

## SESSION UPDATE: 2026-03-06 ~11:30 EST

### Summary
Continued from v4 design. Ran three full rounds of `/ruthless-interrogator` against the design doc, surfacing and resolving 65+ architectural assumptions across three passes. Design advanced from v4 → v5 → v6 (current). Twin review sessions (Gemini `pythia-design-review` + Codex) answered all questions across all three rounds.

### What Was Accomplished

- **Round 1 interrogation (31 questions):** Twins answered all 31. Four divergences resolved: oracle data location → `project/oracle/` (Option A, visible/committed); `max_total_bytes` → `max_sync_bytes` at 5MB default; self-contradiction detection cut to v2; `IonHandoffRequest`/`IonHandoffResponse` interfaces defined.
- **Design doc v5 written:** All 31 answers encoded. New sections: Corpus Load Mechanics, Concurrency & Locking, Git Strategy, Ion Handoff Protocol, IonHandoffRequest/IonHandoffResponse interfaces, full oracle_decommission spec. OracleState expanded with `lock_held_by`, `lock_expires_at`, `last_error`. Resolved Decisions grew from 11 → 27.
- **Round 2 interrogation (21 questions):** Twins answered all 21. Five divergences resolved: internal lock polling (Codex); registry atomic writes + git backup, no .bak (both); tree hash + per-file hashes combined for delta sync (user insight); spawn_oracle parameter matrix with `ORACLE_ALREADY_EXISTS`; Ion interfaces defined as logging contracts.
- **Daemon pool architecture added:** Pool size 2 default (ceiling, not always-on). Spawn on demand, dismiss when done. `DaemonPoolMember` interface with `status`, `chars_in/out`, `last_synced_interaction_id`, `last_corpus_sync_hash`. `daemon_id` → `daemon_pool` array in OracleState. Cross-daemon context sync via delta injection before each query.
- **7-step decommission protocol:** Screenshot proof of review + Touch ID/TOTP (pythia-auth compiled binary) + typed dynamic phrase + 5-min cooling off + second confirmation. `oracle_decommission` split into `oracle_decommission_request` + `oracle_decommission_execute`. TOTP + Master Recovery Key, cross-platform from day one (macOS Keychain = enhancement, not requirement).
- **Round 3 interrogation (17 questions):** Twins answered all 17. Key resolutions: pressure aggregation = MAX not SUM; all members pause during checkpoint; all members reconstitute together (no mixed generations); full cutover reconstitution (drain → lock → checkpoint → spawn all → swap → release); partial failure → `status: "warning"`; `.pythia-active` → directory with per-oracle files; decommission token in-memory only (never git-tracked); `pythia-auth` = compiled binary at `~/.pythia/bin/pythia-auth`.
- **Pool model clarified:** Pool is spawn-on-demand, not always-on. `pool_size` is a ceiling. Idle members dismissed after timeout. Stale member problem eliminated — fresh spawn starts at current checkpoint with zero delta.
- **15 additional items written into doc:** `BOOTSTRAP_FAILED` error, `last_bootstrap_ack`, `MAX_BOOTSTRAP_STDIN_BYTES`, `MAX_INHERITED_WISDOM_INLINE_CHARS`, v1/reconstitution preamble branches, lock heartbeat, `oracle_update_entry()` tool, spawn_oracle parameter matrix, registry atomic writes, two-pass corpus load functions, batch commit triggers, `CONTEXT_WINDOW_BY_MODEL` table, `.pythia-active` JSON content, `computeSuggestedHeadroom()` v1 fallback, `DAEMON_BUSY_QUERY` vs `DAEMON_BUSY_LOCK` split.

### Key Decisions & Why

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pool model | Spawn on demand, pool_size = ceiling | No reason to keep idle daemons alive; fresh spawn always starts with full checkpoint context |
| Pressure aggregation | MAX across pool members | SUM is wrong — 1M tokens in member-0 + 1M in member-1 ≠ 2M context exhaustion for either |
| Checkpoint behavior | All members pause (oracle-wide lock) | Generation is a property of the oracle, not individual daemons — mixed generations forbidden |
| Reconstitution | Drain → shrink to 0 → spawn all v(N+1) | Rolling replacement creates split-brain; full cutover under lock is safe |
| Decommission token | In-memory only | state.json is git-tracked — token in state = token in commit history = security breach |
| .pythia-active | Directory with per-oracle files | Single JSON with array risks concurrent write corruption; per-file = atomic write per oracle |
| TOTP platform | Cross-platform (TOTP + recovery key) | Touch ID = macOS enhancement; core spec must work on Linux/Windows |
| pythia-auth | Compiled binary (Go/Rust) | Shell script is inspectable/spoofable by agent with file write access |
| Sync delta overflow | Spawn-on-demand eliminates it | Fresh member starts at current checkpoint; stale member problem doesn't arise |
| ReconstituteSyncMode | `hash_gated_delta` default | Both tree hash (fast gate) + per-file hashes (precise diff) computed in one pass |

### What Works Now

- Design doc v5/v6 at `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` — implementation-ready
- Three full interrogation passes completed, 65+ assumptions resolved
- Gemini session `pythia-design-review` preserved — resumable for future design questions
- 30 Resolved Design Decisions documented

### What Doesn't Work / Known Issues

- `pythia-auth` binary needs to be built (Go/Rust — not yet written)
- TOTP enrollment flow design is architectural but not yet specced at code level
- `DaemonPoolMember.idle_timeout_ms` and `last_query_at` need to be added to spec (spawn-on-demand model)
- No `decommission_token` in-memory storage spec yet (GeminiRuntime singleton map)
- Round 3 answers not yet written into the design doc (Q1-Q17 architectural decisions from round 3)

### Current State

**Phase:** Design complete — three interrogation passes, all gaps resolved
**Next Step:** Write round 3 answers into design doc, then proceed to implementation starting with `gemini/runtime.ts`

### Sub-agent Work

- **Gemini daemon `gd_mmf3tg4z_5`** (session: `pythia-design-review`, soft-dismissed, preserved): Answered all 17 round 3 questions. Particularly valuable: flagged decommission token security risk (state.json = git-tracked), insisted on cross-platform TOTP, recommended in-memory-only token storage.
- **Codex daemon `cd_mmf3tpmi_5`** (soft-dismissed): Answered all 17 round 3 questions with concrete TypeScript. Added `pending_syncs` array, `last_corpus_sync_hash` per-member field, `decommission_token` nested state object (Gemini's in-memory approach was adopted instead).

### Technical Notes

- Round 3 architectural answers (pool pressure, reconstitution, TOTP, .pythia-active directory) are resolved but NOT YET WRITTEN into the design doc — next session should write these in before running a 4th interrogation pass or starting implementation
- Gemini session `pythia-design-review` is a valuable asset — it has full design context across all 3 review rounds. Resume with `spawn_daemon(session_name: "pythia-design-review")`.
- `pythia-auth` binary location: `~/.pythia/bin/pythia-auth`. Install: `make build-auth` in `~/pythia/`. Checksum verification on install.
- Pool spawn-on-demand: `idle_timeout_ms` field needed on `DaemonPoolMember`, `last_query_at` timestamp needed for idle detection by post-tool-use hook

| [11:30] | Session notes written — design v5/v6, 3 interrogation passes, 65+ assumptions resolved | ✓ |

---

## SESSION UPDATE: 2026-03-06 ~12:30 EST

### Summary
Wrote all Round 3 resolved answers into the design doc, advancing it from v5 to v6. Ten distinct edits covering spawn-on-demand pool model, pressure aggregation (MAX not SUM), reconstitution (full cutover), `.pythia-active` directory, in-memory decommission token, cross-platform TOTP, DaemonPoolMember extended fields, and 9 new resolved design decisions (#31-#39).

### What Was Accomplished
- **Design doc v6 written:** `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` (1361 → 1453 lines, +92)
- **Daemon Architecture section rewritten:** "Spawn-on-Demand Pool" — pool_size is ceiling, not always-on. Added Pool Pressure Aggregation and Partial Pool Failure subsections.
- **DaemonPoolMember interface extended:** `last_query_at`, `idle_timeout_ms`, `last_corpus_sync_hash`, `pending_syncs` array, `status` now includes `"dead"`
- **OracleState updated:** `estimated_cluster_tokens` (SUM, observability) alongside `estimated_total_tokens` (MAX, drives checkpoint)
- **Pressure tracking code updated:** MAX formula explicit, per-member tracking, `last_query_at` update
- **state.json example updated:** Single active member (spawn-on-demand), new fields shown
- **`.pythia-active` → directory:** Per-oracle JSON files, prevents concurrent write corruption
- **Decommission token → in-memory only:** GeminiRuntime singleton, never state.json
- **TOTP → cross-platform:** Core spec is TOTP + Master Recovery Key. Touch ID = macOS enhancement only.
- **Reconstitution → full cutover:** Drain → shrink to 0 → checkpoint → spawn fresh v(N+1). No mixed generations.
- **`tree_hash_incremental` → `hash_gated_delta`:** All references renamed throughout doc
- **Resolved Design Decisions:** 30 → 39 entries

### Key Decisions & Why
- All decisions were already resolved in Round 3 — this session was about writing them into the doc, not making new ones.

### What Works Now
- Design doc v6 at `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` — 39 resolved decisions, all 3 interrogation rounds encoded
- All Round 3 answers now written into the doc (was the #1 flagged gap from last session)

### What Doesn't Work / Known Issues
- No code implemented yet — design only
- `pythia-auth` binary not built
- Round 4 interrogation not yet run (optional)

### Current State
**Phase:** Design v6 complete — all interrogation answers written in
**Next Step:** Either run a 4th /ruthless-interrogator pass or proceed to implementation starting with `gemini/runtime.ts`

| [12:30] | Round 3 answers written into design doc — v5 → v6, 10 edits, +92 lines, 39 resolved decisions | ✓ |

---

## SESSION UPDATE: 2026-03-07 ~00:15 EST

### Summary
Resumed Gemini (`pythia-design-review` session) and Codex twins for a full review of the v6 design doc. Twins returned 12 findings (2 convergent, 2 Gemini-only, 8 Codex-only). Fixed 7 straightforward naming/consistency issues without user input, then walked through 6 design decisions one at a time with the user. All 12 findings resolved. Doc now at 1500 lines, 42 resolved design decisions.

### What Was Accomplished

- **Twin review of v6 doc:** Gemini daemon `gd_mmf3tg4z_5` (session: `pythia-design-review`, resumed) + Codex daemon `cd_mmff48pw_6` reviewed full 1453-line doc
- **12 findings identified:**
  - 2 convergent: `pending_syncs` flush behavior undefined, idle timeout enforcement undefined
  - 2 Gemini-only: pool scaling trigger undefined, `"warning"` status overloaded
  - 8 Codex-only: cutover sequence contradiction, `Math.max(...[])` empty pool bug, "spawn all" vs "spawn 1" contradiction, stale `DAEMON_BUSY` references, `oracle_decommission_cancel` missing, hook references `dead` as OracleStatus, state example stale, `daemon_id` should be nullable
- **7 fixes applied without user input:**
  - X3: "Spawn all" → "Spawn one, others on demand"
  - X4: `DAEMON_BUSY` → `DAEMON_BUSY_QUERY`/`DAEMON_BUSY_LOCK` (3 locations)
  - X5: `oracle_decommission_cancel` tool contract defined
  - X6: Hook no longer references `dead` as OracleStatus
  - X7: `ORACLE_CORPUS_CAP_EXCEEDED` → `CORPUS_CAP_EXCEEDED`, `chars_in_total` → member-level, `estimated_cluster_tokens` added to state example
  - X8: `daemon_id: string | null`, added `"dismissed"` to member status
  - Plus: all `tree_hash_incremental` references → `hash_gated_delta`
- **6 design decisions resolved with user:**
  - X1: Cutover order = drain → checkpoint (daemons alive) → dismiss → spawn (Option A)
  - X2: Empty pool = null pressure, `PRESSURE_UNAVAILABLE` (Option A)
  - G1: Pool scaling = async background spawn, returns `DAEMON_BUSY_QUERY` with `scaling_up: true` (Option C — visible plumbing)
  - G2: Added `"degraded"` to OracleStatus for pool failure, `"warning"` reserved for context pressure (Option A)
  - C1: Corpus sync = inject immediately to idle members, queue for busy, drain before query (Option A)
  - C2: Idle timeout = `setInterval` sweep every 60s on GeminiRuntime singleton (Option B)
- **Design doc updated:** `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` — 1453 → 1500 lines, 39 → 42 resolved decisions

### Key Decisions & Why

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cutover order | Checkpoint before dismiss | Daemons alive = full context = maximal checkpoint quality |
| Empty pool pressure | null / PRESSURE_UNAVAILABLE | Honest reporting — no daemon = no pressure to measure |
| Pool scaling trigger | Async spawn + DAEMON_BUSY_QUERY | User wants visible plumbing, not silent magic |
| Pool failure status | `"degraded"` (new) | `"warning"` reserved for context pressure — prevents misdiagnosis |
| Corpus sync dispatch | Idle=inject now, busy=queue | Idle daemon gets fresh code immediately, not on next question |
| Idle timeout enforcement | setInterval sweep on singleton | Real timers, real cleanup — not lazy evaluation that lies about timeouts |

### What Works Now
- Design doc v6 at `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` — 42 resolved decisions, all twin findings addressed
- Gemini session `pythia-design-review` preserved with full context across 4 review passes

### What Doesn't Work / Known Issues
- No code implemented yet — design only
- `pythia-auth` binary not built
- Could run another /ruthless-interrogator pass but diminishing returns likely

### Current State
**Phase:** Design v6 finalized — twin review pass complete, all findings resolved
**Next Step:** User deciding between another /ruthless-interrogator pass or starting implementation (`gemini/runtime.ts`)

### Sub-agent Work
- **Gemini daemon `gd_mmf3tg4z_5`** (session: `pythia-design-review`, resumed): 4 findings — pool scaling trigger, `"warning"` overload, `pending_syncs` gap, idle timeout enforcement. Recommended `setInterval` cleanup loop and `"degraded"` status.
- **Codex daemon `cd_mmff48pw_6`** (thread `019cc517-c360-7bc2-8e92-10ec0802f13d`): 9 findings — cutover contradiction, empty pool math bug, naming inconsistencies (3), missing tool contract, type/prose mismatches (2), lifecycle edge cases. Particularly valuable: caught `Math.max(...[])` = `-Infinity` bug.

### Technical Notes
- Gemini session `pythia-design-review` now has context across 4 review passes (3 interrogation rounds + this consistency review). Resume with `spawn_daemon(session_name: "pythia-design-review")`.
- New `DaemonPoolMember.status` values: `"idle" | "busy" | "dead" | "dismissed"`. `daemon_id` is now `string | null` (null when dismissed).
- `OracleStatus` now includes `"degraded"` between `"healthy"` and `"warning"`.
- `oracle_decommission_cancel` tool contract added — invalidates in-memory token, logs session_note.
- `GeminiRuntime` singleton now owns: `decommissionTokens` map (in-memory), `idleSweepInterval` (60s setInterval).

| [00:15] | Twin review complete — 12 findings, all resolved, doc at 1500 lines, 42 decisions | ✓ |

---

## SESSION UPDATE: 2026-03-07 ~01:00 EST

### Summary
Read and absorbed the Living Corpus System Design doc (`/Users/mikeboscia/My Drive/living-corpus-system-design.md`) — a 730-line knowledge graph + vector index + tiered retrieval architecture for unlimited-scale application memory. Had both twins (Gemini + Codex) read it alongside the Pythia v6 design, then asked the strategic question: combine, separate, or something else? Both twins independently converged on the same answer: they are complementary layers of one platform, separated by time.

### What Was Accomplished
- **Read Living Corpus System Design:** Full 730-line doc covering LLM context fundamentals, 5M token ingestion architecture, lost-in-the-middle mitigations, tiered retrieval (hot/warm/cold), knowledge graph + vector index, artifact taxonomy, MCP tool design, multi-hop reasoning, and a 10-topic research agenda with sequencing
- **Both twins read and absorbed both docs:** Gemini (`pythia-design-review` session) and Codex (`cd_mmff48pw_6`) now hold Pythia v6 + Living Corpus in context simultaneously
- **Strategic relationship resolved:** Pythia = cognition/orchestration layer (daemon lifecycle, sessions, pressure, checkpoints). Living Corpus = data/retrieval layer (graph, vector index, multi-hop, scale). They stack — Pythia sits on top of Living Corpus.
- **Build order locked:** Pythia first (weeks), Living Corpus second (months), integration third (Pythia's corpus backend becomes pluggable)
- **Key insight from Gemini:** Pythia is the ingest engine for Living Corpus — every `vN-interactions.jsonl` entry is a perfectly structured ADR node for the future knowledge graph. Using Pythia generates the seed data for LCS.

### Key Decisions & Why

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Combine or separate? | Separate builds, defined interface | Coupling two hard problems slows both; pluggable backend lets them integrate later |
| Build order | Pythia first | Immediate value, lighter infrastructure, generates structured data for LCS |
| Relationship | Complementary layers, not competing | Pythia = cognition (sessions, generations), LCS = memory (index, graph, retrieval) |
| Integration point | Corpus backend becomes pluggable | Today: read manifest files from disk. Tomorrow: `retrieve_context()` against LCS |

### What Works Now
- Both twins have full context on both systems — can be queried about either or both
- Strategic direction locked: Pythia → Living Corpus → Integration
- Design doc v6 at `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` still current (42 resolved decisions)

### What Doesn't Work / Known Issues
- Living Corpus has no concrete spec yet — the doc is a design conversation capture, not an implementation-ready brief like Pythia v6
- Living Corpus requires significant research phase before building (10-topic research agenda in the doc)
- Pluggable corpus backend note not yet added to Pythia design doc
- No code implemented for either system yet

### Current State
**Phase:** Strategic direction resolved — two-system architecture confirmed
**Next Step:** Add pluggable backend note to Pythia design doc, then start implementation with `gemini/runtime.ts`

### Sub-agent Work
- **Gemini daemon `gd_mmf3tg4z_5`** (session: `pythia-design-review`): Read Living Corpus doc, provided strategic assessment. Key contribution: identified Pythia as the "ingest engine" for LCS — interaction logs become knowledge graph seed data. Recommended build Pythia now, let LCS subsume it at month 6+.
- **Codex daemon `cd_mmff48pw_6`** (thread `019cc517-c360-7bc2-8e92-10ec0802f13d`): Read both docs, provided strategic assessment. Key contribution: framed as "data/retrieval plane" vs "cognition/orchestration plane." Recommended defined interface from day one (`retrieve_context(query, constraints) -> artifacts`).

### Technical Notes
- Living Corpus doc lives at `/Users/mikeboscia/My Drive/living-corpus-system-design.md` — created in Claude.ai, handed off for Claude Code
- The doc contains 10 open questions (Appendix B) that need resolution during LCS design phase
- LCS research agenda has explicit sequencing: GraphRAG paper → LSP/tree-sitter → MTEB/ColBERT → MCP spec → RAGAS evaluation → everything else
- Both twins still active and holding both docs in context — dismiss after this session or keep for implementation kickoff

| [01:00] | Living Corpus strategic assessment — Pythia + LCS = complementary layers, build Pythia first | ✓ |
| [01:30] | Pluggable backend note added to design doc (decision #43), committed + pushed (f3d6bbe) | ✓ |
| [01:45] | /uncompromising-executor invoked — 9 docs needed (skip DESIGN_SYSTEM + FRONTEND_GUIDELINES), Option A layout chosen | ✓ |

---

## SESSION UPDATE: 2026-03-07 ~01:45 EST

### Summary
Added pluggable corpus backend note to design doc (decision #43). Committed and pushed. Read Living Corpus System Design doc, had twins assess relationship — Pythia and LCS are complementary layers (cognition vs memory), build Pythia first. Invoked /uncompromising-executor to set up canonical doc suite before implementation. Context running low — documenting next steps for fresh session.

### What Was Accomplished
- Pluggable backend note added to design doc, committed as `f3d6bbe`, pushed to GitHub
- Living Corpus strategic relationship resolved with twin consensus
- /uncompromising-executor skill invoked with design doc as input
- Adapted 11-doc template to 9 docs (skip DESIGN_SYSTEM + FRONTEND_GUIDELINES — no UI)
- File layout chosen: Option A (execution files at root, canonical specs in `docs/`)

### Current State
**Phase:** Pre-implementation — canonical doc suite generation
**Next Step:** Generate 9 /uncompromising-executor docs using sub-agents to preserve context

### IMMEDIATE NEXT SESSION TODO

1. **Create directories:** `mkdir -p /Users/mikeboscia/pythia/docs /Users/mikeboscia/pythia/tasks`
2. **Generate 9 docs** (use sub-agents for heavy ones):
   - `docs/PRD.md` — Features as MCP tools + slash commands with FEAT-IDs
   - `docs/APP_FLOW.md` — Daemon lifecycle, tool call sequences, not screens
   - `docs/TECH_STACK.md` — Exact versions, dependencies
   - `docs/BACKEND_STRUCTURE.md` — JSON schemas, MCP tool contracts
   - `docs/IMPLEMENTATION_PLAN.md` — Phased build plan from design doc
   - `CLAUDE.md` — Project-level execution rules (at repo root)
   - `progress.txt` — Current state tracker (at repo root)
   - `LESSONS.md` — Empty starter (at repo root)
   - `tasks/todo.md` — First session work plan
3. All docs cross-reference each other by exact IDs
4. Source of truth: `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` (v6, 1516 lines, 43 decisions)
5. After docs generated: begin implementation with `gemini/runtime.ts`

### Daemons Still Active
- **Gemini `gd_mmf3tg4z_5`** (session: `pythia-design-review`) — has full context on Pythia + Living Corpus
- **Codex `cd_mmff48pw_6`** (thread `019cc517-c360-7bc2-8e92-10ec0802f13d`) — has full context on both docs
- Both can be used for doc generation in next session

| [01:45] | Session closing — context low, next session generates 9 canonical docs via sub-agents | ✓ |
