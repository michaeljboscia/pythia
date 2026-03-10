# RF-10: RAG Production Patterns

**Status:** Complete
**Researched via:** Gemini Search + Synthesis
**Date:** 2026-03-10

---

## Overview

This document maps proven production RAG architecture patterns and anti-patterns relevant to LCS. It covers what survives real workloads, changing corpora, and operational constraints, and produces a pragmatic implementation roadmap with phased complexity. Findings feed all ADRs and cross-reference PA-06 and EQ-01.

The central finding: RAG in 2024–2025 transitioned from naive linear pipelines to multi-stage systems with validation, observability, and fallback logic. Benchmark accuracy correlates poorly with production quality. The gap between academic results and operational reality is large, predictable, and solvable — but only if you design for it from the start.

---

## 1. High-Value Production Components

### 1.1 Hybrid Retrieval

Pure dense vector search fails under predictable conditions: out-of-vocabulary product IDs, exact acronyms, regulatory clause numbers, and short precise queries where semantic diffuseness hurts rather than helps. By 2024, hybrid search had become the production baseline, not an advanced feature.

The pattern: run BM25 (sparse keyword) and dense vector search in parallel, then fuse results using Reciprocal Rank Fusion (RRF). RRF assigns each document a score based on its rank in each result list rather than its raw score, making it robust to score-scale mismatches between retrieval methods.

**What this buys you:** Systems that handle both "what does the policy say about Section 4.2(b)" (keyword) and "what happens when a contractor misses a deadline" (semantic) without forcing a tradeoff. In LCS terms, this matters immediately: legal language is full of terms that break semantic retrievers — clause identifiers, defined terms, party names.

**Implementation cost:** Moderate. Requires a vector store with BM25 support (Elasticsearch, Weaviate, Qdrant hybrid mode, or pgvector + a separate BM25 index). RRF is a simple merge algorithm, not a learned model. No fine-tuning required.

**LCS recommendation:** Adopt in v1. The penalty for not doing this is measurable retrieval failures on exact-term queries that users will blame on "the AI being wrong."

### 1.2 Reranking (Two-Stage Retrieval)

Retrieve broad candidates. Rerank to a tight set. This is the most consistently high-ROI optimization in production RAG.

Stage 1 (broad retrieval): Hybrid search returns a candidate pool of 20–100 chunks — large enough to catch the right content, small enough to rerank cheaply.

Stage 2 (cross-encoder reranking): A cross-encoder model scores each candidate against the query jointly — not independently. Unlike bi-encoder embeddings (which encode query and document separately and then compare), cross-encoders see both simultaneously and capture token-level relevance interactions. Common choices: Cohere Rerank 3, Cohere Rerank 3.5, MonoT5, or open-source cross-encoders from sentence-transformers.

The result: filter 100 candidates down to 3–5 highly precise chunks. This reduces LLM context window consumption, cuts token cost, and avoids the "lost in the middle" phenomenon where LLMs fail to use relevant information when it appears in the middle of a long context.

**Quality lift:** Consistently reported >10% improvement in answer accuracy in production deployments that switched from single-stage retrieval.

**Latency cost:** The reranker adds 100–400ms depending on candidate pool size and model. This is offset by the smaller context passed to the LLM (fewer input tokens = faster generation).

**LCS recommendation:** Adopt in v1. Cohere Rerank 3 is the lowest-friction option if using an API stack. Self-hosted cross-encoders are viable for latency-sensitive or air-gapped deployments.

### 1.3 Grounding and Citation Enforcement

Ungrounded answers are a liability, not just an accuracy problem. In enterprise legal and regulatory contexts, a hallucinated citation or a plausible-but-unsourced claim can cause real harm.

Production grounding has two components:

**Inline citation generation:** Prompt the LLM to cite the specific chunk ID provided in the context for every factual claim. Each retrieved chunk gets a unique identifier (e.g., `[doc:123:chunk:4]`). The LLM is instructed to append the relevant chunk ID after each claim. The application layer then links these IDs to the source document and renders them as footnotes or hover-over references. This creates a traceable audit trail, not just a citation that sounds correct.

**Context sufficiency checks (pre-generation):** Before sending to the LLM, run a fast relevance check — either a lightweight classifier or a small LLM with structured JSON output — to ask: "Does any retrieved chunk actually contain information sufficient to answer this query?" If not, fail to a controlled response rather than letting the LLM improvise.

**Post-generation faithfulness checks:** After generation, an NLI (Natural Language Inference) model or evaluator LLM verifies that each claim in the response is entailed by the cited chunk. Claims that fail entailment get stripped or flagged. This is expensive at full throughput but highly effective when run on sampled traffic or high-stakes queries.

**LCS recommendation:** Inline citation generation is a v1 must-have. The context sufficiency check (a pre-generation relevance gate) is also v1. Full post-generation faithfulness checking is v1.5 — start with sampled async evaluation, move to inline for high-stakes queries in v2.

### 1.4 Quality Validation and Golden Dataset Evals

Without automated evaluation, quality degrades silently. The solution is a curated golden dataset: a static set of 100–500 representative queries with ground-truth answers and expected source chunks. This dataset runs on every code change, embedding model update, prompt change, and corpus ingestion event.

The golden dataset catches regressions before users see them. It is the RAG equivalent of a unit test suite. Without it, you are flying blind and discovering failures from user complaints.

**Building the dataset:** Either annotate manually from real queries (preferred — captures actual user intent) or synthetically generate question-answer pairs from the corpus using an LLM and then validate them. Ragas can generate synthetic testsets from documents.

**LCS recommendation:** Build the golden dataset before production launch. This is a v1 prerequisite, not an enhancement. Target 200+ queries across query types: exact-term lookup, multi-hop reasoning, definitions, edge cases, queries that should trigger refusal.

### 1.5 Semantic Caching

A semantic cache stores query embeddings alongside their generated answers. On incoming queries, the cache checks for a nearby vector (cosine similarity above a high threshold, e.g., 0.95–0.98). On cache hit, the stored answer is returned directly, bypassing retrieval and generation entirely.

**Latency impact:** Full pipeline: 2–10 seconds. Cache hit: <100 milliseconds. The difference is the combined cost of embedding + vector search + reranking + LLM TTFT + generation.

**Cost impact:** A cache hit costs only the embedding call (fractions of a cent). A cache miss costs the full pipeline including LLM tokens. For high-traffic workloads, this is the primary cost optimization lever.

**Production deployment:** Start in shadow mode — run both paths, log what the cache would have returned without serving it, compare quality offline. Then canary rollout at 5% traffic. Monitor cache hit rate and user satisfaction metrics together; a high hit rate with declining satisfaction means the threshold is too low (returning semantically similar but contextually wrong answers).

**Critical: multi-tenant isolation.** Never share cache pools across tenants. Partition by `tenant_id` as a hard metadata filter. A cached answer generated from Tenant A's documents must never surface for Tenant B.

**Invalidation:** Use event-driven TTLs — when a document is updated, invalidate the cache for the affected tenant/topic scope. Passive TTLs (24–72 hours) provide a fallback safety net.

**LCS recommendation:** v1.5. Get retrieval and generation quality right first. Add caching once the golden dataset confirms baseline quality is stable and you have traffic to make it meaningful.

---

## 2. Why Benchmark-Strong Patterns Fail in Production

Academic RAG benchmarks (TriviaQA, Natural Questions, MMLU, PopQA) test on clean, well-formatted text, static corpora, single-hop queries with clear correct answers, and unlimited latency budgets. Production violates all four assumptions simultaneously.

### The Benchmark-to-Production Transfer Failures

**Clean data assumption:** Wikipedia passages have consistent formatting, clear paragraph boundaries, and minimal noise. Enterprise data has scanned PDFs with OCR errors, nested tables, footnotes that interrupt prose, image-embedded text, and documents that are structurally ambiguous. A chunking strategy that achieves 85% precision on Wikipedia may achieve 50% on enterprise legal documents without domain-specific preprocessing.

**Static corpus assumption:** Benchmarks test against a fixed snapshot. Production corpora change continuously — documents are updated, superseded, retracted. A retriever trained or evaluated on one corpus snapshot degrades as the corpus drifts without re-evaluation.

**Single-hop query assumption:** Academic benchmarks favor retrievable single-fact queries. Real enterprise queries are often multi-hop ("what does the policy say about escalation when the standard process under Section 7 conflicts with the exception clause in Appendix B?"), requiring reasoning across multiple retrieved chunks. Simple dense retrieval handles single-hop well and multi-hop poorly.

**Latency immunity:** CRAG and Self-RAG show impressive benchmark gains (CRAG: +36.6% on PubHealth, Self-RAG improvements on PopQA). But a production CRAG or Self-RAG pipeline may require 5–25 LLM calls per query (evaluating retrieved chunks, rewriting queries, verifying outputs). That pushes end-to-end latency from 1 second to 5–10 seconds — unacceptable for interactive interfaces.

**The evaluator model gap:** CRAG's paper used a fine-tuned T5-large as the retrieval evaluator. In production, teams use fast cheap LLMs (GPT-4o-mini, Gemini Flash) as graders — which work on academic domain text but often misclassify dense legal or financial content, generating false negatives (discarding good context) or false positives (accepting hallucination-prone context).

**Key insight for LCS:** Do not adopt corrective RAG architectures (CRAG, Self-RAG) as v1 components based on benchmark numbers. Evaluate them against your actual corpus and your actual latency targets. The gains are real but context-dependent, and the cost is higher than papers suggest.

---

## 3. Production Failure Modes

### 3.1 Stale Context

**What it looks like:** The system confidently answers based on outdated information. A document was updated, but the vector index still holds the old embedding.

**Root cause:** Batch-based indexing pipelines (nightly or weekly syncs) create windows of staleness. Embeddings are expensive to regenerate at high frequency, so teams delay updates.

**Mitigations:**
- Event-driven indexing: when a document changes, immediately trigger deletion of old chunks and re-embedding of the new version. Do not wait for the next batch run.
- Metadata filtering: inject `valid_from` / `valid_until` timestamps into chunk metadata. Apply these as pre-retrieval filters so expired chunks never enter the candidate pool.
- Document versioning with source IDs: every chunk carries a unique `(document_id, version, chunk_index)` key. When a document is re-indexed, old chunks are deleted by document ID before new ones are inserted.

### 3.2 Citation Mismatch

**What it looks like:** The LLM generates a citation (e.g., `[Source 2]`) but the cited document either doesn't exist, wasn't in the retrieved context, or doesn't contain the information the answer claims it does.

**Root cause:** LLMs are completion engines, not databases. Given a system prompt demanding citations, they will generate plausible-looking citations from parametric memory even when the retrieved context doesn't support the claim.

**Mitigations:**
- Strict prompting: require the LLM to quote the exact relevant sentence before writing the citation. This forces the model to locate the evidence before claiming it.
- Post-generation entailment checks: verify each cited claim is entailed by the cited chunk using an NLI classifier or evaluator LLM.
- Chunk ID grounding: give every chunk a UUID passed directly in the prompt. Require citations to use these exact IDs, not free-text source names. Invalid UUIDs in the output are immediately detectable as hallucinated citations.

### 3.3 False Confidence

**What it looks like:** The LLM returns an authoritative, fluent, confidently-worded answer that is factually wrong or completely hallucinated. No hedging. No uncertainty signal.

**Root cause:** RLHF training optimizes for helpful-sounding outputs. When retrieval fails to surface relevant content, the LLM defaults to generating something rather than refusing — and it does so confidently.

**Mitigations:**
- Relevance gates: if the top reranker score falls below a threshold (e.g., 0.5), bypass the LLM entirely and return a canned refusal: "I couldn't find relevant information for this query."
- Explicit refusal prompting: engineer the system prompt to heavily reward the output "I don't have sufficient information in the provided context to answer this question." Few-shot examples of refusal improve refusal rate dramatically.
- Logprobs monitoring (where available): sudden drops in output token probability can indicate the model is guessing. Flag low-probability outputs for human review or automatic refusal.

### 3.4 Pipeline Drift

**What it looks like:** Performance degrades over weeks without any code changes. Retrieval quality degrades, answer accuracy drops, user satisfaction decreases.

**Root cause (three types):**
- *Data drift:* The corpus evolves. New document types are ingested that your chunking strategy handles poorly. Formatting changes break your parser. New jargon or terminology appears that your embedding model represents weakly.
- *Query drift:* User behavior changes. They start asking more complex multi-hop questions. A new user segment arrives with different query patterns your system wasn't evaluated on.
- *Model drift:* Your LLM or embedding provider silently updates the model behind your API endpoint. `gpt-4o` is not a pinned model. Its behavior changes without notice.

**Mitigations:**
- Pin all model versions explicitly: `gpt-4o-2024-05-13`, not `gpt-4o`. `text-embedding-3-small`, not `text-embedding-latest`.
- Shadow-test model upgrades: run new model versions on shadow traffic in parallel with production before switching. Compare golden dataset scores.
- Continuous query clustering: periodically cluster recent production queries to detect new topic clusters or intent shifts. Use this to update the golden dataset.

### 3.5 Silent Quality Degradation

This is the overarching failure mode — the one that makes all the others dangerous. RAG returns 200 OK while silently delivering worse answers. Traditional monitoring (error rates, latency, uptime) shows green while user satisfaction erodes.

**Root cause:** Without semantic evaluation, quality is invisible to standard monitoring. A 5% drop in retrieval precision this week and a 5% drop in LLM faithfulness next month each fly under the alert threshold individually. Together they represent a system 10% worse than launch — invisible without continuous evaluation.

**Mitigations:** This is entirely the observability and evaluation problem addressed in Section 4.

---

## 4. Observability: What to Track and Why

### 4.1 The Four Core RAGAS Metrics

RAGAS (Retrieval Augmented Generation Assessment) provides a framework for measuring RAG quality without requiring human annotations for every query. The four core metrics cover the full pipeline:

| Metric | What It Measures | Failure Signal |
|--------|-----------------|----------------|
| **Faithfulness** | Generated answer is strictly derived from retrieved context (no hallucination) | Drop = LLM hallucinating or bypassing context |
| **Answer Relevance** | Generated answer actually addresses the user's query | Drop = LLM rambling or missing intent |
| **Context Precision** | Retrieved chunks most relevant to query are ranked highest | Drop = retriever/reranker degraded |
| **Context Recall** | Retrieved chunks contain all information needed to answer | Drop = relevant content missing from corpus or retrieval window |

### 4.2 Offline Evaluation (CI/CD Gates)

Run the golden dataset through RAGAS on every:
- Prompt change
- Embedding model update
- Chunking strategy change
- Corpus ingestion event
- LLM version change

Set regression thresholds (e.g., Faithfulness must not drop below 0.88, Context Precision must stay above 0.80). If thresholds are breached, block the deployment.

This is the quality equivalent of failing a test suite in CI. No deployment proceeds without passing quality gates.

### 4.3 Online Evaluation (Production Sampling)

Running RAGAS on every production request adds unacceptable latency and cost. The production pattern: sample 1–10% of traffic asynchronously.

For each sampled trace:
1. Capture: user query, retrieved chunks (with scores), generated answer.
2. Route to an async evaluation queue.
3. Run RAGAS using a cheap fast evaluator model (GPT-4o-mini, Gemini Flash) — not the same model used for generation.
4. Write scores to an observability store.
5. Alert if 7-day rolling average of any metric drops by more than 10%.

### 4.4 Observability Stack Options

| Tool | Best For | Notes |
|------|----------|-------|
| **Langfuse** | Trace-level telemetry + RAGAS score attachment | Open-source, self-hostable, strong LangChain/LlamaIndex integration |
| **Arize Phoenix** | Drift detection, query clustering | Built specifically for LLM observability; native RAGAS integration |
| **LangSmith** | Deep LangChain debugging | Best tracing for LangChain-based pipelines; proprietary, adds cost |
| **Datadog LLM Obs** | Teams already on Datadog | APM + LLM metrics in one platform; higher setup cost |

For LCS, Langfuse or Arize Phoenix are the low-friction starting points. Both are open-source and self-hostable, avoiding vendor lock-in.

### 4.5 User Signal Integration

Combine automated RAGAS metrics with implicit and explicit user signals:
- Explicit: thumbs up/down, "regenerate" button, explicit correction
- Implicit: copy-paste rate (high = answer used), session abandonment after a specific query, follow-up rephrasing of the same question (suggests the first answer missed)

A high RAGAS Faithfulness score with declining thumbs-up rate indicates a gap between what the evaluator model considers faithful and what users consider useful. This is a signal to audit the RAGAS evaluation setup itself, not just the RAG pipeline.

### 4.6 Root Cause Segmentation

Don't just track global metrics. Segment by:
- Query type (definitional, procedural, comparative, multi-hop)
- Document source type (if corpus has heterogeneous document types)
- User cohort (if different user groups use the system differently)

Regressions almost always manifest in a specific segment before they appear globally. Segment-level alerts catch problems weeks earlier than aggregate alerts.

---

## 5. Advanced RAG Patterns

### 5.1 Self-RAG

Self-RAG trains a single language model to critique its own retrieval and generation using reflection tokens inserted during generation. The model asks itself:

1. `[Retrieve]` — do I need to retrieve at all?
2. `[IsRel]` — is this retrieved document relevant?
3. `[IsSup]` — is my draft supported by the retrieved document?
4. `[IsUse]` — is this draft useful to the user?

If any check fails, the model pauses, re-retrieves with a modified query, or rewrites the draft.

**Academic result:** Strong on open-domain QA benchmarks where factual grounding is the primary metric.

**Production reality:** Requires a fine-tuned model that can emit these reflection tokens — not plug-and-play with arbitrary LLMs. In production, teams emulate Self-RAG behavior using orchestration frameworks (LangGraph, LlamaIndex workflows) with separate grader LLM calls, which adds 3–8 additional LLM calls per query and pushes latency to 5–15 seconds. Reserve for async, non-interactive tasks: report generation, research synthesis, background document analysis.

**LCS recommendation:** v2 consideration for asynchronous deep-analysis tasks. Not appropriate for interactive query serving.

### 5.2 CRAG (Corrective RAG)

CRAG introduces a retrieval evaluator between the retriever and the generator. The evaluator grades retrieved documents as Correct, Incorrect, or Ambiguous:

- **Correct:** Proceed to generation with these chunks.
- **Incorrect:** Discard internal corpus results. Trigger fallback: expand search parameters, route to a web search API (Tavily, Google Search), or query a secondary data source.
- **Ambiguous:** Run a "decompose-then-recompose" step — extract high-confidence sentences from the chunks, discard low-confidence ones, and optionally combine with external search.

**Academic result:** +36.6% on PubHealth benchmark, significant gains on PopQA. The paper used a fine-tuned T5-large as the evaluator.

**Production implementation:** Use a fast cheap LLM (GPT-4o-mini, Gemini Flash) with structured JSON output as the grader rather than a fine-tuned model. This is more flexible and cheaper to maintain but requires prompt engineering to get accurate grading on your specific corpus domain.

**The key production benefit:** CRAG makes the fallback decision explicit and auditable. Rather than silently hallucinating when retrieval fails, the system has a defined circuit that routes to known-safe alternatives or returns a controlled refusal.

**LCS recommendation:** v1.5 for the core triage logic (gate on retrieval quality before generation). Full web fallback integration is v2.

### 5.3 FLARE (Forward-Looking Active Retrieval)

FLARE generates text iteratively. As the model writes, it monitors its own confidence (token probability) on upcoming sentences. When confidence drops below a threshold, it pauses, uses the draft generated so far as a query to retrieve new context, and then continues generation with the freshly retrieved information.

**Best use case:** Long-form document generation where the required context evolves as the output grows — technical reports, multi-section summaries, research synthesis tasks.

**Production limitation:** Requires access to token-level probabilities (logprobs), which not all API providers expose. Iterative retrieval during generation adds multiple round-trips, making streaming complex. User experience requires careful design — the user is waiting for output that's being generated non-linearly.

**LCS recommendation:** Experimental / v2. Applicable specifically if LCS develops a long-form synthesis feature (e.g., "generate a brief on this clause set"). Not appropriate for query-answer interactions.

---

## 6. Framework Comparison

### 6.1 LangChain

**Strengths:** Unmatched prototyping speed. Extensive integrations (200+ LLM providers, vector stores, tool integrations). LangGraph provides a robust orchestration layer for agentic workflows. LangSmith is the most mature LLM observability platform in the ecosystem.

**Production liabilities:**
- Highest framework-level latency. Deep abstraction layers add 50–200ms per LLM call. Complex agent loops can run 10–60 seconds.
- Historically notorious for breaking changes and version churn. The v0.2→v0.3 transition (late 2024) stabilized the core API but the pattern of rapid change has not fully resolved.
- Debugging raw LangChain chains is difficult due to nested abstractions. Production observability requires LangSmith (proprietary, adds cost).
- High base memory footprint: 500MB–2GB during vector operations.

**When to choose:** Complex multi-step agentic workflows. Teams willing to invest in the LangSmith observability stack. Rapid prototyping where production deployment is a later concern.

### 6.2 LlamaIndex

**Strengths:** Purpose-built for data ingestion, indexing, and retrieval. Exceptional for complex document types. 150+ LlamaHub data connectors. LlamaParse provides managed PDF and document parsing (offloading a major operational burden). 20–30% faster query times than more abstracted frameworks for pure retrieval workloads.

**Production liabilities:**
- As complexity scales (multi-tenant architectures, complex update workflows), operational burden increases.
- Observability requires third-party integration (Arize Phoenix, TruLens via callbacks) — not native.
- Newer agentic features evolve quickly, creating maintenance overhead for teams using them.

**When to choose:** Data-heavy RAG applications where ingestion pipeline complexity is the primary challenge. Teams who want retrieval precision without framework ceremony.

### 6.3 Haystack

**Strengths:** Lowest production operational overhead. DAG-based pipeline architecture enforces explicit, auditable component boundaries. Docker-native deployment support and built-in REST API endpoints out of the box. Structural observability — pipeline failures fail at named nodes, making debugging traceable without third-party tools. Strict semantic versioning minimizes maintenance burden. Least ongoing refactoring required.

**Production liabilities:**
- Less flexible for novel agentic patterns that don't fit a DAG structure.
- Smaller ecosystem than LangChain.
- Enterprise cloud tier (deepset Cloud) adds cost for managed observability.

**When to choose:** Enterprise production pipelines where stability, predictability, auditability, and low maintenance are the primary requirements. Regulated environments. Teams where engineering resources for ongoing maintenance are limited.

### 6.4 Custom Stacks

Many mature production teams eventually reduce framework usage and move toward custom retrieval pipelines using direct library calls (sentence-transformers, litellm, pgvector). The motivation: frameworks add abstraction tax, debugging overhead, and upgrade risk that custom code avoids.

**The trade:** Custom stacks eliminate framework lock-in and abstraction overhead but require teams to rebuild integrations, maintain component compatibility, and own observability from scratch.

**LCS recommendation:** Start with a framework (LlamaIndex or Haystack are the better production choices over LangChain for LCS's use case), then selectively eject from abstraction layers as specific bottlenecks are identified. Do not start custom — the development time cost is not justified at v1.

### 6.5 Framework Selection Summary for LCS

| Criterion | LangChain | LlamaIndex | Haystack |
|-----------|-----------|------------|----------|
| Ingestion complexity | Good | Best | Moderate |
| Retrieval precision | Good | Best | Good |
| Production stability | Moderate | Good | Best |
| Observability (native) | Via LangSmith | Via callbacks | Structural |
| Agentic support | Best | Good | Moderate |
| Maintenance burden | High | Moderate | Low |
| Latency overhead | High | Low | Low |

For LCS v1: LlamaIndex for data ingestion and retrieval; Haystack if the team prioritizes production stability and auditability over ecosystem breadth. LangChain is appropriate if complex multi-step agentic orchestration is a v1 requirement, with the explicit acceptance of higher operational cost.

---

## 7. Phased Implementation: v1 Must-Haves vs v2 Deferrals

### v1: Production Foundation (Must Ship)

The v1 stack delivers a reliable, auditable, observable RAG system. Every component here is either a direct quality requirement or a safety requirement.

| Component | Rationale |
|-----------|-----------|
| Hybrid retrieval (BM25 + dense + RRF) | Baseline for exact-term and semantic queries; failure mode without it is immediately user-visible |
| Cross-encoder reranking (top-100 → top-5) | High quality lift, justified cost; prevents context bloat and lost-in-middle failures |
| Context sufficiency gate (pre-generation) | Prevents generation when retrieval fails; cuts false confidence failures |
| Inline citation with chunk IDs | Traceability and auditability; required for enterprise trust |
| Explicit refusal on low-relevance queries | Safety requirement; "I don't know" is better than a confident hallucination |
| Golden dataset (200+ queries) | Regression gate in CI/CD; prerequisite for any deployment |
| RAGAS offline evaluation in CI | Catch regressions before users see them |
| Async RAGAS online sampling (1–5% traffic) | Detect production drift before it becomes visible |
| Langfuse or Arize Phoenix tracing | Full trace visibility; required to diagnose failures |
| Model version pinning | Prevent silent model drift |
| Event-driven document updates | Prevent stale context failures |
| Metadata timestamp filtering | Secondary staleness defense |

### v1.5: Quality Hardening (Next Quarter)

These components improve quality and operational robustness once the v1 foundation is validated.

| Component | Rationale |
|-----------|-----------|
| Post-generation faithfulness checks (sampled) | Catch citation mismatch and hallucination in production traces |
| CRAG-style retrieval triage | Explicit routing when retrieval quality is low; enables controlled fallback |
| Query clustering and segmented metrics | Earlier regression detection by query type and user cohort |
| User feedback integration (thumbs up/down) | Ground truth signal to calibrate automated evaluations |
| Semantic caching (shadow mode → canary → full) | Latency and cost reduction once baseline quality is confirmed stable |
| A/B testing infrastructure for prompt/retriever changes | Safe experimentation without full rollout risk |

### v2: Advanced Patterns (Future)

These patterns deliver meaningful gains but require a stable v1 baseline and significantly higher implementation investment.

| Component | Rationale |
|-----------|-----------|
| Self-RAG for async tasks | High-accuracy deep synthesis; unsuitable for interactive latency |
| Full CRAG with web fallback | Requires external search API integration and fallback quality evaluation |
| FLARE for long-form generation | Applicable to specific synthesis features, not general query-answer |
| GraphRAG for multi-hop reasoning | Complex infrastructure; justified only if multi-hop failures are measured and significant |
| Speculative RAG (drafter + verifier) | Quality at speed for specific high-value query types |
| Canary deployments for index/model changes | Requires deployment infrastructure maturity |

---

## 8. Anti-Pattern Catalog

These patterns appear reasonable in prototypes and fail in production. Codify these as explicit rejects before ADR implementation.

| Anti-Pattern | Why It Fails |
|-------------|-------------|
| **Semantic-only retrieval** | Fails on exact-term queries; LCS corpus has defined terms, clause IDs, and party names that require keyword search |
| **Top-k chunks directly to LLM (no reranking)** | Forces LLM to process irrelevant context; triggers lost-in-middle failures; inflates token costs |
| **No relevance threshold before generation** | Allows the LLM to generate when retrieval found nothing useful; root cause of most false confidence failures |
| **Batch-only index updates** | Creates staleness windows; users receive outdated answers with no warning |
| **Free-text citations ("see the policy document")** | Unverifiable; users cannot trace claims to sources; LLMs will fabricate citations |
| **Shared cache pools across tenants** | Cross-tenant information leakage; serious security vulnerability in multi-tenant deployments |
| **Floating model version references** | Silent model drift; "gpt-4o" is not a stable identifier; behavior changes without notice |
| **LLM-as-evaluator using the same model as generator** | Circular evaluation; the same biases that cause generation failures cause evaluation failures |
| **CRAG or Self-RAG for interactive latency requirements** | 5–15 second latency is not interactive; these patterns are async-only in most production contexts |
| **Vibes testing as the regression gate** | Manual review doesn't scale; regressions are missed until users complain |
| **Golden dataset from clean benchmarks only** | Academic data distribution doesn't match enterprise corpus; false confidence in quality scores |
| **Single-metric quality threshold** | A system can have high Faithfulness and low Context Recall simultaneously; use all four RAGAS dimensions |
| **No per-component tracing** | When quality regresses, you cannot identify which pipeline stage caused it without traces |

---

## 9. Release Gate Criteria (Alignment with EQ-01)

These criteria must be met before each phase gates to the next.

**v1 Launch Gate:**
- Golden dataset RAGAS scores: Faithfulness ≥ 0.88, Context Precision ≥ 0.80, Answer Relevance ≥ 0.82, Context Recall ≥ 0.75
- Refusal rate on out-of-scope queries ≥ 90%
- All model versions pinned and documented
- Full trace coverage in Langfuse/Phoenix for 100% of requests
- Event-driven document update pipeline verified (staleness window <5 minutes)
- Zero shared cache pools across tenants
- CI quality gate blocks deployment on RAGAS regression ≥ 5%

**v1.5 Gate:**
- 7-day rolling RAGAS metrics showing no regression trend
- Sampled faithfulness check coverage ≥ 5% of production traffic
- User feedback integration live with baseline established
- CRAG triage deployed and routing correctly (verified on golden dataset)
- Semantic cache in canary with confirmed quality parity to non-cached path

**v2 Entry:**
- All v1.5 gates held for 30+ days
- Multi-hop failure rate measured and confirmed significant enough to justify GraphRAG investment
- Async task queue architecture in place for Self-RAG workloads

---

## 10. Key Takeaways for LCS ADRs

1. **Hybrid retrieval and reranking are not enhancements — they are the production baseline.** A system without both is a prototype, not a product.

2. **The production-benchmark gap is real and domain-specific.** Do not adopt advanced corrective patterns (CRAG, Self-RAG) based on academic numbers. Evaluate against your actual corpus and latency targets.

3. **Silent quality degradation is the primary operational risk.** Without golden datasets, RAGAS evaluation, and continuous sampling, you will not know the system is degrading until users tell you.

4. **Grounding is a safety property, not a feature.** Inline citations with chunk IDs, context sufficiency gates, and refusal on low-relevance queries are requirements for enterprise deployment, not nice-to-haves.

5. **Framework choice matters operationally, not just architecturally.** LangChain's prototyping speed comes with production overhead that must be explicitly accepted and budgeted. Haystack's stability comes with ecosystem constraints that must be explicitly accepted.

6. **Phasing is not about deferring complexity — it is about sequencing risk.** Get the observability and evaluation foundation in place before adding corrective RAG layers. You cannot tune what you cannot measure.

7. **Model version pinning is mandatory from day one.** Every floating reference to a model identifier is a future incident waiting to happen.

---

*Research synthesized from: Psitrontech, Medium, unstructured.io, IBM, DataForest, FalkorDB, LaunchDarkly, Elastic, SAP, meilisearch.com, ResearchGate, PromptingGuide, arXiv, TowardsAI, Giskard, Kanerika, LangCopilot, Getathenic, Index.dev, Reddit, and primary RAG papers (Lewis et al. 2020, Asai et al. 2023 Self-RAG, Yan et al. 2024 CRAG, Jiang et al. 2023 FLARE).*
