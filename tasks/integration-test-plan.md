# Integration Test Plan — Pythia Oracle Engine
**Date:** 2026-03-09
**Oracle under test:** `pythia-engine` (live, v1)
**Scope:** All 13 MCP tools, end-to-end live integration (not unit tests)

---

## Status

| # | Tool | Status | Notes |
|---|------|--------|-------|
| 1 | `spawn_oracle` | ✅ PASS | Resumed at zero cost, 6 corpus files, 1.9M tokens |
| 2 | `oracle_pressure_check` | ✅ PASS | healthy, 90% headroom |
| 3 | `oracle_log_learning` | ✅ PASS | v1-q001 written to JSONL |
| 4 | `oracle_sync_corpus` | ⬜ TODO | |
| 5 | `oracle_checkpoint` | ⬜ TODO | |
| 6 | `oracle_quality_report` | ⬜ TODO | needs ≥3 interactions first |
| 7 | `oracle_add_to_corpus` | ⬜ TODO | |
| 8 | `oracle_update_entry` | ⬜ TODO | |
| 9 | `oracle_salvage` | ⬜ TODO | emergency path — safe to test without killing daemon |
| 10 | `oracle_reconstitute` | ⬜ TODO | transitions to v2 — DESTRUCTIVE of v1 state |
| 11 | `oracle_decommission_request` | ⬜ TODO | generates token |
| 12 | `oracle_decommission_cancel` | ⬜ TODO | cancels the token — non-destructive |
| 13 | `oracle_decommission_execute` | ⬜ TODO | FULLY DESTRUCTIVE — test on throwaway oracle, NOT pythia-engine |

---

## Execution Order + What to Verify

### Phase A: Populate (build up interaction data)
Log 2 more interactions so oracle_quality_report has enough data.

**Test 4: oracle_sync_corpus**
- Precondition: oracle alive, corpus file on disk
- Action: modify a corpus file (add a comment to `docs/TECH_STACK.md`), then call `oracle_sync_corpus`
- Verify:
  - [ ] Returns `{ synced: true, delta_chars }` or `SYNC_SKIPPED` if hash unchanged
  - [ ] `last_corpus_sync_hash` updated in state.json
  - [ ] Daemon received the delta

**Test 5: oracle_log_learning × 2**
- Log 2 more consultations (real queries) to build up `v1-interactions.jsonl`
- Verify: entry IDs are `v1-q002`, `v1-q003`

### Phase B: Analysis

**Test 6: oracle_quality_report**
- Precondition: ≥3 entries in `v1-interactions.jsonl`
- Action: call `oracle_quality_report("pythia-engine")`
- Verify:
  - [ ] Returns `QualityReport` with `oracle_name`, `version`, `query_count`
  - [ ] `avg_answer_length_early` and `avg_answer_length_late` populated
  - [ ] `suggested_headroom_tokens` returned
  - [ ] `flags` array present (may be empty if no degradation detected)
  - [ ] No crash even with small sample size

### Phase C: Corpus Management

**Test 7: oracle_add_to_corpus**
- Action: add `/Users/mikeboscia/pythia/LESSONS.md` as a new `reference` corpus entry
- Verify:
  - [ ] Returns success with new entry ID
  - [ ] Entry appears in `manifest.json` `static_entries`
  - [ ] `manifest.json` committed (commit: true default)
  - [ ] Daemon receives the new file content

**Test 8: oracle_update_entry**
- Action: update the `LESSONS.md` entry just added — change role from `reference` to `documentation`
- Verify:
  - [ ] Returns success
  - [ ] Entry updated in `manifest.json`
  - [ ] sha256 recalculated

### Phase D: Checkpoint Lifecycle

**Test 9: oracle_checkpoint**
- Action: call `oracle_checkpoint("pythia-engine")`
- Verify:
  - [ ] Checkpoint file created at `/Users/mikeboscia/pythia/oracle/pythia-engine/checkpoints/v1-checkpoint.md`
  - [ ] `last_checkpoint_path` updated in state.json
  - [ ] Checkpoint is substantive (not empty)
  - [ ] Committed to git (commit: true default)
  - [ ] Lock acquired and released cleanly (lock_held_by → null after)

**Test 10: oracle_salvage**
- Action: call `oracle_salvage("pythia-engine")` while daemon is alive (emergency path, but safe to test)
- Verify:
  - [ ] Produces a checkpoint WITHOUT using the live daemon
  - [ ] Saves to `checkpoints/` (v1-checkpoint.md or incremented if already exists)
  - [ ] Falls back to inheriting prior checkpoint if no interactions — confirm it reads JSONL

### Phase E: Generation Transition

**Test 11: oracle_reconstitute**
- ⚠️ This transitions pythia-engine from v1 → v2
- ⚠️ The v1 daemon is dismissed, v2 is spawned with checkpoint inherited
- Action: call `oracle_reconstitute("pythia-engine")`
- Verify:
  - [ ] `version` incremented to 2 in state.json
  - [ ] New daemon spawned for v2
  - [ ] `v2-interactions.jsonl` file created (empty)
  - [ ] `v2-checkpoint.md` not yet present (created on first v2 checkpoint)
  - [ ] Old v1 corpus sync hashes reset
  - [ ] Bootstrap ack confirmed for v2 daemon
  - [ ] v1 daemon dismissed cleanly

### Phase F: Decommission (non-destructive path)

**Test 12: oracle_decommission_request**
- Action: call `oracle_decommission_request("pythia-engine")`
- Verify:
  - [ ] Returns token (UUID v4)
  - [ ] Returns 7-step checklist
  - [ ] Returns `expires_at` (10 min from now)
  - [ ] Token stored in `GeminiRuntime.decommissionTokens` (in-memory only)

**Test 13: oracle_decommission_cancel**
- Action: immediately call `oracle_decommission_cancel("pythia-engine")`
- Verify:
  - [ ] Returns `{ oracle_name, cancelled_at }`
  - [ ] Token invalidated (in-memory map cleared)
  - [ ] Oracle status unchanged (not "decommissioned")

### Phase G: Full Decommission (DESTRUCTIVE — separate test oracle)

**Test 14: oracle_decommission_execute (on throwaway oracle)**
- Create a throwaway oracle: `throwaway-test`
- Spawn it briefly, log one interaction, checkpoint it
- Run full decommission: request → get TOTP from pythia-auth → execute with phrase
- Verify:
  - [ ] Registry entry archived (status: "decommissioned", `decommissioned_at` timestamp)
  - [ ] Returns `{ oracle_name, decommissioned_at, final_checkpoint_path }`
  - [ ] Daemon pool hard-dismissed
  - [ ] Cannot re-spawn after decommission

---

## Pass Criteria
All 14 tests passing (13 tools + 1 decommission_execute on throwaway).
Zero regressions on existing inter-agent tools (spawn_daemon, ask_daemon, etc.).

## Notes
- oracle_reconstitute (Test 11) is the highest-risk test — it modifies state permanently
- decommission_execute MUST be on a throwaway oracle, never pythia-engine
- oracle_quality_report with 3 entries won't show degradation trends — that's expected, verify it doesn't crash
