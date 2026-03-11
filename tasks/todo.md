# Session Work Plan — 2026-03-11

**Phase:** Sprint 2
**Plan Ref:** /Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md Sprint 2

---

## Context

Sprint 1 is complete and passing. Sprint 2 adds the Tree-sitter fast path, CDC, MCP server scaffold, vector-only retrieval, and the force-index tool. Sprint 3 concerns are explicitly out of scope.

---

## Sprint 2

### Step 2.1 — Tree-sitter chunker
- [x] Add a resolvable `tree-sitter` runtime dependency if required by the current manifest
- [x] Create /Users/mikeboscia/pythia/src/indexer/chunker-treesitter.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/chunker-treesitter.test.ts
- [x] Proof: npm test passes Tree-sitter chunker tests
- [ ] Git commit: "Sprint 2 Step 2.1: Tree-sitter chunker with CNI format"

### Step 2.2 — Dual FTS5 sync
- [x] Modify /Users/mikeboscia/pythia/src/indexer/sync.ts to insert into both FTS tables with delete-then-insert
- [x] Extend /Users/mikeboscia/pythia/src/__tests__/sync.test.ts for FTS coverage
- [x] Proof: npm test passes sync tests
- [ ] Git commit: "Sprint 2 Step 2.2: Add FTS5 inserts to atomic sync transaction"

### Step 2.3 — CDC + hasher
- [x] Create /Users/mikeboscia/pythia/src/indexer/hasher.ts
- [x] Create /Users/mikeboscia/pythia/src/indexer/cdc.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/cdc.test.ts
- [x] Proof: npm test passes CDC tests
- [ ] Git commit: "Sprint 2 Step 2.3: CDC scanner with mtime/BLAKE3 two-gate and binary detection"

### Step 2.4 — MCP server scaffold
- [x] Create /Users/mikeboscia/pythia/src/mcp/tools.ts
- [x] Replace /Users/mikeboscia/pythia/src/index.ts stub with real stdio startup
- [x] Create /Users/mikeboscia/pythia/src/__tests__/mcp-server.test.ts
- [x] Proof: npm test passes MCP server tests
- [ ] Git commit: "Sprint 2 Step 2.4: MCP server scaffold with all 6 tools registered"

### Step 2.5 — lcs_investigate
- [ ] Create /Users/mikeboscia/pythia/src/retrieval/hybrid.ts
- [ ] Create /Users/mikeboscia/pythia/src/mcp/lcs-investigate.ts
- [ ] Create /Users/mikeboscia/pythia/src/__tests__/lcs-investigate.test.ts
- [ ] Proof: npm test passes lcs_investigate tests
- [ ] Git commit: "Sprint 2 Step 2.5: lcs_investigate with vector search and §14.13 output format"

### Step 2.6 — pythia_force_index
- [ ] Create /Users/mikeboscia/pythia/src/mcp/force-index.ts
- [ ] Create /Users/mikeboscia/pythia/src/__tests__/force-index.test.ts
- [ ] Proof: npm test passes force-index tests
- [ ] Git commit: "Sprint 2 Step 2.6: pythia_force_index with path validation and force re-embed"

### Step 2.7 — Sprint 2 proof
- [ ] Create /Users/mikeboscia/pythia/scripts/sprint2-proof.ts
- [ ] Run npx tsx scripts/sprint2-proof.ts
- [ ] Verify AST-bounded function chunk output, CNI format, and line numbers
- [ ] Update /Users/mikeboscia/pythia/progress.txt for Sprint 2 completion
- [ ] Git commit: "Sprint 2 complete: Tree-sitter + MCP scaffold + proof script passes"

---

## Review

- [ ] npm test passes with zero failures across Sprint 1 + Sprint 2
- [ ] npm run build passes cleanly
- [ ] Sprint 2 proof script passes
- [ ] Verify with user before beginning Sprint 3
