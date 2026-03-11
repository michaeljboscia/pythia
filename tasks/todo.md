# Session Work Plan — 2026-03-11

**Phase:** Sprint 1 Kickoff
**Plan Ref:** /Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md Sprint 1

---

## Context

The complete 11-document canonical documentation suite has been generated. Design spec is final
with §17 Cycle 7 binding decisions. The repo currently contains only docs and design — no source
code yet. This session begins implementation.

---

## Sprint 1: SQLite + ONNX Foundation

**Goal:** A working SQLite database with all tables, a functioning ONNX embedding pipeline,
and a passing vector search integration test. No MCP server yet.

### Step 1.1 — Project Scaffold
- [x] Create /Users/mikeboscia/pythia/package.json with all deps from TECH_STACK-v2.md
- [x] Create /Users/mikeboscia/pythia/tsconfig.json (ESM, Node 22, strict)
- [x] Create /Users/mikeboscia/pythia/.gitignore (node_modules, dist, *.db, .pythia/)
- [x] Run npm install and verify lockfile created
- [x] Proof: npm run build exits 0

### Step 1.1 Review
- [x] Create /Users/mikeboscia/pythia/src/errors.ts — error registry from BACKEND_STRUCTURE-v2.md
- [x] Create /Users/mikeboscia/pythia/src/config.ts — Zod config loader with CONFIG_INVALID failures
- [x] Create /Users/mikeboscia/pythia/src/__tests__/config.test.ts — 3 config tests passing

### Step 1.2 — Config Loader
- [ ] Create /Users/mikeboscia/pythia/src/config.ts — Zod schema + loadConfig()
- [ ] Create ~/.pythia/config.json (minimal test config)
- [ ] Write unit test: valid config parses, invalid config throws
- [ ] Proof: npm test passes config tests

### Step 1.3 — SQLite Schema + Migrations
- [ ] Create /Users/mikeboscia/pythia/src/migrations/0001_initial_schema.sql
      (All 9 tables from BACKEND_STRUCTURE-v2.md, both FTS5 tables, graph_edges trigger)
- [ ] Create /Users/mikeboscia/pythia/src/db.ts — migration runner + WAL pragma set
- [ ] Write unit test: fresh DB has all tables, migrations are idempotent
- [ ] Proof: npm test passes schema tests, PRAGMA table_list shows all 9

### Step 1.4 — ONNX Embedding Pipeline
- [ ] Create /Users/mikeboscia/pythia/src/embedder.ts
      (nomic-embed-text-v1.5, prefix protocol, 256d truncation, singleton)
- [ ] Write unit test: embed("hello") returns Float32Array of length 256
- [ ] Proof: npm test passes embedder tests

### Step 1.5 — Vector Search Integration Test
- [ ] Create /Users/mikeboscia/pythia/src/__tests__/vector-search.test.ts
      (Insert 5 synthetic chunks, query, assert top result cosine distance < 0.3)
- [ ] Proof: npm test passes — validates full SQLite ↔ ONNX pipeline

---

## Review

After all Sprint 1 steps are checked:
- [ ] Run npm test — all tests pass with 0 failures
- [ ] Run npm run build — TypeScript compiles cleanly
- [ ] Update /Users/mikeboscia/pythia/progress.txt — mark Sprint 1 complete
- [ ] Git commit: "Sprint 1 complete: SQLite schema + ONNX embedding pipeline"
- [ ] Verify plan with user before starting Sprint 2

---

## Notes

- Do NOT start MCP server setup in this sprint — that is Sprint 2
- Do NOT start Tree-sitter parsing in this sprint — that is Sprint 2
- sqlite-vec is a native extension loaded via .loadExtension() — test this loads correctly
- node-tree-sitter: include in package.json but don't wire up until Sprint 2
