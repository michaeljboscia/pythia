# Research Prompt: DM-07 Event-Driven Indexing Architecture

## Research Objective
Synthesize the findings from CDC (*DM-01*), Server Architecture (*MC-05*), and Incremental Indexing (*DM-05*) into a cohesive Event-Driven Architecture for the LCS background daemon. The goal is to determine exactly how messages (file changes, tool requests) flow through the system using queues, event loops, and worker threads, ensuring heavy indexing never blocks the synchronous MCP server.

## Research Questions
1. **The Monolithic Event Loop:** If LCS is a single Node.js process, how does the V8 event loop handle an incoming MCP request (read) at the exact same millisecond an `inotify` event triggers a 50-file re-index (heavy CPU/IO write)? Prove whether `async/await` is sufficient or if it will stutter.
2. **Message Queue Selection:** Does LCS require a formalized local message queue (like BullMQ backed by Redis/SQLite) to manage ingestion jobs, or is a simple in-memory JavaScript `Array.push()` queue sufficient? What happens to an in-memory queue if the process crashes?
3. **Worker Threads vs Child Processes:** For CPU-bound tasks (running tree-sitter *CI-01*, computing hashes *DM-05*), should the Node.js daemon use `worker_threads` (shared memory) or `child_process.fork()` (isolated memory)? What is the IPC serialization cost of passing ASTs between them?
4. **Event Sourcing the Ingestion Log:** Should every file change event be logged to a persistent SQLite table (`IngestionEvents`) before processing? How does this enable crash recovery and observability (*PE-04*)?
5. **Backpressure and Throttling:** If the user executes a `git pull` that changes 2,000 files, the event queue will explode. How do we implement backpressure so the worker threads don't exhaust system RAM or trigger API rate limits (*EM-02*)?
6. **Database Lock Contention:** How do we architect the database access layer so the MCP query handler and the ingestion worker thread don't encounter deadlocks when accessing Kuzu/SQLite simultaneously (*PE-02*)?
7. **Priority Queuing:** Can we implement a priority queue where explicit user requests via MCP tools (Priority 1) immediately preempt or pause background indexing tasks (Priority 2)? How is a running tree-sitter job safely paused?
8. **Observability via MCP:** How can the MCP server expose the current state of the event queue to the LLM? (e.g., exposing a tool `lcs_get_indexing_status` so Pythia knows if the data it's querying is currently being rebuilt).
9. **Language Polyglot Architecture:** If the embedding or graph extraction relies on Python libraries (e.g., NetworkX, local Ollama bindings), how does the Node.js event loop orchestrate the Python subprocesses? Evaluate JSON over stdio vs ZeroMQ for this bridge.
10. **The Boot Sequence:** Document the exact initialization sequence of the daemon. (1. Boot DBs -> 2. Start MCP stdio listener -> 3. Scan filesystem for missed events since last shutdown -> 4. Start watcher -> 5. Begin processing queue).

## Sub-Topics to Explore
- Node.js Event Loop phases (Timers, Pending Callbacks, Poll, Check).
- SQLite `BUSY_TIMEOUT` and WAL mode concurrency limits.
- BullMQ / Better-Queue architectures for Node.js.
- Actor Model architecture for managing isolated state.

## Starting Sources
- **Node.js Event Loop Guide:** https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick
- **Node.js Worker Threads:** https://nodejs.org/api/worker_threads.html
- **BullMQ Documentation:** https://docs.bullmq.io/
- **SQLite Concurrency (WAL):** https://www.sqlite.org/wal.html
- **ZeroMQ (for Node-Python IPC):** https://zeromq.org/

## What to Measure & Compare
- Benchmark the serialization overhead (`JSON.stringify` / `JSON.parse`) of sending a 5MB JSON object representing an AST from the main Node thread to a `worker_thread` versus using a `SharedArrayBuffer`.
- Simulate a high-load scenario: Write a script that inserts 10,000 rows into SQLite via a background loop while simultaneously executing 10 complex read queries per second. Measure the read latency degradation.

## Definition of Done
A 3000-5000 word definitive architecture specification. The document must produce a comprehensive sequence diagram detailing how events flow from the filesystem/git, into the queue, out to the workers, and into the databases, proving that the MCP server remains responsive under maximum ingestion load.

## Architectural Implication
Feeds **ADR-006 (Live State Ingestion)** and **ADR-007 (MCP Tool Schema)**. This is the central nervous system of LCS. A failure in this architecture results in a frozen Pythia terminal, corrupted databases, or silent ingestion failures.