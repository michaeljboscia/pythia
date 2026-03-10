# LESSONS.md — Pythia Oracle Engine

> **Purpose:** Every correction, every bug, every mistake gets logged here with a prevention rule.
> Reviewed at the start of every session so errors don't repeat.

---

## Format

```
## YYYY-MM-DD — Short Title
What happened: [incident, 1-2 sentences]
Lesson: [actionable takeaway, 1-2 sentences]
Scope: project
```

---

## Design Phase Lessons

## 2026-03-06 — Design Doc Contradictions Survive Multiple Passes
What happened: After 3 interrogation rounds and a twin review, 12 contradictions were still found in the design doc (stale error codes, missing tool contracts, overloaded status values).
Lesson: Every time the design doc is revised, run a full consistency sweep: error codes match their definitions, tool contracts exist for every referenced tool, status values are used consistently. Contradictions compound — catching them early is cheaper than catching them in code.
Scope: project

## 2026-03-06 — Empty Pool Breaks Math.max
What happened: `Math.max(...[])` returns `-Infinity` in JavaScript. After spawn-on-demand idle dismiss, an empty pool would produce nonsense pressure values.
Lesson: Any aggregation over pool members must guard for the empty-pool case. All pressure fields must be `null` when no active members exist, and the tool must return `PRESSURE_UNAVAILABLE`.
Scope: project

## 2026-03-10 — oracle_sync_corpus Updates Manifest Hash Even When No Daemon Receives Delta
What happened: During integration testing, `oracle_sync_corpus` was called when the pool was all-dismissed (idle sweep had fired). The tool correctly detected the file change, built the delta payload, but found 0 active members. Despite zero delivery, `writeManifest` updated `last_tree_hash` to the new value. On the next call (after respawn), `isChanged = false` → both files skipped → the daemon NEVER received the updated corpus content.
Lesson: Only update `manifest.live_sources[id].last_tree_hash` (and `last_file_hashes`) after at least one pool member was synced or queued (`sourceSyncedImmediately > 0 || sourceQueued > 0`). If all members are dismissed/dead, skip the manifest write entirely so the next call re-detects the change. Fix applied in oracle-tools.ts — gate manifest write on per-source delivery count.
Scope: project

## 2026-03-10 — oracle_reconstitute Stale Manifest After checkpoint_first
What happened: oracle_reconstitute(checkpoint_first: true) internally runs salvage when no daemon is available. Salvage rewrites v1-checkpoint.md with fresh Gemini output (new sha256) and updates manifest.json on disk. But reconstitute holds a stale in-memory manifest from function entry and uses it for corpus hash validation — mismatching the just-written file every time.
Lesson: After any sub-operation that writes to the manifest (checkpoint, salvage, update_entry), callers must re-read the manifest from disk before any hash validation step. Never trust an in-memory manifest copy after a write that could have changed it. Fix: re-read manifest after checkpoint_first completes in oracle_reconstitute.
Scope: project

## 2026-03-10 — oracle_salvage Stores Wrong sha256 in Manifest Entry
What happened: After calling oracle_salvage, the sha256 stored in the manifest for v1-checkpoint.md did not match the actual sha256 of the file on disk. oracle_reconstitute and resolveCorpusForSpawn then rejected the corpus entry with HASH_MISMATCH.
Lesson: In oracle_salvage, sha256 for the manifest entry must be computed from the on-disk file AFTER atomicWriteFile completes — not from the content string in memory (encoding, newlines, or BOM differences could cause a mismatch). Verify by reading back the file post-write and hashing that.
Scope: project

## 2026-03-10 — spawn_oracle on Resume Does Not Reset last_query_at — Idle Sweep Fires Immediately
What happened: During integration testing, every `spawn_oracle` (resume path, `corpus_files_loaded: 0`) was followed immediately by `DAEMON_NOT_FOUND` on the next oracle tool call. Root cause: `last_query_at` on the pool member was not updated to `now()` when resuming. The idle sweep (60s interval, 300s timeout) saw `last_query_at` as 20-30 minutes old and dismissed the daemon on the next tick (0-60s after spawn). The caller had no chance to use the daemon.
Lesson: `spawn_oracle` on the resume path MUST write `last_query_at = new Date().toISOString()` into state.json for all resumed pool members. This gives the caller a fresh 5-minute idle window after every resume, identical to what a fresh spawn provides.
Scope: project
