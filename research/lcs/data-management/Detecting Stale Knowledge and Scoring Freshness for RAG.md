# Detecting Stale Knowledge and Scoring Freshness for RAG

**Pure semantic similarity is blind to time — and that blindness can silently degrade a production RAG system.** When a knowledge base grows but is never pruned for temporal relevance, cosine similarity will happily retrieve a pricing document from eight months ago with the same confidence as one published yesterday. Empirical work now quantifies this failure: on freshness-sensitive tasks, cosine-only retrieval scored **0.00** on top-10 accuracy while a simple half-life recency prior achieved **1.00** ([Grofsky, 2025](https://arxiv.org/html/2509.19376)). The problem compounds in graph-backed RAG, where a changed entity silently invalidates every upstream node that references it. This report surveys decay models, graph-based staleness propagation, and retrieval-integration strategies, grounding each claim in sources actually read and providing practical guidance for senior engineers building temporal-aware RAG pipelines.

## Decay models: exponential priors dominate, but one size does not fit all

The foundational work on temporal priors in information retrieval is [Li and Croft's 2003 CIKM paper "Time-Based Language Models"](https://ciir.cs.umass.edu/pubfiles/ir-297.pdf). Their key insight was to replace the uniform document prior in the query-likelihood framework with an **exponential time-dependent prior**: P(D|T_D) = λ · e^(−λ(T_C − T_D)), where T_C is the most recent date in the collection and T_D is the document's creation date. Tested on TREC volumes 4 and 5, the model identified 36 "recency queries" out of 100 and achieved an average precision of **0.1644** compared to **0.1582** for the standard language model baseline. Crucially, both the time-based query likelihood and the time-based relevance model outperformed a naive "rerank by recency" heuristic, demonstrating that integrating time into the probabilistic model beats post-hoc sorting. The rate parameter λ proved sensitive in the [0, 0.1] range, with optimal values of 0.01–0.02 depending on the model variant.

[Efron and Golovchinsky (SIGIR 2011)](https://dl.acm.org/doi/10.1145/2009916.2009984) extended this framework by making the decay rate **query-dependent**. Instead of a global λ, they estimated λ_q = 1/T̄, where T̄ is the mean timestamp of pseudo-relevant documents retrieved in an initial pass. This allows a query about a breaking event to adopt a steep decay (favoring very recent documents) while a historical query adopts a gentle one. The approach has been cited over 156 times and remains a reference point in temporal IR surveys, including the [2025 survey "It's High Time"](https://arxiv.org/html/2505.20243v2) and the [2014 ACM Computing Surveys paper by Campos et al.](https://dl.acm.org/doi/10.1145/2619088), which comprehensively categorizes temporal IR research into document timestamping, temporal query intent, and temporal ranking models.

The half-life formulation — N(t) = N₀ · (1/2)^(t/t½) — offers a more intuitive parameterization of exponential decay. An [Uplatz framework analysis](https://uplatz.com/blog/the-half-life-of-knowledge-a-framework-for-measuring-obsolescence-and-architecting-temporally-aware-information-systems/) proposes domain-specific half-lives: **18–24 months for medical knowledge**, roughly 10 years for engineering degrees (down from 35 years in 1930). This suggests that a single decay constant across a heterogeneous knowledge base is inappropriate. A [UNSW technical report on content-sensitive document ranking](https://cgi.cse.unsw.edu.au/~reports/papers/201408.pdf) formalizes this, proposing per-topic decay factors derived from "topical longevity scores" — papers in fast-advancing subfields should decay faster than those in stable ones.

Production search systems implement decay as configurable functions. [OpenSearch's function_score API](https://docs.opensearch.org/latest/query-dsl/compound/function-score/) offers three decay shapes — **Gaussian, exponential, and linear** — each parameterized by origin, scale, offset, and decay rate. Exponential decay drops sharply after the offset and then gradually levels off, making it suitable for content where recency matters intensely. Gaussian decay produces a bell-curve profile appropriate for balanced proximity scoring. Linear decay provides a constant-rate decline with a hard cutoff at the boundary, approximating a soft step function. The [Rover engineering blog](https://www.rover.com/blog/engineering/post/painless-scoring-decay-curves-elasticsearch/) documents practical trade-offs: exponential works best for time-based popularity signals, Gaussian for geospatial distance, and linear for price-range tolerance. No published benchmark directly compares these three curves on retrieval quality, but the theoretical and practical consensus is that **exponential decay best models the diminishing marginal value of age** for time-sensitive content.

Step functions represent the simplest decay model. [dbt's source freshness system](https://docs.getdbt.com/reference/resource-properties/freshness) uses a two-threshold step function: a `warn_after` and an `error_after` parameter, each specified as a count and period (e.g., 24 hours, 7 days). The system checks `max(loaded_at_field)` against current time and classifies each source as fresh, warning, or error. This binary/ternary approach suits data pipelines with well-defined SLAs but lacks the gradual degradation signal that retrieval ranking needs. The [FINOS Dependency Freshness Score proposal](https://github.com/finos/devops-automation/issues/44) takes a similar step-like approach, computing staleness as version or date distance from the latest release, then aggregating across dependencies using a **weakest-link principle** — the overall score is driven by the most stale component.

Signal-based models go beyond simple timestamps to incorporate edit frequency and contributor activity. [Research on Wikipedia article quality](https://appliednetsci.springeropen.com/articles/10.1007/s41109-020-00305-y) found that edit-label frequencies and transition probabilities predict article quality with ROC-AUC above 75%, outperforming network-structure features alone. The number of revisions acts as a strong control variable. The [Endure tool](https://endure.codeslick.dev/) applies this to codebases, scoring every file on **complexity, churn (edit frequency from git history), and staleness (time since last modification)**, then weighting these into a single debt score. It also maps co-change connections — files that always change together — providing a signal-based freshness model grounded in version control metadata. [Git blame](https://git-scm.com/docs/git-blame) provides line-level temporal resolution, annotating each line with its last-modified commit and timestamp, while [git log](https://git-scm.com/docs/git-log) enables file-level edit-frequency computation over arbitrary time windows.

The strongest empirical evidence for decay-model effectiveness comes from [Grofsky (2025)](https://arxiv.org/html/2509.19376), who tested a fused scoring formula: **score(q, d, t) = α · cos(q, d) + (1 − α) · 0.5^(age_days / h)**, where α controls the semantic-vs-temporal weight and h is the half-life in days. On both synthetic data and the real-world CERT Insider Threat Dataset (849,579 logon events over 71 weeks), the fused score achieved **1.00 on Latest-Set@10** while cosine-only retrieval scored **0.00**. The paper explicitly notes: "This degradation is a key finding: it provides empirical validation that the temporal component is essential to the model's success and is not merely a minor correction."

### What the TF-IDF temporal variant adds

[Marwah and Beel (2020)](https://aclanthology.org/2020.wosp-1.5/) introduced tTF-IDF, which multiplies standard TF-IDF by a term-age factor: **t(w, D) = log(df(w, D) / (y_diff + 1))**, where y_diff is the number of years since a term's first usage. Tested on TREC Washington Post Corpus (608K articles), WebAP, and CiteULike, **tTF-IDF outperformed standard TF-IDF on all three datasets** across Precision@10, Recall, F1, and NDCG. The intuition is that standard IDF assumes a static term distribution, unfairly penalizing newer terms like "COVID-19" that have fewer documents simply because they are new. Notably, the temporal modification did not improve BM25, suggesting that BM25's length normalization partially compensates for temporal distribution skew.

## Graph structure reveals staleness that timestamps alone cannot

When Entity A "EXPLAINS" Entity B, and B is updated but A is not, a timestamp check on A alone will miss the staleness. **The graph structure encodes dependency relationships that create transitive freshness obligations.** This is the central insight for knowledge-graph-backed RAG systems: staleness propagates through edges.

### Cypher patterns for dependency-based staleness detection

[Neo4j's built-in temporal types](https://neo4j.com/docs/cypher-manual/current/values-and-types/temporal/) — DATE, DATETIME, ZONED DATETIME, and DURATION — provide the primitives. Every node and relationship can carry an `updated_at` property of type `datetime()`, and [range queries on temporal properties are index-backed](https://neo4j.com/docs/getting-started/current/cypher-intro/dates-datetimes-durations/) for efficient filtering. The core staleness-detection query is straightforward:

```cypher
MATCH (a:Chunk)-[:EXPLAINS]->(b:Chunk)
WHERE b.updated_at > a.updated_at
RETURN a.name AS stale_entity,
       a.updated_at AS entity_last_updated,
       b.name AS dependency_name,
       b.updated_at AS dependency_updated,
       duration.between(a.updated_at, b.updated_at) AS staleness_gap
ORDER BY staleness_gap DESC
```

This returns every chunk whose dependency has been modified more recently than itself, ranked by the size of the staleness gap. For **multi-hop propagation** — where staleness cascades through chains of EXPLAINS, REFERENCES, or DEPENDS_ON edges — a variable-length path query captures transitive exposure:

```cypher
MATCH path = (a:Chunk)-[:EXPLAINS|REFERENCES*1..3]->(b:Chunk)
WHERE b.updated_at > a.updated_at
WITH a, max(b.updated_at) AS latest_dep_update
RETURN a.name AS stale_entity,
       a.updated_at AS last_updated,
       latest_dep_update,
       duration.between(a.updated_at, latest_dep_update) AS staleness_gap
ORDER BY staleness_gap DESC
```

The `*1..3` bound limits traversal depth to avoid combinatorial explosion while catching most practical dependency chains. For automated remediation, a labeling query can tag stale nodes for downstream processing:

```cypher
MATCH (a:Chunk)-[:EXPLAINS]->(b:Chunk)
WHERE b.updated_at > a.updated_at
  AND NOT a:PotentiallyStale
SET a:PotentiallyStale,
    a.staleness_detected_at = datetime(),
    a.stale_reason = 'Dependency ' + b.name + ' updated at ' + toString(b.updated_at)
```

These patterns synthesize documented Neo4j capabilities — [temporal types](https://neo4j.com/docs/cypher-manual/current/values-and-types/temporal/), [variable-length paths](https://neo4j.com/docs/getting-started/current/cypher-intro/dates-datetimes-durations/), and [datetime arithmetic with duration.between()](https://graphacademy.neo4j.com/courses/cypher-intermediate-queries/3-working-with-cypher-data/05-dates-and-times/) — into a staleness-detection workflow. No off-the-shelf Neo4j procedure exists for this purpose, but the query primitives are fully production-ready.

### Theoretical grounding from GNN staleness research

The concept of staleness propagating through graph structure has rigorous treatment in the GNN literature. [Sancus (VLDB 2022)](https://dl.acm.org/doi/10.14778/3538598.3538614) introduces bounded embedding staleness metrics for decentralized GNN training, showing that staleness during message passing can be bounded while still achieving **74% communication avoidance** and 1.86x throughput improvement without accuracy loss. [The "Rethinking Memory Staleness" paper (arXiv:2209.02462)](https://arxiv.org/pdf/2209.02462) directly addresses how node memory becomes stale when a node hasn't been active recently, proposing a temporal attention mechanism that aggregates information from neighbors' memory. [STAG (arXiv:2309.15875)](https://arxiv.org/html/2309.15875) tackles the "neighbor explosion problem" — when a node's features update, representations must propagate to all dependent neighbors — using incremental propagation that achieves **2.7x serving improvement**. These GNN techniques provide the formal basis for understanding how a changed entity in a knowledge graph creates an update obligation on every entity that depends on it.

### Temporal knowledge graphs and LightRAG's gap

Temporal knowledge graphs (TKGs) extend standard triples to quadruples: **(head, relation, tail, timestamp)**. The [IJCAI 2023 survey on TKG completion](https://arxiv.org/abs/2201.08236) catalogs methods for interpolation (filling missing facts at known timestamps) and extrapolation (predicting future facts), with benchmark datasets like ICEWS14 and Wikidata12k. The [OpenAI Cookbook's "Temporal Agents with Knowledge Graphs"](https://cookbook.openai.com/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents) provides a practical implementation: semantic chunking → statement decomposition → time-stamped triplet creation → temporal conflict resolution. This enables queries like "What was true about entity X on date Y?"

[LightRAG](https://github.com/HKUDS/LightRAG), despite its knowledge-graph backbone, has **no built-in temporal freshness features**. Its relationship schema includes `weight`, `description`, `keywords`, `source_id`, and `file_path` — but no `updated_at` or `created_at` field. As [Neo4j's analysis of LightRAG's extraction process](https://neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction/) notes, the weight attribute is used for retrieval prioritization ("only show me strong connections"), not temporal tracking. Adding freshness to a LightRAG deployment requires custom schema extension — appending timestamp properties to both entities and relationships and implementing the Cypher staleness queries described above.

For detecting when source documents change, [IncRML](https://www.semantic-web-journal.net/content/incrml-incremental-knowledge-graph-construction-heterogeneous-data-sources) provides the most rigorous approach, combining timestamp-based and snapshot-based change data capture to achieve **up to 315x less storage** and 4.59x less CPU time compared to full regeneration. [CocoIndex](https://cocoindex.io/blogs/meeting-notes-graph) implements a practical variant: source → detect changes → split → extract → export, where changes to individual files trigger reprocessing of only those files, achieving **99%+ cost reduction** for typical 1% daily churn.

## Three strategies for integrating freshness into retrieval ranking

The three dominant approaches — multiplicative/additive weighting, hard filtering, and LLM self-assessment — each have distinct trade-offs. The empirical evidence increasingly favors a **hybrid of weighted fusion and hard temporal filtering**, with LLM metadata as a complementary signal.

### Additive and multiplicative fusion with semantic similarity

[LangChain's TimeWeightedVectorStoreRetriever](https://api.python.langchain.com/en/latest/retrievers/langchain.retrievers.time_weighted_retriever.TimeWeightedVectorStoreRetriever.html) uses an **additive** formula: `score = (1.0 − decay_rate)^hours_passed + vectorRelevance`. The decay_rate parameter (0–1) controls how aggressively recency is weighted; at 0.999, recency dominates and older documents are effectively forgotten. A critical implementation detail: `hours_passed` measures time since last **access**, not creation, so frequently retrieved documents remain fresh. Documents must be added via the retriever's `add_documents()` method (not the vector store directly) to properly populate `last_accessed_at` metadata.

[LlamaIndex's TimeWeightedPostprocessor](https://developers.llamaindex.ai/python/examples/node_postprocessor/timeweightedpostprocessordemo/) takes a similar approach with a configurable `time_decay` parameter applied as a post-retrieval reranker. Its [EmbeddingRecencyPostprocessor](https://developers.llamaindex.ai/python/framework/module_guides/querying/node_postprocessors/node_postprocessors/) adds a deduplication step: after sorting by date, it removes older nodes that are too semantically similar to newer ones (above a `similarity_cutoff`), preventing the retrieval set from being dominated by near-duplicate historical versions of the same content.

The [Grofsky (2025) fused score](https://arxiv.org/html/2509.19376) — `α · cos(q, d) + (1 − α) · 0.5^(age_days / h)` — is the most rigorously benchmarked formula. The convex combination ensures scores remain in [0, 1] and the α parameter explicitly controls the semantic-temporal trade-off. On the CERT dataset, removing the temporal component (α = 1.0) caused freshness-task accuracy to collapse from 1.00 to 0.00, while removing the semantic component would lose topical relevance. The paper recommends treating α and h as domain-specific hyperparameters tuned on a held-out evaluation set.

A practitioner-oriented approach from [RAG About It](https://ragaboutit.com/the-knowledge-decay-problem-how-to-build-rag-systems-that-stay-fresh-at-scale/) proposes a weighted formula with a stepped freshness boost: `score = 0.7 · semantic_similarity + 0.3 · freshness_boost`, where freshness_boost is 1.0 for same-day content, 0.5 for 30-day-old content, and 0.2 for 90-day-old content. The step-function approach trades the smooth degradation of exponential decay for simplicity and interpretability, which may suit teams that need stakeholders to understand the ranking logic.

### Hard temporal filtering

[Haystack's metadata filtering](https://docs.haystack.deepset.ai/docs/metadata-filtering) implements the hard-filter approach with comparison operators on datetime fields: documents older than a threshold are excluded entirely from retrieval. The advantage is determinism — no stale content can leak through — but the disadvantage is the cliff effect: a document one day past the cutoff is treated identically to one a year past it. [LlamaIndex's FixedRecencyPostprocessor](https://developers.llamaindex.ai/python/framework/module_guides/querying/node_postprocessors/node_postprocessors/) achieves a similar result by simply sorting nodes by date and returning only the top K most recent.

The [TG-RAG ablation study](https://arxiv.org/pdf/2510.13590) provides strong evidence for hard temporal filtering's value: when temporal retrieval was disabled, the correctness score dropped from **0.599 to 0.382** and refusal rate increased to 0.423, demonstrating that without time-scoping, retrieval is "overwhelmed by temporally irrelevant evidence." Similarly, the [CIKM 2024 paper on time-sensitive RAG](https://dl.acm.org/doi/10.1145/3627673.3679800) found that embedding-based similarity-matching methods **struggle to handle queries with explicit temporal constraints** without temporal filtering augmentation.

The most practical configuration combines both: a hard filter removes content beyond a generous outer bound (e.g., 2 years for general knowledge, 90 days for release notes), while exponential decay provides smooth ranking within the surviving pool. This avoids the cliff effect while preventing pathologically stale content from consuming retrieval slots.

### LLM self-assessment with timestamp metadata

The third approach passes document timestamps directly to the LLM and relies on the model to assess temporal relevance. [Haystack's QueryMetadataExtractor](https://haystack.deepset.ai/blog/extracting-metadata-filter) uses an LLM to extract temporal filters from natural language queries, automatically converting "What changed last quarter?" into a date-range filter. [LlamaIndex's LlamaCloud](https://docs.cloud.llamaindex.ai/llamacloud/retrieval/advanced) similarly supports automatic metadata filter inference from queries.

The TA-ARE (Time-Aware Adaptive Retrieval) approach, described in [adaptive RAG literature](https://zbrain.ai/adaptive-retrieval-augmented-generation-for-agentic-ai/), augments the LLM's prompt with temporal information so it can reason about when to trust or discount retrieved context. [Glen Rhodes](https://glenrhodes.com/data-freshness-rot-as-the-silent-failure-mode-in-production-rag-systems-and-treating-document-shelf-life-as-a-first-class-reliability-concern-3/) recommends surfacing `last_verified_date` in every context chunk so the model can hedge appropriately — for instance, prefixing an answer with "As of the documentation last updated on January 2025..."

The LLM-based approach has a critical weakness: it adds another point of potential hallucination. If the model ignores or misinterprets timestamps, stale information passes through without correction. For this reason, LLM self-assessment works best as a **complement** to algorithmic freshness scoring, not a replacement.

### Benchmarks confirm temporal signals are not optional

Four empirical studies establish that temporal augmentation materially improves retrieval quality. [TempRALM (Gade & Jetcheva, 2024)](https://arxiv.org/html/2401.13222v2) demonstrated **up to 74% improvement** over the baseline Atlas model by adding temporal augmentation, with the effect becoming more pronounced as few-shot examples increase. [MRAG (EMNLP 2025 Findings)](https://arxiv.org/abs/2412.15540) introduced the TempRAGEval benchmark and showed **9.3% improvement in top-1 answer recall** and **11% in evidence recall** using a semantic-temporal hybrid ranking, propagating to **4.5% improvement in exact match and F1** on downstream QA. [RAG4DyG](https://arxiv.org/html/2408.14523) found that removing the time decay modulation from its retrieval framework produced the **worst performance across all tasks**, "emphasizing the critical role of time decay in capturing temporal relevance." And [Grofsky's CERT dataset evaluation](https://arxiv.org/html/2509.19376) showed a complete failure mode — 0.00 accuracy — when temporal signals are omitted from freshness-sensitive queries.

These results converge on a clear conclusion: **semantic similarity alone is insufficient for time-sensitive retrieval**, and even a simple exponential decay prior produces dramatic improvements.

## Practical architecture for a freshness-aware graph RAG pipeline

For a senior engineer building a graph-backed RAG system, the research points to a layered architecture with four components working in concert.

**At ingest time**, every chunk should carry three temporal properties: `created_at` (first insertion), `updated_at` (last modification), and `source_freshness_class` (fast-decay, medium-decay, slow-decay). For git-backed knowledge bases, [git blame](https://git-scm.com/docs/git-blame) provides line-level timestamps and [git log](https://git-scm.com/docs/git-log) provides file-level edit frequency, enabling both timestamp and signal-based freshness computation. The [Endure approach](https://endure.codeslick.dev/) — weighting complexity, churn, and staleness into a composite score — offers a production-tested pattern for this.

**At graph maintenance time**, a scheduled Cypher query (daily or on each index rebuild) should identify transitively stale nodes using the multi-hop pattern described above, label them as `PotentiallyStale`, and optionally trigger re-extraction from updated source documents. [IncRML's change data capture](https://www.semantic-web-journal.net/content/incrml-incremental-knowledge-graph-construction-heterogeneous-data-sources) provides the theoretical basis for efficient incremental updates. Tools like [LightRAG](https://github.com/HKUDS/LightRAG) will need custom schema extensions to support `updated_at` on nodes and edges, since the framework [currently lacks temporal attributes](https://neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction/).

**At retrieval time**, a two-stage approach works best. First, apply a hard temporal filter to exclude content beyond a generous domain-specific outer bound. Second, apply a fused score: `α · similarity + (1 − α) · 0.5^(age_days / h)`, with α and h tuned per content class. [LangChain](https://api.python.langchain.com/en/latest/retrievers/langchain.retrievers.time_weighted_retriever.TimeWeightedVectorStoreRetriever.html) and [LlamaIndex](https://developers.llamaindex.ai/python/examples/node_postprocessor/timeweightedpostprocessordemo/) both provide production-ready implementations of this pattern. For deduplication of near-identical historical versions, LlamaIndex's [EmbeddingRecencyPostprocessor](https://developers.llamaindex.ai/python/framework/module_guides/querying/node_postprocessors/node_postprocessors/) eliminates older nodes above a similarity cutoff.

**At generation time**, include `last_updated` metadata in each context chunk so the LLM can hedge on temporal confidence. [RAGAS does not currently offer a freshness metric](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/), but its custom metric API allows building one — computing, for instance, the mean age of retrieved context chunks relative to the query's temporal intent.

## Conclusion

Three findings stand out from this analysis. First, **exponential decay with domain-specific half-lives is the best-supported decay model**, validated by Li and Croft's foundational work, extended by Efron and Golovchinsky's query-dependent rate estimation, and empirically confirmed by Grofsky's fused-score benchmarks. Step functions suit pipeline health monitoring (dbt-style SLAs) but lack the granularity retrieval ranking demands. Signal-based models incorporating edit frequency add value for content where update patterns vary — particularly git-backed documentation — but no published benchmark yet isolates their marginal contribution over timestamp-only decay.

Second, **graph structure is essential for detecting staleness that timestamps alone miss**. The Cypher patterns for dependency-based staleness propagation are straightforward to implement using Neo4j's native temporal types and variable-length path queries, but no existing framework — including LightRAG and GraphRAG — offers this out of the box. Building it requires custom schema extensions and scheduled maintenance queries.

Third, **the integration strategy should be a hybrid**: hard filters as a safety net, exponential-decay fusion for ranking, and timestamp metadata for LLM self-assessment. The empirical evidence is unambiguous — omitting temporal signals from retrieval causes catastrophic degradation on time-sensitive queries, ranging from complete failure (Grofsky) to 36% accuracy loss (TG-RAG) to missing the critical role of decay (RAG4DyG). The engineering cost of adding a half-life prior is trivial compared to the retrieval quality it unlocks.

---

## Bibliography

1. **"Time-Based Language Models"** — Li, X. and Croft, W.B. (CIKM 2003).
   URL: https://ciir.cs.umass.edu/pubfiles/ir-297.pdf
   Key contribution: Introduced exponential time-dependent document priors into the query-likelihood language model framework, establishing the foundational P(D|T_D) = λ·e^(−λ(T_C − T_D)) formulation for temporal IR.

2. **"Estimation Methods for Ranking Recent Information"** — Efron, M. and Golovchinsky, G. (SIGIR 2011).
   DOI: 10.1145/2009916.2009984 | URL: https://dl.acm.org/doi/10.1145/2009916.2009984
   Key contribution: Made the exponential decay rate query-dependent (λ_q = 1/T̄), allowing different queries to have different temporal profiles via pseudo-relevance feedback.

3. **"Solving Freshness in RAG: A Simple Recency Prior and the Limits of Heuristic Trend Detection"** — Grofsky, M. (2025).
   URL: https://arxiv.org/html/2509.19376
   Key contribution: Empirically demonstrated that a half-life fused score achieves 1.00 accuracy on freshness tasks where cosine-only retrieval scores 0.00, on both synthetic and CERT real-world datasets.

4. **"Term-Recency for TF-IDF, BM25 and USE Term Weighting"** — Marwah, K. and Beel, J. (WOSP 2020, ACL).
   URL: https://aclanthology.org/2020.wosp-1.5/
   Key contribution: Introduced tTF-IDF with a term-age factor that outperformed standard TF-IDF on all three test datasets, correcting for temporal distribution bias in term frequency.

5. **"Survey of Temporal Information Retrieval and Related Applications"** — Campos, R. et al. (ACM Computing Surveys, 2014).
   DOI: 10.1145/2619088 | URL: https://dl.acm.org/doi/10.1145/2619088
   Key contribution: Comprehensive survey categorizing temporal IR into document timestamping, temporal query intent, temporal ranking models, and temporal summarization.

6. **"It's High Time: A Survey of Temporal Information Retrieval and Question Answering"** (2025).
   URL: https://arxiv.org/html/2505.20243v2
   Key contribution: Updated TIR survey tracing the evolution from rule-based systems to transformer/LLM approaches, highlighting the persistent tension between semantic and temporal relevance.

7. **"It's About Time: Incorporating Temporality in Retrieval Augmented Language Models" (TempRALM)** — Gade, S. and Jetcheva, J. (2024).
   URL: https://arxiv.org/html/2401.13222v2
   Key contribution: Demonstrated up to 74% improvement over baseline Atlas by adding temporal augmentation to retrieval, without requiring index recalculation.

8. **"MRAG: A Modular Retrieval Framework for Time-Sensitive Question Answering"** — Zhang et al. (EMNLP 2025 Findings).
   URL: https://arxiv.org/abs/2412.15540
   Key contribution: Introduced the TempRAGEval benchmark and achieved 9.3% top-1 answer recall improvement with semantic-temporal hybrid ranking.

9. **"RAG Meets Temporal Graphs: Time-Sensitive Question Answering" (TG-RAG)**.
   URL: https://arxiv.org/pdf/2510.13590
   Key contribution: Showed that disabling temporal retrieval causes correctness to drop from 0.599 to 0.382 on financial QA tasks using earnings-call transcripts.

10. **"Retrieval Augmented Generation for Dynamic Graph Modeling" (RAG4DyG)**.
    URL: https://arxiv.org/html/2408.14523
    Key contribution: Ablation demonstrating that the w/o Decay variant produces worst performance across tasks, confirming time decay's critical role.

11. **"Time-Sensitive Retrieval-Augmented Generation for Question Answering"** (CIKM 2024).
    DOI: 10.1145/3627673.3679800 | URL: https://dl.acm.org/doi/10.1145/3627673.3679800
    Key contribution: Showed embedding-based methods struggle with explicit temporal constraints; proposed supervised contrastive learning with temporal negative sampling.

12. **OpenSearch Function Score Documentation** (Decay Functions).
    URL: https://docs.opensearch.org/latest/query-dsl/compound/function-score/
    Key contribution: Production-grade implementation of Gaussian, exponential, and linear decay functions with configurable origin, scale, offset, and decay parameters.

13. **Neo4j Cypher Manual — Temporal Values**.
    URL: https://neo4j.com/docs/cypher-manual/current/values-and-types/temporal/
    Key contribution: Documentation of Neo4j's built-in DATE, DATETIME, DURATION types with index-backed range queries.

14. **Neo4j Getting Started — Dates, Datetimes, and Durations**.
    URL: https://neo4j.com/docs/getting-started/current/cypher-intro/dates-datetimes-durations/
    Key contribution: Practical examples of temporal property creation, filtering, and arithmetic in Cypher.

15. **LangChain TimeWeightedVectorStoreRetriever**.
    URL: https://api.python.langchain.com/en/latest/retrievers/langchain.retrievers.time_weighted_retriever.TimeWeightedVectorStoreRetriever.html
    Key contribution: Production implementation of additive time-weighted retrieval: score = (1 − decay_rate)^hours_passed + vectorRelevance.

16. **LlamaIndex Node Postprocessor Modules** (TimeWeightedPostprocessor, EmbeddingRecencyPostprocessor).
    URL: https://developers.llamaindex.ai/python/framework/module_guides/querying/node_postprocessors/node_postprocessors/
    Key contribution: Configurable time-decay reranking and recency-aware deduplication for retrieved nodes.

17. **Haystack Metadata Filtering Documentation**.
    URL: https://docs.haystack.deepset.ai/docs/metadata-filtering
    Key contribution: Hard temporal filtering via date comparison operators on document metadata.

18. **RAGAS Available Metrics**.
    URL: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/
    Key contribution: Confirms no built-in freshness/recency metric exists; custom metrics needed.

19. **LightRAG** — HKUDS (EMNLP 2025).
    URL: https://github.com/HKUDS/LightRAG | Paper: https://arxiv.org/html/2410.05779v1
    Key contribution: Knowledge graph RAG with weight attributes on edges but no temporal/freshness features in default schema.

20. **"Under the Covers With LightRAG: Extraction"** — Neo4j Blog.
    URL: https://neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction/
    Key contribution: Analysis of LightRAG's weight attribute for retrieval prioritization, confirming absence of temporal metadata.

21. **"Sancus: Staleness-Aware Communication-Avoiding Full-Graph Decentralized Training"** (VLDB 2022).
    URL: https://dl.acm.org/doi/10.14778/3538598.3538614
    Key contribution: Formal bounded embedding staleness metrics for graph neural networks, achieving 74% communication avoidance without accuracy loss.

22. **"Rethinking the Memory Staleness Problem in Dynamic GNN"**.
    URL: https://arxiv.org/pdf/2209.02462
    Key contribution: Temporal attention mechanism for stale node memory in dynamic graphs using neighbor aggregation.

23. **"IncRML: Incremental Knowledge Graph Construction from Heterogeneous Data Sources"**.
    URL: https://www.semantic-web-journal.net/content/incrml-incremental-knowledge-graph-construction-heterogeneous-data-sources
    Key contribution: Timestamp-based and snapshot-based change data capture for KG updates, achieving up to 315x storage reduction vs. full regeneration.

24. **"Temporal Agents with Knowledge Graphs"** — OpenAI Cookbook.
    URL: https://cookbook.openai.com/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents
    Key contribution: Practical pipeline for time-stamped triplet creation and temporal conflict resolution in knowledge graphs.

25. **"Temporal Knowledge Graph Completion: A Survey"** (IJCAI 2023).
    URL: https://arxiv.org/abs/2201.08236
    Key contribution: Comprehensive survey of TKG methods categorized as translation-based, decomposition-based, and GNN-based approaches.

26. **Git Blame Documentation**.
    URL: https://git-scm.com/docs/git-blame
    Key contribution: Line-level temporal annotation of content with commit timestamps and authors.

27. **dbt Source Freshness Documentation**.
    URL: https://docs.getdbt.com/reference/resource-properties/freshness
    Key contribution: Step-function freshness model with warn_after/error_after thresholds for data pipeline SLAs.

28. **"Relating Wikipedia Article Quality to Edit Behavior and Link Structure"** — Applied Network Science (2020).
    URL: https://appliednetsci.springeropen.com/articles/10.1007/s41109-020-00305-y
    Key contribution: Edit-label frequency and transition probability features predict article quality with ROC-AUC >75%.

29. **"Methods for Evaluating Freshness"** — Briggsby.
    URL: https://www.briggsby.com/methods-for-evaluating-freshness
    Key contribution: Patent-based analysis of Google's freshness scoring including inception-date decay, FreshRank, proportional document change, and crawl-rate tier optimization.

30. **"Contents and Time Sensitive Document Ranking"** — UNSW Technical Report.
    URL: https://cgi.cse.unsw.edu.au/~reports/papers/201408.pdf
    Key contribution: Per-topic exponential decay factors based on topical longevity scores, arguing against uniform decay constants.

31. **Endure — AI Code Maintenance Intelligence**.
    URL: https://endure.codeslick.dev/
    Key contribution: Git-based composite scoring of complexity, churn, and staleness for code and documentation health monitoring.

32. **"The Half-Life of Knowledge" Framework** — Uplatz.
    URL: https://uplatz.com/blog/the-half-life-of-knowledge-a-framework-for-measuring-obsolescence-and-architecting-temporally-aware-information-systems/
    Key contribution: Domain-specific half-life estimates (medicine: 18–24 months, engineering: ~10 years) for configuring decay parameters.