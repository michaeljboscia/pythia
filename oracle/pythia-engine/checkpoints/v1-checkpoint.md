# Pythia-Engine Generation 1 Knowledge Checkpoint

## 1. Architectural and Strategic Decisions
During the Generation 1 lifecycle, several critical architectural patterns and structural decisions were solidified to ensure the stability, concurrency, and fault tolerance of the oracle system:

*   **`state.json` Taxonomy:** The schema for the oracle's state has been strictly organized into five functional groups to separate concerns:
    *   *Core Identity:* `schema_version`, `oracle_name`, `version`, `spawned_at`, `generation_since_reground`.
    *   *Daemon Pool:* `daemon_id`, `session_name`, `session_dir`, `status`, `query_count`, `chars_in/out`, `last_query_at`, `last_synced_interaction_id`, `idle_timeout_ms`, `last_corpus_sync_hash`, `pending_syncs`.
    *   *Pressure Metrics:* `discovered_context_window`, `session_chars_at_spawn`, `chars_per_token_estimate`, `token_count_method`, `estimated_total_tokens`, `estimated_cluster_tokens`, `tokens_remaining`.
    *   *Lifecycle/Locking:* `query_count`, `last_checkpoint_path`, `status`, `last_error`, `last_bootstrap_ack`, `lock_held_by`, `lock_expires_at`.
    *   *Concurrency:* `next_seq`, `state_version`, `updated_at`.
    *   *Strategic Rule:* Every field in the `state.json` schema is bound to a specific mutating trigger mapped via FEAT references.
*   **The Checkpoint Pipeline (20-Step Lock-and-Execute):** The `oracle_checkpoint` flow is highly defensive. It utilizes a Compare-And-Swap (CAS) `writeStateWithRetry` lock accompanied by a 60-second lock heartbeat. It introduces a critical "headroom gate" (checking `tokens_remaining >= headroom/4`) before invoking the daemon, and utilizes a cascading extraction pattern (tags → scrub → raw) to ensure the LLM output is safely parsed. The write process itself relies on atomic file operations (tmp → rename) and Git synchronicity.
*   **Decision #44 - Cascading Fallback for Reconstitution:** The `oracle_reconstitute` process implements a strict "do no harm" hard-abort sequence. If the standard checkpoint step fails *and* the salvage fallback fails, the system immediately returns `RECONSTITUTE_FAILED`. Instead of executing a shrink-to-zero phase that would destroy pool members, it preserves the current generation `v(N)` entirely, transitioning the oracle status to "error" and appending a dual-failure message to `last_error`.

## 2. Key Insights and Findings
*   **Concurrency Requires Heartbeats:** Relying simply on locks for long-running LLM processes like checkpointing is dangerous. Implementing a 60s `startLockHeartbeat` during the 20-step checkpoint flow prevents system deadlocks while waiting for the LLM to generate the `CHECKPOINT_PROMPT` response.
*   **Predictive Token Gating:** The "headroom gate" (`tokens_remaining >= headroom/4`) during checkpointing ensures that the oracle never attempts to summarize itself when it lacks the context window to actually complete the response, preventing mid-thought truncation and corrupted state saves.
*   **Atomic Persistence is Non-Negotiable:** Because `state.json` governs the entire daemon pool and concurrency sequence (`next_seq`), all state mutations must be retryable CAS operations. Similarly, writing artifacts uses the `atomicWriteFile` (tmp → rename) methodology to prevent incomplete disk writes if the node crashes during an I/O operation.

## 3. Open Questions and Areas of Uncertainty
*   **Heartbeat Timeout Thresholds:** Will the 60s lock heartbeat interval remain sufficient if the active daemon member experiences extreme latency during `askDaemon` for the `CHECKPOINT_PROMPT`?
*   **Headroom Calibration:** Is the `headroom/4` gate universally safe across all supported LLM models, or does `chars_per_token_estimate` variance between models require dynamically adjusting this denominator?
*   **Reconstitution Salvage Rates:** How frequently do we expect the primary reconstitution to fail and fall back to the "salvage" route? What are the primary underlying causes of a dual-failure that triggers Decision #44?

## 4. Immediate Directives for the Next Generation
Welcome to the active generation of `pythia-engine`. Upon starting your session, you must understand the following:
*   **You exist within a highly defensive concurrency model.** When mutating state or reading pressure metrics, rely on the fact that `state_version` and `next_seq` are managed by CAS mechanisms. Never bypass `writeStateWithRetry`.
*   **Understand your bounds.** Keep a close eye on your Pressure Metrics, specifically `tokens_remaining`. Checkpointing is locked behind a strict context window gate; if you bloat your context too fast, you may crash before you can be reconstituted.
*   **Your survival is prioritized over forced progression.** If you are asked to reconstitute into the next generation and you fail, you will not be deleted. Decision #44 ensures your generation will survive fully intact in an "error" state for human/system intervention.
*   **Follow the Checkpoint Cascade:** If you are the active daemon responding to `CHECKPOINT_PROMPT`, remember that the system extracts your response via a cascading pattern: `<checkpoint>` tags first, scrubbing second, raw output last. Always output your structural summaries cleanly inside tags to ensure safe extraction.