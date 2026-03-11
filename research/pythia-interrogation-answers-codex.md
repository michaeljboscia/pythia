# Noosphere Interrogation Answers: Codex Decisions

These answers are binding engineering decisions for v1. Where I disagree with the existing Gemini answer, I flag it explicitly.

## Group 1: Who Is This For?

1. **Primary user:** Solo developer. Team members can each run it locally against the same repo, but shared multi-user state is not a v1 feature.

2. **What it solves that Cursor/Copilot/Sourcegraph do not:** Persistent architectural memory with deterministic local retrieval. Cursor and Copilot optimize for in-session assistance. Sourcegraph optimizes for search. Noosphere adds repo-local code graph + vector index + durable MADRs + session transcripts, so the system can answer "why was this done?" instead of only "where is this?"

3. **How hallucination is measured / acceptable rate:** Measure hallucination as unsupported factual claims in a fixed golden set of repository questions. A response fails if it invents a file, symbol, edge, or decision not backed by indexed artifacts. Acceptable rate for retrieval-backed facts is **0%**. Acceptable rate for higher-level synthesis is **<= 2%** failed answers on the golden set.

4. **Out of scope for v1:** Multi-user sync, remote collaboration, non-JS/TS semantic graphing, community summaries / `lcs_global_search`, local LLM reasoning, automatic conflict resolution between SQLite and edited Markdown MADRs, and cloud-hosted control planes.

## Group 2: The "Local" Claim

5. **Is user code sent to Google / is it disclosed:** Yes. Code and retrieved context are sent to Google whenever the reasoning layer uses Gemini CLI or the Gemini SDK. This must be disclosed in `pythia init`, in the README, and in the config file comments. "Local" only applies to indexing, storage, and retrieval.

6. **Should there be an Ollama/local model path:** Yes, the `ReasoningProvider` abstraction should reserve a local-model implementation point. It is **not** a v1 deliverable, but the interface must not hard-wire Gemini assumptions.  
   **Disagreement with Gemini:** Gemini said no local reasoning setting in v1. I disagree on architecture. Not shipping it in v1 is fine; designing it out is not.

## Group 3: Internal Contradictions

7. **Section 4 Git hooks vs Section 11.5 mtime/BLAKE3:** Section 11.5 governs. Git hooks and polling are superseded. The authoritative trigger is `sync_workspace` using mtime plus BLAKE3.

8. **Section 9 warm start says `git diff` vs 11.5:** Section 11.5 governs. Warm start uses the file scanner, not Git state.

9. **`lcs_communities` in schema and removed in 11.7:** It is **not** in the v1 database. Do not create `lcs_communities` or `vec_communities` in Sprint 1.

## Group 4: Installation

10. **How a user installs this:** Ship it as an npm package with a real CLI binary. Primary install path: `npm install -g @pythia/noosphere`, then `pythia init` in the target repo. `npx @pythia/noosphere@latest init` is optional, not the primary path.

11. **Complete list of files/directories the system creates:**  
   Global:
   - `~/.pythia/config.json`
   - `~/.pythia/logs/`
   - Provider-owned Gemini session directories under `~/.gemini/daemon-sessions/` or the CLI's canonical session path
   
   Per repository:
   - `<repo>/.pythia/`
   - `<repo>/.pythia/lcs.db`
   - `<repo>/.pythia/lcs.db-wal`
   - `<repo>/.pythia/lcs.db-shm`
   - `<repo>/.pythia/config.json`
   - `<repo>/.pythia/index-state.json`
   - `<repo>/Pythia/` if Obsidian export is enabled
   - `<repo>/Pythia/MADR-*.md` exported decision files

12. **Is `pythia` a binary, npm script, or shell alias:** A real Node CLI binary exposed via the package `bin` field. It is not an npm script and not a shell alias.

13. **Does `pythia init` auto-register the MCP server in Claude Code `settings.json`:** No. `pythia init` must not silently mutate another tool's config. Provide an explicit `pythia mcp install claude-code` command for opt-in registration.  
   **Disagreement with Gemini:** Gemini said `init` should auto-register. That is the wrong default. Silent config mutation is hostile.

## Group 5: ReasoningProvider

14. **Gemini CLI not installed: error and recovery:** `spawn_oracle` fails with `REASONING_PROVIDER_UNAVAILABLE: gemini CLI not found in PATH`. Recovery is explicit: install Gemini CLI or switch the provider to SDK in config. No fallback beyond what the configured provider mode allows.

15. **Max size of `contextChunks` in `spawn()`:** Hard cap the serialized `contextChunks` payload at **180,000 characters total**. Anything larger is moved to post-spawn corpus loading through `ask()`. `spawn()` is for the preamble, not bulk corpus injection.  
   **Disagreement with Gemini:** Gemini used 200,000 characters. I am setting 180,000 to align with the inherited-wisdom inline cap and keep spawn deterministic.

16. **Who calls `dismiss()` / what if never called:** `dismiss()` is called by `oracle_decommission`, by `oracle_reconstitute` on the old generation, by the idle reaper after 30 minutes of inactivity, and on process shutdown cleanup. If it is never called manually, the runtime marks the session dead on next startup and cleans up orphaned provider state.  
   **Disagreement with Gemini:** Gemini said 24-hour TTL only. That is too loose for a local MCP runtime.

17. **Invalid/expired API key: what happens:** Fail fast with `AUTH_INVALID` or `AUTH_EXPIRED`. Surface the provider error, mark the session spawn as failed, and tell the user to fix credentials. Do **not** silently downgrade from SDK to CLI.  
   **Disagreement with Gemini:** Silent provider downgrade changes privacy, latency, and behavior. That is unacceptable.

18. **Two oracle sessions simultaneously: allowed / what if `spawn_oracle` is called while one is active:** Only **one active oracle session per repository** in v1. If `spawn_oracle` is called with the same `session_name`, return the existing session. If called with a different name while one is active, return `SESSION_ALREADY_ACTIVE`.  
   **Disagreement with Gemini:** Gemini said auto-dismiss and replace. I disagree. Implicitly killing live state is the wrong behavior.

## Group 6: Indexer

19. **`< 100ms per file` on what hardware:** Apple Silicon M2 Pro, 32 GB RAM, local NVMe SSD, warm ONNX model, files under 200 KB. That number is not a generic guarantee.

20. **Which file extensions are indexed:** Fast path indexes `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`, `.md`, and `.mdx`. Slow-path symbol graphing runs only on the JS/TS family, not Markdown.

21. **Which directories are excluded / no `.gitignore`:** Respect `.gitignore` if it exists. If it does not, use hardcoded defaults: `.git`, `.svn`, `.hg`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.cache`, `.pythia`, `.obsidian`, `Pythia`, and any directory matched by common package-manager stores.

22. **Max file size / what happens to a 10MB generated file:** Hard cap at **1 MiB** per file for v1 indexing. A 10 MB generated file is skipped entirely, recorded in index-state as skipped, and never embedded or graphed.

23. **What is a "batch":** A batch is the dirty-file set produced by one `sync_workspace` scan, executed in transactional groups of up to **64 files**. The slow path is scheduled per committed group.

24. **Worker Thread crashes: what happens:** The main process records the batch as failed, leaves already committed fast-path writes intact, respawns the worker, and retries the failed group on the next sync pass or explicit `pythia_force_index`. No process-wide crash.

## Group 7: Database

25. **`lcs_chunks.last_modified`: file hash or timestamp:** BLAKE3 content hash. The column should be renamed to `content_hash`. The current name is wrong.

26. **`pythia_sessions` missing `session_name`: where is it stored:** In the database. Add `session_name TEXT NOT NULL` to `pythia_sessions`, plus a uniqueness rule for active sessions in a repository.

27. **`pythia_transcripts.content`: JSON schema / max size / max turns:** Store JSON envelopes with this schema:
   `{"text": string, "context_chunk_ids": string[], "tool_calls": [{"name": string, "args": object}] | [], "tool_result": string | null, "provider": {"model": string, "chars_in": number, "chars_out": number} | null}`.
   Hard cap each `content` payload at **256 KB**. There is **no turn cap** in v1; session length is bounded by storage, not by application logic.

28. **MADR ID race condition fix:** Replace `SELECT COUNT(*) + 1` with an `INTEGER PRIMARY KEY AUTOINCREMENT` sequence and derive the public ID inside the same transaction as `MADR-%03d`.  
   **Disagreement with Gemini:** Gemini proposed ULIDs. I disagree. Human-readable sequential MADR IDs are the better fit here.

29. **What is `generation_id`:** The monotonic oracle-generation number that authored the memory. Generation 1 is the first spawned oracle for a repo. It increments only on reconstitution, and every memory or transcript written by that daemon generation carries that number.

30. **Where is `PRAGMA journal_mode=WAL` set:** In the SQLite connection factory, immediately after opening the DB and before migrations or any writes. Every process that opens the DB, including worker threads, must execute it.

## Group 8: Obsidian

31. **`.obsidian/Pythia/` is wrong. Correct path:** `<repo>/Pythia/`. `.obsidian` is for Obsidian app settings, not user content.  
   **Disagreement with Gemini:** Gemini used `<repo>/Pythia-Memories/`. I disagree. `Pythia/` is shorter, cleaner, and sufficient.

32. **User edits MADR in Obsidian: what happens to SQLite:** Nothing. SQLite remains the source of truth. User edits create drift in the Markdown export and are overwritten on the next render of that MADR.

33. **Dataview plugin: hard dependency or optional:** Optional. The Markdown must stay readable without Dataview.

34. **Obsidian disabled entirely: config option:** Yes. Use `.pythia/config.json` with `"obsidian": { "enabled": false }`.

35. **MADR slug generation from title:** `MADR-<zero-padded-seq>-<kebab-case-title>.md`, lowercase ASCII only, punctuation stripped, repeated dashes collapsed, truncated to 80 characters after the prefix.

## Group 9: Failure Modes

36. **`lcs.db` deleted: full rebuild / how long:** Yes, full rebuild. Budget **5 to 10 minutes for a 100k LOC JS/TS repo** and **25 to 40 minutes for a 500k LOC monorepo** on the benchmark hardware in answer 19.  
   **Disagreement with Gemini:** Gemini's 45-minute estimate is too pessimistic for the stated baseline.

37. **MCP crashes mid-index: SQLite state:** The in-flight transaction rolls back. Prior committed batches remain valid. On restart, the scanner re-detects dirty files and continues.

38. **Gemini API down: error, retry, fallback:** Retry three times with exponential backoff at 1s, 5s, and 15s. If all retries fail, return `PROVIDER_UNAVAILABLE` as a retryable tool error. Fallback to a different provider happens only if config is explicitly `provider: "auto"`.  
   **Disagreement with Gemini:** Gemini pushed retry responsibility entirely to the caller. I disagree. Provider-level transient retry belongs in the provider wrapper.

39. **No auth on MCP server: intentional:** Yes, because v1 is a local stdio MCP server, not a network listener. If this ever becomes TCP- or HTTP-exposed, auth stops being optional.

40. **Schema migration strategy between versions:** Versioned forward-only SQL migrations for relational schema, plus rebuilds for derived indexes. `lcs_chunks`, `pythia_memories`, `pythia_sessions`, and `pythia_transcripts` are durable and must be migrated in place. `vec_*`, FTS, and graph projections can be dropped and rebuilt.  
   **Disagreement with Gemini:** Wipe-and-rebuild is wrong because this database stores durable memory, not just cache data.

## Group 10: Scope

41. **TS Compiler API on `.js` / `.jsx` / `.tsx`:** Yes. Use a TypeScript program with `allowJs: true`. Graph extraction runs on `.js`, `.jsx`, `.ts`, `.tsx`, `.mts`, `.cts`, `.mjs`, and `.cjs`.

42. **One `lcs.db` for multiple repos:** No. One `.pythia/lcs.db` per repository root.

43. **Monorepos: one `.pythia` or one per package:** One `.pythia` at the monorepo root. Package boundaries are represented inside the index; they do not get separate databases in v1.

44. **Does `lcs_investigate` index `README.md` and comments:** Yes. Markdown files, including `README.md`, are indexed as document chunks. Source comments remain inside the chunk content and therefore are searchable and embeddable, but they are not separate graph nodes.

45. **Gemini CLI in an open-source tool: TOS violation:** No, provided the tool shells out to the official CLI on the user's machine and uses the user's own authenticated account. Do not embed shared credentials, proxy requests through your own service, or misrepresent the dependency.
