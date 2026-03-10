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
| 3 | `oracle_log_learning` | ✅ PASS | v1-q001, v1-q002, v1-q003 written; seq counter correct |
| 4 | `oracle_sync_corpus` | ✅ PASS | Round 2: 2 files synced, 1 member synced immediately, tree_hash updated (BUG-1 fixed) |
| 5 | `oracle_checkpoint` | ✅ PASS | Round 2: v2-checkpoint.md created (10.6KB), lock acquired/released cleanly (BUG-2 fixed) |
| 6 | `oracle_quality_report` | ✅ PASS | All QualityReport fields returned; no crash with small sample |
| 7 | `oracle_add_to_corpus` | ✅ PASS | LESSONS.md added, sha256 computed, manifest updated |
| 8 | `oracle_update_entry` | ✅ PASS | Stale-update guard validated; role+sha256 updated correctly |
| 9 | `oracle_salvage` | ✅ PASS | 3 entries processed, checkpoint written without daemon |
| 10 | `oracle_reconstitute` | ✅ PASS | Round 2: v2→v3 with checkpoint_first:true (default), no workaround needed (BUG-3+4 fixed) |
| 11 | `oracle_decommission_request` | ✅ PASS | Token+checklist returned; 10-min TTL; in-memory only |
| 12 | `oracle_decommission_cancel` | ✅ PASS | Token invalidated; oracle status unchanged |
| 13 | `oracle_decommission_execute` | ⬜ DEFERRED | Requires throwaway oracle — deferred to next session |

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

---

## Bugs Found During Testing (2026-03-10)

### BUG-1: oracle_sync_corpus — Premature Manifest Hash Update
**Tool:** `oracle_sync_corpus`
**Symptom:** When all pool members are dismissed/dead, sync correctly detects file changes but writes new `last_tree_hash` to manifest even though no daemon received the delta. On the next call (after respawn), `isChanged=false` → files skipped → daemon never gets the updated corpus.
**Root cause:** `writeManifest(last_tree_hash=newHash)` at end of sync loop runs unconditionally — not gated on `membersSyncedImmediately > 0 || membersQueued > 0`.
**Fix applied:** Added `sourceSyncedImmediately` / `sourceQueued` counters per loop iteration. Skip `writeManifest` and `writeStateWithRetry` when both are zero. Fix in `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` — needs session restart to take effect.
**Status:** ✅ FIXED — Verified in Round 2 (2026-03-10). Commit 5968029.

### BUG-2: spawn_oracle Resume — last_query_at Not Reset
**Tool:** `spawn_oracle` (resume path)
**Symptom:** After every `spawn_oracle` that resumes an existing session, the daemon is dismissed by the idle sweep within 0-60 seconds. Any subsequent tool call that needs an active daemon (checkpoint, sync injection, quality query) gets DAEMON_NOT_FOUND.
**Root cause:** `spawn_oracle` resume path does not update `last_query_at` in state.json for resumed pool members. The idle sweep sees the original `last_query_at` (which may be 20-30 min old) and dismisses on the next tick.
**Fix applied:** In `spawn_oracle` resume branch, `writeStateWithRetry` sets `last_query_at = new Date().toISOString()` for all non-dismissed/dead pool members.
**Status:** ✅ FIXED — Verified in Round 2 (2026-03-10). Daemon survived spawn → pressure_check → checkpoint (3+ min). Commit 5968029.

### BUG-3: oracle_reconstitute — Stale In-Memory Manifest After checkpoint_first
**Tool:** `oracle_reconstitute`
**Symptom:** With `checkpoint_first: true` (default), reconstitute internally calls checkpoint → falls back to salvage → salvage rewrites `v1-checkpoint.md` with new content (new sha256) → salvage updates manifest on disk — but reconstitute continues with the in-memory manifest copy loaded at function start. Corpus hash validation compares in-memory manifest sha256 against on-disk file → HASH_MISMATCH.
**Root cause:** `oracle_reconstitute` reads manifest once at entry, then never re-reads after `checkpoint_first` completes. Salvage updates manifest.json on disk but the caller has a stale reference.
**Fix applied:** After `checkpoint_first` completes, manifest is re-read from disk via `readManifest(oracleDir)` before creating `updatedManifest`.
**Status:** ✅ FIXED — Verified in Round 2 (2026-03-10). v2→v3 reconstitute with checkpoint_first:true succeeded cleanly. Commit 5968029.

### BUG-4: oracle_salvage — sha256 Stored in Manifest Doesn't Match On-Disk File
**Tool:** `oracle_salvage`
**Symptom:** After direct `oracle_salvage` call, the checkpoint file is written but the sha256 stored in the manifest entry doesn't match `shasum -a 256` of the file on disk.
**Root cause:** sha256 was computed from the in-memory content string before `atomicWriteFile`, not from the post-write on-disk file. Encoding/newline normalization during atomic write caused mismatch.
**Fix applied:** After `atomicWriteFile` completes, file is read back from disk and sha256 is computed from the on-disk bytes.
**Status:** ✅ FIXED — Verified in Round 2 (2026-03-10). Reconstitute's internal checkpoint produced matching sha256. Commit 5968029.
