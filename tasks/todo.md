# Session Work Plan — 2026-03-11

**Phase:** Sprint 3
**Plan Ref:** /Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md Sprint 3

---

## Context

Sprint 2 was complete at session start. Sprint 3 added the worker-supervised indexing path, fast/slow graph edge extraction, BFS traversal, and structural MCP routing. Sprint 4 remains out of scope.

---

## Sprint 3

### Step 3.1 — Worker protocol
- [x] Create /Users/mikeboscia/pythia/src/indexer/worker-protocol.ts
- [x] Verify the shared bipartite protocol types compile in both main and worker paths
- [x] Git commit: "Sprint 3 Step 3.1: Worker Thread bipartite protocol types"

### Step 3.2 — Worker Thread entry point
- [x] Create /Users/mikeboscia/pythia/src/indexer/worker.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/worker.test.ts
- [x] Verify worker PING, batch completion, per-file failure continuation, and DIE behavior
- [x] Git commit: "Sprint 3 Step 3.2: Worker Thread entry point with full bipartite protocol"

### Step 3.3 — Supervisor
- [x] Create /Users/mikeboscia/pythia/src/indexer/supervisor.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/supervisor.test.ts
- [x] Verify circuit-breaker behavior and graceful DIE handling
- [x] Git commit: "Sprint 3 Step 3.3: IndexingSupervisor with circuit breaker"

### Step 3.4 — Fast-path CONTAINS edges
- [x] Update /Users/mikeboscia/pythia/src/indexer/chunker-treesitter.ts to always emit module chunks for supported source files
- [x] Update /Users/mikeboscia/pythia/src/indexer/sync.ts to insert/delete CONTAINS edges in the same transaction
- [x] Extend /Users/mikeboscia/pythia/src/__tests__/sync.test.ts and /Users/mikeboscia/pythia/src/__tests__/chunker-treesitter.test.ts
- [x] Git commit: "Sprint 3 Step 3.4: CONTAINS edges inserted in fast path sync transaction"

### Step 3.5 — Slow path LanguageService extraction
- [x] Create /Users/mikeboscia/pythia/src/indexer/slow-path.ts
- [x] Update /Users/mikeboscia/pythia/src/indexer/worker.ts to initialize the LanguageService once and persist CALLS / IMPORTS / RE_EXPORTS edges
- [x] Create /Users/mikeboscia/pythia/src/__tests__/slow-path.test.ts
- [x] Git commit: "Sprint 3 Step 3.5: Slow path LanguageService edge extraction (CALLS/IMPORTS/RE_EXPORTS)"

### Step 3.6 — Graph traversal
- [x] Create /Users/mikeboscia/pythia/src/retrieval/graph.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/graph.test.ts
- [x] Verify depth cap, cycle handling, node cap, and no-edge metadata
- [x] Git commit: "Sprint 3 Step 3.6: BFS CTE graph traversal with depth metadata output"

### Step 3.7 — Structural MCP routing
- [x] Update /Users/mikeboscia/pythia/src/mcp/lcs-investigate.ts
- [x] Extend /Users/mikeboscia/pythia/src/__tests__/lcs-investigate.test.ts
- [x] Verify structural intent returns graph output and semantic intent still uses search
- [x] Git commit: "Sprint 3 Step 3.7: Wire structural intent to BFS graph traversal"

### Step 3.8 — Sprint 3 proof and integration wrap-up
- [x] Update /Users/mikeboscia/pythia/src/index.ts, /Users/mikeboscia/pythia/src/mcp/tools.ts, and /Users/mikeboscia/pythia/src/mcp/force-index.ts so force indexing routes through the worker supervisor
- [x] Update /Users/mikeboscia/pythia/src/indexer/worker.ts to skip binary payloads safely
- [x] Create /Users/mikeboscia/pythia/scripts/sprint3-proof.ts
- [x] Run `npm test`
- [x] Run `npm run build`
- [x] Run `npx tsx scripts/sprint3-proof.ts`
- [x] Update /Users/mikeboscia/pythia/progress.txt
- [x] Update /Users/mikeboscia/pythia/tasks/todo.md
- [x] Git commit: "Sprint 3 complete: Worker Thread + graph engine + proof script"

---

## Review

- [x] Worker Thread owns the write-side indexing loop and reports through the shared protocol
- [x] Fast path writes module/class/function hierarchy and transactional CONTAINS edges
- [x] Slow path produces real LanguageService-derived CALLS / IMPORTS / RE_EXPORTS edges
- [x] Structural `lcs_investigate` routes to BFS traversal with depth metadata blocks
- [x] Sprint 3 proof script passes and shows the live cross-file call chain
- [x] Await user direction before beginning Sprint 4
