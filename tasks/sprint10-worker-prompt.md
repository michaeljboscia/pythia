# Sprint 10 Worker Prompt — Corpus Intelligence
**Spec version:** 7.0 (3 rounds of dual-daemon interrogation, 2026-03-13)
**Pythia target version:** 1.4.0
**Current test count:** 383 | **Gate:** ≥ 399

---

## Read These First

Before writing a single line of code:
1. `/Users/mikeboscia/pythia/CLAUDE.md` — your governance layer
2. `/Users/mikeboscia/pythia/LESSONS.md` — mistakes to avoid
3. `/Users/mikeboscia/pythia/progress.txt` — current state
4. This file — your implementation contract

Run `npm test` to confirm you're starting at 383 passing tests.

---

## Sprint Goal

Solve the "noisy corpus" problem. On real-world repos, a missing `.pythiaignore` causes Pythia to index `node_modules/` or build artifacts — OOM crashes, high latency, and terrible retrieval quality. Sprint 10 adds:

- **FEAT-040** — Opinionated `.pythiaignore` auto-generation (runs on every `pythia init`)
- **FEAT-041** — Post-init corpus health summary printed to stdout
- **FEAT-042** — `pythia_corpus_health` MCP tool returning JSON health stats
- **FEAT-043** — Enriched behavioral descriptions for all 8 MCP tools
- **FEAT-044** — `dtype` config field for local ONNX embeddings (fp32/q8)

Language expansion (Swift/Kotlin/Elixir) is **OUT OF SCOPE** for this sprint.

---

## Files to Create

```
src/indexer/health.ts                  ← new (FEAT-041)
src/mcp/corpus-health.ts               ← new (FEAT-042)
src/__tests__/health.test.ts           ← new (≥8 tests)
src/__tests__/corpus-health.test.ts    ← new (≥4 tests)
scripts/sprint10-proof.mjs             ← new (proof script, both phases)
```

## Files to Modify

```
src/cli/init.ts                        ← FEAT-040 (ignores) + FEAT-041 (health) + FEAT-044 (RAM warning)
src/mcp/tools.ts                       ← FEAT-042 (register tool) + FEAT-043 (rewrite descriptions)
src/__tests__/mcp-server.test.ts       ← update expected tool count: 7 → 8
src/config.ts                          ← FEAT-044 (add dtype to schema)
src/indexer/embedder.ts                ← FEAT-044 (cache map, pass dtype)
src/db/embedding-meta.ts               ← FEAT-044 (fingerprint includes dtype)
src/__tests__/config.test.ts           ← FEAT-044 tests (≥2 of the 4 minimum)
src/__tests__/embedder.test.ts         ← FEAT-044 tests (≥2 of the 4 minimum)
docs/EMBEDDING_TEST_PLAN.md            ← remove "Known Gaps / Sprint 10 Items" dtype row
```

---

## Implementation Order

Implement in this order. Each section depends on the previous.

### Step 1 — `src/indexer/health.ts` (FEAT-041)

Create this file. Export exactly these two things:

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

export function computeCorpusHealth(db: Database.Database): CorpusHealthReport
```

**Error handling:** Wrap ALL queries in a single `try/catch`. Catch ONLY SQLite errors whose message includes `"no such table"`. Any other error re-throws. If `lcs_chunks` table is missing, return the UNINITIALIZED report.

**UNINITIALIZED return value:**
```typescript
{
  verdict: "UNINITIALIZED",
  verdict_reason: "Run pythia init first.",
  total_chunks: 0, total_files: 0,
  chunk_type_distribution: [], short_chunk_count: 0,
  avg_chunk_length_chars: null, top_path_prefixes: []
}
```

**SQL queries:**
- `total_chunks`: `SELECT count(*) FROM lcs_chunks WHERE is_deleted = 0`
- `total_files`: `SELECT count(distinct file_path) FROM lcs_chunks WHERE is_deleted = 0`
- `chunk_type_distribution`: `SELECT chunk_type, count(*) as count FROM lcs_chunks WHERE is_deleted = 0 GROUP BY chunk_type`
- `short_chunk_count`: `SELECT count(*) FROM lcs_chunks WHERE length(content) < 100 AND is_deleted = 0`
- `avg_chunk_length_chars`: `SELECT CAST(AVG(length(content)) AS INTEGER) FROM lcs_chunks WHERE is_deleted = 0` — returns `null` when total_chunks === 0 (SQLite AVG over zero rows returns NULL; do NOT coerce to 0)
- `top_path_prefixes`: Use `.iterate()` to avoid V8 memory spikes:

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

**Verdict Logic** (evaluate in order, first match wins):

```typescript
const SUSPICIOUS_PREFIXES = ["node_modules", "dist", "build", "vendor", ".git", "target", "bin", "obj", "__pycache__", ".next", "coverage"];

// 1. UNINITIALIZED — handled in catch above
// 2. WARN (Empty)
if (total_chunks === 0) return { verdict: "WARN", verdict_reason: "No files were indexed. Check your .pythiaignore and workspace path.", ... }
// 3. DEGRADED
const modulePercent = (moduleChunkCount / total_chunks) * 100;
const shortPercent = (short_chunk_count / total_chunks) * 100;
const hasSuspicious = top_path_prefixes.some(p => SUSPICIOUS_PREFIXES.includes(p.prefix));
if (modulePercent > 60 || shortPercent > 30 || hasSuspicious)
  return { verdict: "DEGRADED", verdict_reason: "Corpus contains noise or low-quality chunks. Review .pythiaignore and re-run pythia init.", ... }
// 4. WARN (marginal)
if ((modulePercent >= 40 && modulePercent <= 60) || (shortPercent >= 15 && shortPercent <= 30))
  return { verdict: "WARN", verdict_reason: "Corpus quality is marginal. Consider reviewing .pythiaignore.", ... }
// 5. HEALTHY
return { verdict: "HEALTHY", verdict_reason: "Corpus looks good.", ... }
```

**Boundary rule:** `> 60%` is strictly greater. `40–60%` means `>= 40% AND <= 60%`. At exactly 60%: WARN (not DEGRADED). At exactly 40%: WARN (not HEALTHY).

**Known limitation:** Thresholds are sharp. A corpus near the boundary may oscillate on successive runs. A 1-chunk corpus at 100% module type returns DEGRADED — no minimum chunk count before percentage rules apply. These are known v1 behaviors.

---

### Step 2 — `src/cli/init.ts`: FEAT-040 (.pythiaignore generation)

**Placement:** The ENTIRE FEAT-040 block goes **BEFORE** the `if (alreadyInitialized && !options.force)` early-return guard.

**If `readdirSync` throws:** Catch, print to stderr: `[WARNING] Could not read workspace root: <error message>. Skipping .pythiaignore generation.` Then continue — do NOT abort.

**Detection (use `{ withFileTypes: true }` + `dirent.isFile()` to prevent false-positives from directories named `go.mod` etc.):**
- Node.js: `package.json`
- Python: `requirements.txt` or `pyproject.toml`
- Go: `go.mod`
- Rust: `Cargo.toml`
- Ruby: `Gemfile`
- C#: any file where `dirent.name.endsWith(".csproj")`

**Ignore lines per type:**
- Universal (always): `.git/`, `*.lock`, `*.log`, `coverage/`
- Node.js: `node_modules/`, `dist/`, `dist-test/`, `.next/`, `.nuxt/`, `.turbo/`
- Python: `__pycache__/`, `.venv/`, `venv/`, `site-packages/`, `*.pyc`, `.pytest_cache/`, `dist/`, `build/`
- Go: `vendor/`, `bin/`
- Rust: `target/`
- Ruby: `vendor/bundle/`, `.bundle/`
- C#: `bin/`, `obj/`, `packages/`

**Union + dedup:** Multiple detected languages → collect all lines into a Set. Emit: universal first, then language-specific in detection order.

**Write logic — three cases:**
1. **File does NOT exist, OR exists but is zero bytes** (detect zero bytes with `statSync(ignorePath).size === 0`): Create/overwrite with universal + all detected language lines. Use "new file created" console output.
2. **File exists, has content, does NOT end with `\n`**: Do not overwrite. For each missing line, collect for "recommended additions". Prepend `\n\n# Pythia recommended additions\n` before new lines.
3. **File exists, has content, DOES end with `\n`**: Same as case 2, but prepend `\n# Pythia recommended additions\n` (single blank line).
4. **All lines already present**: Leave file byte-for-byte unchanged.

**Console output order:** When ≥1 marker detected: print detection line FIRST, then file-action line. When no markers found: print ONLY the combined no-markers message (detection line suppressed — they are mutually exclusive).

```
[Pythia] Detected: <comma-separated names>             ← only when markers found
[Pythia] Created .pythiaignore with <N> ignore rules.  ← new file
[Pythia] Appended <N> recommended rules to existing .pythiaignore.  ← append
[Pythia] .pythiaignore is up to date.                  ← no changes
[Pythia] No project markers detected. Created .pythiaignore with universal rules only.  ← no markers (suppresses detection line)
```

---

### Step 3 — `src/cli/init.ts`: FEAT-041 (health summary, both paths)

Add import at top of `init.ts`:
```typescript
import { computeCorpusHealth } from "../indexer/health.js";
```

Health reporting must run in **both** code paths:

**Early-return path** (already initialized, no `--force`): Run health check immediately before `return`. This path exits before `fileChanges` is computed.

**Normal path** (init ran): Run after all indexing work completes, including when `fileChanges.length === 0`.

**Do NOT put the health call inside the supervisor branch.**

**Implementation pattern** (extract an inline helper or call directly in both places):

```typescript
// Open second DB connection
const healthDb = dependencies.openDbImpl ? dependencies.openDbImpl(dbPath) : openDb(dbPath);

let report: CorpusHealthReport;
try {
  report = computeCorpusHealth(healthDb);
} finally {
  healthDb.close();   // guaranteed even if computeCorpusHealth throws
}
// print report — see format below
```

**Output format** (all numeric counts use `Intl.NumberFormat("en-US").format(n)` — NOT `.toLocaleString()`):
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
- `avg_chunk_length_chars === null` → print `Avg length: N/A`
- `top_path_prefixes` empty → print `Top paths: (none)`

**Stale health UX (early-return path only):** If the verdict is DEGRADED or WARN, print after the health summary:
```
[Pythia] Tip: run `pythia init --force` to reindex with the updated .pythiaignore.
```

**MCP auto-init note:** `initializeRuntimeWithConfig()` in `src/index.ts` runs `runInit()` before the stdio transport connects. Printing to stdout during auto-init does NOT corrupt the MCP protocol stream. No special casing needed.

---

### Step 4 — `src/cli/init.ts`: FEAT-044 (RAM warning, dtype)

Locate the block beginning with `if (filePaths.length > 100)` (the large-file warning). Add the dtype memory warning **IMMEDIATELY BEFORE** that block:

```typescript
if (config.embeddings.mode === "local" && config.embeddings.dtype === "fp32") {
  const totalMemGB = os.totalmem() / (1024 ** 3); // os is already imported
  if (totalMemGB < 16) {
    process.stderr.write(`\n[WARNING] Machine has ${Math.round(totalMemGB)}GB RAM. Using dtype="fp32" may cause high memory pressure. Consider setting dtype="q8" in ~/.pythia/config.json.\n\n`);
  }
}
```

---

### Step 5 — `src/config.ts`: FEAT-044 (schema)

In `embeddingsSchema` under `mode: "local"`, add:
```typescript
dtype: z.enum(["fp32", "q8"]).default("fp32")
```

Only `fp32` and `q8` — do not add `int8` or `uint8` (unverified against nomic-embed-text-v1.5).

Update the `EmbeddingsBackendConfig` TypeScript interface to reflect `dtype?: "fp32" | "q8"`.

---

### Step 6 — `src/indexer/embedder.ts`: FEAT-044 (pipeline cache map)

1. Replace `pipelinePromise` module-level singleton with a map:
   ```typescript
   const pipelines = new Map<string, Promise<unknown>>();
   ```

2. Update `getEmbedder(dtype: string = "fp32")`:
   - Check map by `dtype`
   - If no entry: instantiate pipeline with `{ dtype }`, store in map, return it
   - **If the promise rejects: `pipelines.delete(dtype)` before re-throwing** — do not cache rejected promises

3. Update `localEmbedTexts` and `warmLocalEmbedder` to accept `dtype: string = "fp32"`.

4. In `createEmbedder()` for `mode === "local"`: pass `config.dtype ?? "fp32"` into the `embedChunks`, `embedQuery`, and `warm` closures.

5. Standalone exports at the bottom (`embedChunks`, `embedQuery`, `warmEmbedder`) keep current signatures and internally default to `"fp32"`.

**Verify before shipping:** Confirm that `@huggingface/transformers` pipeline returns `Float32Array` for `dtype: "q8"`. If it returns `Int8Array` or similar, add explicit cast to `Float32Array` before passing to `truncateAndNormalize`.

---

### Step 7 — `src/db/embedding-meta.ts`: FEAT-044 (fingerprint)

`configToFingerprint()` currently hardcodes `model_revision: "fp32"`. Replace with:
```typescript
model_revision: config.dtype ?? "fp32"
```

`assertEmbeddingMetaCompatible()` already reads `model_revision` for compat checking (line ~70). This single field change is sufficient to trigger `FULL_REINDEX_REQUIRED` when dtype changes on an existing index.

---

### Step 8 — `src/mcp/corpus-health.ts`: FEAT-042 (MCP handler)

Create this file. Must export:
- `createCorpusHealthHandler` (function)

```typescript
import { computeCorpusHealth } from "../indexer/health.js";  // .js extension required for ESM

export function createCorpusHealthHandler(db: Database.Database) {
  return async () => {
    const report = computeCorpusHealth(db);
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }]
    };
  };
}
```

**Input schema:** No parameters. Use empty object `{}` as inputSchema (NOT `z.object({})`) — follow the raw Zod shape convention used by all other tools in `tools.ts`.

---

### Step 9 — `src/mcp/tools.ts`: FEAT-042 + FEAT-043

**FEAT-042:** Register `pythia_corpus_health` tool. Wire `createCorpusHealthHandler(db)`. Import from `./corpus-health.js`.

**FEAT-043:** Rewrite ALL 8 tool descriptions using this exact 4-section template (headers capitalized, colon-terminated, one section per line, no blank lines between sections, ≤ 2 sentences per section, prefer 1):

```text
PURPOSE: <what the tool does>
WHEN TO CALL: <when the agent should use it>
WHAT TO LOOK FOR IN OUTPUT: <how to interpret results>
COMMON MISTAKES TO AVOID: <what agents get wrong>
```

Apply to: `lcs_investigate`, `pythia_force_index`, `spawn_oracle`, `ask_oracle`, `oracle_commit_decision`, `oracle_decommission`, `pythia_api_surface`, `pythia_corpus_health`.

**`src/__tests__/mcp-server.test.ts`:** Update the expected tool-name array from 7 to 8 tools, adding `pythia_corpus_health` in alphabetically correct position.

---

### Step 10 — `docs/EMBEDDING_TEST_PLAN.md`

Remove the "Known Gaps / Sprint 10 Items" table row for `dtype` being hardcoded. The rest of the table stays.

---

## Tests Required

| File | Minimum | Test cases |
|------|---------|-----------|
| `health.test.ts` | **≥ 8** | UNINITIALIZED (no table), WARN-empty (0 chunks), WARN-module (40–60%), WARN-short (15–30%), DEGRADED-module (>60%), DEGRADED-short (>30%), DEGRADED-suspicious-prefix, HEALTHY |
| `corpus-health.test.ts` | **≥ 4** | MCP payload stringifies correctly; UNINITIALIZED state (no lcs_chunks table); HEALTHY round-trip via handler; handler propagates error on corrupted db |
| `config.test.ts` | **≥ 2 of 4** | Zod schema: fp32 default accepted; Zod schema: q8 accepted |
| `embedder.test.ts` | **≥ 2 of 4** | dtype cache map hit returns cached promise; rejected promise cleared from cache on failure |

**Gate:** `npm test` must show **≥ 399** total tests.

**Note:** Updating the tool-name array in `mcp-server.test.ts` does NOT count as a new test.

---

## Proof of Completion

Implement `scripts/sprint10-proof.mjs`. Runtime: `#!/usr/bin/env node` with `npx tsx` for TypeScript-aware imports. MCP server startup pattern: follow `scripts/smoke-test.mjs` (spawn MCP server as child process, connect via stdio transport, send JSON-RPC `initialize` then `tools/call`).

**Phase 1 (CLI):**
1. Create temp Node.js project using `mkdtempSync(path.join(os.tmpdir(), "pythia-proof-"))` — `package.json` present, no `.pythiaignore`
2. Run `pythia init`
3. Assert `.pythiaignore` was created containing `"node_modules/"`
4. Assert stdout contained `"[Pythia] Detected: Node.js"`
5. Assert stdout contained `"=== Pythia Corpus Health ==="`

End Phase 1 with this exact marker:
```javascript
// --- PHASE 2: corpus-health MCP verification ---
```

**Phase 2 (MCP):**
6. Start MCP server (stdio transport, follow `smoke-test.mjs`), call `pythia_corpus_health`
7. Assert JSON response parses correctly, `verdict` field equals `"WARN"`, and `verdict_reason` matches `"No files were indexed..."`

---

## Completion Criteria

Sprint 10 is done when ALL of these are true:

1. `pythia init` auto-creates or appends a language-specific `.pythiaignore` (union, dedup, all three write cases: create/overwrite for missing/zero-byte; append without trailing newline; append with trailing newline) on every init regardless of prior initialization
2. `pythia init` outputs a DB-driven Corpus Health Summary (`total_chunks`, `chunk_type_distribution`, `short_chunk_count`, `top_path_prefixes`) in both early-return and normal init paths
3. `pythia init` prints low-RAM warning if using fp32 on < 16GB RAM
4. `pythia_corpus_health` is a registered MCP tool returning stringified JSON health stats
5. All 8 MCP tools have behavioral descriptions using the exact 4-section template
6. Local embeddings support `dtype: "q8"` via config, isolated cache map, rejected promises cleared
7. Changing `dtype` on an existing local index triggers `FULL_REINDEX_REQUIRED`
8. `scripts/sprint10-proof.mjs` executes and proves E2E integration (both CLI and MCP phases)
9. `npm test` passes with **≥ 399** tests

---

## Key Constraints (Do Not Violate)

- **No new npm dependencies** — use Node.js built-ins and existing packages only
- **`.js` extension required** on all TypeScript import paths (ESM)
- **`Intl.NumberFormat("en-US").format(n)`** for number formatting — NOT `.toLocaleString()`
- **`statSync(ignorePath).size === 0`** for zero-byte detection
- **`try/finally` for `healthDb.close()`** — guaranteed close even on exception; re-throw, do not swallow
- **`readdirSync(workspaceRoot, { withFileTypes: true })`** + `dirent.isFile()` check to avoid false-positive detection from directories named `go.mod` etc.
- **Detection and no-markers console messages are mutually exclusive** — cannot print both
- **`model_revision: config.dtype ?? "fp32"`** in `configToFingerprint()` — not a new field, replaces the hardcoded `"fp32"` string
- **MCP inputSchema:** empty `{}` raw Zod shape for no-arg tools (NOT `z.object({})`)
- **Pythia v1 is POSIX-only** — `file_path.split("/")` is correct for prefix extraction
- **`avg_chunk_length_chars`**: do NOT coerce SQLite NULL to 0 — keep as `null` in the report

---

*Spec: `/Users/mikeboscia/pythia/design/sprint-10-spec.md` (v7.0)*
*Project governance: `/Users/mikeboscia/pythia/CLAUDE.md`*
