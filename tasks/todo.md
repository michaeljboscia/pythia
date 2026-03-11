# Session Work Plan — 2026-03-11

**Phase:** Sprint 5
**Plan Ref:** /Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md Sprint 5

---

## Context

Sprint 4 was complete and passing at handoff. Sprint 5 added garbage collection, the commander CLI, progressive enhancement adapters, migration lifecycle enforcement, npm bundling, and the final proof script.

---

## Sprint 5

### Step 5.1 — GC implementation
- [x] Create /Users/mikeboscia/pythia/src/db/gc.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/gc.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 5 Step 5.1: GC implementation with retention and threshold checks"

### Step 5.2 — Commander CLI
- [x] Create /Users/mikeboscia/pythia/src/cli/main.ts
- [x] Create /Users/mikeboscia/pythia/src/cli/init.ts
- [x] Create /Users/mikeboscia/pythia/src/cli/start.ts
- [x] Create /Users/mikeboscia/pythia/src/cli/mcp-install.ts
- [x] Create /Users/mikeboscia/pythia/src/cli/migrate.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/cli.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 5 Step 5.2: Commander CLI for init, start, mcp install, and migrate"

### Step 5.3 — Progressive enhancement adapters
- [x] Create /Users/mikeboscia/pythia/src/indexer/vector-store.ts
- [x] Create /Users/mikeboscia/pythia/src/retrieval/graph-store.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/vector-store.test.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/graph-store.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 5 Step 5.3: Progressive enhancement adapters for vector and graph stores"

### Step 5.4 — Migration lifecycle enforcement
- [x] Update /Users/mikeboscia/pythia/src/index.ts
- [x] Update /Users/mikeboscia/pythia/src/cli/init.ts
- [x] Update /Users/mikeboscia/pythia/src/cli/start.ts
- [x] Update supporting worker/supervisor hooks for post-batch GC
- [x] Extend MCP and CLI lifecycle tests
- [x] Run `npm test`
- [x] Git commit: "Sprint 5 Step 5.4: Migration lifecycle enforcement across init, start, and MCP startup"

### Step 5.5 — NPM package bundling
- [x] Create /Users/mikeboscia/pythia/tsup.config.ts
- [x] Update /Users/mikeboscia/pythia/package.json for bin/exports/files/build
- [x] Update migration resolution so packaged builds can read src/migrations/
- [x] Run `npm test`
- [x] Run `npm run build`
- [x] Run `npm pack --dry-run`
- [x] Git commit: "Sprint 5 Step 5.5: NPM package bundling with tsup and packaged migrations"

### Sprint 5 Proof
- [x] Create /Users/mikeboscia/pythia/scripts/sprint5-proof.ts
- [x] Run `npx tsx scripts/sprint5-proof.ts`
- [x] Run the manual Sprint 5 smoke test
- [x] Update /Users/mikeboscia/pythia/progress.txt
- [x] Update /Users/mikeboscia/pythia/tasks/todo.md
- [ ] Git commit: "Sprint 5 complete: CLI + GC + distribution — proof passes"

---

## Review

- [x] All Sprint 1–4 tests remain green
- [x] Sprint 5 proof passes end-to-end
- [x] Await user direction before beginning Sprint 6
