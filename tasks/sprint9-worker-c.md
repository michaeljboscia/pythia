# Sprint 9 — Worker C: Ruby, C#, YAML Chunkers

You are implementing FEAT-039 for Pythia v1, a TypeScript MCP server for RAG code indexing.
Working directory: `/Users/mikeboscia/pythia`
Tech stack: TypeScript 5.x, Node.js 22 LTS, ESM (`"module": "NodeNext"`), `verbatimModuleSyntax: true`, `node:test` framework (NOT Jest).
Run tests with: `npm test`
**Prerequisite: Workers A and B have already merged.** Run `npm test` before starting — should show ≥348 passing. That is your baseline.
Your gate: **`npm test` shows ≥ 378 passing** (Worker B baseline + ≥30 new).

---

## What You Are Building

Three new tree-sitter chunkers (Ruby, C#, YAML) wired into Pythia's indexing pipeline. All follow the exact same pattern as `src/indexer/chunker-php.ts` — read that file first and use it as your template.

After your work: `.rb`, `.cs`, `.yaml`, and `.yml` files will be automatically parsed, chunked, and stored in the SQLite vector store when `pythia init` runs.

---

## Before You Start — YAML Dependency Validation

Run this:
```bash
mkdir /tmp/yaml-dep-test && cd /tmp/yaml-dep-test && npm init -y && npm install tree-sitter tree-sitter-yaml 2>&1 | tail -5
```

- If it succeeds with no gyp errors → proceed with `tree-sitter-yaml` as specified.
- If gyp error → implement YAML chunker using a plain-text fallback (see the fallback spec at the end of this prompt). Stop here and read that section before proceeding.

---

## Files You Own

**Create:**
- `src/indexer/chunker-ruby.ts`
- `src/indexer/chunker-c-sharp.ts`
- `src/indexer/chunker-yaml.ts`
- `src/__tests__/chunker-ruby.test.ts`
- `src/__tests__/chunker-c-sharp.test.ts`
- `src/__tests__/chunker-yaml.test.ts`
- `src/__tests__/fixtures/ruby/basic-class.rb`
- `src/__tests__/fixtures/ruby/module-with-methods.rb`
- `src/__tests__/fixtures/ruby/singleton-methods.rb`
- `src/__tests__/fixtures/csharp/basic-class.cs`
- `src/__tests__/fixtures/csharp/interface-and-enum.cs`
- `src/__tests__/fixtures/csharp/nested-class.cs`
- `src/__tests__/fixtures/yaml/simple-config.yaml`
- `src/__tests__/fixtures/yaml/nested-map.yaml`

**Modify:**
- `src/indexer/chunker-treesitter.ts` (wire all three new chunkers)
- `src/config.ts` (add `block: 4_000` to `DEFAULT_MAX_CHUNK_CHARS`)
- `package.json` (add tree-sitter grammars)
- `package-lock.json` (you own the final state after both B and C installs)

**Do not touch:** Any oracle files, MCP registration files, `src/mcp/`, `src/oracle/`, `src/__tests__/ask-oracle.test.ts`.

---

## Step 0 — Read the template

Read `src/indexer/chunker-php.ts` in full before writing anything. Your Ruby and C# chunkers must follow its exact structure: same export function signature, same Chunk construction pattern, same error handling (or lack thereof — keep it simple).

Also read `src/indexer/chunker-treesitter.ts` lines 1–90 carefully — you need to understand the import pattern, `ChunkStrategy` union, and `languageConfigEntries` array structure before wiring your new chunkers in.

---

## Step 1 — Install grammars

```bash
npm install tree-sitter-ruby tree-sitter-c-sharp tree-sitter-yaml
```

(Or skip `tree-sitter-yaml` if validation failed — see YAML fallback section.)

---

## Step 2 — Create `src/indexer/chunker-ruby.ts`

Pattern: identical to `chunker-php.ts` but for Ruby.

```typescript
import Parser from "tree-sitter";
import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

export function extractRubyChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const targetTypes = new Set(["method", "singleton_method", "class", "module"]);

  function walk(node: SyntaxNode): void {
    for (const child of node.namedChildren) {
      if (targetTypes.has(child.type)) {
        const name = child.childForFieldName("name")?.text ?? `anonymous_L${child.startPosition.row}`;
        const chunkType: ChunkType | string = child.type === "singleton_method" ? "method" : child.type as ChunkType;
        chunks.push({
          id: `${filePath}::${chunkType}::${name}`,
          file_path: filePath,
          chunk_type: chunkType,
          content: child.text,
          start_line: child.startPosition.row,
          end_line: child.endPosition.row,
          language: "ruby"
        });
        // Do not walk into children — class methods are picked up as top-level `method` nodes by the grammar
      }
      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
```

Note: tree-sitter-ruby's `method` nodes appear as children of `class` and `module` nodes. Walking recursively will find them at both levels — that is correct behavior.

---

## Step 3 — Create `src/indexer/chunker-c-sharp.ts`

Pattern: identical structure to chunker-ruby.ts.

```typescript
import Parser from "tree-sitter";
import type { Chunk, ChunkType } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

const CSHARP_NODE_TYPE_MAP: Record<string, ChunkType | string> = {
  class_declaration: "class",
  method_declaration: "method",
  interface_declaration: "interface",
  enum_declaration: "enum"
};

export function extractCSharpChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const targetTypes = new Set(Object.keys(CSHARP_NODE_TYPE_MAP));

  function walk(node: SyntaxNode): void {
    for (const child of node.namedChildren) {
      if (targetTypes.has(child.type)) {
        const name = child.childForFieldName("name")?.text ?? `anonymous_L${child.startPosition.row}`;
        const chunkType = CSHARP_NODE_TYPE_MAP[child.type] ?? child.type;
        chunks.push({
          id: `${filePath}::${chunkType}::${name}`,
          file_path: filePath,
          chunk_type: chunkType,
          content: child.text,
          start_line: child.startPosition.row,
          end_line: child.endPosition.row,
          language: "csharp"
        });
      }
      walk(child);
    }
  }

  walk(rootNode);
  return chunks;
}
```

---

## Step 4 — Create `src/indexer/chunker-yaml.ts` (tree-sitter version)

YAML chunking: extract depth-0 keys from the root mapping. Each top-level key becomes one chunk.

The tree-sitter-yaml AST structure for a YAML document:
```
stream → document → block_node → block_mapping → block_mapping_pair[]
```

Each `block_mapping_pair` at the root level is one chunk.

```typescript
import Parser from "tree-sitter";
import type { Chunk } from "./chunker-treesitter.js";

type SyntaxNode = Parser.SyntaxNode;

function findRootBlockMapping(node: SyntaxNode): SyntaxNode | null {
  // Traverse: stream → document → block_node → block_mapping
  for (const child of node.namedChildren) {
    if (child.type === "document") {
      for (const docChild of child.namedChildren) {
        if (docChild.type === "block_node") {
          for (const blockChild of docChild.namedChildren) {
            if (blockChild.type === "block_mapping") {
              return blockChild;
            }
          }
        }
      }
    }
  }
  return null;
}

export function extractYamlChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const blockMapping = findRootBlockMapping(rootNode);

  if (blockMapping === null) {
    return chunks;
  }

  for (const pair of blockMapping.namedChildren) {
    if (pair.type !== "block_mapping_pair") { continue; }
    const keyNode = pair.childForFieldName("key");
    const name = keyNode?.text ?? `key_L${pair.startPosition.row}`;
    chunks.push({
      id: `${filePath}::block::${name}`,
      file_path: filePath,
      chunk_type: "block",
      content: pair.text,
      start_line: pair.startPosition.row,
      end_line: pair.endPosition.row,
      language: "yaml"
    });
  }

  return chunks;
}
```

---

## Step 5 — Wire all three into `src/indexer/chunker-treesitter.ts`

Read `src/indexer/chunker-treesitter.ts` in full. Make these exact changes:

**5a. Add imports** (after the existing language imports at the top of the file):
```typescript
import Ruby from "tree-sitter-ruby";
import CSharp from "tree-sitter-c-sharp";
import YAML from "tree-sitter-yaml";
import { extractRubyChunks } from "./chunker-ruby.js";
import { extractCSharpChunks } from "./chunker-c-sharp.js";
import { extractYamlChunks } from "./chunker-yaml.js";
```

**5b. Extend `ChunkStrategy` union** (currently ends at `"scss" | "module"`, add before the closing `|`):
```typescript
type ChunkStrategy =
  | "symbols"
  | "php"
  | "phtml"
  | "sql"
  | "css"
  | "scss"
  | "ruby"
  | "csharp"
  | "yaml"
  | "module";
```

**5c. Add entries to `languageConfigEntries`** (after the `.scss` line):
```typescript
[".rb",   { language: "ruby",   parserLanguage: Ruby as Parser.Language,   strategy: "ruby"   }],
[".cs",   { language: "csharp", parserLanguage: CSharp as Parser.Language, strategy: "csharp" }],
[".yaml", { language: "yaml",   parserLanguage: YAML as Parser.Language,   strategy: "yaml"   }],
[".yml",  { language: "yaml",   parserLanguage: YAML as Parser.Language,   strategy: "yaml"   }],
```

**5d. Add dispatch branches in `chunkFile()`** — read the function body, find where PHP is dispatched, add the three new branches in the same style. The key requirement: pass `normalizedPath` (the repo-relative path, NOT the raw absolute file path) as the second argument:

```typescript
if (strategy === "ruby")   { return extractRubyChunks(rootNode, normalizedPath); }
if (strategy === "csharp") { return extractCSharpChunks(rootNode, normalizedPath); }
if (strategy === "yaml")   { return extractYamlChunks(rootNode, normalizedPath); }
```

**Critical:** Look at how PHP is dispatched and pass the same variable that PHP receives. If PHP receives `filePath` (already normalized), use that same variable. The name `normalizedPath` is what it should logically be — read the existing code to find the actual variable name at that dispatch point.

---

## Step 6 — Add `block` to `DEFAULT_MAX_CHUNK_CHARS` in `src/config.ts`

Read `src/config.ts`. Find `DEFAULT_MAX_CHUNK_CHARS` (it is a `Record<string, number>`). Add:
```typescript
block: 4_000,
```

This ensures YAML `block` chunks are subject to the oversize splitter like all other chunk types.

Also check `src/cli/config.ts` — if it has its own defaults map with similar structure, add `block: 4_000` there too.

---

## Step 7 — Write fixture files

**`src/__tests__/fixtures/ruby/basic-class.rb`:**
```ruby
class User
  def initialize(name, email)
    @name = name
    @email = email
  end

  def greet
    "Hello, #{@name}"
  end

  def email
    @email
  end
end
```

**`src/__tests__/fixtures/ruby/module-with-methods.rb`:**
```ruby
module Greeter
  def say_hello(name)
    "Hello, #{name}!"
  end

  def say_goodbye(name)
    "Goodbye, #{name}."
  end
end
```

**`src/__tests__/fixtures/ruby/singleton-methods.rb`:**
```ruby
class Config
  def self.load(path)
    File.read(path)
  end

  def self.defaults
    { timeout: 30, retries: 3 }
  end
end
```

**`src/__tests__/fixtures/csharp/basic-class.cs`:**
```csharp
namespace MyApp;

public class UserService
{
    private readonly string _connectionString;

    public UserService(string connectionString)
    {
        _connectionString = connectionString;
    }

    public string GetUser(int id)
    {
        return $"user_{id}";
    }

    public bool DeleteUser(int id)
    {
        return true;
    }
}
```

**`src/__tests__/fixtures/csharp/interface-and-enum.cs`:**
```csharp
public interface IRepository<T>
{
    T GetById(int id);
    void Save(T entity);
    void Delete(int id);
}

public enum UserStatus
{
    Active,
    Inactive,
    Suspended
}
```

**`src/__tests__/fixtures/csharp/nested-class.cs`:**
```csharp
public class Outer
{
    public class Inner
    {
        public string Value { get; set; }

        public string GetValue()
        {
            return Value;
        }
    }

    public void ProcessInner(Inner inner)
    {
        Console.WriteLine(inner.Value);
    }
}
```

**`src/__tests__/fixtures/yaml/simple-config.yaml`:**
```yaml
database:
  host: localhost
  port: 5432
  name: myapp

server:
  port: 3000
  host: 0.0.0.0

logging:
  level: info
  format: json
```

**`src/__tests__/fixtures/yaml/nested-map.yaml`:**
```yaml
services:
  api:
    image: myapp/api:latest
    replicas: 3
    env:
      NODE_ENV: production

  worker:
    image: myapp/worker:latest
    replicas: 2

features:
  dark_mode: true
  beta_access: false
```

---

## Step 8 — Write tests

### `src/__tests__/chunker-ruby.test.ts` (≥12 tests)

Pattern: exactly like `src/__tests__/chunker-php.test.ts`. Read that file for the exact structure.

Required assertions:
1. `basic-class.rb` produces chunk with `id` containing `"class::User"`
2. `basic-class.rb` produces chunk for `initialize` method
3. `basic-class.rb` produces chunk for `greet` method
4. `basic-class.rb` produces chunk for `email` method
5. All `basic-class.rb` chunks have `language === "ruby"`
6. All `basic-class.rb` chunks have `file_path` matching the fixture path
7. `module-with-methods.rb` produces chunk for `Greeter` module
8. `module-with-methods.rb` produces `say_hello` method chunk
9. `module-with-methods.rb` produces `say_goodbye` method chunk
10. `singleton-methods.rb` produces `Config` class chunk
11. `singleton-methods.rb` produces `load` method chunk (singleton method → `chunk_type: "method"`)
12. `singleton-methods.rb` produces `defaults` method chunk

### `src/__tests__/chunker-c-sharp.test.ts` (≥12 tests)

1. `basic-class.cs` produces `class::UserService` chunk
2. `basic-class.cs` produces `method::GetUser` chunk
3. `basic-class.cs` produces `method::DeleteUser` chunk
4. `basic-class.cs` — all chunks have `language === "csharp"`
5. `interface-and-enum.cs` produces `interface::IRepository` chunk
6. `interface-and-enum.cs` produces `enum::UserStatus` chunk
7. `interface-and-enum.cs` — enum chunk `content` contains `"Active"`
8. `nested-class.cs` produces `class::Outer` chunk
9. `nested-class.cs` produces `class::Inner` chunk (nested class)
10. `nested-class.cs` produces `method::ProcessInner` chunk
11. All chunks have `file_path` that does NOT start with `/` (repo-relative path — this verifies normalizedPath was used)
12. Chunk `id` format is `"<file_path>::<type>::<name>"` — assert one chunk's id matches exactly

### `src/__tests__/chunker-yaml.test.ts` (≥6 tests)

1. `simple-config.yaml` produces 3 chunks (one per top-level key: database, server, logging)
2. `simple-config.yaml` — chunk for `database` has `chunk_type === "block"`
3. `simple-config.yaml` — chunk content for `database` contains `"host"` and `"localhost"`
4. `nested-map.yaml` produces 2 chunks (services, features)
5. `nested-map.yaml` — chunk for `services` contains nested `api` content
6. All YAML chunks have `language === "yaml"`

---

## Step 9 — Update `package-lock.json`

After running `npm install`, `package-lock.json` will be updated automatically. Commit both `package.json` and `package-lock.json` together. You own the final state.

---

## Verification

Run `npm test`. Workers A and B's tests must still pass. You should have ≥378 total.

**Common failure modes:**
- TypeScript error: `"ruby" is not assignable to type ChunkStrategy` → you forgot to extend the `ChunkStrategy` union in Step 5b.
- Chunks have absolute `file_path` values starting with `/` → you passed the wrong variable in the dispatch (Step 5d). Find what variable PHP uses in its dispatch and use that exact variable.
- YAML produces 0 chunks → the AST path is wrong. Add a debug log to print `rootNode.toString()` against your fixture to see the actual tree structure. Adjust `findRootBlockMapping` accordingly.
- `tree-sitter-yaml` gyp error → see YAML fallback section below.

---

## YAML Fallback (only if tree-sitter-yaml fails to install)

If `tree-sitter-yaml` fails to build natively, implement `chunker-yaml.ts` using pure-text parsing instead:

```typescript
import { readFileSync } from "node:fs";
import type { Chunk } from "./chunker-treesitter.js";
import type Parser from "tree-sitter";

type SyntaxNode = Parser.SyntaxNode;

// Top-level key: any line that starts in column 0 with a word character followed by ":"
const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):/;

export function extractYamlChunks(rootNode: SyntaxNode, filePath: string): Chunk[] {
  // rootNode.text gives us the raw YAML source
  const source = rootNode.text;
  const lines = source.split("\n");
  const chunks: Chunk[] = [];
  let currentKey: string | null = null;
  let startLine = 0;
  const currentLines: string[] = [];

  function flush(endLine: number): void {
    if (currentKey !== null && currentLines.length > 0) {
      chunks.push({
        id: `${filePath}::block::${currentKey}`,
        file_path: filePath,
        chunk_type: "block",
        content: currentLines.join("\n"),
        start_line: startLine,
        end_line: endLine - 1,
        language: "yaml"
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = TOP_LEVEL_KEY.exec(line);
    if (match !== null) {
      flush(i);
      currentKey = match[1];
      startLine = i;
      currentLines.length = 0;
    }
    if (currentKey !== null) {
      currentLines.push(line);
    }
  }
  flush(lines.length);
  return chunks;
}
```

In `chunker-treesitter.ts`, for the fallback: do NOT import `YAML` from `tree-sitter-yaml`. Instead, handle `.yaml`/`.yml` as a special case that reads the raw file text and calls `extractYamlChunks` without a parser. You will need to adjust the dispatch logic in `chunkFile()` to bypass the tree-sitter parse step for yaml strategy and call the extractor with the file content directly.
