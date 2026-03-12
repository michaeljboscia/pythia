# Sprint 6 — Session Work Plan
**Date:** 2026-03-12
**Sprint:** 6 (v1.2.0)
**Plan:** `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-sprint6.md`
**Spec:** `/Users/mikeboscia/pythia/design/sprint-6-spec.md`

## Steps

### Step 6.1 — Language packages + chunker wiring
- [ ] `npm install tree-sitter-php tree-sitter-xml tree-sitter-sql tree-sitter-css`
- [ ] Extend language registry in `src/indexer/chunker-treesitter.ts`
- [ ] Implement `extractPhpChunks` (class, trait, interface, function, method, module)
- [ ] Implement `extractPhtmlChunks` (module only)
- [ ] Implement `extractXmlChunks` (Magento-aware: di.xml / layout / fallback)
- [ ] Implement `extractCssChunks` (rule threshold, at_rule, mixin, function, module)
- [ ] Add `method_declaration` to PHP method extraction
- [ ] Unit tests: language dispatch + phtml/sql single-module behavior
- [ ] `npm test` — all pass

### Step 6.2 — Golden fixtures + integration tests
- [ ] Create 9 fixture pairs in `tests/fixtures/<lang>/`
- [ ] Create `src/__tests__/chunker-languages.test.ts`
- [ ] `npm test` — all pass

### Step 6.3 — Max chunk size enforcement
- [ ] Create `src/indexer/chunk-splitter.ts`
- [ ] Add `max_chunk_chars` + `oversize_strategy` to `src/config.ts`
- [ ] Wire splitter as post-extraction pass in chunker
- [ ] Create `src/__tests__/chunk-splitter.test.ts`
- [ ] `npm test` — all pass

### Step 6.4 — Configurable dimensions + --force
- [ ] Add `dimensions` enum to `src/config.ts` embeddings schema
- [ ] Update all 3 backends in `src/indexer/embedder.ts`
- [ ] Update `src/db/embedding-meta.ts` — dimensions in fingerprint
- [ ] Implement `--force` DDL in `src/cli/init.ts` (7-step sequence)
- [ ] Update `src/__tests__/embedding-meta.test.ts` + `embedder-factory.test.ts`
- [ ] `npm test` — all pass

### Step 6.5 — Parallel embedding workers
- [ ] `npm install p-limit`
- [ ] Add concurrency/batch/retry fields to `src/config.ts`
- [ ] Update `src/indexer/embedder.ts` — p-limit, Retry-After, sub-batch caching
- [ ] Update `src/__tests__/embedder-factory.test.ts`
- [ ] `npm test` — all pass

### Step 6.6 — Benchmark CLI
- [ ] Create `src/benchmark/runner.ts`
- [ ] Create `src/benchmark/report.ts`
- [ ] Create `src/cli/benchmark.ts`
- [ ] Register `benchmark` in `src/cli/main.ts`
- [ ] Create `src/__tests__/benchmark-runner.test.ts`
- [ ] `npm test` — all pass

### Step 6.7 — POC matrix script
- [ ] Create `scripts/poc-matrix.sh`
- [ ] Create `scripts/poc-matrix.mjs`
- [ ] Manual `--dry-run` smoke test

### Step 6.8 — oracle_add_to_corpus batch (inter-agent MCP server)
- [ ] Modify `~/.claude/mcp-servers/inter-agent/src/oracle-tools.ts`
- [ ] `files: string | string[]` signature
- [ ] Manifest atomic write (file lock + temp rename)
- [ ] Batch XML injection prompt
- [ ] Update `test-phase4.mjs` — all oracle tests still pass

### Sprint 6 Proof
- [ ] Create `scripts/sprint-6-proof.mjs`
- [ ] Create `scripts/sprint-6-proof-queries.yaml`
- [ ] Run proof — all 7 checks pass
- [ ] Update `progress.txt` Sprint 6 complete
