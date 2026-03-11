# Session Work Plan — 2026-03-11

**Phase:** Sprint 4
**Plan Ref:** /Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN-v2.md Sprint 4

---

## Context

Sprint 3 is complete and passing. Sprint 4 adds hybrid retrieval, oracle providers, session lifecycle management, MADR commit flow, vault writing, retry handling, and decommissioning. Sprint 5 remains out of scope.

---

## Sprint 4

### Step 4.1 — Full hybrid retrieval
- [x] Replace /Users/mikeboscia/pythia/src/retrieval/hybrid.ts with RRF fusion, FTS routing, and reranker integration
- [x] Create /Users/mikeboscia/pythia/src/retrieval/reranker.ts
- [x] Update /Users/mikeboscia/pythia/src/mcp/lcs-investigate.ts for reranker-unavailable metadata
- [x] Create /Users/mikeboscia/pythia/src/__tests__/hybrid.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.1: Full hybrid retrieval — RRF fusion, FTS routing, cross-encoder reranker"

### Step 4.2 — Reasoning providers
- [x] Create /Users/mikeboscia/pythia/src/oracle/provider.ts
- [x] Create /Users/mikeboscia/pythia/src/oracle/cli-provider.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/cli-provider.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.2: ReasoningProvider interface + CliReasoningProvider with exponential backoff"

### Step 4.3 — Session management
- [x] Create /Users/mikeboscia/pythia/src/oracle/session.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/session.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.3: Session management — spawn matrix, generation_id, idle reconstitution"

### Step 4.4 — spawn_oracle tool
- [x] Create /Users/mikeboscia/pythia/src/mcp/spawn-oracle.ts
- [x] Update /Users/mikeboscia/pythia/src/mcp/tools.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/spawn-oracle.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.4: spawn_oracle MCP tool with exact response contract"

### Step 4.5 — ask_oracle + reaper
- [x] Create /Users/mikeboscia/pythia/src/mcp/ask-oracle.ts
- [x] Create /Users/mikeboscia/pythia/src/oracle/reaper.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/ask-oracle.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.5: ask_oracle — FIFO queue, write-ahead, idle reconstitution, reaper"

### Step 4.6 — commit decision + vault writer + retry queue
- [x] Create /Users/mikeboscia/pythia/src/mcp/commit-decision.ts
- [x] Create /Users/mikeboscia/pythia/src/obsidian/writer.ts
- [x] Create /Users/mikeboscia/pythia/src/obsidian/retry.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/commit-decision.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.6: oracle_commit_decision — BEGIN IMMEDIATE, MADR id from AUTOINCREMENT, Obsidian retry"

### Step 4.7 — decommission tool
- [x] Create /Users/mikeboscia/pythia/src/mcp/decommission.ts
- [x] Create /Users/mikeboscia/pythia/src/__tests__/decommission.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.7: oracle_decommission — Argon2id verify, hard-delete transcripts, MADRs preserved"

### Step 4.8 — SDK provider
- [x] Create /Users/mikeboscia/pythia/src/oracle/sdk-provider.ts
- [x] Update provider selection paths and package metadata as needed
- [x] Create /Users/mikeboscia/pythia/src/__tests__/sdk-provider.test.ts
- [x] Run `npm test`
- [x] Git commit: "Sprint 4 Step 4.8: SdkReasoningProvider (@google/genai) with CLI fallback"

### Sprint 4 Proof
- [x] Create /Users/mikeboscia/pythia/scripts/sprint4-proof.ts
- [x] Run `npm test`
- [x] Run `npm run build`
- [x] Run `npx tsx scripts/sprint4-proof.ts`
- [x] Update /Users/mikeboscia/pythia/progress.txt
- [x] Update /Users/mikeboscia/pythia/tasks/todo.md
- [x] Git commit: "Sprint 4 complete: Oracle tools + hybrid retrieval + proof script passes"

---

## Review

- [x] All Sprint 1–3 tests remain green
- [x] Sprint 4 proof passes end-to-end
- [x] Await user direction before beginning Sprint 5
