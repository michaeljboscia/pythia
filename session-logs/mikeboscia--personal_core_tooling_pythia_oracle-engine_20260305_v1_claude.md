# Session Log: mikeboscia/personal/core/tooling/pythia

**Feature:** oracle-engine
**Generated:** 2026-03-05 EST
**Session:** v1 — founding design session

---

## TAXONOMY

| Level | Value |
|-------|-------|
| Owner | mikeboscia |
| Client | personal |
| Domain | core/tooling |
| Repo | pythia |
| Feature | oracle-engine |

---

## OVERALL GOAL

Design and establish the Pythia persistent knowledge oracle system — a generational
daemon architecture that gives projects a living, versioned knowledge base with full
architectural reasoning history. Stands up the `~/pythia/` repo and locks the v4 design spec.

---

## WHAT WAS ACCOMPLISHED THIS SESSION

### 1. Full Design Spec (v1 → v4)
Four design iterations, two twin review passes:

**v1 (starting point):** Basic oracle concept — daemon + manifest + checkpoint
**v2 (post twin review 1):**
- Checkpoint threshold moved to 70%
- `vN-interactions.jsonl` as primary audit trail (not markdown)
- MCP-side char tracking (not `wc -c` on JSON files)
- `oracle_salvage` for dead-letter recovery
- Schema versioning + optimistic concurrency (`state_version`)
- `OracleRuntimeBridge` export needed from `gemini/tools.ts`
- Context Caching API in v1

**v3 (post twin review 2):**
- **Absolute headroom model** replaces percentage thresholds:
  `tokens_remaining < checkpoint_headroom_tokens` (default 250K)
  Scales automatically as Gemini context window grows (2M→5M→10M)
- **Static vs Live corpus split**: `static_entries` (hash-pinned research) + `live_sources` (glob-based code)
- Code is never checkpointed — architectural decisions governing the code are
- `gemini/runtime.ts` singleton extracted (bridge between oracle-tools and gemini session registry)
- `oracle_sync_corpus` tool added
- `discovered_context_window` stored in state.json (dynamic, not hardcoded)

**v4 (Ion + feedback loop):**
- **Ion** = Codex in the Pythia mythology. Ion is the temple servant from Euripides —
  the oracle speaks, Ion does the practical work.
- **Pythia reasons. Ion executes.**
- **Claude is sole orchestrator** — Pythia does NOT call Ion directly. Flow:
  Claude → Pythia (approach?) → Claude → Ion (build this) → Claude → Pythia (sync)
- **Feedback loop**: `InteractionEntry` now has `type` field:
  `"consultation" | "feedback" | "sync_event" | "session_note"`
- Feedback entries close the loop: `implemented`, `outcome`, `divergence`
- Checkpoints inherit outcome data — v(N+1) knows what worked, not just what was recommended
- Ion handoff requires structured envelope: `task_type`, `objective`, `artifacts`,
  `constraints`, `acceptance_criteria`, `decision_boundary`

### 2. The Core Insight Named
**"Version Control for Latent Space"**
- Git tracks what was made (artifacts)
- Pythia tracks why it was made (reasoning, decisions, outcomes)
- `vN-interactions.jsonl` is the enabling primitive: addressable, replayable, forkable
- 2-3 year trajectory: context poisoning immune system, fine-tuning dataset, branchable reasoning

### 3. Engine/Data Architecture Locked
- **Engine**: `~/pythia/` (top-level repo, not under ~/projects/)
- **Data**: each project's `oracle/` directory (committed inside the project repo)
- **Registry**: `~/pythia/registry.json` maps oracle names → project `oracle_dir` paths
- The oracle is **inside** (data, history, artifacts) and **outside** (engine, tooling) the project simultaneously
- No continuous check-in — snapshot gates at: spawn, explicit `/pythia sync`, reconstitution

### 4. Repo Created
- `~/pythia/` initialized, GitHub repo live: `https://github.com/michaeljboscia/pythia`
- First commit: scaffold + design doc v3
- Design doc v4 committed with Ion + feedback loop

---

## KEY DESIGN DECISIONS

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pressure trigger | Absolute headroom (250K tokens) | Scales with growing context windows automatically |
| Corpus tiers | static_entries + live_sources | Code and research have different update cadences |
| Code in checkpoint | Never | Code is Git's job. Checkpoint architectural decisions only |
| Ion orchestration | Claude is sole orchestrator | Pythia→Ion direct call creates black-box chain; Claude translates |
| No continuous check-in | Snapshot gates only | Diffs are context poisoning; coherent wholes > accumulated patches |
| Oracle data location | Inside project repo (oracle/) | Oracle artifacts belong to the project they document |
| Daemon persistence | Keyed by session_name, always soft-dismiss | Oracles are expensive to reconstitute; don't discard them |
| Feedback entries | Curated architectural outcomes only | Per-line feedback would bloat interactions log with noise |

---

## WHAT WORKS (DESIGN CONFIRMED)

- Design doc v4 at `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md`
- Repo at `https://github.com/michaeljboscia/pythia`
- Twin validation: two full review passes with Gemini + Codex
- All 6 original open questions resolved
- Ion mechanics validated by Codex (from its own perspective as Ion)

---

## WHAT DOESN'T EXIST YET (NEXT SESSION)

- `src/oracle-types.ts` — all TypeScript interfaces
- `src/gemini/runtime.ts` — singleton bridge (first code to write)
- `src/oracle-tools.ts` — MCP tool implementations
- `skills/pythia.md` — slash command
- `~/.claude/hooks/post-tool-use.sh` modification — oracle pressure check
- Seed `manifest.json` + `state.json` for narrative-generator-rebuild oracle (43 files)

---

## TRIAD ROLES

| Character | System | Role |
|-----------|--------|------|
| **Pythia** | Gemini | Reasons — holds corpus, answers architectural questions |
| **Ion** | Codex | Executes — code correctness, generation, algorithm specifics |
| **Claude** | Claude | Orchestrates — sole coordinator between Pythia and Ion |

---

## CRITICAL PATHS

| Asset | Path |
|-------|------|
| Pythia repo | `/Users/mikeboscia/pythia/` |
| GitHub | `https://github.com/michaeljboscia/pythia` |
| Design doc | `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md` |
| Registry | `/Users/mikeboscia/pythia/registry.json` |
| Inter-agent MCP (dependency) | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/` |
| Gemini tools (to refactor) | `/Users/mikeboscia/.claude/mcp-servers/inter-agent/src/gemini/tools.ts` |

---

## SESSION ACTIVITY LOG

| Time | Action | Outcome |
|------|--------|---------|
| 11:00 | Read inter-agent MCP source (cli-executor, job-store, gemini/tools, model-fallback) | Full orientation to existing infrastructure |
| 11:05 | Read Pythia design doc v1 | Understood starting state |
| 11:10 | Spawned Gemini + Codex twins for first review pass | Both daemons active |
| 11:20 | Twin review 1 received | 12 major design improvements identified |
| 11:25 | Design doc updated to v2 | Checkpoint threshold, JSONL audit trail, MCP char tracking, salvage, schema_version |
| 11:35 | Twin review 2 fired (same daemons) | Absolute headroom model, static/live corpus split, runtime.ts singleton |
| 11:45 | Design doc updated to v3 | Final architecture locked |
| 11:50 | ~/pythia/ repo created, GitHub repo live | `https://github.com/michaeljboscia/pythia` |
| 12:00 | Ion concept developed | Codex = Ion, Pythia reasons, Ion executes |
| 12:10 | Feedback loop designed | consultation/feedback/sync_event/session_note interaction types |
| 12:15 | Design doc updated to v4 | Ion + feedback loop committed |
| 12:20 | Twin review 3 fired (Ion delineation) | Claude as sole orchestrator confirmed; structured Ion handoff envelope required |
| 12:30 | Dismissed both daemons (soft) | Gemini session preserved as pythia-design-review |

---

## NOTES FOR NEXT SESSION

1. **Start with `src/gemini/runtime.ts`** — this is the foundation. Extract `_sessions`
   from `gemini/tools.ts` into a singleton. Export `OracleRuntimeBridge`. Everything else depends on it.
2. **Seed the narrative-generator-rebuild oracle** — 43 research files are already loaded
   in a running Gemini daemon. Capture that as the first real `manifest.json` for a live oracle.
3. **Ion structured handoff envelope** is a design gap still needing formal TypeScript shape —
   add `IonHandoffRequest` and `IonHandoffResponse` interfaces to `oracle-types.ts`
4. **Feedback entries: curated only** — the system must enforce that feedback is logged for
   architectural outcomes, not implementation minutiae. This is a prompt/skill constraint, not a code constraint.
5. **Reality sync hook**: after Ion ships substantive code, `/pythia sync` must fire automatically
   or be explicitly called. This is the critical gap Gemini identified.

---

*"The corpus is the Oracle. The daemon is the vessel. The vessel is replaceable. The corpus is eternal."*
| 12:27 | Staged: mikeboscia--personal_core_tooling_pythia_oracle-engine_20260305_v1_claude.md (+182/-0 (new)) | ✓ | |
