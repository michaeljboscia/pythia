# Sprint 10 Spec — Corpus Intelligence
**Version:** 7.0
**Date:** 2026-03-13
**Pythia version:** 1.4.0
**Status:** IN REVIEW
**Prerequisite:** Sprint 9 complete (✓ as of 2026-03-12, 383/383 tests pass)

---

## Sprint Goal

Solve the "noisy corpus" problem. On real-world repos, if `.pythiaignore` is missing, Pythia indexes `node_modules/` or build artifacts. This causes OOM crashes, high latency, and terrible search retrieval (bad recall feels like a bad product).

We need opinionated defaults (auto-generating ignores), transparent corpus health reporting so users know what's in their DB, and highly behavioral tool descriptions so the AI agent knows how to proactively identify noise and guide the user to fix their setup.

**Language expansion (Swift/Kotlin/Elixir) is OUT OF SCOPE for this sprint. It was reprioritized to prioritize index quality.**

---

## Proof of Completion

```bash
# A proof script must be implemented as scripts/sprint10-proof.mjs
# Runtime: #!/usr/bin/env node with npx tsx for TypeScript-aware imports.
# MCP server startup pattern: follow scripts/smoke-test.mjs (spawn MCP server as child process, connect via stdio transport, send JSON-RPC initialize then tools/call).
#
# Worker A implements phase 1 (CLI):
# 1. Creates a temp Node.js project using mkdtempSync(path.join(os.tmpdir(), "pythia-proof-"))
#    (with package.json but NO .pythiaignore)
# 2. Runs `pythia init`
# 3. Verifies .pythiaignore was created containing "node_modules/"
# 4. Verifies stdout contained "[Pythia] Detected: Node.js"
# 5. Verifies stdout contained the exact health summary header line "=== Pythia Corpus Health ==="
#
# Worker A MUST end the script with this exact marker comment so Worker B knows where to append:
#   // --- PHASE 2: Worker B appends here ---
#
# Worker B implements phase 2 (MCP):
# 6. Starts the MCP server (stdio transport, follow scripts/smoke-test.mjs pattern), calls pythia_corpus_health
# 7. Asserts JSON response parses correctly, contains a `verdict` field whose value is "WARN",
#    and whose `verdict_reason` matches "No files were indexed..."
```

---

## Feature Scope

### FEAT-040 — Opinionated `.pythiaignore` generation
**Status:** New implementation required.

**File:** `src/cli/init.ts` (owned by Worker A)

**CRITICAL PLACEMENT:** This logic runs **BEFORE** the early-return check for already-initialized workspaces. It must execute whether or not the workspace has been previously initialized. Insert the entire FEAT-040 block before the `if (alreadyInitialized && !options.force)` guard.

**If `readdirSync(workspaceRoot)` throws:** Catch the error, print a warning to stderr (`[WARNING] Could not read workspace root: <error message>. Skipping .pythiaignore generation.`), and continue — do not abort `pythia init`.

**Steps:**
1. **Detect project type(s)** by checking the workspace root (depth-0 only). Use `readdirSync(workspaceRoot, { withFileTypes: true })` and filter to entries where `dirent.isFile()` returns true before name-checking (prevents false-positive detection from directories that happen to be named `go.mod`, `package.json`, etc.):
   - Node.js: `package.json`
   - Python: `requirements.txt` or `pyproject.toml`
   - Go: `go.mod`
   - Rust: `Cargo.toml`
   - Ruby: `Gemfile`
   - C#: any file where `dirent.name.endsWith(".csproj")`
2. **Define ignore lines:**
   - Universal (always added): `.git/`, `*.lock`, `*.log`, `coverage/`
   - Node.js: `node_modules/`, `dist/`, `dist-test/`, `.next/`, `.nuxt/`, `.turbo/`
   - Python: `__pycache__/`, `.venv/`, `venv/`, `site-packages/`, `*.pyc`, `.pytest_cache/`, `dist/`, `build/`
   - Go: `vendor/`, `bin/`
   - Rust: `target/`
   - Ruby: `vendor/bundle/`, `.bundle/`
   - C#: `bin/`, `obj/`, `packages/`
3. **Union + Dedup Logic:** If multiple markers are found (e.g., `package.json` and `pyproject.toml`), collect ignore lines for ALL detected languages into a Set to deduplicate. Emit lines in the order: universal first, then language-specific in the order detected.
4. **Write/Append `.pythiaignore`:**
   - If it does NOT exist, OR exists but is **zero bytes** (detect with `statSync(ignorePath).size === 0`): Create/overwrite it, write the universal lines + all detected language lines (deduplicated). Use the "new file created" console output.
   - If it DOES exist and has content: Do NOT overwrite. Read the file contents. For each candidate line, do an exact string match. If the exact string (e.g., `node_modules/`) is missing, collect it for a "recommended additions" block.
   - **Newline Safety (append path — only when file has existing content):**
     - If the existing file does NOT end with `\n`: prepend `\n\n# Pythia recommended additions\n` before the new lines.
     - If the existing file DOES end with `\n`: prepend `\n# Pythia recommended additions\n` before the new lines.
   - If no lines are missing: leave the file byte-for-byte unchanged (do not append a block).
5. **Console Output:** Print to `stdout`. **Order: when at least one project marker is detected, print the detection line first, then the file-action line. When no markers are found, print only the no-markers combined message (the detection line is suppressed — detection and the no-markers message are mutually exclusive).** Use these exact formats:
   - Language detection: `[Pythia] Detected: <comma-separated language names> (e.g., Node.js, Python)`
   - New file created: `[Pythia] Created .pythiaignore with <N> ignore rules.`
   - Existing file updated: `[Pythia] Appended <N> recommended rules to existing .pythiaignore.`
   - No changes needed: `[Pythia] .pythiaignore is up to date.`
   - No markers found: `[Pythia] No project markers detected. Created .pythiaignore with universal rules only.`

### FEAT-041 — Post-init corpus health summary
**Status:** New implementation required.

**Files:** `src/indexer/health.ts` (new), `src/cli/init.ts` (owned by Worker A)

**Data Contract (`src/indexer/health.ts`):**
Export `export function computeCorpusHealth(db: Database.Database): CorpusHealthReport`. Export the `CorpusHealthReport` type.

```typescript
export type CorpusHealthReport = {
  verdict: "UNINITIALIZED" | "WARN" | "DEGRADED" | "HEALTHY";
  verdict_reason: string;
  total_chunks: number;
  total_files: number;
  chunk_type_distribution: Array<{ chunk_type: string; count: number }>;
  short_chunk_count: number;
  avg_chunk_length_chars: number | null;   // null when total_chunks === 0
  top_path_prefixes: Array<{ prefix: string; count: number }>;
};
```

Wrap ALL queries in a single `try/catch`. Catch only SQLite errors whose message includes `"no such table"`. Any other error should re-throw. If the `lcs_chunks` table does not exist, return:
```typescript
{
  verdict: "UNINITIALIZED",
  verdict_reason: "Run pythia init first.",
  total_chunks: 0, total_files: 0,
  chunk_type_distribution: [], short_chunk_count: 0,
  avg_chunk_length_chars: null, top_path_prefixes: []
}
```

**Metrics:**
- `total_chunks`: `SELECT count(*) FROM lcs_chunks WHERE is_deleted = 0`
- `total_files`: `SELECT count(distinct file_path) FROM lcs_chunks WHERE is_deleted = 0`
- `chunk_type_distribution`: `SELECT chunk_type, count(*) as count FROM lcs_chunks WHERE is_deleted = 0 GROUP BY chunk_type` — returns `Array<{chunk_type, count}>`
- `short_chunk_count`: `SELECT count(*) FROM lcs_chunks WHERE length(content) < 100 AND is_deleted = 0`
- `avg_chunk_length_chars`: `SELECT CAST(AVG(length(content)) AS INTEGER) FROM lcs_chunks WHERE is_deleted = 0` — returns `null` when `total_chunks === 0` (SQLite AVG over zero rows returns NULL; do not coerce to 0)
- `top_path_prefixes`: Fetch `file_path` via `.iterate()` to prevent V8 memory spikes. Pythia v1 is POSIX-only and file_path values are workspace-relative, so `split("/")` is correct.
  ```typescript
  const stmt = db.prepare("SELECT file_path FROM lcs_chunks WHERE is_deleted = 0");
  const prefixCounts = new Map<string, number>();
  for (const { file_path } of stmt.iterate() as Iterable<{ file_path: string }>) {
    const prefix = file_path.split("/")[0] ?? file_path;
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }
  const top_path_prefixes = [...prefixCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([prefix, count]) => ({ prefix, count }));
  ```

**Verdict Logic:**
Define `const SUSPICIOUS_PREFIXES = ["node_modules", "dist", "build", "vendor", ".git", "target", "bin", "obj", "__pycache__", ".next", "coverage"];`

Evaluate in this exact order (first match wins):
- **UNINITIALIZED:** `lcs_chunks` table missing. `verdict_reason`: `"Run pythia init first."`
- **WARN (Empty):** `total_chunks === 0`. `verdict_reason`: `"No files were indexed. Check your .pythiaignore and workspace path."`
- **DEGRADED:** `module` chunk type > 60% of total_chunks, OR short_chunk_count > 30% of total_chunks, OR any entry in `top_path_prefixes` has a prefix in `SUSPICIOUS_PREFIXES`. `verdict_reason`: `"Corpus contains noise or low-quality chunks. Review .pythiaignore and re-run pythia init."`
- **WARN:** `module` chunk type is 40–60% of total_chunks (inclusive), OR short_chunk_count is 15–30% of total_chunks (inclusive). `verdict_reason`: `"Corpus quality is marginal. Consider reviewing .pythiaignore."`
- **HEALTHY:** Everything else. `verdict_reason`: `"Corpus looks good."`

Boundary clarification: `> 60%` is strictly greater than. `40–60%` means `>= 40% AND <= 60%`. At exactly 60%, the result is WARN (not DEGRADED). At exactly 40%, the result is WARN (not HEALTHY). Same logic applies to short chunk percentages.

**Known limitations:** The percentage thresholds are sharp with no hysteresis — a corpus near the 40% or 60% boundary may oscillate between verdict states on successive `pythia init` runs as files change. Additionally, a 1-chunk corpus classified as 100% `module` type returns DEGRADED rather than WARN-empty; no minimum chunk count is required before percentage-based rules apply. These are known v1 behaviors.

**Output (`init.ts`):**
Worker A must print the health summary in **both** code paths:
- **Early-return path** (already initialized, no `--force`): Run the health check immediately before returning. This path exits before `fileChanges` is computed. **UX note:** The health report in this path reflects the existing DB, not the newly-written `.pythiaignore` — FEAT-040 may have just updated the ignore file, but the corpus hasn't been reindexed yet. If the verdict is DEGRADED or WARN, print an additional line after the health summary: `[Pythia] Tip: run \`pythia init --force\` to reindex with the updated .pythiaignore.`
- **Normal path** (init ran): Run after all indexing work completes. This includes the "no files changed" case (`fileChanges.length === 0`).

The summary must NOT be inside the supervisor branch. Recommended implementation: extract the health reporting into a small inline helper and call it in both places.

**Import** (Worker A must add to `init.ts`): `import { computeCorpusHealth } from "../indexer/health.js";`

Worker A must:
1. Open a SECOND db connection: `const healthDb = dependencies.openDbImpl ? dependencies.openDbImpl(dbPath) : openDb(dbPath);`
   (`dbPath` is `path.join(dataDirectory, "lcs.db")`, declared near the top of `runInit`.)
2. Call `computeCorpusHealth(healthDb)` inside a `try/finally` block so `healthDb.close()` is guaranteed even if the health query throws. Do NOT swallow the error — re-throw after closing:
   ```typescript
   let report: CorpusHealthReport;
   try {
     report = computeCorpusHealth(healthDb);
   } finally {
     healthDb.close();
   }
   ```
3. Print the formatted summary to `stdout` in this human-readable format. Format all numeric counts using `Intl.NumberFormat("en-US").format(n)` for locale-independent comma-separated output (do NOT use `.toLocaleString()`):
```
=== Pythia Corpus Health ===
Verdict:    HEALTHY
Reason:     Corpus looks good.
Chunks:     1,432
Files:      87
Avg length: 312 chars
Top paths:  src (940), tests (312), docs (180)
============================
```
   - When `avg_chunk_length_chars` is `null` (total_chunks === 0): print `Avg length: N/A`
   - When `top_path_prefixes` is empty: print `Top paths: (none)`
4. (No separate close call needed — `healthDb.close()` is in the `finally` block above.)

**Note on MCP auto-init:** `initializeRuntimeWithConfig()` in `src/index.ts` runs `runInit()` before the stdio transport connects, so printing to stdout during auto-init does not corrupt the MCP protocol stream. No special casing is required for Sprint 10.

### FEAT-042 — `pythia_corpus_health` MCP tool
**Status:** New implementation required.

**Files:** `src/mcp/corpus-health.ts` (new), `src/mcp/tools.ts` (owned by Worker B)

**Input Schema:** No parameters. Follow the existing raw Zod shape convention in `tools.ts` — use an empty object `{}` as the inputSchema, consistent with how other tools define their schemas (NOT `z.object({})`).

**Handler logic:** The handler receives `db` from the `registerTools()` closure (same as all other tools).

**Output:** Standard MCP tool stringified JSON.
`{ content: [{ type: "text", text: JSON.stringify(report, null, 2) }] }`

**Tool Registration (`src/mcp/tools.ts`):**
Register the tool and wire `createCorpusHealthHandler(db)`.
Update `src/__tests__/mcp-server.test.ts` to assert `pythia_corpus_health` is correctly injected into the alphabetically sorted expected names array (this is an edit to an existing test, not a new test — new tests belong in `corpus-health.test.ts`).

**Export contract for `src/mcp/corpus-health.ts`:**
Must export `createCorpusHealthHandler` (function) and optionally the input schema shape. Worker B depends on `computeCorpusHealth` and `CorpusHealthReport` exported from `src/indexer/health.ts` with those exact names. Import path: `../indexer/health.js` (`.js` extension required for ESM).

### FEAT-043 — Enriched tool descriptions on all existing tools
**Status:** String changes only. ZERO new tests required.

**File:** `src/mcp/tools.ts` (owned by Worker B)

Worker B MUST rewrite the `description` string for all 7 existing tools (`lcs_investigate`, `pythia_force_index`, `spawn_oracle`, `ask_oracle`, `oracle_commit_decision`, `oracle_decommission`, `pythia_api_surface`) AND the new `pythia_corpus_health` tool. Use the exact 4-section template with these exact headers (capitalized, colon-terminated, one section per line, no blank lines between sections):

```text
PURPOSE: Investigate the local code search index for semantic or structural matches.
WHEN TO CALL: Use this first to find relevant code, functions, or files before attempting to read them.
WHAT TO LOOK FOR IN OUTPUT: Review the returned file paths and snippets. Pay attention to edge relationships indicating how components connect.
COMMON MISTAKES TO AVOID: Do not use generic, single-word queries; use full natural language questions or precise symbol names.
```
Worker B must write the remaining 7 descriptions following this structure based on the tool's known behavior. Each section must be ≤ 2 sentences. No bullet points within a section. Prefer 1 sentence per section.

### FEAT-044 — `dtype` config field for local embeddings
**Status:** New implementation required.

**Files:** `src/config.ts`, `src/indexer/embedder.ts`, `src/db/embedding-meta.ts`, `docs/EMBEDDING_TEST_PLAN.md`, `src/cli/init.ts` (owned by Worker C)

**Config Schema (`src/config.ts`):**
In `embeddingsSchema` under `mode: "local"`, add: `dtype: z.enum(["fp32", "q8"]).default("fp32")`

Note: `int8` and `uint8` are NOT included. Only `fp32` and `q8` are verified against `nomic-ai/nomic-embed-text-v1.5` in this codebase. Do not add unverified dtype values.

**Embedder Logic (`src/indexer/embedder.ts`):**
1. Update TS type: `export type EmbeddingsBackendConfig = { mode: "local"; dimensions?: ...; dtype?: "fp32" | "q8" } | ...`
2. Change `pipelinePromise` to a map: `const pipelines = new Map<string, Promise<unknown>>();`
3. Update `getEmbedder(dtype: string = "fp32")`: Check the map by `dtype`. If no entry exists, instantiate the pipeline with `{ dtype }`, store it, and return it. **If the pipeline promise rejects, delete the map entry** (`pipelines.delete(dtype)`) before re-throwing — do not cache rejected promises.
4. Update `localEmbedTexts` and `warmLocalEmbedder` to accept `dtype: string = "fp32"`.
5. In `createEmbedder()` (for `mode === "local"`), pass `config.dtype ?? "fp32"` down into the `embedChunks`, `embedQuery`, and `warm` closures.
6. The standalone exports at the bottom of the file (`embedChunks`, `embedQuery`, `warmEmbedder`) keep their current signatures and internally default to `"fp32"`.

**Important — tensor type verification:** Worker C must verify that the `@huggingface/transformers` pipeline at the installed version returns `Float32Array` data for `dtype: "q8"`. If it returns a different typed array (e.g., `Int8Array`), add an explicit cast to `Float32Array` before passing to `truncateAndNormalize`. Do not ship without confirming this.

**Embedding identity (`src/db/embedding-meta.ts`):**
`configToFingerprint()` currently hardcodes `model_revision: "fp32"`. Worker C must replace that hardcoded string with `config.dtype ?? "fp32"` in the `model_revision` field. `assertEmbeddingMetaCompatible()` already reads `model_revision` for compat checking, so this single field change is sufficient to trigger `FULL_REINDEX_REQUIRED` when `dtype` changes on an existing index.

**Memory Warning (`src/cli/init.ts`):**
Locate the block that begins with `if (filePaths.length > 100)` and writes the large-file warning. Add the dtype warning IMMEDIATELY BEFORE this block:
```typescript
if (config.embeddings.mode === "local" && config.embeddings.dtype === "fp32") {
  const totalMemGB = os.totalmem() / (1024 ** 3); // os is already imported at the top of init.ts
  if (totalMemGB < 16) {
    process.stderr.write(`\n[WARNING] Machine has ${Math.round(totalMemGB)}GB RAM. Using dtype="fp32" may cause high memory pressure. Consider setting dtype="q8" in ~/.pythia/config.json.\n\n`);
  }
}
```

**Test Plan Update:**
Update `docs/EMBEDDING_TEST_PLAN.md` to remove the "Known Gaps / Sprint 10 Items" warning about hardcoded `dtype`.

---

## Worker Partition

| Worker | Files owned | Notes |
|--------|-------------|-------|
| **Worker A** | `src/indexer/health.ts` (new), `src/__tests__/health.test.ts` (new), `src/cli/init.ts` (pythiaignore logic + post-init health printout), `scripts/sprint10-proof.mjs` (new) | Implements DB metrics query and `.pythiaignore` generation (FEAT-040, 041). Creates base proof script with `// --- PHASE 2: Worker B appends here ---` marker at end. Must merge first. |
| **Worker B** | `src/mcp/corpus-health.ts` (new), `src/__tests__/corpus-health.test.ts` (new), `src/mcp/tools.ts` (register new tool, rewrite all 8 descriptions), `src/__tests__/mcp-server.test.ts`, `scripts/sprint10-proof.mjs` (append phase 2 after marker) | Owns MCP registration, agent behavioral instructions, and proof script phase 2. Merges after Worker A. |
| **Worker C** | `src/config.ts`, `src/indexer/embedder.ts`, `src/db/embedding-meta.ts`, `docs/EMBEDDING_TEST_PLAN.md`, `src/__tests__/config.test.ts`, `src/__tests__/embedder.test.ts`, `src/cli/init.ts` (memory warning only) | Owns the `dtype` config pipeline (FEAT-044) including embedding identity. Merges after Worker A. |

**Merge sequence:** A first (mandatory). B and C may merge in either order after A.

---

## Step 0 — Dependency Validation (Pre-Sprint, Claude)

**RESOLVED:**
- No new external NPM dependencies allowed. Standard SQLite aggregations and `fs`/`path` utilities will be used. ✓

---

## Tests Required

| Worker | Test file | Minimum tests |
|--------|-----------|---------------|
| A | `health.test.ts` | ≥ 8 — one per trigger condition: UNINITIALIZED, WARN-empty, WARN-module-threshold (40–60%), WARN-short-threshold (15–30%), DEGRADED-module (>60%), DEGRADED-short (>30%), DEGRADED-suspicious-prefix, HEALTHY |
| B | `corpus-health.test.ts` | ≥ 4 (MCP payload stringify mapping; UNINITIALIZED state — lcs_chunks table does not exist; HEALTHY state round-trip via handler; handler propagates error on corrupted db) |
| C | `config.test.ts` / `embedder.test.ts` | ≥ 4 total (Zod schema: fp32 default accepted; Zod schema: q8 accepted; dtype cache map hit returns cached promise; rejected promise cleared from cache on failure) |

**Gate:** `npm test` must show ≥ 399 total (383 current + ≥ 16 new) before sprint is considered complete.

Note: Editing the expected tool-name array in `mcp-server.test.ts` does NOT count as a new test. New tests must be new `test()` or `it()` blocks.

---

## Files to Create

```
src/indexer/
  health.ts                           ← Worker A

src/mcp/
  corpus-health.ts                    ← Worker B

src/__tests__/
  health.test.ts                      ← Worker A
  corpus-health.test.ts               ← Worker B

scripts/
  sprint10-proof.mjs                  ← Worker A (create), Worker B (extend)
```

## Files to Modify

```
src/cli/init.ts                       ← Worker A (ignores + health DB open) / Worker C (RAM warning)
src/mcp/tools.ts                      ← Worker B (register tool, rewrite descriptions)
src/__tests__/mcp-server.test.ts      ← Worker B (assert 8 tools in alphabetical order)
src/config.ts                         ← Worker C (add dtype to schema)
src/indexer/embedder.ts               ← Worker C (cache map logic, pass dtype to pipeline, EmbeddingsBackendConfig type)
src/db/embedding-meta.ts              ← Worker C (include dtype in configToFingerprint)
docs/EMBEDDING_TEST_PLAN.md           ← Worker C (resolve Known Gaps item)
src/__tests__/config.test.ts          ← Worker C (test dtype schema)
src/__tests__/embedder.test.ts        ← Worker C (test dtype logic)
```

---

## Twin Review Checklist (Pre-Execution)

- [ ] Does Worker A place FEAT-040 logic BEFORE the `alreadyInitialized && !options.force` early return?
- [ ] Does Worker A print health summary in both code paths: early-return (already initialized) AND after indexing (including when fileChanges.length === 0)?
- [ ] Does Worker A end `sprint10-proof.mjs` with the exact marker `// --- PHASE 2: Worker B appends here ---`?
- [ ] Does Worker A accurately open a second `healthDb` via `dependencies.openDbImpl` in `init.ts`?
- [ ] Does Worker A compute `top_path_prefixes` efficiently via `.iterate()` and split on `/`?
- [ ] Does Worker A correctly implement the "union + dedup" logic for `.pythiaignore`?
- [ ] Does Worker A write ≥ 8 tests covering all verdict trigger conditions (including separate DEGRADED tests for module%, short%, and suspicious prefix)?
- [ ] Does Worker B use raw Zod shape convention (not `z.object({})`) for the new tool's inputSchema?
- [ ] Does Worker B's description block rigidly enforce the `PURPOSE`, `WHEN TO CALL`, `WHAT TO LOOK FOR IN OUTPUT`, `COMMON MISTAKES TO AVOID` headers for *all 8 tools*?
- [ ] Does Worker B stringify the output payload correctly into `{ content: [{ type: "text", text: ... }] }`?
- [ ] Does Worker C update `src/db/embedding-meta.ts` to include `dtype` in the local fingerprint?
- [ ] Does Worker C update the `EmbeddingsBackendConfig` TypeScript interface in addition to the Zod schema?
- [ ] Does Worker C verify that `dtype: "q8"` returns `Float32Array` (or adds a cast if not)?
- [ ] Does Worker C clear the pipeline map entry on rejection (no cached rejected promises)?
- [ ] Does Worker C pass `dtype` all the way down through `warmLocalEmbedder` and `localEmbedTexts` while leaving standalone exports defaulting to `"fp32"`?

---

## Completion Criteria

Sprint 10 is done when:
1. `pythia init` gracefully auto-creates or appends a language-specific `.pythiaignore` file (handling union of languages, deduplication, and all three write cases: create/overwrite for missing or zero-byte files; append without trailing newline; append with trailing newline), running on every init regardless of prior initialization.
2. `pythia init` outputs a DB-driven Corpus Health Summary with a verdict status based on `total_chunks`, `chunk_type_distribution`, `short_chunk_count`, and `top_path_prefixes` — in both the early-return path (already initialized) and the normal init path.
3. `pythia init` outputs a low-RAM warning if using `fp32` on `< 16GB` RAM before index work starts.
4. `pythia_corpus_health` is a registered MCP tool returning stringified JSON health stats.
5. All 8 MCP tools feature comprehensive behavioral descriptions using the exact 4-section template.
6. Local embeddings can be switched to `dtype: "q8"` via config, tracked in an isolated cache map, with rejected promises cleared from the cache.
7. Changing `dtype` on an existing local index triggers `FULL_REINDEX_REQUIRED`.
8. `scripts/sprint10-proof.mjs` executes and proves E2E integration successfully (both CLI and MCP phases).
9. `npm test` passes with ≥ 399 tests.
