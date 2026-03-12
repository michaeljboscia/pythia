# Pythia v1 — Project CLAUDE.md
**Version:** 2.0 (Full Merged System: Oracle Engine + LCS Code Indexing)
**Updated:** 2026-03-11

> **This file is the governance layer for all AI coding agents working in this repo.**
> Read at the start of every session. Follow exactly as written.

---

## Project Identity

**What:** Pythia v1 is a unified MCP server that combines two capabilities into one tool:
1. **LCS (Local Code Search):** Tree-sitter + sqlite-vec RAG for semantic code investigation
2. **Oracle Engine:** Persistent Gemini daemon sessions for architectural memory (MADRs)

**The merged system is called Pythia. "LCS" is an internal module name, not a product name.**

**Where code lives:**
- All source: `/Users/mikeboscia/pythia/src/`
- Design spec: `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md`
- Documentation suite: `/Users/mikeboscia/pythia/docs/`
- Per-project database: `<workspace>/.pythia/lcs.db` (SQLite, created on `pythia init`)
- Global config: `~/.pythia/config.json`

**Tech stack:** TypeScript 5.x, Node.js 22 LTS, ESM, better-sqlite3, sqlite-vec, @huggingface/transformers (ONNX), node-tree-sitter, MCP SDK

**Distribution:** `npm install -g @pythia/lcs`

---

## Canonical Documentation (Sources of Truth)

| Document | Path | Purpose |
|----------|------|---------|
| Design Spec | `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md` | Authoritative spec — §17 binding decisions |
| PRD | `/Users/mikeboscia/pythia/docs/PRD-v2.md` | 21 features with FEAT-IDs and acceptance criteria |
| APP_FLOW | `/Users/mikeboscia/pythia/docs/APP_FLOW-v2.md` | All 7 lifecycle flows, error flows |
| TECH_STACK | `/Users/mikeboscia/pythia/docs/TECH_STACK-v2.md` | Version-locked deps, ONNX models, Zod config schema |
| BACKEND_STRUCTURE | `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE-v2.md` | Full DB schema, MCP tool contracts, error registry |
| DESIGN_SYSTEM | `/Users/mikeboscia/pythia/docs/DESIGN_SYSTEM.md` | Obsidian vault conventions, MADR file format |
| FRONTEND_GUIDELINES | `/Users/mikeboscia/pythia/docs/FRONTEND_GUIDELINES.md` | Obsidian writer + retry engineering rules |
| IMPLEMENTATION_PLAN | `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md` | 5-sprint build plan (the map — never modified during execution) |
| progress.txt | `/Users/mikeboscia/pythia/progress.txt` | Current state tracker (the GPS pin) |
| LESSONS.md | `/Users/mikeboscia/pythia/LESSONS.md` | Mistakes and prevention rules |
| tasks/todo.md | `/Users/mikeboscia/pythia/tasks/todo.md` | Current session work plan (disposable) |

**If a feature/behavior isn't in these docs, it doesn't exist. Ask before assuming.**

---

## Session Startup Sequence

At the start of every session, read these files in this order:

1. **This file** (`/Users/mikeboscia/pythia/CLAUDE.md`) — your rules
2. **`/Users/mikeboscia/pythia/progress.txt`** — where is the project right now
3. **`/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md`** — what sprint/step is next
4. **`/Users/mikeboscia/pythia/LESSONS.md`** — what mistakes to avoid
5. **Write `/Users/mikeboscia/pythia/tasks/todo.md`** — your plan for this session
6. **Verify plan with user before executing**

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `/Users/mikeboscia/pythia/LESSONS.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Run `npm test` after every sprint step
- Verify the MCP server starts and tools register correctly
- Verify existing SQLite queries produce expected results
- Ask yourself: "Would a staff engineer approve this?"

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- Skip this for simple, obvious fixes
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing tests without being told how

---

## Protection Rules

### No Regressions
- Before modifying any existing file, diff what exists against what you're changing
- Never break working functionality to implement new functionality
- If a change touches more than one system, verify each system still works after
- When in doubt, ask before overwriting
- Whenever new languages, tools, or CLI commands are implemented, update the Supported languages, MCP Tools, and Quick Context sections in `README.md` in the same commit

### No File Overwrites (Documentation)
- Never overwrite existing documentation files (`PRD.md`, `APP_FLOW.md`, etc. from oracle era)
- v2 docs are the canonical docs now — they carry the `-v2` suffix to coexist with oracle-era docs
- The IMPLEMENTATION_PLAN-v2.md is the map — it does NOT get modified during execution

### No Assumptions
- If you encounter anything not explicitly covered by the design spec or canonical docs, STOP and ask
- Do not infer. Do not guess. Do not fill gaps with "reasonable defaults"
- Every undocumented decision gets escalated to the user before implementation

### Design Spec Is Law
- `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md` is the authoritative spec
- §17 contains the Cycle 7 binding decisions — all contested questions are resolved
- If you think a decision should change, propose the change — do not silently deviate
- Types, schemas, error codes, and MCP tool contracts must match the spec exactly

### SQLite Is the Source of Truth
- SQLite commits before Obsidian writes — always (§13.1 / FRONTEND_GUIDELINES Rule 1)
- A failed Obsidian write NEVER rolls back a committed MADR
- The retry queue is the recovery path for failed Obsidian writes

---

## Critical Architectural Rules

### Indexing (LCS)
- All indexing writes (chunks + embeddings + FTS + graph edges + file_scan_cache) happen in ONE `BEGIN IMMEDIATE` transaction
- `file_scan_cache.mtime_ns` and `content_hash` are written immediately before `COMMIT` — if the transaction rolls back, the cache entry is not updated
- Worker Thread communicates with Main Thread via `postMessage` — never shares SQLite connections
- Tree-sitter is the fast path; tsserver is the slow path (Sprint 3)

### Retrieval (LCS)
- Vector search: top-30 from `vec_lcs_chunks` (cosine distance)
- FTS search: top-30 from `fts_lcs_chunks_kw` first, fallback to `fts_lcs_chunks_sub`
- RRF fusion then re-rank top-12 with cross-encoder
- Structural intent: BFS CTE traversal, 50-node cap, depth ≤6

### Oracle Session
- `oracle_commit_decision` is NOT idempotent in v1 — calling twice creates two MADRs
- Idle sessions reconstitute from MADRs only — no transcript replay
- Argon2id params: memory_cost=65536 KiB, time_cost=3, parallelism=1
- `session_id` is UUID v4

### Embedding
- Model: `nomic-embed-text-v1.5` ONNX, 256-dimensional Matryoshka truncation
- Cross-encoder: `Xenova/ms-marco-MiniLM-L-6-v2` (reranker)
- Prefix protocol: `"search_query: "` for queries, `"search_document: "` for chunks

---

## Task Management

1. **Plan First:** Write plan to `/Users/mikeboscia/pythia/tasks/todo.md` with checkable items
2. **Verify Plan:** Check in with user before starting implementation
3. **Track Progress:** Mark items complete as you go
4. **Explain Changes:** High-level summary at each step
5. **Document Results:** Add review section to `/Users/mikeboscia/pythia/tasks/todo.md`
6. **Capture Lessons:** Update `/Users/mikeboscia/pythia/LESSONS.md` after corrections
7. **Update Progress:** Update `/Users/mikeboscia/pythia/progress.txt` after completing sprint steps

---

## Core Principles

- **Simplicity First:** Make every change as simple as possible. Impact minimal code.
- **No Laziness:** Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact:** Changes should only touch what's necessary. Avoid introducing bugs.
- **Match the Spec:** Types, field names, error codes, and behavioral contracts come from the design spec. No freelancing.

---

## File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| TypeScript source | kebab-case | `lcs-indexer.ts`, `oracle-session.ts` |
| Migration files | `NNNN_description.sql` | `0001_initial_schema.sql` |
| Test files | `*.test.ts` | `indexer.test.ts` |
| Oracle data files | lowercase, descriptive | `manifest.json`, `state.json` |
| Session logs | taxonomy format | see `~/.claude/SESSION_LOG_SPEC.md` |

---

## What's Forbidden

- Modifying the design spec without explicit user approval
- Adding features not in PRD-v2.md
- Changing IMPLEMENTATION_PLAN-v2.md during execution
- Using relative file paths in any output
- Writing to `/tmp` (files will be lost)
- Rolling back SQLite transactions due to Obsidian failures
- Reading from Obsidian vault (write-only, per FRONTEND_GUIDELINES Rule 7)
- Writing outside `<vault>/Pythia/` subdirectory
- Storing decommission secrets anywhere except in-memory (oracle session flow)
- Hardcoding embedding dimensions or context window sizes outside config

---

## What's Allowed

- Reading any file in the repo
- Creating new files in `src/` as specified by IMPLEMENTATION_PLAN-v2.md
- Running the MCP server build and test commands
- Git commits after completing sprint steps
- Updating `progress.txt` and `LESSONS.md` at any time
- Running `pythia init` and `pythia start` against test workspaces

---

## Quick Context (For AI)

This repo is Pythia v1 — a single MCP server that makes Claude Code deeply aware of any codebase.

**Key system facts:**
- 6 MCP tools: `lcs_investigate`, `pythia_force_index`, `spawn_oracle`, `ask_oracle`, `oracle_commit_decision`, `oracle_decommission`
- Distribution target: `npm install -g @pythia/lcs`
- SQLite database per workspace: `<workspace>/.pythia/lcs.db`
- Global config: `~/.pythia/config.json` (Zod-validated at startup)
- Embedding: nomic-embed-text-v1.5 ONNX, 256d — runs locally, $0 cost
- Oracle provider: Gemini CLI (free) or Gemini SDK (premium), configurable
- Obsidian integration: best-effort write, retry queue, never blocks MADR commit
- Worker Thread handles all indexing; Main Thread handles all MCP requests
- 5-sprint build plan: Sprint 1 (SQLite+ONNX), Sprint 2 (Tree-sitter+MCP), Sprint 3 (Graph/tsserver), Sprint 4 (Oracle tools), Sprint 5 (CLI+GC+distribution)

**The oracle engine (from the pre-merge implementation) lives in:**
- `~/.claude/mcp-servers/inter-agent/src/` — NOT in this repo
- That system is separate and complete. Do not confuse it with Pythia v1 LCS.
