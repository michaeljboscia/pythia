# BACKEND STRUCTURE — Pythia v1
**Version:** 2.0 (Full Merged System)
**Supersedes:** BACKEND_STRUCTURE.md (oracle engine only)
**Spec Reference:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md`
**Date:** 2026-03-11

---

## Database: `.pythia/lcs.db`

Single SQLite file. All tables, virtual tables, and indexes live here.

### Connection Pragma Set (MANDATORY — every connection, before any read/write)
```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;
```

---

## Table Definitions

### 1. `lcs_chunks` — Raw Code Chunks (Durable)
```sql
CREATE TABLE lcs_chunks (
    id TEXT PRIMARY KEY,           -- CNI: e.g., 'src/auth.ts::function::login'
    file_path TEXT NOT NULL,
    chunk_type TEXT NOT NULL,      -- 'function'|'class'|'method'|'interface'|'type'|'enum'|'namespace'|'module'|'doc'
    content TEXT NOT NULL,         -- Raw source code / markdown text
    start_line INTEGER,            -- 0-based (Tree-sitter AST node start)
    end_line INTEGER,              -- 0-based (Tree-sitter AST node end)
    is_deleted BOOLEAN DEFAULT 0,  -- Soft delete tombstone
    deleted_at TEXT NULL,          -- ISO8601 — set when is_deleted=1; NULL when live
    content_hash TEXT NOT NULL     -- 'algo:digest' e.g. 'blake3:abc123...' or 'sha256:def456...'
);
```

**chunk_type taxonomy:**
| Value | Source | CNI Pattern |
|---|---|---|
| `function` | Tree-sitter | `<path>::function::<name>` |
| `class` | Tree-sitter | `<path>::class::<name>` |
| `method` | Tree-sitter | `<path>::class::<ClassName>::method::<name>` |
| `interface` | Tree-sitter | `<path>::interface::<name>` |
| `type` | Tree-sitter | `<path>::type::<name>` |
| `enum` | Tree-sitter | `<path>::enum::<name>` |
| `namespace` | Tree-sitter | `<path>::namespace::<name>` |
| `module` | Tree-sitter | `<path>::module::default` |
| `doc` | File-level | `<path>::doc::<heading-slug>#L<line>` OR `<path>::doc::default` |

**CNI special cases:**
- Overloads: append `#L<line>` (e.g., `src/auth.ts::function::login#L45`)
- Anonymous: `#anonymous_L<line>` or `#default` for default exports
- `doc` with no heading: `<path>::doc::default`

---

### 2. `vec_lcs_chunks` — Vector Index (Derived — Rebuildable)
```sql
CREATE VIRTUAL TABLE vec_lcs_chunks USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[256]           -- 256d Matryoshka-truncated from nomic-embed-text-v1.5
);
```

---

### 3a. `fts_lcs_chunks_kw` — Keyword FTS Index (Derived — Rebuildable)
```sql
CREATE VIRTUAL TABLE fts_lcs_chunks_kw USING fts5(
    id UNINDEXED,
    content,
    tokenize="unicode61 tokenchars '._:/#<>?!-'"
);
```
Purpose: Exact symbol matching (`AuthManager.login`, `src/auth.ts`, `function::login`)

---

### 3b. `fts_lcs_chunks_sub` — Trigram FTS Index (Derived — Rebuildable)
```sql
CREATE VIRTUAL TABLE fts_lcs_chunks_sub USING fts5(
    id UNINDEXED,
    content,
    tokenize="trigram"
);
```
Purpose: Substring/path/CNI fallback queries

---

### 4. `file_scan_cache` — Per-File CDC State (Durable)
```sql
CREATE TABLE file_scan_cache (
    file_path TEXT PRIMARY KEY,
    mtime_ns INTEGER NOT NULL,     -- File mtime in nanoseconds
    size_bytes INTEGER NOT NULL,
    content_hash TEXT NOT NULL,    -- 'algo:digest' of last-indexed content
    last_scanned_at TEXT NOT NULL  -- ISO8601
);
```

**CDC Authority:** `file_scan_cache` is the authoritative CDC signal. `lcs_chunks.content_hash` is per-chunk and may be stale after soft-delete. Never use `lcs_chunks` for CDC decisions.

**Update timing:** Inside the same SQLite sync transaction, after chunk operations and immediately before COMMIT.

---

### 5. `pythia_memories` — Episodic Memory / MADRs (Durable)
```sql
CREATE TABLE pythia_memories (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,  -- Internal sequence; source of MADR numbering
    id TEXT NOT NULL UNIQUE,               -- e.g., 'MADR-012' = printf('MADR-%03d', seq)
    generation_id INTEGER NOT NULL,        -- Reconstitution epoch (increments on new generation)
    timestamp TEXT NOT NULL,               -- ISO8601
    status TEXT NOT NULL,                  -- 'accepted' | 'superseded'
    title TEXT NOT NULL,
    context_and_problem TEXT NOT NULL,
    decision_drivers TEXT NOT NULL,        -- JSON array of strings
    considered_options TEXT NOT NULL,      -- JSON array of strings
    decision_outcome TEXT NOT NULL,
    supersedes_madr TEXT,                  -- MADR id this supersedes (if any)
    FOREIGN KEY(supersedes_madr) REFERENCES pythia_memories(id)
);
```

**MADR ID generation (atomic):**
```sql
BEGIN IMMEDIATE;
INSERT INTO pythia_memories (id, ...) VALUES (printf('MADR-%03d', (SELECT COALESCE(MAX(seq),0)+1 FROM pythia_memories)), ...);
-- OR use last_insert_rowid() after insert:
INSERT INTO pythia_memories (seq=AUTOINCREMENT_VALUE, id=NULL, ...);
UPDATE pythia_memories SET id = printf('MADR-%03d', last_insert_rowid()) WHERE rowid = last_insert_rowid();
COMMIT;
```
`COUNT(*) + 1` is FORBIDDEN. Always use `AUTOINCREMENT`.

---

### 6. `pythia_sessions` — Oracle Sessions (Durable)
```sql
CREATE TABLE pythia_sessions (
    id TEXT PRIMARY KEY,                   -- UUID v4 (opaque, all foreign keys use this)
    name TEXT NOT NULL,                    -- Human-readable (e.g., 'auth-refactor')
    status TEXT NOT NULL,                  -- 'active' | 'idle' | 'dead' | 'decommissioned'
    decommission_hash TEXT,                -- Argon2id hash of decommission secret (NULL if decommissioned)
    decommission_salt TEXT,                -- Argon2id salt (NULL if decommissioned)
    created_at TEXT NOT NULL,              -- ISO8601
    updated_at TEXT NOT NULL               -- ISO8601
);

-- Partial unique index: name reuse allowed after decommission
CREATE UNIQUE INDEX idx_pythia_sessions_active_name
    ON pythia_sessions(name)
    WHERE status IN ('active', 'idle');
```

**Session status lifecycle:**
- `active` → provider is live (KV cache or CLI process running)
- `idle` → provider dismissed by reaper; session can be reactivated via spawn
- `dead` → provider state lost unexpectedly (MCP crash, AUTH_INVALID); cannot resume safely
- `decommissioned` → intentional secure wipe; transcripts deleted; fields cleared

**Decommission secret contract:**
- Generated: 128-bit random via `crypto.randomBytes(16)`, encoded as 32-char lowercase hex
- Returned: once only in `spawn_oracle` response when `created: true`
- Stored: Argon2id hash + salt (never the plaintext)
- Verification phrase: `DECOMMISSION <session_id> <32-char-hex>`
- Argon2id params: memory_cost=65536 KiB, time_cost=3, parallelism=1

---

### 7. `pythia_transcripts` — Temporal Event Log (Durable, wiped on decommission)
```sql
CREATE TABLE pythia_transcripts (
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    role TEXT NOT NULL,            -- 'user' | 'model' | 'system' | 'tool'
    content TEXT NOT NULL,         -- Role-specific JSON (see below)
    timestamp TEXT NOT NULL,       -- ISO8601
    PRIMARY KEY (session_id, turn_index),
    FOREIGN KEY(session_id) REFERENCES pythia_sessions(id) ON DELETE CASCADE
);
```

**Content schemas by role:**
```typescript
// 'user'
{ "text": string }

// 'model'
{ "text": string, "provider": string, "model": string, "finish_reason": string,
  "usage"?: { "input_tokens": number, "output_tokens": number } }

// 'system' (kind values: "spawn_preamble" | "reaper_notice" | "context_trim_notice")
{ "kind": string, "text": string, "metadata"?: object }

// 'tool'
{ "tool_name": string, "tool_call_id": string, "input": object,
  "output": object|null, "status": "success"|"error", "error_code"?: string, "duration_ms": number }
```

**Write-ahead contract:** User row written BEFORE provider call. Model row written AFTER success. Gap tolerance: `SELECT MAX(turn_index)` on boot; continue from `MAX() + 1`.

**NOT replayed during session reconstitution.** Transcripts are offline audit log only.

**ON DELETE CASCADE:** Safety net only. No normative code path hard-deletes a session row. `oracle_decommission` explicitly hard-deletes transcripts with `DELETE FROM pythia_transcripts WHERE session_id=?`.

---

### 8. `graph_edges` — Polymorphic Knowledge Graph (Derived — Rebuildable)
```sql
CREATE TABLE graph_edges (
    source_id TEXT NOT NULL,       -- CNI or MADR id
    target_id TEXT NOT NULL,       -- CNI or MADR id
    edge_type TEXT NOT NULL,       -- 'CALLS'|'IMPORTS'|'CONTAINS'|'IMPLEMENTS'|'RE_EXPORTS'
    PRIMARY KEY (source_id, target_id, edge_type)
);
CREATE INDEX idx_graph_edges_target ON graph_edges(target_id, edge_type);
```

**Edge taxonomy:**
| Type | Source | Target | Inserted by |
|---|---|---|---|
| `IMPORTS` | `module` | `module` | Slow Path (tsserver) |
| `CALLS` | `function/method` | `function/method` | Slow Path (tsserver) |
| `CONTAINS` | `module` or `class` | `function/class/method` | Fast Path (same transaction as chunk) |
| `IMPLEMENTS` | MADR id | `module` | `oracle_commit_decision` |
| `RE_EXPORTS` | `module` (barrel) | `function/class` (canonical) | Slow Path (tsserver) |

**BEFORE INSERT trigger (canonical SQL — §17.15):**
```sql
CREATE TRIGGER trg_graph_edges_validate_before_insert
BEFORE INSERT ON graph_edges
FOR EACH ROW
BEGIN
    SELECT CASE
        WHEN
            NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.source_id)
            AND
            NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.source_id)
        THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT')
    END;

    SELECT CASE
        WHEN
            NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.target_id)
            AND
            NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.target_id)
        THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT')
    END;
END;
```

**Edge deletion rules:**
- On chunk soft-delete: `DELETE FROM graph_edges WHERE source_id=? OR target_id=?` (inside sync transaction)
- `RE_EXPORTS` edges: deleted immediately inside sync transaction when source/target soft-deleted
- GC runs after sync batches (not for RE_EXPORTS)

---

### 9. `embedding_meta` — Model Version Pinning (Singleton)
```sql
CREATE TABLE embedding_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton enforced
    provider TEXT NOT NULL,                  -- e.g., 'huggingface'
    model_name TEXT NOT NULL,               -- e.g., 'nomic-embed-text-v1.5'
    model_revision TEXT NOT NULL,           -- Pinned revision hash
    dimensions INTEGER NOT NULL,            -- 256 (default stack)
    normalization TEXT NOT NULL,            -- e.g., 'cosine'
    indexed_at TEXT NOT NULL               -- ISO8601 of last successful full build
);
```

**Contract:** Row absent = vector index uninitialized. Row inserted only after first successful full vector build (in same COMMIT). On startup, if runtime fingerprint ≠ stored: serve FTS-only, prepend `[METADATA: VECTOR_INDEX_STALE]`, rebuild vector index in background.

---

## Atomic Sync Contract

All indexing writes for a file occur inside a single SQLite transaction:

```typescript
db.exec('BEGIN TRANSACTION');
try {
  // 1. Soft-delete old chunks
  db.run('UPDATE lcs_chunks SET is_deleted=1, deleted_at=? WHERE file_path=?', [now, file]);

  // 2. Delete stale derived index rows
  for (const staleId of staleChunkIds) {
    db.run('DELETE FROM vec_lcs_chunks WHERE id=?', [staleId]);
    db.run('DELETE FROM fts_lcs_chunks_kw WHERE id=?', [staleId]);
    db.run('DELETE FROM fts_lcs_chunks_sub WHERE id=?', [staleId]);
    db.run('DELETE FROM graph_edges WHERE source_id=? OR target_id=?', [staleId, staleId]);
  }

  // 3. Insert new chunks + derived rows
  for (const chunk of newChunks) {
    db.run('INSERT INTO lcs_chunks ...', [...]);
    db.run('INSERT INTO vec_lcs_chunks ...', [...]);
    db.run('INSERT INTO fts_lcs_chunks_kw ...', [...]);
    db.run('INSERT INTO fts_lcs_chunks_sub ...', [...]);
  }

  // 4. Insert CONTAINS edges (Fast Path only)
  for (const edge of containsEdges) {
    db.run('INSERT INTO graph_edges ...', [...]);
  }

  // 5. Update file_scan_cache (immediately before COMMIT)
  db.run('UPDATE file_scan_cache SET mtime_ns=?, content_hash=?, last_scanned_at=? WHERE file_path=?', [...]);

  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
```

---

## Retrieval Pipeline

### Hybrid Search (lcs_investigate, intent: "semantic")
```
vector search: SELECT top-30 from vec_lcs_chunks ORDER BY cosine_distance
fts kw search: SELECT top-30 from fts_lcs_chunks_kw WHERE content MATCH ?
  └→ Zero hits: try fts_lcs_chunks_sub (trigram fallback, if query has CNI/path punctuation or quotes)

RRF fusion:
  score = wv/(60 + rank_vec) + wf/(60 + rank_fts)
  semantic weights: wv=0.7, wf=0.3

Cross-encoder re-rank: top-12 candidates → Xenova/ms-marco-MiniLM-L-6-v2
  truncation='only_second', max 512 tokens per passage
  ≤150ms target, hard fallback at 250ms (serve RRF order, prepend RERANKER_UNAVAILABLE)

Score normalization: sigmoid(cross_encoder_logit) → 0.0-1.0 float
```

### Graph Traversal (lcs_investigate, intent: "structural")
```sql
-- Bidirectional BFS CTE, depth ≤6, cycle detection
WITH RECURSIVE traversal(node_id, depth, path) AS (
  -- Seed: starting node
  SELECT ?, 0, ?
  UNION ALL
  -- Outbound edges
  SELECT ge.target_id, t.depth + 1, t.path || ',' || ge.target_id
  FROM graph_edges ge
  JOIN traversal t ON ge.source_id = t.node_id
  WHERE t.depth < 6 AND INSTR(t.path, ge.target_id) = 0
  UNION ALL
  -- Inbound edges
  SELECT ge.source_id, t.depth + 1, t.path || ',' || ge.source_id
  FROM graph_edges ge
  JOIN traversal t ON ge.target_id = t.node_id
  WHERE t.depth < 6 AND INSTR(t.path, ge.source_id) = 0
)
SELECT DISTINCT node_id, MIN(depth) as min_depth FROM traversal
ORDER BY min_depth LIMIT 50;
```

Output: §14.13 block format with `[DEPTH:N via EDGE_TYPE]` prefix per block, 50-node BFS cap.

---

## MCP Tool API Contracts

### `lcs_investigate`
```typescript
Input:  { query: string; intent: "semantic" | "structural" }
Output: string (plain-text blocks, §14.13 format)
Errors: (none — zero results expressed in body as [METADATA: NO_MATCH] or [METADATA: INDEX_EMPTY])
```

### `pythia_force_index`
```typescript
Input:  { path?: string }  // repo-relative; omit for full workspace
Output: string (success message or [STATUS: INDEX_MERGED])
Errors: INVALID_PATH (-32060)
```

### `spawn_oracle`
```typescript
Input:  { session_name: string; initial_context_query: string }
Output: string (JSON: {"session_id":"<uuid>","status":"active","created":bool,
                        "generation_id":N,"decommission_secret":"<32-hex>"?})
Errors: SESSION_ALREADY_ACTIVE (-32020), CONFIG_INVALID (-32010)
```

### `ask_oracle`
```typescript
Input:  { session_id: string; message: string; additional_context_query?: string }
Output: string (provider response)
Errors: SESSION_NOT_FOUND (-32020), SESSION_BUSY (-32020), PROVIDER_UNAVAILABLE (-32040),
        CONTEXT_BUDGET_EXCEEDED (-32040), AUTH_INVALID (-32010)
```

### `oracle_commit_decision`
```typescript
Input:  { title: string; problem: string; drivers: string[]; options: string[];
          decision: string; impacts_files: string[]; supersedes_madr?: string }
Output: string ("MADR-012" + optional non-fatal metadata)
Errors: INVALID_GRAPH_ENDPOINT (-32060), SESSION_NOT_FOUND (-32020)
Non-fatal: [METADATA: OBSIDIAN_DISABLED], [METADATA: OBSIDIAN_UNAVAILABLE]
```

### `oracle_decommission`
```typescript
Input:  { session_id: string; verification_phrase: string }
Output: string (success message)
Errors: SESSION_NOT_FOUND (-32020), AUTH_INVALID (-32010)
```

---

## Error Registry (`src/errors.ts`)

```typescript
export const ErrorCodes = {
  // Auth/Config: -32010 to -32019
  AUTH_INVALID:        { code: -32010, message: 'Authentication failed' },
  CONFIG_INVALID:      { code: -32011, message: 'Configuration invalid' },

  // Session: -32020 to -32039
  SESSION_ALREADY_ACTIVE: { code: -32020, message: 'A session is already active' },
  SESSION_BUSY:           { code: -32021, message: 'Session queue full' },
  SESSION_NOT_FOUND:      { code: -32022, message: 'Session not found' },

  // Provider/Context: -32040 to -32059
  PROVIDER_UNAVAILABLE:    { code: -32040, message: 'Reasoning provider unavailable' },
  CONTEXT_BUDGET_EXCEEDED: { code: -32041, message: 'Context budget exceeded' },

  // Indexing/Storage: -32060 to -32089
  INVALID_GRAPH_ENDPOINT: { code: -32060, message: 'Invalid graph endpoint' },
  INDEX_BATCH_FAILED:     { code: -32061, message: 'Index batch failed' },
  FULL_REINDEX_REQUIRED:  { code: -32062, message: 'Full reindex required' },
  INVALID_PATH:           { code: -32063, message: 'Path is invalid or outside workspace' },
} as const;

// Non-fatal metadata codes (prepended to success response body)
export const MetadataCodes = {
  OBSIDIAN_DISABLED:      '[METADATA: OBSIDIAN_DISABLED]',
  OBSIDIAN_UNAVAILABLE:   '[METADATA: OBSIDIAN_UNAVAILABLE]',
  INDEX_ALREADY_RUNNING:  '[STATUS: INDEX_MERGED]',
  RERANKER_UNAVAILABLE:   '[METADATA: RERANKER_UNAVAILABLE]',
  VECTOR_INDEX_STALE:     '[METADATA: VECTOR_INDEX_STALE]',
  SLOW_PATH_DEGRADED:     '[METADATA: SLOW_PATH_DEGRADED]',
  INDEX_EMPTY:            '[METADATA: INDEX_EMPTY]',
  NO_MATCH:               '[METADATA: NO_MATCH]',
} as const;
```

---

## Worker Thread Message Protocol (§17.15)

```typescript
// Main → Worker
type MainToWorker =
  | { type: 'INDEX_BATCH'; batch_id: string; files: string[]; reason: 'boot'|'warm'|'force' }
  | { type: 'PAUSE'; batch_id?: string }
  | { type: 'RESUME' }
  | { type: 'DIE' }           // Only on MCP server SIGTERM — NOT from inactivity reaper
  | { type: 'PING' }

// Worker → Main
type WorkerToMain =
  | { type: 'ACK'; ack: 'INDEX_BATCH'|'PAUSE'|'RESUME'|'DIE'|'PING'; batch_id?: string }
  | { type: 'BATCH_STARTED'; batch_id: string; total_files: number }
  | { type: 'BATCH_COMPLETE'; batch_id: string; succeeded: number; failed: number; duration_ms: number }
  | { type: 'FILE_FAILED'; batch_id: string; file: string; error_code: string; detail: string }
  | { type: 'PAUSED'; batch_id?: string }
  | { type: 'HEARTBEAT'; batch_id?: string; timestamp: string; in_flight_file?: string }
  | { type: 'FATAL'; batch_id?: string; error_code: string; detail: string }
```

**DIE behavior:** Worker finishes current file, commits active SQLite transaction, sends `ACK: DIE`, then exits. No mid-file abort.

---

## Config Schema (Zod-validated)

```typescript
import { z } from 'zod';

export const ConfigSchema = z.object({
  workspace_path: z.string(),
  obsidian_vault_path: z.string().optional(),
  reasoning: z.object({
    mode: z.enum(['cli', 'sdk']),
    gemini_api_key: z.string().optional(),
  }),
  embeddings: z.object({
    mode: z.enum(['local', 'voyage']),
    model: z.string(),
    revision: z.string(),
  }),
  vector_store: z.object({
    mode: z.enum(['sqlite', 'qdrant']),
    qdrant_url: z.string().optional(),
  }),
  graph_store: z.object({
    mode: z.enum(['sqlite', 'falkor']),
  }),
  limits: z.object({
    spawn_chars_max: z.number().default(180000),
    ask_context_chars_max: z.number().default(48000),
    session_idle_ttl_minutes: z.number().default(30),
  }),
  indexing: z.object({
    scan_on_start: z.boolean().default(true),
    max_worker_restarts: z.number().default(3),
  }),
  gc: z.object({
    deleted_chunk_retention_days: z.number().default(30),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
```

---

## Obsidian Vault Structure

```
<repo>/Pythia/
├── MADR-001-initial-architecture-decision.md
├── MADR-002-database-schema-choice.md
├── MADR-003-embedding-model-selection.md
└── ...
```

**YAML frontmatter (Dataview-compatible):**
```yaml
---
madr_id: MADR-012
title: Authentication Middleware Strategy
status: accepted        # or 'superseded'
timestamp: 2026-03-11T02:00:00Z
generation_id: 1
context_and_problem: |
  [multi-line text]
decision_drivers:
  - Performance under high concurrency
  - Security compliance
considered_options:
  - JWT with refresh tokens
  - Session cookies
  - OAuth2 PKCE
decision_outcome: JWT with short TTL + refresh token rotation
supersedes_madr:        # null or MADR-xxx
---
```

**Slug rules:** Lowercase ASCII, Unicode-normalized, non-alphanumeric runs → `-`, trimmed, max 64 chars. Empty title → `untitled`.

---

## Migration Runner Contract

**Location:** `src/migrations/NNN-description.sql` (bundled in npm package)
**Format:** Each file is a standalone SQL script (no UP/DOWN — forward-only)
**Tracking:** `CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT)`
**Lifecycle hooks where migrations run:**
1. `pythia init` — first boot
2. `pythia start` — MCP server launch
3. MCP server connection open — per client attach (no-op if current)

**Migration policy:**
- Durable tables (`lcs_chunks`, `pythia_memories`, `pythia_sessions`, `pythia_transcripts`): always migrate in-place with `ALTER TABLE` / `CREATE INDEX`
- Derived tables (`vec_lcs_chunks`, `fts_lcs_chunks_*`, `graph_edges`): may be dropped and rebuilt
