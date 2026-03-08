# JSONL interaction logging for AI oracle systems

**A JSONL append-only log, designed with event sourcing principles, can serve as both a replayable state machine and a long-term knowledge substrate for a single-user AI oracle — but only if the schema captures enough to reconstruct state, not just narrate it.** The gap between a naive log (`{question, answer, timestamp}`) and a production-grade one spans roughly 30 additional fields across seven categories: hierarchy, timing, model provenance, token economics, causal links, quality signals, and schema versioning. The good news: your current schema already covers the hardest conceptual ground (confidence scoring, feedback loops, decision tracking). What follows maps exactly what to add, why, and how to keep it all manageable for years.

---

## What production observability systems actually track

Every major AI tracing platform — LangSmith, LangFuse, Arize Phoenix (via OpenInference), Braintrust, W&B Weave, and the emerging OpenTelemetry GenAI semantic conventions — converges on a **trace → span → event hierarchy** as the fundamental data model. A trace represents a complete interaction (your "consultation"), spans represent sub-operations within it (LLM calls, tool invocations, retrieval steps), and events are point-in-time annotations within spans. Your current flat schema maps to a single-span trace with no children — which is fine for an oracle that issues one LLM call per consultation, but leaves no room for multi-step reasoning chains.

The fields that matter beyond the obvious, drawn from real platform schemas:

**Identity and causality.** LangSmith uses a `dotted_order` string encoding the full ancestry path (`<timestamp>Z<run_id>.<child_timestamp>Z<child_id>`) — clever for lexicographic sorting of hierarchical traces. LangFuse and OpenInference use `trace_id`, `span_id`, and `parent_observation_id` for tree structure. For your oracle, the critical addition is a **`parent_id` or `caused_by` field** linking decisions that spawned follow-up consultations. Your current schema tracks `references` but not causal chains — add `caused_by: [list of entry IDs]` to close this gap.

**Model provenance.** OpenTelemetry's GenAI conventions distinguish between `gen_ai.request.model` (what you asked for) and `gen_ai.response.model` (what actually ran) — these can differ when providers silently route to different model versions. LangFuse tracks `prompt_name` and `prompt_version` to link generations to managed prompt templates. Braintrust auto-captures **cached tokens and reasoning tokens** separately from prompt/completion tokens, which matters for cost tracking with models that use extended thinking.

**Token economics and latency.** Every platform tracks `prompt_tokens`, `completion_tokens`, `total_tokens`, and estimated cost. LangSmith, Braintrust, and LangFuse all capture `first_token_time` (time-to-first-token for streaming calls) and `duration_ms`. These aren't vanity metrics — they're essential for detecting model degradation over time and catching API billing anomalies.

**Quality signals.** LangFuse's score system is the most mature: each score has a `name`, `value` (numeric), `source` (API, ANNOTATION, or EVAL), `data_type` (numeric, categorical, boolean), and links to score configs with min/max validation. Your **confidence 1-5** field maps to this, but production systems track multiple independent quality dimensions (relevance, factuality, helpfulness) with explicit source attribution. Consider expanding confidence into a `scores` object: `{"confidence": {"value": 4, "source": "self"}, "implemented_successfully": {"value": true, "source": "user_feedback"}}`.

**Schema versioning.** None of the platforms include a per-record schema version — they handle evolution at the API level. But for a long-lived JSONL system, **a `_v` field on every record is non-negotiable**. Event sourcing literature universally recommends this, with "upcasters" that transform old schema versions to new ones during read/replay.

Here's what your enhanced schema should look like, mapping your existing fields to production patterns:

```jsonl
{"_v":1,"id":"uuid","seq":1042,"type":"consultation","caused_by":["uuid-of-triggering-entry"],"session_id":"s_abc","timestamp":"2026-03-08T14:30:00Z","duration_ms":2340,"model":{"provider":"anthropic","requested":"claude-3.5-sonnet","actual":"claude-3.5-sonnet-20260301","temperature":0.7},"usage":{"prompt_tokens":1250,"completion_tokens":430,"total_tokens":1680,"cost_usd":0.0089},"question":"full question text","answer_full":"complete response","answer_summary":"brief summary","decision":"what was decided","scores":{"confidence":{"value":4,"source":"self"},"relevance":{"value":0.92,"source":"llm_judge"}},"tags":["architecture","scaling"],"references":["uuid-1","uuid-2"],"context":{"prompt_version":"oracle_v3","app_version":"0.8.1"}}
```

---

## Making logs replayable, not just readable

The distinction between a **replayable log** (deterministic state reconstruction) and a **readable log** (human audit trail) is the most consequential design decision for a long-lived oracle. Database Write-Ahead Logs and event sourcing patterns provide the blueprint.

PostgreSQL's WAL works because of four properties: it's **append-only** (no modifications), **sequentially ordered** (monotonic Log Sequence Numbers, not just timestamps), **checkpointed** (periodic snapshots of full state), and **deterministically replayable** (same WAL from same checkpoint yields same state). SQLite's WAL mode demonstrates the same pattern in embedded form — new changes append to a WAL file while readers see consistent snapshots, with periodic checkpointing that merges accumulated changes back.

The direct mapping to your JSONL log: treat it as an append-only WAL where the canonical replay function is `fold(initial_state, events) → final_state`. This requires three additions your current schema lacks:

**Sequence numbers, not just timestamps.** Timestamps are metadata for humans; monotonic sequence numbers (`seq: 1, 2, 3...`) are the ordering mechanism for machines. Jay Kreps, writing about LinkedIn's log infrastructure, observed that "the time stamps that index the log now act as the clock for the state of the replicas — you can describe each replica by a single number." For a single-user system, a simple auto-incrementing integer suffices. Gap detection becomes trivial: if seq 47 follows seq 45, you know something is wrong.

**Full input/output capture.** Your `answer_summary` field makes the log readable but not replayable. The LLM is non-deterministic — you cannot re-call it during replay and expect the same response. Store the **complete response** in `answer_full` alongside the summary. Martin Fowler's event sourcing principle is explicit: "Replaying events becomes problematic when results depend on interactions with outside systems." His solution: record all external responses for replay.

**State hashes for integrity verification.** The ESAA framework (a 2026 paper applying event sourcing to LLM agents, arXiv:2602.23193) includes `state_hash_before` and `state_hash_after` on every state-changing event. This enables a `verify` command that replays the entire log and checks that computed hashes match recorded ones — catching corruption, bugs, and drift. For a single-user oracle, hash your accumulated beliefs/decisions state at each consultation.

Greg Young, the architect of EventStoreDB and originator of CQRS, emphasized that **events are immutable facts**: "An event is a fact that happened at a point in time with the understanding of it from that point in time. A new understanding would be a new fact." Never update a JSONL entry. Corrections are new events. If a consultation's confidence was reassessed, emit a `feedback` entry pointing to the original, not a modified original.

The **snapshot + replay** pattern from databases applies directly. Periodically write a snapshot of accumulated oracle state (all current beliefs, active decisions, knowledge summary) as a special JSONL entry. To reconstruct state at any point: load the most recent snapshot before that point, then replay subsequent events. Start with per-session snapshots. The Marten framework's guidance applies: "Don't introduce snapshots until you actually encounter performance issues" — design for it, but don't over-engineer early.

**CQRS completes the pattern.** Your JSONL log is write-optimized. For read-heavy queries ("what decisions relate to topic X?", "what's my current belief about Y?"), maintain materialized projections — derived JSON files rebuilt from the event log. These projections are disposable and reconstructible. Think of them as database indexes: useful for speed, but the log is the source of truth.

---

## From flat logs to connected knowledge graphs

Transforming JSONL interaction logs into a knowledge graph preserves relationships that flat files obscure: causality chains, conceptual evolution, and the temporal structure of how understanding developed. The Event Knowledge Graph (EKG) model, formalized by Esser and Fahland for process mining, provides the foundational pattern: each log entry becomes an **Event node**, extracted entities become **Entity nodes**, and relationships between them form typed edges.

For an AI oracle, the node types that matter are: **Decisions** (your `type: consultation` entries with decisions), **Questions** (unresolved inquiries), **Concepts** (topics that recur across consultations), **Sessions** (temporal groupings), and **Episodes** (raw log entries preserved for provenance). Edge types include `CAUSED_BY` (decision A led to decision B), `SUPERSEDES` (new decision replaces old), `REFERENCES` (consultation referenced prior work), `INFORMED_BY` (episodic provenance), and `CONTRADICTS` (beliefs in tension).

**Architecture Decision Records map naturally to graph structures.** Michael Nygard's ADR format (Title, Status, Context, Decision, Consequences) already implies a state machine (`Proposed → Accepted → Deprecated/Superseded`) and inter-record relationships (`SUPERSEDES`, `AMENDS`, `DEPENDS_ON`). Your oracle's consultations with decisions are effectively ADRs. Storing them as graph nodes with explicit lifecycle edges enables queries impossible in flat logs: "Show me the chain of decisions that led to the current architecture" or "What decisions have been superseded and why?"

The most relevant production system is **Graphiti** (from Zep), a temporally-aware knowledge graph engine designed specifically for agent memory. Its key innovation is a **bi-temporal model**: each fact (edge) carries four timestamps — `t_created` and `t_expired` (when the system learned/forgot it) plus `t_valid` and `t_invalid` (when the fact was actually true). This enables point-in-time queries: "What did the oracle believe on January 15th?" When new facts contradict existing ones, old edges get invalidated rather than deleted. On the DMR benchmark, Graphiti achieves **94.8% accuracy** versus MemGPT's 93.4%.

**MemGPT/Letta's tiered memory architecture** offers a complementary pattern. It uses an OS-inspired hierarchy: **core memory** (small, always in context — key facts about the user and agent persona), **recall memory** (searchable conversation history), and **archival memory** (vector-indexed long-term storage). The agent self-manages memory via tool calls, deciding what to promote from raw interaction history to structured knowledge. For your oracle, this suggests a pipeline: raw JSONL → extracted entities and relationships → core beliefs (always-loaded summary), with the oracle itself participating in deciding what gets promoted.

A practical pipeline for your system would process new JSONL entries incrementally: extract entities (decisions, concepts, people mentioned) via lightweight NLP or LLM-based extraction, resolve them against existing graph nodes using embedding similarity, create typed edges based on explicit fields (`references`, `caused_by`) and inferred relationships, and apply temporal metadata. **KuzuDB** (an embedded graph database, Cypher-compatible, zero server overhead) or even **NetworkX** (Python, in-memory, fine for <100K nodes) are appropriate for a single-user system — Neo4j is overkill unless you need its query optimizer at scale.

---

## JSONL scaling stays comfortable longer than you'd think

For a single-user oracle accumulating entries over years, JSONL's practical limits are generous. **At 10,000 entries of ~2KB each (~20 MB), every tool is instant.** The real question is what happens at 50,000–100,000+ entries across years of operation.

**grep and ripgrep remain fast at absurd scales.** Ripgrep searches a 13.5 GB file in ~6.7 seconds on NVMe storage. A 100 MB JSONL file completes a text search in well under one second. For your oracle's lifetime volume, grep will never be the bottleneck.

**jq is where pain starts.** jq parses every JSON object, making it CPU-bound rather than I/O-bound. Practical thresholds: under 10 MB is instant; **10–100 MB takes 1–10 seconds** per query (fine for occasional use, annoying for exploration); 100 MB–1 GB takes 10–60+ seconds. The critical optimization: **pre-filter with grep, pipe to jq**. `rg '"tag":"important"' data.jsonl | jq '.timestamp'` is orders of magnitude faster than `jq 'select(.tag == "important") | .timestamp' data.jsonl` because grep eliminates non-matching lines before jq parses anything.

**The SQLite + JSONL combination is the optimal architecture for your use case.** Store lightweight index fields (id, timestamp, type, tags, file path, line number) in SQLite while keeping full records in JSONL. SQLite's JSON functions (since 3.38) support generated virtual columns with indexes on JSON fields, and the newer JSONB format (since 3.45) is **20× faster** than text JSON for queries. This gives you indexed lookups by any field without abandoning JSONL's grep-ability and plain-text durability.

**DuckDB is the analytics complement.** It reads JSONL natively with `SELECT * FROM 'data/*.jsonl'`, supports glob patterns across rotated files, handles gzipped JSONL directly, and parallelizes reads automatically. Benchmarks show it processing 4.4 million records from 24 gzipped JSONL files in **7.3 seconds**. For ad-hoc analytical queries ("how many consultations per month?", "what's the average confidence by topic?"), DuckDB is unmatched.

For compression, **zstd is the clear winner over gzip**: 3× faster compression, 3× faster decompression, and slightly better ratios. For JSON specifically, zstd's dictionary training on similar records yields **2–5× additional improvement** — training a 64KB dictionary on a few thousand sample entries dramatically improves compression of small, structurally similar JSON objects. Keep active files uncompressed for grep-ability; compress on rotation with `zstd -3` for recent files and `zstd -19` for annual archives.

The scaling roadmap is straightforward:

- **Phase 1 (0–10K entries, <20 MB):** Single JSONL file, jq for everything, no index needed
- **Phase 2 (10K–50K, 20–100 MB):** Add SQLite index, start quarterly rotation, use `rg | jq` pattern
- **Phase 3 (50K–200K, 100–400 MB):** Monthly rotation keeping files under 50 MB, SQLite essential for cross-file lookups, DuckDB for analytics, zstd compression of archives
- **Phase 4 (200K+, 400 MB+):** Full toolchain with automated rotation, DuckDB for all analytical work, annual Parquet snapshots via `COPY (SELECT * FROM read_ndjson('data/2024-*.jsonl')) TO 'archive/2024.parquet'`

A recommended file layout:

```
oracle/
├── data/
│   ├── current.jsonl              # Active, append-only
│   ├── 2025-Q1.jsonl              # Rotated quarterly
│   ├── 2025-Q2.jsonl
│   └── archive/
│       ├── 2024.jsonl.zst         # Compressed old years
│       └── 2024.parquet           # Analytical archive
├── index.db                        # SQLite: id, seq, timestamp, type, tags → file:line
├── snapshots/
│   └── state_at_seq_1000.json     # Periodic full state snapshots
└── SCHEMA_CHANGELOG.md            # Document every schema version change
```

---

## Conclusion

Your existing schema is conceptually sound — confidence scoring, feedback tracking, and decision logging put you ahead of most ad-hoc implementations. The highest-value additions are: a **`_v` schema version field** on every entry (non-negotiable for longevity), a **`seq` monotonic sequence number** (enables deterministic replay and gap detection), a **`caused_by` causal link** (transforms a flat log into a decision graph), **full response capture** alongside summaries (makes the log replayable, not just readable), and **model provenance fields** (provider, model version, parameters — essential for understanding why past outputs looked the way they did).

The architectural insight from event sourcing is that your JSONL log isn't just a record — it's a **state machine's transaction log**. Treat it as append-only, derive all read models as projections, and design every entry to answer: "Given this entry and all prior entries, could I reconstruct exactly what the oracle knew and believed at this moment?" If yes, you have a replayable log that will remain useful for years. If merely readable, you have an audit trail that grows less valuable as context fades. The difference is roughly ten additional fields per entry and the discipline to never summarize away information the future might need.