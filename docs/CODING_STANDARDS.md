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

---

## 14. Worker Thread Bipartite Protocol (§17.15)

All messages between Main Thread and Worker Thread are plain JSON-serializable objects.
The protocol is bipartite — each type flows in exactly one direction. These are the
canonical definitions from §17.15. Copy them verbatim into `src/indexer/worker-protocol.ts`.

```ts
// src/indexer/worker-protocol.ts — types only, no logic

// ── Main → Worker ────────────────────────────────────────────────────────
export type MainToWorker =
  | { type: "INDEX_BATCH"; batch_id: string; files: string[]; reason: "boot" | "warm" | "force" }
  | { type: "PAUSE";  batch_id?: string }
  | { type: "RESUME" }
  | { type: "DIE" }    // Only on MCP server SIGTERM — NOT from the inactivity reaper
  | { type: "PING" }

// ── Worker → Main ────────────────────────────────────────────────────────
export type WorkerToMain =
  | { type: "ACK"; ack: "INDEX_BATCH"|"PAUSE"|"RESUME"|"DIE"|"PING"; batch_id?: string }
  | { type: "BATCH_STARTED";  batch_id: string; total_files: number }
  | { type: "BATCH_COMPLETE"; batch_id: string; succeeded: number; failed: number; duration_ms: number }
  | { type: "FILE_FAILED";    batch_id: string; file: string; error_code: string; detail: string }
  | { type: "PAUSED";         batch_id?: string }
  | { type: "HEARTBEAT";      batch_id?: string; timestamp: string; in_flight_file?: string }
  | { type: "FATAL";          batch_id?: string; error_code: string; detail: string }
```

### Spawning the Worker (Main Thread)

```ts
// src/indexer/supervisor.ts
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { MainToWorker, WorkerToMain } from "./worker-protocol.js";

function spawnWorker(dbPath: string, workspaceRoot: string): Worker {
  // fileURLToPath + new URL resolves the compiled worker.js relative to THIS file.
  // Do NOT use __dirname (not available in ESM) or a relative string literal
  // (breaks if the process cwd is not the project root).
  const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));

  const worker = new Worker(workerPath, {
    workerData: { dbPath, workspaceRoot }   // plain strings only — no Database objects
  });

  worker.on("message", (msg: WorkerToMain) => {
    // dispatch to your handler
  });
  worker.on("error", (err) => {
    console.error("[supervisor] worker error:", err);
  });
  worker.on("exit", (code) => {
    if (code !== 0) console.error(`[supervisor] worker exited with code ${code}`);
    // circuit breaker logic here
  });

  return worker;
}

// Sending a message to the worker
// Use `satisfies` for compile-time type checking — NOT `as`
worker.postMessage({ type: "INDEX_BATCH", batch_id: "b1", files: ["/abs/path/auth.ts"], reason: "boot" } satisfies MainToWorker);
worker.postMessage({ type: "PING" } satisfies MainToWorker);
worker.postMessage({ type: "DIE"  } satisfies MainToWorker);
```

### Worker Thread Entry (src/indexer/worker.ts)

```ts
// src/indexer/worker.ts
import { workerData, parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import type { MainToWorker, WorkerToMain } from "./worker-protocol.js";

// Step 1: Worker opens its OWN connection. NEVER share a Database across threads.
const db = openDb(workerData.dbPath as string);   // openDb applies full pragma sequence
runMigrations(db);                                 // idempotent — safe to call again

let paused = false;
let dying  = false;

// Step 2: Listen for messages from Main Thread
parentPort!.on("message", async (msg: MainToWorker) => {
  switch (msg.type) {

    case "PING":
      send({ type: "ACK", ack: "PING" });
      break;

    case "INDEX_BATCH":
      send({ type: "ACK", ack: "INDEX_BATCH", batch_id: msg.batch_id });
      await handleBatch(msg.batch_id, msg.files, msg.reason);
      break;

    case "PAUSE":
      paused = true;
      send({ type: "PAUSED", batch_id: msg.batch_id });
      break;

    case "RESUME":
      paused = false;
      send({ type: "ACK", ack: "RESUME" });
      break;

    case "DIE":
      // Set flag — handleBatch will see it and stop after current file
      dying = true;
      // The ACK is sent AFTER the in-flight file finishes (see handleBatch)
      break;
  }
});

// Step 3: type-safe postMessage wrapper
function send(msg: WorkerToMain): void {
  parentPort!.postMessage(msg);
}

// Step 4: The batch loop — one file at a time
async function handleBatch(batchId: string, files: string[], reason: string): Promise<void> {
  send({ type: "BATCH_STARTED", batch_id: batchId, total_files: files.length });

  let succeeded = 0;
  let failed    = 0;
  const t0      = Date.now();

  for (const file of files) {
    // Respect PAUSE — poll until resumed
    while (paused && !dying) await sleep(100);

    // DIE — finish current file then exit cleanly
    if (dying) break;

    try {
      await indexOneFile(file, db);
      succeeded++;
    } catch (err) {
      failed++;
      const errorCode = err instanceof Error && "code" in err
        ? String((err as any).code)
        : "INDEXER_FILE_FAILED";
      send({ type: "FILE_FAILED", batch_id: batchId, file, error_code: errorCode,
             detail: err instanceof Error ? err.message : String(err) });
    }

    // Heartbeat every 5 files
    if ((succeeded + failed) % 5 === 0) {
      send({ type: "HEARTBEAT", batch_id: batchId,
             timestamp: new Date().toISOString(), in_flight_file: file });
    }
  }

  send({ type: "BATCH_COMPLETE", batch_id: batchId, succeeded, failed,
         duration_ms: Date.now() - t0 });

  // Now it is safe to honor DIE — no transaction is open
  if (dying) {
    send({ type: "ACK", ack: "DIE" });
    process.exit(0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### DIE sequence — critical ordering

```ts
// ❌ WRONG — exits before committing the active transaction
case "DIE":
  process.exit(0);   // data loss if a file is mid-index

// ❌ WRONG — sends ACK before finishing the current file
case "DIE":
  send({ type: "ACK", ack: "DIE" });
  dying = true;      // batch will see dying=true AFTER it already moved to next file

// ✅ CORRECT — set flag, let the batch loop finish its current file,
//              then the batch loop itself sends ACK and exits
case "DIE":
  dying = true;
  // handleBatch() checks dying after each file, sends ACK: DIE, then process.exit(0)
```

### Circuit Breaker (src/indexer/supervisor.ts)

```ts
// Process-local state — NOT persisted across restarts
const CRASH_WINDOW_MS = 600_000;   // 10 minutes
const MAX_CRASHES     = 3;
let crashLog: number[] = [];       // timestamps of recent crashes

function recordCrash(): void {
  crashLog.push(Date.now());
}

function shouldRestart(): boolean {
  // Prune entries older than the window, then count what remains
  crashLog = crashLog.filter(t => Date.now() - t < CRASH_WINDOW_MS);
  return crashLog.length < MAX_CRASHES;
}

function onBatchSuccess(): void {
  // A clean batch resets the window — prune old entries
  crashLog = crashLog.filter(t => Date.now() - t < CRASH_WINDOW_MS);
}

worker.on("exit", (code) => {
  if (code === 0) return;   // clean DIE exit — no restart needed
  recordCrash();
  if (shouldRestart()) {
    console.error("[supervisor] worker crashed — restarting");
    worker = spawnWorker(dbPath, workspaceRoot);
  } else {
    console.error("[supervisor] circuit breaker open — 3 crashes in 10 min, not restarting");
    emitFatal("WORKER_CIRCUIT_OPEN");
  }
});
```

---

## 15. TypeScript LanguageService — Edge Extraction Pattern

Pythia uses the **embedded TypeScript LanguageService API** — NOT a raw `tsserver`
child process with custom IPC. This means: `import * as ts from "typescript"`,
create a `LanguageServiceHost`, call `ts.createLanguageService()`, done.
No child_process.spawn, no JSON-RPC messages, no process management.

The LanguageService lives inside the Worker Thread. Create it once at startup.
The first semantic query triggers a full parse — all subsequent queries are fast.

### Complete slow-path.ts module (copy and adapt)

```ts
// src/indexer/slow-path.ts
import * as ts   from "typescript";
import * as fs   from "node:fs";
import * as path from "node:path";
import type Database from "better-sqlite3";

export interface GraphEdge {
  source_id: string;
  target_id: string;
  edge_type: "CALLS" | "IMPORTS" | "RE_EXPORTS";
}

// ── In-memory file registry ───────────────────────────────────────────────
// The LanguageService polls getScriptVersion() on every query.
// If the version string changes, it re-parses from getScriptSnapshot().
// If the version stays the same, it uses its cached AST — changes are INVISIBLE.
const fileStore = new Map<string, { version: number; content: string }>();

export function registerFileInLS(absPath: string, content: string): void {
  const existing = fileStore.get(absPath);
  fileStore.set(absPath, {
    version: (existing?.version ?? 0) + 1,   // MUST increment or LS ignores new content
    content,
  });
}

// ── LanguageServiceHost ───────────────────────────────────────────────────
// Created once, captured by closure. workspaceRoot is the absolute path to the
// workspace (config.workspace_path). Set it before creating the LS.
let workspaceRoot = "";

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...fileStore.keys()],

  getScriptVersion: (f) => (fileStore.get(f)?.version ?? 0).toString(),

  getScriptSnapshot: (f) => {
    // Serve from in-memory store first (indexed files)
    const entry = fileStore.get(f);
    if (entry) return ts.ScriptSnapshot.fromString(entry.content);
    // Fall back to disk for lib files, node_modules, etc.
    try {
      return ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf-8"));
    } catch {
      return undefined;
    }
  },

  getCurrentDirectory: () => workspaceRoot,

  getCompilationSettings: (): ts.CompilerOptions => ({
    allowJs: true,           // REQUIRED — without this, .js files are silently ignored
    checkJs: false,          // skip type-errors; still enables go-to-definition
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    esModuleInterop: true,
    maxNodeModuleJsDepth: 0, // don't follow .js into node_modules
  }),

  // ❌ WRONG: ts.getDefaultLibFileName returns "lib.d.ts" — a filename, not a path
  // ✅ CORRECT: ts.getDefaultLibFilePath returns "/abs/path/to/node_modules/typescript/lib/lib.d.ts"
  // The host method is misleadingly named "...FileName" but MUST return a full path.
  getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),

  // These four are "optional" in the type but CRITICAL for cross-file module resolution.
  // Without them, import("./auth") fails to resolve and getDefinitionAtPosition returns undefined.
  fileExists:      ts.sys.fileExists,
  readFile:        ts.sys.readFile,
  readDirectory:   ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories:  ts.sys.getDirectories,
};

// ── LanguageService singleton ─────────────────────────────────────────────
// Create ONCE. First query is slow (parses all registered files).
// All subsequent queries on unchanged files are fast (reuse cached ASTs).
const registry = ts.createDocumentRegistry();   // share AST nodes across LS instances
let   service: ts.LanguageService | null = null;

export function initLanguageService(wsRoot: string): void {
  workspaceRoot = wsRoot;
  service = ts.createLanguageService(host, registry);
}

// ── Edge extraction ───────────────────────────────────────────────────────

export function extractEdges(absFilePath: string, content: string): GraphEdge[] {
  if (!service) throw new Error("LanguageService not initialized — call initLanguageService() first");

  registerFileInLS(absFilePath, content);

  const program    = service.getProgram();
  if (!program) return [];
  const sourceFile = program.getSourceFile(absFilePath);
  if (!sourceFile) return [];

  const edges: GraphEdge[] = [];
  const relPath = toRepoRelative(absFilePath);

  function visit(node: ts.Node): void {

    // ── IMPORTS: import { x } from './module' ──────────────────────────
    if (ts.isImportDeclaration(node)) {
      const specText = (node.moduleSpecifier as ts.StringLiteral).text;
      const resolved = ts.resolveModuleName(
        specText, absFilePath, host.getCompilationSettings(), ts.sys
      );
      const targetAbs = resolved.resolvedModule?.resolvedFileName;
      if (targetAbs && isInWorkspace(targetAbs)) {
        edges.push({
          source_id: `${relPath}::module::default`,
          target_id: `${toRepoRelative(targetAbs)}::module::default`,
          edge_type: "IMPORTS",
        });
      }
    }

    // ── RE_EXPORTS: export { x } from './module' ───────────────────────
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specText = (node.moduleSpecifier as ts.StringLiteral).text;
      const resolved = ts.resolveModuleName(
        specText, absFilePath, host.getCompilationSettings(), ts.sys
      );
      const targetAbs = resolved.resolvedModule?.resolvedFileName;
      if (targetAbs && isInWorkspace(targetAbs)) {
        const targetRel = toRepoRelative(targetAbs);
        // Walk the export specifiers to emit one RE_EXPORTS edge per named symbol
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const spec of node.exportClause.elements) {
            const symName = (spec.propertyName ?? spec.name).text;
            edges.push({
              source_id: `${relPath}::module::default`,
              target_id: `${targetRel}::function::${symName}`,  // best guess; trigger will validate
              edge_type: "RE_EXPORTS",
            });
          }
        } else {
          // export * from './module' — emit a module-level RE_EXPORTS
          edges.push({
            source_id: `${relPath}::module::default`,
            target_id: `${targetRel}::module::default`,
            edge_type: "RE_EXPORTS",
          });
        }
      }
    }

    // ── CALLS: someFunction() ──────────────────────────────────────────
    if (ts.isCallExpression(node)) {
      const calleeNode = node.expression;
      const offset     = calleeNode.getStart(sourceFile);
      const defs       = service!.getDefinitionAtPosition(absFilePath, offset);

      if (defs) {
        for (const def of defs) {
          if (def.fileName === absFilePath) continue;   // same-file calls: skip
          if (!isInWorkspace(def.fileName))  continue;  // node_modules: skip

          const targetCni = defToCni(def);
          const sourceCni = enclosingFunctionCni(node, sourceFile, relPath);

          if (targetCni && sourceCni) {
            edges.push({ source_id: sourceCni, target_id: targetCni, edge_type: "CALLS" });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return edges;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function toRepoRelative(absPath: string): string {
  // Strip workspaceRoot prefix, normalize to forward slashes, remove leading ./
  return absPath
    .replace(workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/", "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function isInWorkspace(absPath: string): boolean {
  return absPath.startsWith(workspaceRoot) && !absPath.includes("node_modules");
}

function defToCni(def: ts.DefinitionInfo): string | null {
  const rel  = toRepoRelative(def.fileName);
  const kind = def.kind as string;
  const name = def.name;
  if (!rel || !name) return null;
  // method inside a class: containerName is the class name
  if (def.containerName) return `${rel}::class::${def.containerName}::method::${name}`;
  if (["function", "class", "interface", "enum", "type", "variable"].includes(kind)) {
    return `${rel}::${kind}::${name}`;
  }
  return null;
}

function enclosingFunctionCni(
  node: ts.Node,
  sf: ts.SourceFile,
  relPath: string
): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isMethodDeclaration(cur)   ||
      ts.isArrowFunction(cur)       ||
      ts.isFunctionExpression(cur)
    ) {
      const nameNode = (cur as ts.FunctionDeclaration).name;
      if (nameNode) return `${relPath}::function::${nameNode.text}`;
    }
    cur = cur.parent;
  }
  // Fallback: attribute call to the module chunk
  return `${relPath}::module::default`;
}
```

### Inserting edges into graph_edges

```ts
// src/indexer/worker.ts (inside slow path step, after extractEdges())
const stmt = db.prepare(`
  INSERT OR IGNORE INTO graph_edges (source_id, target_id, edge_type)
  VALUES (?, ?, ?)
`);

for (const edge of edges) {
  try {
    stmt.run(edge.source_id, edge.target_id, edge.edge_type);
  } catch (err: any) {
    if (err?.message?.includes("INVALID_GRAPH_ENDPOINT")) {
      // Target file not yet indexed — expected, skip the edge quietly
      console.error(`[slow-path] skipping edge (endpoint not indexed): ${edge.target_id}`);
      continue;
    }
    throw err;   // unexpected DB error — propagate
  }
}
```

**Why INSERT OR IGNORE and not a transaction?** Slow path edges are idempotent
(same source+target+type = same primary key). The graph_edges trigger aborts on
invalid endpoints — that exception must be caught per-edge, not per-file, so
you can skip bad edges and continue. Wrapping in a transaction would abort the
entire file's edge set on one bad endpoint.

**Why does the trigger fire?** When file A imports file B but B hasn't been indexed
yet, B's module CNI doesn't exist in lcs_chunks. The trigger fires on A's IMPORTS
edge. This is expected — the next boot scan will re-run the slow path and the edge
will succeed once B is indexed.

---

## 16. BFS CTE SQL — Graph Traversal

SQLite's `WITH RECURSIVE` implements the BFS. Cycle detection uses a comma-delimited
path string — each row appends its node ID, and `INSTR` checks prevent revisits.
The 50-node LIMIT and depth < 6 WHERE clause together cap the result set.

### The full traverseGraph() function (src/retrieval/graph.ts)

```ts
// src/retrieval/graph.ts
import type Database from "better-sqlite3";

interface BfsRow {
  node_id:   string;
  min_depth: number;
  edge_type: string;
}

// Parameters are passed 3 times: once for seed SELECT, once for path init, once for WHERE exclusion
const BFS_QUERY = `
  WITH RECURSIVE traversal(node_id, depth, path, edge_type) AS (

    -- Seed row: the starting node itself (depth 0, empty edge_type)
    SELECT
      ?       AS node_id,
      0       AS depth,
      ','||?||',' AS path,   -- delimiters prevent partial-ID matches in INSTR check below
      ''      AS edge_type

    UNION ALL

    -- Outbound traversal: follow edges WHERE this node is the source
    SELECT
      ge.target_id,
      t.depth + 1,
      t.path || ge.target_id || ',',
      ge.edge_type
    FROM graph_edges ge
    JOIN traversal t ON ge.source_id = t.node_id
    WHERE t.depth < 6
      AND INSTR(t.path, ','||ge.target_id||',') = 0    -- not already visited

    UNION ALL

    -- Inbound traversal: follow edges WHERE this node is the target
    SELECT
      ge.source_id,
      t.depth + 1,
      t.path || ge.source_id || ',',
      ge.edge_type
    FROM graph_edges ge
    JOIN traversal t ON ge.target_id = t.node_id
    WHERE t.depth < 6
      AND INSTR(t.path, ','||ge.source_id||',') = 0    -- not already visited

  )
  SELECT node_id, MIN(depth) AS min_depth, edge_type
  FROM traversal
  WHERE node_id != ?        -- exclude the seed node itself
  GROUP BY node_id
  ORDER BY min_depth
  LIMIT 50
`;

const GET_CHUNK = `
  SELECT id, file_path, chunk_type, content, start_line, end_line
  FROM lcs_chunks
  WHERE id = ? AND is_deleted = 0
`;

export function traverseGraph(startCni: string, db: Database.Database): string {
  // Three ? bindings: seed node_id, seed path init, WHERE exclusion
  const rows = db.prepare(BFS_QUERY).all(startCni, startCni, startCni) as BfsRow[];

  if (rows.length === 0) {
    return `[METADATA: NO_GRAPH_EDGES]\n\nNo graph edges found starting from: ${startCni}`;
  }

  const blocks: string[] = [];
  let rank = 1;

  for (const row of rows) {
    const chunk = db.prepare(GET_CHUNK).get(row.node_id) as
      { id: string; file_path: string; chunk_type: string; content: string;
        start_line: number; end_line: number } | undefined;

    if (!chunk) continue;   // chunk was soft-deleted after the edge was created — skip

    const lang  = detectLanguage(chunk.file_path);
    const score = "1.0000";  // structural traversal — not scored by similarity

    blocks.push(
      `[DEPTH:${row.min_depth} via ${row.edge_type}]\n` +
      `--- CHUNK ${rank} score=${score}\n` +
      `PATH: ${chunk.file_path}\n` +
      `CNI: ${chunk.id}\n` +
      `TYPE: ${chunk.chunk_type}\n` +
      `LINES: ${chunk.start_line}-${chunk.end_line}\n` +
      `\`\`\`${lang}\n${chunk.content}\n\`\`\``
    );
    rank++;
  }

  return blocks.join("\n\n");
}

function detectLanguage(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".py": "python", ".go": "go", ".rs": "rust", ".java": "java",
    ".md": "markdown", ".mdx": "markdown",
  };
  return map[ext] ?? "text";
}
```

### Why the comma delimiters on the path?

```sql
-- Without delimiters:
-- path = ",auth,AuthManager,"  and  node_id = "Auth"
-- INSTR(",auth,AuthManager,", "Auth") = 7  ← FALSE POSITIVE — "Auth" matches inside "AuthManager"

-- With delimiter wrapping:
-- INSTR(",auth,AuthManager,", ",Auth,") = 0  ← CORRECT — no match

-- Always wrap BOTH the stored path entries AND the INSTR search term with commas
t.path || ge.target_id || ','                        -- append: "...Auth,"
INSTR(t.path, ','||ge.target_id||',') = 0            -- search for: ",Auth,"
```

### Common mistakes

```ts
// ❌ WRONG — only 2 bindings (missing the WHERE node_id != ? exclusion)
db.prepare(BFS_QUERY).all(startCni, startCni)
// → returns the seed node itself in the results, rank=1 is always the query node

// ✅ CORRECT — 3 bindings
db.prepare(BFS_QUERY).all(startCni, startCni, startCni)

// ❌ WRONG — depth <= 6 allows 7 hops (0..6 inclusive)
WHERE t.depth <= 6

// ✅ CORRECT — depth < 6 stops at 6 hops (0..5 in the recursive rows, results at depth 1..6)
WHERE t.depth < 6
```

---

## §17 — Hybrid Retrieval: RRF Fusion + FTS Routing

**Sprint 4.** Extends the Sprint 2 vector-only `src/retrieval/hybrid.ts` with FTS fusion and
Reciprocal Rank Fusion (RRF). The cross-encoder reranker runs in §18 after fusion.

---

### RRF formula

```
score(chunk) = wv / (60 + rank_vec) + wf / (60 + rank_fts)
```

`rank_vec` and `rank_fts` are 1-based (1 = best). A chunk that appears in vector results
only gets `wf` term = 0. A chunk that appears in FTS only gets `wv` term = 0.

**Intent weights (§17.5):**

| intent | wv | wf |
|--------|----|----|
| `semantic` | 0.7 | 0.3 |
| `structural` | 0.3 | 0.7 |

The k=60 constant (standard RRF constant) prevents top-ranked items from dominating
when one list is much longer than the other.

---

### FTS routing rules (§17.5 / §17.19)

Run `fts_lcs_chunks_kw` first. If it returns **zero hits** AND the query string meets
any of the following conditions, fall back to `fts_lcs_chunks_sub` (trigram FTS):

1. Query is double-quoted: `/^".*"$/` matches
2. Query contains `::` (CNI path separator)
3. Query contains `/` (file path)
4. Query contains `.` (extension or method access)

Fallback occurs only on the **zero-hits** condition. If kw-FTS returns ≥1 result,
always use kw-FTS regardless of query syntax.

```ts
// ❌ WRONG — always route by query syntax, ignoring hit count
function routeFts(query: string): 'kw' | 'sub' {
  if (query.includes('::') || query.includes('/')) return 'sub';
  return 'kw';
}

// ✅ CORRECT — run kw first; only fall back on zero results + syntax signal
function runFts(query: string, db: Database, limit: number): FtsRow[] {
  const kwRows = db.prepare(KW_FTS_QUERY).all(query, limit) as FtsRow[];
  if (kwRows.length > 0) return kwRows;

  const needsTrigram = /^".*"$/.test(query)
    || query.includes('::')
    || query.includes('/')
    || query.includes('.');

  if (!needsTrigram) return []; // no results, no fallback trigger
  return db.prepare(SUB_FTS_QUERY).all(query, limit) as FtsRow[];
}
```

---

### Complete `src/retrieval/hybrid.ts` (Sprint 4 replacement)

```typescript
import type { Database } from 'better-sqlite3';
import type { Embedder } from '../indexer/embedder.js';
import type { LcsChunk } from '../db/types.js';

export type RetrievalIntent = 'semantic' | 'structural';

const VEC_LIMIT = 30;
const FTS_LIMIT = 30;
const RRF_TOP_K = 12; // candidates sent to cross-encoder

const INTENT_WEIGHTS: Record<RetrievalIntent, { wv: number; wf: number }> = {
  semantic:   { wv: 0.7, wf: 0.3 },
  structural: { wv: 0.3, wf: 0.7 },
};

// ── SQL ──────────────────────────────────────────────────────────────────────

const VEC_QUERY = `
  SELECT c.*, v.distance
  FROM vec_lcs_chunks v
  JOIN lcs_chunks c ON c.id = v.chunk_id
  WHERE c.is_deleted = 0
    AND v.embedding MATCH ?
    AND k = ?
  ORDER BY v.distance
`;

const KW_FTS_QUERY = `
  SELECT c.*, fts.rank
  FROM fts_lcs_chunks_kw fts
  JOIN lcs_chunks c ON c.id = fts.rowid
  WHERE c.is_deleted = 0
    AND fts_lcs_chunks_kw MATCH ?
  ORDER BY fts.rank
  LIMIT ?
`;

const SUB_FTS_QUERY = `
  SELECT c.*, fts.rank
  FROM fts_lcs_chunks_sub fts
  JOIN lcs_chunks c ON c.id = fts.rowid
  WHERE c.is_deleted = 0
    AND fts_lcs_chunks_sub MATCH ?
  ORDER BY fts.rank
  LIMIT ?
`;

// ── Retrieval ─────────────────────────────────────────────────────────────────

export async function hybridRetrieve(
  query: string,
  db: Database,
  embedder: Embedder,
  intent: RetrievalIntent,
): Promise<{ chunks: LcsChunk[]; indexState: 'ready' | 'indexing' | 'empty' }> {
  const { wv, wf } = INTENT_WEIGHTS[intent];

  // Check corpus state
  const countRow = db.prepare('SELECT COUNT(*) as n FROM lcs_chunks WHERE is_deleted=0').get() as { n: number };
  if (countRow.n === 0) {
    return { chunks: [], indexState: 'empty' };
  }

  // Vector search
  const queryEmbedding = await embedder.embed(`search_query: ${query}`);
  const vecRows = db.prepare(VEC_QUERY).all(
    JSON.stringify(Array.from(queryEmbedding)),
    VEC_LIMIT,
  ) as (LcsChunk & { distance: number })[];

  // FTS search (with routing)
  const ftsRows = runFts(query, db, FTS_LIMIT);

  // Build rank maps (1-based)
  const vecRank = new Map<string, number>();
  vecRows.forEach((r, i) => vecRank.set(r.cni, i + 1));
  const ftsRank = new Map<string, number>();
  ftsRows.forEach((r, i) => ftsRank.set(r.cni, i + 1));

  // Union of all candidates
  const allCnis = new Set([...vecRank.keys(), ...ftsRank.keys()]);

  // Chunk lookup map (avoid N re-queries)
  const chunkMap = new Map<string, LcsChunk>();
  [...vecRows, ...ftsRows].forEach((r) => chunkMap.set(r.cni, r));

  // RRF score
  const scored: Array<{ chunk: LcsChunk; score: number }> = [];
  for (const cni of allCnis) {
    const rv = vecRank.get(cni) ?? Infinity;
    const rf = ftsRank.get(cni) ?? Infinity;
    const score = (rv === Infinity ? 0 : wv / (60 + rv))
                + (rf === Infinity ? 0 : wf / (60 + rf));
    const chunk = chunkMap.get(cni)!;
    scored.push({ chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const topK = scored.slice(0, RRF_TOP_K).map(({ chunk, score }) => ({
    ...chunk,
    score,
  }));

  return { chunks: topK, indexState: 'ready' };
}

// ── FTS routing ───────────────────────────────────────────────────────────────

function runFts(query: string, db: Database, limit: number): LcsChunk[] {
  const kwRows = db.prepare(KW_FTS_QUERY).all(query, limit) as LcsChunk[];
  if (kwRows.length > 0) return kwRows;

  const needsTrigram = /^".*"$/.test(query)
    || query.includes('::')
    || query.includes('/')
    || query.includes('.');

  if (!needsTrigram) return [];
  return db.prepare(SUB_FTS_QUERY).all(query, limit) as LcsChunk[];
}
```

### Common mistakes

```ts
// ❌ WRONG — equal weights for both intents
const WEIGHTS = { wv: 0.5, wf: 0.5 };

// ✅ CORRECT — intent-specific weights from spec §17.5
const INTENT_WEIGHTS = {
  semantic:   { wv: 0.7, wf: 0.3 },
  structural: { wv: 0.3, wf: 0.7 },
};

// ❌ WRONG — RRF denominator uses chunk count, not constant k=60
const score = wv / (vecRows.length + rank_vec);

// ✅ CORRECT — k=60 is a fixed constant (standard RRF formula)
const score = wv / (60 + rank_vec);

// ❌ WRONG — top-12 limit applied before RRF (loses cross-list candidates)
const vecRows = db.prepare(VEC_QUERY).all(embedding, 12);

// ✅ CORRECT — fetch top-30 from each source, fuse, then slice to top-12
const vecRows = db.prepare(VEC_QUERY).all(embedding, 30);
// ... fuse ... then scored.slice(0, 12)
```

---

## §18 — Cross-Encoder Reranker

**Sprint 4.** Takes the top-12 RRF candidates from §17 and reranks them using
`Xenova/ms-marco-MiniLM-L-6-v2`. Outputs a sorted list with float scores ∈ (0.0, 1.0).

**250ms hard timeout:** If scoring exceeds 250ms, return RRF order unchanged and emit
`[METADATA: RERANKER_UNAVAILABLE]` in the MCP response.

---

### Why `AutoModelForSequenceClassification`, not `pipeline('text-classification')`

`pipeline('text-classification')` wraps models that output label→probability mappings
(e.g. POSITIVE/NEGATIVE). The ms-marco cross-encoder outputs a single unbounded relevance
logit — it is a regression model, not a classifier. The `pipeline()` factory handles the
output incorrectly; use the model directly.

---

### Complete `src/retrieval/reranker.ts`

```typescript
import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from '@huggingface/transformers';
import type { PreTrainedTokenizer, PreTrainedModel } from '@huggingface/transformers';
import type { LcsChunk } from '../db/types.js';

const RERANKER_MODEL  = 'Xenova/ms-marco-MiniLM-L-6-v2';
const TIMEOUT_MS      = 250;
const MAX_TOKEN_LEN   = 512;

let _tokenizer: PreTrainedTokenizer | null = null;
let _model: PreTrainedModel | null = null;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export async function initReranker(cacheDir: string): Promise<void> {
  if (_tokenizer && _model) return;
  [_tokenizer, _model] = await Promise.all([
    AutoTokenizer.from_pretrained(RERANKER_MODEL, { cache_dir: cacheDir }),
    AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
      cache_dir: cacheDir,
      quantized: true,
    }),
  ]);
}

export function isRerankerReady(): boolean {
  return _tokenizer !== null && _model !== null;
}

// ── Reranking ─────────────────────────────────────────────────────────────────

export type RerankerResult = {
  chunks: LcsChunk[];
  rerankerUsed: boolean;
};

export async function rerank(
  query: string,
  candidates: LcsChunk[],
): Promise<RerankerResult> {
  if (!isRerankerReady() || candidates.length === 0) {
    return { chunks: candidates, rerankerUsed: false };
  }

  const passages = candidates.map((c) => c.content);
  const queries  = new Array(passages.length).fill(query) as string[];

  const scoringPromise = _scorePassages(queries, passages);
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), TIMEOUT_MS),
  );

  const result = await Promise.race([scoringPromise, timeoutPromise]);

  if (result === null) {
    // Timeout — caller must append [METADATA: RERANKER_UNAVAILABLE] to output
    return { chunks: candidates, rerankerUsed: false };
  }

  const scored = candidates.map((chunk, i) => ({ chunk, score: result[i] }));
  scored.sort((a, b) => b.score - a.score);

  return {
    chunks: scored.map(({ chunk, score }) => ({ ...chunk, score })),
    rerankerUsed: true,
  };
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _scorePassages(
  queries: string[],
  passages: string[],
): Promise<number[]> {
  const inputs = _tokenizer!(queries, {
    text_pair: passages,
    padding:    true,
    truncation: 'only_second',  // preserve full query; truncate only the passage
    max_length: MAX_TOKEN_LEN,
  });

  const output = await _model!(inputs);

  // output.logits: Tensor [batch_size, 1]
  // .data is a Float32Array; stride is 1 because num_labels=1
  const logitsData = output.logits.data as Float32Array;
  const scores: number[] = [];
  for (let i = 0; i < passages.length; i++) {
    scores.push(_sigmoid(logitsData[i]));
  }
  return scores;
}

function _sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
```

---

### Emitting `RERANKER_UNAVAILABLE` in the MCP output

When `rerankerUsed: false` is returned:

```ts
// In src/mcp/lcs-investigate.ts — append to output string when reranker timed out
if (!rerankerResult.rerankerUsed && candidates.length > 0) {
  output += '\n[METADATA: RERANKER_UNAVAILABLE]';
}
```

This flag must appear **after** the last `--- CHUNK N ---` block, on its own line.

---

### Initialization in Worker Thread entry point

```ts
// In src/indexer/worker.ts — call before entering message loop
import { initReranker } from '../retrieval/reranker.js';

const cfg = getConfig();
await initReranker(cfg.models.cache_dir).catch((err) => {
  // Non-fatal. Every rerank() call will return rerankerUsed: false.
  // Process restart recovers.
  console.error('[worker] Reranker init failed:', err);
});

// THEN enter the message loop
parentPort!.on('message', handleMessage);
```

---

### Common mistakes

```ts
// ❌ WRONG — pipeline() approach
const pipe = await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2');
const result = await pipe([query, passage]); // output is { label, score } — wrong shape

// ✅ CORRECT — direct AutoModelForSequenceClassification
const inputs = tokenizer(queries, { text_pair: passages, truncation: 'only_second' });
const output = await model(inputs); // output.logits.data → Float32Array

// ❌ WRONG — softmax on a single logit (always returns 1.0)
const score = Math.exp(logit) / (Math.exp(logit) + Math.exp(0));

// ✅ CORRECT — sigmoid converts single logit to (0, 1) range
const score = 1 / (1 + Math.exp(-logit));

// ❌ WRONG — truncation: true (may cut into query on long inputs)
truncation: true

// ✅ CORRECT — truncation: 'only_second' (passage is second, preserve full query)
truncation: 'only_second'

// ❌ WRONG — re-initialize model on every rerank call
export async function rerank(query, candidates) {
  const model = await AutoModelForSequenceClassification.from_pretrained(...);
  // ...
}

// ✅ CORRECT — singleton, initialized once at Worker Thread startup
// initReranker() at startup, then isRerankerReady() guard in rerank()
```

---

## §19 — Oracle Decommission: Argon2id Verification

**Sprint 4.** The `oracle_decommission` tool verifies the `decommission_secret` using
Argon2id. The secret is stored as a PHC-encoded hash in `pythia_sessions.secret_hash`.

**Hash parameters (§17 binding):** memory_cost=65536 KiB, time_cost=3, parallelism=1.

---

### Hash creation (on `spawn_oracle`)

```typescript
import { argon2id } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

// Called once, at session creation
export async function hashDecommissionSecret(secret: string): Promise<string> {
  const salt = randomBytes(16); // 16 bytes = 128-bit salt

  return argon2id({
    password:    secret,
    salt,
    iterations:  3,       // time_cost
    memorySize:  65536,   // 64 MB in KiB — NOT 64
    parallelism: 1,
    hashLength:  32,
    outputType:  'encoded', // PHC format: $argon2id$v=19$...
  }) as Promise<string>;
}

// The 32-char hex secret is returned to the caller on spawn (created:true only)
// The PHC hash is stored in pythia_sessions.secret_hash
export function generateSecret(): string {
  return randomBytes(16).toString('hex'); // 32-char hex
}
```

---

### Verification (on `oracle_decommission`)

```typescript
import { argon2Verify } from 'hash-wasm';

export async function verifyDecommissionSecret(
  provided: string,
  storedHash: string, // PHC-encoded from pythia_sessions.secret_hash
): Promise<boolean> {
  try {
    return await argon2Verify({ password: provided, hash: storedHash });
  } catch {
    return false; // malformed hash → treat as wrong
  }
}
```

---

### Decommission transaction (hard-delete transcripts)

```typescript
// In src/mcp/decommission.ts
export async function decommissionSession(
  sessionId: string,
  providedSecret: string,
  db: Database,
): Promise<void> {
  const row = db.prepare(
    'SELECT secret_hash FROM pythia_sessions WHERE session_id=? AND status!=?'
  ).get(sessionId, 'decommissioned') as { secret_hash: string } | undefined;

  if (!row) throw new PythiaError('SESSION_NOT_FOUND');

  const valid = await verifyDecommissionSecret(providedSecret, row.secret_hash);
  if (!valid) throw new PythiaError('DECOMMISSION_DENIED');

  // BEGIN IMMEDIATE — hard-delete transcripts, update session in single transaction
  db.transaction(() => {
    db.prepare('DELETE FROM pythia_transcripts WHERE session_id=?').run(sessionId);
    db.prepare(`
      UPDATE pythia_sessions
      SET status='decommissioned', secret_hash=NULL, session_secret=NULL
      WHERE session_id=?
    `).run(sessionId);
  })();
  // MADRs (pythia_memories) are NOT deleted
}
```

---

### Hard rules for decommission

- **Wrong secret → hard failure.** No transcripts deleted. No partial state. Return `DECOMMISSION_DENIED`.
- **BEGIN IMMEDIATE** for the delete+update transaction (not plain `BEGIN TRANSACTION`).
- **MADRs survive decommission.** `pythia_memories` rows are never touched.
- **Secrets null'd after success.** Both `secret_hash` and `session_secret` set to NULL.
- **Session name available for reuse.** After decommission, a new `spawn_oracle` with the same name succeeds (creates `generation_id = N+1`).

---

### Common mistakes

```ts
// ❌ WRONG — storing raw hex secret in the DB
db.prepare('INSERT INTO pythia_sessions (..., secret) VALUES (?,...)').run(secret);

// ✅ CORRECT — store PHC-encoded Argon2id hash; return raw secret to caller once only
const hash = await hashDecommissionSecret(secret);
db.prepare('INSERT INTO pythia_sessions (..., secret_hash) VALUES (?,...)').run(hash);
// return { decommission_secret: secret } to caller — never again

// ❌ WRONG — memorySize in MB
argon2id({ ..., memorySize: 64 }) // 64 KiB — far too weak

// ✅ CORRECT — memorySize in KiB
argon2id({ ..., memorySize: 65536 }) // 65536 KiB = 64 MB

// ❌ WRONG — outputType: 'hex' (cannot use argon2Verify on hex output)
argon2id({ ..., outputType: 'hex' })
// → argon2Verify will throw or return false

// ✅ CORRECT — outputType: 'encoded' (PHC string, self-describing, verifiable)
argon2id({ ..., outputType: 'encoded' })
```

---

## §20 — Obsidian MADR Writer + Retry Queue

**Sprint 4.** After `oracle_commit_decision` commits the MADR to SQLite, it writes a
markdown file to the Obsidian vault as a best-effort side effect. The Obsidian write
**never rolls back a committed MADR.**

---

### Transaction ordering: SQLite commits before Obsidian writes

```ts
// In src/mcp/commit-decision.ts — this ordering is MANDATORY

// 1. BEGIN IMMEDIATE — lock DB for MADR insert
db.transaction(() => {
  const madrId = insertMadr(db, decision);         // → MADR-001, MADR-002, etc.
  insertImplementsEdges(db, madrId, decision.impacts_files);
})();
// Transaction committed here

// 2. Obsidian write is OUT-OF-TRANSACTION
// Failure here does NOT roll back the committed MADR
try {
  await obsidianWriter.write(madrRow, vaultPath);
} catch (err) {
  await retryQueue.enqueue(madrRow); // queue for retry, don't throw
}

// Return success to caller — MADR is committed regardless of vault outcome
```

---

### MADR `id` derivation from AUTOINCREMENT `seq`

```ts
// pythia_memories schema:
//   seq   INTEGER PRIMARY KEY AUTOINCREMENT  ← SQLite auto-assigns
//   id    TEXT NOT NULL GENERATED ALWAYS AS ('MADR-' || printf('%03d', seq)) STORED

// ❌ WRONG — computing id in application code
const count = db.prepare('SELECT COUNT(*) as n FROM pythia_memories').get().n;
const id = `MADR-${String(count + 1).padStart(3, '0')}`;
// → COUNT()+1 skips if rows have been deleted; also a TOCTOU race

// ✅ CORRECT — let SQLite derive id from AUTOINCREMENT seq
// Simply insert; read back the generated id after insert
const info = db.prepare(`
  INSERT INTO pythia_memories (session_id, title, context, decision, rationale, impacts_files, status)
  VALUES (?,?,?,?,?,?,?)
`).run(sessionId, title, context, decision, rationale, JSON.stringify(impacts_files), 'active');

// id is a generated column — SELECT it back
const row = db.prepare('SELECT id FROM pythia_memories WHERE seq=?').get(info.lastInsertRowid);
const madrId = row.id; // 'MADR-001', 'MADR-002', etc.
```

---

### Vault file path construction

```ts
// DESIGN_SYSTEM.md §MADR file naming:
// <vault>/Pythia/MADR-NNN-<slugified-title>.md

function madrVaultPath(vaultRoot: string, id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${vaultRoot}/Pythia/${id}-${slug}.md`;
}
```

---

### Retry queue append (atomic write)

```ts
// In src/obsidian/retry.ts
// Queue is a newline-delimited JSON file: <workspace>/.pythia/obsidian-retry.jsonl

export async function enqueueRetry(madrRow: MadrRow): Promise<void> {
  const entry = JSON.stringify({
    id:         madrRow.id,
    session_id: madrRow.session_id,
    queued_at:  new Date().toISOString(),
    attempts:   0,
  }) + '\n';

  // Append is atomic on most POSIX filesystems for small writes (< PIPE_BUF)
  // Write to temp file + rename for guaranteed atomicity on all platforms
  const queuePath = path.join(workspacePath, '.pythia', 'obsidian-retry.jsonl');
  await fs.appendFile(queuePath, entry, 'utf-8');
}
```

---

### Complete writer output format (from DESIGN_SYSTEM.md)

```ts
// In src/obsidian/writer.ts
function buildMadrMarkdown(madr: MadrRow, sessionName: string): string {
  return `---
id: ${madr.id}
session: ${sessionName}
status: ${madr.status}
created: ${madr.created_at}
impacts:
${madr.impacts_files.map((f) => `  - ${f}`).join('\n')}
tags:
  - pythia/madr
---

# ${madr.id}: ${madr.title}

## Context

${madr.context}

## Decision

${madr.decision}

## Rationale

${madr.rationale}

## Impacts

${madr.impacts_files.map((f) => `- [[${f}]]`).join('\n')}
`;
}
```

---

### Hard rules for MADR commit

- **BEGIN IMMEDIATE** (not `BEGIN TRANSACTION`) for the MADR + IMPLEMENTS edge transaction.
- **`oracle_commit_decision` is NOT idempotent.** Two calls with identical arguments create two MADR rows. No deduplication.
- **IMPLEMENTS edge failure aborts the entire transaction** including the MADR. An invalid `impacts_files` path that fails the graph trigger rolls back both.
- **Obsidian failure is non-fatal.** Always enqueue to retry, never throw to caller.
- **Write only inside `<vault>/Pythia/`** subdirectory. Never write outside this prefix.
- **Never read from the vault** (write-only per FRONTEND_GUIDELINES Rule 7).

---

### Common mistakes

```ts
// ❌ WRONG — Obsidian write inside the transaction (blocks rollback recovery)
db.transaction(() => {
  insertMadr(db, decision);
  await obsidianWriter.write(madr, vault); // async inside sync transaction — throws
})();

// ✅ CORRECT — transaction commits first, then async vault write
db.transaction(() => insertMadr(db, decision))();
try {
  await obsidianWriter.write(madr, vault);
} catch {
  await retryQueue.enqueue(madr);
}

// ❌ WRONG — re-using plain BEGIN TRANSACTION for MADR insert
db.exec('BEGIN TRANSACTION');
insertMadr(db, decision);
db.exec('COMMIT');

// ✅ CORRECT — BEGIN IMMEDIATE prevents concurrent writes losing the AUTOINCREMENT seq
db.transaction(() => {
  insertMadr(db, decision);
  insertImplementsEdges(db, madrId, impacts_files);
})(); // better-sqlite3 .transaction() uses BEGIN DEFERRED by default;
      // for MADR inserts, use db.prepare('BEGIN IMMEDIATE').run() + manual commit
      // OR wrap in db.transaction() and note that serialized calls are safe
      // because better-sqlite3's .transaction() is synchronous and non-reentrant

// ❌ WRONG — vault path outside Pythia/ subdirectory
const vaultPath = `${vaultRoot}/${madrId}.md`;

// ✅ CORRECT — all vault writes go inside Pythia/ subdirectory
const vaultPath = `${vaultRoot}/Pythia/${madrId}-${slug}.md`;
```

---

## Reference Files

These docs contain full working examples for each library. Load only the refs for your current sprint.

| Library | Reference | Sprint |
|---|---|---|
| sqlite-vec | `/Users/mikeboscia/pythia/docs/reference/sqlite-vec-node-reference.md` | Sprint 1+ |
| better-sqlite3 + Worker Threads | `/Users/mikeboscia/pythia/docs/reference/better-sqlite3-worker-threads-reference.md` | Sprint 1+ |
| @huggingface/transformers v3 | `/Users/mikeboscia/pythia/docs/reference/transformers-v3-onnx-reference.md` | Sprint 1+ |
| MCP SDK tool registration | `/Users/mikeboscia/pythia/docs/reference/mcp-sdk-tool-registration-reference.md` | Sprint 2+ |
| Tree-sitter query API | `/Users/mikeboscia/pythia/docs/reference/tree-sitter-query-reference.md` | Sprint 2+ |
| TypeScript LanguageService API | `/Users/mikeboscia/pythia/docs/reference/TypeScript LanguageService API- cross-file definition resolution reference.md` | Sprint 3+ |
| hash-wasm (BLAKE3 + Argon2id) | `/Users/mikeboscia/pythia/docs/reference/hash-wasm-gemini-cli-reference.md` | Sprint 4+ |
| Cross-encoder reranker | `/Users/mikeboscia/pythia/docs/reference/cross-encoder-reranker-reference.md` | Sprint 4+ |
