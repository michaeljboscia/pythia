```markdown
# TypeScript LanguageService API: cross-file definition resolution reference

The TypeScript compiler API ships a full **LanguageService** that powers every IDE feature—completions, diagnostics, and, critically, **go-to-definition** across files. You can embed it in any Node.js tool with a single `npm install typescript`. This document covers everything needed to stand up a `LanguageService`, resolve definitions across files (including plain `.js` projects), convert results to line/column, manage file versioning, and keep queries fast.

---

## 1. Installation and import

Install the `typescript` package. It bundles the compiler, the language service, all lib `.d.ts` files, and its own type declarations—no `@types` package needed.

```bash
npm install typescript          # or: npm install -D typescript
```

```typescript
// CommonJS
const ts = require("typescript");

// ESM (namespace import — recommended)
import * as ts from "typescript";

// ESM with esModuleInterop
import ts from "typescript";
```

The main entry point (`"typescript"`) exposes the full API. You do **not** need `typescript/lib/tsserverlibrary` unless you are writing a TSServer plugin. The package ships as CJS; Node's ESM interop handles `import` transparently.

---

## 2. `createLanguageService()` and `LanguageServiceHost`

### Function signature

```typescript
function createLanguageService(
  host: LanguageServiceHost,
  documentRegistry?: DocumentRegistry,           // default: auto-created
  syntaxOnlyOrLanguageServiceMode?: boolean | LanguageServiceMode  // default: Semantic
): LanguageService;
```

| Parameter | Required | Notes |
|-----------|----------|-------|
| `host` | **yes** | Your implementation of `LanguageServiceHost` |
| `documentRegistry` | no | Share one across multiple LS instances via `ts.createDocumentRegistry()` to deduplicate `SourceFile` objects (especially `lib.d.ts`) |
| `syntaxOnlyOrLanguageServiceMode` | no | `LanguageServiceMode.Semantic` (default), `PartialSemantic`, or `Syntactic`. Use `Syntactic` if you only need parsing-level features |

### `LanguageServiceHost` — mandatory vs optional methods

The host is the bridge between the LanguageService and your file system / in-memory file store. **Six methods are strictly required**; several optional ones are important for cross-file module resolution.

```typescript
interface LanguageServiceHost {
  // ── MANDATORY ──────────────────────────────────────────────────
  getScriptFileNames(): string[];                         // all files in the project
  getScriptVersion(fileName: string): string;             // version string per file
  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined;
  getCurrentDirectory(): string;
  getCompilationSettings(): ts.CompilerOptions;
  getDefaultLibFileName(options: ts.CompilerOptions): string;

  // ── OPTIONAL BUT IMPORTANT FOR MODULE RESOLUTION ───────────────
  fileExists?(path: string): boolean;
  readFile?(path: string, encoding?: string): string | undefined;
  readDirectory?(path: string, extensions?: readonly string[],
                 exclude?: readonly string[], include?: readonly string[],
                 depth?: number): string[];
  directoryExists?(directoryName: string): boolean;
  getDirectories?(directoryName: string): string[];
  resolveModuleNames?(...): (ts.ResolvedModule | undefined)[];
  useCaseSensitiveFileNames?(): boolean;

  // ── OPTIONAL UTILITY ───────────────────────────────────────────
  getProjectVersion?(): string;
  getScriptKind?(fileName: string): ts.ScriptKind;
  log?(s: string): void;
  trace?(s: string): void;
  error?(s: string): void;
}
```

> **Without `fileExists` and `readFile`**, the default module resolver cannot locate imports. Always delegate them to `ts.sys` unless you virtualise the file system.

### Minimum viable implementation

```typescript
import * as ts from "typescript";
import * as fs from "fs";

// ── In-memory file store with versioning ──────────────────────────
const files = new Map<string, { version: number; content: string }>();

function registerFile(absPath: string, content: string) {
  const existing = files.get(absPath);
  files.set(absPath, {
    version: (existing?.version ?? 0) + 1,
    content,
  });
}

// ── Host ──────────────────────────────────────────────────────────
const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...files.keys()],

  getScriptVersion: (fileName) =>
    (files.get(fileName)?.version ?? 0).toString(),

  getScriptSnapshot: (fileName) => {
    // Serve from in-memory store first
    const entry = files.get(fileName);
    if (entry) return ts.ScriptSnapshot.fromString(entry.content);

    // Fall back to disk (lib files, node_modules, etc.)
    if (fs.existsSync(fileName)) {
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, "utf-8"));
    }
    return undefined;
  },

  getCurrentDirectory: () => process.cwd(),

  getCompilationSettings: () => ({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    allowJs: true,     // process .js files
    checkJs: false,    // skip type-checking; still enables go-to-definition
    noEmit: true,
  }),

  // Full path to lib.d.ts — use getDefaultLibFilePath, not getDefaultLibFileName
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),

  // Delegate to ts.sys for module resolution
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};

// ── Create the service (reuse this instance!) ─────────────────────
const registry = ts.createDocumentRegistry();
const service = ts.createLanguageService(host, registry);
```

---

## 3. `getDefinitionAtPosition()` — signature and result shape

Two methods exist for definition resolution:

```typescript
// Returns an array of definition locations (or undefined)
getDefinitionAtPosition(
  fileName: string,
  position: number            // 0-based character offset in the file
): readonly DefinitionInfo[] | undefined;

// Same, but also returns the textSpan of the token you queried
getDefinitionAndBoundSpan(
  fileName: string,
  position: number
): DefinitionInfoAndBoundSpan | undefined;
```

### `DefinitionInfo` (extends `DocumentSpan`)

```typescript
interface DefinitionInfo {
  fileName: string;                 // absolute path to the file containing the definition
  textSpan: TextSpan;               // { start, length } — byte offset in that file
  kind: ScriptElementKind;          // "function", "class", "variable", "property", …
  name: string;                     // symbol name, e.g. "greet"
  containerKind: ScriptElementKind; // kind of the enclosing container
  containerName: string;            // name of the enclosing class/module/namespace
  contextSpan?: TextSpan;           // broader span covering the whole declaration
  unverified?: boolean;             // true when the result could not be fully verified
  // (inherited from DocumentSpan)
  originalFileName?: string;        // pre-remap path (e.g. before .d.ts.map redirect)
  originalTextSpan?: TextSpan;
}

interface DefinitionInfoAndBoundSpan {
  definitions?: readonly DefinitionInfo[];
  textSpan: TextSpan;               // span of the identifier at the query position
}

interface TextSpan {
  start: number;   // 0-based character offset from start of file
  length: number;
}
```

### Usage example

```typescript
// 'position' is a 0-based character offset into the file text.
// For example, if the file text is: const { greet } = require("./utils");\ngreet("world");
// and you want the definition of "greet" on line 2, count chars to its position.

const defs = service.getDefinitionAtPosition("/project/main.js", 43);

if (defs) {
  for (const def of defs) {
    console.log(def.fileName);       // "/project/utils.js"
    console.log(def.name);           // "greet"
    console.log(def.kind);           // "function"
    console.log(def.textSpan.start); // e.g. 16  (byte offset in utils.js)
  }
}
```

Multiple results are possible for overloaded functions, merged declarations, or re-exports.

---

## 4. Converting `TextSpan` offsets to line and column

`TextSpan.start` is a **0-based character offset** in the file. Convert it to a human-friendly line/column with `ts.getLineAndCharacterOfPosition`:

```typescript
// Retrieve the SourceFile AST node for the target file
const program = service.getProgram()!;
const sourceFile = program.getSourceFile(def.fileName)!;

// Convert offset → { line, character } (both 0-based)
const startLC = ts.getLineAndCharacterOfPosition(sourceFile, def.textSpan.start);
const endLC   = ts.getLineAndCharacterOfPosition(
  sourceFile,
  def.textSpan.start + def.textSpan.length
);

// +1 for 1-based human-readable output
console.log(
  `${def.fileName}:${startLC.line + 1}:${startLC.character + 1}`
);
// e.g. "/project/utils.js:1:17"
```

To go the other direction (line/column → offset):

```typescript
const offset = ts.getPositionOfLineAndCharacter(sourceFile, line, character);
```

The `LanguageService` also exposes an optional helper:

```typescript
service.toLineColumnOffset?.(fileName, position); // → LineAndCharacter
```

---

## 5. Configuring for plain JavaScript with no `tsconfig`

When using the LanguageService programmatically you supply compiler options directly—no `tsconfig.json` on disk is required. For pure JS projects the key flag is **`allowJs: true`**.

```typescript
getCompilationSettings: () => ({
  allowJs: true,                            // REQUIRED — makes TS process .js files
  checkJs: false,                           // true to surface type errors; false for just navigation
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS,           // or ESNext for import/export
  moduleResolution: ts.ModuleResolutionKind.Node10, // Node-style resolution
  noEmit: true,                             // no output files needed
  esModuleInterop: true,                    // sane default-import behaviour
  maxNodeModuleJsDepth: 2,                  // how deep to follow .js in node_modules
  // jsx: ts.JsxEmit.React,                // uncomment for .jsx files
}),
```

`getScriptFileNames()` must return paths to your `.js` files—the LanguageService handles them like any `.ts` file once `allowJs` is set. JSDoc annotations (`@param`, `@type`, `@returns`) are read automatically and influence type inference and definition resolution.

For implicitly discovered files (e.g. imported modules not in your explicit file list), the LanguageService resolves them via `fileExists` / `readFile` on the host and reads their content through `getScriptSnapshot`. If you want these files to participate in queries you should add them to your file map when you first serve their snapshot.

---

## 6. File change notification and versioning

The LanguageService **has no push-based change API**. Instead it polls the host: every time it needs a file, it calls `getScriptVersion()`. If the returned string differs from the last-seen value, it calls `getScriptSnapshot()` to get fresh content and re-parses.

```typescript
// ── Notify the LanguageService of a change ────────────────────────
function updateFile(absPath: string, newContent: string) {
  const entry = files.get(absPath);
  if (entry) {
    entry.version++;          // any change to the string triggers a re-parse
    entry.content = newContent;
  } else {
    files.set(absPath, { version: 1, content: newContent });
  }
  // No explicit "notify" call needed — the LS will see the new version
  // on its next query.
}
```

### What happens if you don't increment the version?

The LanguageService **will not re-read the file**. It assumes the cached AST is still valid. This is the #1 source of "stale results" bugs. Any mutation to file content **must** be accompanied by a version bump.

### Version string conventions

The version is an opaque **string**. Common patterns:

- **Monotonic counter** (simplest): `(++counter).toString()`
- **Content hash** (guarantees correctness): `crypto.createHash("md5").update(content).digest("hex")`
- **File mtime** (for disk-based tools): `fs.statSync(file).mtimeMs.toString()`

For a static-analysis tool that reads all files once and never mutates them, returning a constant `"0"` for every file is perfectly fine.

---

## 7. Lifecycle and performance

### Creation vs query cost

| Operation | Cost | Notes |
|-----------|------|-------|
| `createLanguageService()` | **Negligible** (microseconds) | Just wires up the host; no parsing happens yet |
| First semantic query (e.g. `getDefinitionAtPosition`) | **Expensive** | Triggers parsing + binding + partial type-checking of reachable files. For a 10k-file project this can take seconds |
| Subsequent queries on unchanged files | **Fast** (low ms) | Reuses cached ASTs and type information |
| Query after one file changes | **Incremental** | Only the changed file is re-parsed; dependents are re-checked lazily |

### Best practices for a multi-file tool

```typescript
// 1. Create ONCE and reuse across all queries
const service = ts.createLanguageService(host, registry);

// 2. Share a DocumentRegistry if you run multiple LS instances
const registry = ts.createDocumentRegistry();
const lsProject1 = ts.createLanguageService(host1, registry);
const lsProject2 = ts.createLanguageService(host2, registry);

// 3. Pre-warm by issuing a cheap query on the entry file
//    (forces initial parse so later queries are fast)
service.getSyntacticDiagnostics(entryFile);

// 4. For read-only analysis (no file changes), return stable
//    versions so the LS never re-parses.

// 5. Dispose when done to release memory
service.dispose();
```

Under the hood the LanguageService creates a new immutable `Program` after every file change, but **reuses unchanged `SourceFile` nodes** from the previous `Program`. This makes incremental updates cheap. A single `LanguageService` does not map 1:1 to a single `Program`—it manages a succession of them.

For very large codebases (tens of thousands of files), initial type-checking can take 30–60 seconds and consume multiple GB of memory. Consider limiting scope via `getScriptFileNames()` or using `LanguageServiceMode.Syntactic` when full semantic resolution is not needed.

---

## 8. Complete working example: cross-file go-to-definition

```typescript
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

// ── File store ────────────────────────────────────────────────────
const files = new Map<string, { version: number; content: string }>();

function register(absPath: string) {
  const content = fs.readFileSync(absPath, "utf-8");
  files.set(absPath, { version: 1, content });
}

// Register the two project files
const projectDir = path.resolve("./myproject");
register(path.join(projectDir, "main.js"));
register(path.join(projectDir, "utils.js"));

// ── LanguageServiceHost ───────────────────────────────────────────
const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => (files.get(f)?.version ?? 0).toString(),
  getScriptSnapshot: (f) => {
    const entry = files.get(f);
    if (entry) return ts.ScriptSnapshot.fromString(entry.content);
    try { return ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf-8")); }
    catch { return undefined; }
  },
  getCurrentDirectory: () => projectDir,
  getCompilationSettings: () => ({
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    noEmit: true,
  }),
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};

// ── Create service ────────────────────────────────────────────────
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

// ── Resolve a definition ──────────────────────────────────────────
function goToDefinition(fileName: string, line: number, col: number) {
  const program = service.getProgram()!;
  const sf = program.getSourceFile(fileName);
  if (!sf) throw new Error(`File not found in program: ${fileName}`);

  // Convert 1-based line/col to 0-based offset
  const offset = ts.getPositionOfLineAndCharacter(sf, line - 1, col - 1);

  const result = service.getDefinitionAndBoundSpan(fileName, offset);
  if (!result?.definitions?.length) return [];

  return result.definitions.map((def) => {
    const defSf = program.getSourceFile(def.fileName)!;
    const pos = ts.getLineAndCharacterOfPosition(defSf, def.textSpan.start);
    return {
      file: def.fileName,
      line: pos.line + 1,          // back to 1-based
      column: pos.character + 1,
      kind: def.kind,
      name: def.name,
      containerName: def.containerName,
    };
  });
}

// Example: "Where is the symbol at line 2, column 1 of main.js defined?"
const defs = goToDefinition(path.join(projectDir, "main.js"), 2, 1);
console.log(defs);
// → [{ file: "/myproject/utils.js", line: 1, column: 17, kind: "function", name: "greet", containerName: "" }]

// ── Cleanup ───────────────────────────────────────────────────────
service.dispose();
```

---

## Gotchas and caveats

| # | Gotcha | Detail |
|---|--------|--------|
| 1 | **`getDefaultLibFileName` must return a full path** | Use `ts.getDefaultLibFilePath(options)`, not `ts.getDefaultLibFileName(options)`. The method name on the host is misleading—it expects a full filesystem path to `lib.d.ts`. |
| 2 | **`position` is a character offset, not line/column** | All LanguageService query methods accept a **0-based character offset** into the file text. Convert with `ts.getPositionOfLineAndCharacter()`. |
| 3 | **`line` and `character` are 0-based** | `getLineAndCharacterOfPosition` returns 0-based values. Add 1 for human-friendly display. |
| 4 | **Version must change when content changes** | If `getScriptVersion()` returns the same string, the LS reuses its cache and **ignores new content** from `getScriptSnapshot()`. |
| 5 | **`fileExists` + `readFile` are "optional" but critical** | Without them, module resolution fails silently and cross-file definitions return `undefined`. Always delegate to `ts.sys`. |
| 6 | **`allowJs` is required for `.js` files** | The LanguageService ignores `.js` files entirely without `allowJs: true` in compiler options. |
| 7 | **`maxNodeModuleJsDepth` defaults to 0** | The LanguageService won't follow `.js` files inside `node_modules` unless you raise this (e.g. to `2`). |
| 8 | **Don't recreate the LanguageService per query** | Creation is cheap but the first query triggers a full parse. Keeping it alive amortises that cost across all subsequent queries. |
| 9 | **`getScriptFileNames` must include all root files** | Only files returned here are "owned" by the project. Files discovered through imports are resolved on demand but won't appear in project-wide queries unless listed. |
| 10 | **`dispose()` on shutdown** | Call `service.dispose()` to free ASTs and type caches. Otherwise memory stays allocated for the life of the process. |
| 11 | **Return type can be `undefined`** | Both `getDefinitionAtPosition` and `getDefinitionAndBoundSpan` return `undefined` when the cursor is on whitespace, a keyword with no definition, or an unresolvable symbol. Always null-check. |
| 12 | **CJS-only npm package** | The `typescript` package ships as CommonJS. It works under ESM via Node's interop, but you cannot deep-import ESM-only sub-paths. Stick with `import * as ts from "typescript"`. |

---

## Quick-reference type cheat sheet

```typescript
// Core query types
interface TextSpan        { start: number; length: number }
interface LineAndCharacter { line: number;  character: number }   // both 0-based

interface DocumentSpan {
  fileName: string;
  textSpan: TextSpan;
  contextSpan?: TextSpan;
  originalFileName?: string;
  originalTextSpan?: TextSpan;
}

interface DefinitionInfo extends DocumentSpan {
  kind: ScriptElementKind;       // "function" | "class" | "variable" | …
  name: string;
  containerKind: ScriptElementKind;
  containerName: string;
  unverified?: boolean;
}

interface DefinitionInfoAndBoundSpan {
  definitions?: readonly DefinitionInfo[];
  textSpan: TextSpan;            // span of the queried token
}

// Snapshot creation
ts.ScriptSnapshot.fromString(text: string): IScriptSnapshot;

// Offset ↔ line/col conversion
ts.getLineAndCharacterOfPosition(sourceFile, offset): LineAndCharacter;
ts.getPositionOfLineAndCharacter(sourceFile, line, character): number;

// LanguageServiceMode enum
enum LanguageServiceMode {
  Semantic = 0,         // full type-checking (default)
  PartialSemantic = 1,  // lighter semantic pass
  Syntactic = 2,         // parsing only — fastest, no cross-file resolution
}
```

---

## Sources and bibliography

| Source | URL |
|--------|-----|
| TypeScript Wiki — Using the Compiler API | https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API |
| TypeScript Wiki — Using the Language Service API | https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API |
| TypeScript source — `src/services/types.ts` | https://github.com/microsoft/TypeScript/blob/main/src/services/types.ts |
| TypeScript source — `src/services/services.ts` (`createLanguageService`) | https://github.com/microsoft/TypeScript/blob/main/src/services/services.ts |
| TypeScript source — `src/services/goToDefinition.ts` | https://github.com/microsoft/TypeScript/blob/main/src/services/goToDefinition.ts |
| TypeScript `typescript.d.ts` public API definitions | Bundled in the `typescript` npm package at `lib/typescript.d.ts` |
| TypeScript VFS (virtual file system helper) | https://www.typescriptlang.org/dev/typescript-vfs/ |
| npm — typescript package | https://www.npmjs.com/package/typescript |
```