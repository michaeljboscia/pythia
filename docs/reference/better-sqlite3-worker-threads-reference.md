# better-sqlite3 + Worker Threads Reference

better-sqlite3 is synchronous and single-threaded by design. This is a feature, not a
limitation — it's why it's the fastest SQLite binding for Node.js. But the threading model
has hard rules that will cause silent data corruption or crashes if violated.

Sources: [threads.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md) ·
[performance/WAL docs](https://wchargin.com/better-sqlite3/performance.html) ·
[SQLite threading docs](https://sqlite.org/threadsafe.html) ·
[BEGIN IMMEDIATE reference](https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/)

---

## The Hard Rule — State It Plainly

**A `Database` object cannot be shared between threads. Full stop.**

- You cannot create a `Database` in the main thread and pass it to a Worker Thread.
- You cannot create a `Database` in a Worker Thread and pass it back to the main thread.
- `Database` instances are **not transferable** via `postMessage`, `workerData`, or
  `SharedArrayBuffer`. Attempting to do so will throw or produce undefined behavior.
- Prepared statements (`db.prepare(...)`) are children of their `Database` connection —
  they are equally non-transferable.

**The correct pattern: every thread opens its own `Database` connection to the same file.**

This is safe because SQLite's WAL mode is designed for multiple concurrent connections to
one file, whether from threads or separate processes.

---

## Wrong Pattern — Shared Connection

```js
// main.js — THIS IS WRONG. DO NOT DO THIS.
import Database from "better-sqlite3";
import { Worker, workerData } from "worker_threads";

const db = new Database("pythia.db"); // opened in main thread
db.pragma("journal_mode = WAL");

// WRONG: passing the Database instance to the worker
// This will either throw, silently corrupt data, or crash Node.
const worker = new Worker("./worker.js", {
  workerData: { db }  // ❌ Database is not transferable — this is undefined behavior
});
```

```js
// worker.js — ALSO WRONG if you receive db from the parent
import { workerData } from "worker_threads";

// ❌ You cannot use a Database object received from another thread
const { db } = workerData;
db.prepare("SELECT 1").get(); // undefined behavior — connection belongs to main thread
```

---

## Correct Pattern — One Connection Per Thread

```js
// main.js
import { Worker } from "worker_threads";
import os from "os";

// Main thread opens its own connection for its own use
import Database from "better-sqlite3";
const db = new Database("pythia.db");
applyPragmas(db);

// Pass only the FILE PATH to the worker, not the Database object
// Worker opens its own independent connection
const workers = [];
for (let i = 0; i < os.availableParallelism(); i++) {
  workers.push(new Worker("./worker.js", {
    workerData: { dbPath: "pythia.db" }  // ✅ just a string
  }));
}

function applyPragmas(db) {
  // Must be applied to every new Database() instance — see Pragma Sequence below
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -32000");   // 32 MB
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
}
```

```js
// worker.js
import { parentPort, workerData } from "worker_threads";
import Database from "better-sqlite3";

// ✅ Each worker opens its OWN connection to the same file
const db = new Database(workerData.dbPath);
applyPragmas(db);  // apply pragmas to this connection — they don't carry over

const selectStmt = db.prepare("SELECT * FROM merchants WHERE id = ?");

parentPort.on("message", ({ sql, parameters }) => {
  // Use this thread's own prepared statements
  const result = db.prepare(sql).all(...parameters);
  parentPort.postMessage(result);
});

// Clean up when the worker exits
process.on("exit", () => db.close());

function applyPragmas(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -32000");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
}
```

---

## Pragma Sequence — Apply to Every New Connection

These pragmas are **per-connection**, not per-file. They reset to defaults when you open a
new `Database()`. You must apply them every time, in every thread.

```js
function openDb(path) {
  const db = new Database(path);

  // journal_mode = WAL
  // Persists in the db file — only needs to be set once ever, but harmless to set each time.
  // Without this: readers block writers, writes serialize hard.
  db.pragma("journal_mode = WAL");

  // busy_timeout = 5000
  // Per-connection. Default is 0 — meaning writes fail IMMEDIATELY if another writer holds
  // the lock. With 5000ms, SQLite retries for 5 seconds before throwing SQLITE_BUSY.
  // Always set this on every connection that might write.
  db.pragma("busy_timeout = 5000");

  // synchronous = NORMAL
  // better-sqlite3's bundled SQLite already defaults WAL mode to NORMAL, but set it
  // explicitly. NORMAL = sync on checkpoint, not on every commit. Fast and safe for
  // most workloads. Use FULL if you need crash-proof durability.
  db.pragma("synchronous = NORMAL");

  // cache_size = -32000
  // Negative = kilobytes. 32MB page cache per connection. Tune to your RAM budget.
  db.pragma("cache_size = -32000");

  // foreign_keys = ON
  // Off by default in SQLite for backwards compatibility. Enable it.
  db.pragma("foreign_keys = ON");

  // temp_store = MEMORY
  // Store temp tables/indices in RAM instead of disk. Minor perf win.
  db.pragma("temp_store = MEMORY");

  return db;
}
```

---

## WAL Mode — Multiple Processes Sharing the Same `.db` File

WAL mode is designed for concurrent access. Key properties:

- **Readers never block writers** and **writers never block readers**. A reader sees the
  database as it was at the start of their transaction, even while a writer commits.
- **Only one writer at a time.** SQLite serializes write transactions at the file level.
  Multiple concurrent writers wait, not fail — as long as `busy_timeout` is set.
- **WAL mode is persistent.** Once you set `PRAGMA journal_mode = WAL` on a database file,
  it stays in WAL mode for all future connections from any process, until explicitly changed.
  You don't need to re-enable it per connection, but calling it again is harmless.
- **Checkpoint starvation:** If readers run continuously with no gap, the WAL file cannot
  be checkpointed and will grow unboundedly. This only occurs with true 100% read
  saturation across multiple processes. If you hit it, call `db.checkpoint()` explicitly.
- **Recovery on crash:** The first new connection to a WAL database after a crash starts
  a recovery process and holds an exclusive lock during it. Other connections trying to
  open simultaneously will get `SQLITE_BUSY_RECOVERY`. This resolves within milliseconds.
  Having `busy_timeout` set handles this automatically.

---

## BEGIN IMMEDIATE — Preventing Write Conflict Deadlocks

**The problem with plain `BEGIN` (default):**

SQLite defers deciding if a transaction is a read or write until the first statement.
If you do a `SELECT` first, then later an `INSERT`, SQLite has to upgrade the transaction
from read to write. If another writer committed between your `SELECT` and your `INSERT`,
the upgrade fails with `SQLITE_BUSY` **immediately, ignoring your `busy_timeout`** — because
upgrading a read lock to a write lock is a potential deadlock scenario.

**The fix: `BEGIN IMMEDIATE` when you know you're going to write.**

```js
// ❌ DANGEROUS — deferred transaction that reads then writes
const row = db.prepare("SELECT * FROM jobs WHERE status = 'QUEUED' LIMIT 1").get();
if (row) {
  // If another writer committed here, the UPDATE below throws SQLITE_BUSY immediately
  // even with busy_timeout set — SQLite cannot upgrade the read lock
  db.prepare("UPDATE jobs SET status = 'PROCESSING' WHERE id = ?").run(row.id);
}

// ✅ CORRECT — use BEGIN IMMEDIATE for read-modify-write transactions
const writeTransaction = db.transaction((workerId) => {
  // db.transaction() uses BEGIN by default. For write transactions, force IMMEDIATE:
  const row = db.prepare("SELECT * FROM jobs WHERE status = 'QUEUED' LIMIT 1").get();
  if (!row) return null;
  db.prepare("UPDATE jobs SET status = 'PROCESSING' WHERE id = ?").run(row.id);
  return row;
});

// better-sqlite3 doesn't expose BEGIN IMMEDIATE through .transaction() directly.
// Use a raw exec for explicit control:
function runImmediate(fn) {
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

// Usage:
const job = runImmediate(() => {
  const row = db.prepare("SELECT * FROM jobs WHERE status = 'QUEUED' LIMIT 1").get();
  if (!row) return null;
  db.prepare("UPDATE jobs SET status = 'PROCESSING' WHERE id = ?").run(row.id);
  return row;
});
```

**When to use BEGIN IMMEDIATE:**
- Any transaction that reads, then writes based on what it read (check-then-act pattern)
- Job queue claim patterns
- Any multi-statement write where the read result influences the write

**When you don't need it:**
- Pure write transactions (INSERT/UPDATE/DELETE with no prior SELECT in same transaction)
- Read-only transactions
- Single-statement writes (auto-committed)

---

## Thread Pool Pattern — Complete Example

```js
// db-pool.js — A minimal worker thread pool for SQLite queries
import { Worker } from "worker_threads";
import os from "os";

const DB_PATH = "./pythia.db";
const POOL_SIZE = os.availableParallelism();

const queue = [];
let workers = [];

function spawn() {
  const worker = new Worker(new URL("./db-worker.js", import.meta.url), {
    workerData: { dbPath: DB_PATH }
  });

  let job = null;

  function takeWork() {
    if (!job && queue.length) {
      job = queue.shift();
      worker.postMessage(job.message);
    }
  }

  worker
    .on("online", () => {
      workers.push({ takeWork });
      takeWork();
    })
    .on("message", (result) => {
      job.resolve(result);
      job = null;
      takeWork();
    })
    .on("error", (err) => {
      if (job) job.reject(err);
      job = null;
    })
    .on("exit", (code) => {
      workers = workers.filter((w) => w.takeWork !== takeWork);
      if (code !== 0) spawn(); // respawn crashed workers
    });
}

// Spawn the pool
for (let i = 0; i < POOL_SIZE; i++) spawn();

// Public API — returns a Promise
export function query(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    const message = { sql, parameters };
    queue.push({ message, resolve, reject });
    // Dispatch to any idle worker
    for (const w of workers) w.takeWork();
  });
}
```

```js
// db-worker.js
import { parentPort, workerData } from "worker_threads";
import Database from "better-sqlite3";

// ✅ Worker owns its own connection
const db = new Database(workerData.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -32000");
db.pragma("foreign_keys = ON");
db.pragma("temp_store = MEMORY");

parentPort.on("message", ({ sql, parameters }) => {
  try {
    const result = db.prepare(sql).all(...parameters);
    parentPort.postMessage(result);
  } catch (err) {
    // Re-throw so the pool's .on('error') picks it up
    throw err;
  }
});

process.on("exit", () => db.close());
```

---

## Summary Table

| Rule | Detail |
|---|---|
| `Database` shareable across threads? | **No. Never.** One connection per thread. |
| Pass db to worker via `workerData`? | **No.** Pass the file path (string) only. |
| WAL mode per-connection? | No — persists in the file. But set per-connection anyway. |
| `busy_timeout` per-connection? | **Yes.** Must set on every new `Database()`. Default is 0. |
| `synchronous` per-connection? | **Yes.** Must set on every new `Database()`. |
| Plain `BEGIN` safe for read-then-write? | **No.** Use `BEGIN IMMEDIATE` to prevent upgrade deadlocks. |
| Multiple processes on same `.db` file? | Safe in WAL mode with `busy_timeout` set. |
| Readers block writers in WAL? | **No.** Readers and writers are fully concurrent. |
| Multiple simultaneous writers? | **No.** SQLite serializes writes. They queue, not fail (with `busy_timeout`). |

---

*Created: 2026-03-11*
*Sources: [github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md) ·
[better-sqlite3 WAL docs](https://wchargin.com/better-sqlite3/performance.html) ·
[sqlite.org/threadsafe.html](https://sqlite.org/threadsafe.html) ·
[BEGIN IMMEDIATE deep dive](https://berthug.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/)*
