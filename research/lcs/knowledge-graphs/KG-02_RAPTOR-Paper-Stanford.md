# KG-02: RAPTOR Paper — Stanford

**Status:** Complete
**Researched via:** Gemini Search + Synthesis
**Date:** 2026-03-10

---

## Overview

RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval) is a retrieval-augmented generation framework introduced by Sarthi et al. at Stanford University and published at ICLR 2024 (arXiv:2401.18059). The core thesis is that standard flat RAG systems fail on questions requiring holistic document understanding — questions about themes, cross-chapter relationships, or multi-hop reasoning — because they only retrieve small, isolated text windows. RAPTOR solves this by constructing a hierarchical tree of summaries at index time, enabling the retrieval system to access both fine-grained leaf-level text and high-level abstractions simultaneously.

This document covers the RAPTOR pipeline in full technical depth, fidelity and drift characteristics, retrieval mechanism comparison, benchmark results, storage and cost overhead, and a critical assessment of where RAPTOR assumptions break on mixed code+documentation corpora — directly addressing the decision criteria for LCS ADR-004.

---

## 1. The RAPTOR Pipeline: Bottom-Up Tree Construction

RAPTOR builds a hierarchical index through a repeating cycle applied level by level until a single root node is reached. The pipeline has five stages that compose recursively.

### Stage 1: Chunking (Leaf Node Creation)

The source corpus is split into short, contiguous text segments. The paper's reference implementation uses approximately 100 tokens per chunk, with boundaries adjusted to avoid cutting sentences mid-way. These raw chunks become the leaf nodes of the tree: they are never modified, never compressed, never discarded. Every subsequent level is built on top of them, but the leaves themselves remain verbatim source text.

This is architecturally significant. Because the leaf nodes survive intact, queries can always reach uncompressed original text during retrieval. Summary drift at upper levels cannot corrupt the raw evidence layer.

### Stage 2: Embedding

Each chunk is passed through an embedding model (the paper's experiments use SBERT; production deployments commonly substitute OpenAI or Cohere embeddings) to produce a dense vector. All chunks are mapped into a shared high-dimensional embedding space where semantic proximity corresponds to vector proximity.

### Stage 3: Dimensionality Reduction via UMAP

Embedding vectors are typically 768 to 1536 dimensions. Clustering in that space is computationally expensive and suffers from the curse of dimensionality, where Euclidean distance becomes progressively less meaningful as dimensionality rises. RAPTOR applies UMAP (Uniform Manifold Approximation and Projection) to reduce embeddings to a lower-dimensional space — typically 2 to 10 dimensions depending on corpus size — while preserving both local neighborhood structure and global topology.

The UMAP step is not a compression of information; it is a geometric transformation that makes the cluster structure legible to the downstream clustering algorithm. The original high-dimensional vectors are retained for retrieval-time similarity search; UMAP output is used only during index construction.

### Stage 4: Gaussian Mixture Model Clustering

RAPTOR uses Gaussian Mixture Models (GMMs) rather than hard-assignment algorithms like k-means. GMM is a probabilistic soft clustering approach: each chunk receives a probability score for every cluster rather than a single hard assignment. A chunk is included in a cluster if its membership probability exceeds a threshold.

This soft membership is architecturally critical. In real document corpora, a paragraph often spans two topics — a section discussing "authentication middleware" might be equally relevant to a cluster about "API security" and one about "request lifecycle management." Hard clustering would force an arbitrary single assignment. GMM allows the chunk to contribute to summaries in both clusters, preserving cross-topic relationships that hard clustering would sever.

The number of clusters is not fixed. RAPTOR uses the Bayesian Information Criterion (BIC) to automatically select the optimal cluster count by testing a range of values and selecting the one that best balances model fit against model complexity. This prevents both over-segmentation (too many tiny clusters) and under-segmentation (one massive cluster that produces a single low-quality summary).

### Stage 5: LLM Abstractive Summarization

Once clusters are formed, the full text of all chunks belonging to each cluster is assembled and fed to a language model with a summarization prompt. The LLM produces an abstractive summary for each cluster. These summaries become the parent nodes of the current layer — new text nodes placed one level above the chunks they summarize.

Abstractive summarization is deliberate. Extractive summarization (selecting verbatim sentences) would preserve more literal fidelity but would also preserve redundancy and fail to synthesize connections across disparate chunks in a cluster. Abstractive summarization produces condensed, coherent prose that captures the shared theme of the cluster at the cost of some detail loss — an explicit design tradeoff.

### Recursion

The parent summaries generated in Stage 5 become new nodes. They are embedded, passed through UMAP reduction, clustered with GMM, and summarized again. The cycle repeats until the entire corpus can be condensed into a single cluster — the root node. For typical document corpora this produces 2 to 4 levels of hierarchy. Deeper corpora or more granular cluster sizes produce taller trees.

The final data structure is a tree where:
- Leaf nodes: verbatim source chunks (no compression)
- Intermediate nodes: LLM-generated summaries of clusters of lower nodes
- Root node: a single summary of the entire corpus

Every node — leaf, intermediate, root — is embedded and stored in the vector index.

---

## 2. Fidelity During Hierarchical Compression: What Survives vs. What Is Lost

RAPTOR makes explicit tradeoffs at each level of the tree. Understanding exactly what survives and what is discarded is essential for reasoning about when to trust upper-level nodes and when they become unreliable.

### What Survives

**Thematic coherence.** Upper-level summaries reliably capture the dominant topics of their constituent clusters. If a set of chunks discusses authentication, rate limiting, and token expiration, the parent summary will represent those topics even if specific implementation details are absent.

**Cross-chunk relationships.** When a cluster contains chunks from different parts of a document or different documents, the LLM synthesizes connections that flat retrieval would miss entirely. This is the primary value proposition of RAPTOR: relationships that span chunk boundaries become visible at the parent level.

**High-frequency named entities.** Entities that appear repeatedly across multiple chunks in a cluster tend to survive summarization because the LLM's attention is naturally drawn to them. A module name or a key concept that appears in most chunks of a cluster will be represented in the summary.

**Structural sequence.** If chunks within a cluster have a clear procedural order (steps in a workflow, phases of a process), the LLM summary often preserves that sequence, sometimes more cleanly than the original fragmented chunks.

### What Is Lost

**Low-frequency specific facts.** A fact that appears in only one or two chunks within a large cluster is vulnerable to being dropped during summarization. The LLM optimizes for the cluster's dominant theme, and minority details are compressed out.

**Exact numerical values.** Specific numbers — thresholds, counts, version numbers, configuration values — are frequently lost or altered during abstractive summarization. An LLM summarizing a cluster that mentions "the default timeout is 30 seconds in versions before 3.4 and 60 seconds thereafter" may produce "the timeout is configurable based on version" — true in spirit, useless for precision queries.

**Conditional and negated statements.** Nuanced conditionals ("X works only when Y is false and Z is not set") tend to be flattened into absolute statements during summarization. The LLM generalizes conditions away. This is a systemic fidelity risk for technical corpora where conditions and qualifiers carry significant semantic weight.

**Code syntax.** Any literal code — function signatures, return types, parameter names, data types — is almost entirely unrecoverable from upper-level summaries. The LLM converts code semantics into prose descriptions, discarding the structural precision that makes code queryable.

**Inter-document provenance.** Once a summary node is created, it does not retain explicit attribution to specific source chunks. A retrieval system working with upper-level nodes cannot answer "which document contains this claim" without traversing back to the leaves.

---

## 3. Retrieval Mechanisms: Tree Traversal vs. Collapsed Tree

RAPTOR defines two distinct retrieval strategies for querying the constructed tree. The paper compares them empirically and the results are unambiguous in favor of one.

### Tree Traversal Retrieval

Tree traversal begins at the root node and descends the hierarchy. At each level, the retrieval system computes cosine similarity between the query embedding and the nodes at that level, selecting the top-k most similar nodes. It then descends into those nodes' children and repeats, continuing until it reaches the leaf layer.

The intuition is that the tree encodes a relevance gradient: the root narrows the search to the most relevant subtrees, and successive levels zoom in toward the specific information.

**When tree traversal is appropriate:** Traversal is most useful when the query is clearly about a high-level topic and the retriever needs to navigate efficiently without pulling every leaf. In large corpora where the tree is deep and broad, traversal can be more token-efficient because it prunes irrelevant branches early.

**The critical failure mode:** Tree traversal is rigidly constrained by the relevance decision made at each level. If the root-level summary does not happen to represent a query's concept prominently — because that concept was a minority theme in the root's cluster — the traversal branches away from the correct subtree at the very first step. This is a hard failure: no downstream retrieval can recover the relevant leaves once the branch is pruned. The traversal strategy amplifies the effect of summary drift at upper levels.

### Collapsed Tree Retrieval

Collapsed tree retrieval flattens the entire hierarchical structure into a single pool. Every node — from raw leaf chunks to the root summary — is considered a candidate. The query is embedded and compared against all nodes simultaneously via cosine similarity. The top-k nodes by score are selected up to a token budget (the paper's experiments use 2,000 tokens).

Because the pool contains both verbatim leaf text and high-level summaries, a query naturally pulls whichever nodes are most relevant: a broad thematic query retrieves high-level summaries; a specific factual query retrieves precise leaf chunks; a mixed query retrieves a blend.

**When collapsed tree is appropriate:** The paper's empirical results show collapsed tree consistently outperforming tree traversal across all three benchmarks. The flexibility to retrieve from any level simultaneously is the key advantage. Different queries require different abstraction levels; collapsed tree is the only mechanism that does not require the system to predict which level is needed before searching.

**The mitigation property:** Collapsed tree retrieval partially compensates for summary drift at upper levels. Even if a high-level summary has drifted from its source, the leaf nodes it summarizes remain unchanged in the pool. A query for specific details will find those leaf nodes directly regardless of what the parent summary says. The parent summary's drift is localized — it affects queries that only match the summary, not queries that can match the underlying leaves.

**The paper's recommendation:** All main baseline comparisons in the RAPTOR paper use collapsed tree. This is the recommended production configuration. Tree traversal is presented primarily as a comparison point and is not the default.

---

## 4. Benchmark Results vs. Flat Retrieval Baselines

The paper evaluates RAPTOR against three flat retrieval baselines (SBERT, BM25, DPR) using UnifiedQA-3B as the reader model across three datasets, then repeats the experiment with GPT-4. All numbers below use the collapsed tree retrieval configuration.

### NarrativeQA (ROUGE-L)

NarrativeQA requires comprehension across entire books and movie transcripts. Flat retrieval struggles because answers depend on information distributed across hundreds of pages.

| Retriever | Flat RAG | RAPTOR |
|-----------|----------|--------|
| SBERT | 29.26% | 30.87% |
| DPR | 29.56% | 30.94% |
| BM25 | 23.52% | 27.93% |

RAPTOR's improvement is most pronounced over BM25, which lacks semantic understanding and retrieves the wrong chunks most aggressively on narrative queries. SBERT and DPR baselines already have some semantic alignment, so RAPTOR's gain is smaller in absolute terms but still consistent.

### QASPER (Answer F1)

QASPER tests multi-hop synthesis within long NLP research papers. Correct answers often require combining claims from multiple sections.

| Retriever | Flat RAG | RAPTOR |
|-----------|----------|--------|
| SBERT | 36.23% | 36.70% |
| DPR | 31.13% | 33.66% |
| BM25 | 25.10% | 31.70% |

With GPT-4: flat RAG (DPR) achieved 53.0% F1; RAPTOR achieved 55.7% F1. The gain is real but modest relative to the QuALITY results, suggesting QASPER's questions are more amenable to flat retrieval because papers are shorter and more internally structured than novels.

### QuALITY (Accuracy)

QuALITY features multiple-choice questions over approximately 5,000-token documents requiring multi-step reasoning across the full text.

| Retriever | Flat RAG | RAPTOR |
|-----------|----------|--------|
| SBERT | 54.9% | 56.6% |
| DPR | 53.1% | 54.7% |
| BM25 | 49.9% | 52.1% |

The headline result: RAPTOR paired with GPT-4 achieves 82.6% absolute accuracy on QuALITY — a 20 percentage point improvement over the prior state-of-the-art. This is the paper's strongest result and the one most frequently cited.

### Pattern in the Results

Three patterns are consistent across all three benchmarks:

1. RAPTOR improves over every flat baseline, across all three retriever types. The improvement is not retriever-specific.

2. The gain is largest when paired with more capable reader models (GPT-4 > UnifiedQA-3B). The hierarchical context RAPTOR provides is more useful when the reader can actually use it. A weak reader model may not leverage multi-level context effectively.

3. RAPTOR's advantage is largest on queries requiring cross-section or cross-document synthesis. Narrow factual lookups show smaller margins because flat retrieval already handles them reasonably.

---

## 5. Storage Overhead and Indexing Cost

RAPTOR adds non-trivial cost at both index build time and at storage. These costs are front-loaded (index time) and ongoing (storage), with retrieval-time costs comparable to flat RAG once the index exists.

### Storage Amplification

The flat RAG baseline stores N chunks with N embedding vectors. RAPTOR stores those same N leaf nodes plus all summary nodes across all tree levels.

If the clustering algorithm produces an average branching factor b (each cluster summarizes b nodes on average), then the total additional node count approximates:

```
N/b + N/b² + N/b³ + ... ≈ N/(b-1)
```

For typical branching factors in the range of 5 to 15, this adds roughly 10% to 25% more nodes to the vector store. However, storage amplification is not just about row count. Summary nodes are often dense, information-rich text — sometimes longer per token than the original leaf chunks they summarize. In practice, storage amplification of 15% to 30% in vector entries is a reasonable estimate, with the actual token volume of stored text potentially higher.

Additionally, soft GMM clustering means individual chunks may appear in multiple clusters, which causes them to contribute to multiple parent summaries. The tree structure is not a strict tree in practice — it is closer to a DAG at the leaf level, with leaves potentially contributing to multiple first-level summaries.

### Indexing Cost (The Dominant Cost)

Standard flat RAG indexing cost is approximately: (embedding calls × N). RAPTOR's indexing pipeline adds:

1. UMAP dimensionality reduction — computationally cheap, runs locally in seconds to minutes
2. GMM clustering — computationally cheap, runs locally
3. LLM summarization calls — this is the expensive step

For every cluster at every level of the tree, RAPTOR makes one LLM summarization call with the full text of all cluster members as input. For a corpus with N leaf chunks and branching factor b, the total number of LLM summarization calls is approximately N/b + N/b² + ... ≈ N/(b-1). For N=10,000 chunks with b=10, this is approximately 1,100 LLM calls, each consuming the input tokens of its cluster plus generating output tokens for the summary.

With GPT-4 or equivalent models at production pricing, a moderately large codebase can incur meaningful cost during initial index construction. Index rebuilds triggered by corpus updates compound this cost.

**Dynamic update problem:** Flat RAG can update incrementally — add a new chunk, embed it, insert into the vector store. RAPTOR cannot update incrementally at scale. A change to a leaf node potentially invalidates its parent summary, which invalidates its grandparent summary, which invalidates the root. In practice, update strategies involve either full tree rebuilds (expensive) or partial rebuilds of affected branches (complex, requiring provenance chain tracking). Neither is as simple as flat RAG's append operation.

---

## 6. Summary Drift: Compounding Error Across Recursive Levels

Summary drift is the "telephone game" failure mode of recursive compression. Each summarization step introduces a small semantic shift. Because subsequent levels summarize those summaries rather than original text, shifts compound across levels.

### The Mechanism of Drift

Consider a simple three-level tree. At level 1, the LLM summarizes a cluster of leaf chunks. It paraphrases a conditional: "the cache eviction policy applies only when the memory threshold exceeds 80%" becomes "cache eviction is triggered by memory pressure." At level 2, that level-1 summary is clustered with other memory management summaries and the LLM synthesizes: "the system manages memory automatically." At level 3, the root receives this and produces: "the system has robust resource management."

The leaf nodes contain an exact threshold (80%). The root summary says nothing recoverable about it. A query for "cache eviction threshold" that somehow only reached the root would return useless context. More dangerously, a query that retrieved the level-2 summary might receive the plausible-sounding but imprecise "triggered by memory pressure" — which, if used by a reader model to generate an answer, produces a confident but partially wrong response.

### What Makes Drift Worse

**Longer paths from leaf to root.** A four-level tree accumulates four rounds of transformation. A two-level tree accumulates two. For large corpora that require tall trees, drift at the upper levels is more severe.

**Smaller cluster sizes.** Smaller clusters mean more summarization steps at each level, more LLM calls, and more opportunities for subtle semantic shifts to accumulate.

**Ambiguous or technical source text.** When source text is dense with jargon, conditional logic, or domain-specific precision, LLMs are more likely to produce summaries that regularize the language toward more common expressions — flattening precision into vagueness.

**LLM temperature settings during indexing.** Higher temperatures during summarization increase the probability of creative paraphrase that diverges from source meaning. RAPTOR implementations should use low or zero temperature for the summarization LLM at index build time.

### Mitigations in RAPTOR's Design

**Collapsed tree retrieval as the primary mitigation.** Because leaf nodes are always available in the retrieval pool, queries that require precision can reach uncompressed source text. The collapsed tree approach uses the summaries as semantic navigation tools while keeping the exact leaves as the ground truth retrieval targets. This is the most important drift mitigation in the system.

**Soft clustering.** By allowing a chunk to contribute to multiple clusters, soft clustering reduces the risk that a highly specific fact gets buried in a large cluster where it will be minority-detail and likely dropped. If a chunk is assigned to multiple clusters, its specific content has more chances to surface in a summary that captures it.

**Prompt engineering for summarization.** The LLM summarization prompt can be constrained to preserve specific categories of content: exact numerical values, named entities, conditional qualifiers. This is not in the original paper's default configuration but is a recommended adaptation for technical corpora.

**Empirical validation layer.** The responsible approach is to maintain a held-out test set of specific factual queries and run them against the tree at build time to measure how much precision degrades at each level. If level-2 summaries fail factual queries that level-1 summaries answer correctly, that signals unacceptable drift in the intermediate layer and warrants adjusting cluster size or summarization prompt.

---

## 7. Applicability to Mixed Code+Documentation Corpora

RAPTOR was designed and evaluated on prose: novels, scientific papers, multiple-choice reading comprehension. Its core assumptions — that text has natural thematic coherence, that semantic proximity in embedding space correlates with relevant clustering, that abstractive LLM summarization preserves the essential meaning of technical content — all hold reasonably well for natural language documents. They break in specific and predictable ways on code and architecture decision record (ADR) corpora.

### Assumption Break 1: Semantic Embeddings Do Not Capture Structural Dependencies in Code

RAPTOR clusters by semantic similarity in embedding space. For prose, semantic proximity is a good proxy for topical relevance. For code, it is not. Two functions may be semantically distant (one handles database writes, another handles HTTP parsing) but structurally coupled via a shared interface or dependency chain. UMAP + GMM clustering on text embeddings will separate these functions into different clusters, creating a summary hierarchy that does not reflect the actual module dependency graph.

The consequence: summaries produced from semantically-defined clusters of code will describe topics but not the call graph, inheritance relationships, or interface contracts that code consumers most often need. A developer querying "what does the database layer expose to the API layer" will receive thematic summaries rather than the actual interface contracts.

**Mitigation:** Augment or replace semantic clustering with structure-aware clustering. Use AST-derived call graphs, import graphs, or module dependency graphs as the clustering signal rather than or in addition to embedding proximity. This requires significant modifications to the RAPTOR pipeline beyond what the paper describes.

### Assumption Break 2: Abstractive LLM Summarization Destroys Code Syntax

An LLM summarizing a cluster of Python functions will produce natural language prose describing what the functions do. It will not preserve function signatures, type annotations, parameter names, or return types in a machine-parseable form. For natural language questions about intent and architecture, this is acceptable. For queries that require exact syntax — which constitute a large fraction of developer questions — the upper levels of a RAPTOR tree built on code are useless.

If a developer asks "what arguments does `create_session()` accept?", the answer requires the function signature verbatim. No summary level will contain this. Collapsed tree retrieval will succeed only if the leaf node containing the exact function definition is retrieved — which requires the query to match the leaf closely enough in embedding space to rank in the top-k.

**Mitigation:** Use collapsed tree retrieval exclusively (never tree traversal) for code corpora, ensuring leaves are always queryable. Additionally, apply AST-aware chunking to guarantee function signatures and their docstrings are never split across chunk boundaries.

### Assumption Break 3: Token-Based Chunking Severs Code at Syntactic Boundaries

RAPTOR's default chunking uses 100-token segments adjusted at sentence boundaries. Code does not have sentence boundaries in the natural language sense. A 100-token chunk applied to Python source may cut a function definition in half, placing the signature in one leaf and the body in another. The cluster containing only the signature will produce an incomplete summary; the cluster containing only the body will produce a decontextualized one.

**Mitigation:** Replace token-based chunking with AST-aware chunking. Tools like tree-sitter or language-specific parsers can define chunk boundaries at the level of function definitions, class definitions, or module-level blocks. Code and its associated docstring should be co-located in the same chunk. This is a prerequisite for using RAPTOR on any code corpus.

### Assumption Break 4: Short ADRs Provide Insufficient Cluster Signal

ADRs are typically 200 to 800 words and are highly structured but narrow in topical scope. A cluster of ADRs may contain documents that are semantically similar (they all discuss database choices, for example) but whose value lies in the temporal sequence of decisions and the rejected alternatives — context that abstractive summarization reliably discards.

A summary of five ADRs discussing database selection will likely describe the final chosen approach. It will not preserve the rejected alternatives, the constraints that drove the decision, or the version-specific context that motivated revisiting the decision in ADR-003 versus ADR-007. For decision-history retrieval, the leaf nodes are the primary value; the upper-level summaries add architectural navigation context but must not be trusted for historical accuracy.

**Mitigation:** Apply RAPTOR selectively. Treat ADR bodies as leaves always retained in collapsed tree retrieval. Use upper-level summaries only for high-level navigation (e.g., "which ADRs discuss storage layer decisions?"), not as the answer source.

### Assumption Break 5: Code Changes Invalidate the Index Frequently

Prose corpora are largely static. Codebases are updated continuously. Every merged PR potentially changes function signatures, module interfaces, and docstrings. RAPTOR's tree is built at index time and must be rebuilt when sources change. Full index rebuilds are expensive (repeated LLM calls at every level). Partial rebuilds require tracking which clusters were affected by which source changes — a bookkeeping problem the paper does not address.

**Mitigation:** For LCS v1, restrict RAPTOR to static or slowly-changing corpus segments (architectural documentation, stable API reference docs). Apply flat retrieval to the code corpus where change frequency is high, where index freshness is operationally critical, and where RAPTOR's assumptions break most severely.

---

## 8. Design Implications for LCS Architecture (ADR-004)

The following recommendations are derived from the research above and are intended to feed directly into ADR-004's scope decisions.

### For LCS v1 (Flat-First Baseline)

**Recommendation: Do not implement RAPTOR in v1. Implement flat retrieval with chunking policy designed to be RAPTOR-compatible.**

The v1 baseline should use flat retrieval because:
- RAPTOR's indexing cost requires LLM calls at index time, which adds operational complexity and API cost before baseline quality is established
- Code corpora require AST-aware chunking as a prerequisite, which is a non-trivial investment that should be validated first
- RAPTOR's benchmark gains are most pronounced on long-form prose; the LCS corpus mix (code + ADRs + docs) may not reproduce those gains without the structural adaptations described above
- Flat retrieval results establish the performance floor against which RAPTOR improvement can be measured

**Chunking policy for v1 that supports RAPTOR in v2:**
- Use AST-aware chunking for all code artifacts (tree-sitter or equivalent)
- Co-locate function signatures with their docstrings in the same chunk
- For ADRs and markdown docs, use semantic sentence boundary splitting rather than token-count splitting
- Target chunk sizes of 200-400 tokens for prose, function-scoped for code
- This chunking policy is compatible with both flat and RAPTOR retrieval

### For LCS v2 (RAPTOR Experiment)

**Recommendation: Implement RAPTOR selectively on the documentation and ADR corpus; apply flat retrieval on the code corpus.**

The v2 RAPTOR experiment should:
- Limit RAPTOR tree construction to the natural-language documentation layers (design docs, ADRs, READMEs)
- Apply collapsed tree retrieval exclusively — never tree traversal
- Use GPT-4-class models for the summarization step at index time, with temperature at 0 and explicit prompts to preserve named entities, version references, and conditional qualifiers
- Measure summary drift using a held-out factual test set before promoting to production
- Maintain flat retrieval for all code artifacts and fall back to leaf nodes for any query where precision is critical

### Cross-References

- **RF-09 (Chunking Policy):** The AST-aware chunking requirement for code corpora established here is the primary concrete chunking guidance from RAPTOR research. RAPTOR is not useful without correct chunk boundaries.
- **NL-03 (Natural Language Retrieval):** RAPTOR's collapsed tree retrieval is the recommended mode for NL queries over documentation. Upper-level summaries improve NL query performance on thematic questions; leaf retrieval remains necessary for factual precision.

### Risks That Should Block Adoption Until Resolved

1. **Index freshness:** No viable partial-rebuild strategy for code corpora. Entire tree rebuilds are required on meaningful changes. This is not acceptable for a codebase with daily commits. Block RAPTOR on code artifacts until incremental update is implemented or the corpus is restricted to stable documentation.

2. **Summary drift measurement:** No fidelity measurement framework in v1. RAPTOR on documentation should not go to production without a reproducible claim-retention evaluation against known facts in the corpus. Running precision queries against the tree at multiple levels and comparing with leaf-level retrieval is the minimum evaluation.

3. **Embedding model mismatch:** RAPTOR's clustering quality depends entirely on the quality of the embedding model. An embedding model that poorly represents code semantics will produce semantically incoherent clusters and therefore incoherent summaries. Embedding model selection must be validated on the specific LCS corpus before committing to RAPTOR indexing.

4. **LLM summarization hallucination:** At index build time, the LLM is operating on content it has never seen before and producing summaries that become permanent parts of the index. A hallucination in a summary becomes a persistent retrieval artifact that may silently influence answers for the index lifetime. This risk is lower for prose but present; it is higher for code and ADRs where the LLM may interpolate plausible-sounding but incorrect technical details.

---

## 9. Summary Assessment

RAPTOR represents a genuine advance over flat RAG for long-form natural language corpora with thematic depth. The 20 percentage point improvement on QuALITY with GPT-4 is real and reflects a fundamental capability gap in flat retrieval systems on queries requiring holistic document understanding. The collapsed tree mechanism is elegant: it builds a hierarchy for semantic navigation while always retaining the original source as a retrievable fallback.

The system's weaknesses are concentrated in three areas: indexing cost and rebuild complexity, summary drift at upper levels, and fundamental assumption mismatches with code corpora. All three are manageable for a documentation-focused corpus at the cost of significant additional engineering. None of them are acceptable to ignore if RAPTOR is applied naively to a mixed code+documentation corpus.

For LCS, the right application of RAPTOR is bounded and phased: flat retrieval first to establish baseline quality and chunk policy, then selective RAPTOR on the natural language documentation layer in v2 with rigorous fidelity measurement before any production use. The code corpus should not enter a RAPTOR tree without AST-aware chunking, structural clustering, and a solution to the index freshness problem.

---

## References

- Sarthi et al., "RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval," ICLR 2024. arXiv:2401.18059. https://arxiv.org/abs/2401.18059
- RAPTOR GitHub reference implementation: https://github.com/parthsarthi03/raptor
- OpenReview ICLR 2024 submission: https://openreview.net
- Stanford AI Lab project page: https://cs.stanford.edu

---

*Cross-references: ADR-004, RF-09, NL-03*
*Research scope: KG series, Knowledge Graph and Retrieval Architecture*
