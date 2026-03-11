# Keeping MCP fast while indexing in a single Node.js process

*Created: 2026-03-11T00:00:00Z*

A Node.js daemon that serves latency-sensitive MCP tool calls while running background indexing can reliably maintain **sub-100ms response times** — but only if it treats the event loop as a shared, finite resource and architects around its single-threaded constraint. The most robust pattern pairs a **pre-warmed `worker_threads` pool** (via Piscina or Tinypool) for CPU-bound indexing with an **event-loop-aware circuit breaker** built on `perf_hooks.monitorEventLoopDelay`, using **p-queue** for in-process task coordination. This report dissects why, with code-level detail on each pattern, concrete threshold values, and queue-library trade-offs grounded in primary sources.

The stakes are real. DraftKings Engineering documented event loop starvation where an outbound API call perceived as taking [397ms from the Node.js process took only 698μs on the API server](https://medium.com/draftkings-engineering/event-loop-starvation-in-nodejs-a19901e26b41) — the remaining 396ms was pure event loop scheduling delay. Trigger.dev traced [seconds-long event loop blockages](https://trigger.dev/blog/event-loop-lag) to an O(n²) loop that went undetected for months. In an MCP server where tool calls transit JSON-RPC 2.0 over [stdio or Streamable HTTP](https://modelcontextprotocol.io/), any sustained block on the main thread directly delays every pending response.

## The event loop is a six-phase pipeline with sharp edges

Understanding where work executes — and what it blocks — requires knowing the [libuv event loop phases](https://docs.libuv.org/en/v1.x/design.html) that underpin Node.js. Each iteration cycles through six phases in fixed order: **timers** (fires `setTimeout`/`setInterval` callbacks), **pending callbacks** (deferred I/O from the prior iteration), **idle/prepare** (internal), **poll** (retrieves new I/O events and executes their callbacks — this is where incoming MCP requests arrive), **check** (fires `setImmediate` callbacks), and **close callbacks** (cleanup like `socket.on('close')`). Between every phase transition, Node.js drains two queues: the [`process.nextTick()` queue first, then the microtask queue](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) (Promise `.then()` callbacks).

This phase ordering creates the fundamental constraint. Any synchronous CPU work running during one phase — say, inside a poll-phase I/O callback that triggers document indexing — blocks all subsequent phases until it completes. A 200ms indexing burst means the next MCP request sitting in the poll queue waits 200ms before the event loop even sees it. Worse, `process.nextTick()` callbacks and microtasks run *between* phases, meaning recursive `nextTick` usage or tight `Promise.resolve()` loops can starve the poll phase entirely, preventing I/O from ever executing.

One critical subtlety emerged in Node.js 20. A [libuv optimization changed the phase ordering](https://blog.platformatic.dev/the-dangers-of-setimmediate) such that `setImmediate` callbacks can more aggressively dominate the loop. Platformatic documented health check handlers that should have fired every 5 seconds appearing only after **20+ second gaps** in Node.js 20, specifically when moderate `setImmediate` usage coincided with non-keep-alive HTTP connections. This makes time-bounded chunking (discussed below) essential rather than relying on raw `setImmediate` yield frequency.

File system operations deserve a footnote. The [libuv thread pool](https://docs.libuv.org/en/v1.x/design.html) (default 4 threads, max 1024 via `UV_THREADPOOL_SIZE`) handles `fs` APIs, DNS lookups, and crypto operations. Network I/O uses epoll/kqueue/IOCP directly on the event loop thread. An MCP daemon doing disk-based indexing may contend for thread pool slots with `fs.readFile` calls, but this is I/O contention — distinct from the CPU contention this analysis targets.

## Three concurrency patterns, measured against a 100ms budget

### Worker threads: true parallelism with serialization costs

[`worker_threads`](https://nodejs.org/api/worker_threads.html) provide genuine OS-level parallelism. Each Worker gets its own V8 isolate, heap, and event loop. The main thread's event loop is never blocked by worker computation — this is the **only pattern that provides a hard latency guarantee** for the main thread.

The cost is communication overhead. Data crosses the thread boundary via three mechanisms. **Structured clone** (the default for `postMessage`) deep-copies objects using the [HTML structured clone algorithm](https://nodejs.org/api/worker_threads.html), supporting circular references, Maps, Sets, and TypedArrays but not functions or prototypes. Benchmarks of `structuredClone` show it running roughly [1.5× slower than `JSON.parse(JSON.stringify())`](https://github.com/nicolo-ribaudo/tc39-proposal-structs/issues/8) for flat objects — 131ms for 10,000 clones of a typical API object versus 87.7ms for JSON round-tripping. **Transfer** via `transferList` moves ArrayBuffer ownership at near-zero cost (pointer swap) but renders the source unusable. **SharedArrayBuffer** provides zero-copy shared memory but requires [`Atomics`](https://nodejs.org/api/worker_threads.html) for synchronization.

Worker creation is the other cost center. Cold-starting a worker (V8 isolate initialization + module loading) takes roughly **35–123ms** depending on the worker script's complexity — [BetterStack measured 123ms](https://betterstack.com/community/guides/scaling-nodejs/nodejs-workers-explained/) for a worker computing `fibonacci(35)` including full startup, versus 83ms on the main thread. A **pre-warmed pool** eliminates this entirely. [Piscina](https://github.com/piscinajs/piscina) (NearForm, 5.1k stars) maintains a pool of ready workers and dispatches tasks with sub-millisecond latency when `useAtomics: true` (the default), using `Atomics.wait()`/`Atomics.notify()` instead of event-loop-based message passing:

```javascript
const Piscina = require('piscina');
const pool = new Piscina({
  filename: './indexWorker.js',
  minThreads: Math.max(1, os.cpus().length - 1),
  maxThreads: os.cpus().length - 1,
  concurrentTasksPerWorker: 1,  // CPU-bound: one task per thread
  idleTimeout: 30_000,
});

// MCP tool handler — main thread stays free
server.tool("search", { query: z.string() }, async ({ query }) => {
  return { content: [{ type: "text", text: await searchIndex(query) }] };
});

// Background indexing — runs entirely off main thread
async function reindexBatch(documents) {
  const results = await Promise.all(
    chunk(documents, 500).map(batch => pool.run(batch))
  );
  mergeIntoIndex(results);
}
```

[Benchmark data from Dhwaneet Bhatt](https://dev.to/dhwaneetbhatt/benchmarking-nodejs-worker-threads-5c9b) on an 8-core MacBook Pro quantifies the parallelism trade-off precisely. At parallelism=1, worker threads run **25% slower** than the main thread (7,048 vs 9,359 ops/s for `fibonacci(20)`) due to communication overhead. At parallelism=4, they achieve **2.28× speedup** (5,390 vs 2,363 ops/s). Beyond the physical core count, returns diminish sharply. The implication: a worker pool sized to `cpus().length - 1` maximizes indexing throughput while reserving the main thread exclusively for MCP serving.

[Tinypool](https://github.com/tinylibs/tinypool) (used by Vitest) offers an alternative at **38KB install size** versus Piscina's ~800KB, with a nearly identical API but without utilization tracking or OS-level thread priority support. For an embedded daemon where install size matters, Tinypool provides the essential worker pool semantics with zero dependencies.

### Cooperative scheduling via setImmediate: time-sliced single-threaded work

When worker thread complexity is unwarranted — perhaps the indexing work shares complex in-memory data structures that would be expensive to serialize — [cooperative scheduling via `setImmediate`](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) keeps the work on the main thread while yielding to the event loop between chunks. The key: `setImmediate` executes in the **check phase**, which runs *after* the poll phase where I/O callbacks (including incoming MCP requests) fire. This guarantees at least one opportunity per loop iteration for I/O processing.

The naive pattern breaks a loop into fixed-count chunks with `setImmediate` between them. The production-grade pattern uses **time-based chunking** to adapt to variable per-item costs:

```javascript
async function indexCooperatively(documents) {
  const CHUNK_MS = 8;  // target ≤8ms per chunk, leaving ~92ms budget for I/O
  let i = 0;
  while (i < documents.length) {
    const deadline = performance.now() + CHUNK_MS;
    while (i < documents.length && performance.now() < deadline) {
      processDocument(documents[i++]);
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}
```

Each `setImmediate` yield adds roughly **1–4ms** of event loop cycle latency (platform-dependent). With 8ms chunks, worst-case MCP response latency is approximately `8ms (remaining chunk) + 4ms (loop cycle) + response processing time` ≈ **12–15ms of added delay** — well within a 100ms budget. Total indexing throughput drops by approximately 15–30% versus synchronous execution due to scheduling overhead, but this is acceptable for background work.

The critical failure mode: if chunks accidentally exceed the time budget (e.g., a single document triggers an unexpectedly expensive operation), the event loop blocks for that entire duration. This pattern provides **no hard guarantee** — only a probabilistic one bounded by the worst-case single-item processing time.

### Async generators: cooperative scheduling with natural backpressure

Async generators wrap the `setImmediate` pattern in iterator protocol semantics, providing a cleaner abstraction with built-in backpressure via `for await...of`:

```javascript
async function* indexGenerator(documents, batchSize = 200) {
  for (let i = 0; i < documents.length; i++) {
    yield processDocument(documents[i]);
    if ((i + 1) % batchSize === 0) {
      await new Promise(resolve => setImmediate(resolve));  // TRUE event loop yield
    }
  }
}

// Consumer automatically applies backpressure
for await (const indexed of indexGenerator(docs)) {
  addToSearchIndex(indexed);
}
```

A subtle and critical point: **bare `yield` in an async generator does not yield to the event loop**. The [`for await...of` loop immediately calls `next()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function*), which resolves via the microtask queue — running *before* the next event loop phase, exactly like `process.nextTick()`. Without the explicit `await setImmediate` wrapper, a tight async generator loop starves I/O identically to synchronous code. This is the most common mistake developers make with this pattern.

The advantage over raw `setImmediate` is composability. Async generators can be piped through transforms, combined with `Promise.race` for cancellation, and consumed by streams. The overhead is minimal: roughly **1–5μs per `yield`** for Promise allocation, negligible compared to the 1–4ms per `setImmediate` cycle.

## Choosing a queue for an embedded daemon without Redis

An embedded MCP daemon needs task queuing for indexing work — prioritization, concurrency limits, backpressure, and retry. External dependencies like Redis are disqualified by the architecture constraint.

**[p-queue](https://github.com/sindresorhus/p-queue)** (21M weekly downloads) is the strongest fit for in-process concurrency control. Its API provides runtime-adjustable concurrency (`queue.concurrency = newValue`), explicit backpressure via `await queue.onSizeLessThan(limit)`, rate limiting via `intervalCap`/`interval`, priority scheduling with `setPriority()`, and AbortSignal cancellation. It emits `active`, `completed`, `error`, `empty`, and `idle` events. The critical gap: **no built-in retry or persistence** — these must be layered on top:

```javascript
import PQueue from 'p-queue';

const indexQueue = new PQueue({ concurrency: 2, timeout: 30_000 });

async function enqueueIndexTask(fn, retries = 3) {
  await indexQueue.onSizeLessThan(indexQueue.concurrency * 2);  // backpressure
  return indexQueue.add(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { return await fn(); }
      catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));  // exponential backoff
      }
    }
  }, { priority: 0 });
}
```

**[better-queue](https://github.com/diamondio/better-queue)** fills the persistence gap with pluggable storage backends — memory (default), SQLite (`better-queue-sqlite`), or custom stores. It includes built-in retry (`maxRetries` + `retryDelay`), batch processing (`batchSize`), task merging by ID, and precondition checks. However, it uses a **callback-only API** (no native Promises — [open issue since 2017](https://github.com/diamondio/better-queue/issues/23)), hasn't been updated in 3 years, and lacks explicit backpressure signals. For a daemon needing crash-resilient task persistence without Redis, the SQLite backend provides a compelling durability guarantee unavailable elsewhere.

**[BullMQ](https://docs.bullmq.io/)** is architecturally disqualified — it [requires Redis for every operation](https://docs.bullmq.io/guide/architecture), using Redis lists, sets, and Lua scripts for atomic job lifecycle management. Despite offering the most sophisticated retry system (exponential backoff with jitter, custom strategies, `UnrecoverableError` for skip-retry), its external dependency makes it unsuitable for embedded use.

**A custom EventEmitter-based queue** offers zero dependencies and full control, but requires implementing concurrency limiting, retry logic, timeout handling, backpressure, and error recovery from scratch. For a production daemon, the engineering cost rarely justifies avoiding p-queue's 38KB footprint (via `eventemitter3` + `p-timeout`).

The recommended hybrid: **p-queue for concurrency and backpressure, with application-level retry logic and optional SQLite WAL for persistence** of incomplete tasks across daemon restarts.

## Detecting starvation before users notice it

### The monitorEventLoopDelay API

[`perf_hooks.monitorEventLoopDelay()`](https://nodejs.org/api/perf_hooks.html) returns an `IntervalHistogram` that samples event loop delay at a configurable resolution (default **10ms**). All values are reported in **nanoseconds**. The histogram exposes `.min`, `.max`, `.mean`, `.stddev`, `.percentile(n)`, and a `.percentiles` Map. The companion [`performance.eventLoopUtilization()`](https://nodejs.org/api/perf_hooks.html) returns `{ idle, active, utilization }` — the fraction of time the loop spent processing callbacks versus waiting for I/O.

### Threshold values from production experience

A healthy idle Node.js process shows baseline event loop delay of [**1–2ms**](https://davidhettler.net/blog/event-loop-lag/). Synthesizing thresholds across production systems and open-source defaults:

| p99 delay | Severity | Action | Source |
|-----------|----------|--------|--------|
| **< 10ms** | Healthy | None | General consensus |
| **30ms** | Elevated | Investigate, begin logging | [David Hettler](https://davidhettler.net/blog/event-loop-lag/) |
| **42ms** | Warning | Throttle background work | [`overload-protection` default](https://github.com/davidmarkclements/overload-protection), [`loopbench` default](https://blog.platformatic.dev/the-nodejs-event-loop) |
| **50ms** | Caution | Reduce indexing concurrency | Common production threshold |
| **100ms** | Critical | Pause all background work | [David Hettler](https://davidhettler.net/blog/event-loop-lag/), [Trigger.dev OTel span threshold](https://trigger.dev/blog/event-loop-lag) |
| **1000ms** | Emergency | Return 503, shed load | [`@fastify/under-pressure` example](https://github.com/fastify/under-pressure) |

[Google's SRE book](https://sre.google/sre-book/monitoring-distributed-systems/) frames this through the **four golden signals**: latency, traffic, errors, and saturation. Event loop delay maps directly to internal latency; ELU maps to saturation. The SRE book emphasizes that **"latency increases are often a leading indicator of saturation"** and that averages are dangerously misleading — "if you run a web service with an average latency of 100ms at 1,000 requests per second, 1% of requests might easily take 5 seconds." The [SLO chapter](https://sre.google/sre-book/service-level-objectives/) recommends defining latency SLIs as *proportions* — e.g., "99% of requests complete in under 100ms" — which maps directly to monitoring `histogram.percentile(99)`.

### Building an adaptive throttling circuit breaker

The composite pattern: sample the histogram periodically, compare p99 against tiered thresholds, and adjust background work concurrency through a state machine with closed/open/half-open states:

```javascript
const { monitorEventLoopDelay } = require('node:perf_hooks');

class AdaptiveIndexThrottle {
  constructor(indexQueue, opts = {}) {
    this.queue = indexQueue;
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
    
    this.warningNs  = (opts.warningMs  ?? 50) * 1e6;
    this.criticalNs = (opts.criticalMs ?? 100) * 1e6;
    this.baseConcurrency = opts.concurrency ?? 2;
    this.state = 'closed';  // closed = normal, open = paused, half-open = probing
    
    this._timer = setInterval(() => this._evaluate(), opts.intervalMs ?? 2000);
    this._timer.unref();
  }

  _evaluate() {
    const p99 = this.histogram.percentile(99);
    const p50 = this.histogram.percentile(50);
    
    switch (this.state) {
      case 'closed':
        if (p99 > this.criticalNs) {
          this.state = 'open';
          this.queue.pause();          // stop all background indexing
        } else if (p99 > this.warningNs) {
          this.queue.concurrency = 1;  // reduce to minimum
        } else {
          this.queue.concurrency = this.baseConcurrency;
        }
        break;
      case 'open':
        if (p99 < this.warningNs) {
          this.state = 'half-open';
          this.queue.concurrency = 1;
          this.queue.start();          // probe with minimal work
        }
        break;
      case 'half-open':
        if (p99 < this.warningNs) {
          this.state = 'closed';       // recovery confirmed
          this.queue.concurrency = this.baseConcurrency;
        } else {
          this.state = 'open';
          this.queue.pause();          // still degraded, back off
        }
        break;
    }
    this.histogram.reset();  // fresh window each interval
  }
}
```

This pattern draws from [`@fastify/under-pressure`](https://github.com/fastify/under-pressure), which implements production-grade load shedding returning HTTP 503 with `Retry-After` headers when `maxEventLoopDelay` or `maxEventLoopUtilization` thresholds are breached. Under-pressure uses `monitorEventLoopDelay` with **10ms resolution** internally and supports scoped registration — different thresholds for different route groups. For an MCP daemon, the equivalent is protecting tool-call handlers while allowing background indexing to absorb the throttling.

The circuit breaker's `histogram.reset()` call on each evaluation interval is essential. Without it, the histogram accumulates the entire process lifetime, and a single historical spike permanently inflates percentiles. Resetting creates a **sliding window** — each evaluation period judges only the last 2 seconds (or whatever the interval), enabling rapid recovery detection.

### Complementary diagnostics

[Clinic.js Doctor](https://clinicjs.org/) provides automated diagnosis by monitoring CPU usage, event loop delay, GC activity, and active handles simultaneously. It flags event loop delay in red when it detects sustained patterns and recommends Clinic.js Flame for CPU-bound bottlenecks. In one documented case, a production service showing [100–300ms event loop delay per second](https://trigger.dev/blog/event-loop-lag) was optimized 8× after Clinic.js flame graphs identified the exact blocking function.

For MCP-specific monitoring, Trigger.dev's approach of instrumenting `node:async_hooks` to create [OpenTelemetry spans for any async callback exceeding 100ms](https://trigger.dev/blog/event-loop-lag) provides granular visibility into which tool calls or background tasks are responsible for event loop pressure.

## Putting it all together: the recommended architecture

For a production MCP daemon with background indexing in a single process, the architecture layers three components. **First**, a Piscina or Tinypool worker pool handles CPU-intensive indexing on background threads, keeping the main event loop free for MCP request handling. The pool is sized to `os.cpus().length - 1` with `concurrentTasksPerWorker: 1`. For work that must stay on the main thread (e.g., updating shared in-memory search indexes), time-bounded `setImmediate` chunking with 8ms budgets provides cooperative yielding.

**Second**, p-queue manages indexing task scheduling with concurrency limits, priority ordering, and explicit backpressure via `onSizeLessThan`. Retry logic wraps each enqueued task with exponential backoff. If crash-resilient persistence is needed, a SQLite WAL (via `better-queue-sqlite` or custom) journals incomplete tasks for daemon restart recovery.

**Third**, an `AdaptiveIndexThrottle` monitors `monitorEventLoopDelay` p99 on 2-second windows, dynamically adjusting p-queue concurrency through closed/open/half-open states. The warning threshold at **50ms p99** reduces concurrency; the critical threshold at **100ms p99** pauses background work entirely; recovery below 50ms resumes normal operation. ELU > 0.80 serves as a supplementary saturation signal. This tiered approach ensures that MCP tool calls consistently meet their latency budget even under heavy indexing load, while maximizing background throughput during quiet periods.

The key insight across all patterns: **the event loop is not infinitely elastic**. Whether you offload work to threads, time-slice it cooperatively, or queue it with backpressure, the architecture must treat main-thread execution time as a scarce resource and monitor its consumption continuously. The 100ms budget for MCP responses is achievable — but only when the system measures, adapts, and enforces it at every layer.

## Bibliography

| # | Title | URL | Key contribution |
|---|-------|-----|-----------------|
| 1 | Node.js `worker_threads` documentation (v25.8.0) | https://nodejs.org/api/worker_threads.html | Authoritative API reference for Worker, MessageChannel, SharedArrayBuffer, transferList, structured clone semantics |
| 2 | Node.js event loop, timers, and `process.nextTick()` | https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick | Official documentation of event loop phase ordering, `setImmediate` vs `nextTick` behavior |
| 3 | libuv design overview | https://docs.libuv.org/en/v1.x/design.html | Low-level event loop implementation: phase ordering, thread pool architecture, I/O polling mechanisms |
| 4 | Node.js `perf_hooks` documentation | https://nodejs.org/api/perf_hooks.html | `monitorEventLoopDelay` API, IntervalHistogram class, percentile methods, `eventLoopUtilization()` |
| 5 | Don't block the event loop (Node.js guide) | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop | Official patterns for partitioning CPU work, Worker Pool guidance, `setImmediate` cooperative scheduling |
| 6 | Benchmarking Node.js Worker Threads — Dhwaneet Bhatt | https://dev.to/dhwaneetbhatt/benchmarking-nodejs-worker-threads-5c9b | Quantitative comparison of single-thread vs worker-thread performance at varying parallelism levels with Piscina |
| 7 | Piscina — Worker pool for Node.js | https://github.com/piscinajs/piscina | Production worker pool implementation: Atomics-based communication, FixedQueue, resource limits, cancellation |
| 8 | Tinypool — Minimal worker thread pool | https://github.com/tinylibs/tinypool | Lightweight Piscina alternative (38KB), zero dependencies, used by Vitest |
| 9 | p-queue — Promise-based concurrency queue | https://github.com/sindresorhus/p-queue | In-process concurrency control: backpressure via `onSizeLessThan`, rate limiting, priority scheduling, runtime-adjustable concurrency |
| 10 | better-queue — Better task queuing for Node.js | https://github.com/diamondio/better-queue | Pluggable storage backends (SQLite), built-in retry, batch processing, task merging, precondition checks |
| 11 | BullMQ documentation | https://docs.bullmq.io/ | Redis-based queue architecture, retry strategies (exponential + jitter), rate limiting — disqualified for embedded use but informs retry pattern design |
| 12 | Google SRE Book — Monitoring Distributed Systems | https://sre.google/sre-book/monitoring-distributed-systems/ | Four golden signals (latency, traffic, errors, saturation), histogram-based latency measurement, percentile alerting, tail latency awareness |
| 13 | Google SRE Book — Service Level Objectives | https://sre.google/sre-book/service-level-objectives/ | Percentile-based SLIs/SLOs, distributions vs averages, "plausible worst-case" via p99 |
| 14 | `@fastify/under-pressure` | https://github.com/fastify/under-pressure | Production load-shedding middleware: `maxEventLoopDelay`, `maxEventLoopUtilization`, scoped thresholds, 503 with Retry-After |
| 15 | `overload-protection` | https://github.com/davidmarkclements/overload-protection | Framework-agnostic load shedding with default `maxEventLoopDelay: 42ms`, exposes `.overload` boolean |
| 16 | Event loop lag — David Hettler | https://davidhettler.net/blog/event-loop-lag/ | Baseline event loop delay values (1–2ms idle), threshold guidance (30ms investigate, 100ms critical) |
| 17 | The dangers of `setImmediate` — Platformatic | https://blog.platformatic.dev/the-dangers-of-setimmediate | Node.js 20 libuv regression: `setImmediate` starving timers and health checks, `loopbench` implementation |
| 18 | Trigger.dev — Event loop lag investigation | https://trigger.dev/blog/event-loop-lag | Production case study: O(n²) blocking, `async_hooks` instrumentation for OTel spans, 100ms span threshold |
| 19 | DraftKings — Event loop starvation in Node.js | https://medium.com/draftkings-engineering/event-loop-starvation-in-nodejs-a19901e26b41 | Production case study: ELU hitting 100%, 397ms perceived vs 698μs actual API latency, horizontal scaling implications |
| 20 | BetterStack — Node.js workers explained | https://betterstack.com/community/guides/scaling-nodejs/nodejs-workers-explained/ | Worker creation benchmarks: 123ms cold-start, 79ms pooled vs 83ms main thread |
| 21 | Node.js `structuredClone` performance (GitHub issue #50320) | https://github.com/nicolo-ribaudo/tc39-proposal-structs/issues/8 | Structured clone vs JSON round-trip benchmarks: 131ms vs 87.7ms for 10K operations |
| 22 | MCP TypeScript SDK | https://modelcontextprotocol.io/ | MCP server patterns: JSON-RPC 2.0, stdio/HTTP transports, tool call handler architecture |
| 23 | Coroutines in JavaScript — Shalvah | https://blog.shalvah.me/posts/experiments-in-concurrency-2-coroutines | Generator-based dispatcher pattern for cooperative scheduling |
| 24 | MDN `async function*` reference | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function* | Async generator semantics: `yield` + `await` interaction, Promise wrapping behavior |
| 25 | Handling CPU-bound tasks in Node.js — Mohamed Ali | https://medium.com/@moali314/handling-cpu-bound-tasks-in-node-js-part-1-ac34b4b45685 | `setImmediate` interleaving for subset-sum computation, `runningCombine` counter pattern |
| 26 | Learning to swim with Piscina — NearForm | https://nearform.com/insights/learning-to-swim-with-piscina-the-node-js-worker-pool/ | Piscina architecture rationale, performance data: crypto hashing 3.3× speedup on 4 vCPUs |