# TECH STACK — Pythia v1
**Version:** 2.0 (Full Merged System)
**Supersedes:** TECH_STACK.md (oracle engine only)
**Spec Reference:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md`
**Date:** 2026-03-11

---

## Runtime

| Component | Value |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5.x |
| Module system | ESM (`"type": "module"` in package.json) |
| Package name | `@pythia/lcs` |
| Distribution | `npm install -g @pythia/lcs` |
| Min Node version | 22 (required for `fs.globSync`, native `fetch`) |

---

## Core Dependencies (version-locked)

### MCP Protocol
| Package | Version | Purpose |
|---|---|---|
| `@modelcontextprotocol/sdk` | latest stable | MCP server transport + tool registration |

### Database
| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | ^9.x | Synchronous SQLite driver (required for Worker Thread usage) |
| `@types/better-sqlite3` | ^9.x | TypeScript types |

### Vector Extension
| Package | Version | Purpose |
|---|---|---|
| `sqlite-vec` | latest stable | sqlite-vec extension for `vec0` virtual table |

### Machine Learning (ONNX Runtime)
| Package | Version | Purpose |
|---|---|---|
| `@huggingface/transformers` | ^3.x (transformers.js) | ONNX runtime for embeddings + cross-encoder |

**Embedding model:** `nomic-embed-text-v1.5` (ONNX)
- Dimensions: 768d native, truncated to **256d** (Matryoshka slice of first 256 floats)
- Download: HuggingFace Hub, cached to `~/.pythia/models/`

**Cross-encoder model:** `Xenova/ms-marco-MiniLM-L-6-v2` (ONNX)
- Input: `(query, passage)` pairs. `truncation='only_second'`, max 512 tokens
- Latency target: ≤150ms per 12-candidate window. Hard fallback at 250ms.
- Download: lazy, on first `lcs_investigate` call, cached to `~/.pythia/models/`

### Hashing / Cryptography
| Package | Version | Purpose |
|---|---|---|
| `hash-wasm` | ^4.x | BLAKE3 (WASM) for file CDC + Argon2id for decommission secret |
| Node.js `crypto` (built-in) | — | SHA-256 fallback if WASM fails; UUID v4 generation |

**Hash format:** `algo:digest` stored in `content_hash` column (e.g., `blake3:abc123...`, `sha256:def456...`)
**Argon2id parameters:** memory_cost=65536 KiB, time_cost=3, parallelism=1, hash_length=32, salt_length=16

### Tree-sitter (Fast Path)
| Package | Version | Purpose |
|---|---|---|
| `node-tree-sitter` | ^0.21.x | Tree-sitter Node.js bindings |
| `tree-sitter-typescript` | latest | TypeScript + TSX grammar (`.ts`, `.tsx`) |
| `tree-sitter-javascript` | latest | JavaScript + JSX grammar (`.js`, `.jsx`, `.mjs`, `.cjs`) |
| `tree-sitter-python` | latest | Python grammar (`.py`) |
| `tree-sitter-go` | latest | Go grammar (`.go`) |
| `tree-sitter-rust` | latest | Rust grammar (`.rs`) |
| `tree-sitter-java` | latest | Java grammar (`.java`) |
| `tree-sitter-php` | latest | PHP + PHTML grammar (`.php`, `.phtml`) — **Sprint 6** |
| `tree-sitter-xml` | latest | XML grammar (`.xml`) — **Sprint 6** |
| `tree-sitter-sql` | latest | SQL grammar (`.sql`) — **Sprint 6** |
| `tree-sitter-css` | latest | CSS + SCSS grammar (`.css`, `.scss`) — **Sprint 6** |

### Concurrency
| Package | Version | Purpose |
|---|---|---|
| `p-limit` | ^6.x (ESM) | Concurrent HTTP embedding request cap — **Sprint 6** |

### TypeScript Compiler (Slow Path)
| Component | Version | Purpose |
|---|---|---|
| TypeScript | ^5.x | `tsserver` process — `LanguageService.getDefinitionAtPosition()` |

**`tsserver` usage:** Long-lived per-workspace process, owned by Worker Thread. Inferred-project mode for repos without `tsconfig.json`. Supports `.js`, `.jsx`, `.ts`, `.tsx`.

### File System / Ignore
| Package | Version | Purpose |
|---|---|---|
| `ignore` | ^5.x | Full nested `.gitignore` semantics (including subdirectory `.gitignore` files) |
| `fast-glob` | ^3.x | File enumeration with gitignore-pattern exclusions |

### Config Validation
| Package | Version | Purpose |
|---|---|---|
| `zod` | ^3.x | Runtime validation of `~/.pythia/config.json` at startup |

### CLI Framework
| Package | Version | Purpose |
|---|---|---|
| `commander` | ^12.x | CLI command parsing (`pythia init`, `pythia start`, `pythia mcp install`) |

### UUID
| Package | Version | Purpose |
|---|---|---|
| Node.js `crypto.randomUUID()` (built-in) | — | UUID v4 for `pythia_sessions.id` |

---

## Premium Stack Dependencies (optional)

| Package | Version | Purpose | Trigger |
|---|---|---|---|
| `@qdrant/js-client-rest` | latest | Qdrant vector store client | `vector_store.mode = "qdrant"` |
| `@google/genai` | latest | Gemini SDK (fast KV cache) | `reasoning.mode = "sdk"` |
| Python 3.11+ | system | FalkorDB sidecar runtime | `graph_store.mode = "falkor"` |
| FalkorDBLite | Python pip | Embedded graph database | `graph_store.mode = "falkor"` |

**FalkorDB integration:** Python sidecar managed via `child_process.spawn()`, TCP/HTTP socket, accessed through `GraphStore` adapter. Starts/stops with MCP server lifecycle.

---

## Config Schema (`~/.pythia/config.json`)

Validated at startup via Zod. Missing required fields = hard startup error.

```typescript
{
  workspace_path: string,                        // Required: absolute path to repo root
  obsidian_vault_path?: string,                  // Optional: absolute path to Obsidian vault
  reasoning: {
    mode: "cli" | "sdk",                         // "cli" = Gemini CLI hack, "sdk" = SDK
    gemini_api_key?: string                      // Required if mode = "sdk"
  },
  embeddings: {
    mode: "local" | "openai_compatible" | "vertex_ai",
    dimensions: 128 | 256 | 512 | 768 | 1024 | 1536,  // Default: 256 — Sprint 6
    // openai_compatible fields:
    base_url?: string,
    api_key?: string,
    model?: string,
    // vertex_ai fields:
    project?: string,
    location?: string,
    // retry (openai_compatible + vertex_ai):
    retry_max_attempts?: number,                 // Default: 3
    initial_backoff_ms?: number,                 // Default: 500
    honor_retry_after?: boolean                  // Default: true
  },
  indexing: {
    scan_on_start: boolean,                      // Default: false
    max_worker_restarts: number,                 // Default: 3 (within 10 min window)
    embedding_concurrency: number,               // Default: 1 (max 16) — Sprint 6
    embedding_batch_size: number,                // Default: 32 (max 256) — Sprint 6
    css_rule_chunk_min_chars: number,            // Default: 80 — Sprint 6
    max_chunk_chars: Record<string, number>,     // Per-type map, defaults per spec — Sprint 6
    oversize_strategy: "split" | "truncate"      // Default: "split" — Sprint 6
  },
  gc: {
    deleted_chunk_retention_days: number         // Default: 7
  }
}
```

---

## File Structure

```
~/.pythia/
├── config.json          # Global Pythia config (Zod-validated)
└── models/              # ONNX model cache
    ├── nomic-embed-text-v1.5/
    └── Xenova--ms-marco-MiniLM-L-6-v2/

<repo>/.pythia/
├── lcs.db                          # The unified SQLite database
└── obsidian-retry-queue.json       # Persisted Obsidian write retry jobs

<repo>/Pythia/                      # Obsidian vault output (if configured)
├── MADR-001-auth-strategy.md
├── MADR-002-database-schema.md
└── ...

src/
├── index.ts             # MCP server entry point
├── errors.ts            # Canonical error code registry
├── config.ts            # Config loading + Zod validation
├── mcp/
│   ├── tools.ts         # MCP tool registration
│   ├── lcs-investigate.ts
│   ├── force-index.ts
│   ├── spawn-oracle.ts
│   ├── ask-oracle.ts
│   ├── commit-decision.ts
│   └── decommission.ts
├── db/
│   ├── schema.ts        # Table creation helpers
│   ├── migrate.ts       # Migration runner
│   └── gc.ts            # GC logic
├── migrations/          # Forward-only SQL migration files
│   ├── 001-initial-schema.sql
│   └── ...
├── indexer/
│   ├── worker.ts        # Worker Thread (Slow Path supervisor)
│   ├── fast-path.ts     # Tree-sitter chunker + ONNX embed
│   ├── slow-path.ts     # tsserver edge extractor
│   ├── cdc.ts           # MTime/Hash file scanner
│   └── sync.ts          # Atomic sync contract
├── retrieval/
│   ├── hybrid.ts        # RRF fusion
│   ├── reranker.ts      # Cross-encoder
│   └── graph.ts         # CTE traversal
├── oracle/
│   ├── provider.ts      # ReasoningProvider interface
│   ├── cli-provider.ts  # CliReasoningProvider
│   ├── sdk-provider.ts  # SdkReasoningProvider
│   ├── session.ts       # Session lifecycle management
│   └── reaper.ts        # Inactivity reaper
├── obsidian/
│   ├── writer.ts        # MADR markdown renderer
│   └── retry.ts         # Retry queue management
└── cli/
    ├── main.ts          # commander entry point
    ├── init.ts          # pythia init
    ├── start.ts         # pythia start
    └── mcp-install.ts   # pythia mcp install
```

---

## SQLite Connection Pragma Set

Every connection (Thread 0 and Thread 1) executes immediately after open:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;
```

---

## Cost Estimates

| Scenario | Monthly Cost |
|---|---|
| $0 default stack (local ONNX, Gemini CLI) | $0.00 |
| Premium embeddings (Voyage AI) only | ~$2–5/mo depending on repo churn |
| Premium reasoning (Gemini SDK) only | ~$8/mo for active daily use |
| Full premium stack | ~$11/mo |

---

## Dev Dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `tsx` | TypeScript execution for dev/scripts |
| `vitest` | Test runner |
| `@types/node` | Node.js type definitions |
| `esbuild` or `tsup` | Production bundling |
