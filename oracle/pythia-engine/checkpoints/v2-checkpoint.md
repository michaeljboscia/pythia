# Pythia-Engine Generation 2 Knowledge Checkpoint

## 1. Static Corpus Files & Key Architectural Findings

This generation was bootstrapped with 8 foundational artifacts. The architectural decisions and constraints expressed by these files are as follows:

*   **`pythia-persistent-oracle-design.md` (Design Spec v6)**
    *   *Decision:* **Version Control for Latent Space.** Oracle data is not stored in a centralized cloud DB; it lives in `<project>/oracle/` and is committed to the identical Git branch as the source code it governs.
    *   *Constraint:* **Pluggable Backend.** The Pythia daemon must never receive file paths to read on its own. All file I/O, hash verification, and token-gating must occur in the MCP layer (`resolveCorpusForSpawn`). The daemon is injected purely with text payloads. This guarantees a clean transition to a future Living Corpus System (RAG/Knowledge Graph).
    *   *Constraint:* **Generational Bounding.** The file `vN-interactions.jsonl` is an audit trail, not a bootstrap file. On reconstitution, the new generation loads the corpus + `vN-checkpoint.md` ONLY. This prevents context bloat over hundreds of consultations.

*   **`PRD.md` (Product Requirements Document)**
    *   *Decision:* **Human-Gated Destruction.** Oracle decommission requires a 7-step protocol including TOTP (via `pythia-auth` binary), screenshot review, typed confirmation with dynamic values, and a 5-minute cooling-off period. AI agents cannot autonomously destroy an oracle.
    *   *Decision:* **Zero-Loss Continuity.** The system must guarantee that `v(N+1)` inherits all architectural decisions from `v(N)`. If checkpointing fails, `oracle_salvage` uses a fresh API call to synthesize the JSONL interaction log into a checkpoint.

*   **`BACKEND_STRUCTURE.md`**
    *   *Constraint:* **Optimistic Concurrency.** All mutations to `state.json` must route through `writeStateWithRetry`, utilizing `state_version` as an optimistic concurrency counter (CAS).
    *   *Constraint:* **In-Memory Mutex.** Because the MCP SDK dispatches tool calls concurrently without awaiting, `GeminiRuntime` must implement an `async-mutex` to protect the daemon pool from memory corruption during simultaneous reads/writes.

*   **`APP_FLOW.md`**
    *   *Decision:* **Pool Scaling & Idle Sweeps.** The `pool_size` is a ceiling, not an always-on target. Daemons spawn on demand. An asynchronous 60-second sweep (`idleSweepInterval`) soft-dismisses members whose `last_query_at` age exceeds `idle_timeout_ms` (default 5 mins), preserving resources without losing session context.
    *   *Decision:* **Full Cutover Reconstitution.** Rolling replacements are forbidden. To prevent "split-brain" syndrome (where Daemon A gives different advice than Daemon B), reconstitution drains all queries, locks the oracle (`status: "preserving"`), soft-dismisses all members, and spawns `v(N+1)` from a clean slate simultaneously.

*   **`oracle-tools.ts` & `oracle-types.ts`**
    *   *Decision:* **Cascading Checkpoint Extraction.** LLMs exhibit formatting drift. Checkpoint extraction attempts `<checkpoint>` XML tag parsing first, falls back to scrubbing common LLM markdown/preamble wrappers, and uses the raw output as a last resort to guarantee data retention.
    *   *Decision:* **Batched Git Commits.** To prevent I/O bottlenecks during rapid consultations, interaction entries are appended to JSONL synchronously, but Git commits are deferred via `batchCommitLearnings()` (triggered at 10 entries, 256KB, or a 30s debounce).

*   **`LESSONS.md`**
    *   *Constraint:* **Manifest Read/Write Integrity.** In operations that write to the manifest (e.g., `oracle_salvage` writing a new checkpoint hash), the file *must* be re-read from disk prior to subsequent hash validations to prevent stale in-memory state from triggering a `HASH_MISMATCH`.
    *   *Constraint:* **Resume State Reset.** When `spawn_oracle` resumes a dismissed session, it must reset `last_query_at` to `now()`. Without this, the 60-second idle sweep instantly terminates the resumed daemon.
    *   *Constraint:* **Sync Gating.** `oracle_sync_corpus` must only update manifest tree hashes if the payload was actually delivered or queued to a daemon. If the pool is empty/dismissed, the manifest update must be skipped so the delta can be recalculated on the next spawn.

*   **`v1-checkpoint.md`**
    *   *Decision:* **Defensive Checkpoint Pipeline.** Checkpointing is a 20-step locked process that utilizes a 60-second heartbeat to prevent lock expiration. A "headroom gate" (`tokens_remaining >= headroom/4`) ensures the daemon has enough context available to generate the synthesis without truncation.
    *   *Decision:* **Do No Harm Fallback.** If `oracle_reconstitute` fails its live checkpoint attempt *and* the `oracle_salvage` fallback fails, the system hard-aborts, leaving `v(N)` entirely intact and setting `status: "error"`.

## 2. Questions Asked This Session & Answer Summaries
*   **Question:** The user bootstrapped the oracle corpus and immediately commanded: "Write your checkpoint inside `<checkpoint>` tags..."
*   **Summary:** No substantive architectural queries were asked by the orchestrator during Generation 2. This session functioned as an immediate pass-through/validation layer, confirming the engine's capability to ingest its own source code and legacy rules, and instantly write a `v2` checkpoint for the `v3` successor.

## 3. Architectural/Strategic Decisions Made Based on Counsel
*   *None.* Generation 2 was an instantaneous validation epoch. No new codebase decisions were influenced by Pythia in this session.

## 4. Top 10 Cross-Cutting Insights from the Full Corpus
1.  **Dual-Layered Concurrency is Mandatory:** The engine relies equally on in-memory locks (`async-mutex` on the singleton) and file-system Compare-And-Swap (`writeStateWithRetry`). Neglecting either results in corrupted state or split-brain daemons [Source: `BACKEND_STRUCTURE.md`, `oracle-tools.ts`].
2.  **Pressure is Evaluated at the Maximums, not Sums:** Because each pool member maintains its own independent Gemini context window, `estimated_total_tokens` is derived via `Math.max(...memberTokens)`. Summing tokens is useful for billing observability, but fatal for logic [Source: `pythia-persistent-oracle-design.md`, `oracle-types.ts`].
3.  **Absolute Headroom Trumps Percentages:** Context exhaustion is managed via an absolute token threshold (`checkpoint_headroom_tokens`, default 250k). This ensures safety scales predictably whether the model window is 1M or 10M tokens [Source: `pythia-persistent-oracle-design.md`].
4.  **Generational Bounds Prevent Context Collapse:** By forcing `vN-checkpoint.md` to completely supersede the previous generation's `vN-interactions.jsonl`, the context footprint is strictly bounded to `Corpus + 1 Document`. This is the core mechanic enabling infinite project persistence [Source: `pythia-persistent-oracle-design.md`, `APP_FLOW.md`].
5.  **Data Co-location Enforces Timeline Alignment:** By storing `manifest.json`, `state.json`, and interaction logs inside `<project>/oracle/`, the architectural reasoning is physically bound to the code. Branch switching in Git natively switches the Oracle's worldview [Source: `pythia-persistent-oracle-design.md`].
6.  **"Do No Harm" Cutover Logic:** The system strictly prefers a degraded or stalled state over data loss. Reconstitution failures, bootstrap confusion, or mid-checkpoint context limits all result in an `"error"` status that preserves existing processes and data rather than forcing a corrupt purge [Source: `v1-checkpoint.md`, `APP_FLOW.md`].
7.  **Physical Decommission Gates:** AI agents cannot delete oracles. The 7-step decommission protocol forces physical interaction (TOTP via terminal, Touch ID) and contextual awareness (reading dynamic values for confirmation), creating an unbreakable airgap for destructive operations [Source: `PRD.md`, `oracle-tools.ts`].
8.  **Stale State is the Primary Failure Mode:** Integration bugs consistently trace back to reading stale in-memory representations after disk writes (e.g., `manifest` hashes during `oracle_reconstitute`, or `last_query_at` drift). Re-hydrating from disk is always preferred over trusting cached objects [Source: `LESSONS.md`].
9.  **Temperature 0 is Generational Superglue:** The `oracle_checkpoint` prompt hardcodes `temperature: 0` during the LLM call. Even minimal variance introduces hallucinations that compound over 3-5 generations. Determinism in synthesis is critical [Source: `pythia-persistent-oracle-design.md`, Decision #51].
10. **File Verification Must Occur Post-Write:** Hashing an in-memory string prior to writing it (as seen in early `oracle_salvage` iterations) leads to `HASH_MISMATCH` errors due to encoding/newline normalization applied during atomic file writes. Always hash the persisted bytes [Source: `LESSONS.md`].

## 5. Gaps, Contradictions, or Uncertainties Detected
*   **Contradiction in Bootstrap Prompting:** The preamble injection logic contains a potential edge case. The user prompt stated "Generation: v2" while simultaneously injecting the `v1` preamble text: "This is your first generation. You have no prior checkpoint to inherit." The `buildSpawnPreamble` function must be audited to ensure it strictly respects the presence of `inheritedWisdom` when selecting the preamble string, overriding manual prompt text [Source: Session Transcript, `oracle-tools.ts`].
*   **Gap in Queue Persistence:** In `oracle_sync_corpus`, changes are queued in `pending_syncs` for daemons that are currently `"busy"`. If the daemon crashes or hangs, transitioning to `"dead"`, these pending syncs are lost when the slot is eventually respawned. It is uncertain if `pending_syncs` should be elevated to a persistent queue outside the ephemeral member state [Source: `APP_FLOW.md`, `oracle-types.ts`].
*   **Uncertainty in Headroom Calibration:** `tokens_remaining >= headroom/4` is used as a safety gate for checkpointing. However, `chars_per_token_estimate` can vary significantly across future models (e.g., dense code vs. prose). It is uncertain if a static `headroom/4` divisor is safe universally without dynamic calibration from `countTokens` API trends [Source: `v1-checkpoint.md`, `oracle-tools.ts`].
*   **Race Condition in Lock Heartbeats:** The `startLockHeartbeat` function extends TTL every 60 seconds. However, if the Node.js event loop becomes heavily blocked during a massive stream operation or JSON parsing event, the heartbeat may delay, risking an artificial lock orphan timeout. We may need to decouple heartbeats into a child worker [Source: `oracle-tools.ts`].