# Sprint 7 — Session Todo
**Date:** 2026-03-12
**Sprint:** 7 (Hardening)
**Spec:** `/Users/mikeboscia/pythia/design/sprint-7-spec.md`
**Plan:** `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-sprint7.md`

---

## Documentation (DONE ✓)
- [x] Sprint 7 spec written: `/Users/mikeboscia/pythia/design/sprint-7-spec.md`
- [x] `IMPLEMENTATION_PLAN-sprint7.md` generated
- [x] `PRD-v2.md` updated (FEAT-000, FEAT-024 Phase 2, FEAT-032 through FEAT-036)
- [x] `BACKEND_STRUCTURE-v2.md` error registry updated (HASH_MISMATCH_BATCH -32042, MISSING_REQUIRED_FILE -32043)
- [x] `progress.txt` updated (Sprint 7 status, Sprint 6 on hold, session history)

---

## Step 7.1 — SQL Structural Extraction (FEAT-024 Phase 2)
**Codebase:** `/Users/mikeboscia/pythia/`
- [x] Modify `src/indexer/chunker-treesitter.ts`:
  - [x] Add `extractSqlChunks()` targeting named routine statements
  - [x] Emit `chunk_type: "function"` with CNI `<path>::function::<qualified_name>`
  - [x] Always emit `chunk_type: "module"` for full file
  - [x] ERROR node → skip routine, keep module only (silent)
  - [x] Anonymous blocks → module chunk only, never function chunks
  - [x] Register in language dispatch table for `.sql` files
- [x] Create `src/__tests__/chunker-sql.test.ts` with 7+ test cases
- [x] `npm test` — all new SQL tests pass

## Step 7.2 — CSN Benchmark Wiring (FEAT-036)
**Codebase:** `/Users/mikeboscia/pythia/`
- [x] `package.json`: add `"benchmark": "node scripts/csn-benchmark.mjs"`
- [x] `src/config.ts`: add `embedding_batch_size: 32` + `embedding_concurrency: 1` to Zod schema
- [x] `scripts/csn-benchmark.mjs`: add `--baseline` flag logic
  - [x] `computeBaselineDiff()` from runner.ts to compute diff
  - [x] `baselineEligible()` gate — exit code 1 on degraded run
  - [x] `writeBaselineFile()` to save baseline
  - [x] Diff rows in terminal summary box
- [x] Create `benchmarks/baselines/.gitkeep`
- [x] Verify `npm run benchmark -- --samples 50` completes
- [x] Verify `npm run benchmark -- --samples 50 --baseline` saves baseline file
- [x] Verify follow-up benchmark run prints zero diff rows against the saved baseline

## Step 7.3 — Spawn Audit Log & Fail-All Validation (FEAT-032 + FEAT-033)
**Codebase:** `~/.claude/mcp-servers/inter-agent/`
- [x] `oracle-tools.ts`: replace fail-fast hash check with accumulating loop
  - [x] Collect all stale files before throwing
  - [x] Throw `HASH_MISMATCH_BATCH` (-32042) with full `stale_files` array
  - [x] Add `auto_refresh?: boolean` to `spawn_oracle` input schema
  - [x] `auto_refresh: true`: re-hash stale, remove non-required missing, atomic write, continue
  - [x] `auto_refresh: true` + deleted `required: true` file → `MISSING_REQUIRED_FILE` (-32043)
- [x] `oracle-tools.ts`: add audit log appender
  - [x] Create `~/.pythia/logs/` if not exists
  - [x] Append JSONL entry after every spawn attempt (success + error)
- [x] `oracle-tools.ts`: update `state.json` writes to schema_version 2 + `last_spawn_at`
- [x] Write spawn tests: batch error payload, auto_refresh variants, audit log persistence

## Step 7.4 — Oracle Core Tools (FEAT-000 + FEAT-034 + FEAT-035)
**Codebase:** `~/.claude/mcp-servers/inter-agent/`
- [x] `oracle-tools.ts`: implement `oracle_init` handler
  - [x] `ORACLE_ALREADY_EXISTS` guard (no files modified)
  - [x] Glob auto-discovery (3-level depth cap, README first, smallest-first sort)
  - [x] Corpus cap (1.5M chars, skipped_files[] + corpus_truncated: true)
  - [x] Write manifest.json (schema_version 2) + state.json (schema_version 2)
  - [x] Register in registry.json with description field
  - [x] Create `~/.pythia/logs/`
- [x] `oracle-tools.ts`: implement `oracle_health` handler (strictly read-only — zero mutations)
- [x] `oracle-tools.ts`: implement `oracle_refresh` handler (atomic manifest write via atomicWriteFile)
- [x] `server.ts` registration path updated through `registerOracleTools`
- [x] Create `src/test-oracle-init.mjs` with 4 targeted cases
- [x] Create `src/test-oracle-health.mjs` with 3 targeted cases
- [x] Create `src/test-oracle-refresh.mjs` with 8 targeted cases
- [x] All 3 test suites pass

---

## Sprint 7 Completion Gate
- [x] `npm test` passes in `/Users/mikeboscia/pythia/` (255/255, includes SQL tests)
- [x] `npm run benchmark -- --samples 50` completes
- [x] All 3 oracle test suites pass
- [x] 3 new oracle tools visible via MCP registration path
- [x] `oracle-spawn-audit.jsonl` appends correctly on success + failure
- [x] `oracle_init` creates oracle with zero manual steps
- [x] Bump `package.json` version `1.2.0` → `1.3.0`
- [ ] Git commit Sprint 7

---

## Completion Snapshot
- [x] Pythia verification complete
- [x] Inter-agent verification complete
- [x] CSN baseline created at `benchmarks/baselines/javascript.json`
- [x] Baseline diff path exercised successfully
