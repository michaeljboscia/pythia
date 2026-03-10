# Research Prompt: MC-05 MCP Server Architecture Patterns

## Research Objective
Evaluate the physical architecture and deployment patterns for a production-grade, local MCP Server. The goal is to determine how to run the Living Corpus System (LCS) daemon reliably on MacOS/Linux, managing the complex interplay between the stdio MCP transport, long-running database connections, and background indexing tasks, while integrating gracefully with the existing Pythia oracle environment.

## Research Questions
1. **Process Topology:** Should LCS run as a single monolithic Node.js process (handling both the MCP stdio interface and the background ingestion loops), or as a multi-process architecture (e.g., an MCP gateway process communicating via IPC with a heavy indexing daemon)? (*PE-01*)
2. **Concurrency and Stdio Blocking:** The MCP protocol typically uses `stdio` for transport. In Node.js, `stdout.write` can block. How do we ensure that a massive 5MB graph traversal response doesn't block the event loop, preventing the server from answering health checks or receiving new tool calls?
3. **Database Connection Pooling:** How should the MCP server manage connections to Kuzu (*GD-01*) or SQLite (*GD-02*) and LanceDB/Qdrant (*VD-01*)? Given MCP is stateless, should connections be kept alive permanently, or established per-request?
4. **State Management:** While MCP is theoretically stateless, does the server need to maintain an in-memory cache (e.g., an LRU cache of recently accessed files) to reduce database load?
5. **Integrating with Pythia:** The user already runs an MCP server at `~/.claude/mcp-servers/inter-agent/`. Should LCS be built as a separate module imported into that existing server's codebase, or run as a completely independent binary specified via an additional entry in `claude_desktop_config.json`?
6. **Graceful Shutdown:** When Claude Desktop or the IDE kills the MCP process via standard signals (SIGTERM/SIGKILL), how must the architecture handle shutting down database WALs, closing embedded DB locks (*PE-02*), and saving ingestion state to prevent corruption?
7. **Logging and Telemetry:** Since `stdout` is reserved for the MCP JSON-RPC protocol, where and how should the server log its internal errors, database execution times, and ingestion progress (*PE-04*)? How is this monitored locally?
8. **Health Checks:** How does the LLM client know if the LCS server is healthy but currently busy re-indexing the corpus? Does the MCP spec support standard ping/pong or status endpoints?
9. **Language Choice (Node vs Python):** While the Pythia server is assumed to be Node.js, much of the ML/Graph ecosystem (NetworkX, local embeddings) is Python. Evaluate the architecture of a Node.js MCP server using `child_process.spawn` to execute Python scripts for heavy lifting.
10. **Error Boundaries:** If the embedded Vector DB crashes due to an out-of-memory error, how is the exception caught, wrapped into an MCP JSON-RPC error, and sent to the client without tearing down the entire Node process? (*PE-05*)

## Sub-Topics to Explore
- Node.js `worker_threads` for CPU-intensive tasks (like AST parsing - *CI-01*).
- Systemd vs Launchd vs simple background execution for local daemons.
- IPC (Inter-Process Communication) mechanisms (Unix domain sockets, named pipes) if multi-process is chosen.
- Standard file paths for local daemon data (e.g., `~/.lcs/logs`, `~/.lcs/db`).

## Starting Sources
- **Node.js Child Processes & Worker Threads:** https://nodejs.org/api/worker_threads.html
- **MCP Node.js SDK Source:** https://github.com/modelcontextprotocol/typescript-sdk
- **SQLite/Kuzu concurrent access docs.**
- **PM2 or local process managers:** https://pm2.keymetrics.io/ (for daemonizing).
- **Winston/Pino logging libraries:** (Specifically regarding logging to files when stdout is hijacked).

## What to Measure & Compare
- Write a POC Node.js MCP server that simulates a 5-second database query. Send it 10 concurrent requests from a client script. Measure if the Node.js event loop blocks or if it successfully handles them asynchronously.
- Compare the startup time and RAM footprint of a monolithic Node.js server (loading all DB libraries on boot) versus a lazy-loading architecture.

## Definition of Done
A 3000-5000 word architectural blueprint for the LCS daemon. It must explicitly define the process model (single vs multi), the DB connection strategy, the exact integration path with the existing Pythia `inter-agent` server, and the logging strategy.

## Architectural Implication
Feeds **ADR-007 (MCP Tool Schema)** and dictates the entire physical deployment model of LCS. It answers the fundamental question of "How do we actually run this code?" securely and reliably on the user's machine.