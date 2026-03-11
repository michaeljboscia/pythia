# Noosphere Requirements Interrogation: The Hard Answers

This document resolves the 45 critical questions raised against the Noosphere Master Design Specification. These answers constitute binding engineering decisions.

### GROUP 1: Who Is This For?
1. **Target User:** The primary user is a **solo developer** working on a long-lived project. Multi-user concurrent sync across distributed machines is explicitly out of scope.
2. **The Specific Gap:** Cursor and Copilot are stateless code completion tools. Noosphere is a **stateful architectural memory**. It remembers *why* a decision was made 3 months ago (via MADR checkpoints) and enforces that structural context when generating new code.
3. **Measuring Hallucination:** Measured via "Faithfulness" using an automated LLM-as-a-judge script against a committed 50-question "Golden Set" (`eval_golden_set.json`). The acceptable failure rate is <5%.
4. **Out of Scope for v1:** Multi-user sync, remote hosted databases, non-TypeScript language support for the semantic LSP graph, and global community detection (LightRAG map-reduce).

### GROUP 2: The "Local" Claim
5. **Data Transmission:** **Yes**, user code is transmitted to Google's API (via the CLI or SDK) during inference. This must be explicitly disclosed in the CLI boot sequence and the README.
6. **Local Model Setting:** There is no local LLM reasoning option (like Ollama) in v1. The system is called "local" because the **vector index, graph database, and episodic memory** live entirely on the local filesystem, avoiding third-party vector databases.

### GROUP 3: Internal Contradictions
7. **Indexing Trigger (Sec 4 vs 11.5):** **Section 11.5 governs.** Git hooks and time-based polling are dropped. The system uses a unified mtime/BLAKE3 hash file scanner.
8. **Warm Start (Sec 9 vs 11.5):** **Section 11.5 governs.** "git diff" is dropped. Warm start scans the directory and compares mtime/BLAKE3 hashes against the database.
9. **lcs_communities Table:** **It is NOT in the database.** It is officially removed from the schema for v1.

### GROUP 4: Installation
10. **Installation Method:** Installed via npm as a global package: `npm install -g pythia-engine`.
11. **File Footprint:**
    *   Global config: `~/.pythia/config.json`
    *   Project DB: `<project-root>/.pythia/lcs.db`
    *   Obsidian folder: `<project-root>/Pythia-Memories/` (if enabled)
    *   CLI state: `~/.gemini/tmp/daemon-<name>` (if CLI provider is used)
12. **The Executable:** `pythia` is a global Node.js binary provided by the npm package.
13. **Registration:** **Yes.** Running `pythia init` automatically registers the MCP server command in the user's Claude Code `settings.json` (or `~/.claude.json`).

### GROUP 5: The ReasoningProvider
14. **CLI Not Installed:** If the fallback CLI provider is active and `gemini` is not found in the PATH, the MCP server throws a fatal error on `spawn_oracle` with instructions to `npm install -g @google/gemini-cli`.
15. **Context Window Limits:** The maximum combined context size passed to `spawn()` is 200,000 characters. If exceeded, the MCP server truncates the least-relevant chunks (based on vector score) before invoking the provider.
16. **Dismissal:** `dismiss()` is called manually via the `oracle_decommission` tool, or automatically by a 24-hour inactivity TTL managed by the MCP server.
17. **Invalid API Key:** If the SDK throws a 401 Unauthorized, the MCP server catches it, logs a warning to Claude, and **auto-downgrades** the session to use the CLI fallback provider.
18. **Simultaneous Sessions:** **No.** The MCP server holds an active lock. If `spawn_oracle` is called while a session is active, the old session is automatically dismissed and replaced.

### GROUP 6: The Indexer
19. **Performance Baseline:** "< 100ms per file" assumes Apple Silicon (M-series). On minimum-spec hardware (e.g., older Intel i5), the ONNX embedding process takes ~500ms per file.
20. **File Extensions:** `.ts`, `.tsx`, `.js`, `.jsx`, and `.md`.
21. **Exclusions:** Respects `.gitignore`. If missing, hardcoded defaults apply: `node_modules`, `dist`, `build`, `.git`, `.pythia`.
22. **Max File Size:** 1MB. Files larger than this (e.g., bundled outputs) are skipped, and a warning is logged.
23. **Batch Definition:** A batch is executed when 50 files have been modified, or after 5 seconds of filesystem inactivity, whichever comes first.
24. **Worker Crash:** If the Worker Thread crashes (e.g., OOM), the Main thread catches the `error` event, logs it, marks the current batch as failed, and spawns a new worker thread.

### GROUP 7: The Database
25. **`last_modified` Column:** It stores the BLAKE3 hash. The spec is amended: the column must be renamed to `content_hash`.
26. **Session Name:** The spec is amended. Add `session_name TEXT NOT NULL` to the `pythia_sessions` table.
27. **Transcript Content:** JSON string: `{ prompt: string, response: string, context_refs: string[] }`.
28. **MADR ID Race Condition:** `SELECT COUNT(*)+1` is dropped. MADR IDs will be generated using a timestamp-based ULID (e.g., `MADR-01ARZ3NDEKTSV4RRFFQ69G5FAV`).
29. **Generation ID:** Incremented explicitly. When Claude calls `spawn_oracle`, it calculates the new ID using `SELECT MAX(generation_id) + 1 FROM pythia_memories`.
30. **WAL Mode:** Set immediately on boot. `db.exec('PRAGMA journal_mode = WAL;');` runs when the SQLite connection opens in both Main and Worker threads.

### GROUP 8: Obsidian
31. **Vault Location:** Codex is correct. Settings go in `.obsidian`. Pythia memories go in a user-visible folder at the project root: `<project-root>/Pythia-Memories/`.
32. **User Edits:** **One-way sync only.** If Pythia updates a MADR, it overwrites the markdown file. Manual user edits in Obsidian are overwritten and are not synced back to SQLite.
33. **Dataview Dependency:** **Optional.** YAML frontmatter is injected, but the Markdown is perfectly readable without the Dataview plugin.
34. **Disable Obsidian:** **Yes.** Managed via `"obsidian_sync": false` in `~/.pythia/config.json`.
35. **Slug Generation:** `MADR-{timestamp}-{kebab-case-title}.md`, truncated to 50 characters, stripping special characters.

### GROUP 9: Failure Modes
36. **Corruption:** If `lcs.db` is corrupted, delete the `.pythia` folder and run `pythia init`. On a 500K-line repo, a full ONNX rebuild takes ~45 minutes on modern hardware.
37. **Mid-Index Crash:** Handled flawlessly by SQLite. Because the sync contract uses `BEGIN TRANSACTION`, a crash drops the connection and OS-level rollback occurs. No partial state.
38. **API Down:** The MCP server returns a standard tool error (e.g., `503 Service Unavailable`) back to Claude. Claude determines the retry logic.
39. **No Auth:** Intentional. The MCP server binds exclusively to `127.0.0.1` (localhost).
40. **Schema Migration:** **Wipe and rebuild.** For v1, the local database is treated as an ephemeral cache. There are no complex migration scripts.

### GROUP 10: Scope Boundaries
41. **TS Compiler API:** **Yes.** It fully processes JS, JSX, and TSX files, provided `allowJs: true` is configured in `tsconfig.json`.
42. **Multiple Repos:** **No.** One `.pythia/lcs.db` per repository.
43. **Monorepos:** One shared `.pythia` directory at the absolute root of the monorepo workspace.
44. **Investigating MD Files:** **Yes.** `lcs_investigate` chunks `.md` files by header (H1/H2) and embeds them alongside the code.
45. **TOS Violation:** **No.** The open-source wrapper executes on the user's machine using their personal OAuth credentials. It does not proxy API traffic or bypass authentication.