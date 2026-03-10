# Pythia Oracle Engine Primitive Analysis (Codex)

Scope analyzed:
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-tools.ts` (4026 LOC)
- `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/oracle-types.ts`
- `/Users/mikeboscia/pythia/LESSONS.md`

This is a code-level primitives audit, not a product critique.

## Executive Verdict
- You built a serious amount of systems machinery by hand: lock leasing, OCC, corpus hashing/delta, checkpoint orchestration, event logging, decommission security gates.
- The core issue: **you implemented database/distributed-systems primitives on JSON files without transactional guarantees**.
- Result: single-user/dev load is workable; multi-actor or high-churn load has real split-brain and lost-update risk.
- The big missing research was around: **atomic compare-and-swap semantics, transactional state transitions, durable logs, and lock correctness under concurrency**.

---

## 1. Distinct Primitives Used + Maturity Assessment

### Legend
- `Naive`: fragile vs standard practice
- `Adequate`: reasonable for low/medium load, with known limits
- `Sophisticated`: near best-practice for this context

| Primitive / Pattern | Where | Assessment | Why |
|---|---|---|---|
| Temp-file + rename atomic write | `atomicWriteFile` (`oracle-tools.ts:153`) | Adequate | Correct same-FS atomic replace pattern. Missing fsync(file)+fsync(dir) durability barrier. |
| Best-effort temp cleanup | `atomicWriteFile` | Adequate | Good hygiene; crash before cleanup can leak temp files (acceptable). |
| Optimistic concurrency loop (version-based) | `writeStateWithRetry` (`:300`) | **Naive / Incorrect** | TOCTOU race: read->verify->write is not atomic CAS. Two writers can both "succeed" and clobber. |
| Exponential backoff + jitter | `writeStateWithRetry` (`:340`) | Adequate | Standard retry shape, but on top of broken CAS primitive. |
| Advisory lock with lease/TTL | `acquireOperationLock` (`:414`) | Adequate concept, Naive impl | Lease idea is good; correctness inherits broken CAS, allowing split-brain lock acquisition. |
| Lock heartbeat renewal | `startLockHeartbeat` (`:519`) | Adequate | Standard lease extension pattern. No fencing token enforcement beyond string check. |
| Token-scoped lock release | `releaseLock` (`:497`) | Adequate | Better than blind unlock; still depends on state write correctness. |
| Polling wait loops with deadline | lock/drain paths (`:427`, `:2439`) | Adequate | Simple and predictable; no event-driven wakeup. |
| Schema versioning | `schema_version`, `state_version` types + state | Adequate | Good evolution hook, but validation is shallow. |
| Registry/state/manifest separation | multiple | Adequate | Clean boundaries conceptually; no cross-file transaction. |
| Discriminated result envelope with typed error codes | `OracleResult`, `OracleErrorCode` | Sophisticated | Strong API ergonomics and explicit retryability. |
| Runtime input schemas via Zod | tool registration (`:3468+`) | Sophisticated | Mature validation boundary for MCP inputs. |
| Deterministic tree hash over file hashes | `computeTreeHash` (`:607`) | Adequate | Merkle-like fast change detection; not full Merkle DAG. |
| SHA-256 integrity pinning for corpus entries | static/manifests | Adequate | Good integrity control; operationally heavy without background reconciler. |
| Hash-gated delta sync | `syncCorpus` + `last_tree_hash` | Adequate | Solid pattern; bug history in `LESSONS.md` shows edge-case fragility. |
| Per-file delta computation + deleted-file signaling | `syncCorpus` (`:1470+`) | Adequate | Right idea; counters and stale-state usage are error-prone. |
| Two-pass bootstrap (resolve then inject) | `resolveCorpusForSpawn` + `loadResolvedCorpusIntoDaemon` | Sophisticated | Good staged pipeline with preflight gates before daemon mutation. |
| Resource caps (max files/bytes/token gates) | corpus resolve/delta | Adequate | Good safety rails; static limits/hard failures may hurt large deployments. |
| Ordered load scheduling (role/priority/timestamp/path) | `resolveCorpusForSpawn` sort | Adequate | Deterministic and explicit. |
| Append-only JSONL interaction log | `logLearning` (`:1896`) | Adequate | Practical event log. Lacks WAL semantics and compaction strategy. |
| Sequence reservation before append | `logLearning` state bump then append | Adequate | Good anti-dup intent; with broken CAS can still race under contention. |
| Batched flush by count/size/debounce | `BATCH_*`, `flushBatch*` | Adequate | Good write/commit amortization. |
| Shutdown hook draining | `registerShutdownHook` | Adequate | Common process-exit strategy; still best-effort. |
| Cascading fallback pipelines | checkpoint->salvage, extraction fallbacks | Adequate | Resilient flow control; some fallbacks silent/non-observable. |
| Drain queued syncs before query | `drainPendingSyncs` | Adequate | Good read-your-writes intent for daemons. |
| Daemon pool state machine | `DaemonPoolMember.status` | Adequate | Useful abstraction; mostly single-member in practice, little scheduler sophistication. |
| Pressure model (MAX + SUM) | `pressureCheck` | Adequate | Sensible model for checkpoint trigger; token estimation heuristic is coarse. |
| Heuristic quality degradation detection | `computeQualityReport` | Naive | Useful signal, but simplistic thresholds and no statistical robustness. |
| Custom TOTP verifier (RFC6238) | `verifyTotp` (`:2698`) | Adequate | Algorithmically fine; reinvented auth primitive and misses hardened library guarantees. |
| Multi-gate destructive op protocol | decommission token+TOTP+phrase | Adequate | Good defense-in-depth pattern, but enforcement gaps (no real cooling-off, optional TOTP). |
| In-memory ephemeral decommission token store | `runtime.decommissionTokens` (`:2802`) | Naive | Lost on process restart; no durable audit trail/state machine. |
| Best-effort non-fatal error swallowing | many `catch {}` | Naive | Improves liveness but hides integrity failures under load. |
| Synchronous child-process side effects | `execSync(git ...)` | Naive | Blocks event loop; poor under concurrent tool traffic. |

---

## 2. Reinvented Wheel vs Established Libraries

## Reinvented (explicitly)
- OCC/CAS over JSON file state (`writeStateWithRetry`) instead of DB row-version CAS.
- Lock service (lease + heartbeat) in `state.json` instead of a lock coordinator.
- TOTP verification/base32 decode instead of hardened OTP library.
- Event log batching/flush orchestration instead of existing queue/journal infra.
- Delta sync protocol and pending queue serialization in state file.
- Multi-step workflow/orchestration (checkpoint/reconstitute/decommission) by hand.

## Existing libraries/services that solve these directly
- `SQLite` (WAL mode, transactions, `BEGIN IMMEDIATE`, durable commits, indexed queries).
- `Postgres` (`SELECT ... FOR UPDATE`, advisory locks, SKIP LOCKED worker queues).
- `etcd` / `ZooKeeper` / `Consul` (lease locks, fencing, watch semantics, linearizable writes).
- `better-sqlite3` or `sqlite3` Node bindings for local metadata store.
- `otplib` / `speakeasy` for TOTP.
- `chokidar` / Watchman + persistent sync index for file-change pipelines.
- Job frameworks (`BullMQ`, `Temporal`, `pg-boss`) for durable background workflows.

## Partially reused
- `zod` for API boundary typing.
- Node crypto primitives (`createHash`, `createHmac`) as low-level building blocks.
- Git for snapshot history, but used as side-effect transport rather than source-of-truth engine.

---

## 3. Missing Patterns You Should Add

## Correctness-critical missing patterns
1. **Real atomic CAS / transactions**
- Current state write is not true CAS.
- Use SQLite/Postgres transaction with version predicate (`UPDATE ... WHERE version=?`).

2. **Single source of truth for mutable orchestration state**
- Registry/manifest/state split across separate JSON files has no atomic multi-file commit.
- Move mutable control-plane state into DB tables.

3. **Fencing tokens on locks**
- TTL lease alone can allow stale lock holders after pauses.
- Add monotonic fencing token checked by every mutating action.

4. **Idempotency keys for long operations**
- `checkpoint`, `salvage`, `reconstitute` can partially apply on retries.
- Add op IDs with durable step journal.

5. **Durable operation journal (WAL/saga log)**
- For crash recovery of multi-step flows.
- Record step state: started/completed/compensated.

## Reliability missing patterns
6. **Retry policy taxonomy with backoff for external calls**
- `askDaemon` failures mostly become hard failures or silent catches.
- Add bounded retries with jitter + classify transient/permanent errors.

7. **Circuit breaker / bulkhead**
- No protection if runtime/daemon is degraded.
- Prevent cascading timeouts across tools.

8. **Bounded queue with spill-to-disk**
- `pending_syncs.payload_ref` stores full payload in state JSON.
- Use queue table or payload files with refs and size caps.

9. **Structured observability/metrics**
- Need metrics for lock wait time, CAS conflicts, sync queue depth, checkpoint duration, failed side effects.

10. **Background reconciler**
- Periodically verify manifest hashes vs disk, sync lag, dead-member cleanup, stale locks.

## Security/ops missing patterns
11. **Durable decommission request state machine**
- In-memory tokens vanish on restart.
- Persist request with status transitions + audit fields.

12. **Enforced cooling-off window**
- Checklist says wait 5 minutes, code does not enforce it.

13. **TOTP mandatory policy toggle**
- Current "no secret => skip TOTP" is migration-friendly but weak long-term.

---

## 4. What Breaks Under Real Load

## A. Concurrency / split-brain failures (high risk)
1. **Broken CAS can lose writes**
- `writeStateWithRetry` uses read->verify->write, but verify is not tied to write atomically (`oracle-tools.ts:314-348`).
- Concurrent writers can both pass verify and then overwrite each other.

2. **Lock split-brain possible**
- `acquireOperationLock` trusts returned state from write call (`:477-480`) instead of re-reading committed lock owner.
- Two contenders can both believe they own the lock due to clobber race.

3. **Registry and manifest races**
- `registerOracle` / `updateRegistryEntry` and `writeManifest` have no version checks/transactions.
- Concurrent updates can silently drop fields.

## B. Throughput / latency collapse
4. **Event-loop blocking by `execSync`**
- Git commits in `logLearning`, checkpoint, reconstitute, corpus ops, decommission block Node process.
- Under multiple active oracles, MCP responsiveness will jitter/hang.

5. **Synchronous globbing + full-file reads**
- `globSync` + full corpus in memory does not scale with large repos.
- Memory and latency spikes for large corpus/live sources.

6. **Sequential per-file daemon injection**
- `loadResolvedCorpusIntoDaemon` sends one request per file, strictly serialized.
- Large corpus means long startup and timeout exposure.

## C. Data-integrity drift
7. **Multi-file state transitions can tear on crash**
- Example: checkpoint writes file, then manifest, then state. Crash mid-way leaves inconsistent control plane.

8. **Queued payload bloat in `state.json`**
- `pending_syncs.payload_ref` stores full payload text (`:1533`, `:1550`).
- Under frequent edits + busy daemons, state file can balloon and increase conflict rates.

9. **Counter/accounting bugs already visible**
- `syncCorpus` skip counter math is wrong (`totalFilesSkipped += files.length - totalFilesSynced`, `:1501`).
- `runReconstitute` computes `total_chars` from `bytes` (`:2561`), distorting token estimates.
- `runReconstitute` ignores passed `timeout_ms` and `dismiss_old` params in core logic (tool exposes them, function signature does not use `timeout_ms`; `dismiss_old` unused).

10. **Stale in-memory snapshots during long flows**
- You already caught this class in `LESSONS.md` (manifest stale after salvage).
- Same failure mode remains likely anywhere long workflows keep stale copies.

---

## 5. What Existing Systems Solve the Same Problems

## If you want local single-host robustness
- **SQLite (WAL)**
  - Replaces JSON registry/state/manifest mutation races.
  - Gives atomic multi-entity transactions, crash recovery, consistent reads.
  - Can model locks, queues, operation journal, seq counters cleanly.

## If you need multi-process / distributed coordination
- **etcd / ZooKeeper / Consul**
  - Linearizable writes, lease locks, watches, fencing semantics.
  - Avoids hand-rolled lock + heartbeat corner cases.

## If you need resilient workflow orchestration
- **Temporal / durable job queue**
  - Built-in retries, backoff, idempotency, step state, recovery.
  - Better fit than manual "try this then salvage then commit" chains.

## If you need actor-style supervision
- **Erlang/OTP model** (or actor frameworks)
  - Supervisor trees, mailbox backpressure, restart strategies.
  - Better daemon lifecycle semantics than ad-hoc pool status flags.

## If you need file sync correctness/performance
- **Watchman/chokidar + content index + rsync-like delta**
  - More scalable than full glob+read every sync cycle.

## If you need content-addressed artifact management
- **Git internals model**
  - Immutable blobs + refs + lockfiles can inspire safer manifest/ref updates.

---

## 6. Research You Should Have Done First (Brutally Practical)

1. **"How to implement true CAS on files"**
- You would have learned this is tricky and usually a DB/kv-store problem.

2. **"Lease locks and fencing tokens"**
- TTL lock alone is insufficient for correctness under pauses/retries.

3. **"Saga pattern / operation journaling"**
- For checkpoint/reconstitute/decommission partial-failure recovery.

4. **"WAL and append-log durability"**
- JSONL append + side-car state counters need transactional coupling.

5. **"Queue design under backpressure"**
- In-state payload queues are a known anti-pattern at scale.

6. **"Event-loop blocking in Node control planes"**
- `execSync` in request path is a performance footgun.

---

## 7. Bottom-Line Maturity Grade

- **Architecture intent:** strong
- **Primitive selection:** ambitious
- **Primitive correctness under concurrency:** weak
- **Operational resilience under load:** medium-low
- **Security controls for destructive ops:** medium (good intent, incomplete enforcement)

If this stays single-operator, low-concurrency, medium corpus size, it can run.
If this grows to multiple concurrent oracles with frequent sync/checkpoint traffic, **the current file-based coordination layer is the break point**.

