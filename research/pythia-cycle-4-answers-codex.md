## Q1
**Decision:** Persist Obsidian retry jobs in `/Users/mikeboscia/pythia/.pythia/obsidian-retry-queue.json` and drop each job after a maximum of 5 retries.

## Q2
**Decision:** Return non-fatal metadata like `OBSIDIAN_DISABLED` as a prepended bracketed text line at the top of the plain-text response.

## Q3
**Decision:** Treat `-320xx` numeric sub-codes as advisory internal codes only, not as a stable public wire contract.

## Q4
**Decision:** If the cross-encoder download fails, return the fused RRF ordering and do not fail the entire `lcs_investigate` call.

## Q5
**Decision:** `generation_id` increments when `spawn_oracle` creates a genuinely new generation, and an idempotent attach to an existing active session does not increment it.

## Q6
**Decision:** Honor nested `.gitignore` semantics across the full tree rather than using a root-only ignore parse.

## Q7
**Decision:** Sniff binary files by reading the first 4096 bytes and skipping any file containing a null byte.

## Q8
**Decision:** Use `CREATE TABLE pythia_sessions ( id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, decommission_hash TEXT, decommission_salt TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL );` as the canonical table definition.

## Q9
**Decision:** Implement the per-session FIFO mutex with a simple Node.js promise chain and do not impose a rejection depth cap, because callers should wait rather than be bounced.

## Q10
**Decision:** Add `start_line` and `end_line` columns to `lcs_chunks` and persist line spans at index time.

## Q11
**Decision:** Return merged `pythia_force_index` results as a plain-text `[STATUS: ...]` string rather than as JSON metadata.

## Q12
**Decision:** Pin the cross-encoder to `Xenova/ms-marco-MiniLM-L-6-v2`.

## Q13
**Decision:** Support `.pythiaignore` only at the repository root.

## Q14
**Decision:** The client owns timeout management, and the MCP server does not impose an additional public tool timeout contract.

## Q15
**Decision:** Tolerate `turn_index` gaps after a crash and resume from `MAX(turn_index) + 1`.

## Q16
**Decision:** `spawn_oracle` must return a JSON object, not plain text with embedded values.

## Q17
**Decision:** Delete stale `graph_edges` explicitly inside the sync transaction when a file is soft-deleted.

## Q18
**Decision:** Cache ONNX models globally in `~/.pythia/models/`.

## Q19
**Decision:** Expose the `lcs_investigate` score as a normalized `0.0` to `1.0` sigmoid float.

## Q20
**Decision:** Make `pythia init` idempotent by running forward-only migrations when the database already exists.
