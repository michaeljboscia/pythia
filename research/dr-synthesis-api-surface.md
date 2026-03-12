# DR Synthesis — `pythia_api_surface` Architecture
**Date:** 2026-03-12
**Based on:** dr-prompt-api-surface-tier1-compilers.md, tier2-lsp.md, tier3-treesitter.md + Gemini DR results

---

## Key Findings That Changed the Pre-DR Design

| Decision | Pre-DR Assumption | Post-DR Reality |
|----------|------------------|-----------------|
| Tier 1 vs Tier 3 priority | Compiler = primary, tree-sitter = fallback | **Inverted** — tree-sitter always runs, compiler enriches |
| Java | Needs JVM spawn | `java-parser` npm is pure JS, no JVM required |
| Rust compiler | Available, stable | Nightly-only, requires full Cargo.toml — tree-sitter better for single files |
| Kotlin | Expected good tooling | Weakest of all 6 — BCV is text output + requires Gradle project |
| Universal tree-sitter query | Assumed possible | **Impossible** — two-step: match node → slice to `body.startIndex` |
| LSP client package | Unclear | `vscode-jsonrpc` + `vscode-languageserver-protocol` — NOT `vscode-languageclient` (requires VS Code) |
| Idle LSP shutdown | Assumed editors do this | **No editor does this** — novel feature, 5 min is correct timeout |

---

## Converged Architecture

```
pythia_api_surface(file_path, language)
  │
  ├── ALWAYS: tree-sitter skeleton query          ← primary layer, <170ms, 12 static query files
  │     └── match declaration nodes
  │         → childForFieldName('body')
  │         → source.slice(node.startIndex, body.startIndex)
  │
  ├── IF compiler available: enrich               ← enrichment layer, lazy detection
  │     ├── TypeScript  →  ts-morph in-memory .d.ts emit
  │     ├── Swift       →  swift symbolgraph-extract (ships with every toolchain, best JSON)
  │     ├── C#          →  dotnet-script + Roslyn scripting
  │     ├── Go          →  custom go/packages binary (go-outline lacks type sigs)
  │     ├── Java        →  java-parser npm (pure JS, no JVM)
  │     ├── Rust        →  SKIP — nightly + full Cargo required, not worth the dependency
  │     └── Kotlin      →  SKIP — BCV requires Gradle project, not file-level
  │
  └── IF LSP requested: Tier 2 hover+definition   ← optional, on-demand only
        └── vscode-jsonrpc + vscode-languageserver-protocol (NOT vscode-languageclient)
              Lazy-start singletons per language, 5-min idle shutdown (novel)
              Pyright (Python) / clangd (C/C++) / ruby-lsp (Ruby) / Intelephense (PHP)
```

---

## Tree-sitter Skeleton Extraction (Tier 3 — Always Runs)

### The canonical two-step pattern
```typescript
function extractSkeleton(source: string, node: Parser.SyntaxNode, bodyField = 'body'): string {
  const body = node.childForFieldName(bodyField);
  if (body) {
    return source.slice(node.startIndex, body.startIndex).trimEnd();
  }
  return node.text; // No body — prototype, abstract method, interface declaration
}
```

**There is no single tree-sitter query that excludes a body from its captured range.**
Queries identify *what* to extract; `childForFieldName('body')` + byte-offset slicing determines *how much*.

### Body node names by language (critical — they are all different)

| Language | Function Node | Body Node | Name Field Type | Params Node | Return Type Field |
|----------|--------------|-----------|-----------------|-------------|-------------------|
| Python | `function_definition` | `block` | `identifier` | `parameters` | `return_type:` |
| PHP | `function_definition` / `method_declaration` | `compound_statement` | **`name`** | `formal_parameters` | `return_type:` |
| Ruby | `method` / `singleton_method` | **`body_statement`** | `identifier` | **`method_parameters`** | — |
| Lua | `function_declaration` | `block` | `identifier` / `dot_index_expression` | `parameters` | — |
| Bash | `function_definition` | `compound_statement` | **`word`** | — | — |
| Go | `function_declaration` / `method_declaration` | `block` | `identifier` / **`field_identifier`** | **`parameter_list`** | **`result:`** |
| Rust | **`function_item`** | `block` | `identifier` / **`type_identifier`** | `parameters` | `return_type:` |
| Java | `method_declaration` | `block` | `identifier` | `formal_parameters` | **`type:`** |
| C | `function_definition` | `compound_statement` | `identifier` (nested) | `parameter_list` | — |
| C++ | `function_definition` | `compound_statement` | `identifier` (nested) | `parameter_list` | — |
| SQL | varies by dialect | varies | varies | varies | varies |
| CSS | — | `block` | — | — | — |

### Error recovery
- `tree.rootNode.hasError` — fast file-level signal
- `node.hasError` — per-declaration check
- Emit `parseErrors: true` flag, never skip declaration silently
- `ERROR` nodes in one function can absorb subsequent valid declarations (missing brace problem — no workaround)

### Performance
- 10,000-line file: ~100–170ms (well within 500ms budget)
- `node-tree-sitter` (native N-API) — correct choice for Node.js 22
- `web-tree-sitter` (WASM) — 1.5–3× slower, use only as zero-native-dep fallback

### Community prior art
- nvim-treesitter `textobjects.scm` has `@function.outer` / `@function.inner` — maps directly to skeleton concept
- Each grammar's `queries/tags.scm` uses `@definition.function` / `@name` — start here, extend with `@params` / `@return_type`
- **No npm package** exists with pre-written skeleton queries — must write 12 static query files

---

## Compiler Enrichment (Tier 1 — Lazy, When Available)

### Per-language summary

**TypeScript**: `ts-morph` in-memory `.d.ts` emit. 80-90% token reduction. JSDoc preserved. `removeComments: false`. Already designed.

**Swift**: `swift symbolgraph-extract` — richest JSON of any language. Ships with every Swift toolchain. Produces `symbols.json` with `kind`, `accessLevel`, `functionSignature`, `docComment`, `declarationFragments`. For single files without compiled module: `swiftc -dump-ast -dump-ast-format json` (Swift 6.0+). **Best Tier 1 language.**

**C#**: `dotnet-script` + Roslyn scripting via `Microsoft.CodeAnalysis`. Works on individual `.cs` files. First invocation slow (NuGet restore ~3-5s), subsequent calls ~1-2s. Full control over JSON output structure.

**Go**: `go-outline` (JSON array, but no type signatures) OR custom binary wrapping `go/packages` + `go/doc`. `go doc` has no `-json` flag. Custom binary gives full type info, must be pre-compiled. `go-outline` adequate for name/kind extraction only.

**Java**: `java-parser` npm (~326K weekly downloads, JHipster team). **Pure JavaScript, zero JVM dependency.** Produces CST — requires walker to extract declarations. Alternatively: Roseau CLI (JVM-based, JSON output, requires Java 17+).

**Rust**: **Skip compiler path.** `rustdoc --output-format json` is nightly-only, unstable (format changes frequently), requires full `Cargo.toml` context. Tree-sitter skeleton is the correct choice for single-file Rust.

**Kotlin**: **Skip compiler path.** Binary Compatibility Validator produces text `.api` format (not JSON), requires a Gradle project. Tree-sitter skeleton only.

### Detection and fallback
```typescript
import which from 'which';
import { execa } from 'execa';

// Lazy detection with 1-hour TTL cache
const detectionCache = new Map<string, { result: boolean; ts: number }>();

async function detectTool(name: string): Promise<boolean> {
  const cached = detectionCache.get(name);
  if (cached && Date.now() - cached.ts < 3_600_000) return cached.result;
  const result = await which(name).then(() => true).catch(() => false);
  detectionCache.set(name, { result, ts: Date.now() });
  return result;
}
```

Fallthrough on any compiler failure — always fall through to tree-sitter, never return an error.

---

## LSP Layer (Tier 2 — On-Demand, Lazy-Start)

### Package stack
```bash
npm install vscode-jsonrpc vscode-languageserver-protocol
# NOT: vscode-languageclient (requires VS Code internal modules)
```

### Per-language servers
| Language | Server | Install | Idle Memory | Cold Start |
|----------|--------|---------|------------|------------|
| Python | `pyright-langserver --stdio` | `npm install -g pyright` | 100–150 MB | 1–3s |
| C/C++ | `clangd --stdio -j 2` | `brew install llvm` | 50–100 MB | 0.5–2s |
| Ruby | `ruby-lsp` | `gem install ruby-lsp` | 50–100 MB | 1–3s |
| PHP | `intelephense --stdio` | `npm install -g intelephense` | 50–100 MB | ~1s |

Combined idle: **250–450 MB** — fits comfortably in 4 GB daemon.

### Lifecycle state machine
`Idle` → `Starting(Promise)` → `Running { connection, idleTimer }` → `ShuttingDown`

- Idle timeout: **5 minutes** (novel — no production editor does this)
- Crash circuit breaker: 3 crashes in 2 minutes → stop restarting
- `detached: false` on spawn — child dies with parent (zombie prevention)
- Graceful shutdown: `shutdown` request → `exit` notification → SIGTERM → 3s → SIGKILL

### Minimum request sequence (7 messages)
1. `initialize` (request)
2. `initialized` (notification)
3. `textDocument/didOpen` (notification)
4. Wait ~1-5s for server to analyze (first request only)
5. `textDocument/hover` (request)
6. `textDocument/definition` (request) → open definition file → hover on definition
7. `textDocument/didClose` (notification)

---

## Output Schema (Locked)

```typescript
interface ApiSurfaceResult {
  symbols: ApiSymbol[];
  metadata: {
    extractionTier: 'compiler' | 'lsp' | 'tree-sitter' | 'none';
    fidelity: 'high' | 'medium' | 'low';
    toolUsed: string;
    language: string;
    parseTimeMs: number;
    warnings: string[];
  };
}

interface ApiSymbol {
  name: string;
  kind: 'function' | 'method' | 'class' | 'struct' | 'enum' | 'interface' |
        'type' | 'constant' | 'field' | 'constructor';
  signature: string;           // full declaration header, body stripped
  parameters: ApiParameter[];
  returnType: string | null;
  visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  languageTyped: boolean;      // false for Ruby, Lua, Bash, unannotated Python
  docComment: string | null;
  decorators: string[];
  parseErrors: boolean;        // true if extraction was partial due to syntax errors
}

interface ApiParameter {
  name: string;
  type: string | null;         // null for dynamically-typed languages
  default: string | null;
}
```

**Rule for untyped languages**: `"type": null` + `"languageTyped": false` — never omit the field, never use `"type": "any"`. Uniform nullable schema is what LLMs handle best.

---

## Sprint 8 Scope Boundary (Codex's exact words)

> "File-local syntactic truth, not transitive semantic truth."

- Returns declarations, explicit exports, constructor params, enum members, visibility markers **present in the file**
- Does NOT expand `export *` across files
- Does NOT chase transitive type imports
- Explicit `unsupported` and `parse_errors` fields — no silent omission

GVR loop (feed `tsc` compilation errors back to re-extract missing surface) → **Sprint 9**.

---

## npm Dependency Stack

| Concern | Package | ESM? |
|---------|---------|------|
| Binary detection | `which` | ✅ Hybrid |
| Command execution | `execa` v9 | ✅ ESM-only |
| Tree-sitter core | `tree-sitter` (CJS via `createRequire`) | CJS |
| WASM fallback | `web-tree-sitter` | ✅ |
| Java parsing (no JVM) | `java-parser` | ✅ |
| LSP transport | `vscode-jsonrpc` + `vscode-languageserver-protocol` | ✅ |

---

## Prior Art Summary

- **GitHub code navigation**: tree-sitter `tags.scm` (heuristic) + stack graphs (precise, TS/JS/Python only) — validates tree-sitter-as-primary approach
- **Sourcegraph SCIP**: per-language compiler forks, whole-project indexing — too heavy for interactive use
- **Microsoft `multilspy`**: Python library for programmatic LSP client management (NeurIPS 2023) — closest prior art to Tier 2 design
- **Serena MCP server**: wraps `multilspy` behind MCP tools (`find_symbol`, `find_referencing_symbols`) — validates the MCP+LSP combination
- **nvim-treesitter**: `textobjects.scm` `@function.outer`/`@function.inner` — closest existing skeleton extraction implementation
