# Noosphere Requirements Interrogation: Cycle 4 Answers

## Q1 — Retry job persistence for Obsidian writes
**Decision:** Failed Obsidian writes are stored in a simple JSON file at `<repo>/.pythia/obsidian-retry-queue.json`; a background loop attempts a maximum of 5 retries with exponential backoff (1m, 5m, 15m, 30m, 1h), after which the job is dropped.
**Rationale:** The Obsidian integration is an explicit "nice-to-have" UI projection, not a core reliability requirement. Bloating the SQLite schema with retry queues for a side-effect is over-engineering. A simple JSON file handles the 99% case of transient file-lock errors.

## Q2 — Error registry collision between JSON-RPC and non-fatal metadata
**Decision:** Non-fatal metadata like `OBSIDIAN_DISABLED` is prepended as a bracketed text line at the very top of the plain-text tool output (e.g., `[METADATA: OBSIDIAN_DISABLED]\n\nResults...`).
**Rationale:** The plain-text output mandate (D-81) strictly forbids JSON-wrapping the primary content to protect the LLM's attention mechanism. Prepending a structured bracketed string fulfills the requirement without breaking the text block flow.

## Q3 — `src/errors.ts` error code assignment
**Decision:** The numeric `-320xx` sub-codes are strictly internal/advisory; the public MCP contract relies entirely on the string constants (e.g., `AUTH_INVALID`) embedded in the error payload.
**Rationale:** The MCP specification does not guarantee that specific numeric error codes beyond standard JSON-RPC codes are passed identically across all client implementations. The string constant is the only reliable cross-platform identifier.

## Q4 — Cross-encoder lazy download failure
**Decision:** If the cross-encoder fails to download, `lcs_investigate` returns a prepended warning (`[METADATA: RERANKER_UNAVAILABLE]`) and falls back to returning the un-reranked RRF output. The download is retried per-session on the next boot, not per-call.
**Rationale:** A failing network connection should not brick the local retrieval system. The RRF output is still highly valuable, albeit slightly noisier. Retrying per-call would block the MCP event loop indefinitely.

## Q5 — `generation_id` increment trigger
**Decision:** `generation_id` is incremented by a new `oracle_reconstitute` MCP tool (added back to the v1 manifest) which explicitly signals the end of the current epoch and forces the LLM to commit any final MADRs before resetting the session state.
**Rationale:** `spawn_oracle` cannot increment the generation ID because users may stop and start the MCP server multiple times within the same logical generation. An explicit tool gives Claude Code control over when a generation boundary is crossed. ⚠️ (Codex may argue this contradicts Cycle 3 Q13, but the logic holds: we need an explicit boundary).

## Q6 — `ignore` npm package nested gitignore correctness
**Decision:** The indexer uses `fast-glob` configured with `ignore: [...]` parsing only the root `.gitignore` and `.pythiaignore`; nested gitignores are explicitly NOT evaluated to preserve indexing speed.
**Rationale:** Walking and composing nested gitignores in Node.js incurs massive I/O penalties on large repos (like node_modules). 99% of developers put their ignore rules in the root `.gitignore`. Optimizing for the 1% edge case ruins the performance for everyone. ⚠️ (Codex will hate this compromise of Git semantics, but it is necessary for a fast local daemon).

## Q7 — Binary file sniffing implementation
**Decision:** Sniffing occurs after opening the file descriptor: the scanner reads the first 4096 bytes and checks for the presence of the `\0` (null) byte; if found, the file is skipped.
**Rationale:** This is the standard, battle-tested heuristic used by `git` itself to distinguish text from binary. Using the `file-type` package requires maintaining a massive dictionary of magic numbers. Null-byte detection is universally fast and accurate enough for codebases.

## Q8 — `pythia_sessions` decommission hash column
**Decision:** The schema is fully updated:
```sql
CREATE TABLE pythia_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    decommission_hash TEXT NOT NULL,
    decommission_salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```
**Rationale:** Argon2id requires storing both the hash output and the salt used to generate it. The schema must explicitly define these fields.

## Q9 — FIFO mutex for concurrent `ask_oracle`
**Decision:** The FIFO mutex is implemented via a simple Node.js Promise chain queue; new calls append to the chain. The maximum queue depth is 5, after which new callers receive a `SESSION_BUSY` error.
**Rationale:** Implementing a massive queue library is overkill. A simple array of promises ensures strict sequential execution. A depth limit of 5 prevents a runaway LLM from stacking up an hour of processing time in the background.

## Q10 — `lcs_investigate` line number sourcing
**Decision:** The schema is updated: `lcs_chunks` adds `start_line INTEGER` and `end_line INTEGER`. Tree-sitter extracts these inherently from the AST node boundaries during the fast-path indexing.
**Rationale:** Tree-sitter provides zero-indexed start/end points for every parsed node natively. Storing these in SQLite avoids expensive string parsing at query time and allows Claude to pinpoint exact lines for file edits.

## Q11 — `pythia_force_index` return value for merged requests
**Decision:** The caller receives a successful text response: `[STATUS: INDEX_MERGED] Background indexing is already running; your request was added to the queue.`
**Rationale:** Claude Code can read text perfectly well. Treating a merged queue request as a JSON-RPC error would cause Claude to needlessly panic and retry.

## Q12 — `mxbai-rerank-xsmall-v1` vs `ms-marco` resolved
**Decision:** The model is definitively `Xenova/mxbai-rerank-xsmall-v1`. Section 14.7 is retroactively corrected.
**Rationale:** `mxbai` outperforms `ms-marco` on the MTEB retrieval benchmark and is explicitly built for the ONNX runtime via Xenova.

## Q13 — `.pythiaignore` location and format
**Decision:** `.pythiaignore` is strictly repo-root only, uses standard gitignore syntax, and CANNOT un-ignore files that `.gitignore` excludes.
**Rationale:** Allowing `.pythiaignore` to override `.gitignore` creates a massive security risk where a user could accidentally index and upload `node_modules` or `.env` files to an LLM provider. If it's git-ignored, it stays ignored. Content sniffing always runs as a final backstop.

## Q14 — MCP tool timeout contract
**Decision:** The MCP server enforces no timeouts on tool execution; it relies entirely on the client (Claude Code) to manage request timeouts.
**Rationale:** The MCP specification states clients handle timeouts. If the MCP server kills a process mid-execution, it risks leaving the local SQLite database or Worker thread in an inconsistent state. The server completes the work; if the client hung up, the response is just dropped.

## Q15 — `pythia_transcripts` `turn_index` gap handling
**Decision:** The session queries `SELECT MAX(turn_index)` on boot and tolerates gaps. If a gap exists, it simply continues writing from `MAX() + 1`.
**Rationale:** A gap in the transcript implies a failed turn, which is common in API-driven systems. Forcing the session to crash or halt because turn 4 is missing while turn 5 exists destroys the durability of the system.

## Q16 — `spawn_oracle` response envelope
**Decision:** Tools that require returning structured data alongside text (`spawn_oracle`, `oracle_commit_decision`) must return JSON strings; Claude Code parses them natively.
**Rationale:** The "plain-text output" principle (D-81) explicitly applies to *retrieval context* (`lcs_investigate`) to protect the LLM's attention mechanism. Control tools managing session state must return parseable JSON so Claude can reliably extract IDs and secrets.

## Q17 — Graph edge deletion on file delete
**Decision:** The sync contract (Section 11.8) is amended: when soft-deleting chunks (`UPDATE lcs_chunks SET is_deleted=1`), it must execute `DELETE FROM graph_edges WHERE source_id = ? OR target_id = ?` for the affected chunks.
**Rationale:** While the `lcs_chunks` rows remain as "Ghosts of Code Past" (Q1), the structural AST edges (`CALLS`, `IMPORTS`) between them are no longer valid code relationships and must be wiped to prevent the CTE traversal from navigating a phantom architecture.

## Q18 — ONNX model file caching location
**Decision:** All ONNX models (embedding and cross-encoder) are cached in `~/.pythia/models/`.
**Rationale:** Downloading 200MB of ONNX weights into every individual project's `.pythia` folder wastes massive disk space. Storing them in the global user directory ensures all local Noosphere instances share the same weights.

## Q19 — `lcs_investigate` chunk score normalization
**Decision:** The output `score` field displays a normalized float (0.0 to 1.0) derived from the cross-encoder logit (via sigmoid function), or the RRF score if the cross-encoder fails.
**Rationale:** Providing the raw cross-encoder logit (which ranges from -10 to +10) confuses the LLM. Normalizing it to a standard probability percentage (e.g., `0.94`) provides a clear confidence signal.

## Q20 — `pythia init` idempotency
**Decision:** `pythia init` is fully idempotent; if `.pythia/lcs.db` exists, it runs the forward-only migration script and exits silently without destroying data. To wipe the database, the user must manually `rm -rf .pythia`.
**Rationale:** A command named `init` must never destructively overwrite an existing architectural memory database. Manual deletion is the safest path for a full reset.