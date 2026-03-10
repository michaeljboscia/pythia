# Atomic Coordination and Compare-And-Swap (CAS) in Local Filesystems

**Source:** Gemini Deep Research
**Research ID:** `v1_ChdHWnV2YWZQOEViZml6N0lQbExiZ3lBURIXR1p1dmFmUDhFYmZpejdJUGxMYmd5QVE`
**Duration:** 9m 36s
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T04-26-02-836Z.json`

---

## Key Points

- **TOCTOU is pervasive:** JSON read-modify-write cycles suffer from fundamental race conditions — gap between evaluating state and mutating it
- **SQLite WAL mode:** Cleanly separates reader/writer concurrency; `BEGIN IMMEDIATE` eliminates TOCTOU window entirely
- **TTL leases are insufficient:** GC pauses, network delays, clock drift render time-based locks unsafe without fencing tokens
- **Fencing tokens are gold standard:** Monotonically increasing integers verified at storage layer prevent stale lock holders from corrupting data
- **Git's approach is a masterclass:** Atomic file creation (`O_EXCL`), system-level renames for atomic ref updates
- **SQLite is optimal for single-host Node.js:** Atomic mutations + advisory locking + durable journaling without external daemon

---

## The TOCTOU Problem in Detail

### Why JSON Read-Modify-Write is NOT True CAS

True CAS requires hardware/OS guarantee that comparison and swap are single, indivisible operation. JSON RMW fails because it's composed of multiple discrete operations:

1. **Check Phase (Read):** `fs.readFile` → `open()` → `read()` → `close()`
2. **User-Space Processing:** Buffer → string → `JSON.parse()` → inspect version
3. **The Preemption Window:** OS scheduler can preempt at ANY microsecond after read
4. **Use Phase (Write):** `fs.writeFile` → `open(..., O_TRUNC)` → `write()` → `close()`

Two processes can read version N, both increment to N+1, and one silently overwrites the other. Node.js `fs` module is explicitly documented as not synchronized and not thread-safe.

---

## SQLite WAL Mode Architecture

### How WAL Works
- Original database preserved during writes; modifications appended to separate WAL file
- COMMIT = atomic commit record appended to WAL (not main DB modification)
- Readers uninterrupted by writes — snapshot isolation via "end mark" (last valid commit at transaction start)
- Single writer at a time (WAL enforced); periodic checkpoints transfer WAL → main DB

### `BEGIN IMMEDIATE` Guarantees
- Immediately acquires exclusive write lock — blocks other writers before any read
- If another connection has active write transaction → `SQLITE_BUSY` error immediately
- In WAL mode: `IMMEDIATE` and `EXCLUSIVE` behave identically
- Creates flawless CAS: `BEGIN IMMEDIATE` → `SELECT version` → evaluate → `UPDATE version+1` → `COMMIT`
- **No TOCTOU window:** Exclusive write lock held from transaction start

### Performance for Metadata
- SQLite often **outperforms** direct filesystem operations for metadata read/write
- No network round-trips (same process memory space)
- Microsecond-scale sequential SQL queries
- Constraint: single writer at a time (fine for metadata, not for massive write throughput)
- **Never use on networked filesystems** (NFS) — buggy file-locking → database corruption

---

## Fencing Tokens (Martin Kleppmann)

### Why TTL Leases Fail
1. **GC Pauses:** Process pauses 15s, lock expired 5s ago, resumes unaware → writes without valid lock
2. **Network Delays:** Write dispatched with valid lock, network delays delivery past expiry
3. **Clock Drift:** NTP sync causes sudden jumps, lock expires faster than calculated
4. **No Mutual Exclusion Guarantee:** Lock service can only guarantee one node *believes* it holds lock

### How Fencing Tokens Work
- Monotonically increasing number bound to lock lease
- Every write request must include the token
- Storage server tracks highest token seen
- Rejects any write with token < highest seen → cryptographic "ratchet"

### GC Pause Scenario with Fencing
1. Client 1 acquires lock, receives token 33
2. Client 1 enters GC pause
3. Lock expires, Client 2 acquires lock with token 34
4. Client 2 writes with token 34 → storage records 34
5. Client 1 wakes, tries to write with token 33 → **REJECTED** (33 < 34)

### Implementations
- ZooKeeper: `zxid` (transaction ID)
- etcd: `mod_revision`
- Consul: `ModifyIndex`

---

## Git's Atomic Ref Update Pattern

1. **Lock Creation:** `open()` with `O_CREAT | O_EXCL` flags → kernel guarantees only one succeeds (atomic)
2. **CAS Verification:** Read original ref, verify hash matches expected `<old-oid>`
3. **Write to Lock:** Write `<new-oid>` into `.lock` file
4. **Atomic Rename:** `rename(master.lock, master)` — POSIX guarantees atomic; readers see old or new, never partial

---

## Recommended Architecture: SQLite + Fencing Tokens

### Schema
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE system_state (
    id TEXT PRIMARY KEY,
    fencing_token INTEGER NOT NULL,
    state_blob TEXT NOT NULL
);

CREATE TABLE operation_journal (
    sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    operation_type TEXT NOT NULL,
    token_used INTEGER NOT NULL,
    payload TEXT NOT NULL
);
```

### TypeScript CAS with Fencing (better-sqlite3)
```typescript
function atomicCompareAndSwap(expectedToken: number, newState: any, operationType: string): boolean {
    const transaction = db.transaction(() => {
        // BEGIN IMMEDIATE — exclusive write lock before SELECT
        const current = db.prepare('SELECT fencing_token, state_blob FROM system_state WHERE id = ?').get('primary');

        if (expectedToken !== current.fencing_token) {
            throw new Error(`CAS Fencing Failure: Expected ${expectedToken}, found ${current.fencing_token}`);
        }

        const nextToken = current.fencing_token + 1;
        db.prepare('UPDATE system_state SET fencing_token = ?, state_blob = ? WHERE id = ?')
          .run(nextToken, JSON.stringify(newState), 'primary');

        db.prepare('INSERT INTO operation_journal (operation_type, token_used, payload) VALUES (?, ?, ?)')
          .run(operationType, nextToken, JSON.stringify(newState));
    });

    try { transaction(); return true; }
    catch (e) { return false; }
}
```

### Why This Succeeds
1. **No TOCTOU:** `BEGIN IMMEDIATE` locks before `SELECT`
2. **Fencing Protection:** GC pause → awakened process reads higher token → safely aborts
3. **Crash Resilience:** SQLite WAL ignores incomplete commits; restarts at last consistent state
4. **Performance:** Microsecond local SQL outpaces client/server roundtrips
