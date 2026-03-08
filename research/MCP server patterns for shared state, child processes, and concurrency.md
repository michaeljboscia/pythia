# MCP server patterns for shared state, child processes, and concurrency

**MCP tool handlers dispatch concurrently, not sequentially — and the SDK provides zero locking primitives.** This single architectural fact drives every design decision for multi-tool MCP servers with shared mutable state. The TypeScript SDK's `Protocol._onrequest()` invokes each handler as an async function without awaiting completion before processing the next incoming JSON-RPC message, even over stdio transport. Any server managing subprocesses, databases, or session state must implement its own concurrency controls. This report maps the actual dispatch mechanism, catalogs production patterns from real implementations, and provides battle-tested code for the hardest problems: node-pty lifecycle management, crash-safe persistence, and race-free state mutation.

---

## The SDK dispatches tool calls concurrently — here's the proof

The MCP TypeScript SDK (`@modelcontextprotocol/sdk`) has two server APIs. The low-level `Server` class (in `packages/server/src/server/server.ts`) registers one handler per JSON-RPC method via `server.setRequestHandler(schema, handler)`. The high-level `McpServer` wrapper (in `packages/server/src/server/mcp.ts`) provides `server.tool()` and `server.registerTool()`, which internally maintain a `_registeredTools` Map and install their own `CallToolRequestSchema` handler that dispatches by tool name.

The dispatch flow, documented in the SDK's `CLAUDE.md` architectural guide, is:

1. **Transport** receives a message → calls `transport.onmessage()`
2. **`Protocol.connect()`** routes to `_onrequest()`, `_onresponse()`, or `_onnotification()`
3. **`_onrequest()`** looks up the handler in `_requestHandlers`, creates a `BaseContext`, invokes the async handler, and sends the JSON-RPC response when the Promise resolves

**There is no queue, mutex, or serialization between handler invocations.** The `StdioServerTransport` reads stdin via Node.js readline. Each newline-delimited message triggers `onmessage()`, which calls `_onrequest()`, which calls the handler. The handler returns a Promise that is `.then()`'d for response sending — but **the next readline event fires independently on the event loop**. If Handler A `await`s an I/O operation, Handler B begins executing before A resolves.

Three pieces of converging evidence confirm this:

- The SDK's own `examples/client/` directory includes `parallelCalls.ts` — "Runs multiple tool calls in parallel" — demonstrating the SDK is designed for concurrent dispatch.
- GitHub issue `anthropics/claude-agent-sdk-typescript#41` reports "'Stream closed' errors during concurrent tool calls," noting the bug "only happens with 2+ parallel tool calls" — proving multiple handlers execute simultaneously in production.
- The SDK contains **no** `p-queue`, `async-mutex`, semaphore, or any serialization logic anywhere in its source.

**The critical implication**: even over stdio (single-client, one-message-at-a-time framing), tool handlers can interleave at every `await` boundary. Synchronous code blocks within a handler are atomic (Node.js is single-threaded), but any async read-modify-write sequence is vulnerable to race conditions.

---

## Error envelopes and multi-tool registration at scale

The MCP specification defines two distinct error channels. **Protocol errors** use standard JSON-RPC error responses (e.g., `{ "error": { "code": -32602, "message": "Unknown tool" } }`) and are invisible to the LLM. **Tool execution errors** return a success response with `isError: true` in the result body — these are forwarded to the model, enabling self-correction. The specification explicitly recommends using `isError: true` for all validation failures, API errors, and business logic errors so the LLM can retry intelligently.

```typescript
// Protocol error (LLM never sees this):
throw new McpError(ErrorCode.ToolNotFound, `Unknown tool: ${name}`);

// Tool execution error (LLM can self-correct):
return { content: [{ type: "text", text: "Invalid date: must be in the future" }], isError: true };
```

For organizing **10+ tools**, four patterns emerge from production codebases:

- **Single file with `McpServer.registerTool()`** — used by official servers (filesystem, PostgreSQL). Works up to ~15 tools. Each `server.registerTool()` call includes a Zod schema and async handler inline.
- **Separate files with handler imports** — each tool gets its own module exporting a schema and handler function, registered in a central `index.ts`. The `cyanheads/filesystem-mcp-server` splits each tool into `registration.ts` (schema), `logic.ts` (handler), and `index.ts` (barrel export).
- **Toolset grouping with dynamic enable/disable** — GitHub's official MCP server (`github/github-mcp-server`, 80+ tools) groups tools into named toolsets (`repos`, `issues`, `pull_requests`, `code_security`). The LLM can discover and enable toolsets at runtime, reducing context window usage by **60-90%**.
- **Dependency injection via tsyringe** — `cyanheads/git-mcp-server` (28 tools) uses DI to inject shared services (`RateLimiter`, `GitProvider`, `SessionManager`) into tool handlers, making the architecture testable and decoupled.

---

## Node-pty child process management requires defense in depth

### Zombie cleanup when the parent crashes

When a parent Node.js process is killed with SIGKILL or dies from OOM, children spawned via node-pty become orphans. node-pty calls `forkpty()` → `setsid()`, placing the child in its own session, so standard process-group kills won't reach it. VS Code issue #160407 and the Gemini CLI issue #20941 both document real-world zombie accumulation.

The production pattern is **layered defense**:

- **Layer 1 — tree-kill on graceful shutdown**: The `tree-kill` package (18M+ weekly npm downloads) recursively discovers child PIDs via `ps -o pid --ppid` and kills them. Call `treeKill(pty.pid, 'SIGTERM')` in SIGTERM/SIGINT handlers, escalating to SIGKILL after a 3-second timeout.
- **Layer 2 — PID files for crash recovery**: On spawn, write `{ pid, parentPid, startedAt }` to a file in `~/.myapp-pids/`. On startup, scan for stale PID files where the parent is dead (`process.kill(parentPid, 0)` throws) and kill the orphan.
- **Layer 3 — cgroups for hard containment**: Running under `systemd-run --scope --user` places all spawned processes in a transient cgroup. When the scope is stopped, every process inside is killed regardless of reparenting.

Linux's `prctl(PR_SET_PDEATHSIG)` would be ideal but has no Node.js built-in equivalent — it requires a native addon via `node-ffi-napi` or a wrapper shell script that polls the parent PID.

### stdin backpressure with large payloads

**node-pty's `write()` returns `void`, not `boolean` — there is no backpressure mechanism.** The internal implementation calls `_writeStream.write(data)` on a net.Socket wrapping the PTY master fd, but discards the return value. The PTY kernel buffer is approximately **4KB on Linux and ~1KB on macOS**. Writing a 5MB payload in a single `pty.write()` call will overflow the buffer, causing data interleaving or hangs (documented in node-pty issue #327).

The production solution is a chunked writer with explicit delays:

```typescript
class PtyWriter {
  constructor(private pty: IPty, private chunkSize = 512, private delayMs = 1) {}

  async write(data: string): Promise<void> {
    for (let i = 0; i < data.length; i += this.chunkSize) {
      this.pty.write(data.slice(i, i + this.chunkSize));
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }
  }
}
```

The **512-byte chunk size** stays well under the kernel buffer. The 1ms delay yields to the event loop, letting the PTY process drain. Compare this to `child_process.spawn`, which provides proper Node.js stream semantics: `stdin.write()` returns a boolean, emits `drain` events, and supports `pipe()`. If you don't need a TTY, prefer `spawn` over `node-pty` for large data transfer.

### Graceful shutdown and detecting dead processes

**You cannot do async work in `process.on('exit')`.** The exit handler is synchronous-only. The production pattern uses a multi-layer shutdown manager:

- **SIGTERM/SIGINT handlers** (async): Abort all `AbortController` instances, send SIGTERM to all PTYs, wait up to 3 seconds for graceful exit, then `treeKill` with SIGKILL.
- **`process.on('exit')` handler** (sync, last resort): Synchronously call `process.kill(pid, 'SIGKILL')` for any remaining processes.
- **`uncaughtException`/`unhandledRejection`** handlers: Trigger the graceful shutdown path, then `process.exit(1)`.

For detecting silently dead subprocesses, **node-pty's `onExit` is not 100% reliable** (documented in issue #466 — a V8 crash on process exit can prevent the event from firing). Production servers use a heartbeat pattern: write `echo __hb_${timestamp}__\r` to the PTY periodically, watch for the marker in `onData`, and declare the process hung after 3 consecutive missed heartbeats. Back this up with a PID-based liveness check via `process.kill(pid, 0)` and, on Linux, reading `/proc/${pid}/status` to distinguish zombie (`Z`), uninterruptible sleep (`D`), and running (`R`) states.

---

## Race-free state management in stdio-transport servers

Since the SDK confirms concurrent dispatch, every MCP server with shared mutable state needs explicit synchronization. The core anti-pattern is **async read-modify-write without a lock**:

```typescript
// BUG: Two concurrent increment calls both read counter=0, both write counter=1
let counter = 0;
server.tool("increment", {}, async () => {
  const current = counter;        // Read
  await someAsyncWork();           // Yield — another handler runs here
  counter = current + 1;           // Write (stale value!)
  return { content: [{ type: "text", text: String(counter) }] };
});
```

**If the read-modify-write is entirely synchronous (no `await` between read and write), it is safe** — Node.js's single-threaded execution guarantees atomicity for synchronous code. `counter += 1` with no intervening await is always correct.

For async operations, the `async-mutex` library provides the standard solution:

```typescript
import { Mutex } from 'async-mutex';
const stateMutex = new Mutex();

server.tool("update-item", { id: z.string(), value: z.string() }, async ({ id, value }) => {
  const release = await stateMutex.acquire();
  try {
    const existing = state.items.get(id);
    await validateWithExternalService(value);
    state.items.set(id, { ...existing, value, updatedAt: Date.now() });
    return { content: [{ type: "text", text: `Updated ${id}` }] };
  } finally {
    release();
  }
});
```

An alternative is a **serialization queue** that processes all state-mutating operations sequentially while allowing read-only tools to execute freely:

```typescript
class SerialQueue {
  private queue: Promise<void> = Promise.resolve();
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(fn).then(resolve, reject);
    });
  }
}
```

For **crash-safe persistence**, the atomic rename pattern is the standard: write to a temp file, then `fs.renameSync(tmpPath, finalPath)`. Rename is atomic on POSIX filesystems. Never use `fs.promises.writeFile` directly to the state file — a crash mid-write produces truncated JSON. For append-only workloads, a write-ahead log (`appendFileSync` per mutation, replay on startup) survives partial writes since only the last line can be truncated.

Four additional anti-patterns to avoid:

- **Boolean "lock" flags** — `if (isProcessing) return; isProcessing = true;` is not a mutex. Between the check and the set, another handler can pass through.
- **Unbounded state growth** — arrays or maps that grow without limit cause memory leaks in long sessions. Use bounded collections (ring buffers, LRU caches with configurable maximums).
- **Async file writes for critical state** — use `writeFileSync` (or atomic sync rename) when correctness matters more than throughput. The event loop blocks briefly, but the write completes before the function returns.
- **Assuming stdio means sequential** — the transport is serial at the framing level, but the SDK does not await handler completion before dispatching the next message.

---

## Real implementations worth studying

The strongest reference implementations for multi-tool MCP servers with shared state are:

- **`modelcontextprotocol/servers` — Filesystem server** (~80k stars on the monorepo): 11 tools in a single `index.ts`. Module-scoped `allowedDirectories` array as shared state. No concurrency controls — relies on filesystem atomicity. Shows the simplest viable pattern for tool registration via `server.tool()` with Zod schemas.

- **`github/github-mcp-server`** (Go, 80+ tools): The most sophisticated tool organization. Tools are grouped into named toolsets that can be dynamically enabled/disabled at runtime. Supports read-only mode, lockdown mode for untrusted content, and per-tool description override via environment variables. The toolset architecture is the gold standard for servers exceeding 20 tools.

- **`microsoft/playwright-mcp`** (TypeScript, 20+ tools): Manages long-lived browser instances, contexts, and pages. Three session modes (persistent profile, isolated, browser extension). Uses capability-based tool filtering (`core`, `pdf`, `vision`, `devtools`). Shows how to manage complex lifecycle state (browser → context → page → tab) with explicit cleanup tools.

- **`cyanheads/git-mcp-server`** (TypeScript, 28 tools): The best example of enterprise-style architecture. Uses `tsyringe` for dependency injection, pluggable storage backends (in-memory, filesystem, Supabase, Cloudflare KV/R2), and session-aware working directory context. Destructive operations (`git reset --hard`, `git clean`) require explicit confirmation flags.

- **`mako10k/mcp-shell-server`** (TypeScript, ~16 tools): The most relevant reference for subprocess lifecycle management. Separate manager classes for processes, terminals (PTY), files, and monitoring. Adaptive execution that starts foreground and auto-switches to background after a timeout. Pipeline support where output from one command feeds as input to another. Shows the manager-per-resource-type pattern that scales well for stateful servers.

---

## Conclusion

The most important architectural insight is that **the MCP SDK's concurrent dispatch model means shared state is your problem, not the framework's**. Every real-world MCP server that manages mutable resources — subprocesses, database connections, session state, file-based persistence — must implement its own synchronization. The `async-mutex` library or a serialization queue handles in-memory state; atomic rename handles file persistence; tree-kill plus PID files handle subprocess cleanup.

For servers with 10+ tools, the toolset grouping pattern (GitHub MCP) and the manager-per-resource pattern (mcp-shell-server) are the two architectures that scale. Single-file servers work up to ~15 tools; beyond that, per-tool modules with a central registration point keep complexity manageable. The choice between the low-level `Server` (switch statement dispatch) and high-level `McpServer` (per-tool registration) is mostly aesthetic — the high-level API provides slightly better ergonomics for Zod schema validation but hides the dispatch mechanism, which you need to understand to reason about concurrency correctly.