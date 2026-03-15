# Sprint 11 Spec — Language Expansion (Swift / Kotlin / Elixir) + Performance Observability
**Version:** 2.0
**Date:** 2026-03-15
**Pythia version:** 1.5.0
**Status:** REVIEWED (Round 1 complete — 18 findings applied)
**Prerequisite:** Sprint 10 complete (≥399 tests pass)
**Prerequisite:** Sprint 10 complete (≥399 tests pass)

---

## Sprint Goal

Expand Pythia's language coverage to Swift, Kotlin, and Elixir, completing the Tier 1 language expansion deferred from Sprint 10. Simultaneously close three actionable gaps from `docs/EMBEDDING_TEST_PLAN.md`: an `indexing.max_files` cap to prevent runaway indexing on huge repos, a `--perf` flag to surface peak RSS after `pythia init`, and a `--embedding-config` flag on the CSN benchmark script to support multi-backend quality comparisons.

**Language expansion uses tree-sitter exclusively — no compiler, no LSP, no new binary dependencies.** This sprint is pure TypeScript.

---

## Dependency Pre-Flight (MANDATORY before implementation)

Run this in the Pythia repo root BEFORE writing any language chunker code:

```bash
# Verify packages exist and build cleanly on the current Node version
mkdir /tmp/sprint11-dep-test && cd /tmp/sprint11-dep-test && npm init -y
npm install tree-sitter tree-sitter-swift tree-sitter-kotlin tree-sitter-elixir \
  --legacy-peer-deps 2>&1

# Verify all three parsers actually parse (must print three "source" root types)
node -e "
const Swift = require('tree-sitter-swift');
const Kotlin = require('tree-sitter-kotlin');
const Elixir = require('tree-sitter-elixir');
const Parser = require('tree-sitter');
const p = new Parser();
p.setLanguage(Swift);  console.log('Swift:',  p.parse('func f() {}').rootNode.type);
p.setLanguage(Kotlin); console.log('Kotlin:', p.parse('fun f() {}').rootNode.type);
p.setLanguage(Elixir); console.log('Elixir:', p.parse('defmodule A do end').rootNode.type);
"
# Expected output:
# Swift:  source_file
# Kotlin: source_file
# Elixir: source
cd /Users/mikeboscia/pythia
```

If any package fails to build, stop and find an alternative before proceeding.

**Note on peer deps:** `tree-sitter-swift@^0.7.1`, `tree-sitter-kotlin@^0.3.8`, and `tree-sitter-elixir@^0.3.5` declare `peerDependencies` on `tree-sitter ^0.21.0`–`^0.22.1`. The project uses `^0.25.0`. Install with `--legacy-peer-deps`. This is the same situation as existing grammars in the project (`tree-sitter-ruby`, `tree-sitter-c-sharp`). The parsers are verified compatible with 0.25.x.

---

## Proof of Completion

```bash
# scripts/sprint11-proof.mjs
# Runtime: #!/usr/bin/env node with --input-type=module or direct node execution.
# Follow scripts/smoke-test.mjs for MCP server startup pattern.
#
# Phase 1 — Language chunking (CLI: no MCP server needed)
# 1. Write a temp Swift file containing:
#      class MyClass { func greet() -> String { return "hello" } }
#    Parse it via pythia's chunker-treesitter (by spawning: node -e "import(...)" or
#    building a small inline test). Assert: chunk array length > 0, at least one chunk
#    has chunk_type === "function" or chunk_type === "class", language === "swift".
#
# 2. Write a temp Kotlin file containing:
#      class Greeter { fun greet(): String = "hello" }
#    Assert: chunk array contains a chunk with chunk_type === "class", language === "kotlin".
#
# 3. Write a temp Elixir file containing:
#      defmodule Greeter do
#        def hello(), do: "world"
#      end
#    Assert: chunks include one with chunk_type === "module" and one with chunk_type === "function",
#    language === "elixir".
#
# Phase 2 — max_files cap (CLI)
# 4. Create a temp workspace with 5 files (2 .ts, 1 .swift, 1 .kt, 1 .ex) and no .pythiaignore.
#    Run `pythia init` with a config that sets `indexing.max_files: 3`.
#    Assert: stdout contains "[Pythia] File cap reached" or equivalent warning.
#    Assert: the DB contains ≤ 3 indexed files (query file_scan_cache for row count — NOT lcs_chunks, which misses files with zero chunks).
#
# Phase 3 — --perf flag (CLI)
# 5. Run `pythia init --perf` on any workspace that has already been initialized.
#    Assert: stdout contains "[Pythia] Peak RSS:" followed by a number and "MB".
#
# Phase 4 — CSN benchmark --embedding-config (script)
# 6. Run `node scripts/csn-benchmark.mjs --help`.
#    Assert: output includes "--embedding-config".
```

---

## Feature Scope

---

### FEAT-045 — Swift tree-sitter chunker

**Status:** New implementation required.

**New dependency:** `tree-sitter-swift@^0.7.1` (install with `--legacy-peer-deps`).

**New file:** `src/indexer/chunker-swift.ts`

**Modified files:** `src/indexer/chunker-treesitter.ts`, `src/indexer/cdc.ts`, `package.json`

**Extensions:** `.swift` (single extension)

**Strategy name:** Add `"swift"` to the `ChunkStrategy` union type in `chunker-treesitter.ts`.

**Node types to extract** (tree-sitter-swift AST):

| AST node type | `chunk_type` | Name extraction |
|---------------|-------------|-----------------|
| `class_declaration` | `"class"` | `childForFieldName("name")?.text` |
| `protocol_declaration` | `"interface"` | `childForFieldName("name")?.text` |
| `function_declaration` | `"function"` | `childForFieldName("name")?.text` |

**Note on Swift AST quirk:** `tree-sitter-swift` uses `class_declaration` for classes, structs, and enums. Distinguish them only if needed for the `chunk_type` field — for v1, all three map to `"class"`. The body node type (`class_body`, `enum_class_body`) is not used for classification.

**Fallback name:** If `childForFieldName("name")` returns null, use `` `anonymous_L${node.startPosition.row}` ``.

**Walk strategy:** Full recursive walk (same as `extractRubyChunks`). Emit chunks for all matching nodes at any depth. Do NOT deduplicate nested declarations — a method inside a class is a distinct chunk.

**Implementation template** (follow `src/indexer/chunker-ruby.ts` exactly for structure):

```typescript
import Parser from "tree-sitter";
import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

export function extractSwiftChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const typeToChunkType = new Map<string, ChunkType>([
    ["class_declaration", "class"],
    ["protocol_declaration", "interface"],
    ["function_declaration", "function"]
  ]);

  function walk(node: SyntaxNode): void {
    const chunkType = typeToChunkType.get(node.type);
    if (chunkType !== undefined) {
      const name = node.childForFieldName("name")?.text
        ?? `anonymous_L${node.startPosition.row}`;
      chunks.push({
        id: `${filePath}::${chunkType}::${name}`,
        file_path: filePath,
        chunk_type: chunkType,
        content: node.text,
        start_line: node.startPosition.row,
        end_line: node.endPosition.row,
        language: "swift"
      });
    }
    for (const child of node.namedChildren) {
      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
```

**Registration in `chunker-treesitter.ts`:**

Add import:
```typescript
import Swift from "tree-sitter-swift";
import { extractSwiftChunks } from "./chunker-swift.js";
```

Add to `languageConfigEntries`:
```typescript
[".swift", { language: "swift", parserLanguage: Swift as Parser.Language, strategy: "swift" }],
```

Add `"swift"` to the `ChunkStrategy` union type.

Add case to the strategy dispatch (wherever `"ruby"`, `"csharp"` etc. are handled):
```typescript
case "swift":
  return extractSwiftChunks(rootNode, normalizedPath);
```

**Registration in `cdc.ts`:**

Add `".swift"` to the `indexedExtensions` Set.

**Pre-existing bug fix:** Also add `.rb`, `.cs`, `.yaml`, `.yml` to `indexedExtensions` — these chunkers exist from Sprint 8-10 but were never added to the CDC scanner's extension set, so those files are never discovered for indexing.

**Type declaration file:** Do NOT create a `.d.ts` file for `tree-sitter-swift`. The existing pattern in the project only declares types for `tree-sitter-css` (which has a non-standard export shape). Swift's export shape is a default export like Ruby — no `.d.ts` needed.

**Tests** (`src/__tests__/chunker-swift.test.ts` — new file, minimum 12 tests):

| # | Test | Assertion |
|---|------|-----------|
| 1 | Empty file | Returns `[]` |
| 2 | Top-level `func` | One chunk, `chunk_type: "function"`, correct name |
| 3 | `class` with no methods | One chunk, `chunk_type: "class"` |
| 4 | `class` with one method | Two chunks — class + method |
| 5 | `protocol` declaration | One chunk, `chunk_type: "interface"` |
| 6 | `struct` declaration | One chunk, `chunk_type: "class"` |
| 7 | Anonymous node (no name field) | chunk id includes `anonymous_L` |
| 8 | Nested class inside class | Both parent and child class are separate chunks |
| 9 | Mixed file (class + func + protocol) | 3+ chunks, all correct chunk types |
| 10 | File with only comments | Returns `[]` |
| 11 | `language` field | Every chunk has `language: "swift"` |
| 12 | Extension registration | `chunkFile("test.swift", content, workspaceRoot)` returns chunks without throwing |

---

### FEAT-046 — Kotlin tree-sitter chunker

**Status:** New implementation required.

**New dependency:** `tree-sitter-kotlin@^0.3.8` (install with `--legacy-peer-deps`).

**New file:** `src/indexer/chunker-kotlin.ts`

**Modified files:** `src/indexer/chunker-treesitter.ts`, `src/indexer/cdc.ts`, `package.json`

**Extensions:** `.kt`, `.kts`

**Strategy name:** Add `"kotlin"` to the `ChunkStrategy` union type.

**Node types to extract** (tree-sitter-kotlin AST):

| AST node type | `chunk_type` | Name extraction |
|---------------|-------------|-----------------|
| `class_declaration` | `"class"` | First named child of type `type_identifier` or `simple_identifier` |
| `object_declaration` | `"class"` | First named child of type `type_identifier` or `simple_identifier` |
| `function_declaration` | `"function"` | First named child of type `simple_identifier` |

**Note on Kotlin AST:** Unlike Swift, Kotlin's tree-sitter grammar does NOT expose `childForFieldName("name")`. Name extraction requires iterating `node.namedChildren`. **Critical:** `class_declaration` and `object_declaration` use `type_identifier` for names, while `function_declaration` uses `simple_identifier`. The helper must check for both node types.

**Name extraction helper:**

```typescript
function getKotlinName(node: SyntaxNode, fallbackRow: number): string {
  for (const child of node.namedChildren) {
    if (child.type === "simple_identifier" || child.type === "type_identifier") {
      return child.text;
    }
  }
  return `anonymous_L${fallbackRow}`;
}
```

**Walk strategy:** Full recursive walk. `object_declaration` in Kotlin is a singleton — chunk it as `"class"`.

**Registration in `chunker-treesitter.ts`:**

Add import:
```typescript
import Kotlin from "tree-sitter-kotlin";
import { extractKotlinChunks } from "./chunker-kotlin.js";
```

Add to `languageConfigEntries`:
```typescript
[".kt",  { language: "kotlin", parserLanguage: Kotlin as Parser.Language, strategy: "kotlin" }],
[".kts", { language: "kotlin", parserLanguage: Kotlin as Parser.Language, strategy: "kotlin" }],
```

**Registration in `cdc.ts`:** Add `".kt"` and `".kts"` to `indexedExtensions`.

**Tests** (`src/__tests__/chunker-kotlin.test.ts` — new file, minimum 12 tests):

| # | Test | Assertion |
|---|------|-----------|
| 1 | Empty file | Returns `[]` |
| 2 | Top-level `fun` | One chunk, `chunk_type: "function"` |
| 3 | `class` with no methods | One chunk, `chunk_type: "class"` |
| 4 | `class` with one method | Two chunks — class + method |
| 5 | `object` declaration (singleton) | One chunk, `chunk_type: "class"` |
| 6 | Kotlin `interface` declaration | ≥1 chunk, `chunk_type === "class"` (tree-sitter-kotlin emits `class_declaration` for interfaces) |
| 7 | Anonymous node (no simple_identifier child) | chunk id includes `anonymous_L` |
| 8 | Nested class inside class | Both are separate chunks |
| 9 | Mixed file (class + object + fun) | 3+ chunks, all correct chunk types |
| 10 | `.kts` script file | Extension is recognized, at least one chunk returned |
| 11 | `language` field | Every chunk has `language: "kotlin"` |
| 12 | Extension registration | Does not throw |

---

### FEAT-047 — Elixir tree-sitter chunker

**Status:** New implementation required.

**New dependency:** `tree-sitter-elixir@^0.3.5` (install with `--legacy-peer-deps`).

**New file:** `src/indexer/chunker-elixir.ts`

**Modified files:** `src/indexer/chunker-treesitter.ts`, `src/indexer/cdc.ts`, `package.json`

**Extensions:** `.ex`, `.exs`

**Strategy name:** Add `"elixir"` to the `ChunkStrategy` union type.

**AST Structure (Critical):** Unlike all other supported languages, Elixir's tree-sitter grammar represents ALL named constructs as generic `call` nodes. Identification requires inspecting the first named child:

```
call
  identifier  ← text is "defmodule", "def", "defp", "defprotocol", "defmacro"
  arguments   ← contains the name and body
  do_block    ← the body (for defmodule, defprotocol)
```

**Node mapping:**

| First `identifier` child text | `chunk_type` | Name source |
|-------------------------------|-------------|-------------|
| `defmodule` | `"module"` | `arguments` → first child (an `alias` or `atom` node) → `.text` |
| `def` | `"function"` | `arguments` → first child (a `call` node) → first named child identifier → `.text` |
| `defp` | `"function"` | Same as `def` |
| `defmacro` | `"function"` | Same as `def` |
| `defprotocol` | `"interface"` | `arguments` → first child → `.text` |

**Walk strategy:** Walk all nodes. For each `call` node, inspect only its FIRST named child. If it is an `identifier` node with text in the target set, emit a chunk. Recurse into all children regardless (to capture nested `def` inside `defmodule`).

**Name extraction details:**

```typescript
// For defmodule/defprotocol:
// call → arguments → first named child is an alias (e.g. "MyModule") or atom
const args = node.childForFieldName?.("arguments")
  ?? node.namedChildren.find(c => c.type === "arguments");
const name = args?.firstNamedChild?.text ?? `anonymous_L${node.startPosition.row}`;

// For def/defp/defmacro:
// call → arguments → first named child is a call (e.g. "greet(arg)")
// The function name is the first named child of THAT inner call
const innerCall = args?.firstNamedChild;
const fnName = innerCall?.firstNamedChild?.text
  ?? innerCall?.text?.split("(")[0]
  ?? `anonymous_L${node.startPosition.row}`;
```

**Full implementation template:**

```typescript
import Parser from "tree-sitter";
import type { Chunk } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

const ELIXIR_DEF_TO_CHUNK_TYPE: Record<string, string> = {
  defmodule: "module",
  defprotocol: "interface",
  def: "function",
  defp: "function",
  defmacro: "function"
};

function getElixirName(defKeyword: string, callNode: SyntaxNode): string {
  // arguments is the second named child of a call node
  const args = callNode.namedChildren[1];
  const firstArg = args?.firstNamedChild;
  if (!firstArg) return `anonymous_L${callNode.startPosition.row}`;

  if (defKeyword === "defmodule" || defKeyword === "defprotocol") {
    return firstArg.text;
  }

  // def/defp/defmacro: firstArg is a call node like `greet()` or `greet(arg)`
  // The function name is the first identifier child of firstArg
  const fnNameNode = firstArg.type === "call"
    ? firstArg.firstNamedChild
    : firstArg;
  return fnNameNode?.text?.split("(")[0] ?? `anonymous_L${callNode.startPosition.row}`;
}

export function extractElixirChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  function walk(node: SyntaxNode): void {
    if (node.type === "call") {
      const firstChild = node.firstNamedChild;
      if (firstChild?.type === "identifier") {
        const chunkType = ELIXIR_DEF_TO_CHUNK_TYPE[firstChild.text];
        if (chunkType !== undefined) {
          const name = getElixirName(firstChild.text, node);
          chunks.push({
            id: `${filePath}::${chunkType}::${name}`,
            file_path: filePath,
            chunk_type: chunkType,
            content: node.text,
            start_line: node.startPosition.row,
            end_line: node.endPosition.row,
            language: "elixir"
          });
        }
      }
    }
    for (const child of node.namedChildren) {
      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
```

**Registration in `chunker-treesitter.ts`:**

```typescript
import Elixir from "tree-sitter-elixir";
import { extractElixirChunks } from "./chunker-elixir.js";
```

```typescript
[".ex",  { language: "elixir", parserLanguage: Elixir as Parser.Language, strategy: "elixir" }],
[".exs", { language: "elixir", parserLanguage: Elixir as Parser.Language, strategy: "elixir" }],
```

**Registration in `cdc.ts`:** Add `".ex"` and `".exs"` to `indexedExtensions`.

**Tests** (`src/__tests__/chunker-elixir.test.ts` — new file, minimum 14 tests):

| # | Test | Assertion |
|---|------|-----------|
| 1 | Empty file | Returns `[]` |
| 2 | `defmodule` only | One chunk, `chunk_type: "module"`, correct name |
| 3 | `def` inside `defmodule` | Two chunks — module + function |
| 4 | `defp` (private function) | Chunk with `chunk_type: "function"` |
| 5 | `defmacro` | Chunk with `chunk_type: "function"` |
| 6 | `defprotocol` | Chunk with `chunk_type: "interface"` |
| 7 | Multiple `def` in one module | All are separate function chunks |
| 8 | Nested modules | Both outer and inner `defmodule` produce chunks |
| 9 | Module name (e.g. `Foo.Bar`) | `.text` includes the dot notation |
| 10 | Function with args (`def greet(name)`) | Name extracted correctly as `"greet"` |
| 11 | No-arg function with keyword syntax (`def f(), do: 1`) | Chunk extracted |
| 12 | Non-def call (e.g. `IO.puts("x")`) | NOT included in chunks |
| 13 | `language` field | Every chunk has `language: "elixir"` |
| 14 | Extension registration | Does not throw for `.exs` files |

---

### FEAT-048 — `indexing.max_files` config knob

**Status:** New implementation required.

**Modified files:** `src/config.ts`, `src/indexer/cdc.ts`

**Purpose:** Prevent runaway indexing on massive repos (e.g., accidentally indexing without a `.pythiaignore`, or on repos with hundreds of thousands of generated files). Sets a hard cap on the number of files that will be indexed per `pythia init` run.

**Config schema change (`src/config.ts`):**

Add to `indexingSchema`:
```typescript
max_files: z.number().int().min(1).optional(),
```

No default value — `undefined` means uncapped (preserving existing behavior).

**CDC enforcer (`src/indexer/cdc.ts`):**

The `scanWorkspace` function signature must be updated to accept `maxFiles` as a **4th parameter**, preserving the existing `forceReindex` boolean:

```typescript
export async function scanWorkspace(
  workspaceRoot: string,
  db: Database.Database,
  forceReindex: boolean = false,
  options?: { maxFiles?: number }
): Promise<FileChange[]>
```

**IMPORTANT:** The existing 3rd parameter `forceReindex: boolean` MUST be preserved. It is used by:
- `src/cli/init.ts:265` — passes `options.force === true`
- `src/index.ts:35` — passes `false`
- `src/mcp/force-index.ts` (lines 133, 145, 188, 196) — passes `false`

None of these callers need changes — they don't pass `maxFiles`, so the 4th param defaults to `undefined` (no cap).

After building the full list of file changes (`fileChanges`), apply the cap BEFORE returning:

```typescript
if (options?.maxFiles !== undefined && fileChanges.length > options.maxFiles) {
  const capped = fileChanges.slice(0, options.maxFiles);
  console.warn(
    `[Pythia] File cap reached: indexing ${options.maxFiles.toLocaleString()} of ` +
    `${fileChanges.length.toLocaleString()} discovered files. ` +
    `Set indexing.max_files higher or add more rules to .pythiaignore.`
  );
  return capped;
}
```

**Warning message format:** Use `.toLocaleString()` for both counts. The warning prints to `stderr` via `console.warn` (not `console.log`).

**Caller update (`src/cli/init.ts`):** Pass `config.indexing.max_files` to `scanWorkspace`. Note: `scanWorkspaceImpl` is on the `dependencies` object (type `InitDependencies`), NOT `options` (type `InitOptions`):

```typescript
const fileChanges = await scanWorkspaceImpl(
  workspaceRoot, db, options.force === true, { maxFiles: config.indexing.max_files }
);
```

**Tests** (`src/__tests__/cdc.test.ts` — add to existing file, minimum 5 new tests):

| # | Test | Assertion |
|---|------|-----------|
| 1 | `max_files` undefined | All files returned (no cap applied) |
| 2 | `max_files` ≥ file count | All files returned, no warning |
| 3 | `max_files` < file count | Returns exactly `max_files` entries |
| 4 | `max_files` = 1 | Returns exactly 1 entry |
| 5 | Warning message | `console.warn` called with message containing "File cap reached" when cap is hit |

---

### FEAT-049 — `pythia init --perf` flag

**Status:** New implementation required.

**Modified files:** `src/cli/init.ts`

**Purpose:** Print peak RSS (resident set size) after `pythia init` completes, so users can verify that the OOM fix is effective and measure memory usage across embedding modes.

**CLI option** (add to `initCommand` in `src/cli/init.ts` — NOT `main.ts`, which only registers the pre-built command):
```typescript
.option("--perf", "Print peak RSS memory usage after init completes")
```

**`InitOptions` type update** (in `src/cli/init.ts`):
```typescript
type InitOptions = {
  config?: string;
  force?: boolean;
  perf?: boolean;
  workspace?: string;
};
```

**Output** (print to `stdout` at the very end of `runInit`, after the health summary, in ALL THREE return paths):

1. **Already-initialized early return** (init.ts:258) — after `reportCorpusHealth`
2. **Zero-file-changes early return** (init.ts:271-275) — after `reportCorpusHealth`
3. **Normal indexing path** (init.ts:314-318) — after `reportCorpusHealth`

```typescript
if (options.perf === true) {
  const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
  console.log(`[Pythia] Peak RSS: ${rssMb} MB`);
}
```

**Note:** `process.memoryUsage().rss` is the current RSS at the time of the call, not a true "peak" (Node.js doesn't expose peak RSS without native addons). The flag name is `--perf` and the label says "Peak RSS" for user-facing clarity — the implementation uses current RSS as a practical proxy. Document this behavior in a comment in the code:

```typescript
// Note: rss here is current RSS, not peak RSS. Node.js does not expose peak RSS
// without native addons. This is a practical proxy for post-init memory usage.
```

**Tests** (`src/__tests__/cli.test.ts` — add to existing file, minimum 4 new tests):

| # | Test | Assertion |
|---|------|-----------|
| 1 | `--perf` absent | No "Peak RSS" line in stdout |
| 2 | `--perf` present | stdout contains `[Pythia] Peak RSS:` followed by a decimal number and ` MB` |
| 3 | `--perf` value format | RSS value matches `/^\d+\.\d{2} MB$/` |
| 4 | `--perf` placement | "Peak RSS" line appears AFTER the health summary header |

---

### FEAT-050 — CSN benchmark `--embedding-config` flag

**Status:** New implementation required.

**Modified file:** `scripts/csn-benchmark.mjs`

**Purpose:** Allow the CSN benchmark to compare retrieval quality across embedding backends (local ONNX, homebox Ollama, Vertex AI) without hardcoding the local mode. Closes the "CSN benchmark uses local mode only" gap from `docs/EMBEDDING_TEST_PLAN.md`.

**New CLI flag:**
```
--embedding-config <path>   Path to a JSON file containing an embeddings config object.
                            If omitted, uses the embeddings config from the workspace config.
```

**Behavior:**
1. If `--embedding-config <path>` is provided: read the file, parse as JSON, extract the `embeddings` key, and validate it using `configSchema.shape.embeddings.parse(parsed.embeddings)` (from `src/config.ts` — `configSchema` is exported, `embeddingsSchema` is not). Invalid JSON, missing `embeddings` key, or Zod validation failure: print error and exit with code 1.
2. If `--embedding-config` is not provided: use the existing behavior (read from `~/.pythia/config.json`).

**Implementation contract:** The `--embedding-config` flag is additive — it does not change any other benchmark behavior. Sample counts, language filter, output format, and baseline comparison are all unchanged.

**Example usage** (as documented in `docs/EMBEDDING_TEST_PLAN.md` Scenario 2):
```bash
node scripts/csn-benchmark.mjs \
  --samples 500 \
  --lang javascript \
  --embedding-config /tmp/pythia-homebox-config.json
```

Where `/tmp/pythia-homebox-config.json` contains:
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "http://192.168.2.110:11434",
    "api_key": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 256
  }
}
```

**`--help` output requirement:** The flag must appear in `--help` output. This is the assertion in the proof script (Step 6).

**Tests:** None required for this feature — it's a script, not a TypeScript module. The proof script assertion (Step 6: `--help` includes `--embedding-config`) is sufficient.

---

## Files to Create

| File | Owner | Purpose |
|------|-------|---------|
| `src/indexer/chunker-swift.ts` | Worker | Swift chunk extractor |
| `src/indexer/chunker-kotlin.ts` | Worker | Kotlin chunk extractor |
| `src/indexer/chunker-elixir.ts` | Worker | Elixir chunk extractor |
| `src/__tests__/chunker-swift.test.ts` | Worker | Swift chunker tests (≥12) |
| `src/__tests__/chunker-kotlin.test.ts` | Worker | Kotlin chunker tests (≥12) |
| `src/__tests__/chunker-elixir.test.ts` | Worker | Elixir chunker tests (≥14) |
| `scripts/sprint11-proof.mjs` | Worker | Proof script |
| `.npmrc` | Worker | `legacy-peer-deps=true` for CI compatibility |

---

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `tree-sitter-swift`, `tree-sitter-kotlin`, `tree-sitter-elixir` |
| `src/indexer/chunker-treesitter.ts` | Add imports, language config entries, strategy cases, ChunkStrategy union |
| `src/indexer/cdc.ts` | Add `.swift`, `.kt`, `.kts`, `.ex`, `.exs`, `.rb`, `.cs`, `.yaml`, `.yml` to `indexedExtensions`; add `maxFiles` as 4th param to `scanWorkspace` |
| `src/config.ts` | Add `max_files` to `indexingSchema` |
| `src/cli/init.ts` | Add `--perf` option to `initCommand`; add `perf` to `InitOptions`; print Peak RSS in all 3 return paths; pass `max_files` to `scanWorkspace` |
| `src/__tests__/cdc.test.ts` | Add 5 new tests for `max_files` |
| `src/__tests__/cli.test.ts` | Add 4 new tests for `--perf` |
| `scripts/csn-benchmark.mjs` | Add `--embedding-config` flag |
| `README.md` | Append Swift, Kotlin, Elixir, Ruby, C#, YAML to supported languages paragraph in `## Architecture`; add `max_files` to JSON example in `## Configuration`; add `--perf` to `## Quickstart` |

---

## Constraints

1. **No new npm dependencies other than the three tree-sitter grammars.** Install with `--legacy-peer-deps`. **Create `.npmrc`** in the project root containing `legacy-peer-deps=true` so `npm ci` works in CI without flags.
2. **`max_files` is optional in the config schema.** Omitting it preserves existing behavior exactly. Do not add a default value.
3. **The `--perf` flag uses `process.memoryUsage().rss`.** Do not use any native addon or external library to measure memory. Add the comment explaining it's current RSS, not true peak.
4. **No compiler or LSP integration.** Language support is tree-sitter fast-path only.
5. **No changes to existing tests.** All 399 passing tests must continue to pass.
6. **Minimum test gate: ≥449.** That is 399 + 50 minimum new tests (12 Swift + 12 Kotlin + 14 Elixir + 5 CDC + 4 CLI + 3 integration/registration = 50).
7. **README update is mandatory.** Append Swift, Kotlin, Elixir, Ruby, C#, YAML to the supported languages paragraph in `## Architecture` (line 210 — it's a paragraph, not a table). Add `indexing.max_files` to the JSON example under `## Configuration`. Add `--perf` example to the `## Quickstart` section. CLAUDE.md project rule: "Whenever new languages, tools, or CLI commands are implemented, update the Supported languages, MCP Tools, and Quick Context sections in `README.md` in the same commit."
8. **`console.warn` for the cap warning, not `console.log`.** The CDC scanner prints to stderr.

---

## Test Count Baseline

- **Sprint 10 gate:** ≥399 (current passing: 399)
- **Sprint 11 gate:** ≥449
- **New tests breakdown:**
  - Swift chunker: ≥12
  - Kotlin chunker: ≥12
  - Elixir chunker: ≥14
  - CDC `max_files`: ≥5
  - CLI `--perf`: ≥4
  - Registration/integration (chunker-languages.test.ts or similar): ≥3 (1 per language)
  - Total minimum: ≥50 new tests (399 + 50 = 449)

---

## Known Gaps (Deferred to Sprint 12)

| Gap | Impact | Deferred Because |
|-----|--------|-----------------|
| Tier 2 language support (LSP/compiler integration for call graph extraction) | Richer graph edges for Swift/Kotlin/Elixir | Requires compiler toolchain — separate design |
| Log rotation / gzip archive for JSONL interaction logs | Storage management | Lower urgency than language expansion |
| Hash-chain integrity for oracle checkpoints | Tamper-evidence | Phase 4 oracle feature |
| Actual peak RSS tracking (via `/proc/self/status` or similar) | More accurate `--perf` output | Native addon complexity; current RSS proxy is sufficient for v1 |
| CSN benchmark multi-run comparison report | Quality comparison across backends | Separate reporting feature |
