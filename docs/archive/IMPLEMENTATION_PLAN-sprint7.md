# Pythia v1 — Implementation Plan: Sprint 7 (Hardening)

**Version:** 1.3.0
**Sprint Theme:** Oracle Hardening + SQL Structural Extraction + CSN Benchmark Wiring
**Date:** 2026-03-12
**Status:** NOT STARTED
**Spec:** `/Users/mikeboscia/pythia/design/sprint-7-spec.md`

> **This file is the map. It does NOT get modified during execution.**
> Track progress in `/Users/mikeboscia/pythia/progress.txt` and `/Users/mikeboscia/pythia/tasks/todo.md`.

---

## Sprint Overview

Sprint 7 is a **HARDENING** sprint. LocalReasoningProvider and YAML support (original Sprint 7 feature set) have been deferred to Sprint 8. This sprint eradicates manual oracle bootstrap friction, fixes cascading validation failures, adds out-of-band observability that survives oracle wipes, completes the SQL structural pipeline deferred from Sprint 6, and wires the CodeSearchNet benchmark into the project lifecycle.

**Codebase split (critical — two separate repos):**
- **Oracle features (FEAT-000, 032, 033, 034, 035)** → `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`
- **SQL + benchmark features (FEAT-024, 036)** → `/Users/mikeboscia/pythia/src/`

---

## Features Delivered

| FEAT | Name | Priority | Codebase |
|------|------|----------|----------|
| FEAT-000 | `oracle_init` MCP Tool | P0 | inter-agent |
| FEAT-032 | Fail-All Hash Validation | P0 | inter-agent |
| FEAT-033 | Spawn Audit Log | P0 | inter-agent |
| FEAT-034 | `oracle_health` MCP Tool | P1 | inter-agent |
| FEAT-035 | `oracle_refresh` MCP Tool | P1 | inter-agent |
| FEAT-024 | SQL Structural Extraction (Phase 2) | P1 | pythia LCS |
| FEAT-036 | CodeSearchNet Benchmark Wiring | P1 | pythia LCS |

---

## Step 7.1 — SQL Structural Extraction (FEAT-024)

**Codebase:** `/Users/mikeboscia/pythia/`
**Priority:** P1

### Files to Create
- `src/__tests__/chunker-sql.test.ts` — SQL extraction unit tests

### Files to Modify
- `src/indexer/chunker-treesitter.ts` — Add `extractSqlChunks()` function

### Implementation

**In `chunker-treesitter.ts`:**
1. Add `extractSqlChunks(tree, filePath, fileContent)` function
2. Target tree-sitter node types:
   - `create_function_statement` — covers `CREATE FUNCTION` and `CREATE OR REPLACE FUNCTION`
   - `create_procedure_statement` — covers `CREATE PROCEDURE` and `CREATE OR REPLACE PROCEDURE`
   - `create_trigger_statement` — covers `CREATE TRIGGER`
3. Extract name as schema-qualified when present (e.g. `public.calculate_revenue`)
4. Emit `chunk_type: "function"` with CNI format `<path>::function::<qualified_name>`
5. Always emit `chunk_type: "module"` containing the full file text
6. ERROR node at routine level → skip routine, keep module chunk only — no warning, no crash
7. Anonymous blocks (`DO $$ BEGIN ... END $$`) → no name → included in module chunk only, never extracted as function chunks
8. Register `extractSqlChunks` in the language dispatch table for `.sql` files

### Tests (`src/__tests__/chunker-sql.test.ts`)
- Named function emits `chunk_type: "function"` + correct CNI `::function::name`
- `CREATE OR REPLACE FUNCTION` emits same as `CREATE FUNCTION`
- Schema-qualified name `public.fn` becomes CNI `::function::public.fn`
- Module chunk always present for SQL files with named routines
- Module chunk present for SQL files with no named routines
- ERROR node at routine level → module chunk only, no crash
- Anonymous block `DO $$ ... $$` → module chunk only, no function chunk

### Proof Criteria
- `npm test` passes with all new SQL tests green
- A `.sql` file with 3 named functions → 4 chunks total (3 function + 1 module)
- A `.sql` file with 1 anonymous block → 1 chunk (module only)
- A `.sql` file with ERROR node → 1 chunk (module only), no exception thrown

---

## Step 7.2 — CodeSearchNet Benchmark Wiring (FEAT-036)

**Codebase:** `/Users/mikeboscia/pythia/`
**Priority:** P1

### Files to Create
- `benchmarks/baselines/.gitkeep` — establishes versioned directory in repo

### Files to Modify
- `package.json` — add `"benchmark"` script
- `src/config.ts` — add `embedding_batch_size` and `embedding_concurrency` defaults to Zod schema
- `scripts/csn-benchmark.mjs` — add `--baseline` flag logic

### Implementation

**`package.json` addition:**
```json
"benchmark": "node scripts/csn-benchmark.mjs"
```

**`src/config.ts` Zod schema addition:**
Add to indexing config schema:
```typescript
embedding_batch_size: z.number().int().positive().default(32),
embedding_concurrency: z.number().int().positive().default(1),
```

**`scripts/csn-benchmark.mjs` — `--baseline` flag:**

Add at top-level arg parsing:
```javascript
const setBaseline = flag('--baseline');
const baselinePath = path.join(repoRoot, 'benchmarks', 'baselines', `${lang}.json`);
```

After `runBenchmark()` completes, before `writeBenchmarkArtifacts()`:

1. If `--baseline` flag set AND existing baseline file exists:
   - Read baseline via `readFileSync`
   - Parse as `BenchmarkRun`
   - Call `computeBaselineDiff(run.summary, baseline.summary)` from `src/benchmark/runner.ts`
   - Inject `baseline_diff` into `run` before artifacts
2. If `--baseline` flag set, check eligibility:
   - Call `baselineEligible(run.summary, queries.length)` from `src/benchmark/report.ts`
   - If NOT eligible: print error, `process.exit(1)` — refuse to overwrite baseline
   - If eligible: call `writeBaselineFile(baselinePath, run)` from `src/benchmark/report.ts`
3. If no `--baseline` flag AND no existing baseline: console warning only, continue

Display diff in terminal box when `baseline_diff` is present — add rows for each diff key in the existing `console.log` summary box section.

### Tests
- `npm run benchmark` executes without error (integration smoke test — no `--baseline`)
- `embedding_batch_size` and `embedding_concurrency` fields present in Zod schema with correct defaults
- `benchmarks/baselines/` directory committed to git

### Proof Criteria
- `npm run benchmark -- --samples 50` completes with summary box printed
- `npm run benchmark -- --samples 50 --baseline` on a clean run: saves `benchmarks/baselines/javascript.json`
- Second run with `--baseline`: diff row appears in terminal summary box
- Degraded run (force zero-result queries): `--baseline` exits with code 1, baseline file unchanged

---

## Step 7.3 — Spawn Audit Log & Fail-All Validation (FEAT-032 + FEAT-033)

**Codebase:** `~/.claude/mcp-servers/inter-agent/`
**Priority:** P0

### Files to Modify
- `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` — two changes to `spawn_oracle` flow

### Implementation

**A. Fail-All Hash Validation (FEAT-032):**

Replace the current fail-fast hash check loop with an accumulating loop:
1. Iterate ALL `static_entries` — do not break on first mismatch
2. Accumulate `{ path, expected, actual }` objects in `staleFiles[]` array
3. Accumulate `missingRequired[]` for deleted `required: true` files
4. After full scan:
   - If `missingRequired.length > 0` and `auto_refresh: true` → return `MISSING_REQUIRED_FILE` (-32043)
   - If `staleFiles.length > 0` and `auto_refresh: false` → return `HASH_MISMATCH_BATCH` (-32042) with full `stale_files` array
   - If `auto_refresh: true` and `staleFiles.length > 0`: re-hash all stale files, update manifest atomically via `atomicWriteFile()`, continue
   - If `auto_refresh: true` and deleted `required: false` files exist: remove from manifest atomically, continue

**Add `auto_refresh?: boolean` to `spawn_oracle` input schema.**

**B. Spawn Audit Log (FEAT-033):**

After every `spawn_oracle` call (success or error), append one entry to `~/.pythia/logs/oracle-spawn-audit.jsonl`:
```json
{
  "timestamp": "<ISO-8601>",
  "oracle_name": "<name>",
  "outcome": "success" | "error",
  "error_code": "<string|undefined>",
  "stale_file_count": <number>,
  "files_loaded": <number>,
  "duration_ms": <number>
}
```

- Create `~/.pythia/logs/` directory if it does not exist (before every write)
- Append via `fs.appendFileSync` — strictly append-only
- `files_loaded`: count of `static_entries` actually read and injected into Gemini context this call
- For resume spawns (`reuse_existing: true`): `files_loaded = 0`, `stale_file_count = 0` (after passing hash check)

**C. `last_spawn_at` in `state.json` (schema_version 2):**

On every successful spawn:
- Set `state.last_spawn_at` to current ISO-8601 timestamp
- Ensure `state.schema_version` is written as `2`

### Tests
- `spawn_oracle` with 3 stale files → `HASH_MISMATCH_BATCH` payload contains all 3 `stale_files` entries
- `auto_refresh: true` with stale file → manifest updated atomically, spawn proceeds
- `auto_refresh: true` with deleted `required: true` file → `MISSING_REQUIRED_FILE` hard fail
- `auto_refresh: true` with deleted `required: false` file → removed from manifest, spawn proceeds
- After successful spawn: `oracle-spawn-audit.jsonl` contains one new entry
- After failed spawn: `oracle-spawn-audit.jsonl` contains entry with `outcome: "error"`
- Delete oracle directory: `oracle-spawn-audit.jsonl` at `~/.pythia/logs/` still present

### Proof Criteria
- Spawn an oracle with 3 stale files, no `auto_refresh`: single `HASH_MISMATCH_BATCH` error, all 3 files listed
- Spawn same oracle with `auto_refresh: true`: succeeds, manifest hashes updated
- Inspect `~/.pythia/logs/oracle-spawn-audit.jsonl`: both attempts logged

---

## Step 7.4 — Oracle Core Tools (FEAT-000 + FEAT-034 + FEAT-035)

**Codebase:** `~/.claude/mcp-servers/inter-agent/`
**Priority:** P0 (FEAT-000) / P1 (FEAT-034, FEAT-035)

### Files to Create
- `~/.claude/mcp-servers/inter-agent/src/test-oracle-init.mjs`
- `~/.claude/mcp-servers/inter-agent/src/test-oracle-health.mjs`
- `~/.claude/mcp-servers/inter-agent/src/test-oracle-refresh.mjs`

### Files to Modify
- `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` — add three new tool handlers
- `~/.claude/mcp-servers/inter-agent/src/gemini/server.ts` — register three new MCP tools

### Implementation: `oracle_init` (FEAT-000)

Input: `{ name: string, description: string, files?: string[] }`

1. Check `registry.json` — if name exists: return `ORACLE_ALREADY_EXISTS`, no files modified
2. If `files` omitted: auto-discover with glob patterns:
   - `README.md`, `docs/**/*.md`, `docs/**/*.mdx`, `design/**/*.md`, `design/**/*.mdx`, `architecture/**/*.md`
   - Depth limit: 3 levels (hard limit — no override flag)
   - `README.md` sorted first; remaining sorted smallest-first by file size
3. Corpus cap: 1,500,000 characters total
   - Files added in sort order until cap approached
   - A single file > 1,500,000 chars → skipped (not hard failure)
   - Track `skipped_files[]` and set `corpus_truncated: true`
4. For each accepted file: compute SHA-256 hash
5. Create oracle directory: `~/.pythia/oracles/<name>/`
6. Create `~/.pythia/logs/` if not exists
7. Write `manifest.json` (schema_version 2):
   ```json
   {
     "schema_version": 2,
     "name": "<name>",
     "description": "<description>",
     "project": "<basename of cwd>",
     "version": 1,
     "checkpoint_headroom_tokens": 200000,
     "pool_size": 1,
     "static_entries": [
       { "id": "<uuid>", "path": "<abs_path>", "role": "core_research", "required": false, "hash": "<sha256>" }
     ],
     "live_sources": [],
     "load_order": ["core_research", "prompt_architecture", "pain_signals", "learnings", "checkpoint", "other"],
     "created_at": "<ISO-8601>"
   }
   ```
8. Write `state.json` (schema_version 2):
   ```json
   {
     "schema_version": 2,
     "oracle_name": "<name>",
     "version": 1,
     "spawned_at": null,
     "last_spawn_at": null,
     "discovered_context_window": null,
     "daemon_pool": [],
     "generation": 1,
     "interaction_count": 0,
     "last_checkpoint_at": null,
     "next_seq": 0
   }
   ```
9. Register in `registry.json` with `description` field
10. Return: `{ name, oracle_dir, files_registered, corpus_truncated, skipped_files? }`

### Implementation: `oracle_health` (FEAT-034)

Input: `{ name: string }`

1. Read `registry.json` — if not found: `ORACLE_NOT_FOUND`
2. Read `manifest.json` for oracle
3. Read `state.json` for oracle
4. For each `static_entry`:
   - File not on disk → add to `missing_files[]`
   - File on disk, hash mismatch → add to `stale_files[]`
5. Derive `status` from `daemon_pool`:
   - Empty → `"idle"`
   - Any member with `status === "active"` → `"active"`
   - All members with `status === "dead"` → `"dead"`
6. Return `{ total_files, stale_files, missing_files, last_spawn_timestamp, status }`
7. **MUST NOT spawn daemon, MUST NOT mutate any file**

### Implementation: `oracle_refresh` (FEAT-035)

Input: `{ name: string, force?: boolean }`

1. Read `registry.json` — if not found: `ORACLE_NOT_FOUND`
2. Read `manifest.json`
3. Scan all `static_entries`:
   - If `force: true`: re-hash all entries regardless of current hash
   - If `force: false` (default): re-hash only entries with hash mismatch
   - Deleted file + `required: false` → remove from manifest
   - Deleted file + `required: true` → hard fail with `MISSING_REQUIRED_FILE` (-32043)
4. Write updated manifest atomically via `atomicWriteFile()`
5. Return `{ files_updated: number, files_removed: number }`

### Register in `server.ts`
Add three new tool registrations:
- `oracle_init` with schema matching FEAT-000 input
- `oracle_health` with schema matching FEAT-034 input
- `oracle_refresh` with schema matching FEAT-035 input

### Tests
**`test-oracle-init.mjs`:**
- Auto-discovery without `files` arg: registers README.md first
- Corpus cap: files beyond 1.5M chars skipped, `corpus_truncated: true`
- `ORACLE_ALREADY_EXISTS` on duplicate name — no files modified
- `manifest.json` schema_version === 2, `static_entries` is array, `live_sources` is array
- `state.json` schema_version === 2, `last_spawn_at: null`
- `~/.pythia/logs/` created if not exists

**`test-oracle-health.mjs`:**
- Stale file → appears in `stale_files`, NOT `missing_files`
- Missing file → appears in `missing_files`, NOT `stale_files`
- Empty `daemon_pool` → `status: "idle"`
- `last_spawn_timestamp: null` before first spawn
- Tool call makes zero disk mutations

**`test-oracle-refresh.mjs`:**
- Stale file refreshed: manifest hash updated atomically
- Non-required deleted file: removed from manifest, `files_removed: 1`
- Required deleted file: `MISSING_REQUIRED_FILE` hard failure, manifest unchanged
- `force: true`: all entries re-hashed, even already-current entries
- Non-stale fields in manifest (version, pool_size, etc.) preserved unchanged

### Proof Criteria
- `oracle_init` on a new project: zero manual file creation needed
- `oracle_health` on a fresh init: `{ total_files: N, stale_files: [], missing_files: [], status: "idle", last_spawn_timestamp: null }`
- `oracle_refresh` on stale oracle: hashes corrected, subsequent `spawn_oracle` succeeds
- All 3 test suites pass

---

## Sprint 7 Completion Checklist

- [ ] `npm test` passes in `/Users/mikeboscia/pythia/` (includes new SQL tests)
- [ ] `npm run benchmark -- --samples 50` completes successfully
- [ ] `test-oracle-init.mjs` all tests pass
- [ ] `test-oracle-health.mjs` all tests pass
- [ ] `test-oracle-refresh.mjs` all tests pass
- [ ] All 3 new oracle tools registered in `server.ts` and visible via MCP
- [ ] `oracle-spawn-audit.jsonl` appended correctly on spawn success + failure
- [ ] `oracle_init` creates oracle with zero manual steps
- [ ] `spawn_oracle` returns all stale files in one error (not first-one-wins)
- [ ] SQL stored procedures/functions locatable via `lcs_investigate`

---

## Dependencies

- Step 7.1 is independent — can execute first in Pythia LCS repo
- Step 7.2 is independent — can execute in parallel with 7.1 in Pythia LCS repo
- Step 7.3 must precede Step 7.4 (audit log infrastructure needed by `oracle_init`)
- Step 7.4 depends on Step 7.3 (FEAT-032 error codes used by FEAT-035 refresh logic)

**Recommended execution order:** 7.1 → 7.2 → 7.3 → 7.4

---

## Version Bump

On sprint completion: bump `package.json` version from `1.2.0` → `1.3.0` in Pythia LCS repo.
Inter-agent MCP server versioned independently.
