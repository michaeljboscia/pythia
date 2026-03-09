# Pythia Oracle Engine — Project CLAUDE.md

> **This file is the governance layer for all AI coding agents working in this repo.**
> Read at the start of every session. Follow exactly as written.

---

## Project Identity

**What:** Pythia is a persistent Gemini daemon oracle engine — MCP tools for spawning, maintaining, and reconstituting generational knowledge sessions.

**Where code lives:**
- Engine code: `/Users/mikeboscia/pythia/src/` (this repo)
- MCP tools are added to: `~/.claude/mcp-servers/inter-agent/src/` (the inter-agent MCP server)
- Oracle DATA lives in each project's `<project>/oracle/` directory (not here)
- Registry: `/Users/mikeboscia/pythia/registry.json`

**Tech stack:** TypeScript, Node.js, MCP SDK (stdio transport), Gemini CLI

---

## Canonical Documentation (Sources of Truth)

| Document | Path | Purpose |
|----------|------|---------|
| Design Spec | `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` | Authoritative design — v6, 51 decisions resolved |
| PRD | `/Users/mikeboscia/pythia/docs/PRD.md` | Feature requirements with FEAT-IDs and acceptance criteria |
| APP_FLOW | `/Users/mikeboscia/pythia/docs/APP_FLOW.md` | Daemon lifecycle, tool flows, state transitions |
| TECH_STACK | `/Users/mikeboscia/pythia/docs/TECH_STACK.md` | Exact versions, dependencies |
| BACKEND_STRUCTURE | `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE.md` | JSON schemas, MCP tool contracts, type definitions |
| IMPLEMENTATION_PLAN | `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md` | Phased build plan (the map — never modified during execution) |
| progress.txt | `/Users/mikeboscia/pythia/progress.txt` | Current state tracker (the GPS pin) |
| LESSONS.md | `/Users/mikeboscia/pythia/LESSONS.md` | Mistakes and prevention rules |
| tasks/todo.md | `/Users/mikeboscia/pythia/tasks/todo.md` | Current session work plan (disposable) |

**If a document doesn't exist, the feature/behavior is not defined. Ask before assuming.**

---

## Session Startup Sequence

At the start of every session, read these files in this order:

1. **This file** (`/Users/mikeboscia/pythia/CLAUDE.md`) — your rules
2. **progress.txt** (`/Users/mikeboscia/pythia/progress.txt`) — where is the project right now
3. **IMPLEMENTATION_PLAN.md** (`/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md`) — what phase/step is next
4. **LESSONS.md** (`/Users/mikeboscia/pythia/LESSONS.md`) — what mistakes to avoid
5. **Write tasks/todo.md** (`/Users/mikeboscia/pythia/tasks/todo.md`) — your plan for this session
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
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `/Users/mikeboscia/pythia/LESSONS.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Review lessons at session start

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Run the MCP server after changes to verify it starts
- Check that existing inter-agent tools still work after refactoring
- Ask yourself: "Would a staff engineer approve this?"

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- Skip this for simple, obvious changes
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

---

## Protection Rules

### No Regressions
- The inter-agent MCP server (`~/.claude/mcp-servers/inter-agent/`) has EXISTING tools (spawn_daemon, ask_daemon, dismiss_daemon, send_message, etc.)
- Before modifying ANY existing file, diff what exists against what you're changing
- Never break working functionality to implement new functionality
- After refactoring `gemini/tools.ts` (to use the new runtime.ts), verify ALL existing daemon tools still work

### No File Overwrites (Documentation)
- Never overwrite existing documentation files
- Create new timestamped versions when documentation needs updating
- Canonical docs maintain history

### No Assumptions
- If you encounter anything not explicitly covered by the design doc or canonical docs, STOP and ask
- Do not infer. Do not guess. Do not fill gaps with "reasonable defaults"
- Every undocumented decision gets escalated to the user before implementation

### Design Spec Is Law
- The design doc at `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` is the authoritative spec
- All 51 resolved design decisions are final
- If you think a decision should change, propose the change — do not silently deviate
- Types, schemas, error codes, and tool contracts must match the design doc exactly

---

## Task Management

1. **Plan First:** Write plan to `/Users/mikeboscia/pythia/tasks/todo.md` with checkable items
2. **Verify Plan:** Check in with user before starting implementation
3. **Track Progress:** Mark items complete as you go
4. **Explain Changes:** High-level summary at each step
5. **Document Results:** Add review section to `/Users/mikeboscia/pythia/tasks/todo.md`
6. **Capture Lessons:** Update `/Users/mikeboscia/pythia/LESSONS.md` after corrections
7. **Update Progress:** Update `/Users/mikeboscia/pythia/progress.txt` after completing features

---

## Core Principles

- **Simplicity First:** Make every change as simple as possible. Impact minimal code.
- **No Laziness:** Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact:** Changes should only touch what's necessary.
- **Match the Design Doc:** Types, field names, error codes, and behavioral contracts come from the design spec. No freelancing.

---

## File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| TypeScript source | kebab-case | `oracle-types.ts`, `oracle-tools.ts` |
| Skill files | kebab-case.md | `pythia.md` |
| Oracle data files | lowercase, descriptive | `manifest.json`, `state.json` |
| Interactions log | versioned | `v1-interactions.jsonl` |
| Checkpoints | versioned | `v1-checkpoint.md` |
| Session logs | taxonomy format | see `~/.claude/SESSION_LOG_SPEC.md` |

---

## What's Forbidden

- Modifying the design doc without explicit user approval
- Adding features not in the PRD
- Changing the IMPLEMENTATION_PLAN during execution
- Using relative file paths in any output
- Writing to `/tmp` (files will be lost)
- Hardcoding context window sizes outside the designated lookup table
- Storing decommission tokens anywhere except in-memory
- Writing TOTP secrets to logs or state files

---

## What's Allowed

- Reading any file in the repo or the inter-agent MCP server
- Creating new files in `src/` as specified by the implementation plan
- Modifying existing MCP server files as specified by the implementation plan
- Running the MCP server build and test commands
- Git commits after completing features
- Updating progress.txt and LESSONS.md at any time

---

## Quick Context (For AI)

This repo is the Pythia oracle engine. Key facts:
- Engine code in `src/`, oracle data in `<project>/oracle/` dirs
- MCP tools added to existing server at `~/.claude/mcp-servers/inter-agent/`
- 13 MCP tools + 1 skill + 1 hook modification + 1 compiled binary
- Design doc is v6 with 46 resolved decisions — implementation-ready
- Gemini context: 2M tokens (pro), 1M (flash) — absolute headroom model
- Pool architecture: spawn-on-demand, MAX pressure aggregation, idle timeout sweep
- No database — JSON files on filesystem, git-tracked
