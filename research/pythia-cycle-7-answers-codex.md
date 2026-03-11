## Q1
**Decision:** The final `pythia_memories` definition in §6 is:
```sql
CREATE TABLE pythia_memories (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    generation_id INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    context_and_problem TEXT NOT NULL,
    decision_drivers TEXT NOT NULL,
    considered_options TEXT NOT NULL,
    decision_outcome TEXT NOT NULL,
    supersedes_madr TEXT,
    FOREIGN KEY(supersedes_madr) REFERENCES pythia_memories(id)
);
```

**Rationale:** §17.2 is the canonical end-state schema and supersedes the stale §6 version. `seq` is the authoritative sequence source; `id` is a derived public identifier and must be `UNIQUE`, not the primary key.

## Q2
**Decision:** `file_scan_cache` is authoritative for CDC decisions, and it must be updated inside the same SQLite sync transaction, immediately before commit.

**Rationale:** §18.17 created `file_scan_cache` specifically as the per-file CDC state, while `lcs_chunks.content_hash` is per-chunk and can legitimately be stale after soft-delete. Updating the cache outside the transaction would let CDC advance even if chunk/vector/FTS writes roll back, which is wrong.

## Q3
**Decision:** Yes, an `idle` session has had its live provider state dismissed. A later `ask_oracle` must re-spawn the provider for that same session from persisted MADRs, not reactivate a still-running provider.

**Rationale:** §12.4 explicitly says the inactivity reaper executes `dismiss()`, and `dismiss()` is the provider teardown primitive. §14.5 also says transcripts are not replayed during reconstitution, so reactivation is from durable memory state, not transcript playback.

## Q4
**Decision:** A `doc` chunk means a repository documentation chunk, not a standalone JSDoc/TSDoc comment node. It is triggered by documentation files such as `.md`/`.mdx`, with CNI format `<path>::doc::<heading-slug>#L<line>` or `<path>::doc::default` if there is no heading.

**Rationale:** Tree-sitter TypeScript does not give you stable comment AST nodes suitable for first-class chunk identity, while the spec clearly wants retrievable documentation alongside code. Treating docs as file-based documentation chunks keeps `doc` deterministic and avoids attaching fragile standalone CNIs to comment trivia.

## Q5
**Decision:** `CONTAINS` edges belong in the Fast Path and should be inserted in the same transaction that writes the module/function/class chunks.

**Rationale:** The Fast Path already has the Tree-sitter structural information needed to emit module-to-symbol hierarchy edges cheaply. Deferring `CONTAINS` to the Slow Path would create an unnecessary window where structural traversal is incomplete even though the chunks already exist.

## Q6
**Decision:** Structural traversal returns the same plain-text per-chunk block format as §14.13, with an added lightweight metadata line per result indicating traversal depth and incoming edge. Structural results are capped at 50 nodes in breadth-first order.

**Rationale:** Reusing one output contract keeps the tool surface stable and machine-parseable across intents. The 50-node cap is necessary because a depth-6 bidirectional traversal can otherwise explode far beyond the semantic top-12 budget.

## Q7
**Decision:** Premium FalkorDB requires a Python sidecar process managed by the Node.js MCP server through the `GraphStore` adapter; there is no normative direct Node binding in the spec.

**Rationale:** §7 explicitly names FalkorDBLite as embedded Python, while the rest of the system is TypeScript/Node.js. The clean design is a supervised sidecar owned by the MCP server lifecycle, started only when Premium graph mode is configured.

## Q8
**Decision:** The 30-minute idle TTL should be configurable, with `30` as the default. Add a config field such as `limits.session_idle_ttl_minutes`.

**Rationale:** §12.4 gives the operational default, but §13.18 already established a config-driven limits model. Idle TTL is operational policy, not a schema invariant, so hardcoding it is unnecessary rigidity.

## Q9
**Decision:** In v1 the result cap is fixed and not caller-configurable: `lcs_investigate` returns at most 12 chunks whether called directly or via `ask_oracle`.

**Rationale:** The public tool schema in §5 deliberately has no `limit` parameter, and §16.5 explicitly refused adding new public routing parameters. If the caller wants fewer than 12, it trims client-side; if it wants more, that is a future schema change.

## Q10
**Decision:** Yes, the Slow Path supports `.js` and `.jsx` through `tsserver` inferred projects. If no `tsconfig.json` exists, `tsserver` uses inferred-project resolution defaults; unsupported non-JS/TS files are skipped by the Slow Path.

**Rationale:** The TypeScript language service natively handles JavaScript with `allowJs`/inferred project behavior, so a JS-heavy repo is not excluded. The Slow Path is TypeScript-compiler-based, not universal, so non-TS/JS artifacts are outside its scope.

## Q11
**Decision:** `oracle_commit_decision` is not idempotent in v1; a retried identical submission creates a new MADR row with a new `seq` and `id`. If strict idempotency is needed later, it must be added explicitly via an `idempotency_key`, not inferred heuristically.

**Rationale:** The current tool schema and table design have no idempotency field or unique decision fingerprint. Silent duplicate-detection on semantic content would risk collapsing legitimately separate but similar decisions.

## Q12
**Decision:** The retry loop is owned by the MCP server process via a background scheduler, and queued jobs are replayed on next boot by loading `<repo>/.pythia/obsidian-retry-queue.json`.

**Rationale:** §15.1 defines a background retry loop, and §17.4 makes the queue file durable across crashes with atomic replace semantics. That means restarts do not lose jobs; they resume from persisted queue state.

## Q13
**Decision:** Use UUID v4 for `pythia_sessions.id`.

**Rationale:** §11.3 only requires an opaque UUID, and v4 better matches the spec's security posture because it reveals no timestamp ordering. There is no operational need in the design for time-sortable session IDs.

## Q14
**Decision:** If `pythia_force_index.path` points to a missing file, it returns `INVALID_PATH`; it does not silently no-op and it does not trigger delete-handling from that direct file call.

**Rationale:** §17.16 explicitly says nonexistent paths fail immediately with `INVALID_PATH`. Soft-delete flow belongs to workspace or directory scans that compare the filesystem against `file_scan_cache`, not to a bad direct-file invocation.

## Q15
**Decision:** The trigger SQL is:
```sql
CREATE TRIGGER trg_graph_edges_validate_before_insert
BEFORE INSERT ON graph_edges
FOR EACH ROW
BEGIN
    SELECT CASE
        WHEN
            NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.source_id)
            AND
            NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.source_id)
        THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT')
    END;

    SELECT CASE
        WHEN
            NOT EXISTS (SELECT 1 FROM lcs_chunks WHERE id = NEW.target_id)
            AND
            NOT EXISTS (SELECT 1 FROM pythia_memories WHERE id = NEW.target_id)
        THEN RAISE(ABORT, 'INVALID_GRAPH_ENDPOINT')
    END;
END;
```

**Rationale:** §18.9 made trigger-plus-app-precheck the binding design. This is the minimal exact trigger that enforces polymorphic endpoint validity with four indexed existence checks per insert.

## Q16
**Decision:** Sprint 3 proof requires working `tsserver` integration; hand-inserted edges are acceptable for an earlier CTE unit test, but they do not satisfy the Sprint 3 proof gate.

**Rationale:** §10 defines Sprint 3 as "The Graph Engine & Slow Path" and explicitly includes TypeScript Compiler API integration plus extraction of `CALLS` and `IMPORTS`. A proof that bypasses the extraction pipeline would validate only the SQL, not the sprint objective.

## Q17
**Decision:** No. A configured-but-temporarily-inaccessible vault is an availability failure, not "no vault configured." SQLite commit still succeeds, the write is queued for retry, and the response should surface a non-fatal Obsidian warning.

**Rationale:** §13.10's silent disable rule is appropriate for true no-vault configurations. Once an explicit vault path is configured, transient unavailability belongs under the retry-queue path defined in §§14.12 and 15.1.

## Q18
**Decision:** No. `pythia init` does not create an oracle session; session creation is always an explicit `spawn_oracle` call.

**Rationale:** §16.4 scopes `pythia init` to repo/database/bootstrap/indexing work, and §9 makes generation reconstitution a separate step triggered by `spawn_oracle`. Auto-creating a session during init would violate the spec's explicit session lifecycle.

## Q19
**Decision:** The dual-query overhead is acceptable in v1; keep the sequential keyword-first then trigram-fallback behavior. Do not add a direct-to-trigram pre-check shortcut in the binding spec.

**Rationale:** §17.5 is the later canonical routing rule and intentionally prefers exact-keyword precision first. Both FTS queries are local SQLite operations, so the fallback cost is small compared with adding more routing complexity prematurely.

## Q20
**Decision:** Pythia v1 is distributed as an npm CLI package for individual developers, with `pythia start`, `pythia init`, and `pythia mcp install claude-code` as the normative install path. Homebrew and standalone binaries are non-normative future packaging options.

**Rationale:** §12.2 already assumes a CLI install command, and §16.6 says migrations are bundled in `src/migrations/` inside the npm package. The design reads as a developer-installed local tool, not a centrally administered team appliance.
