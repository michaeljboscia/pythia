# Event-Driven Architecture for File Watching, Indexing, and MCP Serving in Node.js

A single Node.js process can coordinate file watching, background indexing, and low-latency MCP tool request handling — but only if the architecture respects the event loop's single-threaded nature and applies deliberate concurrency controls. The central design challenge is preventing CPU-intensive indexing from starving the MCP server's response path. The solution combines **worker_threads** for CPU-bound indexing, an **in-process priority queue** for job management, **accumulating debounce** for file watcher flood control, and **SQLite in WAL mode** for concurrent read/write access to the index database. This report grounds each architectural decision in primary documentation and measured performance data.

## How the Node.js event loop constrains system design

The Node.js event loop executes in [six phases](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick): timers, pending callbacks, idle/prepare, poll, check, and close callbacks. Each phase maintains a FIFO queue of callbacks. The poll phase is the heart of the loop — it calculates how long to block waiting for I/O and processes incoming connection data, file system results, and other I/O events. The check phase runs `setImmediate()` callbacks immediately after poll completes. Critically, **microtasks drain between every phase transition**: `process.nextTick()` callbacks execute first, followed by Promise resolution callbacks, before the loop advances to the next phase. This means a recursive `process.nextTick()` call can [starve the entire event loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) indefinitely — a trap that must be avoided in any indexing pipeline.

For an MCP server handling tool requests over stdio or HTTP, response latency directly correlates with event loop lag. Baseline lag on an idle loop measures [**1–2ms**](https://davidhettler.net/blog/event-loop-lag/). When CPU-bound work blocks the loop, every pending callback — including MCP request handlers — waits. Real-world measurements from a bcryptjs benchmark showed event loop lag spikes of [**78–98ms** per hash operation](https://davidhettler.net/blog/event-loop-lag/) when running pure-JavaScript crypto on the main thread, while the equivalent C++ addon kept lag at 1–2ms by offloading to the libuv thread pool. The Trigger.dev team found [**15-second lag spikes**](https://trigger.dev/blog/event-loop-lag) when processing unpaginated datasets of 8,000+ items, and the Riskified engineering team documented how processing ~800,000 items synchronously rendered their event loop [completely unresponsive](https://medium.com/riskified-technology/unblocking-the-node-js-event-loop-practical-troubleshooting-of-a-real-world-bottleneck-27aa5a3d2022).

Node.js provides two built-in measurement APIs for detecting these problems. The [`monitorEventLoopDelay`](https://nodejs.org/api/perf_hooks.html) histogram from `node:perf_hooks` samples loop delay at configurable resolution and reports min, max, mean, and percentile values in nanoseconds. The [`eventLoopUtilization`](https://nodejs.org/api/perf_hooks.html) API returns a ratio from 0.0 to 1.0 representing the proportion of time the loop spent executing JavaScript versus waiting in the event provider. Both should be instrumented in any system combining indexing with request serving.

### setImmediate chunking: useful but limited

The official Node.js documentation recommends [partitioning CPU work using `setImmediate()`](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) to yield back to the event loop between chunks:

```js
function processInChunks(items, chunkSize = 100) {
  return new Promise((resolve) => {
    let index = 0;
    function processChunk() {
      const end = Math.min(index + chunkSize, items.length);
      for (let i = index; i < end; i++) {
        processItem(items[i]);
      }
      index = end;
      if (index < items.length) {
        setImmediate(processChunk); // yield to event loop
      } else {
        resolve();
      }
    }
    processChunk();
  });
}
```

This pattern schedules each chunk in the check phase, allowing the poll phase to process I/O between chunks. The [bbss.dev practical guide](https://www.bbss.dev/posts/eventloop/) demonstrated that wrapping CPU work in `setImmediate` increased event loop yield points from zero to six intervals during an equivalent computation, confirming the technique works for light workloads.

However, the Platformatic team — including Node.js core contributors — published a detailed analysis warning that [setImmediate chunking is "inherently risky"](https://blog.platformatic.dev/the-dangers-of-setimmediate) for production workloads. Under load, each deferred chunk consumes memory while waiting in the immediate queue, potentially causing memory exhaustion. A change in libuv 1.45.0 (shipped with Node.js 20) altered event loop timing in ways that exposed this as a dangerous anti-pattern. **For CPU-bound indexing work, worker_threads are the correct solution.**

## Worker threads for background indexing

The [`worker_threads`](https://nodejs.org/api/worker_threads.html) module enables true parallelism within a Node.js process. Each worker runs its own V8 instance and event loop on a separate OS thread, communicating with the main thread via structured-clone message passing through `MessagePort`. Worker startup cost is [**~1–3ms**](https://milddev.com/nodejs-when-to-use-worker-threads), making them practical for long-lived background tasks but wasteful for microsecond operations.

The official documentation is explicit: ["In actual practice, use a pool of Workers instead"](https://nodejs.org/api/worker_threads.html) of spawning new workers per task. For an indexing system, a single dedicated worker thread is typically sufficient since SQLite only supports one concurrent writer. The architecture looks like this:

```js
// main.js — handles MCP requests, serves read queries
const { Worker } = require('worker_threads');
const indexer = new Worker('./indexer-worker.js');

indexer.postMessage({ type: 'index-batch', files: changedFiles });
indexer.on('message', (msg) => {
  if (msg.type === 'indexed') {
    console.log(`Indexed ${msg.count} files`);
  }
});

// MCP tool handler runs on main thread, never blocked by indexing
function handleMCPQuery(params) {
  return db.prepare('SELECT * FROM search_index WHERE content MATCH ?')
    .all(params.query);
}
```

```js
// indexer-worker.js — dedicated to write operations
const { parentPort } = require('worker_threads');
const Database = require('better-sqlite3');

const db = new Database('index.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 10000');

const insert = db.prepare(
  'INSERT OR REPLACE INTO search_index (path, content, mtime) VALUES (?, ?, ?)'
);
const batchInsert = db.transaction((items) => {
  for (const item of items) insert.run(item.path, item.content, item.mtime);
});

parentPort.on('message', ({ type, files }) => {
  if (type === 'index-batch') {
    batchInsert(files);
    parentPort.postMessage({ type: 'indexed', count: files.length });
  }
});
```

Data transfer between threads uses the [HTML structured clone algorithm](https://nodejs.org/api/worker_threads.html), which supports circular references and TypedArrays. For large payloads, `SharedArrayBuffer` provides zero-copy shared memory, though the indexing use case typically benefits more from transferring file content as strings via `postMessage`. The key architectural constraint is that [network sockets cannot be transferred](https://nodejs.org/api/worker_threads.html) between threads, so MCP protocol handling must remain on the main thread.

## Choosing an in-process message queue

The three viable queue architectures for a local-only desktop application — BullMQ, better-queue, and a custom EventEmitter — occupy fundamentally different points on the reliability-complexity spectrum.

**BullMQ** is a production-grade distributed queue with [~2.8 million weekly npm downloads](https://www.npmjs.com/package/bullmq) and comprehensive features: exponential backoff retries, priority scheduling, rate limiting, cron jobs, and parent-child job flows. However, it has a [hard dependency on Redis ≥ 6.2.0](https://docs.bullmq.io/guide/connections), requiring a separate server process. For a desktop application, this means bundling and managing Redis alongside the app — adding **50–100MB+** to distribution size, requiring port management, and demanding explicit [AOF persistence configuration](https://docs.bullmq.io/guide/going-to-production) since default Redis settings can evict queue data. The Redis `maxmemory-policy` must be set to [`noeviction`](https://docs.bullmq.io/guide/going-to-production) or BullMQ breaks silently. This infrastructure burden makes BullMQ inappropriate for embedded local-only systems.

**A custom EventEmitter queue** sits at the opposite extreme. Node.js [EventEmitter delivery is synchronous](https://nodejs.org/en/learn/asynchronous-work/the-nodejs-event-emitter) — all listeners execute before `emit()` returns — which provides predictable ordering but no built-in persistence, retry logic, or priority scheduling. A basic implementation requires roughly 50 lines:

```js
class TaskQueue extends EventEmitter {
  constructor(concurrency) {
    super();
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }
  push(task) {
    this.queue.push(task);
    this.drain();
  }
  drain() {
    while (this.running < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      this.running++;
      task().finally(() => { this.running--; this.drain(); });
    }
  }
}
```

This is adequate for ephemeral task serialization but lacks every feature needed for reliable indexing: jobs vanish on restart, failed tasks are lost, and priority must be implemented manually with a sorted data structure.

**[better-queue](https://github.com/diamondio/better-queue)** occupies the sweet spot. It runs entirely in-process with pluggable storage backends, including a [SQLite store via `better-queue-sqlite`](https://www.npmjs.com/package/better-queue) that persists jobs to a local file. Its feature set maps directly to indexing requirements:

- **Retry logic** with configurable `maxRetries` and `retryDelay` (though only flat delay, not exponential backoff)
- **Priority scheduling** via a callback: `priority: (task, cb) => cb(null, task.urgent ? 10 : 1)`
- **Concurrency control**: `concurrent: N` limits parallel task execution
- **Batch processing**: `batchSize` and `batchDelay` options coalesce tasks
- **Preconditions**: a check function that gates processing (useful for pausing indexing during heavy MCP load)
- **Task merge/filter**: a `filter` function that [deduplicates tasks](https://github.com/diamondio/better-queue) — critical when the same file changes multiple times rapidly

```js
const Queue = require('better-queue');
const indexQueue = new Queue(
  async function processTask(batch, cb) {
    try {
      indexer.postMessage({ type: 'index-batch', files: batch });
      cb(null);
    } catch (err) { cb(err); }
  },
  {
    concurrent: 1,        // single indexer worker
    maxRetries: 3,
    retryDelay: 2000,
    batchSize: 50,        // coalesce up to 50 files per batch
    batchDelay: 500,      // wait 500ms for more items
    priority: (task, cb) => cb(null, getPriority(task.path)),
    store: { type: 'sql', dialect: 'sqlite', path: './queue.db' }
  }
);
```

The main limitations are [unclear maintenance status](https://github.com/diamondio/better-queue) (the repository has aging open issues) and lack of exponential backoff. For a desktop indexing system where the queue feeds a single worker thread, these are acceptable tradeoffs. The alternative [`node-persistent-queue`](https://www.npmjs.com/package/node-persistent-queue) provides a simpler SQLite-backed EventEmitter API if better-queue's complexity is unwanted.

## Backpressure when hundreds of files change at once

A `git pull` that updates hundreds of files generates a flood of file system events that can overwhelm both the event loop and the indexing pipeline. The solution layers three mechanisms: debounced accumulation, batch coalescing, and bounded queue depth.

### Debounced event accumulation with chokidar

[Chokidar](https://github.com/paulmillr/chokidar) emits individual events (`add`, `change`, `unlink`) per file with no built-in batching. Its `awaitWriteFinish` option polls file size until stable, but this addresses incomplete writes rather than event floods. The [`atomic` option](https://github.com/paulmillr/chokidar) coalesces editor-style delete-then-recreate patterns into single `change` events but doesn't help with bulk operations. Ignoring the `.git` directory is essential — without it, git's internal operations generate thousands of spurious events:

```js
const watcher = chokidar.watch('.', {
  ignored: /(^|[\/\\])\.git/,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }
});
```

The critical missing piece is an **accumulating debounce** that collects all events during a quiet period and delivers them as a single batch. A standard debounce discards intermediate calls; a Map-based accumulator preserves them while deduplicating per-path:

```js
function createCoalescingDebounce(callback, delay) {
  let timeout;
  const pending = new Map();
  return function(event, filePath) {
    pending.set(filePath, { event, time: Date.now() });
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const batch = new Map(pending);
      pending.clear();
      callback(batch);
    }, delay);
  };
}

const debouncedHandler = createCoalescingDebounce(processBatch, 300);
watcher.on('all', (event, path) => debouncedHandler(event, path));
```

The **300ms debounce window** is a practical default for git operations. The [Node.js `--watch` mode uses 200ms](https://github.com/nodejs/node/issues/51954) internally; [Tailwind CSS uses 50ms](https://github.com/tailwindlabs/tailwindcss/pull/5758) for faster feedback. For git pulls that may take seconds, 300ms balances latency against coalescing effectiveness. The Map-based approach ensures that if a file changes three times during the window, only the final event type is processed.

### Bounded processing with priority and rate limiting

After debouncing, the coalesced batch feeds into a priority queue with concurrency control. The [`p-queue`](https://github.com/sindresorhus/p-queue) library provides priority scheduling, concurrency limits, and built-in backpressure detection via its `isSaturated` property:

```js
import PQueue from 'p-queue';

const indexQueue = new PQueue({
  concurrency: 4,
  intervalCap: 20,    // max 20 operations per interval
  interval: 1000      // per second
});

async function processBatch(changes) {
  for (const [filePath, { event }] of changes) {
    if (indexQueue.size > 200) {
      await indexQueue.onSizeLessThan(100); // backpressure
    }
    indexQueue.add(
      () => readAndIndex(filePath, event),
      { priority: getPriority(filePath) }
    );
  }
}

function getPriority(path) {
  if (path.endsWith('package.json') || path.endsWith('tsconfig.json')) return 10;
  if (path.match(/\.(ts|js|py)$/)) return 5;
  return 1;
}
```

The [`onSizeLessThan()`](https://github.com/sindresorhus/p-queue) method is the key backpressure primitive — it returns a Promise that resolves when the queue drains below the threshold, naturally throttling the producer. The Voxer engineering team's analysis of Node.js backpressure emphasizes that the [critical principle is limiting work before it is scheduled](https://engineering.voxer.com/2013/09/16/backpressure-in-nodejs/), since once event handlers fire, they must be serviced. Checking queue depth before adding items implements this principle.

For sustained rate control under prolonged file change streams, a [token bucket algorithm](https://kendru.github.io/javascript/2018/12/28/rate-limiting-in-javascript-with-a-token-bucket/) provides the right semantics: burst capacity handles the initial git pull flood, while the refill rate caps sustained indexing throughput. The [`limiter`](https://github.com/jhurliman/node-rate-limiter) library provides a ready-made `TokenBucket` implementation that integrates cleanly with async processing.

Note that Linux systems face a platform-specific risk: the inotify subsystem has a finite event queue, and [a burst of 10,000+ events can cause queue overflow](https://dev.to/asoseil/how-macos-linux-and-windows-detect-file-changes-and-why-it-isnt-easy-194m), silently dropping notifications. The kernel default `fs.inotify.max_user_watches` may need to be increased to 524,288, as [chokidar recommends](https://github.com/paulmillr/chokidar), and the application should handle the `error` event from the watcher to detect overflow conditions.

## SQLite WAL mode enables concurrent read and write access

The indexing architecture places reads (MCP query serving) and writes (background indexing) on separate threads. SQLite's [WAL (Write-Ahead Logging) mode](https://sqlite.org/wal.html) is what makes this work. In the default rollback journal mode, readers and writers block each other because writes go directly to the database file. WAL inverts this: changes append to a separate log file, and **readers continue operating from the original database** while writes accumulate in the WAL. Each reader captures a snapshot of the last valid commit record (the "end mark") when its transaction begins, providing snapshot isolation without locks.

The concurrency model is precise: [**readers never block writers, writers never block readers**](https://sqlite.org/wal.html), but only one writer can append to the WAL at a time. For the indexing architecture — one writer thread, one or more reader threads — this is an ideal fit. Benchmarks on an M1 MacBook Pro show [**72,000+ write ops/sec**](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) for 1KB records with `synchronous=NORMAL`, and throughput stays [remarkably flat up to ~64 concurrent threads](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) accessing the same database.

### Essential configuration

The [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) library is the preferred SQLite binding for this architecture. Its synchronous API is intentionally designed — [it avoids the mutex thrashing and context-switching overhead](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) of node-sqlite3's async approach, achieving higher throughput for the rapid small queries typical in index lookups. The synchronous nature means each query briefly blocks its thread's event loop, but most indexed reads complete in microseconds, well below the perceptible lag threshold.

```js
const db = new Database('index.db');
db.pragma('journal_mode = WAL');          // persistent, survives reconnection
db.pragma('synchronous = NORMAL');        // safe with WAL; 3-4x faster writes
db.pragma('busy_timeout = 5000');         // retry for 5s on lock contention
db.pragma('cache_size = -64000');         // 64MB page cache
db.pragma('mmap_size = 268435456');       // 256MB memory-mapped I/O
```

Setting [`synchronous = NORMAL`](https://sqlite.org/wal.html) with WAL mode is the critical performance optimization. In this configuration, SQLite fsyncs only during checkpoints rather than on every commit, yielding a **3–4x write speed improvement** while remaining safe against application crashes. Data loss is only possible on operating system crash or power failure — not on application termination.

The [`busy_timeout`](https://sqlite.org/pragma.html) pragma (or better-sqlite3's constructor `timeout` option) controls how long a blocked writer retries before returning SQLITE_BUSY. The [Litestream project recommends **5000ms** as a reasonable default](https://litestream.io/tips/). Below 5 seconds, occasional SQLITE_BUSY errors surface under contention; above 30 seconds, user-facing operations stall.

### The checkpoint starvation trap

WAL mode introduces a maintenance concern: the WAL file grows as writes accumulate, and it only shrinks when checkpointed — a process that transfers WAL contents back to the main database file. Auto-checkpointing triggers after [**1000 pages (~4MB)**](https://sqlite.org/wal.html) by default, using PASSIVE mode that doesn't block readers. However, [**if any read transaction is active, the checkpoint cannot advance past it**](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md), and the WAL grows without bound. As the WAL grows, read performance degrades because readers must scan more WAL pages.

The mitigation is straightforward with better-sqlite3's synchronous API: since a `.get()` or `.all()` call completes in a single synchronous step, read transactions are inherently short-lived. There is no async gap during which a read transaction remains open. The indexer worker should [periodically force a PASSIVE checkpoint](https://sqlite.org/wal.html) after large batch operations:

```js
// In the indexer worker, after each batch:
batchInsert(items);
const walInfo = db.pragma('wal_checkpoint(PASSIVE)');
// walInfo: [{ busy: 0, log: N, checkpointed: M }]
```

Monitoring WAL file size and triggering a RESTART checkpoint when it exceeds a threshold (e.g., 50MB) prevents unbounded growth during sustained indexing.

### Worker thread database access rules

The [better-sqlite3 threading documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md) states the essential rule: **open a separate database connection in each worker thread**. Database instances contain native handles that cannot be shared across threads. The main thread should open a read-only connection (`{ readonly: true }`) for serving MCP queries, while the indexer worker opens a read-write connection for inserts. Both connections see the same WAL-mode database and benefit from the concurrent access model.

One subtle pitfall deserves emphasis: a transaction that starts with `BEGIN DEFERRED` (the default) and later attempts to write will receive an [**immediate SQLITE_BUSY error that ignores busy_timeout**](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) if another writer has modified the database since the transaction began. The better-sqlite3 `.transaction()` helper avoids this by using `BEGIN IMMEDIATE`, which acquires the write lock upfront and respects the busy timeout.

## Putting it all together: the complete event flow

The full architecture chains these components into a pipeline with backpressure at every stage:

```
[File System]
      │
[Chokidar Watcher] ── ignores .git, node_modules
      │
[Accumulating Debounce] ── 300ms quiet window, Map-based coalescing
      │
[Priority Queue (p-queue or better-queue)] ── concurrency=4, rate limited
      │
[Worker Thread Message] ── postMessage to indexer
      │
[Indexer Worker] ── better-sqlite3, WAL mode, batched transactions
      │
[SQLite Database] ── WAL file for writes, main DB for reads
      │
[Main Thread Read Connection] ── serves MCP tool queries
```

MCP request handlers on the main thread read from the SQLite database through a read-only connection that never contends with the indexer's writes. File system events flow through debouncing and coalescing before entering the priority queue, where backpressure limits prevent unbounded accumulation. The worker thread performs all CPU-intensive parsing and database writes, keeping the main thread's event loop free to respond to MCP requests with **sub-millisecond latency overhead**.

The key design principle, stated directly in the [official Node.js guide](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop): **"The Event Loop should orchestrate client requests, not fulfill them itself."** By treating the main thread as a coordinator — dispatching file events to the queue, forwarding batches to the worker, serving reads from the index — the system maintains responsiveness under heavy indexing load.

## Version timestamp

Research conducted and report compiled: **March 11, 2026**. Node.js documentation references reflect v20–v25 era APIs. SQLite documentation current as of version 3.52.0 (March 2026). All URLs verified accessible at time of research.

## Bibliography

| Title | URL | Key Contribution |
|---|---|---|
| The Node.js Event Loop, Timers, and process.nextTick() | https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick | Official documentation of the six event loop phases and microtask scheduling |
| Don't Block the Event Loop | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | Official guide to setImmediate chunking and the "orchestrate, don't fulfill" principle |
| Worker Threads API (Node.js) | https://nodejs.org/api/worker_threads.html | Official worker_threads API reference including MessagePort, SharedArrayBuffer, and transfer semantics |
| Performance Measurement APIs | https://nodejs.org/api/perf_hooks.html | monitorEventLoopDelay and eventLoopUtilization APIs for event loop health monitoring |
| Understanding setImmediate() | https://nodejs.org/en/learn/asynchronous-work/understanding-setimmediate | Official explanation of microtask vs macrotask execution priority |
| The Dangers of setImmediate | https://blog.platformatic.dev/the-dangers-of-setimmediate | Platformatic's warning against setImmediate chunking in production, documenting memory risks |
| Monitoring Node.js: Watch Your Event Loop Lag | https://davidhettler.net/blog/event-loop-lag/ | Concrete measurements: 78–98ms lag from bcryptjs, 1–2ms baseline |
| How We Tamed Node.js Event Loop Lag | https://trigger.dev/blog/event-loop-lag | Real-world case study finding 15-second lag spikes from unpaginated data processing |
| Unblocking the Node.js Event Loop | https://medium.com/riskified-technology/unblocking-the-node-js-event-loop-practical-troubleshooting-of-a-real-world-bottleneck-27aa5a3d2022 | Riskified's analysis of ~800K item processing causing event loop starvation |
| A Practical Guide to Not Blocking the Event Loop | https://www.bbss.dev/posts/eventloop/ | Demonstrated setImmediate yielding from zero to six event loop intervals |
| Complete Guide to Worker Threads (NodeSource) | https://nodesource.com/blog/worker-threads-nodejs-multithreading-in-javascript | Worker thread API patterns, pool architecture, and startup benchmarks |
| When to Use Worker Threads | https://milddev.com/nodejs-when-to-use-worker-threads | Worker startup cost measurement: ~1–3ms |
| BullMQ Official Documentation | https://docs.bullmq.io/ | Feature reference for retry, priority, rate limiting, and Redis dependency details |
| BullMQ Connection Guide | https://docs.bullmq.io/guide/connections | Redis ≥ 6.2.0 requirement and maxmemory-policy configuration |
| BullMQ Going to Production | https://docs.bullmq.io/guide/going-to-production | Redis AOF persistence and noeviction policy requirements |
| better-queue (npm) | https://www.npmjs.com/package/better-queue | In-process queue with pluggable SQLite storage, priority, retry, and batch processing |
| better-queue (GitHub) | https://github.com/diamondio/better-queue | Full API documentation including filter, merge, precondition, and task control features |
| node-persistent-queue (npm) | https://www.npmjs.com/package/node-persistent-queue | SQLite-backed EventEmitter queue alternative for lightweight persistence |
| Node.js EventEmitter Documentation | https://nodejs.org/en/learn/asynchronous-work/the-nodejs-event-emitter | Official reference confirming synchronous listener execution |
| Chokidar File Watcher | https://github.com/paulmillr/chokidar | File watcher API, awaitWriteFinish, atomic writes, and ignoreInitial options |
| @bscotch/debounce-watch | https://www.npmjs.com/package/@bscotch/debounce-watch | Purpose-built debounced batch wrapper for chokidar |
| Backpressuring in Streams (Node.js) | https://nodejs.org/en/learn/modules/backpressuring-in-streams | Official guide to highWaterMark, drain events, and stream backpressure |
| Backpressure in Node.js (Voxer) | https://engineering.voxer.com/2013/09/16/backpressure-in-nodejs/ | Foundational analysis: limit work before scheduling, unbounded concurrency as root cause |
| p-queue | https://github.com/sindresorhus/p-queue | Priority queue with concurrency, rate limiting, and isSaturated backpressure detection |
| Rate Limiting in JavaScript with a Token Bucket | https://kendru.github.io/javascript/2018/12/28/rate-limiting-in-javascript-with-a-token-bucket/ | Timer-free token bucket implementation for burst-then-sustain rate control |
| node-rate-limiter | https://github.com/jhurliman/node-rate-limiter | TokenBucket and RateLimiter classes for Node.js |
| How macOS, Linux, and Windows Detect File Changes | https://dev.to/asoseil/how-macos-linux-and-windows-detect-file-changes-and-why-it-isnt-easy-194m | Platform-specific file watching constraints and inotify overflow risks |
| SQLite WAL Mode | https://sqlite.org/wal.html | Official WAL documentation: concurrent access model, checkpoint behavior, limitations |
| SQLite Concurrent Writes and "database is locked" Errors | https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/ | Benchmarks: 72K+ writes/sec with WAL, flat throughput to 64 threads, BEGIN IMMEDIATE fix |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | Synchronous SQLite binding with WAL mode defaults and thread safety documentation |
| better-sqlite3 Performance | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md | Checkpoint starvation guidance and 2000+ queries/sec benchmark data |
| better-sqlite3 Worker Threads | https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md | One-connection-per-thread rule and shared database access patterns |
| Litestream Tips | https://litestream.io/tips/ | busy_timeout and WAL configuration recommendations |
| How SQLite Scales Read Concurrency (Fly.io) | https://fly.io/blog/sqlite-internals-wal/ | WAL internals and read scaling architecture |