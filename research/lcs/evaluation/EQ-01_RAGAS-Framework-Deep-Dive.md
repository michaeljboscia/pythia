# EQ-01: RAGAS Framework Deep Dive

**Status:** Complete
**Researched via:** Gemini Search + Synthesis
**Date:** 2026-03-10

**Domain:** Domain 7: Evaluation & Quality Measurement
**Type:** Hands-on
**Priority:** P0 BLOCKER
**Feeds ADR:** ADR-010
**Researcher:** Claude Sonnet 4.6 (1M context)

---

## Scope

Faithfulness, answer relevance, context precision, context recall: mathematical definitions, metric validity, human-judgment correlation, testset generation for heterogeneous corpora, framework comparison (RAGAS vs. DeepEval vs. TruLens vs. OpenEvals), integration patterns (offline batch, PR-gated, canary, production replay), known failure modes, and cost profiles at 100- and 1,000-sample cadences.

---

## Research Questions Answered

1. How are the four core RAGAS metrics mathematically defined and what assumptions do they make?
2. Which metrics correlate best with human judgment, and which are gameable?
3. What failure modes produce falsely high scores?
4. How should RAGAS testset generation be configured for a heterogeneous corpus?
5. How do RAGAS metrics compare against DeepEval, TruLens, and OpenEvals?
6. What integration architecture is best for LCS pipelines?
7. What are the token and runtime costs at 100- and 1,000-sample evaluation cadences?

---

## Sources Consulted

| # | Source | Type | URL/Path |
|---|--------|------|----------|
| 1 | RAGAS official documentation | Docs | https://docs.ragas.io/ |
| 2 | RAGAS GitHub repository | Repo | https://github.com/explodinggradients/ragas |
| 3 | RAGAS original paper (arxiv:2309.15217) | Paper | https://arxiv.org/abs/2309.15217 |
| 4 | DeepEval documentation | Docs | https://www.deepeval.com/docs/metrics-introduction |
| 5 | TruLens documentation | Docs | https://www.trulens.org/ |
| 6 | LangChain OpenEvals repository | Repo | https://github.com/langchain-ai/openevals |
| 7 | ZenML LLM evaluation comparison (2024–2025) | Blog | zenml.io |
| 8 | DeepChecks framework comparison | Blog | deepchecks.com |
| 9 | AImultiple RAGAS/DeepEval/TruLens analysis | Blog | aimultiple.com |
| 10 | arXiv papers on LLM-as-judge failure modes | Papers | arxiv.org (multiple) |

---

## What We Learned

### 1. Metric Mathematical Definitions

RAGAS divides RAG evaluation into two subsystems: **generator evaluation** (Faithfulness, Answer Relevance) and **retriever evaluation** (Context Precision, Context Recall). Each metric operates via a distinct computational mechanism, all of which ultimately rely on LLM calls as inner judges.

#### 1.1 Faithfulness

Faithfulness is the primary hallucination detector. It measures whether every factual claim in the generated answer can be logically inferred from the retrieved context — not from the LLM's parametric memory.

**Procedure:**
1. The evaluator LLM decomposes the generated answer into a set S of atomic claims/statements.
2. For each claim, the evaluator LLM checks whether it is entailed by the retrieved context.
3. The count of verified claims |V| is divided by the total claim count |S|.

**Formula:**

```
Faithfulness = |V| / |S|
```

Where |S| is the total number of extracted statements and |V| is the number that can be inferred from context. Score range: [0, 1]. A score of 1.0 means every claim in the answer is strictly grounded in retrieved context.

**Key assumption:** The evaluator LLM correctly identifies what can and cannot be deduced from the context. This assumption breaks down for highly technical domains (code semantics, ADR rationale chains) where the evaluator may lack the domain knowledge to verify a claim's logical entailment.

#### 1.2 Answer Relevance (Answer Relevancy)

Answer Relevance uses a question-regeneration approach rather than direct semantic comparison. It measures how well the answer addresses the original query, penalizing both incomplete answers and answers that introduce off-topic content. Critically, it does not check factual accuracy — that is faithfulness's job.

**Procedure:**
1. An LLM generates N synthetic questions that the given answer would plausibly address.
2. Each synthetic question is embedded.
3. The cosine similarity between each synthetic question embedding and the original question embedding is computed.
4. The mean cosine similarity is the score.

**Formula:**

```
Answer Relevance = (1/N) * Σ cos(E_gi, E_o)
```

Where E_gi is the embedding of the i-th generated synthetic question, E_o is the embedding of the original question, and N is the number of synthetic questions generated (typically 3–5).

**Key assumption:** Embedding space captures semantic similarity between questions. This assumption is weakest for code-heavy or domain-specific queries where "what does this code do" and "explain this function" may be near-identical in embedding space despite different precision requirements.

#### 1.3 Context Precision

Context Precision measures the signal-to-noise ratio of the retrieval system: are the most relevant chunks ranked highest, or is relevant content buried beneath noise?

**Procedure:**
1. For each retrieved chunk k, an LLM judges whether it is relevant to answering the question (binary: 1 = relevant, 0 = not).
2. Precision@k is computed at each rank position.
3. The average precision is computed, weighted by relevance at each position.

**Formula:**

```
Context Precision@K = Σ(k=1 to K) [Precision@k × v_k] / (total relevant chunks in top K)

Precision@k = TP@k / (TP@k + FP@k)
```

Where v_k is the binary relevance indicator at rank k. Score range: [0, 1]. A perfect score means all relevant chunks appear at the top of the retrieval result set, with no irrelevant chunks interspersed.

**Key assumption:** Requires knowledge of ground-truth relevance (which chunks are truly relevant). In reference-free evaluation mode, the LLM judge determines relevance — introducing evaluator subjectivity.

#### 1.4 Context Recall

Context Recall measures retrieval completeness: does the retrieved context contain all information necessary to answer the question, as defined by a ground-truth reference answer?

**Procedure:**
1. The ground-truth (reference) answer is decomposed into individual claims.
2. For each claim, the evaluator LLM checks if it can be attributed to the retrieved context.
3. The fraction of attributable ground-truth claims is the score.

**Formula:**

```
Context Recall = (GT claims attributable to context) / (total GT claims)
```

Score range: [0, 1]. A score of 1.0 means every fact in the reference answer was present in the retrieved context.

**Key assumption:** Requires a ground-truth reference answer. This makes Context Recall a reference-dependent metric — appropriate for testset evaluation but not for reference-free production monitoring. For LCS, where ground truth may not exist for every query type (e.g., exploratory ADR rationale queries), Context Recall is only actionable in synthetic testset contexts.

---

### 2. Metric Validity and Human-Judgment Correlation

The original RAGAS paper (arxiv:2309.15217) reported strong correlation with human judgment, particularly for Faithfulness. Subsequent independent studies have complicated this picture considerably.

**What correlates well:**
- **Faithfulness** is the most reliably validated metric. Its claim-decomposition + entailment-check approach aligns well with human hallucination detection at roughly 80% agreement on standard QA benchmarks. Its atomic structure (binary verdicts per claim) limits the surface area for evaluator LLM errors.
- **Context Recall** correlates reasonably well with human assessments of retrieval completeness when reference answers are of high quality.

**What correlates poorly or inconsistently:**
- **Answer Relevance** struggles with subtle nuances. The cosine-similarity mechanism over embedding space does not capture whether an answer is actionably useful versus technically on-topic. Human raters often distinguish these; the embedding approach does not. For code-reasoning queries and ADR rationale tracing, where an answer may be semantically similar to the question but still miss the point, Answer Relevance is a weak signal.
- **Context Precision** validity depends entirely on the quality of the relevance judgment made by the evaluator LLM. In technical domains, the evaluator may incorrectly flag a highly relevant but dense chunk as irrelevant, or pass a superficially relevant but misleading chunk.

**Domain sensitivity:** Correlation degrades significantly in specialized technical domains. For LCS query classes — code reasoning, dependency tracing, multi-source synthesis — the evaluator LLM's own domain comprehension becomes a ceiling. A GPT-4o-mini judge evaluating whether a Python type annotation is correctly inferred from a context chunk may simply lack the reasoning capacity to verify the claim, producing false positives on faithfulness.

---

### 3. Failure Modes: How RAGAS Scores Can Be Falsely High

Understanding failure modes is prerequisite to using RAGAS as a production gate rather than a research experiment.

#### 3.1 Verbosity Bias

LLM judges systematically equate length with quality. An answer that restates retrieved context at length will accumulate more verified claims (boosting Faithfulness) and appear more comprehensive (boosting Answer Relevance) than a concise, accurate answer. The claim-by-claim structure of Faithfulness partially mitigates this — it normalizes by claim count — but the underlying evaluator still shows a preference for confident, elaborated responses.

**Detection:** Track mean answer token length as a covariate alongside Faithfulness scores. If mean length and Faithfulness are strongly correlated across model variants, verbosity bias is likely influencing scores.

#### 3.2 Citation Leakage

When answers include formatted citations (e.g., `[1]`, `[Doc A]`, `[Source: architecture.md]`), LLM judges exhibit a well-documented tendency to treat the presence of citation markup as evidence of groundedness, regardless of whether the cited content supports the claim. A system that generates superficially formatted answers with injected citation markers can achieve inflated Faithfulness scores even when the underlying claims are hallucinated.

**Detection:** Evaluate faithfulness on citation-stripped answer text and compare to raw faithfulness scores. Divergence greater than 0.05–0.10 indicates citation leakage.

#### 3.3 Instruction Leakage / Rubric-Hacking

If the RAGAS evaluation prompt or rubric is exposed to the system under test (e.g., through prompt templating, training data contamination, or iterative fine-tuning against RAGAS scores), the generator can learn to produce outputs that exploit the judge's scoring heuristics. This "reward-hacking" pattern — where metric improvement decouples from actual quality improvement — is the most dangerous long-term failure mode for any automated evaluation framework used as an optimization target.

**Mitigation:** Treat RAGAS prompts as confidential internal tooling. Never include evaluation rubrics in system prompts or RAG context. Never fine-tune against RAGAS scores directly without human calibration checkpoints.

#### 3.4 "Correct but Unsupported" Divergence

RAGAS Faithfulness strictly penalizes claims derived from the LLM's parametric memory rather than the retrieved context, even when those claims are factually accurate. Human judges often reward correct answers regardless of source. This creates a systematic divergence: a highly-capable model that injects correct knowledge from training data will be penalized by RAGAS while a more context-locked model that produces lower-quality but fully-grounded answers will be rewarded. For LCS, where the retrieval corpus is the canonical source of truth (architectural decisions, ADRs, codebase state), this is actually the desired behavior — faithfulness to the corpus is the goal, and parametric leakage is a defect to suppress, not reward.

#### 3.5 LLM-as-Judge Hallucination

The evaluator LLM can itself hallucinate during claim verification. In practice, this means the judge may confirm that a claim is supported by context when a careful reading reveals it is not, or vice versa. This is the most fundamental limitation of RAGAS: the evaluation relies on a fallible AI system to judge another fallible AI system. The error rate of the judge sets a floor on the reliability of any metric it produces. Studies show frontier models (GPT-4o, Claude 3.5 Sonnet) exhibit significantly lower judge hallucination rates than smaller models, making evaluator model selection a first-order decision.

#### 3.6 Self-Preference and Style Bias

LLM judges prefer outputs that resemble their own generation style. An OpenAI judge will favor OpenAI-style responses; an Anthropic judge will favor responses with hedged, analytical prose. For LCS, where the answer style varies by query class (code blocks for implementation queries, bullet lists for ADR summaries, prose for rationale explanations), evaluator style preferences can introduce systematic bias across query types.

---

### 4. Testset Generation for a Heterogeneous Corpus

RAGAS v0.2+ uses a Knowledge Graph-based evolutionary generation paradigm, inspired by Evol-Instruct. This is the recommended approach for heterogeneous corpora such as LCS (code, markdown docs, ADRs, architecture decision records, logs).

#### 4.1 Architecture

The testset generator operates in three phases:

**Phase 1: Knowledge Graph Construction**
Documents are loaded, chunked, and processed. RAGAS extracts entities, themes, and summaries as graph nodes. Relationships between nodes are established via cosine similarity and semantic overlap scoring. For heterogeneous corpora, this cross-document relationship mapping enables generation of multi-hop questions that require synthesizing across document types (e.g., "Which ADRs constrain the behavior described in this code module?").

**Phase 2: Persona and Question Seed Generation**
RAGAS clusters document summaries to generate synthetic user personas representing different access patterns. For LCS, appropriate personas would include: Staff Engineer (deep codebase knowledge, seeks rationale), Onboarding Engineer (surface-level orientation, seeks context), Architect (seeks decision history and tradeoffs). Questions are seeded from graph node content and evolved through four evolution types:
- **Simple (single-hop):** Fact retrieval from a single chunk
- **Multi-Context (multi-hop):** Answer requires synthesizing across multiple chunks or document types
- **Reasoning:** Multi-step logical inference
- **Conditional:** Constrained or conditional queries

**Phase 3: Critic Filtering**
A separate critic LLM evaluates each generated question-context-answer triple for quality, answerability, and absence of hallucinated connections. The critic filters unanswerable or malformed items before they enter the evaluation dataset.

#### 4.2 Recommended Configuration for LCS

LCS is a maximally heterogeneous corpus: Python/TypeScript code, markdown documentation, structured ADR files, and log-derived summaries all coexist. The recommended configuration departs significantly from RAGAS defaults.

**Dual-LLM setup:**
- Generator LLM: A fast, cost-effective model (GPT-4o-mini, Claude 3 Haiku, Gemini 1.5 Flash) — handles high-volume entity extraction and question drafting
- Critic LLM: A high-capability reasoning model (GPT-4o, Claude 3.5 Sonnet) — required because heterogeneous corpora produce many hallucinated cross-document connections that a weaker critic will fail to catch

**Evolution distribution for LCS:**
Standard RAGAS defaults weight simple questions heavily. For LCS evaluation, the distribution should be shifted toward complex multi-document synthesis, which is the actual query class that matters:
```
simple: 0.30
multi_context: 0.45
reasoning: 0.15
conditional: 0.10
```

**Metadata preservation:** Every document chunk must carry `source_type` metadata (e.g., `code`, `adr`, `docs`, `log`). This enables slicing evaluation scores by document type — revealing whether the RAG pipeline degrades on code-heavy contexts versus prose contexts, which is expected to be a meaningful performance differential for LCS.

**Adaptive chunking:** Use structure-aware chunking rather than fixed-size splitting. For Python/TypeScript code, chunk at the function/class boundary. For ADR markdown files, chunk at section headers. For prose docs, use recursive character splitting with semantic boundary detection.

**Post-generation human review:** Always manually sample 10–15% of the synthetic testset before using it for evaluation. Verify that each reference answer can actually be derived from its associated reference contexts. Critic LLM failures are most common when cross-document connections are tenuous, which happens frequently in LCS's codebase-to-ADR mapping.

**Avoiding synthetic bias:** The primary sources of bias in RAGAS testset generation are (1) over-representation of easily-answerable simple questions, (2) hallucinated reference answers for cross-document multi-hop questions, and (3) questions anchored to specific code patterns that change rapidly. Mitigate by: weighting multi-context questions as above, using a strong critic, and versioning the testset with the codebase commit hash so evaluation results are reproducible against known corpus state.

---

### 5. Framework Comparison: RAGAS vs. DeepEval vs. TruLens vs. OpenEvals

| Dimension | RAGAS | DeepEval | TruLens | OpenEvals |
|-----------|-------|----------|---------|-----------|
| **Primary fit** | Offline RAG research, metric granularity | CI/CD-gated ML testing | Production observability / LLMOps | Lightweight app-layer integration |
| **RAG-native** | Best-in-class | RAGAS-inspired, 14+ modules | RAG Triad (Context Relevance, Groundedness, Answer Relevance) | Good utilities, synthetic data generation |
| **CI/CD integration** | Weak (not designed for it) | Strong (Pytest native) | Moderate (async feedback functions) | Moderate (LangSmith integration) |
| **Cost** | High (multi-step CoT) | High (complex reasoning chains) | Moderate (swappable judge models) | Low-to-moderate (minimalist prompting) |
| **Signal quality** | High in academic settings, degrades in technical domains | High but prone to false positives on simple tasks | High for persistent benchmarking | High with few-shot domain alignment |
| **Run-to-run stability** | Moderate (LLM nondeterminism) | Moderate | High (deterministic feedback functions available) | High (simpler prompts = less variance) |
| **Evaluator model flexibility** | Good | Good | Best (designed for model swapping) | Best (minimalist prompts work with smaller models) |
| **Testset generation** | Native, KG-based, sophisticated | Via integration | No native capability | Auto-generation from internal docs |
| **Best for** | Iterating RAG configuration offline | Treating LLM quality as a unit-test | Production monitoring and drift detection | Low-friction app-layer eval, TypeScript/LangChain stacks |

**For LCS:** RAGAS is the correct primary evaluation framework for offline development iteration and testset-governed release gates. DeepEval is the preferred complement for CI/CD gate enforcement, because its Pytest-native test structure integrates cleanly with existing engineering workflows. TruLens is the preferred tool for production drift monitoring once LCS reaches stable deployment, due to its persistent benchmarking and RAG Triad visualization. OpenEvals is not a priority unless the LCS frontend shifts to a TypeScript/LangChain-native stack.

---

### 6. Integration Architecture

A mature RAG evaluation pipeline uses three distinct tiers, each with different sample sizes, evaluator models, and triggering conditions.

#### 6.1 PR-Gated Evaluation

**Trigger:** Every PR that modifies retrieval logic, prompt templates, embedding models, chunking configuration, or LLM parameters.

**Sample size:** 100 samples from a curated Golden Dataset — adversarial queries, edge cases, and representative queries across each LCS query class (code reasoning, ADR tracing, multi-source synthesis).

**Evaluator:** Fast, cost-effective model (GPT-4o-mini or Claude 3 Haiku). The goal is catching regressions, not maximizing score accuracy.

**Gate logic:** PR blocks on merge if:
- Faithfulness drops below 0.85 compared to baseline
- Answer Relevance drops more than 0.05 from baseline
- Context Precision drops more than 0.08 from baseline

**Runtime and cost:**
- Token usage: ~150,000 input tokens + ~10,000 output tokens per run
- Cost at GPT-4o-mini pricing: ~$0.03 per run
- Cost at GPT-4o pricing: ~$0.85 per run
- Runtime: 1–3 minutes with async batching

**Output:** Post evaluation results as PR comments showing per-metric scores, delta from baseline, and specific query-level failures with their contexts and answers. Do not block PRs silently — surface the failing cases.

#### 6.2 Nightly Production Replay

**Trigger:** Nightly automated job, or manually before any production release.

**Sample size:** 1,000 samples drawn from historical production query logs (sampled across query types, weighted toward high-frequency and high-stakes query classes).

**Evaluator:** Frontier model (GPT-4o or Claude 3.5 Sonnet). At this scale, evaluator quality matters more than cost.

**Purpose:** Catch regressions that the 100-sample Golden Dataset misses due to corpus drift, model degradation, or retrieval index staleness.

**Runtime and cost:**
- Token usage: ~1.5M input tokens + ~100K output tokens per run
- Cost at GPT-4o-mini: ~$0.30 per run
- Cost at GPT-4o: ~$8.50 per run
- Runtime: 10–20 minutes (with rate-limiting via async semaphores and exponential backoff)
- Rate limit management is a first-class engineering concern at this scale

**Caching:** Cache retrieval results separately from evaluation. If only a prompt template changed, reuse cached retrieved contexts to avoid redundant retrieval API calls. This reduces nightly replay cost by 40–60% for prompt-only changes.

#### 6.3 Canary Evaluation

**Trigger:** Deployment to production (after passing nightly replay).

**Mechanism:** Route 5–10% of live traffic through the new pipeline variant. Run RAGAS asynchronously on the canary traffic in the background using a sampling rate (e.g., evaluate 1 in 10 live queries).

**Gate logic:** If live Faithfulness on canary traffic drops more than 0.07 below the stable baseline over a rolling 2-hour window, trigger automatic rollback.

**Challenge:** Canary evaluation requires production logging of the full RAGAS triad (query, retrieved context, generated answer) for every sampled call. This is a non-trivial observability instrumentation requirement. LCS must emit structured evaluation traces to a log store (LangSmith, MLflow, or a custom Postgres-backed store) before canary eval is feasible.

#### 6.4 Scheduled Offline Eval (Corpus Drift Detection)

**Trigger:** Weekly, or whenever the document corpus is significantly updated (new ADRs added, major code refactors committed).

**Purpose:** The Golden Dataset and testset are tied to a specific corpus state. As the codebase evolves, previously valid testset questions may become unanswerable (code was refactored, ADR was superseded). Scheduled eval identifies when the testset itself needs refreshing.

**Action:** If Context Recall drops systemically across the testset without any pipeline changes, the corpus has likely diverged from the testset's reference contexts. Trigger testset regeneration.

---

### 7. Cost Profile Summary

| Tier | Samples | Evaluator Model | Input Tokens | Output Tokens | Estimated Cost | Runtime |
|------|---------|-----------------|-------------|---------------|----------------|---------|
| PR Gate | 100 | GPT-4o-mini | ~150K | ~10K | ~$0.03 | 1–3 min |
| PR Gate | 100 | GPT-4o | ~150K | ~10K | ~$0.85 | 1–3 min |
| Nightly Replay | 1,000 | GPT-4o-mini | ~1.5M | ~100K | ~$0.30 | 10–20 min |
| Nightly Replay | 1,000 | GPT-4o | ~1.5M | ~100K | ~$8.50 | 10–20 min |
| Weekly Corpus Eval | 500 | GPT-4o-mini | ~750K | ~50K | ~$0.15 | 5–10 min |

Assumptions: average context+prompt of ~1,500 tokens, average judge reasoning output of ~100 tokens. Token counts scale with context window usage — LCS's long code contexts may push actual token usage 2–3x above these estimates for code-heavy query types.

**Cost-quality breakpoints:**
- For PR gates: GPT-4o-mini is adequate. The goal is catching obvious regressions, and cost at $0.03/run permits unlimited runs.
- For nightly replay: GPT-4o is preferred. At $8.50/run, weekly cost is under $60 — acceptable for a production quality gate. Daily replay at GPT-4o adds up to ~$250/month; evaluate whether this is justified by deployment frequency.
- For canary: Sample-based evaluation (1 in 10 live queries) keeps canary eval costs proportional to traffic volume. Implement a daily cost cap and alert if canary eval spend exceeds it.

---

### 8. RAGAS for Graph-Enhanced Retrieval (GraphRAG/LightRAG)

Graph-enhanced retrieval (as used in LCS's GraphRAG and LightRAG flows) introduces a structural mismatch with standard RAGAS evaluation assumptions.

**The problem:** Standard RAGAS assumes discrete, independently-retrievable context chunks. In GraphRAG flows, retrieved "context" is assembled from node summaries, edge traversal results, and neighborhood aggregations. This context is not a flat list of chunks but a structured, relational output. The Faithfulness metric's claim-decomposition approach works on this — it doesn't care about context structure, only content — but Context Precision and Context Recall break down because they assume chunk-level relevance judgments.

**Adaptations for LCS:**
- For **Faithfulness**: Apply without modification. The LLM judge can verify claims against graph-assembled context text.
- For **Answer Relevance**: Apply without modification. Independent of retrieval structure.
- For **Context Precision**: Treat each graph-retrieved element (node summary, edge, community cluster) as a ranked "chunk" and compute Precision@K across these elements. Requires custom instrumentation to expose retrieval rankings from graph traversal.
- For **Context Recall**: Depends on reference answers that cite specific graph nodes/paths. For exploratory queries over the knowledge graph, ground-truth reference answers may not exist — Context Recall is not applicable without them.
- **Recommended supplemental metric:** For GraphRAG flows, add a coverage metric that tracks what fraction of the graph neighborhood contributing to the answer was actually referenced in the final response. This is not a RAGAS native metric but can be computed from LightRAG's traversal logs.

Cross-reference: KG-01 research should assess whether LightRAG's community-level summarization degrades Faithfulness scores due to lossy compression of graph neighborhoods into summaries that then cannot be traced to specific source claims.

---

## What It Means for LCS

### Metric Stack Recommendation

**Blocking metrics (must not regress — PR gate and release gate):**
1. **Faithfulness ≥ 0.85** — The primary anti-hallucination gate. Non-negotiable for a codebase-query system where wrong answers about code behavior or architectural decisions have direct consequences.
2. **Answer Relevance ≥ 0.80** — Guards against off-topic or incomplete answers. Threshold is lower than Faithfulness because the cosine-similarity approach is noisier.

**Advisory metrics (informational, not blocking):**
3. **Context Precision** — Track as a retrieval quality indicator. Alert on systematic drops (>0.08 from baseline) but do not block on individual evaluation runs due to evaluator variance.
4. **Context Recall** — Only meaningful in testset mode (requires ground truth). Use for corpus drift detection and testset staleness identification, not as a live gate.

**Rationale for this tiering:** Faithfulness is the only metric with robust human-judgment correlation across technical query classes. Answer Relevance is a useful complementary signal but is gameable via verbosity and noisier in embedding space for technical content. Context Precision and Recall are valuable diagnostic tools but too dependent on evaluator quality and ground-truth availability to be reliable production gates.

### Evaluator Model Selection

Do not use GPT-4o-mini or similar lightweight models as the evaluator for production gates. The evaluator model's domain comprehension sets the ceiling on faithfulness verification quality for LCS's technical content. Recommend:
- PR gates: GPT-4o-mini acceptable (cost-driven, regression-catching only)
- Nightly replay and release gates: GPT-4o or Claude 3.5 Sonnet
- Testset generation critic: Claude 3.5 Sonnet (best reasoning on heterogeneous code + docs)

### LLM-as-Judge Governance

RAGAS scores are not ground truth. They are probabilistic signals from a fallible judge. Treat them accordingly:
- Maintain a human-annotated calibration set of 50–100 examples across LCS query classes. Run this calibration set monthly and report Spearman correlation between RAGAS scores and human ratings. If correlation drops below 0.70, the evaluation framework has drifted and requires recalibration.
- Never optimize the LCS pipeline directly against RAGAS scores without human calibration checkpoints. Score gaming is a real risk when RAGAS becomes the primary optimization target.
- Rotate evaluator model versions intentionally (not automatically). When a new GPT-4o or Claude version releases, evaluate its impact on score distributions before switching — a model upgrade can shift mean Faithfulness by 0.03–0.08 simply due to evaluator behavior changes.

### Confidence Intervals and Variance

Run-to-run LLM nondeterminism means a single RAGAS evaluation run has inherent variance. For go/no-go decisions:
- Run the evaluation suite 3 times and use the mean score, not a single run.
- Compute the 95% confidence interval across runs. Do not block a release if the lower bound of the CI still exceeds the threshold.
- For 100-sample PR gates, variance is higher than for 1,000-sample nightly replays. Set gate thresholds conservatively for PR gates (higher absolute threshold) to account for this.

---

## Decision Inputs for ADR-010

| ADR | Question Answered | Our Finding |
|-----|-------------------|-------------|
| ADR-010 | Is RAGAS a viable primary evaluation framework for LCS? | Yes, with constraints. RAGAS is viable as the core offline and PR-gate evaluation framework. It is not a complete solution — requires DeepEval for CI/CD enforcement, TruLens for production drift monitoring, and human calibration checkpoints to prevent metric gaming. |
| ADR-010 | Which metrics should block production releases? | Faithfulness (≥0.85) and Answer Relevance (≥0.80) are the blocking metrics. Context Precision and Recall are advisory only. |
| ADR-010 | What evaluator model should be used? | GPT-4o or Claude 3.5 Sonnet for release gates and nightly replay. GPT-4o-mini acceptable for PR-gate regression detection only. |
| ADR-010 | How should RAGAS integrate with LCS CI/CD? | Three-tier architecture: 100-sample PR gate (fast, cheap, blocks merge), 1,000-sample nightly replay (thorough, catches corpus drift), canary eval (live traffic sampling, triggers rollback). |
| ADR-010 | How does RAGAS handle GraphRAG flows? | Faithfulness and Answer Relevance apply without modification. Context Precision requires custom instrumentation of graph traversal rankings. Context Recall requires ground-truth reference answers — not applicable for exploratory graph queries. Custom graph-coverage metric recommended as supplement. |
| ADR-010 | What is the cost profile? | PR gate: ~$0.03/run at GPT-4o-mini, ~$0.85 at GPT-4o. Nightly replay: ~$0.30–$8.50 per run depending on evaluator model. Annual cost at daily nightly replay with GPT-4o: ~$3,100. Acceptable for a production quality gate. |

---

## Open Questions

1. **Faithfulness calibration for code reasoning queries:** Does the evaluator LLM correctly verify code-semantic claims (e.g., "this function returns a list of tuples where the second element is the error code") against Python/TypeScript context? Requires an LCS-specific calibration study using human expert ratings on a sample of code-heavy queries.

2. **GraphRAG context precision instrumentation:** LightRAG's traversal outputs are not natively structured as ranked chunk lists. What instrumentation changes are required to expose graph traversal rankings in a form that RAGAS Context Precision can consume? Feeds KG-01 and KG-10.

3. **Lost-in-the-middle interaction with Faithfulness:** RF-07 (lost-in-the-middle effects) predicts that LLMs systematically underweight information from the middle of long context windows. This would cause the generator to hallucinate (not grounding in middle-context information), which RAGAS Faithfulness should catch — but will the evaluator LLM exhibit the same lost-in-the-middle behavior when verifying claims? If so, Faithfulness may have a systematic blind spot for claims sourced from mid-context chunks.

4. **Testset versioning and drift management:** LCS's codebase evolves rapidly. What is the appropriate cadence for testset refresh, and what triggers a full regeneration versus an incremental update? The testset must be versioned with the corpus commit hash to maintain evaluation reproducibility.

5. **Minimum viable blocking threshold calibration:** The Faithfulness ≥ 0.85 and Answer Relevance ≥ 0.80 thresholds proposed here are based on general research findings. They require calibration against LCS-specific human ratings before being used as production release gates. Until calibration is complete, these should be advisory thresholds only.

---

## Raw Notes

**Key numbers to remember:**
- RAGAS human-judgment correlation: ~80% agreement on standard QA; degrades significantly in technical/specialized domains
- Verbosity bias: RAGAS partially mitigates via claim-normalization but evaluator preference for length persists
- PR gate cost: $0.03–$0.85 per 100-sample run depending on evaluator model
- Nightly replay cost: $0.30–$8.50 per 1,000-sample run
- Rate limiting is a first-class engineering problem at 1,000 samples: implement tenacity-based exponential backoff and asyncio.Semaphore for concurrency control
- RAGAS is a research/data-science tool that requires engineering wrappers for production CI/CD use; DeepEval provides those wrappers natively

**Framework positioning (one-sentence summaries):**
- RAGAS: the most RAG-native metric framework, best for offline experimentation and testset-governed gates, weak out-of-the-box CI/CD support
- DeepEval: treats LLM quality as unit tests, Pytest native, best for enforcing gates in engineering pipelines
- TruLens: production observability and RAG Triad visualization, best for live drift detection and persistent benchmarking
- OpenEvals: minimalist prompting, lowest cost, best for TypeScript/LangChain application developers, least suitable for LCS's Python+GraphRAG stack

**Graph-RAG RAGAS adaptation (quick reference):**
- Faithfulness: apply unchanged
- Answer Relevance: apply unchanged
- Context Precision: requires custom rank-list instrumentation of graph traversal output
- Context Recall: only applicable with ground-truth reference answers; skip for exploratory graph queries
- Add custom graph-coverage metric from LightRAG traversal logs
