# Noosphere Requirements Interrogation: Cycle 7 Answers

## Q1 — Final `pythia_memories` Schema in §6
**Decision:** The §6 canonical schema must be updated to match §17.2, replacing `id TEXT PRIMARY KEY` with `seq INTEGER PRIMARY KEY AUTOINCREMENT` and `id TEXT NOT NULL UNIQUE`.
**Rationale:** The spec mandates that §17.2 is the canonical and final `pythia_memories` table definition. Section 6 must be updated to reflect the final agreed-upon schema for Sprint 1 to avoid developer confusion.

## Q2 — CDC Authority and `file_scan_cache` Update Timing
**Decision:** `file_scan_cache` is authoritative for CDC file-level change detection; it is updated inside the exact same SQLite transaction as the chunk operations after the chunks are processed.
**Rationale:** `file_scan_cache` tracks the file state as a whole, avoiding redundant aggregations over `lcs_chunks`. Updating it inside the same atomic sync block guarantees it never falls out of sync with the parsed chunks or soft-deletes.

## Q3 — Idle Session Reactivate vs. Respawn
**Decision:** If the 30-minute reaper executes `dismiss()`, the session transitions to `idle` (provider terminated) and a subsequent `ask_oracle` automatically respawns the provider state using the `pythia_transcripts` history.
**Rationale:** The 30-minute TTL frees system resources (like the CLI daemon or SDK memory) when the developer steps away. Seamlessly respawning from the transcript ensures the LLM caller's UX is uninterrupted while respecting local resource constraints.

## Q4 — CNI and `chunk_type` for Doc Chunks
**Decision:** A doc chunk is triggered by a standalone Markdown file (`.md`) and uses `chunk_type="doc"` with CNI format `<path>::doc::<header-slug>`.
**Rationale:** JSDoc/TSDoc comments are inherently bound to the AST node they describe (function, class) and are included in that node's chunk content, not separated. Standalone `.md` files (like ADRs or READMEs) get chunked by header into standalone `doc` chunks.

## Q5 — `CONTAINS` Edge Insertion Pipeline
**Decision:** `CONTAINS` edges are inserted by the Fast Path (Tree-sitter) synchronously during the chunking phase.
**Rationale:** Hierarchy (module contains class, class contains method) is purely syntactic and immediately available from the Tree-sitter AST without needing the slow LSP type resolution. Inserting them in the Fast Path prevents any structural gap window.

## Q6 — Structural Traversal Output Format
**Decision:** Structural traversal returns a separate graph-listing format: plain-text edges (e.g., `src/A::func -> CALLS -> src/B::func`) plus the full text content of the nodes in the retrieved path, capped at 12 total nodes to respect the context limit.
**Rationale:** Returning just chunks loses the critical relationship context that structural intent specifically requested. The LLM needs both the content and the explicit topology to reason about the architecture effectively.

## Q7 — FalkorDBLite Integration
**Decision:** FalkorDBLite runs as a Python sidecar process managed by the MCP server using standard Node.js `child_process.spawn()`, communicating via a local TCP/HTTP socket.
**Rationale:** Since Noosphere is a Node.js ecosystem, Python dependencies must be isolated. A managed sidecar ensures the Premium graph database is spun up and shut down automatically with the MCP server lifecycle.

## Q8 — Reaper TTL Configuration
**Decision:** The 30-minute inactivity TTL is configurable via `limits.session_idle_ttl_minutes` in the config schema, with 30 as the default.
**Rationale:** Different hardware environments and developer workflows require flexibility. Hardcoding it forces developers into a one-size-fits-all constraint that might prematurely kill sessions on high-end machines.

## Q9 — `lcs_investigate` Result Limit Parameter
**Decision:** The 12-chunk cap is a fixed, internal hard limit to protect the context budget, and no `limit` parameter is exposed in the `lcs_investigate` schema.
**Rationale:** Exposing a limit parameter tempts the LLM to request 100 chunks, breaking the carefully tuned context budget and leading to downstream `CONTEXT_BUDGET_EXCEEDED` errors.

## Q10 — `tsserver` JavaScript Support
**Decision:** The Slow Path uses `tsserver` with `allowJs: true` to support `.js` and `.jsx` files; if no `tsconfig.json` exists, the Worker Thread auto-generates a default in-memory config.
**Rationale:** Many projects use JavaScript or migrate incrementally. Silent skipping would create massive blind spots in the architectural graph. `tsserver` natively handles JS well enough to extract imports and basic calls.

## Q11 — `oracle_commit_decision` Idempotency
**Decision:** Idempotency is required; duplicate detection checks if a MADR with the exact same `title` and `decision_outcome` already exists within the current `session_id`. If found, it returns the existing MADR ID.
**Rationale:** LLM tools often suffer from retry loops on transient network errors. Without idempotency, the database and Obsidian vault will be flooded with duplicate architectural decisions.

## Q12 — Obsidian Retry Loop Ownership
**Decision:** The MCP server process runs the retry loop via a lightweight `setInterval` timer on the Main Thread. In-flight jobs are persisted to `obsidian-retry-queue.json` and resumed on next boot.
**Rationale:** Obsidian writes are side-effects and do not block the event loop. A simple timer in the Main Thread is sufficient and avoids adding complexity to the SQLite Worker Thread.

## Q13 — UUID Version for `session_id`
**Decision:** Pythia uses UUID v7 (time-ordered) for `session_id`.
**Rationale:** UUID v7 embeds a timestamp, which dramatically improves SQLite insert performance and spatial locality on disk compared to the completely random UUID v4, especially in the `pythia_transcripts` table where sessions cluster temporally.

## Q14 — `pythia_force_index` on Deleted File
**Decision:** It triggers the soft-delete flow for that file (marking `is_deleted=1`, caching the delete in `file_scan_cache`, and cascading graph edge deletions) and returns a success status.
**Rationale:** If the user forces an index on a deleted file, it means the CDC scanner missed the deletion (perhaps due to a crash). The tool must act as a manual reconciliation trigger to clean up the stale index.

## Q15 — `graph_edges` Trigger SQL
**Decision:** The exact trigger SQL is:
```sql
CREATE TRIGGER validate_graph_edges BEFORE INSERT ON graph_edges
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.source_id)
         AND NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT: source_id not found')
    WHEN NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.target_id)
         AND NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.target_id)
    THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT: target_id not found')
  END;
END;
```
**Rationale:** This explicit `BEFORE INSERT` trigger correctly validates polymorphism against both valid node tables without requiring complex application-side read-before-write logic.

## Q16 — Sprint 3 Proof Requirement
**Decision:** Sprint 3 can use hand-inserted test edges in `graph_edges` to validate the CTE logic before the full `tsserver` integration is complete.
**Rationale:** Sprint milestones should decouple database query validation from complex external tool integrations. Proving the CTE traverses 4 hops correctly is independent of how the edges were extracted.

## Q17 — Temporarily Missing Vault
**Decision:** Pythia treats a temporarily missing vault exactly the same as "no vault configured", logging `OBSIDIAN_DISABLED` and continuing without adding jobs to the retry queue.
**Rationale:** A missing directory on boot is indistinguishable from an unconfigured feature. Filling up a retry queue because a USB drive is unplugged will create a massive backlog of stale writes that dump all at once when reconnected.

## Q18 — `pythia init` Session Creation
**Decision:** `pythia init` does NOT create an initial oracle session. The user (via Claude Code) always calls `spawn_oracle` explicitly.
**Rationale:** Sessions are ephemeral and tied to a specific coding task. Creating a "default" session on init violates the lifecycle design; the LLM should actively decide when it needs a reasoning daemon and what context it requires.

## Q19 — FTS Routing Overhead
**Decision:** The dual-query overhead is acceptable; the MCP server executes the keyword FTS query first, and if zero hits, executes the trigram fallback.
**Rationale:** SQLite FTS5 queries run in <1ms. Two sequential queries take ~2ms. Building a complex RegExp parser in TypeScript to perfectly guess CNI/quote syntax is brittle and unnecessary given the negligible query time.

## Q20 — Pythia Distribution
**Decision:** Pythia is distributed as a global npm package (`npm install -g @pythia/lcs`), targeting the individual developer as the primary installer.
**Rationale:** Since Noosphere relies heavily on Node.js, `tree-sitter`, and `tsserver`, distributing via `npm` ensures it runs in the same environment as the target TypeScript projects. It fits perfectly into a solo developer's existing toolchain.