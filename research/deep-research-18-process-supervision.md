# Process Supervision Trees and Daemon Lifecycle Management Patterns

**Source:** Gemini Deep Research
**Research ID:** `v1_ChctS212YWNqVUFlQ0Z6N0lQOHBqSmlRTRIXLUttdmFjalVBZUNGejdJUDhwakppUU0`
**Duration:** 10m 20s
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T05-30-13-665Z.json`

---

## Key Points

- **Erlang/OTP defines 4 supervisor strategies:** `one_for_one` (restart only failed child), `one_for_all` (restart all siblings), `rest_for_one` (restart children started after failed one), `simple_one_for_one` (dynamic homogeneous pool — ideal for AI daemon pools)
- **Restart intensity limits** use sliding window: |W| > MaxR triggers supervisor self-termination; sustained failure rate λ = MaxR/MaxT restarts/sec; balances burst tolerance vs persistent fault detection
- **systemd Type=notify** blocks until daemon sends `READY=1` via `sd_notify(3)`; watchdog requires periodic `WATCHDOG=1` pings; `OOMPolicy=kill` with `memory.oom.group=1` eradicates entire cgroup on OOM
- **PTY flow control via node-pty** requires `handleFlowControl: true` with XON/XOFF (`\x11`/`\x13`) to prevent buffer exhaustion when AI streams tokens faster than consumers can process
- **Graceful shutdown choreography:** SIGTERM → drain in-flight operations → checkpoint-before-exit → timeout → SIGKILL escalation
- **POSIX process groups:** `setsid(2)` creates new session; `subprocess.unref()` allows parent exit; orphan prevention requires either `stdio: 'ignore'` or `PR_SET_PDEATHSIG`

---

## 1. Introduction

Process supervision is a layered architecture comprising application-level logical supervisors (Erlang/OTP), system-level service managers (systemd), and kernel-level process grouping (POSIX). A comprehensive daemon lifecycle strategy must orchestrate all layers for initialization, flow control, health monitoring, and graceful termination.

---

## 2. Erlang/OTP Supervisor Behaviors

### 2.1 one_for_one
- If child terminates, only that child is restarted
- Siblings unaffected
- **Use case:** Independent workers (network connection handlers)

### 2.2 one_for_all
- If one child terminates, ALL siblings are terminated and restarted
- **Use case:** Tightly coupled subsystems with shared state assumptions

### 2.3 rest_for_one
- If child terminates, siblings started AFTER the failed child are terminated and restarted; earlier siblings untouched
- **Use case:** Linear dependency chains (C depends on B depends on A; B fails → restart B and C, leave A)

### 2.4 simple_one_for_one
- Optimized `one_for_one` for homogeneous children (same module, same init args)
- **Use case:** Dynamically sized worker pools — the optimal choice for AI daemon pools

---

## 3. Mathematical Basis for Restart Intensity

### 3.1 Formal Definition

Sliding window W of recent restarts:
```
W = { tᵢ ∈ E | t_now - tᵢ ≤ MaxT }
```

Supervisor self-terminates when:
```
|W| > MaxR
```

### 3.2 Burst vs Sustained Failure Rate
- **Burst tolerance:** λ_burst_max = MaxR (simultaneous crashes)
- **Sustained tolerance:** λ_sustained_max = MaxR / MaxT (restarts/sec)

Example: MaxR=5, MaxT=30 → tolerates burst of 5, but sustained rate capped at 1 restart per 6 seconds. Exceeding this → supervisor cascade failure upward.

---

## 4. Systemd Service Management

### 4.1 Type=notify + Watchdog
- `Type=notify`: systemd blocks until daemon sends `READY=1` via `sd_notify(3)`
- `WatchdogSec=N`: daemon must send `WATCHDOG=1` periodically; missed ping → `SIGABRT` + restart
- `NotifyAccess=main|all`: controls which PIDs can send notification messages

### 4.2 Socket Activation
- Kernel buffers connections; passes inherited file descriptors to daemon on spawn
- `NonBlocking=true` sets `O_NONBLOCK` on inherited sockets (optimizes for Node.js event loop)
- Implicit `After=`/`Wants=` dependency ordering relative to `.socket` units

### 4.3 Cgroup Exit Types and OOM Policy
- `ExitType=main`: unit stops when primary PID exits
- `ExitType=cgroup`: unit runs while ANY process in cgroup alive (essential for complex daemon pools)
- `OOMPolicy=kill`: sets `memory.oom.group=1` → kernel eradicates entire cgroup atomically on OOM

---

## 5. POSIX Process Groups and Orphan Prevention

- `setsid(2)` (via `options.detached = true`): makes child leader of new process group + session
- `subprocess.unref()`: removes child from parent's event loop reference count (allows parent exit)
- **Orphan prevention:** must break stdio streams (`stdio: 'ignore'`) or use `PR_SET_PDEATHSIG` (Linux-specific)
- Monitor `process.on('exit')` to explicitly signal process group on parent crash

---

## 6. PTY Management for Interactive Subprocess Control

### 6.1 Buffer Management and Backpressure
- Standard pipes have kernel backpressure; PTYs do NOT
- `node-pty` with `handleFlowControl: true`: enables XON/XOFF software flow control
  - PAUSE: write `\x13` (XOFF) to PTY
  - RESUME: write `\x11` (XON) to PTY
- `node-pty` intercepts these bytes, prevents them from reaching child stdin
- Custom codes via `flowControlPause`/`flowControlResume` properties if defaults conflict with payload

### 6.2 SIGWINCH Propagation
- `ptyProcess.resize(cols, rows)` triggers `SIGWINCH` to child
- Essential when proxying between web UI (xterm.js) and CLI daemon

---

## 7. Health Check Patterns

### 7.1 Three Probe Types
| Probe | Purpose | On Failure |
|-------|---------|------------|
| **Startup** | Has slow-starting app finished init? | Suppress other probes until success |
| **Readiness** | Can process accept traffic? | Remove from routing pool (don't kill) |
| **Liveness** | Is process deadlocked? | Terminate and restart immediately |

### 7.2 Circuit Breaker Integration
1. **Closed:** Normal operation, count failures
2. **Open:** Failure rate exceeds threshold → stop sending requests, return errors immediately
3. **Half-Open:** After cooldown, allow limited test requests → success resets to Closed, failure returns to Open

---

## 8. Graceful Shutdown Choreography

1. **SIGTERM:** Supervisor broadcasts termination request (catchable)
2. **Connection Draining:** Child stops accepting new requests, finishes in-flight operations
3. **Checkpoint-Before-Exit:** Child writes state to persistent storage
4. **Timeout:** Supervisor starts timer (e.g., 10 seconds)
5. **SIGKILL:** If child hasn't exited → uncatchable forced termination by kernel

---

## 9. AI Daemon Pool Supervision Comparison

| Characteristic | Traditional Web Workers | AI Daemon Pools |
|---------------|------------------------|-----------------|
| **Statefulness** | Stateless (any request → any worker) | Highly stateful (context window bounds to specific worker) |
| **Startup Cost** | Milliseconds | Seconds to minutes (loading context/weights) |
| **Resource Profile** | Low memory, high CPU/IO | Massive VRAM/RAM, high CPU/GPU |
| **Flow Control** | TCP kernel backpressure | Application-level XON/XOFF via PTY |
| **Optimal OTP Model** | `one_for_one` | `simple_one_for_one` |
| **Pool Sizing** | Elastic, cheap scaling | Strictly bounded by hardware capacity |

---

## 10. TypeScript Implementation

```typescript
import * as pty from 'node-pty';
import { EventEmitter } from 'events';

interface RestartPolicy {
    maxR: number;
    maxTSecs: number;
}

export class PythiaSupervisor extends EventEmitter {
    private pool: Map<string, pty.IPty> = new Map();
    private restartHistory: number[] = [];
    private policy: RestartPolicy;

    constructor(policy: RestartPolicy = { maxR: 5, maxTSecs: 30 }) {
        super();
        this.policy = policy;
    }

    /** Sliding window restart intensity check: |W| > MaxR */
    private evaluateRestartIntensity(): boolean {
        const now = Date.now();
        const maxTMs = this.policy.maxTSecs * 1000;
        this.restartHistory = this.restartHistory.filter(t => (now - t) <= maxTMs);
        this.restartHistory.push(now);
        return this.restartHistory.length <= this.policy.maxR;
    }

    /** Spawn Gemini CLI daemon with PTY flow control */
    public spawnWorker(workerId: string): void {
        const proc = pty.spawn('gemini-cli', ['--interactive'], {
            name: 'xterm-color', cols: 80, rows: 30,
            cwd: process.cwd(), env: process.env,
            handleFlowControl: true,
            flowControlPause: '\x13',  // XOFF
            flowControlResume: '\x11'  // XON
        });

        proc.onData((data: string) => {
            if (this.checkDownstreamBackpressure()) {
                proc.write('\x13'); // Pause PTY output
            }
            this.emit('data', workerId, data);
        });

        proc.onExit((status) => {
            this.pool.delete(workerId);
            this.handleWorkerCrash(workerId, status);
        });

        this.pool.set(workerId, proc);
    }

    /** one_for_one restart with intensity check */
    private handleWorkerCrash(workerId: string, status: any): void {
        if (!this.evaluateRestartIntensity()) {
            console.error('MaxR exceeded. Supervisor halting.');
            process.exit(1); // Cascade upward
        }
        setTimeout(() => this.spawnWorker(workerId), 1000);
    }

    /** Propagate SIGWINCH */
    public resizeTerminal(workerId: string, cols: number, rows: number): void {
        this.pool.get(workerId)?.resize(cols, rows);
    }

    /** SIGTERM → drain → SIGKILL choreography */
    public async shutdown(): Promise<void> {
        const promises = Array.from(this.pool.entries()).map(([id, proc]) => {
            return new Promise<void>((resolve) => {
                let dead = false;
                proc.onExit(() => { dead = true; resolve(); });
                proc.kill('SIGTERM');
                setTimeout(() => {
                    if (!dead) { proc.kill('SIGKILL'); resolve(); }
                }, 10000);
            });
        });
        await Promise.all(promises);
    }

    private checkDownstreamBackpressure(): boolean { return false; }
}
```

---

## Recommendations for Pythia

1. **Adopt `simple_one_for_one` model** — all Gemini CLI daemons are identical, interchangeable workers. State (conversation context) should be re-injected upon crash via checkpoint reload, not by attempting PTY state resurrection.

2. **Enable PTY flow control** — instantiate `node-pty` with `handleFlowControl: true` and map XON/XOFF to downstream consumer backpressure (WebSocket high-water/low-water marks). Without this, token streaming from Gemini will exhaust Node.js heap on slow consumers.

3. **Tune restart intensity conservatively** — MaxR=2, MaxT=120s recommended for AI daemons. GPU initialization spikes on rapid restart loops can stall entire host. If a worker fails twice in 2 minutes, it's likely a deterministic fault (corrupted context) — circuit-break the session rather than thrashing.

4. **Implement checkpoint-before-exit** — on SIGTERM, Pythia daemons should flush the current interaction log to JSONL and write a partial checkpoint before exiting. The 10-second drain window must accommodate this write.

5. **Use `ExitType=cgroup` and `OOMPolicy=kill`** in systemd deployment — Gemini CLI may spawn sub-threads for tokenization; OOM in any sub-process must eradicate the entire cgroup to prevent zombie GPU processes holding VRAM.

6. **PPID watchdog for orphan prevention** — Pythia's runtime should periodically check if the parent Claude Code process is still alive. If the parent dies without sending SIGTERM (crash, OOM), the daemon should self-terminate rather than becoming an orphan consuming resources indefinitely.
