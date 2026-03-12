# Pythia Sprint 6 Spec — v1.2.0

**Status:** FINAL — ready for Codex implementation
**Version bump:** `1.0.0` → `1.2.0`
**Date:** 2026-03-12
**Design doc:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md` (authoritative baseline)

---

## Overview

Sprint 6 extends Pythia across three axes:

1. **Language breadth** — 5 new languages covering the Magento/PHP/Flux competitive analysis corpus
2. **Embedding flexibility** — configurable dimensions + parallel HTTP workers + proper rate limiting
3. **Retrieval validation** — benchmark CLI + POC matrix script to measure retrieval quality across model/dimension combinations

Target corpus for validation:
- **Pythia itself:** `/Users/mikeboscia/pythia`
- **Hyva** (PHP + Tailwind + Alpine): OneDrive `/overlandcamping.net`
- **Flux** (React/Next.js): OneDrive `/flux docs/react-next-flux-demo-master@166d61be1ca 2`
- **Luma** (Magento 2 standard): `/Users/mikeboscia/projects/luma-theme`

---

## Features

### FEAT-022 — New Language Support: PHP

**Languages added:** PHP (`.php`, `.phtml`)
**Tree-sitter package:** `tree-sitter-php`

**Chunk types emitted:**
- `function` — top-level `function_definition` nodes
- `class` — `class_declaration` nodes
- `trait` — `trait_declaration` nodes (**new CNI type**)
- `interface` — `interface_declaration` nodes
- `method` — `method_declaration` inside classes and traits (including magic methods: `__construct`, `__get`, `__set`, `__call`, `__toString`, etc.)
- `module` — whole-file fallback (always emitted; also sole chunk type for `.phtml` files)

**CNI format:**
- `src/Foo.php::class::ClassName`
- `src/Foo.php::trait::TraitName`
- `src/Foo.php::trait::TraitName::method::methodName`
- `src/Foo.php::class::ClassName::method::__construct`

**PHP namespace handling:**
Namespace declarations are NOT extracted as separate chunks. The namespace string appears in the `module` chunk content and in all child chunk IDs implicitly via file path. Backslashes in `Vendor\Package` do not conflict with the `::` delimiter.

**PHP `use TraitName;` statements:**
Not extracted as separate chunks. They remain in the parent class/trait chunk content only.

**`.phtml` files:**
Emit one `module` chunk containing the full mixed PHP+HTML content. No structural extraction (too brittle for template PHP).

**Acceptance criteria:**
- [ ] `chunkFile("Foo.php", ...)` emits `module` + `class` + `trait` + `function` + `method` chunks
- [ ] Magic method `__construct` gets its own `method` chunk
- [ ] Trait declarations emit `chunk_type: "trait"`, not `"class"`
- [ ] `.phtml` emits exactly one `module` chunk
- [ ] Golden fixture: `tests/fixtures/php/input.php` + `expected-chunks.json`
- [ ] Golden fixture: `tests/fixtures/php/input.phtml` + `expected-chunks.json`
- [ ] Builds and chunks correctly on macOS arm64 AND linux/amd64 (CI matrix required)

---

### FEAT-023 — New Language Support: XML

**Languages added:** XML (`.xml`)
**Tree-sitter package:** `tree-sitter-xml`

**Chunk strategy:**
Magento-aware structural extraction for high-value file patterns. Generic XML falls back to a single `module` chunk.

**File identification:**
- `di.xml` — matched by filename only: `path.basename(filePath) === "di.xml"`
- Layout XML — matched by directory pattern: `/view/(frontend|adminhtml|base)/layout/*.xml`
- All other XML — single `module` chunk

**For matched Magento files — recursive descent (no depth limit):**
Attribute values extracted from AST node children (not regex). `tree-sitter-xml` exposes `Attribute` nodes under `STag`; walk them to extract `name="..."` values.

| File pattern | Node type | CNI example |
|---|---|---|
| `di.xml` | `<preference ...>` | `...::element::preference[Vendor\Foo\Api]` |
| `di.xml` | `<type name="...">` | `...::element::type[Vendor\Foo\Bar]` |
| `di.xml` | `<virtualType name="...">` | `...::element::virtualType[VirtualFoo]` |
| `di.xml` | `<plugin name="...">` | `...::element::plugin[pluginName]` |
| Layout XML | `<block name="...">` | `...::element::block[header.links]` |
| Layout XML | `<referenceBlock name="...">` | `...::element::referenceBlock[header.links]` |
| Layout XML | `<referenceContainer name="...">` | `...::element::referenceContainer[content]` |

**Malformed XML (ERROR nodes at root):** Fall back to single `module` chunk. Do not emit partial semantic chunks from a broken tree.

**Acceptance criteria:**
- [ ] `di.xml` files emit named `element` chunks for `<preference>`, `<type>`, `<virtualType>`
- [ ] Layout XML files emit named `element` chunks for `<block>`, `<referenceBlock>`, `<referenceContainer>`
- [ ] Unknown XML files emit a single `module` chunk
- [ ] Golden fixture: `tests/fixtures/xml/di.xml` + `expected-chunks.json`
- [ ] Golden fixture: `tests/fixtures/xml/layout.xml` + `expected-chunks.json`

---

### FEAT-024 — New Language Support: SQL

**Languages added:** SQL (`.sql`)
**Tree-sitter package:** `tree-sitter-sql`

**Dialect:** Lowest-common-denominator ANSI SQL. No dialect-specific node extraction (CTEs, JSON operators, window functions parsed as generic expressions or module fallback). No `sql.dialect` config field in v1.

**Chunk strategy:** One `module` chunk per `.sql` file. No structural extraction in Sprint 6 (function/procedure extraction is Sprint 7 scope).

**Value:** Magento data patches, schema migration files, stored procedures. Enables "find where this table is defined" queries across the backend.

**Acceptance criteria:**
- [ ] `.sql` files are indexed (not silently dropped)
- [ ] Each `.sql` file emits exactly one `module` chunk
- [ ] Golden fixture: `tests/fixtures/sql/input.sql` + `expected-chunks.json`

---

### FEAT-025 — New Language Support: CSS + SCSS

**Languages added:** CSS (`.css`), SCSS (`.scss`)
**Tree-sitter packages:** `tree-sitter-css` (handles both via grammar variants)

**Chunk strategy:** Structural — maximize retrieval quality, with a minimum size threshold to prevent Tailwind JIT utility-class explosion.

- Whole file → `module` chunk (always emitted)
- Top-level selector ruleset → `rule` chunk IF content >= `css_rule_chunk_min_chars`; otherwise collapsed into `module`
- `@media`, `@supports`, `@keyframes`, `@layer`, `@import`, `@use`, `@forward` → `at_rule` chunk (always, no size threshold)
- SCSS `@mixin` → `mixin` chunk
- SCSS `@function` → `function` chunk
- Nested selectors (SCSS): recursive descent; compound selector as chunk ID (`.parent .child`)

**Config field:**
```
indexing.css_rule_chunk_min_chars: z.number().int().min(0).default(80)
```
At default 80 chars, `.mt-4 { margin-top: 1rem; }` (28 chars) collapses into module. `.header-navigation { display: flex; align-items: center; padding: 1rem 2rem; }` (80+ chars) gets its own chunk.

**Less:** Dropped. Not in the target corpus. Sprint 7 if needed.

**Acceptance criteria:**
- [ ] CSS file emits `module` + `rule` chunks per top-level ruleset
- [ ] SCSS file emits `module` + `rule` + `at_rule` + `mixin` + `function` chunks
- [ ] `@media` blocks emit as `at_rule` chunks
- [ ] Golden fixture: `tests/fixtures/css/input.css` + `expected-chunks.json`
- [ ] Golden fixture: `tests/fixtures/scss/input.scss` + `expected-chunks.json`
- [ ] Builds on macOS arm64 AND linux/amd64 (CI matrix)

**Deferred to Sprint 7:** Less, Vue, Ruby, C#, Kotlin, Swift, Dart, Scala, Elixir, Haskell.

---

### FEAT-026 — Configurable Embedding Dimensions

**Config schema addition:**
```json
{
  "embeddings": {
    "mode": "local | openai_compatible | vertex_ai",
    "dimensions": 256
  }
}
```

**Valid values:** `z.enum([128, 256, 512, 768, 1024, 1536]).default(256)`

**Per-backend behavior:**

| Backend | Behavior |
|---|---|
| `local` (ONNX nomic) | Validates `dimensions <= 768` at config load. Slices first N dims of 768d output + L2 normalizes. |
| `openai_compatible` | Requests full vector from API, slices to `dimensions` client-side + L2 normalizes. |
| `vertex_ai` | Passes `outputDimensionality: dimensions` directly in API request body (server-side truncation). |

**Validation:**
- Config load: `dimensions` out of enum → `ZodError` at startup
- `local` mode: `dimensions > 768` → startup error: `"nomic-embed-text-v1.5 max output is 768d. Set dimensions ≤ 768 or switch to openai_compatible/vertex_ai mode."`
- Warm-up call: embedder returns vector shorter than configured dimensions → `DIMENSION_MISMATCH` error: `"Model returned Nd but dimensions: Xd is configured. Lower dimensions or use a higher-dimensional model."`

**Schema migration:**
`vec_lcs_chunks` is a fixed-width virtual table (`float[256]` in migration `001`). When dimensions change, the table must be rebuilt.

- **`pythia init --force`** executes runtime DDL in this exact order:
  1. `DROP VIRTUAL TABLE IF EXISTS vec_lcs_chunks` — destroy old vectors
  2. `DELETE FROM embedding_meta WHERE id = 1` — clear fingerprint so new config writes cleanly
  3. `DELETE FROM file_scan_cache` — force CDC to treat every file as new (prevents orphaned lcs_chunks rows with no vectors)
  4. `DELETE FROM lcs_chunks` — remove stale chunk rows
  5. `DELETE FROM graph_edges WHERE edge_type IN ('CALLS', 'IMPORTS', 'CONTAINS', 'DEFINES')` — clear derived code edges; oracle/MADR edges preserved
  6. Recreates `vec_lcs_chunks` with new `float[N]` width
  7. Calls `scanWorkspace(workspaceRoot, db, forceReindex: true)` — existing force path in `cdc.ts`
- `--force` is NOT a numbered migration — uses imperative SQL in code
- **Implementation note:** `forceReindex=true` scan path already exists in `cdc.ts` — wiring is the only work needed

**Stale server state after `--force`:**
Running MCP server caches `embedding_meta` at startup. If `--force` runs in a separate terminal without server restart, the next `lcs_investigate` call re-runs `assertEmbeddingMetaCompatible()` at tool entry and returns `FULL_REINDEX_REQUIRED` prompting the user to restart.

**`FULL_REINDEX_REQUIRED` check:**
Fires at two points:
1. Server startup (`initializeRuntimeWithConfig`)
2. MCP client connection (upgrade safety net)

**`embedding_meta` on force:**
`writeEmbeddingMetaOnce` uses `INSERT OR IGNORE` — will not update an existing row. `--force` explicitly deletes the row first before reindex.

**Acceptance criteria:**
- [ ] `dimensions: 512` with `vertex_ai` passes `outputDimensionality: 512` to API
- [ ] `dimensions: 900` fails at config load with clear error
- [ ] `dimensions > 768` with `local` mode fails at startup
- [ ] Warm-up detects mismatch and throws `DIMENSION_MISMATCH`
- [ ] `pythia init --force` drops + recreates `vec_lcs_chunks` with correct width
- [ ] `embedding_meta` row is deleted before `--force` reindex so new config is written
- [ ] Tests: `embedding-meta.test.ts` updated for `--force` flow
- [ ] Tests: `embedder-factory.test.ts` updated for dimension validation

---

### FEAT-027 — Parallel Embedding Workers

**Config schema addition:**
```json
{
  "indexing": {
    "embedding_concurrency": 1,
    "embedding_batch_size": 32,
    "retry_max_attempts": 3,
    "initial_backoff_ms": 500,
    "honor_retry_after": true
  }
}
```

**Schema:**
```
embedding_concurrency: z.number().int().min(1).max(16).default(1)
embedding_batch_size:  z.number().int().min(1).max(256).default(32)
retry_max_attempts:    z.number().int().min(1).max(10).default(3)
initial_backoff_ms:    z.number().int().min(100).max(30000).default(500)
honor_retry_after:     z.boolean().default(true)
```

**Parallelism model:**
- Unit of concurrency: HTTP requests (not files)
- `embedding_concurrency: 4` = 4 concurrent HTTP calls in flight simultaneously
- Each HTTP call contains up to `embedding_batch_size` texts
- `p-limit` governs the concurrency cap

**Rate limiting + 429 handling:**
- On 429: exponential backoff starting at `initial_backoff_ms`, doubling per attempt, cap at 30s
- If `honor_retry_after: true` and the API returns a `Retry-After` header, use that value instead
- After `retry_max_attempts` exhausted: fail the batch

**Failure semantics:**
- Atomic per file: if any embedding sub-batch for a file fails after all retries, write nothing for that file; Worker Thread marks it failed and continues
- Successful sub-batches within a single file attempt are cached in memory. If batch 1 (32 chunks) succeeds and batch 2 (8 chunks) fails after all retries, both are discarded and the DB transaction rolls back — but batch 1's embeddings are held in memory and re-used on the next retry attempt for that file (not re-fetched from API)
- No whole-run abort on single file failure
- Failed files aggregated, printed to stderr at end of `pythia init`, and CLI exits non-zero if any file failed after retries

**Retry-After header parsing:**
```typescript
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;         // seconds
  const when = Date.parse(raw);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now()); // HTTP date
}
```
Falls back to exponential backoff if both formats fail to parse.

**Local mode:** `embedding_concurrency` clamped to 1. Config field accepted but emits startup warning once: `"embedding_concurrency ignored for local backend; using 1"`

**Acceptance criteria:**
- [ ] `embedding_concurrency: 4` fires 4 concurrent HTTP requests
- [ ] `embedding_batch_size: 32` sends 32 texts per request
- [ ] 429 response triggers exponential backoff with correct timing
- [ ] `honor_retry_after: true` reads `Retry-After` header value
- [ ] File-level atomic failure: failed file writes nothing to DB
- [ ] Tests: `embedder-factory.test.ts` updated with concurrency + retry scenarios
- [ ] Tests: fake server tests for 429 + Retry-After header

---

### FEAT-028 — Benchmark CLI

**Command:** `pythia benchmark`

**Flags:**
```
pythia benchmark
  [--workspace <path>]     # Override workspace root (default: walk up from cwd)
  [--queries <yaml>]       # Path to query set YAML (default: benchmarks/queries.yaml)
  [--set-baseline]         # Promote this run to baseline
  [--baseline <run_id>]    # Diff against specific prior run (default: baseline.json)
  [--output <dir>]         # Override output directory
```

**lcs.db discovery:** Walks up from `cwd` until `.pythia/lcs.db` is found. `--workspace` overrides.

**Execution stack:** Calls internal `search()` function directly — not MCP text output, not raw SQL. Measures the full hybrid RRF + cross-encoder pipeline as production uses it.

**Query set format** (`benchmarks/queries.yaml`):
```yaml
- id: q-001
  query: "where is the chunkFile function defined"
  type: definitional        # definitional | semantic | implementation
  difficulty: easy          # easy | medium | hard
  relevant_chunks:
    - "src/indexer/chunker-treesitter.ts::function::chunkFile"
```

**CNI disambiguator note:** Duplicate symbols gain `#L<line>` suffixes (e.g. `::function::render#L42`). Query set CNIs must use the exact stored ID including any `#L` suffix.

**Minimum query set:** 25 human-labeled queries. All CNI IDs must exist in the index before running. Mix of definitional / semantic / implementation queries, easy through hard.

**Metrics computed:**
- Precision@1, Precision@3, Precision@5
- MRR (Mean Reciprocal Rank)
- NDCG@10

**Output location:** `benchmarks/results/<run_id>/`
Files: `config.json`, `summary.json`, `queries.jsonl`, `summary.md`

**Baseline:**
- No auto-promotion. User must explicitly pass `--set-baseline`
- `--set-baseline` writes `benchmarks/baseline.json` only if health checks pass: `missing_label_queries === 0` AND `zero_result_queries / total < 0.2`
- If health checks fail, refuses: `"Cannot set baseline: N queries returned zero results. Fix the index first."`
- Subsequent runs auto-diff against `benchmarks/baseline.json` when it exists

**Query sets are corpus-specific:** `benchmarks/queries/<corpus-id>.yaml` — never mix query sets across corpora.

**Metrics broken down by difficulty** in `summary.json`:
```json
"by_difficulty": {
  "easy":   { "precision_at_5": 0.91, "mrr": 0.88 },
  "medium": { "precision_at_5": 0.68, "mrr": 0.71 },
  "hard":   { "precision_at_5": 0.41, "mrr": 0.48 }
}
```

**Output JSON schema:**
```json
{
  "run_id": "2026-03-12T01-23-45Z",
  "config": {
    "backend": "vertex_ai",
    "dimensions": 512,
    "embedding_batch_size": 32,
    "embedding_concurrency": 4
  },
  "summary": {
    "precision_at_1": 0.72,
    "precision_at_3": 0.65,
    "precision_at_5": 0.62,
    "mrr": 0.71,
    "ndcg_at_10": 0.76,
    "zero_result_queries": 3,
    "missing_label_queries": 1
  },
  "baseline_diff": {
    "precision_at_1": 0.02,
    "precision_at_3": -0.01,
    "precision_at_5": -0.03,
    "mrr": 0.01,
    "ndcg_at_10": 0.02
  },
  "queries": [
    {
      "id": "q-001",
      "query": "where is the chunkFile function defined",
      "type": "definitional",
      "difficulty": "easy",
      "relevant_chunks": ["src/indexer/chunker-treesitter.ts::function::chunkFile"],
      "returned_chunks": ["src/indexer/chunker-treesitter.ts::function::chunkFile", "..."],
      "metrics": {
        "precision_at_5": 1.0,
        "rr": 1.0,
        "ndcg_at_10": 1.0
      },
      "flags": {
        "zero_results": false,
        "missing_labels_in_index": false
      }
    }
  ]
}
```

**Acceptance criteria:**
- [ ] `pythia benchmark` discovers `.pythia/lcs.db` by walking up from cwd
- [ ] Calls internal `search()` not MCP text
- [ ] Zero-result queries flagged `zero_results: true`, not counted as 0.0 MRR in aggregate
- [ ] Missing CNIs flagged `missing_labels_in_index: true`
- [ ] First run auto-creates `benchmarks/baseline.json`
- [ ] `--set-baseline` promotes a run to new baseline
- [ ] Output JSON matches schema above
- [ ] `summary.md` human-readable report generated

---

### FEAT-029 — Max Chunk Size Enforcement

**Problem:** A 3,000-line PHP class emits as one chunk. At embedding time, the model truncates silently at ~512 tokens, discarding the rest. This wastes index space and produces embeddings that only represent the first ~200 lines.

**Config schema addition (per-type map):**
```json
{
  "indexing": {
    "max_chunk_chars": {
      "module":   12000,
      "class":     8000,
      "function":  6000,
      "method":    4000,
      "trait":     6000,
      "interface": 6000,
      "rule":      2000,
      "at_rule":   4000,
      "element":   4000,
      "doc":      12000
    },
    "oversize_strategy": "split"
  }
}
```

**Schema:**
```
max_chunk_chars:    z.record(z.string(), z.number().int().min(200).max(100000))
oversize_strategy:  z.enum(["split", "truncate"]).default("split")
```

**Behavior (`split` — default):** Chunk content exceeding its type's limit is split into numbered parts: `::function::myBigFn#part1`, `::function::myBigFn#part2`, etc. Each part independently embedded and stored. Splits occur at newline boundaries.

**ID ordering when both disambiguators apply:** Symbol-duplicate suffix first, then split suffix: `::function::render#L42#part2`

**Method extraction order:** Structural chunks (class, function, method) are extracted FIRST, THEN oversized chunks are split. Both `::class::BigClass#part1` and `::class::BigClass::method::someMethod` coexist — same model as existing parent/child chunk overlap.

**Behavior (`truncate`):** Content hard-truncated at type limit, appended with `\n...[TRUNCATED]`. Simpler but loses tail content.

**Acceptance criteria:**
- [ ] `max_chunk_chars: 1000` with a 2,500-char PHP class produces 3 split chunks
- [ ] Split chunks have `#part1`, `#part2` etc. suffixes in their IDs
- [ ] `oversize_strategy: "truncate"` hard-truncates content, no split chunks
- [ ] Existing short chunks are unaffected
- [ ] Tests for split + truncate behavior

---

### FEAT-030 — POC Matrix Script

**Script:** `scripts/poc-matrix.sh` (thin bash wrapper) → delegates to `scripts/poc-matrix.mjs` (Node.js)

**Rationale for Node.js:** Corpus paths contain spaces and `@` characters. Bash path handling is fragile. Node.js handles arbitrary paths safely.

**Purpose:** One-time research tool to measure retrieval quality across embedding backends, dimensions, and corpora. Not CI. Runtime 4+ hours acceptable.

**Flags:**
```
--resume              # Skip already-completed combinations (reads results dir)
--dry-run             # Print combination list without executing
--only <selector>     # Filter combinations (e.g. "vertex_ai" or "256")
```

**Matrix dimensions:**
- Backends: `local`, `openai_compatible` (Ollama/homebox), `vertex_ai`, `openai_compatible` (Voyage)
- Dimensions: `128`, `256`, `512`, `768` (where model supports)
- Corpora: Pythia, Hyva, Luma

**Per combination:**
1. Update `config.json` with backend + dimensions
2. `pythia init --force` (full reindex)
3. `pythia benchmark` (with standard 25-query set)
4. Write results to `benchmarks/results/<backend>_<dim>_<corpus>/`

**Crash safety:** Each combination writes results before moving to next. `--resume` detects completed combinations by checking for `benchmarks/results/<combo>/summary.json`.

**Acceptance criteria:**
- [ ] `--dry-run` prints all combinations without executing
- [ ] `--resume` skips completed combinations
- [ ] Results written per combination before continuing
- [ ] `--only vertex_ai` filters to Vertex combinations only

---

## Config Schema Summary (full additions)

```json
{
  "embeddings": {
    "mode": "local",
    "dimensions": 256,
    "base_url": "...",
    "api_key": "...",
    "model": "...",
    "project": "...",
    "location": "...",
    "retry_max_attempts": 3,
    "initial_backoff_ms": 500,
    "honor_retry_after": true
  },
  "indexing": {
    "scan_on_start": false,
    "embedding_concurrency": 1,
    "embedding_batch_size": 32,
    "css_rule_chunk_min_chars": 80,
    "max_chunk_chars": {
      "module":   12000,
      "class":     8000,
      "function":  6000,
      "method":    4000,
      "trait":     6000,
      "interface": 6000,
      "rule":      2000,
      "at_rule":   4000,
      "element":   4000,
      "doc":      12000
    },
    "oversize_strategy": "split"
  },
  "gc": {
    "deleted_chunk_retention_days": 7
  }
}
```

---

## CLI Changes

| Command | Change |
|---|---|
| `pythia init` | Add `--force` flag |
| `pythia benchmark` | New command |
| `pythia benchmark --set-baseline` | New flag |
| `pythia benchmark --baseline <run_id>` | New flag |

---

## Test Requirements

### New golden fixtures (`tests/fixtures/<lang>/`)
- `php/input.php` + `expected-chunks.json`
- `php/input.phtml` + `expected-chunks.json`
- `php/input-trait.php` + `expected-chunks.json`
- `xml/di.xml` + `expected-chunks.json`
- `xml/layout.xml` + `expected-chunks.json`
- `xml/generic.xml` + `expected-chunks.json`
- `sql/input.sql` + `expected-chunks.json`
- `css/input.css` + `expected-chunks.json`
- `scss/input.scss` + `expected-chunks.json`

### Updated test suites
- `chunker-treesitter.test.ts` — all new language fixtures
- `embedder-factory.test.ts` — dimension validation, warm-up mismatch, concurrency, 429 retry
- `embedding-meta.test.ts` — `--force` delete + rewrite flow
- `benchmark.test.ts` — new test suite for benchmark CLI

### Build matrix (CI)
- Must verify all 3 new tree-sitter grammar packages (`tree-sitter-php`, `tree-sitter-xml`, `tree-sitter-css`) compile and pass unit tests on:
  - macOS arm64 (developer machines)
  - linux/amd64 (deployment target)

---

### FEAT-031 — oracle_add_to_corpus Batch Mode

**Problem:** `oracle_add_to_corpus` currently accepts one file per call. Each call spawns a new Gemini CLI process: load session state → inject → write state → exit. 109 files = 109 CLI spawns = ~55 minutes wall clock. The context window was never the bottleneck. The spawn cycle was.

**Fix:** Accept a single file path OR an array of file paths. One MCP call → one Gemini CLI spawn → inject all N files in a single session turn.

**New tool signature:**
```typescript
oracle_add_to_corpus({
  oracle_id: string,
  // accepts single path or array
  files: string | string[],
  // optional content type hint — overrides auto-detection
  type?: "doc" | "source" | "config"
})
```

**Content type detection (on each file):**
If `type` is not provided, auto-detect from file extension:
- Source code extensions (`.ts`, `.js`, `.php`, `.go`, `.rs`, `.py`, `.java`, `.css`, `.scss`, `.sql`, `.xml`) → emit warning:

```
⚠️ SOURCE_CODE_IN_ORACLE: path/to/file.ts appears to be source code.
The oracle corpus is designed for architectural documents (specs,
ADRs, READMEs). For semantic code search, use pythia_force_index.
Pass type: "source" to suppress this warning.
```

- Document extensions (`.md`, `.txt`, `.pdf`) → ingest silently

**Batch injection flow:**
1. Resolve all file paths, read content
2. Estimate total corpus token budget (chars / 4 as proxy)
3. If estimated corpus would exceed 1,500,000 chars (~375K tokens), warn:
   ```
   ⚠️ CORPUS_SIZE_WARNING: Adding these N files would bring the oracle
   corpus to ~Xk tokens. This leaves limited headroom for conversation.
   Consider using pythia_force_index for large code corpora instead.
   ```
4. Write all entries to manifest atomically:
   - Acquire exclusive file lock on `manifest.json` (`proper-lockfile` or `fs.open` O_EXCL lock file pattern)
   - Read current manifest under lock
   - Merge new entries
   - Write to `manifest.tmp.json`, then `fs.rename` to `manifest.json` (atomic on POSIX)
   - Release lock
5. If active pool members exist: deliver all content in ONE `ask_daemon` call
   (not N calls — batch the injection prompt using XML delimiters):
   ```
   Adding N files to your corpus. Please acknowledge and integrate:
   <<<FILE path="/absolute/path/to/a.md">>>
   [content of a.md]
   <<<END_FILE>>>
   <<<FILE path="/absolute/path/to/b.md">>>
   [content of b.md]
   <<<END_FILE>>>
   ```
6. Return summary: `{ added: N, warned: M, corpus_total_chars: X }`

**Single-file backward compatibility:** Callers passing `files: "path/to/file.md"` (string, not array) work identically to the old API.

**Acceptance criteria:**
- [ ] `files: ["a.md", "b.md", "c.md"]` triggers exactly 1 Gemini CLI spawn
- [ ] Single string `files: "a.md"` works identically to old API
- [ ] Source code extension triggers warning, not error — caller can pass `type: "source"` to suppress
- [ ] Corpus size warning fires when adding files would exceed 1.5M chars
- [ ] Manifest updated atomically (one write for all N files)
- [ ] Tests: batch injection produces same manifest state as N individual calls
- [ ] Tests: content type detection warns on `.ts`/`.php`/`.go` extensions

---

## Out of Scope (Sprint 7)

- Less, Vue, Ruby, C#, Kotlin, Swift, Dart, Scala, Elixir, Haskell
- SQL structural extraction (procedures, functions, triggers)
- PHP slow path (semantic graph edges via language server)
- Vue cross-language block injection (template → TS, style → CSS)
- Benchmark query set authoring tooling (auto-suggest CNIs)
- `oracle_init` FEAT-000

---

## Resolved Questions (Round 2 Answers)

1. **tree-sitter-php PHP 8.x support:** tree-sitter-php covers enums, named arguments, readonly, first-class callables. Fibers are syntactically transparent (they're just function calls) — no special AST node. Implementation notes this in a code comment.
2. **tree-sitter-xml node structure:** Produces element-level nodes with attribute access. Attributes extracted from AST nodes directly (not regex on raw text). Implemented as specified in FEAT-023 XML section.
3. **tree-sitter-css selector nodes:** Produces ruleset-level nodes with selector text accessible. The `css_rule_chunk_min_chars: 80` threshold operates on these nodes.
4. **ONNX backend concurrency:** `embedding_concurrency` clamped to 1 for local backend. Field accepted in config but emits one startup warning. See FEAT-027 parallel embedding section.
5. **`--force` confirmation prompt:** ⚠️ **UNDECIDED** — Codex to decide during implementation. Options: silent (trust the user), or print a one-line warning `"WARNING: Dropping and rebuilding entire index. Press Ctrl+C to abort."` then proceed after 3s delay. No interactive `--yes` required.
6. **Split chunks graph edges:** Treated as independent chunks. Split parts do NOT get graph edges back to the parent chunk — they're storage artifacts, not semantic nodes. Parent class/function still gets its own non-split chunk when method extraction runs first.
7. **Benchmark query set scope:** Corpus-specific YAML files at `benchmarks/queries/<corpus-id>.yaml`. 25 minimum queries per corpus, not shared across corpora.
8. **poc-matrix.mjs cleanup:** ⚠️ **UNDECIDED** — Codex to decide during implementation. Options: restore original config on exit (use `finally` block), or leave last config in place. Recommendation: restore original via `finally` — leaving a mutated config is a foot-gun for the next `pythia init` run.
9. **`pythia benchmark` binary:** Part of the main `pythia` CLI, not a separate binary. `pythia benchmark` is a subcommand of the existing CLI entrypoint.
10. **`--force` CDC behavior:** Existing rows deleted by the 7-step DDL (`DELETE lcs_chunks`, `DELETE file_scan_cache`). Rescan via `scanWorkspace(forceReindex:true)` then reinserts all chunks fresh. BLAKE3 CDC is bypassed — `forceReindex=true` skips the mtime/hash check entirely.
