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
- [ ] Modify `src/indexer/chunker-treesitter.ts`:
  - [ ] Add `extractSqlChunks()` targeting `create_function_statement`, `create_procedure_statement`, `create_trigger_statement`
  - [ ] Emit `chunk_type: "function"` with CNI `<path>::function::<qualified_name>`
  - [ ] Always emit `chunk_type: "module"` for full file
  - [ ] ERROR node → skip routine, keep module only (silent)
  - [ ] Anonymous blocks → module chunk only, never function chunks
  - [ ] Register in language dispatch table for `.sql` files
- [ ] Create `src/__tests__/chunker-sql.test.ts` with 7 test cases
- [ ] `npm test` — all new SQL tests pass

## Step 7.2 — CSN Benchmark Wiring (FEAT-036)
**Codebase:** `/Users/mikeboscia/pythia/`
- [ ] `package.json`: add `"benchmark": "node scripts/csn-benchmark.mjs"`
- [ ] `src/config.ts`: add `embedding_batch_size: 32` + `embedding_concurrency: 1` to Zod schema
- [ ] `scripts/csn-benchmark.mjs`: add `--baseline` flag logic
  - [ ] `computeBaselineDiff()` from runner.ts to compute diff
  - [ ] `baselineEligible()` gate — exit code 1 on degraded run
  - [ ] `writeBaselineFile()` to save baseline
  - [ ] Diff rows in terminal summary box
- [ ] Create `benchmarks/baselines/.gitkeep`
- [ ] Verify `npm run benchmark -- --samples 50` completes
- [ ] Verify `npm run benchmark -- --samples 50 --baseline` saves baseline file

## Step 7.3 — Spawn Audit Log & Fail-All Validation (FEAT-032 + FEAT-033)
**Codebase:** `~/.claude/mcp-servers/inter-agent/`
- [ ] `oracle-tools.ts`: replace fail-fast hash check with accumulating loop
  - [ ] Collect all stale files before throwing
  - [ ] Throw `HASH_MISMATCH_BATCH` (-32042) with full `stale_files` array
  - [ ] Add `auto_refresh?: boolean` to `spawn_oracle` input schema
  - [ ] `auto_refresh: true`: re-hash stale, remove non-required missing, atomic write, continue
  - [ ] `auto_refresh: true` + deleted `required: true` file → `MISSING_REQUIRED_FILE` (-32043)
- [ ] `oracle-tools.ts`: add audit log appender
  - [ ] Create `~/.pythia/logs/` if not exists
  - [ ] Append JSONL entry after every spawn attempt (success + error)
- [ ] `oracle-tools.ts`: update `state.json` writes to schema_version 2 + `last_spawn_at`
- [ ] Write spawn tests: batch error payload, auto_refresh variants, audit log persistence

## Step 7.4 — Oracle Core Tools (FEAT-000 + FEAT-034 + FEAT-035)
**Codebase:** `~/.claude/mcp-servers/inter-agent/`
- [ ] `oracle-tools.ts`: implement `oracle_init` handler
  - [ ] `ORACLE_ALREADY_EXISTS` guard (no files modified)
  - [ ] Glob auto-discovery (3-level depth cap, README first, smallest-first sort)
  - [ ] Corpus cap (1.5M chars, skipped_files[] + corpus_truncated: true)
  - [ ] Write manifest.json (schema_version 2) + state.json (schema_version 2)
  - [ ] Register in registry.json with description field
  - [ ] Create `~/.pythia/logs/`
- [ ] `oracle-tools.ts`: implement `oracle_health` handler (strictly read-only — zero mutations)
- [ ] `oracle-tools.ts`: implement `oracle_refresh` handler (atomic manifest write via atomicWriteFile)
- [ ] `server.ts`: register `oracle_init`, `oracle_health`, `oracle_refresh`
- [ ] Create `src/test-oracle-init.mjs` with 6+ test cases
- [ ] Create `src/test-oracle-health.mjs` with 4+ test cases
- [ ] Create `src/test-oracle-refresh.mjs` with 5+ test cases
- [ ] All 3 test suites pass

---

## Sprint 7 Completion Gate
- [ ] `npm test` passes in `/Users/mikeboscia/pythia/` (includes SQL tests)
- [ ] `npm run benchmark -- --samples 50` completes
- [ ] All 3 oracle test suites pass
- [ ] 3 new oracle tools visible via MCP tool list
- [ ] `oracle-spawn-audit.jsonl` appends correctly on success + failure
- [ ] `oracle_init` creates oracle with zero manual steps (E2E smoke test)
- [ ] Bump `package.json` version `1.2.0` → `1.3.0`
- [ ] Git commit Sprint 7
