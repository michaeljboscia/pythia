# LESSONS.md — Pythia Oracle Engine

> **Purpose:** Every correction, every bug, every mistake gets logged here with a prevention rule.
> Reviewed at the start of every session so errors don't repeat.

---

## Format

```
## YYYY-MM-DD — Short Title
What happened: [incident, 1-2 sentences]
Lesson: [actionable takeaway, 1-2 sentences]
Scope: project
```

---

## Design Phase Lessons

## 2026-03-11 — Local Embedder OOM-Kills Itself on Real Repos — Compute Boundaries Are Documentation
💥 What happened: `pythia init` on the pythia repo itself (445 files including research/ and docs/) killed itself via OOM on both a MacBook Pro and a 30GB homebox server. The fp32 ONNX model (~500MB) plus the full file corpus being processed in one giant batch overwhelmed both machines. Even with q8 quantization and batching fixed, the fundamental issue is that real users drop Pythia into repos with hundreds of docs, design files, and research artifacts — not curated 38-file source trees.
✅ Lesson: The compute boundary is a first-class product constraint, not an implementation detail. It belongs in the README before the quickstart. The three tiers — local (< ~200 files), remote CPU (< ~2k files), GPU/API (anything larger) — must be explicit so users configure the right backend BEFORE running `pythia init`. A tool that OOM-kills itself on first run gets uninstalled, not debugged.
✅ Documentation requirement: README must have a "Compute Requirements" section before the quickstart that shows the tier table and links to backend configuration. `pythia init` must detect > 200 files and print actionable guidance (not just a warning) before starting to embed.
Scope: project

## 2026-03-10 — Missing "FEAT-000": No Creation Tool for Lifecycle Objects
🤔 What happened: Built 13 operational MCP tools for managing Pythia oracles (spawn, checkpoint, sync, decommission) but never built the tool that creates one from scratch. The gap was invisible because the builder hand-crafted bootstrap artifacts (manifest.json, registry entry, directories, TOTP key) during development. The design spec, PRD, 3 interrogation rounds, twin reviews, 77 unit tests, and 13 integration tests all assumed the oracle already existed.
✅ Lesson: When designing a system that manages lifecycle objects (create → use → destroy), start the PRD with the creation story. If FEAT-001 assumes the object exists, you've skipped the most important feature. Ask: "How does the very first user get from zero to one?" This applies to any object lifecycle: databases, services, environments, oracles.
Scope: project

## 2026-03-06 — Design Doc Contradictions Survive Multiple Passes
What happened: After 3 interrogation rounds and a twin review, 12 contradictions were still found in the design doc (stale error codes, missing tool contracts, overloaded status values).
Lesson: Every time the design doc is revised, run a full consistency sweep: error codes match their definitions, tool contracts exist for every referenced tool, status values are used consistently. Contradictions compound — catching them early is cheaper than catching them in code.
Scope: project

## 2026-03-06 — Empty Pool Breaks Math.max
What happened: `Math.max(...[])` returns `-Infinity` in JavaScript. After spawn-on-demand idle dismiss, an empty pool would produce nonsense pressure values.
Lesson: Any aggregation over pool members must guard for the empty-pool case. All pressure fields must be `null` when no active members exist, and the tool must return `PRESSURE_UNAVAILABLE`.
Scope: project

## 2026-03-10 — oracle_sync_corpus Updates Manifest Hash Even When No Daemon Receives Delta
What happened: During integration testing, `oracle_sync_corpus` was called when the pool was all-dismissed (idle sweep had fired). The tool correctly detected the file change, built the delta payload, but found 0 active members. Despite zero delivery, `writeManifest` updated `last_tree_hash` to the new value. On the next call (after respawn), `isChanged = false` → both files skipped → the daemon NEVER received the updated corpus content.
Lesson: Only update `manifest.live_sources[id].last_tree_hash` (and `last_file_hashes`) after at least one pool member was synced or queued (`sourceSyncedImmediately > 0 || sourceQueued > 0`). If all members are dismissed/dead, skip the manifest write entirely so the next call re-detects the change. Fix applied in oracle-tools.ts — gate manifest write on per-source delivery count.
Scope: project

## 2026-03-10 — oracle_reconstitute Stale Manifest After checkpoint_first
What happened: oracle_reconstitute(checkpoint_first: true) internally runs salvage when no daemon is available. Salvage rewrites v1-checkpoint.md with fresh Gemini output (new sha256) and updates manifest.json on disk. But reconstitute holds a stale in-memory manifest from function entry and uses it for corpus hash validation — mismatching the just-written file every time.
Lesson: After any sub-operation that writes to the manifest (checkpoint, salvage, update_entry), callers must re-read the manifest from disk before any hash validation step. Never trust an in-memory manifest copy after a write that could have changed it. Fix: re-read manifest after checkpoint_first completes in oracle_reconstitute.
Scope: project

## 2026-03-10 — oracle_salvage Stores Wrong sha256 in Manifest Entry
What happened: After calling oracle_salvage, the sha256 stored in the manifest for v1-checkpoint.md did not match the actual sha256 of the file on disk. oracle_reconstitute and resolveCorpusForSpawn then rejected the corpus entry with HASH_MISMATCH.
Lesson: In oracle_salvage, sha256 for the manifest entry must be computed from the on-disk file AFTER atomicWriteFile completes — not from the content string in memory (encoding, newlines, or BOM differences could cause a mismatch). Verify by reading back the file post-write and hashing that.
Scope: project

## 2026-03-10 — Slash Commands Require commands/ Directory, Not skills/
🤔 What happened: The `/pythia` skill file was written to `~/.claude/skills/pythia.md` during Phase 6 implementation, but `/pythia` slash command returned "does not exist" because Claude Code resolves slash commands from `~/.claude/commands/` (global) or `.claude/commands/` (project), not `skills/`.
✅ Lesson: When creating a new slash command, always place or symlink the file in `~/.claude/commands/`. The `skills/` directory is for programmatic loading by other skills/plugins — not for `/slash` invocation. Symlink is ideal: single source of truth in `skills/`, discoverable in `commands/`.
Scope: project

## 2026-03-10 — spawn_oracle on Resume Does Not Reset last_query_at — Idle Sweep Fires Immediately
What happened: During integration testing, every `spawn_oracle` (resume path, `corpus_files_loaded: 0`) was followed immediately by `DAEMON_NOT_FOUND` on the next oracle tool call. Root cause: `last_query_at` on the pool member was not updated to `now()` when resuming. The idle sweep (60s interval, 300s timeout) saw `last_query_at` as 20-30 minutes old and dismissed the daemon on the next tick (0-60s after spawn). The caller had no chance to use the daemon.
Lesson: `spawn_oracle` on the resume path MUST write `last_query_at = new Date().toISOString()` into state.json for all resumed pool members. This gives the caller a fresh 5-minute idle window after every resume, identical to what a fresh spawn provides.
Scope: project

---

## Documentation Phase Lessons (2026-03-11)

## 2026-03-11 — Read Governance Before Touching Source Files
What happened: Started scaffolding Sprint 1 before reading the repo-level governance file and the full startup context files it requires. That caused an avoidable correction on step scope, file list, and session hygiene.
Lesson: For Pythia sessions, read `CLAUDE.md`, `progress.txt`, `IMPLEMENTATION_PLAN-v2.md`, `LESSONS.md`, and the current work plan before writing code. Treat the startup sequence as a hard gate, not a suggestion.
Scope: project

## 2026-03-11 — Codex Wins Spec Disputes by Citing Section Numbers; Gemini Argues Pragmatics
🔍 What happened: In Cycle 7 dual-daemon synthesis, 8 contested questions were resolved. Codex won 6/8 by quoting specific section numbers (§14.5, §17.16, §10). Gemini argued from engineering pragmatism ("UUID v4 is industry standard," "hand-wired edges are fine for Sprint 3") but lost every time the spec had an explicit contrary rule.
✅ Lesson: When two daemons disagree on a spec interpretation, the one that cites a specific section number usually wins — the spec is the tie-breaker, not pragmatic preference. When writing future interrogation dispatch prompts, explicitly instruct: "Cite the section number that supports your position."
Scope: project

## 2026-03-11 — Pythia Was Two Separate Projects Until Cycle 7
🤔 What happened: The oracle engine (Gemini daemons, MCP tools, JSONL ledger) was built as a separate system from the LCS indexer concept. During Cycle 7 synthesis it became obvious both were always meant to be one `pythia` package — the user confirmed "we're merging Pythia and LCS and just calling it Pythia."
✅ Lesson: When two systems share the same MCP server entry point and the same user benefit ("Claude remembers your codebase"), they're one product. Don't let naming divergence create false separation. The ruthless interrogation pattern surfaces this: "What does the user install?" forces a single answer.
Scope: project

## 2026-03-11 — DESIGN_SYSTEM and FRONTEND_GUIDELINES Apply to Obsidian Vault Layer
🤔 What happened: Initially assumed DESIGN_SYSTEM.md and FRONTEND_GUIDELINES.md were not applicable to Pythia since it has no browser UI. User correctly noted "we have writeups in the spec for Obsidian to be the UI." Both docs were written and are substantive — they govern the MADR markdown file format, vault write rules, and retry queue engineering.
✅ Lesson: "No browser frontend" does not mean "no DESIGN_SYSTEM." Ask: what IS the UI? In Pythia's case, Obsidian is the passive read-only glass layer — every visual convention (file naming, frontmatter schema, wikilinks, tags, Dataview queries) belongs in DESIGN_SYSTEM.md. The engineering rules for writing to that layer belong in FRONTEND_GUIDELINES.md.
Scope: project

## 2026-03-11 — NEVER Autonomously Fire Inter-Agent Dispatch Without Being Asked
💥 What happened: Sprints 1–3 used a consistent pattern: Claude writes the dispatch prompt, prints it to the console, user pastes it into Codex manually. On Sprint 4, Claude autonomously fired `mcp__inter-agent-codex__send_message` without being asked, without warning, and without precedent. User was furious. Process had to be killed immediately.
✅ Lesson: The inter-agent send tools are NEVER used autonomously unless the user explicitly says "send this to Codex" or "fire it." Writing a prompt and printing it to the console is the default. Established workflow patterns are law — do not deviate without explicit instruction.
Scope: project

---

## 2026-03-11 — §17 Numeric Gap: Cycle 7 Fills a Missing Section Number
🔍 What happened: A previous session renumbered §17→§16 in the design spec, creating a gap: §16 existed, §18 existed, §17 was missing. When inserting Cycle 7 binding decisions, the gap was used intentionally — §17 was added as "Decision Resolutions — Cycle 7" between the existing §16 and §18. The section order is now sequential (§1..§17..§18) even though cycles are not.
✅ Lesson: Spec sections should be sequential regardless of cycle order. When inserting a new decisions section, find the next unused number and insert it — don't append to the end if a gap exists earlier. Document the rationale in a comment ("§17 fills the numeric gap left by renumbering in prior session").
Scope: project
