# IMPLEMENTATION PLAN — Pythia Sprint 6 (v1.2.0)
**Spec Reference:** `/Users/mikeboscia/pythia/design/sprint-6-spec.md` (authoritative)
**PRD Reference:** `/Users/mikeboscia/pythia/docs/PRD-v2.md` (FEAT-022 through FEAT-031)
**Baseline plan:** `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md` (Sprints 1–5)
**This plan is written once and does not get modified during execution.**
**Date:** 2026-03-12

---

## Overview

Sprint 6 extends Pythia v1 across three axes. All steps build bottom-up.
No step begins until the previous step's tests pass.

| Step | Focus | Proof |
|---|---|---|
| 6.1 | Language packages + chunker wiring (PHP, XML, SQL, CSS/SCSS) | All 5 language chunkers registered, `chunkFile` dispatches correctly |
| 6.2 | Golden fixtures + language integration tests | All 9 fixture pairs pass |
| 6.3 | Max chunk size enforcement | 2,500-char input produces 3 split chunks at limit 1000 |
| 6.4 | Configurable dimensions + `--force` DDL | `dimensions: 512` → 512d vectors in DB; `--force` drops and rebuilds |
| 6.5 | Parallel embedding workers | `embedding_concurrency: 4` fires 4 concurrent HTTP requests |
| 6.6 | Benchmark CLI | `pythia benchmark --dry-run` prints all queries; full run writes `summary.json` |
| 6.7 | POC matrix script | `--dry-run` prints all backend×dimension×corpus combinations |
| 6.8 | oracle_add_to_corpus batch mode | 3 files → 1 Gemini CLI spawn; manifest updated atomically |
| Proof | Sprint 6 end-to-end | PHP trait chunks, CSS threshold, XML elements, 512d vectors, benchmark output |

---

## Step 6.1 — New Language Packages + Chunker Wiring

**Features:** FEAT-022, FEAT-023, FEAT-024, FEAT-025 (chunker side only — no fixtures yet)

### Files to modify:
- `package.json` — add 4 new tree-sitter grammars
- `src/indexer/chunker-treesitter.ts` — extend language registry + add extractors

### package.json additions:
```json
"tree-sitter-php": "latest",
"tree-sitter-xml": "latest",
"tree-sitter-sql": "latest",
"tree-sitter-css": "latest"
```

### chunker-treesitter.ts changes:

**Language registry** (extend existing map):
```typescript
".php":   { parser: PHP,  strategy: "php"  },
".phtml": { parser: PHP,  strategy: "phtml" },
".xml":   { parser: XML,  strategy: "xml"  },
".sql":   { parser: SQL,  strategy: "module" },
".css":   { parser: CSS,  strategy: "css"  },
".scss":  { parser: CSS,  strategy: "scss" },
```

**New chunk types to register** (add to CNI type union):
`"trait" | "mixin" | "at_rule" | "rule" | "element"`

**New extractor functions to implement:**
- `extractPhpChunks(tree, filePath, config)` — class, trait, interface, function, method (including magic methods), module
- `extractPhtmlChunks(tree, filePath)` — single module chunk only
- `extractXmlChunks(tree, filePath, config)` — Magento-aware: di.xml by basename, layout XML by directory regex, fallback module
- `extractCssChunks(tree, filePath, config)` — rule (threshold gated), at_rule, mixin (SCSS), function (SCSS), module
- SQL is handled by existing `module`-only path — no new extractor needed

**PHP method extraction:** `extractMethodChunks` currently walks `method_definition` (JS/TS). PHP uses `method_declaration`. Add `method_declaration` to the node-type switch.

**XML attribute extraction:** Use AST `Attribute` child nodes under `STag` — not regex on raw text.

**CSS threshold:** Read `config.indexing.css_rule_chunk_min_chars` (default 80). Rulesets with content length below threshold → do not emit `rule` chunk (content folds into `module`).

### Tests to write:
- [ ] PHP language registered for `.php` and `.phtml` extensions
- [ ] XML language registered for `.xml`
- [ ] CSS language registered for `.css` and `.scss`
- [ ] SQL language registered for `.sql`
- [ ] `chunkFile("example.phtml", ...)` returns exactly 1 module chunk
- [ ] `chunkFile("example.sql", ...)` returns exactly 1 module chunk
- [ ] `chunkFile` on unknown `.xyz` extension returns module-only fallback (existing behavior preserved)

---

## Step 6.2 — Golden Fixtures + Language Integration Tests

**Features:** FEAT-022, FEAT-023, FEAT-024, FEAT-025 (test side)

### Files to create:
```
tests/fixtures/
├── php/
│   ├── input.php               ← class + function + namespace + magic method
│   ├── expected-chunks.json
│   ├── input-trait.php         ← trait declaration with methods
│   ├── expected-chunks.json    (in trait/ subfolder or as input-trait-expected.json)
│   ├── input.phtml             ← mixed PHP+HTML template
│   └── expected-phtml-chunks.json
├── xml/
│   ├── di.xml                  ← preference + type + virtualType + plugin nodes
│   ├── expected-chunks.json
│   ├── layout.xml              ← block + referenceBlock + referenceContainer
│   ├── expected-chunks.json
│   ├── generic.xml             ← non-Magento XML → single module chunk
│   └── expected-chunks.json
├── sql/
│   ├── input.sql               ← CREATE TABLE + INSERT statements
│   └── expected-chunks.json
├── css/
│   ├── input.css               ← mix of short Tailwind-style rules + real selectors + @media
│   └── expected-chunks.json
└── scss/
    ├── input.scss              ← @mixin + @function + nested selectors + @media
    └── expected-chunks.json
```

### Test file to create:
- `src/__tests__/chunker-languages.test.ts` — fixture runner: for each fixture pair, call `chunkFile()` and deep-equal against `expected-chunks.json`

### Tests to write:
- [ ] PHP: `module` + `class` + `function` + `method` chunks present
- [ ] PHP: `__construct` gets its own `method` chunk
- [ ] PHP: trait declaration emits `chunk_type: "trait"`, not `"class"`
- [ ] PHP: `.phtml` emits exactly 1 `module` chunk
- [ ] XML: `di.xml` → `element` chunks for `preference`, `type`, `virtualType`
- [ ] XML: layout XML → `element` chunks for `block`, `referenceBlock`, `referenceContainer`
- [ ] XML: generic XML → 1 `module` chunk only
- [ ] XML: malformed XML (ERROR at root) → 1 `module` chunk (no partial semantic chunks)
- [ ] CSS: short rules (< 80 chars) do NOT produce `rule` chunks
- [ ] CSS: real selectors (>= 80 chars) produce `rule` chunks
- [ ] CSS: `@media` blocks → `at_rule` chunks
- [ ] SCSS: `@mixin` → `mixin` chunks
- [ ] SCSS: `@function` → `function` chunks
- [ ] SQL: exactly 1 `module` chunk

---

## Step 6.3 — Max Chunk Size Enforcement

**Feature:** FEAT-029

### Files to create:
- `src/indexer/chunk-splitter.ts` — standalone splitter module

### Files to modify:
- `src/config.ts` — add `max_chunk_chars` (per-type map) and `oversize_strategy` to indexing schema
- `src/indexer/chunker-treesitter.ts` — call `splitOversizedChunks()` as post-extraction pass

### chunk-splitter.ts implementation:
```typescript
export function splitOversizedChunks(
  chunks: Chunk[],
  maxChunkChars: Record<string, number>,
  strategy: "split" | "truncate"
): Chunk[]
```
- For each chunk: if `content.length > maxChunkChars[chunk_type]`, apply strategy
- `split`: divide at newline boundaries, emit `#part1`, `#part2` suffixes in chunk ID
- `truncate`: hard-truncate at limit + append `\n...[TRUNCATED]`
- ID ordering: symbol-duplicate suffix first, then split: `::function::render#L42#part2`
- Chunk extraction order: structural chunks extracted FIRST, then oversize pass runs

### config.ts additions:
```typescript
max_chunk_chars: z.record(z.string(), z.number().int().min(200).max(100000))
  .default({ module: 12000, class: 8000, function: 6000, method: 4000,
             trait: 6000, interface: 6000, rule: 2000, at_rule: 4000,
             element: 4000, doc: 12000 }),
oversize_strategy: z.enum(["split", "truncate"]).default("split"),
```

### Tests to write:
- [ ] 2,500-char input with `max_chunk_chars.function: 1000` → 3 split chunks with `#part1`, `#part2`, `#part3`
- [ ] Split chunk IDs follow `#L<line>#part<N>` ordering when disambiguation suffix also present
- [ ] `oversize_strategy: "truncate"` → content truncated, `[TRUNCATED]` appended, no split chunks
- [ ] Chunks below their type's limit are unaffected
- [ ] Chunk type missing from `max_chunk_chars` map → no splitting (passthrough)

---

## Step 6.4 — Configurable Embedding Dimensions + `--force` DDL

**Feature:** FEAT-026

### Files to modify:
- `src/config.ts` — add `dimensions` to embeddings schema
- `src/indexer/embedder.ts` — use configured dimensions in all 3 backends
- `src/db/embedding-meta.ts` — include `dimensions` in fingerprint; `assertEmbeddingMetaCompatible` checks dim mismatch
- `src/cli/init.ts` — implement `--force` flag with 7-step DDL

### config.ts addition:
```typescript
embeddings: z.object({
  mode: z.enum(["local", "openai_compatible", "vertex_ai"]),
  dimensions: z.enum([128, 256, 512, 768, 1024, 1536]).default(256),
  // ... existing fields
})
```

### embedder.ts changes:
- `truncateAndNormalize()`: replace hardcoded `256` with `config.embeddings.dimensions`
- `vertexEmbedTexts()`: replace hardcoded `outputDimensionality: 256` with configured dim
- `httpEmbedTexts()`: replace `.slice(0, 256)` with configured dim
- Startup validation: `local` mode + `dimensions > 768` → throw with message from spec

### embedding-meta.ts changes:
- `writeEmbeddingMetaOnce`: persist `dimensions` in the row
- `assertEmbeddingMetaCompatible`: add dimension mismatch check → `FULL_REINDEX_REQUIRED`

### init.ts --force implementation:
```typescript
// 7-step DDL (exact order from spec §FEAT-026):
db.exec(`DROP VIRTUAL TABLE IF EXISTS vec_lcs_chunks`);
db.exec(`DELETE FROM embedding_meta WHERE id = 1`);
db.exec(`DELETE FROM file_scan_cache`);
db.exec(`DELETE FROM lcs_chunks`);
db.exec(`DELETE FROM graph_edges WHERE edge_type IN ('CALLS','IMPORTS','CONTAINS','DEFINES')`);
db.exec(`CREATE VIRTUAL TABLE vec_lcs_chunks USING vec0(embedding float[${dim}])`);
await scanWorkspace(workspaceRoot, db, { forceReindex: true });
```
**Note:** `forceReindex: true` path already exists in `src/indexer/cdc.ts` — no changes needed there.

### Tests to write:
- [ ] `dimensions: 512` with `vertex_ai` → `outputDimensionality: 512` in request body
- [ ] `dimensions: 900` → `ZodError` at config load (not in enum)
- [ ] `dimensions: 1024` with `local` mode → startup error (exceeds 768)
- [ ] Warm-up returns wrong dim → `DIMENSION_MISMATCH` error thrown
- [ ] `--force` on a populated DB: `vec_lcs_chunks` dropped and recreated with new width
- [ ] `embedding_meta` row deleted before `--force` reindex so new config fingerprint written cleanly
- [ ] Update `src/__tests__/embedding-meta.test.ts` — add dimension field assertions
- [ ] Update `src/__tests__/embedder-factory.test.ts` — add dimension validation scenarios

---

## Step 6.5 — Parallel Embedding Workers

**Feature:** FEAT-027

### Dependencies to add:
- `p-limit` (ESM-compatible concurrency limiter)

### Files to modify:
- `package.json` — add `p-limit`
- `src/config.ts` — add concurrency/batch/retry fields to indexing schema
- `src/indexer/embedder.ts` — add `p-limit` concurrency, sub-batch caching, Retry-After parsing

### config.ts additions (indexing schema):
```typescript
embedding_concurrency: z.number().int().min(1).max(16).default(1),
embedding_batch_size:  z.number().int().min(1).max(256).default(32),
retry_max_attempts:    z.number().int().min(1).max(10).default(3),
initial_backoff_ms:    z.number().int().min(100).max(30000).default(500),
honor_retry_after:     z.boolean().default(true),
```

### embedder.ts changes:
- Wrap HTTP calls in `p-limit(config.indexing.embedding_concurrency)`
- Add `parseRetryAfter(raw: string | null): number | null` (seconds format + HTTP date format)
- Exponential backoff: `initial_backoff_ms * 2^attempt`, cap 30,000ms
- Sub-batch caching: successful embedding batches held in memory during a file's embedding attempt; discarded only if the file transaction rolls back
- Local backend: clamp `embedding_concurrency` to 1, emit one-time startup warning

### Tests to write:
- [ ] `embedding_concurrency: 4` → 4 concurrent HTTP requests in flight (use a fake HTTP server)
- [ ] `embedding_batch_size: 32` → each request body contains ≤ 32 texts
- [ ] 429 response → exponential backoff; second attempt fires after ≥ `initial_backoff_ms`
- [ ] `honor_retry_after: true` → `Retry-After: 5` header → waits ~5000ms before retry
- [ ] `honor_retry_after: true` → `Retry-After: <HTTP-date>` → parses correctly
- [ ] File-level atomic failure: a file whose last batch fails → nothing written to DB for that file
- [ ] Local backend: `embedding_concurrency: 4` → clamped to 1, warning emitted once

---

## Step 6.6 — Benchmark CLI

**Feature:** FEAT-028

### Files to create:
- `src/benchmark/runner.ts` — metric computation (P@k, MRR, NDCG@10)
- `src/benchmark/report.ts` — JSON + Markdown output writers
- `src/cli/benchmark.ts` — commander command implementation

### Files to modify:
- `src/cli/main.ts` — register `benchmark` subcommand

### benchmark.ts CLI flags:
```
pythia benchmark
  [--workspace <path>]
  [--queries <yaml>]
  [--set-baseline]
  [--baseline <run_id>]
  [--output <dir>]
```

### runner.ts implementation:
- Discovers `.pythia/lcs.db` by walking up from `cwd` (or `--workspace`)
- Calls internal `search()` function directly — not MCP transport
- Reads query YAML, computes P@1, P@3, P@5, MRR, NDCG@10 per query
- Flags `zero_results: true` for queries returning nothing (not counted as 0.0 MRR)
- Flags `missing_labels_in_index: true` for CNIs absent from DB
- Breaks metrics down by `difficulty`

### report.ts:
- Writes `benchmarks/results/<run_id>/config.json`
- Writes `benchmarks/results/<run_id>/summary.json` (schema per spec FEAT-028)
- Writes `benchmarks/results/<run_id>/queries.jsonl`
- Writes `benchmarks/results/<run_id>/summary.md` (human-readable)

### Baseline logic:
- `--set-baseline`: writes `benchmarks/baseline.json` only if `missing_label_queries === 0` AND `zero_result_queries / total < 0.2`
- Subsequent runs auto-diff against `benchmarks/baseline.json` when present

### Tests to write:
- [ ] `runner.ts`: P@1 = 1.0 when first result is relevant chunk
- [ ] `runner.ts`: MRR = 0.5 when relevant chunk is at rank 2
- [ ] `runner.ts`: NDCG@10 computed correctly for simple case
- [ ] `runner.ts`: zero-result query flagged, excluded from MRR aggregate
- [ ] `benchmark.ts`: `--dry-run` not applicable (no dry-run flag) — verify query YAML validation
- [ ] `--set-baseline` writes `benchmarks/baseline.json`
- [ ] `--set-baseline` refused when `zero_result_queries / total >= 0.2`
- [ ] Baseline diff computed and included in `summary.json` when `baseline.json` exists

---

## Step 6.7 — POC Matrix Script

**Feature:** FEAT-030

### Files to create:
- `scripts/poc-matrix.sh` — thin bash wrapper that delegates to poc-matrix.mjs
- `scripts/poc-matrix.mjs` — Node.js driver (ESM, no build step required)

### poc-matrix.mjs implementation:
**Flags:** `--resume`, `--dry-run`, `--only <selector>`

**Matrix:**
```javascript
const backends = ["local", "ollama", "vertex_ai", "voyage"];
const dimensions = [128, 256, 512, 768];  // filter per backend capability
const corpora = ["pythia", "hyva", "luma"];
```

**Per combination:**
1. Write `~/.pythia/config.json` with backend + dimensions
2. `pythia init --force` (child_process.execSync)
3. `pythia benchmark` (child_process.execSync)
4. Write results to `benchmarks/results/<backend>_<dim>_<corpus>/`

**Crash safety:**
- `--resume`: check for `benchmarks/results/<combo>/summary.json` existence; skip if present
- Each combination is fully independent

**Path safety:** All paths constructed via `path.join()` — no shell interpolation of corpus paths.

### Tests to write:
- None required — manual research tool, not part of CI

---

## Step 6.8 — oracle_add_to_corpus Batch Mode

**Feature:** FEAT-031

⚠️ **SEPARATE CODEBASE:** This feature lives in the inter-agent MCP server, NOT in the Pythia LCS repo.

**File to modify:** `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`

### Changes:
**Tool signature change:**
```typescript
// Before:
oracle_add_to_corpus({ oracle_id: string, file: string, type?: "doc"|"source"|"config" })

// After:
oracle_add_to_corpus({ oracle_id: string, files: string | string[], type?: "doc"|"source"|"config" })
```

**Batch injection flow** (as per spec FEAT-031):
1. Normalize `files` input: `string` → `[string]`
2. Resolve and read all file paths
3. Estimate corpus token budget; warn if > 1,500,000 chars
4. Detect source code extensions; warn if not `type: "source"` override
5. Manifest update — atomic with file lock:
   - Acquire lock on `manifest.json` (lockfile pattern)
   - Read manifest under lock
   - Merge new entries
   - Write to `manifest.tmp.json`, then `fs.rename` → `manifest.json`
   - Release lock
6. If active pool members: deliver all content in ONE `ask_daemon` call using XML delimiters:
   ```
   <<<FILE path="/abs/path/to/a.md">>>
   [content]
   <<<END_FILE>>>
   ```
7. Return `{ added: N, warned: M, corpus_total_chars: X }`

**Backward compatibility:** `files: "path/to/file.md"` (string) works identically to old `file: "..."` API.

### Tests to write:
- [ ] `files: ["a.md", "b.md", "c.md"]` → exactly 1 `ask_daemon` call (not 3)
- [ ] `files: "single.md"` → same manifest state as old single-file API
- [ ] Source code extension → warning in response, not error
- [ ] Corpus > 1.5M chars → `CORPUS_SIZE_WARNING` in response
- [ ] Manifest updated atomically (concurrent calls don't interleave entries)
- [ ] Existing tests in `test-phase4.mjs` still pass

---

## Sprint 6 Proof Script

**File to create:** `scripts/sprint-6-proof.mjs`

**Proof sequence:**

### Proof 1 — PHP trait chunks
```
Index tests/fixtures/php/input-trait.php
Assert: chunk_type "trait" exists in DB
Assert: trait method chunks present with ::trait::TraitName::method::methodName CNI
```

### Proof 2 — CSS Tailwind threshold
```
Index a CSS file containing 3 short utility rules + 2 real selectors
Assert: 2 "rule" chunks (for real selectors)
Assert: short rules NOT in lcs_chunks as separate rows (folded into module)
```

### Proof 3 — XML di.xml element chunks
```
Index tests/fixtures/xml/di.xml
Assert: chunk_type "element" chunks with element names present
Assert: module chunk also present
```

### Proof 4 — 512d vectors
```
Config: { embeddings: { mode: "vertex_ai", dimensions: 512 } }
Run pythia init --force (against a test workspace)
Query vec_lcs_chunks → vector length = 512
Assert: embedding_meta.dimensions = 512
```

### Proof 5 — Benchmark output
```
pythia benchmark --queries scripts/sprint-6-proof-queries.yaml --workspace <test_workspace>
Assert: benchmarks/results/<run_id>/summary.json exists
Assert: summary.json contains precision_at_1, mrr, ndcg_at_10 fields
Assert: summary.md exists and is non-empty
```

### Proof 6 — oracle batch (1 spawn for 3 files)
```
oracle_add_to_corpus({ oracle_id: "...", files: ["a.md", "b.md", "c.md"] })
Assert: manifest contains 3 entries
Assert: Gemini CLI spawned exactly once (verify via process spawn count)
```

### Proof 7 — All tests
```bash
npm test
```
All tests pass. No regressions from Sprints 1–5.

---

## Files Summary

### New files (Pythia LCS repo):
```
src/indexer/chunk-splitter.ts
src/benchmark/runner.ts
src/benchmark/report.ts
src/cli/benchmark.ts
scripts/poc-matrix.sh
scripts/poc-matrix.mjs
scripts/sprint-6-proof.mjs
scripts/sprint-6-proof-queries.yaml
tests/fixtures/php/input.php
tests/fixtures/php/expected-chunks.json
tests/fixtures/php/input-trait.php
tests/fixtures/php/expected-trait-chunks.json
tests/fixtures/php/input.phtml
tests/fixtures/php/expected-phtml-chunks.json
tests/fixtures/xml/di.xml
tests/fixtures/xml/expected-di-chunks.json
tests/fixtures/xml/layout.xml
tests/fixtures/xml/expected-layout-chunks.json
tests/fixtures/xml/generic.xml
tests/fixtures/xml/expected-generic-chunks.json
tests/fixtures/sql/input.sql
tests/fixtures/sql/expected-chunks.json
tests/fixtures/css/input.css
tests/fixtures/css/expected-chunks.json
tests/fixtures/scss/input.scss
tests/fixtures/scss/expected-chunks.json
src/__tests__/chunker-languages.test.ts
src/__tests__/chunk-splitter.test.ts
src/__tests__/benchmark-runner.test.ts
```

### Modified files (Pythia LCS repo):
```
package.json                          (+ tree-sitter-php/xml/sql/css, p-limit)
src/config.ts                         (+ dimensions, concurrency, max_chunk_chars, etc.)
src/indexer/chunker-treesitter.ts     (+ 5 language extractors)
src/indexer/embedder.ts               (+ configured dims, p-limit, Retry-After)
src/db/embedding-meta.ts              (+ dimensions in fingerprint)
src/cli/init.ts                       (+ --force DDL)
src/cli/main.ts                       (+ benchmark command)
src/__tests__/embedding-meta.test.ts  (+ dimension assertions)
src/__tests__/embedder-factory.test.ts (+ dimension + concurrency tests)
```

### Modified files (inter-agent MCP server — separate codebase):
```
~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts   (FEAT-031 batch mode)
```
