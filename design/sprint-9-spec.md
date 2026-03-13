# Sprint 9 Spec — Sovereign Oracle & API Surface Extraction
**Version:** 3.0
**Date:** 2026-03-12
**Pythia version:** 1.5.0
**Status:** DRAFT (two rounds of twin review incorporated)
**Prerequisite:** Sprint 8 complete (✓ as of 2026-03-12, 328/328 tests pass)

---

## Sprint Goal

Make Pythia fully sovereign by introducing `LocalReasoningProvider` backed by Ollama/LM Studio for zero-network, air-gapped operations. Introduce `pythia_api_surface` — a new MCP tool for accurate structural awareness using a dual-path architecture (`ts-morph` + `tree-sitter`). Expand language breadth to Tier 3 (Ruby, C#, YAML).

**FEAT-031 (`oracle_add_to_corpus` batch mode) is OUT OF SCOPE for this sprint.** That feature lives in `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` — a separate codebase. Do not touch that file.

---

## Proof of Completion

```
pythia init on a project with TypeScript, Ruby, and C# files
→ reasoning.mode = "local" correctly hits local Ollama instance without external network calls
→ pythia_api_surface returns .d.ts text for TypeScript files via ts-morph
→ pythia_api_surface returns skeleton text for Ruby/C# files via tree-sitter
→ .rb and .cs files are indexed and chunked correctly
→ .yaml/.yml files are indexed and chunked correctly
→ npm test shows ≥378 passing tests
```

---

## Feature Scope

### FEAT-037 — LocalReasoningProvider (Sovereign Oracle)
**Status:** New implementation required.

**Config schema addition in `src/config.ts`:**

The existing `reasoning` config is a discriminated union. Add a third branch:
```typescript
z.object({
  mode: z.literal("local"),
  ollama_base_url: z.string().url().default("http://localhost:11434"),
  ollama_model: z.string().min(1)   // required — no default
})
```

**Interface addition in `src/oracle/provider.ts`:**

Add `describe()` to the `ReasoningProvider` interface:
```typescript
export interface ReasoningProvider {
  query(prompt: string, context: string[]): Promise<string>;
  healthCheck(): Promise<boolean>;
  describe(): { provider: string; model: string };
}
```

Add `describe()` to both existing providers:
- `CliReasoningProvider.describe()` → `{ provider: "gemini-cli", model: "gemini" }`
- `SdkReasoningProvider.describe()` → `{ provider: "gemini-sdk", model: "gemini-2.5-flash" }`

Fix the hardcoded string in `src/mcp/ask-oracle.ts` line 211:
```typescript
// BEFORE:
model: "gemini-2.5-flash",
// AFTER — spread describe() result into the object:
...provider.describe(),
```

**Worker A must also update `src/__tests__/ask-oracle.test.ts`** — there are four object-literal stubs (approximately lines 74, 117, 168, 226) that implement `ReasoningProvider` with only `query` and `healthCheck`. All four must have `describe()` added:
```typescript
describe: () => ({ provider: "test", model: "test-model" })
```
Without this, `npm run build:test` will fail with TypeScript interface errors before any test runs.

**New file `src/oracle/local-provider.ts`:**

```typescript
import type { ReasoningProvider } from "./provider.js";

export class LocalReasoningProvider implements ReasoningProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  async query(prompt: string, context: string[]): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      messages: [{ role: "user", content: [prompt, ...context].join("\n\n") }],
      stream: false
    });
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
    } catch (err) {
      throw new Error(`PROVIDER_UNAVAILABLE: local provider unreachable at ${this.baseUrl}: ${String(err)}`);
    }
    if (!response.ok) {
      throw new Error(`PROVIDER_UNAVAILABLE: /v1/chat/completions returned HTTP ${response.status}`);
    }
    const json = await response.json() as { choices: Array<{ message: { content: string } }> };
    return json.choices[0].message.content;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/models`);
      if (!response.ok) { return false; }
      const json = await response.json() as { data: Array<{ id: string }> };
      return json.data.some((m) => m.id === this.model);
    } catch {
      return false;
    }
  }

  describe(): { provider: string; model: string } {
    return { provider: "local", model: this.model };
  }
}
```

**Factory update in `src/oracle/provider.ts`:**
```typescript
if (config.reasoning.mode === "local") {
  return new LocalReasoningProvider(
    config.reasoning.ollama_base_url,
    config.reasoning.ollama_model
  );
}
```

**Tests use stubbed `fetchImpl` — NOT a real HTTP server.** Instantiate `LocalReasoningProvider` directly with a stub:
```typescript
const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  if (url.endsWith("/v1/chat/completions")) {
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
  }
  // /v1/models
  return new Response(JSON.stringify({ data: [{ id: "llama3" }] }), { status: 200 });
};
const provider = new LocalReasoningProvider("http://localhost:11434", "llama3", fakeFetch);
```

**Acceptance criteria:**
- [ ] Config accepts `mode: "local"` with required `ollama_model` and default base URL.
- [ ] `createReasoningProvider` returns `LocalReasoningProvider` when `mode === "local"`.
- [ ] `ReasoningProvider` interface has `describe()`; all three providers implement it.
- [ ] `ask-oracle.ts` spreads `provider.describe()` — no hardcoded model string.
- [ ] All four mocks in `ask-oracle.test.ts` have `describe()` stub — `npm run build:test` passes.
- [ ] Stubbed `fetchImpl` tests: correct `/v1/chat/completions` payload (model + messages shape).
- [ ] Stubbed `fetchImpl` tests: health check returns `true` when model present, `false` when absent.
- [ ] Stubbed `fetchImpl` tests: `query()` throws with message containing `PROVIDER_UNAVAILABLE` on network error.
- [ ] Existing CLI and SDK provider tests still pass.

---

### FEAT-038 — `pythia_api_surface` MCP Tool
**Status:** New implementation required.

**MCP tool input/output:**
```typescript
// Input
{ path: string, language?: string }
// path: single file path OR glob pattern (fast-glob syntax)

// Output — always an array (even for single file inputs)
Array<{
  path: string;
  surface: string;      // declaration text (.d.ts) or skeleton text
  strategy: "ts-morph" | "tree-sitter" | "unsupported";
}>
```

**`surface` is always a string (text), not JSON.** The MCP tool returns readable declaration/skeleton text.

**Glob expansion:** `fast-glob` is already in `package.json` — do NOT add it again. Import: `import fg from "fast-glob";`. When `path` is a glob, expand it. When it is a single file path, wrap in array.

**Path 1 — TypeScript/JS (`ts-morph` — disk-backed, NOT in-memory filesystem):**

Import pattern (respects `verbatimModuleSyntax: true` in this repo's tsconfig):
```typescript
import { Project } from "ts-morph";
import type { SourceFile } from "ts-morph";
```

Setup:
```typescript
const project = new Project({
  compilerOptions: {
    target: 99,          // ES2022 (ScriptTarget.ES2022 = 99)
    module: 100,         // NodeNext (ModuleKind.NodeNext = 100)
    moduleResolution: 99, // NodeNext
    declaration: true,
    strict: true
  }
});
const sourceFile: SourceFile = project.addSourceFileAtPath(filePath);
const emitOutput = sourceFile.getEmitOutput({ emitOnlyDtsFiles: true });
const dtsText = emitOutput.getOutputFiles()[0]?.getText() ?? "";
```

Do NOT use `useInMemoryFileSystem: true` — it cannot resolve imported types from `node_modules` or `lib` files, producing `any`-filled output.

**Path 2 — All other languages (tree-sitter skeleton):**

`api-surface-extractor.ts` instantiates its own parsers directly — it does NOT go through `chunker-treesitter.ts` internals (those are not exported). For each language it needs to handle, import the grammar and instantiate `new Parser()` directly:
```typescript
import Parser from "tree-sitter";
import Python from "tree-sitter-python";
// etc.
```

Walk the AST; for each function/method/class node: include the signature text by slicing `source.slice(node.startIndex, body.startIndex)` and appending a placeholder body `{ ... }`. Assemble all signatures into a single text block as `surface`.

Support at minimum: Python, Go, Rust, Java, PHP, Ruby (if tree-sitter-ruby is available post-Worker-C merge). Unknown extensions → `strategy: "unsupported"`, empty `surface`, no throw.

**MCP registration — `src/mcp/tools.ts`:**

The existing pattern uses `server.registerTool(...)` — NOT `server.setRequestHandler`. Follow the same pattern as the six existing tools in that file.

Also update `src/__tests__/mcp-server.test.ts` to assert `pythia_api_surface` appears in the tool list.

**Acceptance criteria:**
- [ ] `pythia_api_surface` registered in `src/mcp/tools.ts` via `server.registerTool(...)`.
- [ ] Tool appears in MCP tools list (asserted in `mcp-server.test.ts`).
- [ ] TS/JS files: disk-backed ts-morph path returns valid `.d.ts` text; `strategy: "ts-morph"`.
- [ ] Non-TS files: tree-sitter skeleton returns signature text; `strategy: "tree-sitter"`.
- [ ] Unknown extension: returns empty `surface`; `strategy: "unsupported"`; no throw.
- [ ] Glob input: expands via `fast-glob`, returns array.

---

### FEAT-039 — Language Breadth Tier 3 (Ruby, C#, YAML)
**Status:** New implementations using tree-sitter. All follow the `chunker-php.ts` pattern exactly.

**Ruby (`src/indexer/chunker-ruby.ts`):**
- Grammar: `tree-sitter-ruby`
- Extract: `method`, `singleton_method`, `class`, `module`
- Name field: `childForFieldName("name")?.text`
- `chunk_type` values: `"method"`, `"class"`, `"module"`
- Language string: `"ruby"`

**C# (`src/indexer/chunker-c-sharp.ts`):**
- Grammar: `tree-sitter-c-sharp`
- Extract: `class_declaration`, `method_declaration`, `interface_declaration`, `enum_declaration`
- Name field: `childForFieldName("name")?.text`
- `chunk_type` values: `"class"`, `"method"`, `"interface"`, `"enum"`
- Language string: `"csharp"`

**YAML (`src/indexer/chunker-yaml.ts`):**
- Grammar: `tree-sitter-yaml` (must pass Step 0 validation before starting)
- Chunking strategy: traverse `document → block_node → block_mapping`, extract each `block_mapping_pair` that is a **direct child** of the root `block_mapping` (depth-0 keys only).
- Each `block_mapping_pair` becomes one chunk.
- `chunk_type`: `"block"`. Language string: `"yaml"`.
- Extensions: `.yaml`, `.yml`

**`chunk_type: "block"` must be added to `max_chunk_chars` defaults** in both:
- `src/config.ts` — add `block: 4_000` to the default `DEFAULT_MAX_CHUNK_CHARS` map
- `src/cli/config.ts` (if that file has its own defaults map) — same addition
Worker C owns both config files for this change.

**Wiring into `src/indexer/chunker-treesitter.ts` (Worker C must do ALL of this):**

1. Add imports near the top of the file (after existing language imports):
```typescript
import Ruby from "tree-sitter-ruby";
import CSharp from "tree-sitter-c-sharp";
import YAML from "tree-sitter-yaml";
import { extractRubyChunks } from "./chunker-ruby.js";
import { extractCSharpChunks } from "./chunker-c-sharp.js";
import { extractYamlChunks } from "./chunker-yaml.js";
```

2. Extend `ChunkStrategy` union (lines 24–31 currently):
```typescript
type ChunkStrategy =
  | "symbols" | "php" | "phtml" | "sql" | "css" | "scss"
  | "ruby" | "csharp" | "yaml"
  | "module";
```

3. Add entries to `languageConfigEntries` (after the `.scss` line at 86):
```typescript
[".rb",   { language: "ruby",   parserLanguage: Ruby as Parser.Language,   strategy: "ruby"   }],
[".cs",   { language: "csharp", parserLanguage: CSharp as Parser.Language, strategy: "csharp" }],
[".yaml", { language: "yaml",   parserLanguage: YAML as Parser.Language,   strategy: "yaml"   }],
[".yml",  { language: "yaml",   parserLanguage: YAML as Parser.Language,   strategy: "yaml"   }],
```

4. In the `chunkFile()` dispatch section: add three new branches following the exact same pattern as the PHP dispatch. Pass `normalizedPath` (NOT the raw `filePath` — the pipeline normalizes to repo-relative before this point) as the second argument to all three new extractors:
```typescript
if (strategy === "ruby")   { return extractRubyChunks(rootNode, normalizedPath); }
if (strategy === "csharp") { return extractCSharpChunks(rootNode, normalizedPath); }
if (strategy === "yaml")   { return extractYamlChunks(rootNode, normalizedPath); }
```

**Golden fixtures:**
- `src/__tests__/fixtures/ruby/basic-class.rb`
- `src/__tests__/fixtures/ruby/module-with-methods.rb`
- `src/__tests__/fixtures/ruby/singleton-methods.rb`
- `src/__tests__/fixtures/csharp/basic-class.cs`
- `src/__tests__/fixtures/csharp/interface-and-enum.cs`
- `src/__tests__/fixtures/csharp/nested-class.cs`
- `src/__tests__/fixtures/yaml/simple-config.yaml`
- `src/__tests__/fixtures/yaml/nested-map.yaml`

**Acceptance criteria:**
- [ ] `chunker-ruby.ts` exports `extractRubyChunks(rootNode, filePath)`.
- [ ] `chunker-c-sharp.ts` exports `extractCSharpChunks(rootNode, filePath)`.
- [ ] `chunker-yaml.ts` exports `extractYamlChunks(rootNode, filePath)`.
- [ ] All three wired in `chunker-treesitter.ts`: imports + strategy union + extension map + dispatch with `normalizedPath`.
- [ ] `chunk_type: "block"` added to `DEFAULT_MAX_CHUNK_CHARS` defaults in `src/config.ts` (and `src/cli/config.ts` if applicable).
- [ ] Golden fixture tests with inline `assert.deepEqual` assertions (not snapshots).
- [ ] `.rb`, `.cs`, `.yaml`, `.yml` produce non-empty chunk arrays through `chunkFile()`.

---

## Worker Partition

| Worker | Files owned | Notes |
|--------|-------------|-------|
| **Worker A** | `src/oracle/local-provider.ts` (new), `src/config.ts` (add local mode), `src/oracle/provider.ts` (interface + factory), `src/oracle/cli-provider.ts` (add describe()), `src/oracle/sdk-provider.ts` (add describe()), `src/mcp/ask-oracle.ts` (fix line 211), `src/__tests__/ask-oracle.test.ts` (add describe() to 4 mocks), `src/__tests__/local-provider.test.ts` (new) | No MCP registration files. Can merge independently. |
| **Worker B** | `src/mcp/api-surface.ts` (new), `src/indexer/api-surface-extractor.ts` (new), `src/__tests__/api-surface.test.ts` (new), `src/mcp/tools.ts` (register tool), `src/__tests__/mcp-server.test.ts` (assert new tool), `package.json` (add `ts-morph` only — `fast-glob` already present) | Must merge after Worker A. Owns one `package.json` change. |
| **Worker C** | `src/indexer/chunker-ruby.ts` (new), `src/indexer/chunker-c-sharp.ts` (new), `src/indexer/chunker-yaml.ts` (new), `src/indexer/chunker-treesitter.ts` (wire all three), `src/config.ts` (add block to max_chunk_chars), `src/__tests__/chunker-ruby.test.ts` (new), `src/__tests__/chunker-c-sharp.test.ts` (new), `src/__tests__/chunker-yaml.test.ts` (new), fixtures (new), `package.json` (add tree-sitter-ruby, tree-sitter-c-sharp, tree-sitter-yaml), `package-lock.json` (final state after B and C installs) | Merges LAST. Owns final package.json + lock file state. |

**Merge sequence:** A → B → C. Workers A and B have no shared files. C merges last to take final ownership of `package.json` + `package-lock.json` after B's `ts-morph` install.

**`src/config.ts` is touched by both Worker A (add local mode) and Worker C (add block chunk size). These are different sections — not the same lines. Workers must coordinate or C rebases on A's changes before merging.**

---

## Step 0 — Dependency Validation (Pre-Sprint, Claude)

**RESOLVED:**
- `ts-morph` — installs on Node 22 ✓
- `tree-sitter-ruby` — installs on Node 22 ✓
- `tree-sitter-c-sharp` — installs on Node 22 ✓
- `fast-glob` — already in `package.json`, no install needed ✓

**REQUIRED before Worker C starts:**
- `tree-sitter-yaml`: Run `mkdir /tmp/yaml-dep-test && cd /tmp/yaml-dep-test && npm init -y && npm install tree-sitter tree-sitter-yaml`. If gyp error → implement YAML chunker using a pure-JS line-chunking fallback (split on `^\w` keys) instead. Decide before Worker C's prompt is written.

---

## Tests Required

| Worker | Test file | Minimum tests |
|--------|-----------|---------------|
| A | `local-provider.test.ts` | ≥ 10 (stubbed fetchImpl: completions payload, health check present/absent, PROVIDER_UNAVAILABLE throw, describe() output, all three providers' describe(), ask-oracle metadata) |
| B | `api-surface.test.ts` | ≥ 10 (ts-morph TS path, tree-sitter non-TS path, unsupported graceful fallback, glob expansion) |
| C | `chunker-ruby.test.ts` | ≥ 12 |
| C | `chunker-c-sharp.test.ts` | ≥ 12 |
| C | `chunker-yaml.test.ts` | ≥ 6 |

**Gate:** `npm test` must show ≥ 378 total (328 current + ≥ 50 new) before merge.

---

## Files to Create

```
src/oracle/
  local-provider.ts                   ← Worker A

src/__tests__/
  local-provider.test.ts              ← Worker A
  api-surface.test.ts                 ← Worker B
  chunker-ruby.test.ts                ← Worker C
  chunker-c-sharp.test.ts             ← Worker C
  chunker-yaml.test.ts                ← Worker C
  fixtures/ruby/
    basic-class.rb
    module-with-methods.rb
    singleton-methods.rb
  fixtures/csharp/
    basic-class.cs
    interface-and-enum.cs
    nested-class.cs
  fixtures/yaml/
    simple-config.yaml
    nested-map.yaml

src/mcp/
  api-surface.ts                      ← Worker B

src/indexer/
  api-surface-extractor.ts            ← Worker B
  chunker-ruby.ts                     ← Worker C
  chunker-c-sharp.ts                  ← Worker C
  chunker-yaml.ts                     ← Worker C
```

## Files to Modify

```
src/config.ts                         ← Worker A (add local mode) + Worker C (add block chunk size)
src/oracle/provider.ts                ← Worker A (describe() on interface + factory branch)
src/oracle/cli-provider.ts            ← Worker A (add describe())
src/oracle/sdk-provider.ts            ← Worker A (add describe())
src/mcp/ask-oracle.ts                 ← Worker A (fix hardcoded model at line 211)
src/__tests__/ask-oracle.test.ts      ← Worker A (add describe() to 4 mocks)
src/mcp/tools.ts                      ← Worker B (register pythia_api_surface)
src/__tests__/mcp-server.test.ts      ← Worker B (assert pythia_api_surface in tool list)
src/indexer/chunker-treesitter.ts     ← Worker C (imports + ChunkStrategy + extension map + dispatch)
package.json                          ← Worker B (ts-morph) then Worker C (tree-sitter-* packages)
package-lock.json                     ← Worker C (owns final state after B and C both install)
```

---

## Completion Criteria

Sprint 9 is done when:
1. `npm test` passes ≥ 378 tests.
2. `LocalReasoningProvider` correctly POSTs to `/v1/chat/completions` and GETs `/v1/models` via injected `fetchImpl`.
3. `ReasoningProvider.describe()` implemented by all three providers; `ask-oracle.ts` uses it.
4. `pythia_api_surface` returns `.d.ts` text for TypeScript files via disk-backed ts-morph.
5. `pythia_api_surface` returns skeleton text for supported non-TS languages via tree-sitter.
6. `.rb`, `.cs`, `.yaml`, `.yml` files are indexed and chunked via `chunkFile()` (not dead code).
7. All new chunkers dispatch with `normalizedPath`, producing correct CNI chunk IDs.
8. `chunk_type: "block"` is in `DEFAULT_MAX_CHUNK_CHARS` with a sensible default.
