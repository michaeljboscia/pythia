# Automated test detection and source mapping in TypeScript

**Test files in TypeScript projects can be reliably detected through a combination of file-naming globs, directory conventions, and framework configuration defaults — and then mapped back to their source files via static import analysis or coverage instrumentation.** This matters because accurate test-to-source relationships unlock coverage-aware tooling: flagging untested code in reviews, prioritizing well-tested modules during retrieval, and surfacing reliability signals in a RAG knowledge graph. The three major test runners — Jest, Vitest, and Mocha — each encode slightly different detection heuristics, but converge on the `*.test.*` / `*.spec.*` naming convention. Downstream, tools like dependency-cruiser and ts-morph can extract precise import-graph mappings, while Istanbul's standardized JSON and LCOV output formats provide a machine-readable bridge into metadata stores.

## Framework defaults reveal a shared convention with meaningful divergences

Jest's default [`testMatch`](https://jestjs.io/docs/configuration) uses two micromatch globs: `["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"]`. The first pattern matches any `.js`, `.jsx`, `.ts`, or `.tsx` file inside a `__tests__/` directory at any depth. The second matches files with a `.test.` or `.spec.` suffix anywhere in the project tree. Jest also exposes an equivalent regex via `testRegex` — `(/__tests__/.*|(\.|/)(test|spec))\.[jt]sx?$` — but **`testMatch` and `testRegex` cannot both be active**; setting one nullifies the other. Paths matching `testPathIgnorePatterns` (default: `["/node_modules/"]`) are excluded after glob matching. Jest thus detects tests by both directory membership and file naming, covering co-located and separated layouts alike.

Vitest takes a narrower approach. Its default [`include`](https://vitest.dev/config/) pattern is `["**/*.{test,spec}.?(c|m)[jt]s?(x)"]`, matching `.test.ts`, `.spec.mjs`, `.test.cjs`, and similar variants — but with **no special `__tests__/` directory detection**. A file inside `__tests__/` is only recognized if it also carries a `.test.` or `.spec.` suffix. The default [`exclude`](https://vitest.dev/config/) was significantly simplified in Vitest v4 to just `["**/node_modules/**", "**/.git/**"]`, down from the longer list in v3 that also excluded `dist/`, `cypress/`, and various config files. Vitest resolves globs using `tinyglobby` rather than micromatch.

Mocha's default `spec` pattern is the most conservative: `./test/*.{js,cjs,mjs}`. It looks only in the `./test/` directory, does not recurse into subdirectories (unless `--recursive` is passed), and **does not natively support TypeScript extensions** — requiring `--require ts-node/register` or an equivalent loader. Mocha imposes no naming convention; any file in `./test/` is treated as a test. Configuration lives in `.mocharc.yml`, `.mocharc.json`, or `.mocharc.js`, with the `spec` key accepting custom globs.

For a detection heuristic that works across all three frameworks, the reliable union is: match files with a `.test.` or `.spec.` suffix in `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, or `.cjs` extensions, plus any file inside a `__tests__/` or `test/` directory. Framework-specific AST markers — `describe()`, `it()`, `test()`, and framework-unique calls like `vi.mock()` or `jest.fn()` — can serve as secondary confirmation but are not needed for initial detection.

| Framework | Default pattern | Detection strategy |
|-----------|----------------|--------------------|
| **Jest** | `**/__tests__/**/*.[jt]s?(x)`, `**/?(*.)+(spec\|test).[jt]s?(x)` | Directory + naming |
| **Vitest** | `**/*.{test,spec}.?(c\|m)[jt]s?(x)` | Naming only |
| **Mocha** | `./test/*.{js,cjs,mjs}` | Directory only |

## Static import analysis provides the strongest test-to-source mapping

Three complementary strategies extract test-to-source relationships, each with different accuracy and cost profiles.

**Import graph analysis** is the most reliable static method. [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) parses ES6 `import`, CommonJS `require()`, and dynamic `import()` statements, resolves module paths respecting `tsconfig.json` path aliases, and outputs a full dependency graph in JSON. Its output structure maps directly to test-to-source relationships: each module in the `modules` array carries a `source` path and a `dependencies` array with `resolved` paths, `dependencyTypes`, and `moduleSystem` identifiers. Running `depcruise --output-type json -- src test` produces a graph from which every test file's imports into `src/` can be extracted programmatically. dependency-cruiser also provides built-in [rule definitions](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) like `not-to-test` (preventing production code from importing test code) and `no-orphans` (detecting unreferenced files), both of which rely on regex-based path matching to distinguish test from source files.

For projects wanting tighter programmatic control, [ts-morph](https://ts-morph.com/details/imports) wraps the TypeScript compiler API with methods like `getImportDeclarations()` and `getModuleSpecifierSourceFile()` that resolve import paths to actual `SourceFile` objects. A complete test→source map can be built by iterating test files via `project.getSourceFiles("**/*.{test,spec}.{ts,tsx}")`, calling `getModuleSpecifierSourceFile()` on each import declaration, and filtering out `node_modules` results. This handles path aliases, barrel re-exports, and transitive dependencies natively since it uses TypeScript's own resolution logic.

Jest itself provides an inverse mapping via `jest --findRelatedTests`, which uses its internal `jest-haste-map` module to perform BFS traversal of the dependency graph and find all test files that transitively depend on a given set of changed source files. This is a reverse lookup — source→tests rather than tests→source — and is useful for selective test execution in CI.

**Naming convention matching** offers a fast but lower-fidelity alternative. The algorithm strips `.test` or `.spec` suffixes (`foo.test.ts` → `foo.ts`), handles `__tests__/` directories by resolving to the parent, and maps `test/` or `tests/` roots to `src/`. Edge cases are significant: integration tests that exercise multiple source files, path aliases that break simple string manipulation, barrel files that re-export from multiple modules, and non-standard monorepo layouts all reduce accuracy. Naming conventions work best as a **fast initial heuristic** validated by import analysis.

**Coverage-based mapping** provides runtime-accurate relationships at higher cost. Running each test file in isolation with coverage enabled (e.g., `jest path/to/specific.test.ts --coverage --coverageReporters=json`) produces a `coverage-final.json` whose keys are exactly the source files exercised by that test. This captures transitive dependencies that static analysis also finds, but additionally reveals dynamically loaded modules. The tradeoff is speed: N test files require N separate coverage runs, making this impractical for large codebases unless used selectively for validation.

## Istanbul's output formats map naturally to knowledge graph metadata

Istanbul's reporter ecosystem, shared by Jest, Vitest (via `@vitest/coverage-istanbul` or `@vitest/coverage-v8`), nyc, and [c8](https://github.com/bcoe/c8), produces coverage data in several standardized formats. Two are most relevant for metadata ingestion.

**`coverage-summary.json`** (the `json-summary` reporter) provides file-level aggregates. Each key is an absolute file path; each value contains four metric objects — `lines`, `statements`, `branches`, and `functions` — with `total`, `covered`, `skipped`, and `pct` fields. A `"total"` key provides project-wide aggregates. This format is trivially parseable and maps one-to-one to knowledge graph node properties:

```json
{
  "/src/auth/login.ts": {
    "lines":      { "total": 45, "covered": 38, "skipped": 0, "pct": 84.4 },
    "branches":   { "total": 12, "covered": 8,  "skipped": 0, "pct": 66.7 },
    "functions":  { "total": 6,  "covered": 6,  "skipped": 0, "pct": 100 },
    "statements": { "total": 48, "covered": 40, "skipped": 0, "pct": 83.3 }
  }
}
```

**`coverage-final.json`** (the `json` reporter) provides line-level detail needed for chunk-level annotations. Each file entry contains a `statementMap` (statement ID → `{start: {line, column}, end: {line, column}}`), `fnMap` (function ID → name and location), `branchMap` (branch ID → type and locations), and corresponding count hashes `s`, `f`, and `b`. For a RAG system that chunks source code into segments, these maps allow computing per-chunk coverage by filtering statements, branches, and functions whose locations fall within the chunk's line range.

The **LCOV format** (`lcov.info`) encodes the same data as line-delimited text records. Each source file section begins with `SF:<path>`, contains `DA:<line>,<count>` entries for line coverage, `BRDA:<line>,<block>,<branch>,<taken>` for branch coverage, `FN:<line>,<name>` and `FNDA:<count>,<name>` for function coverage, and closes with summary counters `LF`/`LH` (lines found/hit), `BRF`/`BRH` (branches), and `FNF`/`FNH` (functions). LCOV's text format is widely supported by CI tools and diff-coverage analyzers.

c8, the V8-native coverage tool, differs from Istanbul in mechanism — it reads V8's built-in bytecode-level counters via the `NODE_V8_COVERAGE` environment variable rather than instrumenting source code — but **produces identical output formats** by converting V8 data through `v8-to-istanbul`. c8 accepts all Istanbul reporter names and writes to the same `./coverage` directory structure. The practical difference is **performance**: c8 avoids the ~300% slowdown of source instrumentation, making it the default provider for Vitest since v1.

## Coverage metadata enables reliability-aware retrieval

Integrating coverage data into a RAG knowledge graph requires a two-tier ingestion pipeline. At the file level, `coverage-summary.json` attaches four percentage metrics to each file node. At the chunk level, `coverage-final.json` or LCOV data maps to individual code segments with computed `coveredLines`, `uncoveredLines`, and per-chunk branch/function counts.

This metadata enables several retrieval-time behaviors. When a user queries about code reliability, **chunks with low branch coverage** (below 50%) can be flagged with a warning that edge cases lack test verification. When multiple chunks are equally relevant to a query, a **coverage-weighted confidence score** — such as `base_relevance * (0.7 + 0.3 * coverage_pct / 100)` — can boost well-tested code in ranking. Functions with zero execution count in the `f` hash can be surfaced proactively when a user asks about a module's behavior, noting that specific functions have never been exercised by tests.

The recommended ingestion path runs tests with dual reporters (`--coverage.reporter=json-summary --coverage.reporter=json`), parses both outputs, and stores file-level metrics as node properties alongside chunk-level annotations on embeddings. The `json-summary` format is flat enough for bulk ingestion; `coverage-final.json` requires iterating statement/branch/function maps and intersecting location ranges with chunk boundaries, but the nested structure is well-defined and stable across Istanbul versions.

## Conclusion

Test detection converges on the `.test.`/`.spec.` naming convention, with `__tests__/` directories as a Jest-specific supplement and `test/` as Mocha's default scope. Static import analysis via dependency-cruiser or ts-morph provides the most practical test-to-source mapping — fast, accurate, and path-alias-aware — while coverage-based mapping serves as runtime validation. Istanbul's JSON output formats (`coverage-summary.json` for file-level, `coverage-final.json` for line-level) are the natural serialization layer between test runners and a knowledge graph, requiring no format conversion to serve as node metadata. The key architectural insight is that **file-level coverage percentages are cheap to ingest and immediately useful for retrieval ranking**, while line-level data is worth the parsing cost only when chunk-level coverage annotations add meaningful signal to RAG queries about code quality.