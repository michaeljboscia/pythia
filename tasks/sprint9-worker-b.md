# Sprint 9 — Worker B: pythia_api_surface MCP Tool

You are implementing FEAT-038 for Pythia v1, a TypeScript MCP server for RAG code indexing.
Working directory: `/Users/mikeboscia/pythia`
Tech stack: TypeScript 5.x, Node.js 22 LTS, ESM (`"module": "NodeNext"`), `verbatimModuleSyntax: true`, `node:test` framework (NOT Jest).
Run tests with: `npm test`
**Prerequisite: Worker A has already merged.** Run `npm test` before starting — should show ≥338 passing. That is your baseline.
Your gate: **`npm test` shows ≥ 348 passing** (Worker A baseline + ≥10 new).

---

## What You Are Building

A new MCP tool — `pythia_api_surface` — that extracts the public API structure of source files on demand. Two-path architecture:
- **TypeScript/JS**: `ts-morph` emits `.d.ts` declaration text in memory (compiler-accurate, no disk writes)
- **All other languages**: tree-sitter walks the AST, strips function bodies, returns a text skeleton

This is a fresh-parse tool. It does NOT use the SQLite index. It does NOT go through `chunker-treesitter.ts`. It parses the file independently and returns text.

---

## Files You Own

**Create:**
- `src/mcp/api-surface.ts`
- `src/indexer/api-surface-extractor.ts`
- `src/__tests__/api-surface.test.ts`

**Modify:**
- `src/mcp/tools.ts` (register the new tool)
- `src/__tests__/mcp-server.test.ts` (assert new tool in tool list)
- `package.json` (add `ts-morph` as a dependency)

**Do not touch:** `src/indexer/chunker-treesitter.ts`, any oracle files, config, chunker files.

---

## Step 1 — Install `ts-morph`

```bash
npm install ts-morph
```

`fast-glob` is already in `package.json` — do NOT add it again. Verify with `grep fast-glob package.json`.

---

## Step 2 — Create `src/indexer/api-surface-extractor.ts`

This file contains pure extraction logic. No MCP coupling. No imports from `src/mcp/`.

### Output types

```typescript
export type ApiSurfaceResult = {
  path: string;
  surface: string;
  strategy: "ts-morph" | "tree-sitter" | "unsupported";
};
```

### Path 1 — TypeScript and JavaScript (ts-morph)

Import pattern (required for `verbatimModuleSyntax: true`):
```typescript
import { Project } from "ts-morph";
import type { SourceFile } from "ts-morph";
```

Implementation:
```typescript
import { readFileSync } from "node:fs";

function extractTsMorphSurface(filePath: string): string {
  const project = new Project({
    compilerOptions: {
      target: 99,          // ScriptTarget.ES2022
      module: 100,         // ModuleKind.NodeNext
      moduleResolution: 99, // ModuleResolutionKind.NodeNext
      declaration: true,
      strict: true,
      skipLibCheck: true
    }
  });
  const sourceFile: SourceFile = project.addSourceFileAtPath(filePath);
  const emitOutput = sourceFile.getEmitOutput({ emitOnlyDtsFiles: true });
  return emitOutput.getOutputFiles()[0]?.getText() ?? "";
}
```

**Do NOT use `useInMemoryFileSystem: true`** — it cannot resolve imported types from `node_modules` or TypeScript lib files, producing `any`-filled output.

### Path 2 — All other languages (tree-sitter skeleton)

`api-surface-extractor.ts` instantiates its own parsers directly. It does NOT go through `chunker-treesitter.ts` (those internals are not exported). Import grammars directly:

```typescript
import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import Java from "tree-sitter-java";
// Import others as needed for languages already in the project
```

For each file: parse it with the appropriate grammar. Walk the AST, find function/method/class declaration nodes. For each: extract the signature by slicing `source.slice(node.startIndex, body.startIndex)` where `body` is the body/block child node. Append `{ ... }` to represent the stripped body. Assemble all signatures into a single string as the `surface`.

Language-to-grammar map (use file extension):
- `.py` → Python
- `.go` → Go
- `.rs` → Rust
- `.java` → Java
- `.php` / `.phtml` → PHP (import from `tree-sitter-php`, use `.php` grammar)
- `.rb`, `.cs`, `.yaml`, `.yml` → these are added by Worker C; skip gracefully for now (`strategy: "unsupported"`)

Unknown extension → return `{ path, surface: "", strategy: "unsupported" }`. Never throw for unsupported languages.

### Glob expansion

```typescript
import fg from "fast-glob";

export async function extractApiSurface(pathOrGlob: string): Promise<ApiSurfaceResult[]> {
  const paths = await fg(pathOrGlob, { onlyFiles: true, absolute: true });
  // If pathOrGlob is a literal file path (no glob chars), fg still works correctly
  return Promise.all(paths.map((p) => extractSingleFile(p)));
}
```

---

## Step 3 — Create `src/mcp/api-surface.ts`

This file contains the MCP handler. It imports from `api-surface-extractor.ts` and exports the input schema and handler factory.

```typescript
import { z } from "zod";
import { extractApiSurface } from "../indexer/api-surface-extractor.js";

export const apiSurfaceInputSchema = {
  path: { type: "string", description: "File path or fast-glob pattern to extract API surface from." },
  language: { type: "string", description: "Optional language override. If omitted, inferred from file extension." }
};

export function createApiSurfaceHandler() {
  return async (input: { path: string; language?: string }) => {
    const results = await extractApiSurface(input.path);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(results, null, 2)
        }
      ]
    };
  };
}
```

---

## Step 4 — Register the tool in `src/mcp/tools.ts`

Read `src/mcp/tools.ts`. The pattern is `server.registerTool(name, { description, inputSchema }, handler)`. Add after the last existing `server.registerTool` call (after `oracle_decommission`):

```typescript
import { createApiSurfaceHandler, apiSurfaceInputSchema } from "./api-surface.js";

// Inside registerTools():
server.registerTool(
  "pythia_api_surface",
  {
    description: "Extract the public API surface (exports, signatures, declarations) from source files. Returns .d.ts text for TypeScript/JavaScript files, or a skeleton of signatures for other languages.",
    inputSchema: apiSurfaceInputSchema
  },
  createApiSurfaceHandler()
);
```

Add the import at the top of the file with the other imports.

---

## Step 5 — Update `src/__tests__/mcp-server.test.ts`

Read `src/__tests__/mcp-server.test.ts`. Find the test that asserts the list of registered tools (search for `"lcs_investigate"` or `tools/list`). Add `"pythia_api_surface"` to that assertion.

---

## Step 6 — Write `src/__tests__/api-surface.test.ts`

Use `node:test` and `node:assert/strict`. Write ≥10 tests:

1. **TypeScript file returns ts-morph strategy** — create a real `.ts` fixture (can use `import { writeFileSync, mkdtempSync } from "node:fs"` to write a temp file), assert `strategy === "ts-morph"` and `surface.length > 0`.
2. **TypeScript surface contains function signature** — fixture with `export function add(a: number, b: number): number { return a + b; }`, assert surface contains `add` and `number`.
3. **Python file returns tree-sitter strategy** — use a real `.py` fixture file (can write temp), assert `strategy === "tree-sitter"`.
4. **Python skeleton strips body** — fixture with a Python function, assert surface does NOT contain the function body content but DOES contain the function name.
5. **Unsupported extension returns "unsupported"** — call with a `.xyz` file path (may not exist — handle gracefully), assert `strategy === "unsupported"` and `surface === ""`.
6. **Glob expansion returns multiple results** — write two temp `.ts` files in a temp dir, call `extractApiSurface("/tmp/testdir/*.ts")`, assert array length ≥ 2.
7. **Single file path (not glob) returns array of 1** — call with a single `.ts` file path, assert array length === 1.
8. **Non-ok TypeScript (empty file)** — call with an empty `.ts` file, assert `strategy === "ts-morph"` and no throw (surface may be empty or minimal).
9. **`pythia_api_surface` registered in tool list** — this is asserted via the mcp-server.test.ts update, but add a direct test here confirming the handler returns content array with `type: "text"`.
10. **Non-existent file** — call with a path that does not exist, assert either `strategy: "unsupported"` or that the function throws a meaningful error (decide which and implement consistently).

For fixture files, prefer writing them to `process.cwd() + "/src/__tests__/fixtures/"` so they are committed. Or use `mkdtempSync` + cleanup in tests.

---

## Verification

Run `npm test`. Worker A's 338 tests must still pass. You should now have ≥348 total.

If `ts-morph` import fails with ESM errors, verify the import is: `import { Project } from "ts-morph";` (named import, not default). Check that `ts-morph` is in `package.json` dependencies and run `npm install`.
