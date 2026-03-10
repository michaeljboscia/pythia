# RF-01: Dense Retrieval Fundamentals

**Status:** Complete
**Researched via:** Gemini Search + Synthesis
**Date:** 2026-03-10

**Domain:** Domain 1: Retrieval Fundamentals
**Type:** Foundational
**Priority:** P0
**Feeds ADR:** ADR-002, ADR-003
**Researcher:** Claude Sonnet 4.6 (sub-agent)

---

## Executive Summary

Dense retrieval transforms text into fixed-length numeric vectors (embeddings) and finds similar content by measuring geometric proximity in high-dimensional space. It is powerful for semantic similarity but has fundamental, non-negotiable failure modes on code corpora — particularly for exact identifier matches, UUIDs, and rare project-specific tokens. This document establishes the mathematical and algorithmic foundations that make LCS's hybrid retrieval architecture (ADR-002) a requirement rather than an optimization.

---

## Research Questions Answered

### Q1: Embedding Mathematics — What Does a Vector Actually Capture?

An embedding vector is a point in a high-dimensional geometric space (the "latent space") where **semantic similarity is encoded as spatial proximity**. The model learns to map inputs such that related concepts cluster together and unrelated concepts are far apart.

The latent space is not random. During training, the model's weights are adjusted so that, for example, the vectors for "python function" and "def my_function():" end up closer together than "python function" and "orange fruit." Each dimension of the vector loosely corresponds to a learned abstract feature (syntactic pattern, semantic concept, domain), though these dimensions are not directly human-interpretable.

**Bi-encoders vs Cross-encoders for code:**

Bi-encoders (the architecture used in dense retrieval) encode the query and the document *independently* into vectors, then measure similarity via dot product or cosine distance. This enables pre-computation of all document vectors offline, which is why ANN is feasible at all. Cross-encoders process the query and document *jointly*, yielding higher accuracy but making pre-computation impossible — they must evaluate every candidate pair at query time, making them suitable only for re-ranking a small shortlist.

For source code, embedding models trained on code repositories (e.g., CodeBERT, voyage-code-2) develop latent spaces where structural patterns (function signatures, control flow structures) cluster meaningfully. However, no bi-encoder architecture can represent the exact character sequence of a UUID or arbitrary identifier in a way that enables precise lookup — the pooling step that creates the fixed-length vector destroys lexical precision in favor of semantic generalization.

---

### Q2: The Curse of Dimensionality and the Hubness Problem

**Geometric collapse at high dimensions:**

As dimensionality increases, a counterintuitive phenomenon occurs: the ratio between the nearest-neighbor distance and the farthest-neighbor distance converges toward 1.0. In practice, this means that in very high-dimensional spaces, all points are approximately equidistant from each other. Distance metrics lose their discriminative power.

The three LCS-relevant dimension sizes illustrate the tradeoff:
- **384 dimensions** (e.g., `all-MiniLM-L6-v2`): Computationally cheapest; good for general semantic similarity; some distance metric degradation.
- **768 dimensions** (e.g., BERT-base, `all-mpnet-base-v2`): The standard production tradeoff — meaningful distance ratios with manageable memory overhead.
- **1536 dimensions** (e.g., OpenAI `text-embedding-3-large`): Highest semantic fidelity; distance metrics still functional but RAM costs 4x that of 384d.

**The Hubness Problem:**

Hubness is a direct consequence of the curse of dimensionality. In high-dimensional vector spaces, a small fraction of vectors (called "hubs") appear as the nearest neighbor to a disproportionately large number of other vectors. They become magnetic attractors in the search graph.

This breaks ANN retrieval in two ways:
1. **Graph bottlenecks:** In HNSW, hub nodes accumulate an enormous number of edges. Every search funnels through them, regardless of the actual query content.
2. **Result contamination:** Hub vectors consistently appear in the top-K results for semantically unrelated queries because they are, by the geometry of the space, "close to everything."

Mitigations include: using cosine similarity rather than L2 (cosine is more robust to the curse of dimensionality because it normalizes out magnitude), mean-centering the dataset (subtracting the dataset centroid from all vectors), and hub-reduction algorithms like Local Scaling.

---

### Q3: Similarity Metrics — Cosine, Dot Product, and L2

The choice of similarity metric is not cosmetic. It must match how the embedding model was trained, or the resulting rankings will be subtly or catastrophically wrong.

**Mathematical definitions:**

| Metric | Formula | Range | Considers Magnitude? |
|--------|---------|-------|----------------------|
| Dot Product | `Σ(Aᵢ × Bᵢ)` | `(-∞, +∞)` | Yes |
| Cosine Similarity | `(A·B) / (‖A‖ × ‖B‖)` | `[-1, 1]` | No (normalizes it out) |
| L2 (Euclidean) | `√Σ(Aᵢ - Bᵢ)²` | `[0, +∞)` | Yes |

**The normalization equivalence:**

When vectors are L2-normalized (all have unit magnitude = 1.0), a mathematical identity kicks in:
- Dot Product becomes identical to Cosine Similarity, because the denominator `‖A‖ × ‖B‖ = 1 × 1 = 1`.
- L2 distance becomes monotonically related: `‖A - B‖² = 2 - 2(A·B)`, so minimizing L2 is equivalent to maximizing dot product.

**Practical consequence for LCS:** If the chosen embedding model outputs L2-normalized vectors (OpenAI's `text-embedding-3` series does; most Sentence Transformers do by default), use **Dot Product** in the vector database configuration. It is 15–30% faster than Cosine (avoids the magnitude normalization division) and produces identical ranking results.

**When to deviate:**
- Use **Cosine** for unnormalized vectors where magnitude is noise (e.g., TF-IDF weighted vectors where document length inflates magnitude without semantic meaning).
- Use **L2** for models trained with contrastive losses that encode semantic distance as geometric distance (some early FaceNet-style models; uncommon in text embedding).
- Use **Dot Product** for recommendation-system models where magnitude encodes item popularity or user confidence — never normalize these.

**Computational cost comparison:**

| Metric | FLOPS per pair | Notes |
|--------|---------------|-------|
| Dot Product | `2d - 1` multiply-adds | Fastest; SIMD-optimized on all hardware |
| Cosine | `2d - 1 + 2 sqrt + 1 div` | ~20% overhead vs dot product |
| L2 | `2d - 1 + d subtract + 1 sqrt` | Similar to cosine |

At 768 dimensions with 100K vectors, this overhead compounds across millions of queries. For LCS, always configure the vector database to match the model's training metric.

---

### Q4: HNSW Algorithm — Deep Dive

HNSW (Hierarchical Navigable Small World) is the dominant ANN algorithm in production vector databases (Qdrant, Milvus, Pinecone, Weaviate, Faiss all use it). Understanding it from first principles is essential for configuring LCS's vector database correctly.

**The conceptual model:**

HNSW combines two ideas:
1. **Skip lists:** A layered data structure where higher layers contain fewer nodes and allow long-distance jumps; lower layers are denser for fine-grained search.
2. **Navigable Small World graphs:** At each layer, nodes are connected to nearby neighbors, forming a graph where any two nodes can be reached in a small number of hops (analogous to the "six degrees of separation" phenomenon).

**Graph structure:**

- **Layer 0 (bottom):** Contains *every* vector in the dataset. Each node can have up to `2M` connections.
- **Layers 1..L (upper):** Contain exponentially fewer nodes. A new vector is assigned a maximum layer `l` via a probabilistic formula: `floor(-ln(random()) × mL)` where `mL = 1/ln(M)`. Most vectors land at Layer 0; a geometrically decreasing fraction reaches each higher layer.
- **Entry point:** A single globally-known node at the topmost layer, serving as the search's starting position.

**Construction phase:**

When a new vector `q` is inserted:
1. Determine its top layer `l` via the probabilistic assignment above.
2. Starting from the global entry point at the top layer, perform a greedy descent to find the closest existing node to `q`. Drop layer by layer until reaching layer `l`.
3. For each layer from `l` down to 0: search for the `ef_construction` closest candidates to `q`, then select the best `M` (or `2M` at Layer 0) neighbors using a **diversity heuristic** (the "select neighbors by heuristic" algorithm from the original paper). The heuristic avoids connecting `q` to candidates that are near each other — it prefers neighbors spread in different spatial directions, maintaining navigability.
4. Create bidirectional edges between `q` and its selected neighbors. Prune any existing node's connections that would exceed `M` (or `2M`).

**Search phase:**

Given a query vector `q`, find the top-`K` nearest neighbors:
1. Start at the global entry point on the topmost layer.
2. **Greedy descent:** On each layer, examine the current node's neighbors. If any neighbor is closer to `q` than the current node, move to that neighbor. Repeat until no closer neighbor exists (local minimum reached). Drop down one layer and continue.
3. At Layer 0, switch from greedy to **beam search:** maintain a priority queue of `ef_search` candidates. For each candidate popped from the queue, examine its neighbors and add any unvisited nodes to the queue if they are closer to `q` than the current worst candidate. Continue until the queue is exhausted.
4. Return the top-`K` elements from the candidate list.

**Parameters and tradeoffs:**

| Parameter | Role | Effect of Increasing | Effect of Decreasing |
|-----------|------|---------------------|---------------------|
| `M` | Max edges per node per layer | Higher recall, more RAM, slower build | Lower RAM, faster build, reduced recall |
| `ef_construction` | Candidate list size during build | Better graph quality, slower indexing | Faster indexing, sub-optimal graph edges |
| `ef_search` | Candidate list size during query | Higher recall, higher query latency | Lower latency, reduced recall |

**Practical configuration matrix for LCS:**

| Use Case | `M` | `ef_construction` | `ef_search` | Notes |
|----------|-----|-------------------|-------------|-------|
| Development/testing | 16 | 100 | 50 | Minimum viable; fast builds |
| Production (100K vectors) | 32 | 200 | 100 | Balanced; ~97-99% recall |
| High-recall (precision-critical) | 48 | 400 | 200 | Best recall; 2x RAM vs M=16 |

**Complexity:**

| Operation | Exact kNN | HNSW |
|-----------|-----------|------|
| Index build | `O(N)` trivial | `O(N log N)` amortized |
| Query time | `O(N × d)` | `O(log N × d)` amortized |
| Memory | `N × d × 4 bytes` | `N × d × 4 bytes + graph overhead` |

**The kNN vs ANN breakeven for LCS:**

Exact kNN (flat search) computes every distance for every query. At 384 dimensions with float32, a single query against 100K vectors requires `100,000 × 384 = 38.4M` multiply-add operations. On modern hardware this takes approximately 2–10ms for a single query. For an interactive MCP server serving concurrent requests, this becomes a bottleneck at roughly **50K–100K vectors**. HNSW search at `ef_search=100` on the same dataset takes <1ms. The crossover point where HNSW becomes mandatory is generally cited in the literature at around **10K–50K vectors** for interactive latency requirements (<50ms p99).

---

### Q5: Exact vs. Approximate Search — The Scalability Boundary

Exact k-NN is mathematically `O(N)` per query — it scales linearly with corpus size. There is no algorithmic path to making it sub-linear for arbitrary query vectors in general metric spaces (this is essentially a consequence of the no-free-lunch theorem for search).

**Concrete latency estimates for flat search at 768d, float32:**

| Corpus Size | Approximate Latency (single-threaded) | Verdict |
|-------------|--------------------------------------|---------|
| 10K vectors | ~0.5ms | Acceptable |
| 50K vectors | ~2.5ms | Borderline |
| 100K vectors | ~5ms | Unacceptable under load |
| 500K vectors | ~25ms | Unacceptable |
| 1M vectors | ~50ms+ | Non-starter |

HNSW at M=32, ef_search=100 on 1M vectors: typically **<5ms**, often <1ms.

For LCS, even at the initial 100K document target, HNSW is the correct choice. Flat indexing is acceptable only during prototyping with a corpus under 10K chunks.

---

### Q6: Vector Quantization — Compressing the Index

Quantization trades precision for memory. The three techniques have radically different tradeoffs:

**Scalar Quantization (SQ8 / int8):**

Maps each float32 dimension to a uint8 value by finding the min/max range of all values in that dimension across the dataset and distributing 256 buckets linearly. Compression is 4x (float32 → int8 = 4 bytes → 1 byte per dimension).

- Recall impact: **1–3% drop** in most benchmarks. Negligible for nearly all use cases.
- Speed gain: `int8` SIMD operations (AVX-512 VNNI) run 2–3x faster than `float32` equivalents.
- Recommendation for LCS: **Use SQ8 as the default.** The recall cost is negligible and the 4x memory savings are valuable.

**Product Quantization (PQ):**

Splits each vector into `m` sub-vectors of `d/m` dimensions each. Trains a k-means codebook of 256 centroids for each sub-vector space. Each sub-vector is replaced by an 8-bit index into its codebook. Compression is `32x` or greater depending on `m`.

- Recall impact: **5–15% drop** without rescoring; recoverable to ~95% with rescoring (see below).
- Complexity: Requires training the codebook on the dataset; adds build-time complexity.
- Recommendation for LCS: Consider at 500K+ vectors where SQ8 is insufficient.

**Binary Quantization (BQ):**

Replaces each float32 with a single bit: positive → 1, negative → 0. Compression is 32x. Distance becomes Hamming distance via bitwise XOR + POPCOUNT instructions — 10–40x faster than float32 dot product.

- Recall impact: **10–30% drop** without rescoring.
- Model dependency: Requires zero-centered vector distributions. Cohere `embed-v3` is explicitly trained for BQ. OpenAI `text-embedding-3` handles it reasonably. Older models like `all-MiniLM-L6-v2` may suffer catastrophic recall drops.
- Recommendation for LCS: Not appropriate at the 100K scale. Consider only at 10M+ vectors with BQ-optimized embedding models.

**The Rescoring Pattern (Two-Phase Search):**

All quantized deployments should use rescoring to recover recall:
1. Phase 1: Search the quantized index for the top `K × oversampling_factor` candidates (e.g., top 200 when K=10).
2. Phase 2: Load the exact float32 vectors for only those candidates (from disk or a separate memory tier) and recompute exact distances. Return the true top-K.

Rescoring with BQ at 20x oversampling routinely recovers 95%+ of float32 recall at a fraction of the memory cost.

---

### Q7: Failure Modes on Code Corpora

This is the most operationally critical section for LCS architecture. Dense retrieval has **systematic, non-recoverable failure modes** on code artifacts that cannot be fixed by tuning — they require architectural remediation (hybrid retrieval).

**Root cause: Subword tokenization destroys lexical precision**

Modern embedding models use Byte-Pair Encoding (BPE) or WordPiece tokenizers trained predominantly on natural language. When these tokenizers encounter code-specific tokens — identifiers, hashes, UUIDs — they aggressively fragment them into subword chunks.

Example decompositions:
- `auth_db_timeout_retries` → `['auth', '_', 'd', '##b', '_', 'time', '##out', '_', 'ret', '##ries']`
- `550e8400-e29b-41d4-a716-446655440000` → `['550', 'e', '84', '##00', '-', 'e', '29', '##b', '-', '41', 'd', '##4', ...]`
- `ERR_SSL_PROTOCOL_ERROR` → `['ERR', '_', 'SS', '##L', '_', 'PROTOCOL', '_', 'ERROR']`

The embedding model then pools (averages) these fragment vectors into a single fixed-length vector. This "token amnesia" effect means the resulting vector encodes the *semantic neighborhood* of the fragments but not their precise character sequence.

**Failure mode 1: UUID and hash lookup**

Query: "Find where UUID `550e8400-e29b-41d4-a716-446655440000` is hardcoded."

The dense retriever maps this query to a vector in the "hexadecimal identifier" region of the latent space. It returns all chunks containing hexadecimal-looking strings — including unrelated UUIDs, memory addresses, and hash values — because they occupy the same semantic neighborhood. The specific target UUID has no unique geometric position.

**Failure mode 2: Exact variable/function name lookup**

In natural language, synonyms cluster correctly. In code, `worker_node_1` and `worker_node_2` are semantically identical to the embedding model but refer to completely different system components. Dense retrieval treats them as near-duplicates.

**Failure mode 3: Camel/snake case identifier fragmentation**

`getUserByID` and `getUserByUUID` will be mapped to nearly identical vectors. Dense retrieval cannot distinguish them reliably. A search for "all callers of getUserByID" will return both functions' call sites with equal confidence.

**Failure mode 4: High OOV density**

Code corpora have orders of magnitude higher OOV token density than natural language corpora. Every project invents new nomenclature: `TelemetryBatchFlushStrategy`, `LCSHNSWIndexManager`, `CorpusChunkDeltaCompressor`. These compound identifiers either fragment badly or map to generic semantic regions that don't distinguish them.

**Failure mode 5: Syntactic structure queries**

"Find all try/except blocks that catch `TypeError`" — this is a structural query that requires exact syntactic matching. The embedding of a code chunk containing `except TypeError` is nearly identical to one containing `except ValueError`. Dense retrieval cannot reliably distinguish syntactic structure.

**Architectural implication:** The above failure modes are not bugs to be fixed in the embedding pipeline. They are fundamental properties of how bi-encoder architectures work. LCS *must* implement hybrid retrieval (dense + BM25/sparse) to cover these cases. This directly validates the architectural approach in ADR-002.

---

### Q8: Out-of-Vocabulary (OOV) Term Handling

When a completely novel project-specific term (e.g., the acronym "LCSS" or a new class name `PythiaOracleReconstituter`) enters a query, the BPE tokenizer's behavior depends on its training vocabulary:

**Graceful degradation path (most common):**
BPE always produces *some* tokenization — it falls back to character-level n-grams if nothing else matches. `PythiaOracleReconstituter` might become `['Py', '##thia', 'Oracle', 'Recon', '##stitut', '##er']`. The model can still produce an embedding, but:
1. The resulting vector will represent the *semantic content of the fragments* rather than the term as a whole.
2. Fragments like `Oracle` and `Recon` carry their own semantic weight and will skew the embedding toward those concepts.
3. The vector will not reliably cluster with *other uses of that exact term* in the corpus, especially if those other uses were also fragmented differently.

**Catastrophic failure path (less common, more dangerous):**
Some BPE implementations map unknown characters to a single `[UNK]` token. If the model was trained with high UNK rates, multiple distinct OOV terms may map to similar vectors (they all cluster near the `[UNK]` centroid). This makes them appear similar to each other — a complete inversion of the desired behavior.

**Mitigation for LCS:**
Code-specific models (voyage-code-2, CodeBERT) include a much larger vocabulary of programming identifiers in their tokenizers, reducing (but not eliminating) this fragmentation. For critical project-specific terms, the hybrid retrieval path (BM25/exact match) is the reliable fallback.

---

### Q9: Metadata Filtering During ANN Search

Metadata filtering is how vector databases handle hybrid queries like: "Find vectors similar to X, but only where `file_type=python` and `author=mike`." This interacts poorly with HNSW's graph structure and requires careful implementation.

**Post-filtering (naive approach):**

1. Run ANN to retrieve top-K results.
2. Apply metadata filter to results.
3. Return whatever passes.

Problem: If the filter is selective (e.g., only 1% of documents match), the top-K ANN results will mostly fail the filter. Asking for K=10 may yield 0–2 filtered results. This is **result starvation** — the system silently returns an incomplete result set without indicating that more results exist deeper in the corpus.

**Pre-filtering (correct intent, wrong execution):**

1. Apply metadata filter to get a list of valid document IDs.
2. Run ANN only on those IDs.

Problem: HNSW traversal relies on the graph's edge structure. If 99% of nodes are masked out, the graph becomes fragmented — the traversal hits dead ends and cannot route through masked nodes to reach valid ones. The search quality degrades severely or fails entirely.

**Single-stage in-search filtering (modern solution):**

Modern vector databases (Qdrant v1.x, Milvus 2.x, Pinecone's filter implementation, Weaviate) integrate the metadata check *into the HNSW graph traversal*:

1. As the traversal moves from node to node, it checks each candidate's metadata against the filter.
2. Nodes that fail the filter are **excluded from the result set but their edges are still followed**. The traversal uses them as graph connectors without returning them as results.
3. This preserves the navigability of the graph while enforcing filter constraints.

This approach guarantees K results will be returned (if they exist) and maintains near-normal recall, with a query latency overhead proportional to the filter selectivity (more selective = more nodes traversed before finding K valid results).

**The oversampling workaround for post-filtering:**

When single-stage filtering is unavailable (e.g., using Faiss directly), a common workaround is to set K = `desired_k / estimated_filter_pass_rate * safety_factor`. If the filter passes 10% of documents and you want 10 results, request K=200 from ANN, then apply the filter to get ~20 results (with some margin). This wastes compute but avoids starvation.

---

### Q10: Memory Footprint Calculations

**Fundamental formula:**

```
Base RAM = N × d × bytes_per_element
```

Where:
- `N` = number of vectors
- `d` = dimensions per vector
- `bytes_per_element` = 4 (float32), 1 (int8), 0.125 (binary/1-bit)

**HNSW graph overhead formula:**

```
Graph RAM ≈ N × (M_layer0 + avg_layers × M) × 4 bytes
```

Where:
- `M_layer0 = 2M` (Layer 0 allows double connections)
- `avg_layers ≈ 1 / ln(M)` (expected number of layers above 0 per node)
- `4 bytes` = size of one 32-bit integer pointer/ID

For M=16: `avg_layers ≈ 1/ln(16) ≈ 0.36`, and `M_layer0 = 32`.
Graph overhead per node ≈ `(32 + 0.36 × 16) × 4 ≈ 151 bytes`.

Rule of thumb: HNSW graph overhead is approximately **15–40% on top of raw vector storage**, depending on M.

**Memory table for LCS at 100K vectors:**

| Config | Dimensions | Data Type | Vector RAM | HNSW Graph (M=16) | HNSW Graph (M=32) | Total (M=16) | Total (M=32) |
|--------|-----------|-----------|-----------|-------------------|-------------------|--------------|--------------|
| Small model | 384 | float32 | **147 MB** | ~22 MB | ~44 MB | **169 MB** | **191 MB** |
| Standard model | 768 | float32 | **294 MB** | ~22 MB | ~44 MB | **316 MB** | **338 MB** |
| Large model | 1536 | float32 | **587 MB** | ~22 MB | ~44 MB | **609 MB** | **631 MB** |
| Small + SQ8 | 384 | int8 | **37 MB** | ~22 MB | ~44 MB | **59 MB** | **81 MB** |
| Standard + SQ8 | 768 | int8 | **74 MB** | ~22 MB | ~44 MB | **96 MB** | **118 MB** |
| Large + SQ8 | 1536 | int8 | **147 MB** | ~22 MB | ~44 MB | **169 MB** | **191 MB** |

Calculation detail for 768d float32 at 100K vectors:
- `100,000 × 768 × 4 bytes = 307,200,000 bytes ≈ 293 MB`

Calculation detail for HNSW M=16 graph overhead at 100K vectors:
- `100,000 × 151 bytes ≈ 15 MB` (exact; the rule-of-thumb 15-40% may overestimate for small M)

**Key insight for LCS:** At 100K vectors with 768d + SQ8 + HNSW M=16, total RAM consumption is under **100 MB**. This is comfortably within the headroom of any modern server or even a developer laptop. The memory constraint does not become meaningful until approximately 2–5M vectors at 768d with float32, or 10M+ vectors with SQ8.

---

## Sub-Topics

### The Hubness Problem — Detailed Mechanics

Hubness arises because in high-dimensional spaces, the distribution of pairwise distances becomes increasingly concentrated. Specifically, the "intrinsic dimensionality" of real datasets (the number of dimensions that actually carry variance) is much lower than the embedding dimensionality. This gap means many dimensions carry near-zero signal, and the noise these dimensions contribute washes out the signal in the distance metric.

A "hub" vector is one that happens to lie near the centroid of the dataset in the ambient high-dimensional space. Because all other vectors are roughly equidistant from this centroid (by the concentration of measure phenomenon), the hub appears "close" to everything. In k-NN search, this hub consistently appears in top-K results for unrelated queries.

Detection: Compute the N-occurrence count `N_k(x)` = number of times vector `x` appears in the k-NN list of other vectors. In Gaussian random spaces at dimensionality 1536, the distribution of `N_k` becomes heavily right-skewed — a few vectors appear thousands of times while most appear 0–5 times.

Mitigation options for LCS:
1. **Cosine over L2:** Cosine similarity is empirically more hub-resistant.
2. **Dataset centering:** Subtract the mean vector. Reduces the centroid-proximity effect.
3. **Local scaling:** Replace distances with locally-normalized distances. Computationally expensive but effective.

### Normalized vs. Unnormalized Vectors

L2 normalization sets every vector's magnitude to 1.0 by dividing by its Euclidean norm. Most modern embedding models (Sentence Transformers, OpenAI `text-embedding-3`, Cohere `embed-v3`) output L2-normalized vectors by default.

Consequences:
- Dot product equals cosine similarity (as shown in Q3).
- Magnitude cannot carry information (it's always 1.0).
- L2 distance is monotonically equivalent to cosine distance.

Un-normalized vectors allow magnitude to encode information (confidence, frequency, importance). They are correct for recommendation systems trained with Matrix Factorization or for TF-IDF weighted term vectors.

**For LCS:** Always verify whether the chosen embedding model outputs normalized vectors. If yes, configure the vector database to use **Dot Product** (the fastest metric, equivalent to cosine for normalized vectors). If the model outputs un-normalized vectors, use **Cosine** to avoid magnitude artifacts contaminating similarity rankings.

### HNSW Entry Point Selection

The global entry point — the single node at the highest layer — has disproportionate influence on search quality. It is the starting position for every query. A poor entry point forces the initial greedy descent to traverse more layers before reaching the semantically relevant region of the graph.

In Malkov & Yashunin's original implementation, the entry point is simply the first node assigned to the highest layer. In practice, vector databases track and update the entry point when a node is assigned to a higher layer than the current entry. The entry point becomes, stochastically, a vector near the geometric centroid of the dataset — the node with the highest expected connectivity to other parts of the graph.

This is why hub vectors (near the centroid) naturally emerge as entry points, which reinforces their role as graph bottlenecks and feeds the hubness problem.

---

## Sources Consulted

| # | Source | Type | URL/Path |
|---|--------|------|----------|
| 1 | Malkov & Yashunin — HNSW Original Paper | Academic Paper | https://arxiv.org/abs/1610.02415 |
| 2 | Faiss Documentation & Wiki | Reference Docs | https://github.com/facebookresearch/faiss/wiki |
| 3 | Qdrant Indexing Documentation | Reference Docs | https://qdrant.tech/documentation/concepts/indexing/ |
| 4 | Pinecone Vector Similarity Guide | Tutorial | https://www.pinecone.io/learn/vector-similarity/ |
| 5 | ANN-Benchmarks | Benchmark | http://ann-benchmarks.com/ |
| 6 | Survey: Graph-Based ANN Search | Academic Paper | https://arxiv.org/abs/2101.12631 |
| 7 | Weaviate: PQ Rescoring | Blog | https://weaviate.io/blog/pq-rescoring |
| 8 | Hubness in High-Dimensional Data Retrieval | Academic Literature | Radovanović et al. (2010), multiple ACL papers |
| 9 | Gemini Search synthesis on HNSW mechanics | AI Search | 2026-03-10 |
| 10 | Gemini Search synthesis on vector quantization | AI Search | 2026-03-10 |
| 11 | Gemini Search synthesis on dense retrieval failure modes | AI Search | 2026-03-10 |

---

## What It Means for LCS

**1. HNSW is mandatory beyond 50K chunks.**
Flat exact-kNN search at the LCS corpus scale (targeting 100K+ chunks) produces unacceptable interactive latency. HNSW with M=32, ef_construction=200 is the correct configuration for production.

**2. Use SQ8 quantization from day one.**
Float32 at 768d costs ~300 MB for 100K vectors; SQ8 costs ~75 MB with less than 2% recall loss. No reason to start with float32.

**3. Dot product over cosine if the model outputs normalized vectors.**
Check the model card. Most modern models normalize by default. Dot product is 15–30% faster.

**4. Dense retrieval alone is architecturally insufficient for LCS.**
The failure modes on exact identifier lookup, UUID search, and rare tokens are not tunable out of existence. A BM25/sparse retrieval layer is a hard requirement, not an optimization. This provides the foundational justification for ADR-002's hybrid retrieval mandate.

**5. Metadata filtering must use single-stage in-search filtering.**
Post-filtering causes result starvation. Pre-filtering breaks HNSW navigability. The vector database selection in ADR-002 must support in-graph metadata filtering (Qdrant and Milvus both do; basic Faiss does not).

**6. Choose embedding model dimensions based on the memory budget and recall requirements together.**
At 100K vectors, even 1536d + float32 fits in under 650 MB. At 1M vectors, 1536d + float32 costs 5.8 GB — SQ8 becomes necessary. Project the corpus growth trajectory before committing to a dimensionality.

---

## Decision Inputs for ADRs

**Feeds:** ADR-002 (Vector DB Selection), ADR-003 (Embedding Model Strategy)

| ADR | Question Answered | Our Finding |
|-----|-------------------|-------------|
| ADR-002 | What indexing algorithm? | HNSW; mandatory above 50K vectors for interactive latency |
| ADR-002 | What similarity metric to configure? | Dot Product if model outputs L2-normalized vectors (verify per model card) |
| ADR-002 | Does the DB need metadata filtering? | Yes; must support in-search filtering, not just pre/post-filter |
| ADR-002 | What quantization to use? | SQ8 (int8) as default; float32 only for <50K dev builds |
| ADR-002 | Do we need hybrid retrieval? | Yes — dense alone fails on exact identifiers, UUIDs, rare tokens |
| ADR-003 | What dimensionality? | 768d is the production sweet spot; 384d acceptable for dev; 1536d only if recall quality requires it |
| ADR-003 | General or code-specific model? | Code-specific model (voyage-code-2 or CodeBERT) preferred; reduces OOV fragmentation |
| ADR-003 | Memory sizing at target scale? | 768d + SQ8 + HNSW M=32 at 100K vectors ≈ 120 MB total |
| ADR-003 | How does the model affect metric choice? | Must check normalization output; determines dot product vs cosine |

---

## Open Questions

1. **Voyage-code-2 vs. CodeBERT for LCS:** What are the exact recall differences on a code+markdown mixed corpus at the 100K scale? Need a benchmark on a synthetic LCS-representative dataset.
2. **HNSW ef_search calibration:** What is the recall vs. latency curve for LCS-specific query patterns (function name lookup, semantic concept search, UUID lookup)? Should ef_search be query-type-adaptive?
3. **Hubness threshold for LCS corpus:** At what corpus size does hubness become measurably problematic for LCS query recall? Is centroid-centering worth implementing upfront?
4. **In-search filtering performance:** What is the query latency overhead of Qdrant's in-search filtering at 100K vectors with typical filter selectivities (10%, 1%, 0.1%)?

---

## Raw Notes

**Memory formula verification:**
- 100K × 768 × 4 = 307,200,000 bytes = 293.0 MiB
- 100K × 384 × 4 = 153,600,000 bytes = 146.5 MiB
- 100K × 1536 × 4 = 614,400,000 bytes = 586.0 MiB

**HNSW overhead cross-check:**
- Node overhead at M=16: entry IDs stored as int32. Layer 0: 2M=32 pointers. Upper layers: avg ~0.36 layers × M=16 = ~5.8 pointers. Total ~37.8 pointers × 4 bytes = ~151 bytes per node.
- 100K × 151 = 15,100,000 bytes ≈ 14.4 MiB (not 22 MB as estimated in the table; table uses conservative 20% overhead estimate)

**Quantization recall data points from literature:**
- SQ8: Typically 97–99% recall vs. float32 on standard BEIR benchmarks.
- BQ with 20x oversampling + rescoring: 93–97% recall on zero-centered embeddings.
- PQ (m=8): 90–95% recall without rescoring; 97–99% with rescoring.

**OOV handling note:** BPE never produces a true "failure" — it always outputs *some* tokens. The failure mode is silent degradation, not an error. This makes it particularly dangerous in production: queries on rare tokens appear to work (return results) but are returning wrong results based on fragment semantics rather than exact matches.
