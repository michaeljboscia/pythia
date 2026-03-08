# TECH_STACK -- Pythia Oracle Engine

**Last Updated:** 2026-03-08

Pythia is implemented as new tools added to an existing inter-agent MCP server
(`/Users/mikeboscia/.claude/mcp-servers/inter-agent/`). It does not introduce a
separate server or process -- it extends the Gemini agent MCP server with
oracle-specific tools, types, and a runtime bridge.

---

## Runtime Environment

| Component | Version | Source |
|-----------|---------|--------|
| Node.js | 22.22.0 | `node --version` on host machine |
| npm | 10.9.4 | `npm --version` on host machine |
| Platform | macOS (Darwin 24.6.0) | Primary development; designed cross-platform |

Engine requirement from `package.json`: `>=20.0.0`

---

## Language

| Setting | Value | Source |
|---------|-------|--------|
| TypeScript | 5.9.3 | Installed in `node_modules/typescript/` |
| Target | ES2022 | `tsconfig.json` `compilerOptions.target` |
| Module system | Node16 | `tsconfig.json` `compilerOptions.module` |
| Module resolution | Node16 | `tsconfig.json` `compilerOptions.moduleResolution` |
| Package type | ESM (`"type": "module"`) | `package.json` |
| Strict mode | Enabled | `tsconfig.json` `"strict": true` |
| Source maps | Enabled | `tsconfig.json` `"sourceMap": true` |
| Declarations | Enabled with maps | `tsconfig.json` `"declaration": true, "declarationMap": true` |
| Root dir | `./src` | `tsconfig.json` `compilerOptions.rootDir` |
| Out dir | `./dist` | `tsconfig.json` `compilerOptions.outDir` |

---

## Core Dependencies (from inter-agent MCP server)

These are the dependencies already declared in
`/Users/mikeboscia/.claude/mcp-servers/inter-agent/package.json`. Pythia inherits
all of them and uses most directly.

### Production Dependencies

| Package | Declared | Resolved (installed) | Pythia Usage |
|---------|----------|---------------------|--------------|
| `@modelcontextprotocol/sdk` | ^1.12.1 | 1.26.0 | **Direct** -- `McpServer`, `StdioServerTransport`, tool registration. Oracle tools register on the same `McpServer` instance. |
| `node-pty` | ^1.1.0 | 1.1.0 | **Indirect** -- used by the shared `cli-executor.ts` for PTY-based CLI execution. Pythia uses the Gemini runtime bridge which may delegate to this for daemon spawning. |
| `zod` | ^3.24.2 | 3.25.76 | **Direct** -- schema validation for all MCP tool input parameters. Every oracle tool defines its input schema with `z.object()`. |

### Dev Dependencies

| Package | Declared | Resolved (installed) | Purpose |
|---------|----------|---------------------|---------|
| `@types/node` | ^22.0.0 | 22.19.11 | Node.js type definitions for TypeScript compilation |
| `typescript` | ^5.7.0 | 5.9.3 | TypeScript compiler (`tsc`) |

---

## New Dependencies (Pythia-specific)

Pythia requires **zero new npm dependencies**. All functionality is built on
Node.js built-ins and existing MCP server dependencies.

| Module | Type | Purpose |
|--------|------|---------|
| `node:crypto` | Node.js built-in | SHA-256 hashing for corpus file integrity verification, tree hash computation for live_sources change detection, decommission token generation (UUID) |
| `node:fs` | Node.js built-in | Reading corpus files, writing state/manifest/interactions artifacts, atomic file writes (temp + rename pattern) |
| `node:path` | Node.js built-in | Absolute path resolution, `join()` for oracle directory construction |
| `node:os` | Node.js built-in | `homedir()` for registry path resolution (`~/pythia/registry.json`) |
| `node:child_process` | Node.js built-in | `execSync` for git commit operations (`batchCommitLearnings`), Gemini CLI invocation for `oracle_salvage` (single-shot, not daemon) |
| `node:timers` | Node.js built-in | `setInterval` for idle pool member sweep (every 60s on `GeminiRuntime` singleton) |
| `node:stream` | Node.js built-in | `stream.write()` with drain handlers for streaming large corpus payloads (5MB+) to daemon stdin without backpressure failure |
| `node:readline` | Node.js built-in | Line-by-line reading of `vN-interactions.jsonl` for `oracle_quality_report` and `oracle_salvage` |

---

## MCP Server Architecture

| Property | Value |
|----------|-------|
| SDK | `@modelcontextprotocol/sdk` 1.26.0 |
| Transport | stdio (Claude Code connects via stdin/stdout) |
| Server name | `gemini-agent` (version `1.0.0`) |
| Entry point | `dist/gemini/server.js` |
| Host repo | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/` |
| Source root | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/` |
| Compiled output | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/dist/` |

### Existing Source Files (pre-Pythia)

```
src/
  gemini/
    server.ts           -- MCP server entry point (McpServer + StdioServerTransport)
    tools.ts            -- Gemini daemon tools (spawn_daemon, ask_daemon, dismiss_daemon, etc.)
    model-fallback.ts   -- Quota-aware model chain with 1-hour TTL state persistence
  codex/
    [codex agent files]
  shared/
    agent-log-path.ts   -- Agent log path resolution
    cli-executor.ts     -- PTY-based CLI execution wrapper
    context-detector.ts -- Project/session context detection
    job-store.ts        -- Async job storage (SYN/ACK pattern)
    message-formatter.ts -- Inter-agent message formatting
    outbox-logger.ts    -- Message outbox logging
    scratchpad-reaper.ts -- Scratchpad cleanup
    session-log-finder.ts -- Session log discovery
    types.ts            -- Shared type definitions
```

### New Files (Pythia adds)

| File | Location | Purpose |
|------|----------|---------|
| `oracle-types.ts` | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-types.ts` | All Pythia interfaces and types: `OracleManifest`, `OracleState`, `InteractionEntry`, `QualityReport`, `OracleResult<T>`, `OracleErrorCode`, `DaemonPoolMember`, `IonHandoffRequest`, `IonHandoffResponse`, etc. |
| `oracle-tools.ts` | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` | MCP tool registrations: `spawn_oracle`, `oracle_sync_corpus`, `oracle_pressure_check`, `oracle_checkpoint`, `oracle_reconstitute`, `oracle_log_learning`, `oracle_add_to_corpus`, `oracle_update_entry`, `oracle_salvage`, `oracle_quality_report`, `oracle_decommission_request`, `oracle_decommission_execute`, `oracle_decommission_cancel` |
| `runtime.ts` | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/runtime.ts` | Singleton `GeminiRuntime` implementing `OracleRuntimeBridge` interface. Owns `_sessions` map (extracted from `tools.ts`), daemon lifecycle, decommission tokens, idle sweep timer. |

### Modified Files (Pythia modifies)

| File | Change |
|------|--------|
| `src/gemini/tools.ts` | Refactored to use `GeminiRuntime` singleton from `runtime.ts` instead of owning `_sessions` directly. `askDaemon` return type extended to include `chars_in`, `chars_out`. |
| `src/gemini/server.ts` or `src/index.ts` | Register oracle tools alongside existing Gemini tools. |

---

## External Systems

### Gemini CLI

| Property | Value |
|----------|-------|
| Command | `gemini` |
| Installed version | 0.32.1 |
| Config directory | `/Users/mikeboscia/.gemini/` |
| Instructions | `/Users/mikeboscia/.gemini/GEMINI.md` |
| Daemon sessions | `/Users/mikeboscia/.gemini/daemon-sessions/` |
| Quota state | `/Users/mikeboscia/.gemini/quota-state.json` |

**Model fallback chain** (priority order):

| Model | Context Window | Type |
|-------|---------------|------|
| `gemini-3-pro-preview` | 2,000,000 tokens | Pro (preferred) |
| `gemini-2.5-pro` | 2,000,000 tokens | Pro (fallback) |
| `gemini-3-flash-preview` | 1,000,000 tokens | Flash (fast fallback) |
| `gemini-2.5-flash` | 1,000,000 tokens | Flash (emergency fallback) |

Quota exhaustion tracking: per-model 1-hour TTL in
`/Users/mikeboscia/.gemini/quota-state.json`. Patterns detected:
`RESOURCE_EXHAUSTED`, `quota exceeded`, `rate limit`, `429`, `too many requests`,
`daily limit`, `per minute limit`.

### File System Layout

**Engine (global -- lives outside any project):**

| Path | Purpose |
|------|---------|
| `/Users/mikeboscia/pythia/` | Engine root: docs, skills, registry |
| `/Users/mikeboscia/pythia/registry.json` | Maps oracle names to project `oracle_dir` paths |
| `/Users/mikeboscia/pythia/src/` | Engine source (future -- currently tools live in MCP server) |
| `/Users/mikeboscia/pythia/skills/pythia.md` | Slash command skill file for `/pythia` |

**Data (per-project -- lives inside the project repo):**

```
<project-root>/
  oracle/
    manifest.json                  -- Canonical corpus definition (static + live sources)
    state.json                     -- Current daemon state, pressure metrics, pool info
    learnings/
      v1-interactions.jsonl        -- Structured per-query audit trail (generation 1)
      v2-interactions.jsonl        -- Generation 2 interactions
    checkpoints/
      v1-checkpoint.md             -- Pythia v1's self-written synthesis before death
      v2-checkpoint.md             -- Generation 2 checkpoint
  .pythia-active/                  -- Marker directory (one JSON file per active oracle)
    <oracle-name>.json             -- Active oracle metadata (atomic temp+rename writes)
```

**Security (user home -- never project-scoped):**

| Path | Purpose |
|------|---------|
| `/Users/mikeboscia/.pythia/bin/pythia-auth` | Compiled TOTP authenticator binary (Go or Rust) |
| `/Users/mikeboscia/.pythia/keys/` | Encrypted TOTP secrets (`<name>.totp.enc`) |

### Git

- Oracle data (`<project>/oracle/`) is git-tracked alongside project code
- Same branch as code -- no dedicated oracle branch
- `registry.json` is git-tracked in `/Users/mikeboscia/pythia/`
- Batched commits via `batchCommitLearnings()` with flush triggers:
  - Pending entries >= 10
  - Pending bytes >= 256KB
  - 30-second debounce timer
  - Explicit `force: true`
  - Process shutdown hook
- Registry writes use atomic temp file + rename pattern (git is the backup)

---

## Security Components

### pythia-auth Binary

| Property | Value |
|----------|-------|
| Language | Go or Rust (compiled binary, not shell script) |
| Location | `/Users/mikeboscia/.pythia/bin/pythia-auth` |
| Purpose | TOTP code generation for oracle decommission verification |
| TOTP standard | RFC 6238, 30-second window |
| macOS secure storage | Keychain with `kSecAccessControlBiometryAny` (Touch ID required) |
| Linux/Windows storage | Encrypted file at `/Users/mikeboscia/.pythia/keys/<name>.totp.enc` (passphrase-protected) |
| Master Recovery Key | 256-bit, shown once at enrollment, never stored by the system |

**Security invariants:**
- TOTP secrets never written to `state.json` (git-tracked)
- Decommission tokens stored in-memory only on `GeminiRuntime` singleton (10-minute TTL)
- `pythia-auth` requires TTY interaction -- no agent can invoke it programmatically
- MCP server restart invalidates all decommission tokens

---

## Build and Development

| Task | Command | Notes |
|------|---------|-------|
| Build | `npm run build` (`tsc`) | Compiles `src/**/*` to `dist/` |
| Watch | `npm run watch` (`tsc --watch`) | Incremental recompilation on file change |
| Testing | Manual + Claude Code | No automated test framework configured in the MCP server |
| Linting | Not configured | No ESLint or Prettier in `package.json` |

**Build output:** `/Users/mikeboscia/.claude/mcp-servers/inter-agent/dist/`

After building, the MCP server must be restarted (new Claude Code session) for
changes to take effect. The server runs as a subprocess of Claude Code, connected
via stdio transport.

---

## Infrastructure Costs

| Resource | Model | Notes |
|----------|-------|-------|
| Gemini API | Token-based (per-model pricing) | Consumed via Gemini CLI, not direct API calls |
| Storage | Local filesystem only | No cloud database, no S3, no external storage |
| Compute | Local machine only | MCP server runs as Claude Code subprocess |
| Network | Gemini CLI to Google API | Only external network call |

---

## Hosting

- Local development machine only -- not deployed to any cloud infrastructure
- MCP server runs as a subprocess of Claude Code (launched on session start)
- Connected to Claude Code via stdio transport (stdin/stdout JSON-RPC)
- One MCP server process per Claude Code session
- Server restarts on new Claude Code session (MCP server reload)

---

## Constraints and Limitations

### Hard Limits

| Constraint | Value | Purpose |
|------------|-------|---------|
| `MAX_BOOTSTRAP_STDIN_BYTES` | 6,000,000 (6 MB) | Hard cap on total stdin payload during corpus bootstrap. Prevents pipe/buffer failures on large payloads. |
| `max_sync_bytes` (per live_source) | 5,000,000 (5 MB) default | Safety rail against accidentally globbing `node_modules/` or `dist/`. Throws `CORPUS_CAP_EXCEEDED` if exceeded. |
| `MAX_INHERITED_WISDOM_INLINE_CHARS` | 180,000 | If checkpoint exceeds this, preamble includes a brief lineage summary instead of full text; full checkpoint loads as first static chunk. |
| `max_files` (per live_source) | 200 default | Per-source file count cap for glob resolution. |
| `checkpoint_headroom_tokens` | 250,000 default | Absolute headroom before checkpoint triggers. Configurable per-oracle in `manifest.json`. |
| `chars_per_token_estimate` | 4 default | Heuristic for char-to-token conversion. +/-10-15% error margin on English/code text. |

### Context Windows

| Model | Window Size |
|-------|------------|
| `gemini-2.5-pro` | 2,000,000 tokens |
| `gemini-3-pro-preview` | 2,000,000 tokens |
| `gemini-2.5-flash` | 1,000,000 tokens |
| `gemini-3-flash-preview` | 1,000,000 tokens |
| Unknown model (fallback) | 2,000,000 tokens (conservative) |

Context window is discovered dynamically at `spawn_oracle` time via hardcoded
lookup table (`CONTEXT_WINDOW_BY_MODEL`). Stored in `state.json`, not in
`manifest.json` -- allows automatic adaptation as Gemini's windows grow.

### Concurrency

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `writeStateWithRetry` max retries | 5 | Optimistic concurrency on `state.json` via `state_version` counter |
| `writeStateWithRetry` base backoff | 100 ms | Exponential backoff between retries |
| `writeStateWithRetry` jitter | 50 ms | Random jitter added to backoff |
| Operation lock TTL | 600,000 ms (10 min) | Prevents orphaned locks on crash |
| Lock heartbeat interval | 60,000 ms (60 s) | Extends TTL during long-running operations |
| Lock wait polling | 500 ms | Poll interval when waiting for a held lock |
| Lock wait timeout | 30,000 ms (30 s) default | Max time to wait before returning `DAEMON_BUSY_LOCK` |

### Pool Defaults

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `pool_size` | 2 | Ceiling for concurrent daemon members per oracle (not always-on) |
| `idle_timeout_ms` | 300,000 (5 min) | Soft-dismiss idle pool members after this duration |
| Idle sweep interval | 60,000 (60 s) | `GeminiRuntime` singleton `setInterval` for checking idle members |
| Decommission token TTL | 600,000 (10 min) | In-memory token expiry for decommission protocol |
| Decommission cooling-off | 300,000 (5 min) | Mandatory wait between confirmation and execution |

### Batched Commit Thresholds

| Trigger | Value |
|---------|-------|
| Pending entry count | >= 10 |
| Pending bytes | >= 256 KB |
| Debounce timer | 30 seconds |
| Force flush | `force: true` parameter |
| Process shutdown | Flush on process exit hook |

### Pressure Model (Absolute Headroom)

| Tokens Remaining | Status | Action |
|-----------------|--------|--------|
| > `checkpoint_headroom_tokens` | `healthy` | Normal operation |
| `headroom/2` to `headroom` | `warning` | Notify caller, checkpoint recommended |
| < `headroom/2` | `critical` | Auto-checkpoint triggered |
| < `headroom/4` | `emergency` | Too late for safe checkpoint; use `oracle_salvage` |

Pressure is calculated as `MAX(memberTokens)` across the pool, not `SUM`.
Each pool member has its own independent context window.

---

## Error Codes

All oracle tools return `OracleResult<T>` -- a discriminated union with typed
error codes and `retryable` hints.

| Code | Retryable | Meaning |
|------|-----------|---------|
| `ORACLE_NOT_FOUND` | No | Named oracle does not exist in registry |
| `ORACLE_ALREADY_EXISTS` | No | Oracle name collision on spawn with `reuse_existing: false` |
| `MANIFEST_INVALID` | No | Manifest schema validation failed |
| `STATE_INVALID` | No | State schema validation failed |
| `DAEMON_NOT_FOUND` | No | No daemon process for the given ID |
| `DAEMON_BUSY_QUERY` | Yes | Pool member processing a query (seconds) |
| `DAEMON_BUSY_LOCK` | Yes | Heavyweight operation holds operation lock (minutes) |
| `DAEMON_DEAD` | No | Daemon process exited unexpectedly |
| `DAEMON_QUOTA_EXHAUSTED` | Yes | All Gemini models quota-exhausted (retry after ~1 hour) |
| `FILE_NOT_FOUND` | No | Corpus file referenced in manifest not found on disk |
| `HASH_MISMATCH` | No | File SHA-256 does not match manifest entry |
| `PRESSURE_UNAVAILABLE` | No | No active pool members to measure pressure |
| `CHECKPOINT_FAILED` | No | Checkpoint generation failed (context limit, daemon error) |
| `BOOTSTRAP_FAILED` | No | Daemon failed to acknowledge corpus load |
| `RECONSTITUTE_FAILED` | No | Generation transition failed |
| `IO_ERROR` | Yes | File system I/O error |
| `CONCURRENCY_CONFLICT` | Yes | `state_version` mismatch after max retries |
| `CORPUS_CAP_EXCEEDED` | No | Corpus exceeds token gate or `MAX_BOOTSTRAP_STDIN_BYTES` |
| `LOCK_TIMEOUT` | Yes | Could not acquire operation lock within timeout |
| `STALE_REGISTRY_PATH` | No | Registry path does not match disk reality |
| `DECOMMISSION_REFUSED` | No | Decommission gate check failed |
| `DECOMMISSION_TOKEN_EXPIRED` | No | 10-minute decommission token expired |
| `DECOMMISSION_CANCELLED` | No | User cancelled pending decommission |
| `TOTP_INVALID` | No | TOTP code verification failed |
| `CONFIRMATION_PHRASE_MISMATCH` | No | Typed confirmation phrase does not match expected |
