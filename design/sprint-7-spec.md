# Pythia Sprint 7 Spec — v1.3.0

**Status:** FINAL
**Version bump:** `1.2.0` → `1.3.0`
**Date:** 2026-03-12
**Design doc:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md` (authoritative baseline)
**Codebase split:**
- Oracle features (FEAT-000, 032, 033, 034, 035) → `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`
- SQL + benchmark features (FEAT-024, 036) → `/Users/mikeboscia/pythia/src/`

---

## Overview

Sprint 7 is a **HARDENING** sprint. The original Sprint 7 features (LocalReasoningProvider, YAML support) are pushed to Sprint 8. This sprint makes the oracle system production-reliable before stacking additional capabilities on top of it.

Primary themes: eradicate manual bootstrap friction, fix cascading validation failures, add out-of-band observability that survives oracle wipes, complete the SQL structural pipeline deferred from Sprint 6, and wire the CodeSearchNet benchmark into the project lifecycle.

## Goals

- Zero manual steps to create a new oracle (`oracle_init`).
- Batch all hash mismatches in a single error; expose auto-refresh path.
- Provide a spawn audit log that lives outside the oracle directory.
- Expose oracle health check and batch-refresh as dedicated MCP tools.
- Complete SQL stored procedure / function / trigger extraction.
- Wire the existing CSN benchmark script into the project lifecycle with baseline support.

---

## Schema Version Bumps (Sprint 7)

| File | Old `schema_version` | New `schema_version` | Reason |
|------|---------------------|---------------------|--------|
| `manifest.json` | 1 | 2 | `description` field added |
| `state.json` | 1 | 2 | `last_spawn_at: string \| null` field added |

---

## Features

### FEAT-000 — `oracle_init` MCP Tool
**Priority:** P0 — Sprint 7
**Codebase:** `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

**Description:** The missing bootstrapping tool. Creates oracle directory structure, `manifest.json` (schema_version 2), `state.json` (schema_version 2), and registry entry. Fully autonomous — callable by Claude, sibling agents, or CLI without interactive prompting.

**Input:** `{ name: string, description: string, files?: string[] }`
**Output:** `{ name: string, oracle_dir: string, files_registered: number, corpus_truncated: boolean, skipped_files?: string[] }`

**Auto-discovery (when `files` omitted):**
- Glob patterns: `README.md`, `docs/**/*.md`, `docs/**/*.mdx`, `design/**/*.md`, `design/**/*.mdx`, `architecture/**/*.md`
- Depth limit: **3 levels — hard limit for v1, no override flag**
- `README.md` sorted first; remaining files sorted smallest-first
- Role assigned to all auto-discovered files: `"core_research"`
- Corpus cap: **1,500,000 characters total**
  - Files added until cap is approached; remaining files skipped
  - A single file exceeding 1,500,000 chars is skipped (not a hard failure)
  - `corpus_truncated: true` + `skipped_files` array returned in MCP response
  - Warning returned in MCP response JSON only — NOT written to manifest or audit log

**Generated `manifest.json`:**
```json
{
  "schema_version": 2,
  "name": "<name>",
  "description": "<description>",
  "project": "<derived from project_root basename>",
  "version": 1,
  "checkpoint_headroom_tokens": 200000,
  "pool_size": 1,
  "static_entries": [...],
  "live_sources": [],
  "load_order": ["core_research", "prompt_architecture", "pain_signals", "learnings", "checkpoint", "other"],
  "created_at": "<ISO-8601>"
}
```

`load_order` is always the full role list — static template for the oracle's lifetime regardless of initial corpus composition.

**`description` field:** Stored in `manifest.json` and `registry.json`. Human-readable metadata only — NOT injected into Gemini prompt context.

**Generated `state.json`:**
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

**Directory creation:** `oracle_init` creates `~/.pythia/logs/` (recursively creating `~/.pythia/` if needed).

**Acceptance Criteria:**
- [ ] Callable via MCP without interactive prompts.
- [ ] Auto-discovers files per glob patterns when `files` is omitted.
- [ ] Files skipped at corpus cap returned in `skipped_files`; `corpus_truncated: true`.
- [ ] Creates valid `manifest.json` (schema_version 2, static_entries as array, live_sources as array).
- [ ] Creates valid `state.json` (schema_version 2, `last_spawn_at: null`).
- [ ] Registers oracle in `registry.json`.
- [ ] Fails immediately with `ORACLE_ALREADY_EXISTS` if name already exists — no files modified.
- [ ] Creates `~/.pythia/logs/` if it does not exist.

---

### FEAT-032 — Fail-All Hash Validation
**Priority:** P0 — Sprint 7
**Codebase:** `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

**Description:** `spawn_oracle` currently stops at the first `HASH_MISMATCH`. Fix: scan ALL `static_entries` before failing. Return every stale file in a single error.

**New error code:** `HASH_MISMATCH_BATCH` (`-32042`) — added to error registry in `BACKEND_STRUCTURE-v2.md`.
(The existing error range -32040 to -32059 covers Provider/Context errors; -32042 is unassigned.)

**Error payload:**
```json
{
  "code": -32042,
  "message": "Multiple files have stale hashes",
  "data": {
    "error_code": "HASH_MISMATCH_BATCH",
    "stale_files": [
      { "path": "...", "expected": "...", "actual": "..." }
    ]
  }
}
```

**`auto_refresh?: boolean` added to `spawn_oracle` input:**
- Always **per-call opt-in** — cannot be defaulted in manifest or global config
- If `true` and file is **stale**: re-hash, update manifest atomically, continue
- If `true` and file is **deleted from disk** AND `required: false`: silently remove from manifest, continue
- If `true` and file is **deleted from disk** AND `required: true`: **hard fail** with `MISSING_REQUIRED_FILE` — a required file is a contractual guarantee; silent removal is not permitted
- Manifest update after `auto_refresh` is **not rolled back** if spawn subsequently fails (e.g. Gemini CLI unavailable) — the corpus state correction is persistent and independent of transport failures

**Acceptance Criteria:**
- [ ] All static_entries evaluated before any error returned.
- [ ] `HASH_MISMATCH_BATCH` payload contains complete array of stale files.
- [ ] `auto_refresh: true` re-hashes stale files, removes non-required deleted files, updates manifest atomically.
- [ ] `auto_refresh: true` + deleted `required: true` file = `MISSING_REQUIRED_FILE` hard failure.

---

### FEAT-033 — Spawn Audit Log
**Priority:** P0 — Sprint 7
**Codebase:** `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

**Path:** `~/.pythia/logs/oracle-spawn-audit.jsonl`
(`~/.pythia/` is the established Pythia global config dir, already containing `config.json` and `models/`. The `logs/` subdirectory is new in Sprint 7.)

**CRITICAL:** Log lives outside oracle directory — survives oracle wipes and decommissions.

**Directory creation:** Both `oracle_init` and `spawn_oracle` must create `~/.pythia/logs/` if it does not exist before writing.

**Log entry schema:**
```json
{
  "timestamp": "ISO-8601",
  "oracle_name": "string",
  "outcome": "success" | "error",
  "error_code": "string | undefined",
  "stale_file_count": "number",
  "files_loaded": "number",
  "duration_ms": "number"
}
```

**Field definitions:**
- `files_loaded`: count of `static_entries` successfully read from disk and injected into the provider's prompt context during this spawn
- For **resuming** spawns (`reuse_existing: true`, no corpus re-sent): `stale_file_count` = result of mandatory hash verification (must be 0 to proceed), `files_loaded` = 0

**Rotation policy:** None in v1. Strictly append-only JSONL. (Known limitation — rotation deferred to Sprint 8+.)

**Acceptance Criteria:**
- [ ] `~/.pythia/logs/` created if it does not exist.
- [ ] Every `spawn_oracle` call appends exactly one JSONL entry.
- [ ] Log file persists after oracle deletion or decommission.

---

### FEAT-034 — `oracle_health` MCP Tool
**Priority:** P1 — Sprint 7
**Codebase:** `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

**Description:** Read-only corpus health check. No daemon spawned, no manifest or state mutated.

**Input:** `{ name: string }`
**Output:**
```json
{
  "total_files": "number",
  "stale_files": ["path", "..."],
  "missing_files": ["path", "..."],
  "last_spawn_timestamp": "ISO-8601 | null",
  "status": "active" | "idle" | "dead"
}
```

**Field definitions:**
- `stale_files`: present on disk, hash mismatch
- `missing_files`: in manifest, not on disk — **separate array** from `stale_files`
- `last_spawn_timestamp`: read from `state.json` `last_spawn_at` field (added in Sprint 7). Returns `null` before first successful spawn.
- `status`: derived from `state.json` `daemon_pool` array:
  - Empty pool → `"idle"`
  - Any member with `status === "active"` → `"active"`
  - All members with `status === "dead"` → `"dead"`
  - (Decommissioned oracles are removed from registry; this tool is unreachable for them)

**Acceptance Criteria:**
- [ ] Does not spawn a daemon or mutate any file.
- [ ] `stale_files` and `missing_files` are separate arrays.
- [ ] Returns `null` for `last_spawn_timestamp` on first install.
- [ ] `status` correctly derived from `daemon_pool`.

---

### FEAT-035 — `oracle_refresh` MCP Tool
**Priority:** P1 — Sprint 7
**Codebase:** `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

**Description:** Batch re-hash stale files. Replaces repeated `oracle_update_entry` calls.

**Input:** `{ name: string, force?: boolean }`
- Default (`force: false`): re-hash only files with hash mismatch
- `force: true`: re-hash all files regardless of current hash state

**Deleted file behavior:**
- `required: false` deleted file → removed from manifest silently
- `required: true` deleted file → **hard fail** with `MISSING_REQUIRED_FILE`

**Atomicity:** Uses existing `atomicWriteFile()` throughout `oracle-tools.ts`.

**Output:** `{ files_updated: number, files_removed: number }`

**`oracle_update_entry` disposition:** Kept as lower-level primitive for adding new files or changing roles. `oracle_refresh` handles hash sync and deletion cleanup only.

**Acceptance Criteria:**
- [ ] Updates `manifest.json` atomically.
- [ ] Returns accurate `files_updated` and `files_removed` counts.
- [ ] Deleted `required: true` file → `MISSING_REQUIRED_FILE` failure.
- [ ] `force: true` re-hashes all entries.
- [ ] Preserves all other manifest fields unchanged.

---

### FEAT-024 — SQL Structural Extraction (Phase 2)
**Priority:** P1 — Sprint 7
**Codebase:** `/Users/mikeboscia/pythia/src/`

**Description:** Deferred from Sprint 6. Extends SQL extraction to named routines. `tree-sitter-sql` build-verified and grammar-verified on Node 22.

**Dialects in scope:** ANSI SQL + PostgreSQL syntax. No dialect configuration added in Sprint 7.

**Fallback:** ERROR node at routine level → fall back to `module` chunk silently. No warning.

**Extraction targets:**
- `CREATE FUNCTION` / `CREATE OR REPLACE FUNCTION`
- `CREATE PROCEDURE` / `CREATE OR REPLACE PROCEDURE`
- `CREATE TRIGGER`

(Verified: both `CREATE` and `CREATE OR REPLACE` parse as `create_function_statement` nodes in `tree-sitter-sql` grammar via actual parser run.)

**CNI format:** `<path>::function::<name>` where `<name>` is the full schema-qualified name when present (e.g. `public.calculate_revenue`).

**Module chunk behavior:** SQL files **always** emit one `chunk_type: "module"` containing the full file text alongside extracted `chunk_type: "function"` chunks. This is consistent with all other languages in the Tree-sitter pipeline — module chunk is always emitted.

**Anonymous blocks** (`DO $$ BEGIN ... END $$`): No name → cannot form CNI → silently included in `module` chunk only. Never extracted as `function` chunks.

**Acceptance Criteria:**
- [ ] `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE TRIGGER` (and `OR REPLACE` variants) emit `chunk_type: "function"`.
- [ ] Schema-qualified names used in CNI when present.
- [ ] `chunk_type: "module"` always emitted for the full file.
- [ ] ERROR nodes fall back to module-only without crashing.
- [ ] Anonymous blocks included in module chunk only.

---

### FEAT-036 — CodeSearchNet Benchmark Wiring
**Priority:** P1 — Sprint 7
**Codebase:** `/Users/mikeboscia/pythia/src/` + `scripts/`

**Description:** `scripts/csn-benchmark.mjs` is complete. This feature wires it into the project lifecycle with baseline tracking.

**`package.json`:** Add `"benchmark": "node scripts/csn-benchmark.mjs"`

**`src/config.ts`:** Add `embedding_batch_size: 32` and `embedding_concurrency: 1` as named defaults in Zod schema.

**`--baseline` flag in `csn-benchmark.mjs`:**
- Logic lives entirely in `csn-benchmark.mjs` — no changes to `runner.ts` or `report.ts`
- Uses `readFileSync` / `writeFileSync` inline (script is synchronous throughout)
- Calls `computeBaselineDiff()` from `src/benchmark/runner.ts` to compute diff
- Injects `baseline_diff` into `BenchmarkRun` before `writeBenchmarkArtifacts`
- Saves new baseline using `writeBaselineFile()` from `src/benchmark/report.ts`
- **Eligibility gate:** `--baseline` checks `baselineEligible(run.summary, queries.length)` before saving. If the run is degraded (>20% zero-result queries or any missing-label queries), script **hard fails** with exit code 1 and refuses to overwrite the existing baseline.

**Baseline file schema:** Full `BenchmarkRun` written via existing `writeBaselineFile()`. Includes per-query results array — this is intentional for regression debugging.

**Baseline file paths:** `benchmarks/baselines/javascript.json`, `benchmarks/baselines/php.json`
- **Committed to git** — these are versioned regression contracts

**No baseline + no `--baseline` flag:** Console warning, `baseline_diff` omitted from output, run continues. Not a hard failure.

**Diff display:** When `baseline_diff` is present, it is displayed **both** in the terminal stdout summary box and written to `summary.json` / `summary.md` artifacts.

**`benchmarks/baselines/.gitkeep`:** Created to establish directory in repo.

**Acceptance Criteria:**
- [ ] `npm run benchmark` executes successfully.
- [ ] `embedding_batch_size` and `embedding_concurrency` defaults exist in Zod schema.
- [ ] `--baseline` saves baseline only when `baselineEligible()` returns true; hard fails otherwise.
- [ ] Subsequent runs diff against saved baseline and display in terminal + artifacts.
- [ ] No baseline + no flag → warning only, run completes.
- [ ] `benchmarks/baselines/` committed to git.

---

## Implementation Steps

### Step 7.1 — SQL Structural Extraction
**Codebase:** `/Users/mikeboscia/pythia/`
**Files:** `src/indexer/chunker-treesitter.ts`
- Add `extractSqlChunks()` using `tree-sitter-sql`
- Match `create_function_statement`, `create_procedure_statement`, `create_trigger_statement` nodes
- Emit `chunk_type: "function"` with CNI `<path>::function::<qualified_name>`
- Always emit `chunk_type: "module"` for full file
- ERROR node → skip routine extraction, keep module only
- **Tests:** `src/__tests__/chunker-sql.test.ts`

### Step 7.2 — CodeSearchNet Benchmark Wiring
**Codebase:** `/Users/mikeboscia/pythia/`
**Files:**
- `package.json`: add `"benchmark"` script
- `src/config.ts`: add benchmark defaults to Zod schema
- `scripts/csn-benchmark.mjs`: add `--baseline` flag logic
- `benchmarks/baselines/.gitkeep`: create directory

### Step 7.3 — Spawn Audit Log & Fail-All Validation
**Codebase:** `~/.claude/mcp-servers/inter-agent/`
**Files:** `src/oracle-tools.ts`
- Replace fail-fast hash check with accumulating loop over all `static_entries`
- Add `MISSING_REQUIRED_FILE` error for deleted `required: true` files during `auto_refresh`
- Throw `HASH_MISMATCH_BATCH` (-32042) when mismatches exist and `auto_refresh` is false
- If `auto_refresh: true`: re-hash stale, remove non-required missing, update manifest atomically, continue
- Append one JSONL entry to `~/.pythia/logs/oracle-spawn-audit.jsonl` after every spawn attempt
- Create `~/.pythia/logs/` if not exists
- Add `last_spawn_at` to `state.json` writes (schema_version 2)
- **Tests:** spawn-audit log assertions, batch error payload shape, required-file hard failure

### Step 7.4 — Oracle Core Tools
**Codebase:** `~/.claude/mcp-servers/inter-agent/`
**Files:**
- `src/oracle-tools.ts`: add `oracle_init`, `oracle_health`, `oracle_refresh` handlers
- `src/gemini/server.ts`: register three new tools
**Actions:**
- `oracle_init`: glob scan, corpus cap, manifest (schema_version 2) + state (schema_version 2) + registry creation, `~/.pythia/logs/` creation
- `oracle_health`: manifest scan, hash check, missing detection, pool-derived status, `last_spawn_at` read — strictly read-only
- `oracle_refresh`: accumulate stale/missing, hard fail on deleted required files, atomic manifest write
- **Tests:** `oracle-init.test.mjs`, `oracle-health.test.mjs`, `oracle-refresh.test.mjs`

---

## New Error Codes (add to `BACKEND_STRUCTURE-v2.md`)

| Code | Numeric | Description |
|------|---------|-------------|
| `HASH_MISMATCH_BATCH` | -32042 | Multiple static_entries have stale hashes; `stale_files` array in data |
| `MISSING_REQUIRED_FILE` | -32043 | A `required: true` corpus file was deleted from disk |

---

## Critical Constraints

1. **ReasoningProvider Interface** (`src/oracle/provider.ts`): ONLY `query(prompt, context)` and `healthCheck()`. No spawn/ask/dismiss.
2. **Hardcoded constants**: `INTENT_WEIGHTS` (line 49) and `RRF_K = 60` (line 46) in `src/retrieval/hybrid.ts` — not moved to config in Sprint 7.
3. **Test framework (Pythia LCS):** Node.js built-in `--test` runner, `*.test.ts` in `src/__tests__/`.
4. **atomicWriteFile:** Already used throughout `oracle-tools.ts` — use it for all manifest mutations.
5. **Dual-codebase:** Oracle FEAT-000/032/033/034/035 → inter-agent repo (versioned independently at v1.0.0). SQL FEAT-024 + benchmark FEAT-036 → Pythia LCS repo.
6. **Module chunk:** Always emitted for all languages alongside structural chunks — this is uniform behavior, not SQL-specific.

---

## Migration Path (Sprint 6 → Sprint 7)

No automated migration. Existing Sprint 6 oracles discover the change when `spawn_oracle` fails with `HASH_MISMATCH_BATCH`. The error message instructs users to either:
- Pass `auto_refresh: true` on the next spawn call, OR
- Run `oracle_refresh` explicitly

No autonomous mass-migration command is provided.

---

## Known Limitations (v1.3.0)

- **Audit log rotation:** `~/.pythia/logs/oracle-spawn-audit.jsonl` has no size cap or rotation in v1. Deferred to Sprint 8+.
- **Auto-discovery depth:** Hard limit of 3 levels. No override flag. Deferred to Sprint 8+.
- **SQL dialects:** ANSI SQL + PostgreSQL only. MySQL, SQLite procedures, dialect-specific syntax deferred.
- **Anonymous SQL blocks:** Not extracted; included in module chunk only.

---

## Test Requirements

- `src/__tests__/chunker-sql.test.ts`: named routines extract as `function` chunks; module chunk always present; ERROR nodes fall back; anonymous blocks stay in module
- Spawn audit log: JSONL appended on success and failure; survives oracle wipe
- Batch validation: all stale files in error payload; `auto_refresh` updates manifest; required-file deletion fails hard
- `oracle-init.test.mjs`: auto-discovery, corpus cap, `ORACLE_ALREADY_EXISTS` guard, schema_version 2 output
- `oracle-health.test.mjs`: separate stale/missing arrays, null timestamp, pool-derived status
- `oracle-refresh.test.mjs`: atomic write, deleted required file fails, `force: true` behavior

---

## Success Metrics

- **0 manual steps** to create a new oracle (FEAT-000).
- `spawn_oracle` returns all stale files in one error — never requires sequential fix-and-retry (FEAT-032).
- `~/.pythia/logs/oracle-spawn-audit.jsonl` present after oracle wipe (FEAT-033).
- `npm run benchmark -- --baseline` stores baseline; subsequent runs show diff in terminal and artifacts (FEAT-036).
- SQL `lcs_chunks` queries locate stored procedures and functions by name (FEAT-024).

---

## Out of Scope (Sprint 8)

- `LocalReasoningProvider` (Ollama / LM Studio)
- YAML / JSON structural extraction
- Changes to `ReasoningProvider` interface
- Moving `INTENT_WEIGHTS` or `RRF_K` to config
- Advanced SQL dialect support (window functions, CTEs, MySQL stored procs)
- Audit log rotation / size cap
- `oracle_init` depth override flag
- `oracle_init` `--overwrite` flag
