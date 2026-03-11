# FRONTEND GUIDELINES — Pythia v1 (Vault Engineering Rules)
**Version:** 1.0
**Spec Reference:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md` §8, §14.12, §15.1, §17.4, §17.17
**Date:** 2026-03-11

---

## Scope

Pythia has no browser frontend. This document covers the engineering rules for the Vault Layer — the TypeScript code that writes MADR files to the Obsidian vault. These are the rules for `src/obsidian/writer.ts` and `src/obsidian/retry.ts`.

**The Vault Layer is not the Data Layer.** SQLite is the source of truth. Obsidian is a derived projection. A failed vault write never rolls back a MADR. The MADR is committed to SQLite first; Obsidian is best-effort.

---

## Module Structure

```
src/obsidian/
├── writer.ts          # MADR file renderer + vault write
└── retry.ts           # Retry queue management
```

---

## `src/obsidian/writer.ts` Engineering Rules

### Rule 1: SQLite commits before Obsidian writes — always
```typescript
// CORRECT: Obsidian write is out-of-transaction
db.exec('COMMIT');                        // MADR safely in SQLite
await writeToObsidian(madr);              // Best-effort side effect

// WRONG: Never roll back MADR if Obsidian fails
db.exec('ROLLBACK');                      // NEVER do this on Obsidian failure
```

### Rule 2: Vault availability check before every write
```typescript
async function resolveVaultState(config: Config): Promise<VaultState> {
  if (!config.obsidian_vault_path) {
    return { state: 'unconfigured' };     // → OBSIDIAN_DISABLED, no retry
  }
  try {
    await fs.access(config.obsidian_vault_path, fs.constants.W_OK);
    return { state: 'accessible', path: config.obsidian_vault_path };
  } catch {
    return { state: 'inaccessible' };    // → OBSIDIAN_UNAVAILABLE, add to retry queue
  }
}
```

**State → behavior mapping:**
| State | Response metadata | Retry queue |
|---|---|---|
| `unconfigured` | `[METADATA: OBSIDIAN_DISABLED]` | No |
| `accessible` | (none) | No |
| `inaccessible` | `[METADATA: OBSIDIAN_UNAVAILABLE]` | Yes |

### Rule 3: Target directory is always `<vault>/Pythia/`
```typescript
const PYTHIA_SUBDIR = 'Pythia';

async function ensurePythiaDir(vaultPath: string): Promise<string> {
  const pythiaDir = path.join(vaultPath, PYTHIA_SUBDIR);
  await fs.mkdir(pythiaDir, { recursive: true });
  return pythiaDir;
}
```

Never write to vault root. Never write to `.obsidian/`. Never write outside `Pythia/`.

### Rule 4: Filename generation is deterministic and collision-free
```typescript
function buildFilename(madrId: string, title: string): string {
  const slug = title
    .normalize('NFD')                          // Unicode normalize
    .replace(/[^\x00-\x7F]/g, '')             // Strip non-ASCII
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')             // Non-alphanumeric → dash
    .replace(/^-+|-+$/g, '')                  // Trim leading/trailing dashes
    .slice(0, 64)                              // Max 64 chars
    || 'untitled';                             // Fallback for empty slug
  return `${madrId}-${slug}.md`;             // e.g., MADR-012-auth-strategy.md
}
```

### Rule 5: Frontmatter is generated from `pythia_memories` row directly
```typescript
function renderFrontmatter(madr: PythiaMemory): string {
  const drivers = JSON.parse(madr.decision_drivers) as string[];
  const options = JSON.parse(madr.considered_options) as string[];
  return [
    '---',
    `madr_id: ${madr.id}`,
    `title: ${madr.title}`,
    `status: ${madr.status}`,
    `timestamp: ${madr.timestamp}`,
    `generation_id: ${madr.generation_id}`,
    `context_and_problem: |`,
    ...madr.context_and_problem.split('\n').map(l => `  ${l}`),
    `decision_drivers:`,
    ...drivers.map(d => `  - ${d}`),
    `considered_options:`,
    ...options.map(o => `  - ${o}`),
    `decision_outcome: |`,
    ...madr.decision_outcome.split('\n').map(l => `  ${l}`),
    `supersedes_madr: ${madr.supersedes_madr ?? ''}`,
    '---',
  ].join('\n');
}
```

### Rule 6: Wikilinks are generated for `impacts_files`
```typescript
function renderAffectedFiles(impactsFiles: string[]): string {
  if (impactsFiles.length === 0) return '';
  const links = impactsFiles.map(f => `[[${f}]]`).join(', ');
  return `*Files affected: ${links}*`;
}
```

### Rule 7: Never read from Obsidian
The vault writer module has no read operations. No directory scans. No file existence checks beyond the vault accessibility check. Pythia is write-only to the vault.

---

## `src/obsidian/retry.ts` Engineering Rules

### Rule 8: Queue file path is always `<repo>/.pythia/obsidian-retry-queue.json`
```typescript
const RETRY_QUEUE_FILENAME = 'obsidian-retry-queue.json';

function getQueuePath(workspacePath: string): string {
  return path.join(workspacePath, '.pythia', RETRY_QUEUE_FILENAME);
}
```

### Rule 9: All queue writes use atomic replace (fsync + rename)
```typescript
async function writeQueue(queuePath: string, queue: RetryQueue): Promise<void> {
  const tmpPath = `${queuePath}.tmp`;
  const json = JSON.stringify(queue, null, 2);
  await fs.writeFile(tmpPath, json, 'utf8');
  const fd = await fs.open(tmpPath, 'r+');
  await fd.datasync();                          // fsync before rename
  await fd.close();
  await fs.rename(tmpPath, queuePath);          // Atomic rename
}
```

### Rule 10: Corrupt queue file is renamed, not deleted
```typescript
async function loadQueue(queuePath: string): Promise<RetryQueue> {
  try {
    const raw = await fs.readFile(queuePath, 'utf8');
    return JSON.parse(raw) as RetryQueue;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Corrupt: rename and start fresh
      await fs.rename(queuePath, `${queuePath}.corrupt`);
    }
    return { jobs: [] };
  }
}
```

### Rule 11: Queue job schema
```typescript
interface RetryJob {
  madr_id: string;
  filename: string;
  content: string;         // Full rendered markdown (frontmatter + body)
  queued_at: string;       // ISO8601
  attempt_count: number;   // Starts at 0
  next_attempt_at: string; // ISO8601
}

interface RetryQueue {
  jobs: RetryJob[];
}
```

### Rule 12: Retry backoff schedule (max 5 attempts, then drop)
```typescript
const BACKOFF_MINUTES = [1, 5, 15, 30, 60];  // Attempt 1, 2, 3, 4, 5

function getNextAttemptTime(attemptCount: number): string {
  const waitMinutes = BACKOFF_MINUTES[attemptCount] ?? null;
  if (waitMinutes === null) return 'EXPIRED';  // Past max attempts
  const next = new Date(Date.now() + waitMinutes * 60 * 1000);
  return next.toISOString();
}

// After 5 attempts (attemptCount === 5): remove job from queue silently
```

### Rule 13: Retry loop runs in MCP server Main Thread via `setInterval`
```typescript
// In MCP server startup (src/index.ts):
const RETRY_INTERVAL_MS = 60_000;  // Check every 60 seconds

const retryInterval = setInterval(async () => {
  await retryPendingObsidianWrites(config);
}, RETRY_INTERVAL_MS);

// On MCP server shutdown:
clearInterval(retryInterval);
```

The retry loop is non-blocking (async). It does not run in the Worker Thread. It does not affect SQLite write operations.

### Rule 14: Replay on boot before tool registration
```typescript
// In pythia start / MCP server initialization:
await loadAndReplayRetryQueue(config);  // Load queue, attempt pending jobs
await registerMcpTools(server);         // Only then register tools
```

---

## Output Format Rules (MCP Response Body)

### Rule 15: Non-fatal metadata is a plain-text prefix line
```typescript
function prependMetadata(code: string, body: string): string {
  return `[METADATA: ${code}]\n\n${body}`;
}

// Examples:
// prependMetadata('OBSIDIAN_DISABLED', 'MADR-012')
// → '[METADATA: OBSIDIAN_DISABLED]\n\nMADR-012'

// prependMetadata('VECTOR_INDEX_STALE', chunkBlocks)
// → '[METADATA: VECTOR_INDEX_STALE]\n\n--- CHUNK 1 score=0.92\n...'
```

### Rule 16: Multiple non-fatal codes stack
```typescript
// Stacking is additive, each on its own line:
'[METADATA: VECTOR_INDEX_STALE]\n[METADATA: RERANKER_UNAVAILABLE]\n\n{body}'
```

### Rule 17: Fatal errors use JSON-RPC error objects, never response body
```typescript
// CORRECT: Fatal error
throw new McpError(ErrorCodes.INVALID_PATH.code, ErrorCodes.INVALID_PATH.message, {
  error_code: 'INVALID_PATH',
  detail: `Path '${inputPath}' does not exist or is outside workspace root`,
});

// WRONG: Never embed fatal errors in the response body
return `[ERROR: INVALID_PATH] ...`;  // Never do this
```

---

## Supersedes Chain Rendering

When `supersedes_madr` is provided:

```markdown
> ⚠️ This decision supersedes [[MADR-007-session-cookie-strategy]]
```

This notice is inserted after the `# MADR-{N} — {title}` heading and before `## Context and Problem`.

The superseded MADR's file is NOT updated by Pythia (Pythia only writes new files). The `status: superseded` field in the superseded MADR's frontmatter is updated via a file overwrite of the existing MADR file.

**Overwrite rule for superseded MADR:** When `status` changes to `superseded`, Pythia rewrites the existing MADR file with updated frontmatter (`status: superseded`) and adds a notice at the top of the body:

```markdown
> ~~This decision has been superseded by [[MADR-012-auth-middleware-strategy]]~~
```
