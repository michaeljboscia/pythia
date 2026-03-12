# Sprint 8 Spec — Language Breadth + Embedding Performance
**Version:** 2.0
**Date:** 2026-03-12
**Pythia version:** 1.4.0
**Status:** DRAFT — twin-reviewed (Round 2, 2026-03-12)
**Prerequisite:** Sprint 7 complete (✓ as of 2026-03-12, 259/259 tests pass)

---

## Sprint Goal

Ship the deferred Sprint 6 language breadth features (PHP, CSS/SCSS, XML done via mini-sprint)
plus embedding performance tuning, so Pythia works on PHP monorepos and CSS-heavy codebases
without OOM or silent token truncation.

**This sprint is NOT about new architecture.** The chunker code already exists in
`chunker-php.ts` and `chunker-css.ts`. Sprint 8 completes the contract: bug fixes, tests,
golden fixtures, config tests, and verifying the parallel embedding that makes large repos viable.

---

## Proof of Completion

```
pythia init on a project with PHP + SCSS files (can be the Pythia repo's own test fixtures)
→ lcs_investigate("how does the dependency injection container work") returns PHP class chunks
→ npm run benchmark shows no regression vs Sprint 7 baseline (P@1, MRR)
→ poc-matrix results include init_wall_clock_ms field (speedup verifiable from data)
```

---

## Feature Scope

### FEAT-022 — PHP Language Support (Close Out)
**Status:** Code exists in `src/indexer/chunker-php.ts` — missing tests, golden fixtures, AND two known bugs requiring fixes.

**Known bugs Worker A must fix (from twin review 2026-03-12):**
1. **Brace-style namespaces silently dropped**: `namespace Foo { class Bar {} }` produces `namespace_definition → compound_statement → class_declaration` in tree-sitter-php. Current `extractPhpChunks` only iterates `rootNode.namedChildren` — misses classes inside brace-namespaces. Fix: add recursion into `childForFieldName("body")` when encountering `namespace_definition` nodes.
2. **PHP 8.1 enums silently dropped**: `enum Status { case Active; }` hits `default:` branch and is ignored. Fix: add `case "enum_declaration"` to the switch, emitting `chunk_type: "enum"`. Note: `ChunkType` already includes `"enum"` — no union change needed. Also extend `findEnclosingContainer` to return `{ type: "enum" }` for `enum_declaration` nodes. **Worker C adds `enum: 6_000` to `DEFAULT_MAX_CHUNK_CHARS` in `src/config.ts` as part of their test-support work.**

**Semicolon-style namespaces** (`namespace Foo;`) are fine — class is a direct root child.

**abstract/final/readonly classes**: All produce `class_declaration` in the tree-sitter-php grammar — handled correctly by existing code, no fix needed.

**What's left:**
- [ ] Fix brace-style namespace recursion bug in `extractPhpChunks`
- [ ] Add `enum_declaration` case to `extractPhpTopLevelChunk` switch
- [ ] Extend `findEnclosingContainer` for enum containers
- [ ] Write `src/__tests__/chunker-php.test.ts` with golden fixture files
- [ ] PHP `__construct` gets its own `method` chunk (verify current behavior)
- [ ] `trait` declarations emit `chunk_type: "trait"`, not `"class"`
- [ ] `.phtml` emits exactly 1 `module` chunk (verify current behavior)

**Testing note:** Test module chunk behavior via `chunkFile()` (the router in `chunker-treesitter.ts`), NOT `extractPhpChunks()` directly. `createModuleChunk` is injected by `chunkFile()`, not the extractor. `.phtml` files return immediately after the module chunk (lines 644-648 of chunker-treesitter.ts).

**Golden fixture corpus (minimum 9 files):**
```
src/__tests__/fixtures/php/
  basic-class.php              → class + method chunks
  trait-example.php            → trait + method chunks
  interface-example.php        → interface chunk
  magic-methods.php            → __construct, __destruct, __toString method chunks
  namespaced-class.php         → semicolon namespace + class + method chunks
  brace-namespaced-class.php   → brace-style namespace + class chunks (tests the bug fix)
  enum-example.php             → enum chunk (PHP 8.1)
  plain-function.php           → standalone function chunk
  phtml-template.php           → exactly 1 module chunk
```

**Acceptance criteria:**
- [ ] All 9 golden fixtures produce expected CNI arrays (inline `assert.deepEqual` — `node:test` framework, no Jest snapshots)
- [ ] No PHP file emits 0 chunks (every file always has at least a module chunk via `chunkFile()`)
- [ ] `__construct` chunk id: `<path>::class::ClassName::method::__construct`
- [ ] Brace-style namespaced class: id contains class name (not silently dropped)
- [ ] PHP 8.1 enum emits `chunk_type: "enum"`, not dropped

---

### FEAT-025 — CSS/SCSS Language Support (Close Out)
**Status:** Code exists in `src/indexer/chunker-css.ts` — missing tests, golden fixtures, AND one known bug requiring a fix.

**Known bug Worker B must fix:**
Plain CSS `walk()` currently only recurses into blocks for `strategy === "scss"`. Rules inside `@media { .btn {} }` are silently dropped for plain CSS. The fix also corrects `@supports`, `@layer`, and `@container` blocks — any at-rule containing nested rule_sets. Fix is a 3-line change in `chunker-css.ts`:
```ts
// Change this guard (around line 175):
if (strategy === "scss") {
// To:
if (strategy === "scss" || strategy === "css") {
```
This applies to BOTH the at_rule block recursion (line ~175) AND the rule_set block recursion (line ~145). Verify both guards are updated.

**What's left:**
- [ ] Fix `walk()` recursion guard in `chunker-css.ts` (2 occurrences: at_rule block + rule_set block)
- [ ] Write `src/__tests__/chunker-css.test.ts` with golden fixture files
- [ ] Threshold gate: rules shorter than `css_rule_chunk_min_chars` (default 80) → only module chunk
- [ ] SCSS `@mixin` → `mixin` chunk type
- [ ] SCSS `@function` → `function` chunk type
- [ ] SCSS nested selectors resolved to full selector path (`.parent .child`)
- [ ] SCSS `&` combinator expansion tested

**Golden fixture corpus (minimum 7 files):**
```
src/__tests__/fixtures/css/
  basic-rules.css          → rule chunks above threshold, module chunk
  short-rules.css          → all rules below threshold → only module chunk
  media-queries.css        → @media → at_rule chunk + rule chunks for nested selectors (tests the bug fix)
  scss-mixins.scss         → @mixin and @function chunks
  scss-nesting.scss        → nested selectors resolved correctly
  scss-ampersand.scss      → & combinator resolved correctly
  tailwind-utilities.css   → 200+ short utility classes → only module chunk (no explosion)
```

**Acceptance criteria:**
- [ ] Golden fixture CNI arrays match expected output (inline `assert.deepEqual` — `node:test`, no Jest)
- [ ] Tailwind fixture: 0 rule chunks (all below threshold), 1 module chunk
- [ ] `css_rule_chunk_min_chars` config field takes effect (verify with threshold=1 → all rules chunk)
- [ ] `media-queries.css`: rule chunks for selectors inside `@media` block (tests the bug fix)

---

### FEAT-026 — Configurable Embedding Dimensions (Config Wiring)
**Status:** FULLY IMPLEMENTED in `src/config.ts` (Zod schema) and `src/cli/init.ts` (`recreateVectorTable`). **Worker C writes tests only — no code changes needed.**

**Config schema (already in production):**
```typescript
embeddings: z.object({
  // existing fields...
  dimensions: z.union([
    z.literal(128), z.literal(256), z.literal(512),
    z.literal(768), z.literal(1024), z.literal(1536)
  ]).default(256)
})
```

**Backend enforcement:**
| Backend | How dimensions applied |
|---------|----------------------|
| `local` (ONNX) | Client-side slice of Float32Array. Max 768. |
| `openai_compatible` | Client-side slice (server may return more, we truncate) |
| `vertex_ai` | `outputDimensionality` in request body |

**`pythia init --force` rebuild flow (implemented in `src/cli/init.ts`):**
1. Read current `embedding_meta` row (captures current `dimensions`)
2. If `dimensions` unchanged → no rebuild needed, exit
3. `DROP TABLE IF EXISTS vec_lcs_chunks`
4. `CREATE VIRTUAL TABLE vec_lcs_chunks USING vec0(embedding float[N])` (N = new dimensions)
5. `DELETE FROM embedding_meta`
6. Full re-embed all non-deleted chunks from `lcs_chunks` (CDC bypassed)
7. Write new `embedding_meta` row

**Acceptance criteria (Worker C writes these tests):**
- [ ] `dimensions: 512` with `vertex_ai` → `outputDimensionality: 512` in API body
- [ ] `dimensions: 900` → `ZodError` at config load (not a valid enum value)
- [ ] `dimensions > 768` with `local` mode → plain `Error` thrown by `validateLocalDimensions()` in `src/indexer/embedder.ts` (NOT a `PythiaError` / NOT `CONFIG_INVALID` error code — it's `throw new Error(...)`)
- [ ] `pythia init --force` with changed dimensions rebuilds vec table
- [ ] `embedding_meta` row cleared before reindex
- [ ] Changing dimensions without `--force` → warning in stdout, no rebuild

---

### FEAT-027 — Parallel Embedding Workers
**Status:** FULLY IMPLEMENTED in `src/indexer/embedder.ts` — `p-limit` imported, `embedding_concurrency`/`embedding_batch_size`/`honor_retry_after` wired and active. Local mode guard with warning exists at line 400. **Worker C writes tests only — no code changes needed.**

**Config schema (already in production):**
```typescript
embeddings: z.object({
  // existing fields...
  embedding_concurrency: z.number().int().min(1).max(16).default(1),  // MAX IS 16, NOT 32
  embedding_batch_size:  z.number().int().min(1).max(256).default(32),
  honor_retry_after:     z.boolean().default(true)
})
```

**Implementation (already live):**
- `p-limit` with `embedding_concurrency` slots
- Chunk file list into batches of `embedding_batch_size`
- 429 response → exponential backoff with `Retry-After` header respected when `honor_retry_after: true`
- File-level atomicity: if any batch for a file fails → entire file's chunks not written to DB

**Local backend guard (already live):**
- `local` mode: ignore `embedding_concurrency > 1`, emit one-time warning
  `[WARN] embedding_concurrency > 1 has no effect in local mode (ONNX is single-threaded)`

**Testing note:** Mock HTTP server already exists in `src/__tests__/embedder-factory.test.ts` (using `node:http createServer`, lines 1-3 and 23-67). The `maxInFlight===4` concurrency test is already present at lines 556-579. Worker C adds to the existing test file — do NOT create a new one.

**Acceptance criteria (Worker C adds to `embedder.test.ts`):**
- [ ] `embedding_concurrency: 4` fires 4 concurrent HTTP requests (observable via mock server — already scaffolded in `embedder-factory.test.ts`)
- [ ] `embedding_concurrency: 17` → rejected at config load (`ZodError`, max is 16)
- [ ] 429 + `Retry-After: 5` → 5s delay before retry (when `honor_retry_after: true`)
- [ ] 429 + `honor_retry_after: false` → standard exponential backoff (ignores header)
- [ ] File with failed batch → nothing written to DB for that file (rollback test)
- [ ] Local mode: concurrency clamped, one-time warning emitted at startup
- [ ] `embedding_batch_size: 32` → chunks submitted in groups of 32 per API call

---

### FEAT-029 — Max Chunk Size Enforcement (Config Wiring)
**Status:** FULLY IMPLEMENTED. `splitOversizedChunks(chunks, maxChunkChars: Record<string,number>, strategy)` in `src/indexer/chunk-splitter.ts` exists and is called. Config wiring complete in `src/config.ts` indexingSchema. **Worker C writes tests only — no code changes needed.**

**Actual `DEFAULT_MAX_CHUNK_CHARS` values in `src/config.ts` (lines 26-37):**
```typescript
export const DEFAULT_MAX_CHUNK_CHARS: Record<string, number> = {
  module:    12000,
  class:      8000,
  function:   6000,
  method:     4000,
  trait:      6000,
  interface:  6000,
  rule:       2000,
  at_rule:    4000,
  element:    4000,
  doc:       12000
  // NO "default" key — unknown types pass through UNCHANGED
};
```

**Config schema (already in production):**
```typescript
indexing: z.object({
  // existing fields...
  max_chunk_chars: z.record(z.string(), z.number().int().positive()).default({
    module: 12000, class: 8000, function: 6000, method: 4000,
    trait: 6000, interface: 6000, rule: 2000, at_rule: 4000, element: 4000, doc: 12000
  }),
  oversize_strategy: z.enum(["split", "truncate"]).default("split")
})
```

**Behavior:**
- `split`: chunk split at last newline boundary before limit, each part gets `#part1`, `#part2` suffix
- `truncate`: hard-truncate at `max_chunk_chars[type]`
- **Unknown type (no entry in map)**: chunk passes through UNCHANGED — no truncation, no error
- Part ID ordering: duplicate-suffix (`#L<line>`) first, then part suffix (`#part1`)

**Acceptance criteria (Worker C adds to `chunk-splitter.test.ts`):**
- [ ] 2,500-char function with `max_chunk_chars.function: 1000` → 3 split chunks
- [ ] `oversize_strategy: "truncate"` → 1 chunk, content truncated to limit
- [ ] Chunks below their type limit are unaffected
- [ ] `#part1`/`#part2` suffix appended AFTER any `#L<line>` disambiguator
- [ ] Chunk with type `"unknown_type"` (not in map) → passes through unchanged (no error, full content preserved)

**Worker C also adds `enum: 6_000` to `DEFAULT_MAX_CHUNK_CHARS` in `src/config.ts`** to support Worker A's enum fix. This is a 1-line additive change.

---

### FEAT-030 — POC Matrix Script
**Status:** PARTIALLY IMPLEMENTED. `scripts/poc-matrix.mjs` already exists with: `comboId()` (lines 163-165), `corpusConfig()` (lines 139-157), `--resume` flag (lines 244-249), sequential `execFileSync` loop (lines 227-285). Current backends: `local`, `ollama`, `vertex_ai`, `voyage`. **Worker C updates the combination matrix and backend list — not a rewrite.**

**File:** `scripts/poc-matrix.mjs` (MODIFY, not create)

**What it does:**
Iterates `backend × dimensions × corpus` combinations. For each:
1. Write per-combination config to `/tmp/pythia-poc-matrix-<combo-id>.json` (**NEVER touch `~/.pythia/config.json`**)
2. Run `pythia init --force --config /tmp/pythia-poc-matrix-<combo-id>.json` on the target corpus
3. Run `pythia benchmark --config /tmp/pythia-poc-matrix-<combo-id>.json` to capture metrics
4. Write combination result to `benchmarks/poc-matrix/<run-id>.json` — **must include `init_wall_clock_ms` field**
5. Delete temp config

**Why temp file per combination (decided 2026-03-12, twin consensus):** The `--config` flag exists on both `init` (init.ts:160) and `benchmark` (benchmark.ts). Backup/restore of `~/.pythia/config.json` is unsafe on crash/SIGINT. Isolated temp files make the script side-effect-free with zero global state mutation.

**Combinations (minimum viable):**
```
backends:    [local, openai_compatible]
dimensions:  [128, 256, 512]
corpus:      [src/ only, src/+docs/]
```
Total: 12 combinations.

**CLI flags (existing + additions):**
- `--dry-run` — print all combinations without executing (existing behavior)
- `--resume` — skip combinations that already have a result file. **Must validate result file is valid JSON with a `status` field, not just check existence** (existing flag, fix the validation logic)
- `--only <selector>` — filter by backend name or dimension value (existing)
- `--corpus <path>` — workspace to run against (default: current dir) (existing)

**`init_wall_clock_ms` requirement:** The "4x speedup" claim for `embedding_concurrency: 4` cannot be verified from retrieval baselines (P@1, MRR only measure quality, not speed). Every poc-matrix result JSON must include `init_wall_clock_ms` so speed claims have actual data. Add wall-clock timing around the `pythia init` call.

**Acceptance criteria:**
- [ ] `--dry-run` prints all 12 combinations, exits 0
- [ ] `--resume` skips combinations where result file exists AND is valid JSON with `status` field
- [ ] `--resume` does NOT skip corrupted/incomplete result files (they get re-run)
- [ ] `--only local` runs only 6 combinations (all local backend)
- [ ] `--only 256` runs only 4 combinations (all 256-dimension)
- [ ] Crash in any combination logged to `benchmarks/poc-matrix/errors.json`, run continues
- [ ] Each result JSON includes `init_wall_clock_ms` (milliseconds for `pythia init` to complete)

---

### YAML Language Support (New — Stretch Goal)
**Status:** Not implemented. YAML not in PRD-v2.md yet.

**Decision required before implementation:**
- YAML tree-sitter grammar (`tree-sitter-yaml`) compiles on Node 22? (requires Step 0 validation)
- If native binding fails: use `js-yaml` pure-JS parser as fallback — follow the **XML pattern**: write a bespoke `extractYamlChunks(content: string, filePath: string): Chunk[]` function that works directly on the string output from `js-yaml`, NOT a `SyntaxNode` adapter. Do not attempt to create a fake SyntaxNode tree.

**Proposed chunk types:** `doc` (whole-file module), key-based structural chunks for:
- GitHub Actions: `jobs.<name>` → `function` chunk
- Kubernetes manifests: `kind: <Name>` → `class` chunk
- Ansible tasks: `- name: <task>` → `function` chunk
- Generic: top-level keys only, no recursion (avoids explosion on deeply nested configs)

**This feature is STRETCH.** Workers A and B focus on closing out existing code first.
YAML is Worker B's addition after CSS/SCSS tests are done, time permitting.

---

## Worker Partition

| Worker | Files owned | No-touch zone |
|--------|-------------|---------------|
| **Worker A** | `src/indexer/chunker-php.ts` (bug fixes), `src/__tests__/chunker-php.test.ts` (new), `src/__tests__/fixtures/php/` (new fixtures) | Everything else |
| **Worker B** | `src/indexer/chunker-css.ts` (bug fix), `src/__tests__/chunker-css.test.ts` (new), `src/__tests__/fixtures/css/` (new fixtures), optional: `src/indexer/chunker-yaml.ts` | Everything else |
| **Worker C** | `src/__tests__/config.test.ts` (additions only — file exists), `src/__tests__/embedder.test.ts` (additions only — file exists), `src/__tests__/chunk-splitter.test.ts` (additions only — file exists), `scripts/poc-matrix.mjs` (modifications to existing script), `src/config.ts` (1-line: `enum: 6_000` addition) | FEAT-026/027/029 code is ALREADY IMPLEMENTED — Worker C adds tests and extends poc-matrix only |

**Router touch:** Workers A and B own no-conflict bug fixes + new test files. Worker C makes exactly one code change (`enum: 6_000` in config.ts) and writes tests against already-implemented features.

**Merge sequence:** A and B merge first (no shared files). C merges last (config change is additive).

---

## Step 0 — Dependency Validation (Pre-Sprint, Claude)

**RESOLVED from code inspection (2026-03-12):**
- `p-limit`: ALREADY installed and imported in `src/indexer/embedder.ts`. No action needed.
- `tree-sitter-php`, `tree-sitter-css`: ALREADY in use. No action needed.
- `pythia init --force`: EXISTS at `src/cli/init.ts` line 161.
- `DEFAULT_MAX_CHUNK_CHARS`: Is `Record<string, number>` with per-type limits. NO "default" key.
- `splitOversizedChunks` signature: `(chunks: T[], maxChunkChars: Record<string,number>, strategy: "split" | "truncate")`
- Sprint 7 benchmark baseline: `benchmarks/baselines/javascript.json` exists but NO sprint7-general baseline. Worker C must commit one before the "no regression" gate can be enforced.
- Snapshot testing: Tests use `node:test` + `node:assert/strict`. **No Jest-style snapshots.** "Golden fixture" = inline `assert.deepEqual` calls with hard-coded expected CNI arrays.
- `poc-matrix.mjs`: ALREADY EXISTS with comboId, corpusConfig, --resume, sequential loop. Worker C modifies it — does not create it.

Before Worker B YAML stretch work only:
```bash
mkdir /tmp/sprint8-dep-test && cd /tmp/sprint8-dep-test && npm init -y
npm install tree-sitter-yaml   # MUST compile. If gyp ERR → use js-yaml fallback.
```
Decision written to `/Users/mikeboscia/pythia/design/sprint-8-yaml-decision.md` before Worker B starts.

---

## Tests Required

| Worker | Test file | Minimum passing count |
|--------|-----------|----------------------|
| A | `chunker-php.test.ts` | ≥ 27 tests (9 fixture files × 3 assertions each) |
| B | `chunker-css.test.ts` | ≥ 20 tests (7 fixture files × 3 assertions each) |
| C | `config.test.ts` additions | ≥ 8 tests (dimensions validation, concurrency max=16, max_chunk_chars) |
| C | `embedder.test.ts` additions | ≥ 6 tests (concurrency, 429 handling, local guard) |
| C | `chunk-splitter.test.ts` additions | ≥ 4 tests (split/truncate/unknown-type/part-suffix) |

**Gate:** `npm test` must pass ALL tests (current 259 + sprint 8 additions) before merge.

---

## Files to Create

```
src/__tests__/
  chunker-php.test.ts               ← Worker A (new file)
  chunker-css.test.ts               ← Worker B (new file)
  fixtures/php/
    basic-class.php
    trait-example.php
    interface-example.php
    magic-methods.php
    namespaced-class.php
    brace-namespaced-class.php      ← tests the brace-namespace bug fix
    enum-example.php                ← tests the PHP 8.1 enum fix
    plain-function.php
    phtml-template.php
  fixtures/css/
    basic-rules.css
    short-rules.css
    media-queries.css
    scss-mixins.scss
    scss-nesting.scss
    scss-ampersand.scss
    tailwind-utilities.css

src/indexer/
  chunker-yaml.ts                   ← Worker B (stretch only)
```

## Files to Modify

```
src/indexer/chunker-php.ts          ← Worker A (brace-namespace recursion + enum_declaration fix)
src/indexer/chunker-css.ts          ← Worker B (walk() guard: "scss" → "scss" || "css")
src/config.ts                       ← Worker C (1 line: enum: 6_000 in DEFAULT_MAX_CHUNK_CHARS)
scripts/poc-matrix.mjs              ← Worker C (backend list, init_wall_clock_ms, --resume validation)
src/__tests__/config.test.ts        ← Worker C (additions to existing file)
src/__tests__/embedder.test.ts      ← Worker C (additions to existing file)
src/__tests__/chunk-splitter.test.ts ← Worker C (additions to existing file)
src/indexer/chunker-treesitter.ts   ← Worker C only if YAML stretch done (1-line import)
```

---

## Out of Scope for Sprint 8

- `LocalReasoningProvider` (Ollama/LM Studio) — Sprint 9
- `pythia_api_surface` (FEAT-037) — Sprint 9
- FalkorDB or Qdrant backend work — Sprint 5 adapters already stub these
- Any oracle engine changes — that codebase (`~/.claude/mcp-servers/inter-agent/`) is separate

---

## Pre-Sprint Step (Before Workers Start)

Generate the Sprint 8 regression baseline NOW (current `main` = Sprint 7 complete state):
```bash
node scripts/csn-benchmark.mjs --lang javascript --samples 500 --baseline
node scripts/csn-benchmark.mjs --lang php --samples 500 --baseline
```
Both commands download corpus from HuggingFace at runtime — no pre-existing PHP repo required. The `--lang php` flag maps to the HuggingFace "php" config. The `--baseline` flag (undocumented, line 75-78 of csn-benchmark.mjs) writes the result as a baseline file.

Commit `benchmarks/baselines/javascript.json` + `benchmarks/baselines/php.json`. These are retrieval-quality baselines (P@1, MRR) — the "no regression" gate in criterion 5 below gates against these files. Embedding speed comparisons come from `init_wall_clock_ms` in poc-matrix results.

## Completion Criteria

Sprint 8 is done when:
1. `npm test` passes ≥ 295 tests (259 current + ≥36 new)
2. PHP + CSS golden fixture assertion arrays committed (inline `assert.deepEqual`, `node:test` framework)
3. `pythia init` on a PHP project indexes `.php` files with class/method/enum chunks (including brace-namespaced classes). Use the golden fixtures in `src/__tests__/fixtures/php/` to verify — a full Magento clone is not required for this criterion.
4. `embedding_concurrency: 4` config field accepted without error (Zod validation passes)
5. `pythia benchmark` shows no regression vs pre-sprint baseline (P@1, MRR) — requires baseline from Pre-Sprint Step above
6. `scripts/poc-matrix.mjs --dry-run` exits 0
7. At least one poc-matrix result JSON includes `init_wall_clock_ms` (speedup claim has data)
