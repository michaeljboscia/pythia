# Pythia Oracle Engine — Research Impact Analysis (Codex)

## Scope Reviewed
- Design spec: `design/pythia-persistent-oracle-design.md` (v6, 46 decisions)
- Implementation plan: `docs/IMPLEMENTATION_PLAN.md`
- Backend structure: `docs/BACKEND_STRUCTURE.md`
- Research set (6 files in `research/`)

---

## 1) Design Validation / Contradiction

### Strongly validated decisions
- **Decision #11 (singleton runtime bridge)**: Validated by MCP shared-state patterns. A single process-level manager for child daemons is the correct shape for stdio MCP servers.
- **Decision #17 (lock TTL) + #18 (optimistic concurrency with retries)**: Strongly validated by concurrent MCP tool dispatch evidence. `await` boundaries create race windows; explicit lock + CAS/retry is required.
- **Decision #36 (per-oracle `.pythia-active` files, atomic writes)**: Validated by atomic-write guidance (temp + rename) for crash safety.
- **Decision #12 + #43 (MCP-side corpus injection + pluggable backend boundary)**: Validated. Deterministic MCP mediation is the right trust boundary.
- **Decision #31 (MAX aggregation for context pressure across pool members)**: Validated; pressure should be driven by the highest-pressure independent context.
- **Decision #33 (full cutover reconstitution)**: Validated as safer than mixed-generation rolling replacement for consistency.
- **Decision #34 (partial pool failure status model)**: Validated in principle; production systems require explicit degraded-state semantics.
- **Decision #41 (pending sync queue drained before query routing)**: Validated; this is necessary to avoid stale-view responses.

### Partially validated but requires refinement
- **Decision #1 (absolute headroom trigger)**: Model is valid, but current thresholding is likely too late for quality-critical reasoning. Research indicates degradation before hard limits; trigger policy should combine absolute headroom with earlier quality/risk signals.
- **Decision #46 (checkpoint extraction pipeline with wrapper scrubbing)**: Better than naive parsing, but insufficient alone. Research supports structured checkpoints + validation loops, not just resilient tag extraction.
- **Decision #25 (single quality signal 1–5)**: Directionally useful, but underspecified versus multi-dimensional scoring seen in production telemetry.

### Contradictions / material tension with research
- **Decision #2 + current FEAT-020 implementation style (char/token heuristic pressure)**: Research shows Gemini offers exact token accounting (`countTokens`, plus `usage_metadata`). Relying primarily on chars/4 as the pressure signal is now technically outdated.
- **Current checkpoint strategy around free-form summarization behavior** (implicit in #16/#46 execution details): Research indicates recursive self-summarization drifts in 3–5 generations without structured extraction/verification and periodic re-grounding.
- **No explicit design decision currently covering parent-death cleanup semantics** for daemon children: research shows SIGKILL-heavy host behavior can orphan PTYs unless PPID watchdog + startup orphan sweep are present.

---

## 2) Implementation Risks Not Fully Addressed

1. **Orphaned subprocess risk under abrupt host kill**
- Claude/host SIGKILL patterns can bypass graceful handlers. Without PPID watchdog and PID-file sweep on startup, daemons can leak.

2. **Silent daemon death / hung-daemon ambiguity**
- `onExit` alone is unreliable in edge cases. Need heartbeat + PID liveness checks + timeout policy to distinguish “slow” from “dead/hung.”

3. **Pressure signal fidelity risk**
- Char-based estimates can misclassify pressure and checkpoint too late; this increases probability of degraded answers before protective checkpointing.

4. **Generational drift risk (confidently wrong phase)**
- Recursive checkpoint chains can remain fluent while losing factual fidelity. No explicit generation budget or forced re-ground cycle in current plan.

5. **Checkpoint poisoning / provenance risk**
- If claims enter checkpoint without source lineage, bad facts can become inherited truth across generations.

6. **Replayability gap in JSONL**
- Current schema is good for audit, weaker for deterministic replay/event-sourced reconstruction (missing monotonic sequence, stronger causality lineage, richer execution provenance).

7. **Tamper-evidence gap**
- No hash-chain fielding in interaction log; difficult to prove append integrity over long horizons.

8. **Schema evolution risk**
- `schema_version` exists at file-level, but per-entry evolution/upcasting approach is not explicit.

9. **Long-run operational scaling risk**
- No explicit rotation/index strategy in plan for interaction logs as they grow (query latency and operational ergonomics degrade over time).

---

## 3) Schema Recommendations (Before Coding)

## InteractionEntry additions (high priority)
- `entry_schema_version` (integer, per-entry)
- `seq` (monotonic integer, oracle-local)
- `session_id` (string)
- `trace_id` (string)
- `span_id` (string)
- `parent_span_id` (string | null)
- `caused_by` (string[] interaction IDs)
- `daemon_id` (string | null)
- `pool_member_session_name` (string | null)
- `model_provider` (string)
- `model_requested` (string)
- `model_actual` (string)
- `prompt_template` (string)
- `prompt_version` (string)
- `temperature` (number | null)
- `top_p` (number | null)
- `usage` object:
  - `prompt_tokens`
  - `completion_tokens`
  - `cached_tokens` (optional)
  - `reasoning_tokens` (optional)
  - `total_tokens`
  - `cost_usd` (optional)
- `latency` object:
  - `started_at`
  - `first_token_ms` (optional)
  - `duration_ms`
- `citations` array:
  - `{ source_id, path, sha256, snippet_hash? }`
- `scores` object (multi-dimensional, sourced):
  - e.g., `confidence`, `factuality`, `usefulness` with `{ value, source }`
- `answer_full_sha256` (string)
- `previous_hash` (string | null)
- `entry_hash` (string)

Notes:
- Keep existing `counsel` as full response text; do not degrade to summary-only storage.
- Preserve existing fields for backward compatibility; extend, don’t break.

## state.json additions (high priority)
- `next_seq` (integer) — authoritative allocator for interaction sequence numbers.
- `last_interaction_hash` (string | null) — tip of append hash chain.
- `token_count_method` (`"exact" | "estimate"`) — current pressure source mode.
- `last_exact_token_check_at` (ISO timestamp | null)
- `last_exact_prompt_tokens` (number | null)
- `quality_checkpoint_threshold_tokens_remaining` (number | null) — optional second trigger distinct from hard safety threshold.
- `generation_since_reground` (integer)
- `last_reground_at_version` (number | null)
- Per `daemon_pool` member additions:
  - `pid` (number | null)
  - `parent_pid_at_spawn` (number | null)
  - `last_heartbeat_at` (ISO | null)
  - `missed_heartbeats` (number)
  - `last_liveness_check_at` (ISO | null)
- `schema_migration_version` (integer) — explicit migrator/upcaster state.

Optional but valuable:
- `checkpoint_format_version` and `checkpoint_validation_status` for structured checkpoint pipeline tracking.

---

## 4) TypeScript / Node Patterns to Adopt

1. **Per-oracle async mutex for shared mutable in-memory state**
- Use `async-mutex` around async read-modify-write sequences that can interleave.

2. **Keep optimistic concurrency for state files, but harden writes**
- Continue `writeStateWithRetry()` CAS.
- Ensure atomic temp+rename; add file+dir fsync for durability under crash scenarios.

3. **PPID watchdog for hostile termination**
- Background `setInterval(...).unref()` to detect parent death and kill child tree proactively.

4. **PID-file crash recovery sweep on startup**
- Record spawned daemon PIDs and parent PID; on startup, kill stale/orphan children before serving tools.

5. **Tree-kill escalation on shutdown paths**
- Graceful SIGTERM/SIGINT first; escalate to SIGKILL after timeout.

6. **Heartbeat + liveness verification**
- Periodic lightweight probe marker plus `process.kill(pid, 0)` checks; declare hung/dead after threshold misses.

7. **Chunked PTY writer with backpressure discipline**
- Keep chunked writes with drain handling; enforce max chunk size and timeout-protected writes.

8. **Bounded execution with `Promise.race` timeouts and AbortController**
- Required for all daemon calls to avoid indefinite busy states.

9. **Append-only event log discipline**
- Never mutate historical entries; corrections are new events linked via `references/caused_by`.

10. **Projection/index sidecar for queryability**
- Keep JSONL as source of truth; build SQLite index/read-model for scalable lookups and reports.

---

## 5) Priority Changes to Implementation Plan (Ordered by Impact)

1. **Add a pre-Phase 2 “Daemon Lifecycle Hardening” step**
- Implement PPID watchdog, startup orphan sweep, PID tracking, heartbeat/liveness, and kill-tree escalation.
- Rationale: prevents resource leaks and false-alive sessions that can destabilize all later phases.

2. **Upgrade FEAT-020 pressure detection to exact-token-first**
- Integrate Gemini exact token counting (`countTokens` / response usage metadata) as primary signal.
- Keep chars/token heuristic as fallback only.
- Add dual-threshold policy: quality trigger (earlier) + hard safety trigger.

3. **Introduce structured checkpoint contract + validation loop**
- Checkpoint output must include mandatory sections (`key_findings`, `quantitative_details`, `open_questions`, `decisions_and_reasoning`, `constraints_and_caveats`, `source_cross_references`).
- Add post-generation validator and regeneration on schema/provenance failure.

4. **Extend InteractionEntry and state schemas before tool coding begins**
- Add `seq`, per-entry schema version, causality/provenance/model usage/latency/hash-chain fields, plus `next_seq` and hash tip in state.
- Rationale: backfilling these after tools ship is painful and error-prone.

5. **Add generation-drift controls in lifecycle phase**
- Introduce `generation_since_reground` budget (e.g., forced re-ground every 3 generations from original corpus + structured facts).
- Add drift checks comparing checkpoint claims to source-backed fact registry.

6. **Add JSONL integrity + replay test harness**
- Validate monotonic sequence, hash-chain continuity, and deterministic state fold from snapshots + events.
- Catch corruption/regression early.

7. **Add log rotation + indexing operational step**
- Define rotation policy (size/time), SQLite side index for fast lookup, and maintenance jobs.
- Keep JSONL append-only as canonical ledger.

8. **Expand quality scoring model**
- Move from single `quality_signal` to multi-metric `scores` with source attribution (human/eval/system).

---

## Bottom Line
The core architecture is strong and mostly aligned with production evidence, especially around concurrency controls, atomic generation transitions, and oracle-scoped state. The biggest pre-implementation upgrades are:
- **Process lifecycle hardening** (watchdog/orphan/heartbeat),
- **Exact token telemetry** replacing heuristic-first pressure logic,
- **Event-sourcing-grade schema fields** for causality, provenance, integrity, and replay,
- **Structured checkpoint validation + periodic re-grounding** to prevent generational drift.

If these are added before code implementation starts, the design moves from “good architecture” to “production-resilient architecture.”
