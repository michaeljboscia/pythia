# Process Lifecycle Management and Supervision Trees for AI Daemon Orchestration

**Source:** Gemini Deep Research
**Research ID:** `v1_ChdJNXV2YVpIV0FZbkFxdHNQeDRMUXVRYxIXSTV1dmFaSFdBWW5BcXRzUHg0TFF1UWM`
**Duration:** 9m 27s
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T04-26-03-959Z.json`

---

## Key Points

- **Erlang/OTP "let it crash"** delegates error recovery to dedicated supervisors rather than forcing workers to manage corrupted state
- **PPID polling is fundamentally flawed:** TOCTOU race conditions + PID wrap-around make it unreliable for orphan detection
- **POSIX process groups (PGIDs) and cgroups** provide deterministic guarantees for terminating multi-process trees
- **Saga pattern** is exceptionally suited for multi-step daemon lifecycles (checkpoint → spawn → verify) using compensating transactions

---

## OTP Supervision Patterns

### "Let It Crash" Philosophy
- Actors share no memory — crash in one doesn't corrupt another
- Actors link/monitor each other — exit signals propagate
- Supervisors: specialized actors that monitor workers, react to termination, spawn fresh instances with known-good state

### Restart Strategies

| Strategy | Behavior | Use When |
|----------|----------|----------|
| **one_for_one** | Only crashed child restarted | Children are independent |
| **one_for_all** | All siblings terminated + restarted | Tightly coupled children (shared state invalidated) |
| **rest_for_one** | Crashed child + all children started AFTER it restarted | Linear dependency chains |
| **simple_one_for_one** | Dynamic variant of one_for_one | All children are same type, added at runtime |

### Restart Intensity and Period
- **Intensity (MaxR):** Max restarts permitted in timeframe (default: 1)
- **Period (MaxT):** Time interval in seconds (default: 5s)
- If restarts R > MaxR within MaxT → supervisor terminates self → escalates up tree
- Prevents infinite restart loops from persistent environmental errors

---

## systemd vs Custom Supervisors

### PID Tracking Methods
- `Type=simple`: Track initial PID
- `Type=forking`: Track surviving child after parent exits
- `PIDFile=`: Read PID from file (discouraged — stale PID race conditions)
- `GuessMainPID=`: Heuristic guessing (unreliable with multiple workers)

### cgroups for Resource Bounding
- systemd creates dedicated cgroup per service
- All child processes automatically placed in same cgroup by kernel
- `ExitType=cgroup`: Service active as long as ANY process in cgroup lives
- `OOMPolicy=kill`: OOM on any process → kill all in cgroup
- Custom Node.js supervisor must use POSIX PGIDs as approximation

### Watchdog vs Polling
- **Polling:** Repeated health checks — wastes CPU, introduces mandatory delay
- **Watchdog (systemd):** Inversion of control — daemon must periodically call `sd_notify(WATCHDOG=1)`
- If daemon fails to ping before timeout → systemd terminates with SIGABRT
- **Recommendation:** Expose IPC channel, PTY daemon sends heartbeat based on injected env var

---

## Why PPID Polling Fails

### PID Reuse Race Conditions
1. Supervisor (PID 5000) crashes → kernel frees PID 5000
2. Before daemon's poll loop: unrelated process gets PID 5000
3. Daemon's signals to "parent" now target wrong process
4. Additional: GC pauses stall polling loop → OS doesn't release lock → stale state

### POSIX Process Groups (The Solution)

- **Process Group (PGID):** Collection of processes; signals delivered to all members simultaneously
- **POSIX guarantee:** Kernel won't reuse PID if process group with that ID still exists
- **Session Leader:** Process calling `setsid()` — creates new session + process group
- **SIGHUP propagation:** Terminal close → SIGHUP to session leader → propagates to group

### Node.js Implementation
```typescript
// Spawn with detached: true → creates new PGID
const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });

// Terminate entire process tree using negative PID
process.kill(-child.pid, 'SIGTERM');  // Signals ALL processes in group

// Escalate to SIGKILL after timeout
setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch(e) {} }, 5000);
```

---

## Saga Pattern for Daemon Orchestration

### Why ACID Doesn't Work Here
- 2PC impossible with external processes — process execution can't be "rolled back"
- Need compensating transactions for each forward step

### Saga Structure
- Sequence of local transactions T1, T2, ... Tn
- Each has compensating transaction C1, C2, ... Cn
- On failure at step k: execute Ck-1, Ck-2, ... C1 (reverse order)
- **Compensating transactions MUST be idempotent**

### Applied to AI Daemon Lifecycle

| Step | Forward (Ti) | Compensating (Ci) |
|------|-------------|-------------------|
| 1 | Checkpoint state | Delete checkpoint |
| 2 | Rename old daemon handle | Restore old handle |
| 3 | Spawn new PTY daemon | `kill -PGID` new daemon |
| 4 | Inject corpus via stdin | N/A (trigger C3 → C2) |

### Choreography vs Orchestration
- **Choreography:** Each participant emits events, others react (decentralized)
- **Orchestration:** Centralized state machine commands participants (preferred for daemon lifecycle)

---

## Actor Frameworks for TypeScript

### XState (Stately.ai)
- State machine library embracing Actor Model
- Parent machines dynamically spawn/stop child actors
- Encapsulated state, lifecycle cascading (stop root → stop all descendants)
- Error events caught by parent observers → transition to error state → re-spawn

### Nact (Node.js + Akka)
- Explicit Node.js actor model framework inspired by Akka and Erlang
- 99.3% TypeScript codebase
- Built-in supervision trees (one_for_one style)

### Mailbox Semantics
- Actors process messages sequentially from internal queue
- Eliminates internal state race conditions
- Need backpressure for message rate > processing rate (bounded mailboxes)

---

## Recommended 3-Tier Architecture

1. **POSIX Layer:** `detached: true` + negative PID signaling for deterministic process tree teardown
2. **Supervisor Layer:** OTP-inspired `one_for_one` with intensity/period restart limits
3. **Orchestration Layer:** XState Saga state machines for complex multi-step lifecycles (checkpoint → dismiss → spawn → verify) with compensating transactions
