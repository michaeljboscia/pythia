# LightRAG's architecture: graph-augmented retrieval dissected

LightRAG (arXiv:2410.05779, EMNLP 2025) combines knowledge graph traversal with vector similarity search to retrieve richer context than flat chunk-based RAG — at a fraction of GraphRAG's query-time token cost. Built by Zirui Guo, Lianghao Xia, Yanhua Yu, Tu Ao, and Chao Huang at BUPT and the University of Hong Kong (HKUDS), the system extracts entities and relationships from documents via LLM prompts, stores them in a pluggable graph+vector backend, and retrieves via a dual-level (local entity-centric + global relationship-centric) paradigm. Its default "mix" mode runs KG-structured retrieval and naive vector search in parallel, merges the results, and feeds a unified context to the generation LLM. On the LightRAG paper's own UltraDomain benchmarks, it outperforms Microsoft GraphRAG on 3 of 4 datasets — though independent bias-corrected evaluations suggest the margin is far smaller than reported.

The repository lives at [github.com/HKUDS/LightRAG](https://github.com/HKUDS/LightRAG). The paper is at [arxiv.org/abs/2410.05779](https://arxiv.org/abs/2410.05779).

---

## How dual-level retrieval and mix mode actually work

LightRAG's retrieval module `R = (φ, ψ)` separates indexing (`φ`) from retrieval (`ψ`). At query time, the system first calls the LLM with a keyword-extraction prompt (`PROMPTS["keywords_extraction"]` in `lightrag/prompt.py`) that returns a JSON object containing two arrays: **`low_level_keywords`** (entity-specific terms like "Tesla" or "Elon Musk") and **`high_level_keywords`** (thematic terms like "renewable energy" or "climate policy"). These keywords drive two distinct retrieval paths ([arxiv.org/html/2410.05779v1](https://arxiv.org/html/2410.05779v1), §3.2).

**Local (entity-centric) retrieval** — implemented in `_local_query()` at `operate.py` lines 2239–2467 — embeds the low-level keywords and queries `entities_vdb` (vector similarity against entity embeddings). For each matched entity, it calls `knowledge_graph_inst.get_node_edges(entity_name)` to perform **one-hop graph traversal**, collecting all connected edges and neighboring nodes. It then resolves associated text chunks through the `entity_chunks` KV store, which maps entity names to chunk IDs. Chunk ranking uses one of two strategies controlled by `kg_chunk_pick_method`: **WEIGHT** (priority based on edge count and node degree, via `pick_by_weighted_polling()` in `utils.py`) or **VECTOR** (re-embedding similarity via `chunks_vdb.query()`).

**Global (relationship-centric) retrieval** — `_global_query()` at `operate.py` lines 2630–2851 — instead queries `relationships_vdb` using both high- and low-level keywords. For each matched relationship, it retrieves both endpoint entity nodes via `knowledge_graph_inst.get_node()` and computes a **combined centrality score** from the degree of each endpoint. Chunks are resolved through `relation_chunks`, which maps `(src_id, tgt_id)` pairs to chunk IDs using the separator format `f"{src_id}<SEP>{tgt_id}"` ([deepwiki.com/HKUDS/LightRAG/2.3-query-engine](https://deepwiki.com/HKUDS/LightRAG/2.3-query-engine)).

**Hybrid mode** (`_hybrid_query()`, lines 2853–3009) runs both local and global in parallel via `asyncio.gather()`, then deduplicates entities by `entity_name` and relationships by `(src_id, tgt_id)`, concatenating descriptions with the `<SEP>` delimiter on collision.

**Mix mode** — the default since recent releases — goes further. Implemented in `_mix_query()` at lines 2080–2237, it runs `_local_query()` and `naive_query()` concurrently via `asyncio.gather()`. The naive path performs direct embedding similarity on the `chunks_vdb` with a reduced `top_k` (capped at 10). After both paths complete, chunks are merged with deduplication by `chunk_id`, and the final context is assembled into a prompt with two explicitly labeled sections — "From Knowledge Graph (KG)" and "From Document Chunks (DC)" — using the `PROMPTS["mix_rag_response"]` template. This lets the LLM weigh structured graph context against raw passage evidence ([neo4j.com/blog/developer/under-the-covers-with-lightrag-retrieval](https://neo4j.com/blog/developer/under-the-covers-with-lightrag-retrieval/)).

Token budgets are enforced in `_build_query_context()` (operate.py lines 1653–1806): entity descriptions are truncated to **`max_entity_tokens` (default 6,000)**, relationship descriptions to **`max_relation_tokens` (default 8,000)**, and remaining budget fills with text chunks, all within a **`max_total_tokens` ceiling of 30,000**.

---

## The graph construction pipeline from documents to queryable KG

LightRAG's indexing pipeline transforms raw text into a knowledge graph through four stages, all orchestrated by the `ainsert()` method in `lightrag/lightrag.py` and the extraction functions in `operate.py`.

**Stage 1 — Chunking.** The `chunking_by_token_size()` function (operate.py lines 66–118) splits documents into overlapping chunks of **1,200 tokens** (default) with **100-token overlap**. Each chunk receives a deterministic ID via MD5 hash (`compute_mdhash_id`), prefixed with `chunk-`. The chunk record stored in the `text_chunks` KV store contains `{content, tokens, full_doc_id, chunk_order_index}`.

**Stage 2 — LLM-based entity and relationship extraction.** Each chunk is sent to the LLM with the `entity_extraction_system_prompt` from `prompt.py`, which instructs the model to output structured tuples using `<|#|>` as the tuple delimiter. The default entity types are `["organization", "person", "geo", "event", "category"]`, configurable via the `ENTITY_TYPES` environment variable or `addon_params["entity_types"]`. Each entity tuple has four fields: `entity_name` (title-cased), `entity_type`, `entity_description`, and `entity_id`. Each relationship tuple has five fields: `source_entity`, `target_entity`, `relationship_keywords`, `relationship_description`, and `relationship_strength` (a float). A **gleaning** mechanism (controlled by `entity_extract_max_gleaning`, default 1) re-prompts the LLM with a more aggressive extraction prompt to catch missed entities ([neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction](https://neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction/)).

**Stage 3 — Deduplication and merging.** The `merge_nodes_and_edges()` function consolidates per-chunk extractions into a unified graph in three phases:

- **Phase 1 (Entities):** All occurrences of the same `entity_name` across chunks are grouped. Entity type conflicts are resolved by **majority voting** via Python's `Counter`. Descriptions from different chunks are concatenated with the `|||` separator; when fragment count exceeds `force_llm_summary_on_merge` (default 6–8), an LLM summarization call consolidates them. The `source_id` field accumulates pipe-delimited chunk IDs (e.g., `"chunk-abc|||chunk-def"`), and `file_path` similarly tracks provenance.
- **Phase 2 (Relationships):** Edges are canonicalized bidirectionally — `tuple(sorted(edge_key))` ensures `("Alex","Taylor")` and `("Taylor","Alex")` merge. **Weights are summed** across duplicate occurrences. Descriptions and keywords merge identically to entities.
- **Phase 3 (Indexing):** Entities and relationships are upserted into the graph backend, embedded via `embedding_func`, and stored in their respective vector databases. The `entity_chunks` and `relation_chunks` KV stores are updated with entity/relation-to-chunk-ID mappings.

The schema fields stored per entity node are: **`entity_name`**, **`entity_type`**, **`description`**, **`source_id`** (pipe-delimited chunk IDs), **`file_path`**, and **`entity_id`**. Per relationship edge: **`src_id`**, **`tgt_id`**, **`weight`** (float, summed across duplicates), **`description`**, **`keywords`**, **`source_id`**, and **`file_path`** ([github.com/HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)).

**Incremental updates** are a core design advantage. New documents go through the same extraction pipeline, and results are merged via graph union: `V = V ∪ V′`, `E = E ∪ E′`. Existing entities get their descriptions appended and types re-resolved. Per-key asyncio locks in `kg/shared_storage.py` prevent race conditions when multiple files reference the same entity. Concurrency is governed by `MAX_PARALLEL_INSERT` (recommended: `MAX_ASYNC/3`, between 2–10) ([arxiv.org/abs/2410.05779](https://arxiv.org/abs/2410.05779)).

**Deletion** is supported via `delete_by_doc_id()` and `delete_by_entity()`. Document deletion identifies all chunks belonging to the document, finds all entities/relationships sourced from those chunks, and either removes references (if other sources remain) or deletes the entity/relationship entirely from both the graph and vector stores. An `merge_entities()` method consolidates duplicate entities (e.g., merging "AI", "Artificial Intelligence", and "Machine Intelligence" into "AI Technology").

### Supported storage backends

LightRAG uses a **5-tier, 12-instance storage architecture** with pluggable backends:

- **Graph storage** (`chunk_entity_relation_graph`): **NetworkX** (default, in-memory with GraphML persistence), **Neo4j** (production-grade, Cypher MERGE upserts, `base` label for all nodes), **PostgreSQL AGE** (Apache AGE extension), **Memgraph**, **MongoDB** (MongoGraphStorage)
- **Vector storage** (`entities_vdb`, `relationships_vdb`, `chunks_vdb`): **NanoVectorDB** (default, lightweight file-based), **PostgreSQL pgvector**, **Milvus**, **ChromaDB**, **Qdrant**, **FAISS**, **MongoDB**
- **KV storage** (7 instances for chunks, docs, entity/relation mappings, LLM cache): **JSON files** (default), **PostgreSQL**, **Redis**, **MongoDB**
- **Document status storage**: **JSON** (default), **PostgreSQL**, **MongoDB**

Backend selection is configured via constructor parameters or environment variables (e.g., `LIGHTRAG_GRAPH_STORAGE=Neo4JStorage`). Workspace isolation varies by backend: file-based systems use subdirectories, collection-based systems use name prefixes, relational systems use a workspace field in tables, and Neo4j uses label-based logical isolation ([github.com/HKUDS/LightRAG](https://github.com/HKUDS/LightRAG), [deepwiki.com/HKUDS/LightRAG](https://deepwiki.com/HKUDS/LightRAG)).

---

## Benchmark results: LightRAG versus GraphRAG and the bias problem

The LightRAG paper evaluates against Microsoft GraphRAG (plus NaiveRAG, RQ-RAG, and HyDE) on four subsets of the **UltraDomain benchmark** (428 college textbooks across 18 domains): Agriculture, CS, Legal, and Mix. Evaluation uses GPT-4o-mini as an LLM-as-judge in pairwise comparison across **125 questions per dataset**, scoring Comprehensiveness, Diversity, Empowerment, and Overall as win-rate percentages ([arxiv.org/html/2410.05779v1](https://arxiv.org/html/2410.05779v1)).

On Overall win rate, LightRAG beats GraphRAG on **3 of 4 datasets**: Agriculture (**56.4% vs 43.6%**), CS (**54.0% vs 46.0%**), and Legal (**54.3% vs 45.7%**). GraphRAG edges ahead on Mix (**51.9% vs 48.1%**). LightRAG's most dominant dimension is Diversity, where it achieves **60–80% win rates** across all four datasets (e.g., 80.4% on Agriculture). Against non-graph baselines the margins are far larger — LightRAG achieves 82.5% Overall versus NaiveRAG's 17.5% on Legal.

The **cost differential** is dramatic. On the Legal dataset, GraphRAG consumes approximately **610,000 tokens per query** (one API call per community report), while LightRAG uses **fewer than 100 tokens** for the retrieval keyword-extraction step — a roughly **6,000× reduction** in query-time token cost. GraphRAG also incurs additional indexing overhead for community detection, hierarchical clustering, and community report generation that LightRAG avoids entirely ([arxiv.org/html/2410.05779v1](https://arxiv.org/html/2410.05779v1), [ragdollai.io/blog/lightrag-vector-rags-speed-meets-graph-reasoning-at-1-100th-the-cost](https://www.ragdollai.io/blog/lightrag-vector-rags-speed-meets-graph-reasoning-at-1-100th-the-cost)).

### Independent evaluations temper these claims significantly

A critical independent study from Wuhan University (arXiv:2506.06331) found that the LLM-as-judge evaluation methodology used by both LightRAG and GraphRAG contains **severe biases**: position bias (switching answer order causes >30% win-rate swings), length bias (LLMs favor longer answers), and trial bias (repeated runs produce inconsistent results). **After correcting for these biases, LightRAG's advantage over NaiveRAG largely vanishes** — the original 72% vs 28% win rate collapsed, with NaiveRAG slightly outperforming LightRAG in some corrected evaluations ([arxiv.org/html/2506.06331v1](https://arxiv.org/html/2506.06331v1)).

The **GraphRAG-Bench** study (arXiv:2506.05690, targeting ICLR 2026) evaluated LightRAG alongside GraphRAG, HippoRAG, HippoRAG2, Fast-GraphRAG, and NaiveRAG on 1,018 questions across Novel and Medical domains using accuracy and ROUGE-L (avoiding LLM-as-judge). Results were mixed: LightRAG led in Medical contextual summarization (**69.4% accuracy**) and creative generation (**70.8% F-score**), but Fast-GraphRAG and HippoRAG2 outperformed it on fact retrieval and complex reasoning tasks ([arxiv.org/html/2506.05690v1](https://arxiv.org/html/2506.05690v1)).

E²GraphRAG (arXiv:2505.24226) reports **up to 10× retrieval speedup** over LightRAG and notes that LightRAG's extraction quality **degrades significantly with smaller open-source models** like Llama 3.1, with indexing taking approximately 4 hours for a 200K-token book ([arxiv.org/html/2505.24226v1](https://arxiv.org/html/2505.24226v1)).

---

## Conclusion

LightRAG's core architectural contribution is decomposing graph-augmented retrieval into independent entity-centric and relationship-centric paths that can be combined with traditional vector search — all through a clean, pluggable storage abstraction. The mix-mode design of running KG traversal alongside naive vector retrieval in parallel via `asyncio.gather()` is pragmatically effective: it captures structured multi-hop reasoning from the graph while maintaining a safety net of direct semantic matching.

The **cost advantage is real and substantial** — the ~6,000× query-time token reduction versus GraphRAG holds up because LightRAG eliminates community-level processing entirely, replacing it with vector lookups against pre-embedded entity and relationship descriptions. Incremental update support (graph union rather than full rebuild) is a genuine operational advantage for production systems with evolving document corpora.

However, the **quality claims deserve skepticism**. The paper's LLM-as-judge benchmarks contain documented biases that inflate reported gains. Production teams should treat LightRAG's win-rate numbers as directional rather than absolute, and should expect performance to vary substantially by task type, domain, and underlying LLM capability — particularly with open-source models where extraction quality drops markedly. The system excels at diverse, thematically rich responses but does not consistently outperform simpler approaches on factual precision tasks. For production deployment, the mix mode with a reranker enabled represents the most robust configuration, combining the complementary strengths of structured graph context and raw semantic retrieval.