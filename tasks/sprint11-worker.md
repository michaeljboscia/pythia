# Sprint 11 Worker Prompt — Full Sprint Implementation

**Spec:** `/Users/mikeboscia/pythia/.worktrees/sprint-11/design/sprint-11-spec.md` (v3.0)
**Worktree:** `/Users/mikeboscia/pythia/.worktrees/sprint-11`
**Branch:** `feature/sprint-11`
**Baseline:** 399/399 tests passing
**Gate:** ≥449 tests passing + proof script passes

---

## Your Mission

Implement Sprint 11 in its entirety. The spec at `design/sprint-11-spec.md` is authoritative — read it fully before writing any code. This prompt is a sequenced execution guide, not a replacement for the spec.

---

## Execution Order

### Phase 0 — Setup

1. **Create `.npmrc`** in the project root:
   ```
   legacy-peer-deps=true
   ```

2. **Install dependencies:**
   ```bash
   npm install tree-sitter-swift@^0.7.1 tree-sitter-kotlin@^0.3.8 tree-sitter-elixir@^0.3.5 --legacy-peer-deps
   ```

3. **Run the dependency pre-flight** from the spec (lines 22-44) to verify all three parsers load and parse correctly.

4. **Run `npm test`** — must be 399/399 before touching anything.

5. **Commit:** `.npmrc`, `package.json`, `package-lock.json` changes.

### Phase 1 — Language Chunkers (FEAT-045, FEAT-046, FEAT-047)

Do all three languages, then wire them up. Order:

#### 1a. Create chunker files

- `src/indexer/chunker-swift.ts` — use the template from spec lines 128-165. Follow `src/indexer/chunker-ruby.ts` as the structural reference.
- `src/indexer/chunker-kotlin.ts` — use the template from spec lines 258-303. **Critical:** `getKotlinName` must check for BOTH `simple_identifier` AND `type_identifier`.
- `src/indexer/chunker-elixir.ts` — use the template from spec lines 396-457. **Critical:** Use `.find(c => c.type === "arguments")` to locate the arguments node — NOT `namedChildren[1]`.

#### 1b. Register in `chunker-treesitter.ts`

- Add `"swift" | "kotlin" | "elixir"` to the `ChunkStrategy` union type.
- Add imports for `tree-sitter-swift`, `tree-sitter-kotlin`, `tree-sitter-elixir` and the three `extract*Chunks` functions.
- Add entries to `languageConfigEntries` for `.swift`, `.kt`, `.kts`, `.ex`, `.exs`.
- Add `if` blocks to `chunkFile` dispatch chain (use `if` style, NOT `switch`/`case` — match existing `if (config.strategy === "ruby")` pattern).

#### 1c. Register in `cdc.ts`

- Add `.swift`, `.kt`, `.kts`, `.ex`, `.exs` to `indexedExtensions`.
- **Also fix pre-existing bug:** Add `.rb`, `.cs`, `.yaml`, `.yml` to `indexedExtensions` — these chunkers exist but were never added to the scanner's extension set.

#### 1d. Write tests

- `src/__tests__/chunker-swift.test.ts` — ≥12 tests per spec table (lines 200-213). Test #12 must call `chunkFile("test.swift", content, workspaceRoot)`.
- `src/__tests__/chunker-kotlin.test.ts` — ≥12 tests per spec table (lines 324-336). Test #12 must call `chunkFile("test.kt", content, workspaceRoot)`.
- `src/__tests__/chunker-elixir.test.ts` — ≥14 tests per spec table (lines 476-491). Test #14 must call `chunkFile("test.exs", content, workspaceRoot)`.

#### 1e. Verify

```bash
npm test
```

All 399 existing tests must still pass. New language tests must pass. **Commit.**

### Phase 2 — `indexing.max_files` (FEAT-048)

1. **`src/config.ts`:** Add `max_files: z.number().int().min(1).optional()` to `indexingSchema`.

2. **`src/indexer/cdc.ts`:** Add 4th parameter to `scanWorkspace`:
   ```typescript
   export async function scanWorkspace(
     workspaceRoot: string,
     db: Database.Database,
     forceReindex: boolean = false,
     options?: { maxFiles?: number }
   ): Promise<FileChange[]>
   ```
   Apply the cap to `filePaths` IMMEDIATELY AFTER `collectFiles()` — BEFORE reading file content. Use `filePaths.length = options.maxFiles` to truncate. Print warning via `console.warn`.

3. **`src/cli/init.ts`:** Update the `scanWorkspaceImpl` call to pass `maxFiles`:
   ```typescript
   const fileChanges = await scanWorkspaceImpl(
     workspaceRoot, db, options.force === true, { maxFiles: config.indexing.max_files }
   );
   ```
   Remember: `scanWorkspaceImpl` is on `dependencies` (type `InitDependencies`), NOT `options` (type `InitOptions`).

4. **`src/__tests__/cdc.test.ts`:** Add 5 new tests per spec table (lines 559-565).

5. **Verify:** `npm test`. **Commit.**

### Phase 3 — `pythia init --perf` (FEAT-049)

1. **`src/cli/init.ts`:**
   - Add `perf?: boolean` to `InitOptions`.
   - Add `.option("--perf", "Print peak RSS memory usage after init completes")` to `initCommand` (NOT `main.ts`).
   - Add the perf output snippet in ALL THREE return paths of `runInit`, after `reportCorpusHealth`, before `return`:
     ```typescript
     if (options.perf === true) {
       // Note: rss here is current RSS, not peak RSS. Node.js does not expose peak RSS
       // without native addons. This is a practical proxy for post-init memory usage.
       const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
       console.log(`[Pythia] Peak RSS: ${rssMb} MB`);
     }
     ```
   - The three return paths are:
     1. Already-initialized early return (~line 258)
     2. Zero-file-changes early return (~line 271-275)
     3. Normal indexing path (~line 314-318)

2. **`src/__tests__/cli.test.ts`:** Add 4 new tests per spec table (lines 614-619).

3. **Verify:** `npm test`. **Commit.**

### Phase 4 — CSN `--embedding-config` (FEAT-050)

1. **`scripts/csn-benchmark.mjs`:**
   - Add `--embedding-config` to the arg parser.
   - If provided: read the JSON file, extract `.embeddings`, validate with `configSchema.shape.embeddings.parse(parsed.embeddings)`.
   - If invalid: print error and `process.exit(1)`.
   - The flag must appear in `--help` output.

2. **Verify:** `node scripts/csn-benchmark.mjs --help` shows `--embedding-config`. **Commit.**

### Phase 5 — README Update

1. **`README.md`:**
   - Append Ruby, C#, YAML, Swift, Kotlin, Elixir to the supported languages paragraph in `## Architecture` (line 210).
   - Add `"max_files": 500` (or similar example) to the JSON block in `## Configuration`.
   - Add `pythia init --perf` example to `## Quickstart`.
   - Update the `## Quick Context` section's languages line.

2. **Commit.**

### Phase 6 — Proof Script

1. **Create `scripts/sprint11-proof.mjs`** following `scripts/smoke-test.mjs` for the MCP startup pattern. Implement all 6 phases from the spec (lines 54-90):
   - Phase 1: Swift/Kotlin/Elixir chunking assertions
   - Phase 2: `max_files` cap with 5 files (2 .ts, 1 .swift, 1 .kt, 1 .ex), cap at 3, assert `file_scan_cache` row count ≤ 3
   - Phase 3: `--perf` flag on already-initialized workspace
   - Phase 4: `--help` includes `--embedding-config`

2. **Run it:** `node scripts/sprint11-proof.mjs`

3. **Commit.**

### Phase 7 — Final Verification

```bash
npm test          # Must be ≥449
node scripts/sprint11-proof.mjs   # Must pass all phases
```

If both pass, the sprint is complete.

---

## Critical Rules

- **Read the full spec** before writing code. This prompt is a guide, not a substitute.
- **Do not modify existing tests.** All 399 must continue to pass.
- **Use `if` chains for dispatch**, not `switch`/`case` — match existing code style.
- **Kotlin name extraction:** Check BOTH `simple_identifier` AND `type_identifier`.
- **Elixir arguments:** Use `.find(c => c.type === "arguments")`, NOT positional index.
- **max_files cap:** Apply to `filePaths` BEFORE I/O, not to `fileChanges` after.
- **--perf:** Goes in `init.ts` on `initCommand`, NOT `main.ts`. All 3 return paths.
- **Commit after each phase.** Do not batch everything into one mega-commit.
