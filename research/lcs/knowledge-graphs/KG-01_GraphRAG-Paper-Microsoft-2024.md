# KG-01: GraphRAG Paper — Microsoft 2024

**Status:** Complete
**Researched via:** Gemini Search + Synthesis
**Date:** 2026-03-10

---

**Domain:** Domain 2: Knowledge Graphs & Graph RAG
**Type:** Paper read + implementation analysis
**Priority:** P0 BLOCKER
**Feeds ADR:** ADR-001
**Cross-references:** PA-02, KG-06, KG-03

---

## Scope

Full analysis of Microsoft's GraphRAG (arXiv:2404.16130, "From Local to Global: A Graph RAG Approach to Query-Focused Summarization"). Covers the complete pipeline from raw corpus to query-time retrieval, community detection mechanics, local vs. global search modes, implementation realities from the github.com/microsoft/graphrag repository, failure modes, and compute economics. The foundational reference for our graph layer and a direct input to ADR-001.

---

## Sources Consulted

| # | Source | Type | URL/Path |
|---|--------|------|----------|
| 1 | GraphRAG Paper | Primary | https://arxiv.org/abs/2404.16130 |
| 2 | Microsoft GraphRAG Repository | Code | https://github.com/microsoft/graphrag |
| 3 | Microsoft GraphRAG Documentation | Docs | https://microsoft.github.io/graphrag/ |
| 4 | Microsoft Research Blog | Blog | https://www.microsoft.com/en-us/research/blog/graphrag-new-tool-for-complex-data-discovery-now-on-github/ |
| 5 | Leiden Algorithm Paper | Primary | https://www.nature.com/articles/s41598-019-41695-z |
| 6 | LightRAG Repository | Comparison | https://github.com/HKUDS/LightRAG |
| 7 | GraphRAG-Bench (2026) | Benchmark | arXiv |
| 8 | Community benchmarks and cost analyses | Secondary | emergentmind.com, superlinear.eu, reddit.com/r/MachineLearning |

---

## What We Learned

### 1. The Problem GraphRAG Solves

Standard vector-based RAG systems retrieve text chunks by semantic similarity. They are competent at answering specific factual questions ("What is X?") but structurally unable to answer what the paper calls "global sensemaking" queries: questions that require synthesizing information dispersed across thousands of documents ("What are the main themes across this entire corpus?" or "Which entities are most influential in this dataset?"). Vector similarity search does not compose across chunks — each retrieval is local to its neighborhood in embedding space.

GraphRAG's core thesis: transform unstructured text into a structured knowledge graph, detect communities of densely-connected entities within that graph, pre-generate LLM summaries for every community at every hierarchical level during indexing, and use those pre-computed community summaries as the retrieval unit for global queries at runtime. The shift moves the expensive synthesis work from query time to indexing time.

---

### 2. Pipeline Stages: Raw Corpus to Query-Ready Index

GraphRAG's indexing pipeline has five sequential stages. Each stage is implemented as a configurable workflow step in the `microsoft/graphrag` repository, orchestrated through a pipeline YAML configuration.

#### Stage 1: Document Ingestion and Chunking

Raw documents are split into text chunks, typically 300–600 tokens in size. The chunk size is a configurable parameter and has significant downstream effects: smaller chunks produce more granular entities but require proportionally more LLM calls; larger chunks risk entity extraction missing connections that span chunk boundaries.

The repository implements this through a `TextSplitter` step. Documents carry provenance metadata through the entire pipeline — each chunk retains its source document identifier, which eventually links back to original text at retrieval time.

#### Stage 2: Entity and Relationship Extraction

An LLM processes each chunk to extract:
- **Entities**: Named nodes with a type (person, organization, concept, location, event, etc.) and a short description.
- **Relationships**: Directed edges between entity pairs with a description and a weight reflecting how many times the relationship was observed across the corpus.

The extraction uses a structured prompt that instructs the LLM to output JSON. The repository applies a "gleanings" mechanism — after the initial extraction pass, the LLM is prompted again to check whether it missed any entities, allowing 1–2 additional passes per chunk when the model's self-evaluation suggests incompleteness. In practice this means 2–3 LLM calls per chunk at extraction.

Entities extracted from different chunks that represent the same real-world object are merged. The repository uses both string-matching heuristics and an optional LLM-based entity resolution step to collapse "Apple," "Apple Inc.," and "the tech giant" into a single canonical node.

#### Stage 3: Knowledge Graph Construction

Merged entities become graph nodes. Relationships become weighted, directed edges. The resulting graph is stored as a set of Parquet files in the repository's output directory (by default `./output/{run_id}/artifacts/`). Node tables include entity ID, name, type, description, and embedding vector. Edge tables include source, target, weight, and description.

The graph is not stored in a native graph database by default — the reference implementation uses flat columnar files. Downstream code loads these into memory or into NetworkX for community detection. This is a significant implementation gap from paper to code: the paper describes a knowledge graph; the repo ships a tabular graph representation with no built-in graph database backend.

#### Stage 4: Community Detection via Leiden

With the knowledge graph built, the pipeline applies the Leiden algorithm to partition graph nodes into hierarchical communities. Leiden was chosen over the older Louvain algorithm because Louvain can produce arbitrarily disconnected communities — an internal contradiction that Leiden explicitly fixes by guaranteeing all detected communities are connected subgraphs.

**How Leiden works mechanically:**
1. Initialize: each node is its own community.
2. Move phase: iteratively move nodes to neighboring communities if doing so improves the modularity objective (modularity measures how dense intra-community edges are relative to a random graph with the same degree sequence).
3. Refinement phase: Leiden's key addition over Louvain — a secondary pass that locally checks whether the partition can be improved without breaking community connectivity guarantees.
4. Aggregation: communities become super-nodes; the algorithm recurses on the aggregated graph to produce a coarser partition at the next hierarchical level.

The result is a hierarchy of community levels. In GraphRAG's convention, **Level 0 is the coarsest** (few, large communities representing broad themes) and **higher levels are finer** (many small communities representing specific entity clusters). The repository typically produces 3–5 levels depending on corpus size.

The implementation in `microsoft/graphrag` uses the `graspologic` Python library's Leiden implementation, which wraps the original C++ implementation. The community assignments are stored as additional node attributes.

**Communities as retrieval units**: this is the architectural insight. The community — not the document, not the chunk — becomes the unit over which retrieval is organized. A community of 40 entities spanning 200 source chunks now has a single summary document that captures what those entities are collectively about. This is what makes global search tractable.

#### Stage 5: Community Summarization

After Leiden runs, the pipeline generates a **community report** (summary) for every community at every hierarchical level using an LLM. This is the most expensive phase in terms of LLM calls.

Summarization is bottom-up:
1. Leaf-level communities (finest granularity) are summarized first.
2. Each next level up receives the summaries of its child communities as input context, producing increasingly broad summaries.
3. The process bottoms out at Level 0 with dataset-wide thematic summaries.

The community reports are structured documents containing:
- A title for the community
- A summary paragraph
- Key entities and their roles within the community
- Notable relationships
- Source text citations linking back to the original chunks

These reports are stored as Parquet files alongside the graph artifacts. They are the primary retrieval artifacts for global search queries. They are generated once at indexing time and do not update automatically when the corpus changes.

---

### 3. Community Detection Mechanics and Leiden Deep Dive

Understanding Leiden's behavior is critical for predicting GraphRAG's quality on a given corpus.

**Modularity optimization**: Leiden maximizes a modularity score `Q = (fraction of edges within communities) - (expected fraction if edges were placed at random)`. A graph with Q near 1 has extremely dense communities with sparse inter-community connections. A graph with Q near 0 has communities indistinguishable from a random partition.

**Why the graph's edge quality matters so much**: modularity optimization is only as good as the edge weights it operates on. In GraphRAG, edge weights come from LLM-extracted relationships — they reflect how many times the relationship was observed across chunks. If the extraction is noisy (spurious edges, missed edges, incorrect weights), modularity optimization will detect spurious communities or fail to detect real ones.

**Leiden's resolution limit**: all modularity-based algorithms have a resolution limit. Below a minimum community size (which scales with the total graph size), the algorithm cannot reliably detect communities. For large corpora, small but coherent topic clusters may be absorbed into larger communities or split arbitrarily. Leiden mitigates but does not eliminate this.

**The hierarchy's role in retrieval quality**: the choice of which hierarchical level to query at runtime is not automatic — it is a configuration parameter. Level 0 summaries are broad but may lose specific detail. Leaf-level summaries are specific but require synthesizing many more of them for global queries. Microsoft's implementation defaults to a configurable community level for global search, with Level 2 being a common starting point.

---

### 4. Local vs. Global Search Modes

GraphRAG exposes two fundamentally different retrieval modes that answer structurally different query types. Query routing between them is external to the retrieval system itself.

#### Local Search

**When to use**: queries about specific named entities, specific relationships, specific events. "What were the terms of the deal between Company A and Company B?" "Who is John Doe connected to?" "What regulations apply to X?"

**Mechanism**:
1. Named entities in the query are identified (via embedding search against the entity table or keyword match).
2. The system loads those entities' direct graph neighborhood: adjacent nodes, incident edges, and the leaf-level community reports for the communities those entities belong to.
3. Text chunks associated with the retrieved entities and relationships are loaded from the text unit table.
4. All retrieved context (entity descriptions, relationship descriptions, community reports, raw text chunks) is assembled into a single context window, ranked by a relevance scoring heuristic.
5. The LLM generates a response grounded in that assembled context.

**Strength**: precise, well-grounded answers for entity-specific questions. The graph structure allows traversal that pure vector search cannot — following a chain of relationships across entities that would never co-occur in the same text chunk.

**Weakness**: local search does not see the big picture. A question that requires understanding what all entities in a topic area share in common will receive a narrow, entity-specific answer.

**Token cost**: moderate. Typically 5,000–50,000 tokens per query depending on neighborhood size.

#### Global Search

**When to use**: thematic, holistic, or comparative questions that require synthesis across the full corpus. "What are the main themes in this dataset?" "Which risk factors appear most frequently across all documents?" "Compare the economic policies described across these 500 reports."

**Mechanism** (Map-Reduce):
1. The system selects all community reports at a configured hierarchy level.
2. **Map phase**: for each community report, the LLM is prompted to generate a "partial answer" to the user's query based solely on that report's content. Irrelevant community reports produce empty partial answers. These map calls are parallelized.
3. **Reduce phase**: the non-empty partial answers are collected and fed to the LLM to synthesize a single coherent final answer.

**Strength**: can genuinely synthesize information across an entire corpus. This is the mode that benchmarks show dramatically outperforming vector RAG on comprehensiveness and diversity metrics (72–83% comprehensiveness vs. near-zero for naive RAG on global queries in Microsoft's internal evaluations).

**Weakness**: extremely expensive. Global search can consume up to 610,000 tokens per query when processing all community summaries at a mid-level hierarchy. Latency is high — map phase parallelism helps, but reduce phase runs on many intermediate outputs. Costs of $0.02–$0.10 per global query are reported in production deployments.

**Token cost**: 50,000–610,000 tokens depending on corpus size and hierarchy level selected.

#### DRIFT Search (Post-Paper Extension)

In late 2024, Microsoft added DRIFT Search (Dynamic Reasoning and Inference with Flexible Traversal) to the repository. DRIFT is a hybrid mode that starts with community summaries (like global search) to generate follow-up questions, then uses those questions to drive local graph traversal. It targets complex queries that have a specific entity focus but require broad contextual understanding — the gap between local and global that neither pure mode handles well.

#### Dynamic Global Search (Post-Paper Extension)

Also in late 2024: Dynamic Global Search adds a pruning step before the map phase. Community reports are scored for relevance to the query before being sent to the LLM; irrelevant communities are dropped. This reduces the token cost of global search significantly for queries that only touch a portion of the corpus, while preserving accuracy.

#### Query Routing

The base GraphRAG implementation does **not** include an automatic query router. The caller selects local or global search explicitly. Production deployments typically add a lightweight LLM classifier or embedding-based router that scores the query against local-intent and global-intent exemplars to determine which mode to invoke. The heuristic is straightforward: if the query contains specific named entities or asks "what did X do," route to local. If the query asks "what themes/patterns/trends exist across," route to global.

---

### 5. Implementation vs. Paper Abstractions — Key Gaps

The `microsoft/graphrag` repository implements the paper's concepts faithfully in structure but reveals several practical details the paper elides:

**No graph database backend**: The reference implementation stores all graph data as Parquet files on the local filesystem. It uses `graspologic` (NetworkX-compatible) for community detection. There is no built-in Neo4j, Neptune, or property graph connector. The community has built adapters, but they are not part of the official distribution. This matters for LCS: if we want graph traversal at query time with sub-100ms latency, we need to either implement a proper graph store or keep the graph small enough to load into memory.

**Entity types are untyped by default**: The extraction prompt asks the LLM to assign entity types from an open set. The default entity types in the prompt are: `organization, person, geo, event`. These can be customized. For LCS's polymorphic node schema (cases, products, regulations, organizations, sites), this would require custom extraction prompts with our taxonomy. Without custom prompts, the extracted graph will mix our domain concepts under the paper's generic categories.

**Gleanings are expensive and non-deterministic**: The gleanings mechanism (re-prompting for missed entities) adds cost and produces non-deterministic output across runs. The repository defaults to 1 gleaning pass. Users report that disabling gleanings reduces cost 30–40% with modest quality degradation on dense technical text; on narrative prose, gleanings catch significantly more entities.

**Community level for global search is a manual knob**: There is no automatic selection of the right hierarchy level for a given query. The implementation exposes `community_level` as a query parameter. Choosing too coarsely produces vague answers; too finely produces expensive answers with too many map calls.

**Provenance is chunk-level, not sentence-level**: Source citations in community reports point to text chunk IDs. The repository stores the original chunk text and can retrieve it, but there is no sub-chunk citation granularity. For LCS use cases requiring fine-grained provenance ("which specific clause in which document says X"), chunk-level granularity may be insufficient.

**Incremental updates are not natively supported**: The indexing pipeline is designed as a full rebuild. The repository has partial support for re-running only changed document subsets, but community detection and summarization are still full-graph operations. There is no mechanism to patch a community summary when a node is updated.

---

### 6. Failure Modes

#### Failure Mode 1: Noisy Relation Extraction → Hairball Graph

The entire pipeline assumes that LLM-extracted entities and relationships are reasonably accurate. In practice, LLMs performing open information extraction produce:

- **Entity duplication**: "Apple," "Apple Inc.," "AAPL," and "the company" may all become distinct nodes unless entity resolution catches them. Imperfect resolution leaves ghost nodes with fractured edge distributions.
- **Co-occurrence false positives**: Two entities mentioned in the same sentence receive an edge even if their co-occurrence is incidental ("The conference was attended by CEO Alice and CEO Bob" creates an Alice-Bob relationship that may be meaningless).
- **Hallucinated relations**: LLMs sometimes infer relationships from context that are not stated in the text.
- **Missing relations**: low-salience relationships (implicit, nominalized, or distributed across sentences) are frequently missed.

The downstream effect is a "hairball" graph — densely interconnected across topic boundaries, with high noise in edge weights. Leiden's modularity optimization applied to a hairball produces communities that mix semantically unrelated entities, because the spurious cross-topic edges dilute the community separation signal.

**Severity for LCS**: high. LCS nodes span multiple structural types (cases, regulations, products, sites) with real semantic distinctions. Noisy extraction that conflates these types will corrupt community boundaries and produce summaries that mix unrelated legal and engineering concepts.

**Mitigation**: replace open entity typing with a schema-constrained extraction prompt. Define entity types and relationship types explicitly. This converts open information extraction into a typed extraction task, dramatically reducing noise but requiring upfront schema design work.

#### Failure Mode 2: Community Collapse

Community collapse occurs when Leiden's clustering produces either:
- **Over-merging**: radically different topics are lumped into a single large community because spurious edges create a bridge between otherwise disconnected clusters.
- **Over-fragmentation**: a coherent topic cluster is split into many small communities because the topic's entities are distributed across the corpus without sufficient mutual edges.

Over-merged communities produce summaries that are thematically incoherent — the LLM must reconcile entities from completely different domains. Over-fragmented communities produce summaries that are too narrow and miss cross-entity relationships within the topic.

**Detection**: monitor community size distribution. A healthy graph shows a roughly log-normal community size distribution. If 80% of nodes land in a single community (over-merging) or the median community has 2–3 entities (over-fragmentation), the graph topology is pathological.

**Severity for LCS**: medium-high. LCS's graph will have genuine structural complexity (cases referencing both regulations and products; sites associated with both legal cases and specific product types). Distinguishing this legitimate cross-type connectivity from noisy extraction requires careful prompt design.

#### Failure Mode 3: Stale Community Summaries

Community summaries are computed once at indexing time. When the underlying corpus changes, summaries become stale. This is not just an accuracy concern — it is a provenance integrity concern. A summary generated from January data that is served in response to a March query implies a data freshness guarantee that does not exist.

**Cascading staleness**: updating a single document is not contained. If the document introduces a new entity, that entity must be added to the graph, its communities must be re-detected (potentially reshuffling neighboring nodes), and all affected community summaries must be regenerated. In a large graph, a single document update can trigger recomputation of summaries for dozens of communities across multiple hierarchy levels.

**Severity for LCS**: critical. LCS data includes case status changes, regulation amendments, and product lifecycle events that change on short timescales. A GraphRAG index built at T₀ queried at T₀+30d without refresh will silently answer questions about the historical state of the corpus. Users will have no indication the summaries are stale.

**Mitigation options**:
1. Accept full-rebuild cost on a defined refresh schedule (e.g., nightly). Feasible at small scale.
2. Implement change detection to identify which communities were affected by a corpus delta and regenerate only those summaries. Requires tracking entity-to-community membership and document-to-entity membership across pipeline runs. Not supported natively.
3. Adopt a hybrid architecture (e.g., LightRAG pattern) that preserves raw chunks alongside the graph and performs real-time retrieval for recently changed documents while using the graph for stable background knowledge.

#### Failure Mode 4: Incremental Update Deadlock

The incremental update problem in GraphRAG is deeper than it appears:

1. Adding a document may introduce new entities.
2. New entities may connect to existing communities, changing those communities' internal edge densities.
3. Changed edge densities change the modularity landscape.
4. Re-running Leiden on the updated graph may produce a completely different partition, even for communities unaffected by the new document.
5. A completely different partition invalidates all previous community summaries.

This is not a bug — it reflects the global nature of modularity optimization. Community detection is a global algorithm applied to the full graph; local perturbations can have global effects on the partition.

**Severity for LCS**: critical for any corpus with frequent updates. LCS v1 may be able to treat indexing as a batch operation if the corpus is relatively static (stable case law, finalized regulations). For actively updated corpora (ongoing cases, pending regulations), a different architecture is required.

#### Failure Mode 5: Prompt Brittleness

The quality of the entire knowledge graph depends on a small number of extraction prompts. The default entity extraction prompt is written for general English prose. Domain-specific corpora (legal documents, technical specifications, regulatory filings) require specialized prompt design:

- Legal language uses terms of art that do not map to the default entity type taxonomy.
- Regulatory text often describes relationships through normative language ("X must comply with Y") that the default prompt may extract as a factual relationship rather than a regulatory obligation.
- Technical specifications may describe relationships between product components in ways that require domain knowledge to classify correctly.

Prompt tuning is iterative and expensive: each tuning iteration requires re-running a significant portion of the indexing pipeline to evaluate extraction quality. The `microsoft/graphrag` repository provides prompt tuning utilities (graph-community prompts, entity extraction prompts) but the tuning process is manual.

---

### 7. Compute and Cost Economics

#### Indexing Cost Structure

GraphRAG's indexing pipeline is dominated by LLM API costs. The breakdown per chunk:

| Phase | LLM Calls per Chunk | Notes |
|-------|---------------------|-------|
| Entity extraction | 1–2 | 2 with gleanings enabled |
| Relationship extraction | 1 | Often batched with entity extraction |
| Entity summarization | 1 per unique entity | Not per chunk — amortized across mentions |
| Community summarization | 1 per community (across all levels) | Not per chunk — computed once after Leiden |

At corpus scale, the cost scales approximately as:

| Corpus Size | Estimated Cost (GPT-4o-mini) |
|-------------|------------------------------|
| 5 MB | ~$35 |
| 500 MB | ~$3,500 |
| 5 GB | ~$33,000 |

These figures are from community benchmarks and production reports (as of early 2026, using GPT-4o-mini pricing). The "LLM tax" is approximately 75% of total token budget during indexing — before a single user query is answered. Using a more capable model (GPT-4o, Claude Sonnet) for extraction quality increases costs proportionally.

**Community summarization dominates at scale**: at small corpus sizes (< 5 MB), entity extraction accounts for most LLM cost. At large corpus sizes, the number of communities grows with corpus size, and community summarization becomes the dominant cost driver.

#### Query-Time Cost

| Search Mode | Token Consumption per Query | Estimated Cost (GPT-4o) |
|-------------|----------------------------|-------------------------|
| Local Search | 5,000–50,000 tokens | $0.001–$0.015 |
| Global Search (full) | Up to 610,000 tokens | $0.02–$0.10 |
| Dynamic Global Search (pruned) | 50,000–200,000 tokens (typical) | $0.005–$0.03 |

Global search's token consumption scales with corpus size because more communities means more community reports to process in the map phase. LightRAG's dual-level retrieval, by contrast, reduces query-time token consumption to roughly 100 tokens for equivalent queries — a 6,000x reduction — by avoiding the full community summary scan.

#### Refresh Cost

Refreshing a GraphRAG index is not incremental by default. A full rebuild incurs the full indexing cost above. Partial refresh (regenerating only affected communities) requires custom infrastructure not in the reference implementation. In practice, most production deployments choose a refresh cadence (daily, weekly) and accept the full rebuild cost. At 500 MB corpus size, this means ~$3,500 per refresh cycle — a significant operational cost for corpora with daily updates.

#### Latency

Global search latency in production deployments is reported at 10–60 seconds end-to-end for mid-size corpora (50–500 MB). The map phase is parallelized across community reports, so latency scales sub-linearly with corpus size, but the reduce phase adds fixed overhead. Local search is substantially faster: 2–10 seconds typical.

#### Cost Mitigation Strategies in Production

Several optimizations have emerged from the community:

1. **TERAG** (Token-Efficient RAG): replaces LLM-based graph construction with non-LLM structuring methods, achieving >80% of GraphRAG's multi-hop accuracy while reducing output token consumption during indexing by 89–97%.

2. **LightRAG pattern**: preserves raw chunks alongside entity relationships; bypasses map-reduce retrieval with a dual-level retrieval approach; supports incremental updates without full graph rebuild.

3. **AGRAG**: uses TF-IDF scoring and minimum-cost subgraph extraction instead of LLM entity extraction, eliminating extraction failures and reducing indexing token costs ~3.69x.

4. **GNN-RAG**: offloads graph traversal reasoning from the LLM to a Graph Neural Network, maintaining accuracy on multi-hop QA benchmarks while dramatically reducing per-query LLM cost.

---

### 8. Evaluation: What the Paper Measures and What It Doesn't

Microsoft's evaluation in the paper used the VIINA (Violent Incident Information from News Articles) dataset — a collection of Russian-language news articles about the Ukraine war, machine-translated to English. Results:

- GraphRAG (global search, C2 community level) achieved **72–83% comprehensiveness** and **62–82% diversity** scores on global queries, compared to a naive RAG baseline.
- The global search condition consistently produced more comprehensive and diverse answers than baseline RAG.
- Local search performed better than global search for specific entity-focused queries.

**Evaluation weaknesses**:
- Comprehensiveness and diversity were scored by an LLM judge (GPT-4 evaluating GPT-4 outputs) — circular evaluation that may favor the style of LLM outputs rather than factual correctness.
- No ground-truth factual accuracy evaluation. The paper measures answer quality by LLM assessment, not against verifiable facts.
- Single dataset. The VIINA corpus is large (hundreds of documents) but covers a single domain (conflict journalism). Generalization claims require caution.
- No latency or cost evaluation in the paper. These are entirely absent from the academic evaluation.

**GraphRAG-Bench** (2026, independent): introduced a multi-domain benchmark with verifiable ground truth. Findings are consistent with the paper on comprehensiveness for global queries but reveal that GraphRAG's 3.4x multi-hop accuracy improvement over vector RAG holds primarily for queries requiring 3+ reasoning hops. For 1–2 hop queries, the gap shrinks substantially and standard vector RAG with BM25 reranking is competitive.

---

## What It Means for LCS

### Architectural Implications

**Global search is the primary LCS value proposition**: LCS's core use case includes thematic and relational queries that span large collections of cases, regulations, and products. This is precisely GraphRAG's global search problem class. The comprehensiveness gains (72–83% vs. near-zero for naive RAG) are real and would translate directly to better answers for "what regulations apply to this product type" and "what patterns emerge across related cases" queries.

**Local search fills a different gap**: for entity-specific traversal ("what other products are associated with this case?", "which regulations cite this specific standard?"), local search's graph traversal provides multi-hop answers that vector RAG cannot produce without custom pipeline work.

**The schema constraint is mandatory, not optional**: LCS has a defined polymorphic node schema. Using GraphRAG with the default open extraction prompts would produce an untyped graph that collapses LCS's structural distinctions. Schema-constrained extraction (custom entity types: `case`, `product`, `regulation`, `site`, `organization`, `standard`) must be implemented before indexing. This is v1 work, not deferred.

**Incremental updates are the hardest problem**: LCS data changes. Active cases update. Regulations are amended. New products are added to databases. Standard GraphRAG assumes a mostly-static corpus. For LCS v1, the design must account for refresh strategy upfront, not as an afterthought. Options:
1. Accept batch rebuild on a defined schedule (weekly or nightly). Feasible only if corpus size keeps cost manageable.
2. Hybrid architecture: GraphRAG for stable background corpus (published regulations, closed cases); real-time vector RAG for active data. Communities never contain active data; they provide stable structural context.
3. LightRAG-style dual retrieval: abandon community summaries for the active data layer; use them only for the stable layer.

**Provenance requirements drive chunk size and report structure**: community reports cite chunk IDs. If LCS requires clause-level or sentence-level citation (e.g., "this interpretation is supported by Section 4.2 of Regulation X"), GraphRAG's chunk-level provenance is insufficient and requires additional sub-chunk citation infrastructure.

**The cost structure favors stable, large corpora**: the $35–$3,500 indexing cost range is a one-time (or periodic) capital cost. For a large, relatively stable corpus (published regulations, case law archive), this is acceptable. For frequently updated small corpora, the per-refresh cost becomes prohibitive relative to the accuracy gains. LCS's corpus characterization directly determines whether GraphRAG is cost-justified.

### LCS v1 Component Assessment: Adopt / Adapt / Reject

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| Entity/relation extraction pipeline | Adapt | Must replace open extraction with schema-constrained prompts for LCS types |
| Leiden community detection | Adopt | Algorithm is well-suited; parameters need tuning for LCS graph density |
| Community summarization | Adopt | Pre-computed summaries are the core value proposition; must implement for stable corpus |
| Global search (map-reduce) | Adopt | Essential for thematic query coverage; accept cost |
| Local search (graph traversal) | Adopt | Essential for entity-specific multi-hop queries |
| DRIFT search | Defer to v2 | Valuable hybrid but adds implementation complexity; not needed for v1 baseline |
| Incremental update | Reject (re-architect) | Native support is inadequate; requires hybrid stable/active corpus strategy from design |
| Community report provenance | Adapt | Chunk-level provenance must be augmented with finer citation for LCS compliance use cases |
| Default entity types | Reject | Must replace with LCS domain taxonomy |

---

## Decision Inputs

**Feeds:** ADR-001

| ADR | Question Answered | Our Finding |
|-----|-------------------|-------------|
| ADR-001 | Should LCS use community-centric graph retrieval? | Yes, with constraints: for global/thematic queries this is the best available approach. Must use schema-constrained extraction, batch refresh strategy, and hybrid architecture for active data. |
| ADR-001 | What query types does GraphRAG serve well vs. poorly? | Well: thematic synthesis, multi-hop entity traversal (3+ hops), global pattern queries. Poorly: specific fact retrieval (vector RAG is faster/cheaper), queries on frequently updated data. |
| ADR-001 | What is the compute cost commitment? | ~$35–$3,500 per full index build depending on corpus size. ~$0.02–$0.10 per global query. Full rebuild required for each refresh cycle. Budget must be established before indexing commitment. |
| ADR-001 | Is the schema portable to LCS polymorphic nodes? | Not out of the box. Custom extraction prompts with LCS entity taxonomy are required. Relationship types must also be domain-specified. |
| KG-06 | How does community structure affect query routing? | Community level is a manual parameter, not automatic. Query routing between local/global must be implemented externally. DRIFT search (late 2024) provides a hybrid mode worth evaluating for LCS complex queries. |
| KG-03 | What evaluation metrics are adequate? | Paper's LLM-judge evaluation (comprehensiveness, diversity) is weak for LCS — circular and lacks factual accuracy. LCS evaluation must include ground-truth accuracy and provenance correctness. GraphRAG-Bench methodology is closer to what LCS needs. |

---

## Open Questions

1. **What is LCS's corpus refresh rate?** The frequency of active case updates, regulation amendments, and product additions determines whether batch rebuild is acceptable or a hybrid stable/active architecture is mandatory. This is the most critical unresolved parameter for the incremental update strategy.

2. **What is the LCS entity taxonomy?** Schema-constrained extraction requires a finalized list of entity types and relationship types drawn from LCS's data model. This must be resolved before extraction prompt design can begin. Cross-reference with LCS polymorphic node schema documentation.

3. **What provenance granularity do LCS compliance use cases require?** Chunk-level citation may be acceptable for exploratory queries but insufficient for compliance or litigation support. If sentence-level or clause-level citation is required, the community report structure must be augmented, adding cost and complexity.

4. **At what corpus size does community collapse become a problem for LCS?** LCS's graph will have genuine cross-type connectivity (cases ↔ regulations ↔ products). The boundary between legitimate cross-type edges (which should form inter-community connections) and spurious extraction noise must be characterized through a small-scale pilot before committing to full indexing.

5. **Can Dynamic Global Search (late 2024 extension) bring query cost to acceptable levels?** The community pruning step before map-reduce can significantly reduce global search token consumption. This should be the default configuration, not the full map-reduce, for any production LCS deployment.

---

## Raw Notes

**Key technical terms:**
- **Modularity (Q)**: the optimization target for Leiden. Ranges from -0.5 to 1.0; values above 0.3 indicate meaningful community structure.
- **Gleanings**: GraphRAG's term for multi-pass entity extraction — prompting the LLM to review its own extraction output and report anything it missed.
- **Community report**: the LLM-generated summary document for a community; the primary retrieval artifact for global search.
- **Map-Reduce**: global search pattern; "map" generates partial answers per community report in parallel; "reduce" synthesizes the partial answers into a final response.
- **DRIFT**: Dynamic Reasoning and Inference with Flexible Traversal — post-paper hybrid search mode combining global community context with local graph traversal.

**Repository structure notes (microsoft/graphrag):**
- Configuration via `settings.yml` — all pipeline parameters including chunk size, LLM model, entity types, community levels.
- Output in `./output/{run_id}/artifacts/` — Parquet files for entities, relationships, communities, community reports, text units.
- `graphrag index` CLI command runs full indexing pipeline.
- `graphrag query` CLI command with `--method local` or `--method global` selects search mode.
- Prompt templates in `./prompts/` directory — these are the extraction and summarization prompts that must be customized for LCS.
- Python API available: `graphrag.query.structured_search` for programmatic integration.

**Benchmark citations:**
- Comprehensiveness scores (72–83%): from arXiv:2404.16130, Table 1, VIINA dataset, global search C2 community level.
- Multi-hop accuracy (3.4x improvement): from GraphRAG-Bench 2026, comparing GraphRAG global search vs. BM25+vector RAG baseline on 3+ hop queries.
- Token consumption (610K tokens for global search): from LightRAG comparison paper (HKUDS, late 2024).
- Cost estimates ($35–$33,000 indexing range): from community benchmarks using GPT-4o-mini pricing, early 2026.
- Query cost ($0.02–$0.10): from ragdollai.io production deployment analysis, early 2026.
- TERAG efficiency (89–97% token reduction): from TERAG arXiv preprint, 2025.
