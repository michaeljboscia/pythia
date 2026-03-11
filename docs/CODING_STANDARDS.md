# CODING STANDARDS — Pythia v1
**Version:** 1.0
**For:** Codex and all AI coding agents working in this repo
**Date:** 2026-03-11

> These are not guidelines. They are rules. Every pattern below has a wrong version that
> compiles cleanly and fails at runtime. The wrong versions are shown explicitly.

---

## 1. ESM Module Rules

Pythia is `"type": "module"`. No CommonJS anywhere.

```ts
// ✅ CORRECT imports
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { pipeline } from "@huggingface/transformers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";  // .js extension required
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// ✅ __dirname equivalent in ESM
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ❌ WRONG — these will throw at runtime
const Database = require("better-sqlite3");       // no require() in ESM
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";  // missing .js
```

---

## 2. SQLite Threading Contract (Most Critical Rule)

**`Database` instances cannot be shared between threads. A `Database` created in the Main
Thread cannot be used in a Worker Thread, and vice versa.**

Pythia's architecture: the Worker Thread owns ALL write connections. The Main Thread has
NO direct database connection. The Worker receives messages over `postMessage` and responds.

```ts
// ❌ WRONG — passing a Database instance across thread boundaries
// main.ts
import { Worker } from "worker_threads";
import Database from "better-sqlite3";
const db = new Database(".pythia/lcs.db");   // opened in main thread
const worker = new Worker("./worker.js", {
  workerData: { db }                          // ❌ undefined behavior — DO NOT DO THIS
});

// ✅ CORRECT — pass only the file path. Worker opens its own connection.
// main.ts
import { Worker } from "worker_threads";
const worker = new Worker(new URL("./indexer/worker.js", import.meta.url), {
  workerData: { dbPath: ".pythia/lcs.db" }   // ✅ just a string
});

// worker.ts
import { workerData, parentPort } from "worker_threads";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const db = new Database(workerData.dbPath);   // ✅ worker opens its own connection
applyPragmas(db);
sqliteVec.load(db);                           // load extension on THIS connection

process.on("exit", () => db.close());
```

---

## 3. Pragma Sequence — Apply to Every New `Database()` Instance

Pragmas are **per-connection**. They reset to defaults when you open a new `Database()`.
Copy this function verbatim and call it on every connection you open.

```ts
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // WAL mode — readers never block writers, writers never block readers.
  // Persists in the .db file but harmless to set each time.
  db.pragma("journal_mode = WAL");

  // busy_timeout — default is 0, meaning writes fail IMMEDIATELY if another writer
  // holds the lock. 5000ms gives concurrent writers time to retry before throwing.
  db.pragma("busy_timeout = 5000");

  // synchronous = NORMAL — sync on checkpoint, not every commit. Fast and safe.
  db.pragma("synchronous = NORMAL");

  // cache_size = 32MB page cache per connection.
  db.pragma("cache_size = -32000");

  // foreign_keys — off by default in SQLite for backwards compat. Enable it.
  db.pragma("foreign_keys = ON");

  // temp_store — temp tables in RAM instead of disk.
  db.pragma("temp_store = MEMORY");

  // Load the sqlite-vec extension. Must be called on EVERY new Database() instance.
  // Do NOT call db.loadExtension() manually — use sqliteVec.load() which resolves
  // the correct platform binary automatically.
  sqliteVec.load(db);

  return db;
}
```

---

## 4. sqlite-vec Patterns

### Loading

```ts
// ✅ CORRECT — use the sqliteVec.load() helper
import * as sqliteVec from "sqlite-vec";
sqliteVec.load(db);  // resolves platform binary, handles macOS arm64/x64/Linux/Windows

// ❌ WRONG — do not call loadExtension() directly
db.loadExtension("/path/to/vec0.dylib");  // fragile, platform-specific
```

### Creating the virtual table

```ts
// Dimensions are fixed at table creation. Every inserted vector must match.
// Pythia uses float[256] — 256-dimensional Matryoshka-truncated embeddings.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_lcs_chunks
  USING vec0(embedding float[256])
`);
```

### Inserting vectors

```ts
// Vectors MUST be Float32Array. Plain arrays don't work as prepared statement params.
// rowid must be BigInt or integer — NOT a string.

const insertVec = db.prepare(
  "INSERT INTO vec_lcs_chunks(rowid, embedding) VALUES (?, ?)"
);

// Always insert inside a transaction — 10-100x faster than individual inserts
const insertBatch = db.transaction((chunks: Array<{ id: number; embedding: Float32Array }>) => {
  for (const chunk of chunks) {
    insertVec.run(BigInt(chunk.id), chunk.embedding);  // BigInt rowid, Float32Array embedding
  }
});
```

### KNN query

```ts
// MATCH syntax activates the ANN index. ORDER BY distance and LIMIT are both required.
// IMPORTANT: MATCH uses L2 distance only. To get cosine-equivalent ranking,
// pre-normalize all embeddings to unit length before storing — then L2 ≈ cosine ranking.
// Pythia embeddings are L2-normalized by the embedder (normalize: true). This is correct.

const queryVec = new Float32Array(256);  // your query embedding

const rows = db
  .prepare(`
    SELECT rowid, distance
    FROM vec_lcs_chunks
    WHERE embedding MATCH ?
    ORDER BY distance   -- required to activate the index
    LIMIT 30            -- required
  `)
  .all(queryVec) as Array<{ rowid: bigint; distance: number }>;

// rowid is ALWAYS BigInt — convert on read
const ids = rows.map(r => Number(r.rowid));
```

---

## 5. ONNX Embedding Singleton Pattern

**Never call `pipeline()` inside a request handler.** It downloads and initializes the
ONNX model — that takes seconds. Create it once at module load, store the Promise (not
the resolved value) to prevent concurrent initialization races.

```ts
// src/embedder.ts
import { pipeline, env } from "@huggingface/transformers";

// Cache models to a stable location
env.cacheDir = `${process.env.HOME}/.pythia/models`;

// Store the Promise — not the resolved pipeline — to prevent double-init races.
// Two concurrent callers both seeing `null` and both calling pipeline() simultaneously
// would download the model twice and waste memory.
let pipelinePromise: ReturnType<typeof pipeline> | null = null;

async function getEmbedder() {
  if (pipelinePromise === null) {
    pipelinePromise = pipeline(
      "feature-extraction",
      "Xenova/nomic-embed-text-v1.5",
      { dtype: "fp32" }    // fp32 for accuracy. Use "q8" if memory is critical.
    );
  }
  return pipelinePromise;  // always await — free if already resolved
}

// Pre-warm at startup so the first lcs_investigate call isn't slow
export async function warmEmbedder(): Promise<void> {
  await getEmbedder();
}

// embed() is the public API
export async function embed(texts: string | string[]): Promise<Float32Array[]> {
  const extractor = await getEmbedder();

  // Prefix protocol for nomic-embed-text-v1.5:
  // "search_document: " for chunks being indexed
  // "search_query: " for queries at search time
  // These are model-specific and affect retrieval quality significantly.
  const prefixed = Array.isArray(texts) ? texts : [texts];

  const output = await extractor(prefixed, {
    pooling: "mean",    // built-in in v3 — do NOT implement manually
    normalize: true,    // L2-normalize — required for cosine similarity
  });

  // output.data = Float32Array (flat, all rows concatenated)
  // output.dims = [batch_size, 256]
  const dim = output.dims[1] as number;
  const results: Float32Array[] = [];
  for (let i = 0; i < (output.dims[0] as number); i++) {
    results.push(output.data.slice(i * dim, (i + 1) * dim) as Float32Array);
  }
  return results;
}

// Convenience functions for the prefix protocol
export async function embedChunks(texts: string[]): Promise<Float32Array[]> {
  return embed(texts.map(t => `search_document: ${t}`));
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const results = await embed([`search_query: ${text}`]);
  return results[0];
}
```

**v2 → v3 breaking changes you will encounter in old examples:**
```ts
// ❌ WRONG — v2 package name
import { pipeline } from "@xenova/transformers";

// ❌ WRONG — v2 quantization option
pipeline("feature-extraction", model, { quantized: false });  // option doesn't exist in v3

// ❌ WRONG — v2 output shape
const embedding = output[0].data;  // extra wrapper layer is gone in v3

// ❌ WRONG — v2 manual mean_pooling
import { mean_pooling } from "@xenova/transformers";
const pooled = mean_pooling(output.last_hidden_state, attention_mask);

// ✅ CORRECT in v3 — all of the above
import { pipeline } from "@huggingface/transformers";
pipeline("feature-extraction", model, { dtype: "fp32" });
const embedding = output.data;   // direct access
await extractor(texts, { pooling: "mean", normalize: true });  // built-in
```

---

## 6. Worker Thread Message Protocol

All messages between Main Thread and Worker Thread must be **plain JSON-serializable**.
No class instances. No functions. No prepared statements. No Database objects.

```ts
// ✅ CORRECT — plain objects only
parentPort.postMessage({
  type: "INDEX_FILE_RESULT",
  filePath: "src/auth.ts",
  chunkCount: 12,
  success: true,
});

// ✅ TypedArrays (Float32Array, Uint8Array) ARE transferable — use for embeddings
parentPort.postMessage(
  { type: "EMBEDDING_RESULT", data: float32Array },
  [float32Array.buffer]  // transfer the buffer — zero-copy
);

// ❌ WRONG — these will be silently dropped or throw
parentPort.postMessage({ db });                    // Database not transferable
parentPort.postMessage({ stmt: db.prepare(...) }); // PreparedStatement not transferable
parentPort.postMessage({ fn: () => {} });          // functions not serializable
```

Define all message types explicitly in `src/types.ts`:

```ts
// src/types.ts — Worker Thread message protocol

export type WorkerMessage =
  | { type: "INDEX_FILE"; filePath: string; priority: "normal" | "manual" }
  | { type: "FORCE_INDEX"; filePath: string }
  | { type: "HEARTBEAT" }
  | { type: "DIE" };  // graceful shutdown only — not used by reaper

export type WorkerResponse =
  | { type: "INDEX_COMPLETE"; filePath: string; chunkCount: number }
  | { type: "INDEX_ERROR"; filePath: string; error: string }
  | { type: "HEARTBEAT_ACK"; timestamp: string }
  | { type: "READY" };
```

---

## 7. MCP Tool Registration

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "pythia", version: "1.0.0" });

server.registerTool(
  "lcs_investigate",

  {
    description: "Search the codebase using semantic or structural queries.",

    // inputSchema is a PLAIN OBJECT of Zod field schemas.
    // DO NOT wrap in z.object({...}) — the SDK does that internally.
    inputSchema: {
      query: z.string().describe("Natural language query or CNI for structural traversal"),
      intent: z.enum(["semantic", "keyword", "structural"]).default("semantic"),
      limit: z.number().int().min(1).max(20).optional().default(8),
    },
  },

  async ({ query, intent, limit }) => {
    // Tool handlers are fully async. await anything you need.

    // ⚠️  NEVER use console.log() in a stdio server.
    // stdout is the JSON-RPC channel. console.log() corrupts it.
    // ALWAYS use console.error() for any logging.
    console.error(`[lcs_investigate] query="${query}" intent=${intent}`);

    const results = await performSearch(query, intent, limit);

    // Return a text content block — this is what Claude sees
    return {
      content: [{ type: "text" as const, text: formatResults(results) }],
    };
  }
);
```

**`inputSchema` gotcha — the most common mistake:**
```ts
// ❌ WRONG — z.object() wrapper causes "keyValidator._parse is not a function"
inputSchema: z.object({
  query: z.string(),
})

// ✅ CORRECT — plain object
inputSchema: {
  query: z.string(),
}
```

---

## 8. Error Handling Contract

Pythia has two classes of error output. Use the right one.

### Fatal errors → `McpError` (JSON-RPC error response)

```ts
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Use for: bad input, invalid state, unrecoverable server failure
// The MCP client receives a JSON-RPC error object, not a content block.
throw new McpError(
  ErrorCode.InvalidParams,
  "Path must be relative to workspace root",
  { error_code: "INVALID_PATH", detail: `'${path}' resolves outside workspace` }
);

// Do NOT wrap McpErrors — check and re-throw
try {
  await doWork();
} catch (err) {
  if (err instanceof McpError) throw err;  // already correct — pass through
  throw new McpError(
    ErrorCode.InternalError,
    `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
  );
}
```

### Non-fatal conditions → metadata prefix in response body

```ts
// Use for: degraded mode, informational state, soft warnings
// The tool SUCCEEDS (returns content), with a prefix line in the body.
const metadata: string[] = [];
if (indexState !== "ready") {
  metadata.push(`[METADATA: index_state=${indexState} indexed_files=${indexed} total_files=${total}]`);
}
if (obsidianUnavailable) {
  metadata.push("[METADATA: OBSIDIAN_UNAVAILABLE]");
}

const prefix = metadata.length > 0 ? metadata.join("\n") + "\n\n" : "";
return {
  content: [{ type: "text" as const, text: `${prefix}${body}` }],
};
```

**Error codes are defined in `src/errors.ts` — do not invent new codes inline.**

---

## 9. SQLite Atomic Write Contract

All indexing writes for a single file happen in ONE transaction. If any step fails, the
entire file re-index is rolled back. The `file_scan_cache` entry is written last, immediately
before `COMMIT` — if the transaction rolls back, the cache is stale and the file will be
re-indexed on the next scan.

```ts
// src/indexer/sync.ts — atomic file index pattern
function indexFile(db: Database.Database, filePath: string, chunks: Chunk[]): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    // 1. Soft-delete existing chunks for this file
    db.prepare(
      "UPDATE lcs_chunks SET is_deleted = 1, deleted_at = ? WHERE file_path = ?"
    ).run(new Date().toISOString(), filePath);

    // 2. Delete from derived indexes (vec, fts, graph edges)
    // ... (see BACKEND_STRUCTURE-v2.md for full SQL)

    // 3. Insert new chunks, embeddings, FTS entries, graph edges
    for (const chunk of chunks) {
      insertChunk(db, chunk);       // lcs_chunks
      insertVec(db, chunk);         // vec_lcs_chunks
      insertFts(db, chunk);         // fts_lcs_chunks_kw + fts_lcs_chunks_sub
    }

    // 4. Update file_scan_cache — LAST, immediately before COMMIT.
    //    If this runs, the file was fully indexed. If it doesn't, it wasn't.
    db.prepare(`
      INSERT INTO file_scan_cache (file_path, mtime_ns, content_hash, last_indexed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        mtime_ns = excluded.mtime_ns,
        content_hash = excluded.content_hash,
        last_indexed_at = excluded.last_indexed_at
    `).run(filePath, mtimeNs, contentHash, new Date().toISOString());

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
```

---

## 10. BEGIN IMMEDIATE — Read-Modify-Write Transactions

Use `BEGIN IMMEDIATE` whenever a transaction reads, then writes based on what it read.
Plain `BEGIN` (the default) cannot be upgraded from read to write if another writer
committed in between — it throws `SQLITE_BUSY` immediately, bypassing `busy_timeout`.

```ts
// ✅ Utility — use this for any check-then-act pattern
function runImmediate<T>(db: Database.Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Usage: inserting a MADR with supersedes logic (read status, then update + insert)
const madrId = runImmediate(db, () => {
  if (supersedesId) {
    db.prepare("UPDATE pythia_memories SET status = 'superseded' WHERE id = ?")
      .run(supersedesId);
  }
  const result = db.prepare(`
    INSERT INTO pythia_memories (generation_id, title, status, ...)
    VALUES (?, ?, 'accepted', ...)
  `).run(generationId, title);

  // Derive id from the AUTOINCREMENT seq
  const seq = result.lastInsertRowid;
  const id = `MADR-${String(seq).padStart(3, "0")}`;
  db.prepare("UPDATE pythia_memories SET id = ? WHERE seq = ?").run(id, seq);

  return id;
});
```

---

## 11. Obsidian Write Rule

**SQLite commits before Obsidian writes — always. A failed Obsidian write NEVER rolls
back a committed MADR.**

```ts
// ✅ CORRECT — Obsidian write is outside the transaction
db.exec("COMMIT");                        // MADR safely in SQLite
await writeToObsidian(madr);              // best-effort side effect

// ❌ WRONG — rolling back the MADR because Obsidian failed
try {
  await writeToObsidian(madr);
} catch {
  db.exec("ROLLBACK");                    // NEVER DO THIS
}
```

---

## 12. Tree-sitter Language Packages

Pythia indexes these languages. All packages must be in `package.json`:

| Language | Package | Extensions |
|---|---|---|
| TypeScript / TSX | `tree-sitter-typescript` | `.ts`, `.tsx` |
| JavaScript / JSX | `tree-sitter-javascript` | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `tree-sitter-python` | `.py` |
| Go | `tree-sitter-go` | `.go` |
| Rust | `tree-sitter-rust` | `.rs` |
| Java | `tree-sitter-java` | `.java` |

```ts
// src/indexer/chunker.ts — language detection
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import Java from "tree-sitter-java";

const LANGUAGE_MAP: Record<string, Parser.Language> = {
  ".ts": TypeScript.typescript,
  ".tsx": TypeScript.tsx,
  ".js": JavaScript,
  ".jsx": JavaScript,
  ".mjs": JavaScript,
  ".cjs": JavaScript,
  ".py": Python,
  ".go": Go,
  ".rs": Rust,
  ".java": Java,
};
```

---

## 13. Testing Standards

Every sprint step requires a passing test before it is considered done.

```ts
// Use Node's built-in test runner (Node 22 — no Jest, no Vitest)
import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("embedder", () => {
  test("returns Float32Array of correct dimension", async () => {
    const result = await embedQuery("authentication middleware");
    assert.ok(result instanceof Float32Array);
    assert.strictEqual(result.length, 256);
  });

  test("same text produces same embedding (deterministic)", async () => {
    const a = await embedQuery("hello world");
    const b = await embedQuery("hello world");
    assert.deepStrictEqual(Array.from(a), Array.from(b));
  });
});
```

**Test file location:** `src/__tests__/<module>.test.ts`
**Run:** `node --experimental-strip-types --test src/__tests__/**/*.test.ts`

---

## Reference Files

These docs contain full working examples for each library:

| Library | Reference |
|---|---|
| sqlite-vec | `/Users/mikeboscia/pythia/docs/reference/sqlite-vec-node-reference.md` |
| better-sqlite3 + Worker Threads | `/Users/mikeboscia/pythia/docs/reference/better-sqlite3-worker-threads-reference.md` |
| @huggingface/transformers v3 | `/Users/mikeboscia/pythia/docs/reference/transformers-v3-onnx-reference.md` |
| MCP SDK | `/Users/mikeboscia/pythia/docs/reference/mcp-sdk-tool-registration-reference.md` |
