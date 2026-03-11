# LCS Web Research Prompts — 81 Topics

**Purpose:** Copy-paste these into Gemini web Deep Research or Claude web Research mode.
**Target:** 2k-3k words per output, inline links, sourced bibliography (outside word count).
**Expected completion:** 15-20 minutes each.

**Format for each:** The prompt IS the entire block under the heading. Copy from "Research..." through "...word limit."

---

# Domain 1: Retrieval Fundamentals (RF)

---

## RF-03: Hybrid Retrieval — Dense + Sparse Fusion

Research hybrid retrieval architectures that combine dense vector search with sparse BM25 retrieval for RAG systems.

Focused questions:
1. What are the empirically measured recall and precision improvements when combining dense retrieval with BM25 in a hybrid pipeline, compared to either alone? Cite specific numbers from Anthropic's Contextual Retrieval paper (top-20 failure rate reductions), the BEIR benchmark suite, and Pinecone's hybrid search evaluation.
2. How do reciprocal rank fusion (RRF) and linear score combination compare as fusion strategies — what alpha/weight parameters are reported optimal across different retrieval scenarios?
3. What is the latency and infrastructure cost overhead of running parallel dense + sparse retrieval versus dense-only at scales of 100K–10M documents?

Primary search targets: Anthropic Contextual Retrieval blog post, BEIR benchmark repository (Thakur et al. 2021), Pinecone hybrid search documentation, Weaviate hybrid search docs, Vespa.ai hybrid ranking.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## RF-04: Score Fusion Algorithms (RRF, CombSUM, CombMNZ)

Research score fusion algorithms used to merge ranked lists from heterogeneous retrieval systems in RAG pipelines.

Focused questions:
1. How does Reciprocal Rank Fusion (RRF) work mathematically, and what are its empirically measured advantages over CombSUM and CombMNZ on standard IR benchmarks? Cite the original Cormack et al. (2009) RRF paper and subsequent evaluations.
2. What are the failure modes of RRF — specifically, when does it degrade compared to learned fusion or linear interpolation? What dataset characteristics predict this?
3. How do production systems (Elasticsearch, Vespa, Weaviate) implement score normalization before fusion, and what normalization strategy performs best when combining BM25 scores with cosine similarity scores?

Primary search targets: "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods" (Cormack et al. 2009), Elasticsearch RRF documentation, Vespa.ai rank profiles documentation, TREC evaluations of fusion methods.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## RF-05: Re-ranking with Cross-Encoders

Research cross-encoder re-ranking as a second-stage retrieval refinement for RAG systems.

Focused questions:
1. What is the measured precision improvement of adding a cross-encoder re-ranker (e.g., Cohere Rerank, ms-marco-MiniLM-L-12-v2, bge-reranker) on top of bi-encoder first-stage retrieval? Cite specific NDCG@10 and MRR improvements from BEIR, MS MARCO, and MTEB benchmarks.
2. What is the latency cost of cross-encoder re-ranking at different candidate set sizes (top-50, top-100, top-200) and batch sizes, and what is the practical sweet spot for RAG applications?
3. How does Cohere Rerank v3 compare to open-source alternatives (SBERT cross-encoders, BGE reranker, ColBERTv2) on retrieval quality and inference cost?

Primary search targets: SBERT cross-encoder documentation, Cohere Rerank documentation, BGE reranker (BAAI), MS MARCO passage re-ranking leaderboard, MTEB reranking benchmarks.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## RF-06: ColBERT and Late Interaction Models

Research ColBERT's late interaction retrieval mechanism as a middle ground between bi-encoders and cross-encoders.

Focused questions:
1. How does ColBERTv2's late interaction mechanism work technically — what is the MaxSim operation, how does it differ from single-vector bi-encoders, and what are the measured retrieval quality improvements on MS MARCO and BEIR benchmarks?
2. What is ColBERT's storage footprint (bytes per passage) compared to single-vector approaches, and how do compression techniques (ColBERTv2 residual compression, PLAID engine) reduce this?
3. What are the practical deployment considerations for ColBERT via RAGatouille or Stanford's ColBERT library — indexing time, query latency, and memory requirements for collections of 100K–1M passages?

Primary search targets: ColBERTv2 paper (Santhanam et al. 2022), PLAID engine paper, RAGatouille Python library documentation, Stanford ColBERT GitHub repository.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## RF-08: Context Window Packing Strategies

Research strategies for assembling and packing retrieved chunks into LLM context windows for RAG generation.

Focused questions:
1. What empirical evidence exists for optimal chunk ordering within the context window? Cite the "Lost in the Middle" paper (Liu et al. 2023) for position bias data, and any subsequent papers measuring the impact of chunk ordering on answer quality.
2. How do production RAG systems (LlamaIndex, LangChain) implement context assembly — what are the concrete strategies for deduplication, relevance filtering, and token budget allocation across retrieved passages?
3. What is the measured impact of including metadata (source file path, chunk position, relevance score) in the context window on generation quality, and how much token budget does this metadata consume?

Primary search targets: "Lost in the Middle: How Language Models Use Long Contexts" (Liu et al. 2023), LlamaIndex response synthesis documentation, LangChain context assembly patterns, Anthropic long-context evaluation blog posts.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## RF-11: Query Decomposition and Multi-Hop Retrieval

Research query decomposition techniques that break complex questions into sub-queries for multi-hop RAG retrieval.

Focused questions:
1. How do IRCoT (Interleaved Retrieval Chain-of-Thought) and Self-Ask decomposition compare on multi-hop QA benchmarks like HotpotQA and MuSiQue? Cite specific F1 or Exact Match improvements over single-hop retrieval.
2. What are the practical failure modes of query decomposition — when does breaking a query into sub-queries produce worse results than direct retrieval, and what query characteristics predict this?
3. How does LlamaIndex's SubQuestionQueryEngine implement decomposition, and what are the latency and cost implications of making multiple retrieval calls per user query?

Primary search targets: IRCoT paper (Trivedi et al. 2023), Self-Ask paper (Press et al. 2022), HotpotQA benchmark, MuSiQue benchmark, LlamaIndex SubQuestionQueryEngine documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## RF-12: Context Compression and Summarization for RAG

Research context compression techniques that reduce retrieved passage length before passing to the LLM generator.

Focused questions:
1. How does LLMLingua (and LLMLingua-2) compress retrieved contexts — what is the compression algorithm, what compression ratios are achievable, and what is the measured impact on downstream QA accuracy? Cite the original Microsoft Research papers.
2. How does RECOMP (Retrieval-augmented Compressive summarization) compare to LLMLingua — extractive vs. abstractive compression approaches and their measured tradeoffs on NaturalQuestions and TriviaQA?
3. What is the practical cost-benefit analysis: does the compute cost of compression offset the savings from reduced context tokens sent to the generator LLM?

Primary search targets: LLMLingua paper (Jiang et al. 2023), LLMLingua-2 paper, RECOMP paper (Xu et al. 2023), LangChain contextual compression retriever documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 2: Knowledge Graphs (KG)

---

## KG-04: Knowledge Graph Construction from Unstructured Text

Research automated knowledge graph construction pipelines that extract entities and relationships from unstructured text for RAG systems.

Focused questions:
1. How do LLM-based extraction pipelines (as used in GraphRAG and LightRAG) compare to traditional NER + relation extraction (spaCy, OpenIE) in terms of extraction precision, recall, and cost per document? Cite specific evaluations.
2. What entity resolution and deduplication strategies are used in production KG construction — how do systems handle the same entity appearing with different names or across multiple documents?
3. What is the practical extraction cost (API calls, tokens, latency) of building a knowledge graph from a 100K-token technical corpus using GPT-4/Claude vs. open-source models?

Primary search targets: GraphRAG paper (Microsoft, arXiv:2404.16130) extraction pipeline, LightRAG GitHub repository extraction code, spaCy relation extraction documentation, OpenIE (Stanford/AllenNLP).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## KG-05: Graph Traversal Algorithms for RAG Retrieval

Research graph traversal algorithms used to extract relevant subgraphs for knowledge-graph-augmented RAG systems.

Focused questions:
1. How do BFS, DFS, and personalized PageRank compare as subgraph extraction strategies for RAG — what are the measured differences in retrieval relevance and computational cost on knowledge graph benchmarks?
2. How does GraphRAG's community-based traversal (using Leiden algorithm communities) compare to direct multi-hop traversal for answering global sensemaking queries? Cite results from the GraphRAG paper.
3. What are the practical performance characteristics of multi-hop traversal (2-hop, 3-hop) in property graph databases (Neo4j, Kuzu) at scales of 10K–1M nodes — query latency and memory consumption?

Primary search targets: GraphRAG paper community summarization approach, Neo4j graph algorithms library documentation, Kuzu documentation, NetworkX traversal algorithms, personalized PageRank implementations.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## KG-06: Community Detection for Knowledge Graph Summarization

Research community detection algorithms applied to knowledge graphs for hierarchical summarization in RAG systems.

Focused questions:
1. How does the Leiden algorithm (used in GraphRAG) compare to Louvain for community detection on knowledge graphs — what are the quality differences (modularity scores) and computational performance differences? Cite the Leiden paper (Traag et al. 2019).
2. How does GraphRAG use detected communities to pre-generate summaries, and what is the measured impact on answer comprehensiveness for global queries compared to standard RAG? Cite specific results from the GraphRAG paper.
3. What are the computational costs and scaling characteristics of running Leiden community detection on graphs with 10K–100K nodes, and how frequently must communities be recomputed as the graph evolves?

Primary search targets: "From Louvain to Leiden" paper (Traag et al. 2019), GraphRAG paper (arXiv:2404.16130), igraph/NetworkX Leiden implementations, Neo4j Graph Data Science community detection.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## KG-07: Architecture Decision Records as Graph Knowledge

Research how Architecture Decision Records (ADRs) can be represented as knowledge graph nodes with typed relationships to code artifacts.

Focused questions:
1. What is the standard ADR format (Nygard/MADR templates), and what entity types and relationship types naturally emerge from ADR structure — DECISION, CONTEXT, CONSEQUENCE, SUPERSEDES, IMPLEMENTS, AFFECTS?
2. How can ADRs be automatically linked to code artifacts (functions, modules, config files) via reference extraction — what heuristics and NLP techniques connect "we chose PostgreSQL" to actual database configuration files?
3. What precedent exists in the software architecture community for machine-readable ADRs? Examine the MADR (Markdown Any Decision Records) specification and any tools that parse ADRs programmatically.

Primary search targets: Michael Nygard's original ADR blog post, MADR specification (adr.github.io), adr-tools GitHub repository, "Documenting Architecture Decisions" (Nygard 2011), log4brains ADR management tool.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## KG-08: Schema Design for Polymorphic Technical Knowledge Graphs

Research schema design patterns for knowledge graphs that must represent heterogeneous technical artifacts — source code, documentation, ADRs, configs, and tests.

Focused questions:
1. How do polymorphic node schemas work in property graph databases — specifically, how do Neo4j multi-labels and Kuzu node table inheritance handle nodes that are simultaneously a "Function" and a "DocumentedEntity"? What are the query performance implications?
2. What edge type taxonomies have been proposed for software knowledge graphs? Examine existing ontologies (CodeOntology, Software Mining ontology) and the relationship types used by GraphRAG/LightRAG.
3. How should schema evolution be handled when new artifact types are introduced — what are the practical approaches (schema-on-read vs. schema-on-write) and their tradeoffs for a continuously growing technical corpus?

Primary search targets: Neo4j multi-label documentation, Kuzu node table documentation, CodeOntology (Atzeni et al.), LightRAG edge schema (src_id, tgt_id, weight, keywords fields), GraphRAG entity types.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## KG-09: Relationship Extraction Strategies Compared

Research relationship extraction methods for building knowledge graphs from technical corpora, comparing LLM-based, rule-based, and hybrid approaches.

Focused questions:
1. How does LLM-based relationship extraction (as implemented in GraphRAG and LightRAG) compare to rule-based extraction (dependency parsing, regex patterns) and supervised models (SpanBERT, REBEL) on precision, recall, and cost? Cite specific benchmarks.
2. What prompt engineering strategies improve LLM extraction quality for technical relationships like "calls", "implements", "depends-on", "supersedes"? What are the failure modes (hallucinated relationships, missed implicit relationships)?
3. How does extraction quality degrade as corpus complexity increases — what happens when the same entity pair has multiple relationship types, or when relationships are implicit rather than explicitly stated?

Primary search targets: GraphRAG extraction prompts (GitHub source), LightRAG extraction pipeline, REBEL model (Hugging Face), SpanBERT for relation extraction, DocRED benchmark (cross-document RE).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## KG-10: LightRAG Architecture Deep Dive

Research the LightRAG system architecture — its dual-level retrieval, graph construction, and integration of knowledge graph with vector search.

Focused questions:
1. How does LightRAG's dual-level retrieval (local entity-centric + global relationship-centric) work technically, and how does its "mix" mode combine KG traversal with vector similarity? Cite the LightRAG paper and GitHub implementation.
2. What is LightRAG's graph construction pipeline — how does it extract entities and relationships, what schema fields are stored (entity_name, entity_type, src_id, tgt_id, weight, keywords), and how does it handle incremental updates and deletions?
3. How does LightRAG compare to GraphRAG on standard benchmarks — what are the measured differences in answer quality, retrieval accuracy, and computational cost? Cite the comparative evaluations in the LightRAG paper.

Primary search targets: LightRAG paper (HKUDS), LightRAG GitHub repository, GraphRAG comparative benchmarks, LightRAG supported storage backends (Neo4j, NetworkX, PostgreSQL AGE).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 3: Embedding Models (EM)

---

## EM-01: MTEB Leaderboard Deep Analysis

Research the Massive Text Embedding Benchmark (MTEB) leaderboard to understand current embedding model performance across retrieval-relevant tasks.

Focused questions:
1. What are the top-5 embedding models on MTEB retrieval tasks as of 2024-2025, and how do they compare on retrieval-specific metrics (NDCG@10) vs. overall MTEB score? Specifically compare OpenAI text-embedding-3-large, Voyage AI voyage-3, Cohere embed-v3, and the leading open-source models.
2. How do embedding dimensions (256, 512, 768, 1024, 1536, 3072) correlate with retrieval quality across different MTEB tasks — is there a diminishing returns threshold? Cite Matryoshka Representation Learning results.
3. What are the practical inference cost and latency differences between the top commercial APIs (OpenAI, Voyage, Cohere) and the top self-hosted models (BGE, GTE, E5) for embedding 1M tokens?

Primary search targets: MTEB leaderboard (huggingface.co/spaces/mteb/leaderboard), Matryoshka Representation Learning paper, OpenAI embeddings pricing, Voyage AI documentation, BAAI BGE models on Hugging Face.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-02: OpenAI text-embedding-3 Family

Research the OpenAI text-embedding-3-small and text-embedding-3-large models — their architecture, performance, and practical usage.

Focused questions:
1. What are the documented performance characteristics of text-embedding-3-small (1536d) and text-embedding-3-large (3072d) on MTEB retrieval benchmarks, and how do they compare to the previous ada-002 model? Cite OpenAI's published benchmarks.
2. How does the native dimension reduction feature work (shortening embeddings to 256 or 512 dimensions), and what is the measured quality degradation at each dimension level? Cite Matryoshka representation learning results.
3. What are the practical operational characteristics — max input tokens, pricing per million tokens, rate limits, batching behavior, and typical latency for embedding 1000 documents of 512 tokens each?

Primary search targets: OpenAI embeddings documentation, OpenAI embeddings guide, OpenAI pricing page, MTEB leaderboard entries for text-embedding-3-*, Matryoshka Representation Learning paper (Kusupati et al. 2022).

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-03: Voyage AI Embedding Models

Research Voyage AI's embedding models (voyage-3, voyage-code-3) — their architecture, code-specific capabilities, and benchmarks.

Focused questions:
1. How does voyage-code-3 compare to OpenAI text-embedding-3-large and Cohere embed-v3 on code retrieval benchmarks specifically? Cite MTEB code retrieval tasks and any Voyage-published evaluations.
2. What are Voyage AI's unique features — input type specification (query vs. document), truncation handling, dimension options — and how do they affect retrieval quality in practice?
3. What are the pricing, rate limits, and latency characteristics compared to OpenAI and Cohere for the same workload (embedding 1M tokens of mixed code and documentation)?

Primary search targets: Voyage AI documentation, Voyage AI blog posts, MTEB leaderboard entries for voyage-3 and voyage-code-3, Voyage AI pricing page, independent benchmark comparisons.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-04: Local Embedding via Ollama

Research running embedding models locally via Ollama for privacy-preserving, zero-cost embedding in development workflows.

Focused questions:
1. What embedding models does Ollama support (nomic-embed-text, mxbai-embed-large, all-minilm), and how do they compare to commercial APIs (OpenAI, Voyage) on MTEB retrieval benchmarks? Cite specific NDCG@10 scores.
2. What are the practical throughput and latency characteristics of running embedding inference on Apple Silicon (M1/M2/M3 Pro/Max) via Ollama — tokens per second, memory consumption, and batch processing capabilities?
3. What are the failure modes and operational considerations — model loading time, memory management with multiple models, and the quality gap between local and commercial embeddings for code-specific tasks?

Primary search targets: Ollama embedding documentation, nomic-embed-text model card (Nomic AI), mxbai-embed-large (mixedbread.ai), Ollama GitHub repository, MTEB entries for nomic-embed-text.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-05: Code Embedding Models Survey

Research embedding models specifically optimized for source code — their architectures, training data, and retrieval performance.

Focused questions:
1. How do code-specific embedding models (voyage-code-3, CodeBERT, UniXcoder, StarCoder embeddings) compare to general-purpose models on code search benchmarks like CodeSearchNet and the MTEB code retrieval subset? Cite specific evaluation metrics.
2. What training strategies differentiate code embeddings from text embeddings — how do contrastive learning on code-docstring pairs, AST-aware objectives, and multi-language pre-training affect retrieval quality?
3. For a mixed corpus containing both code and natural language documentation, should a single model or separate models be used for each modality? What are the measured tradeoffs?

Primary search targets: voyage-code-3 (Voyage AI), CodeBERT (Microsoft), UniXcoder paper, CodeSearchNet benchmark, StarCoder2 embeddings, MTEB code retrieval tasks.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-06: Embedding Dimension Tradeoffs

Research the relationship between embedding dimensions and retrieval quality, storage cost, and inference latency.

Focused questions:
1. How does Matryoshka Representation Learning (MRL) enable flexible dimensionality reduction — what is the training technique, and what is the measured quality retention at 256d, 512d, and 1024d compared to full dimensionality? Cite the MRL paper (Kusupati et al. 2022).
2. What is the quantified storage and search latency impact of different dimensions in vector databases — how does going from 1536d to 256d affect index size, memory consumption, and query latency in Qdrant, LanceDB, and pgvector?
3. Is there a practical "sweet spot" dimension for RAG applications where quality degradation is minimal but storage/latency savings are significant? What do MTEB results suggest?

Primary search targets: Matryoshka Representation Learning paper (Kusupati et al. 2022), OpenAI dimension reduction documentation, Qdrant quantization documentation, LanceDB storage documentation, MTEB results by dimension.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-07: Multi-Vector vs. Single-Vector Representations

Research multi-vector document representations (ColBERT-style, per-token embeddings) versus single-vector (bi-encoder) approaches for retrieval.

Focused questions:
1. What is the measured retrieval quality difference between multi-vector (ColBERT) and single-vector (bi-encoder) approaches on BEIR and MS MARCO benchmarks? At what point does the quality gain justify the storage overhead?
2. How much additional storage does multi-vector representation require per document (bytes per passage for ColBERT vs. single-vector), and what compression techniques (ColBERTv2 residual compression, quantization) mitigate this?
3. For a RAG system indexing mixed code and documentation, which representation strategy is more appropriate — and can they be combined (e.g., single-vector for first-stage retrieval, multi-vector for re-ranking)?

Primary search targets: ColBERTv2 paper (Santhanam et al. 2022), PLAID engine, Sentence-BERT bi-encoder documentation, BEIR benchmark comparisons, RAGatouille multi-vector implementation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-08: Embedding Fine-Tuning with Synthetic Data

Research techniques for fine-tuning embedding models using LLM-generated synthetic training data.

Focused questions:
1. How does the Promptagator approach (Dai et al. 2022) use LLMs to generate synthetic queries for embedding fine-tuning — what is the method, and what are the measured improvements on domain-specific retrieval tasks compared to off-the-shelf models?
2. What are the practical steps to fine-tune an embedding model (e.g., via Sentence Transformers) using synthetic query-passage pairs generated by GPT-4 or Claude — what data volume is needed, and what quality controls prevent degenerate training?
3. What is the cost-benefit analysis: how much does synthetic fine-tuning improve retrieval on a technical domain corpus compared to using a better off-the-shelf model (e.g., upgrading from nomic-embed to voyage-code-3)?

Primary search targets: Promptagator paper (Dai et al. 2022), Sentence Transformers fine-tuning documentation, BAAI BGE fine-tuning guide, LlamaIndex fine-tuning embedding guide, MTEB domain-specific results.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EM-09: Embedding Model Versioning and Migration

Research strategies for migrating between embedding model versions without service disruption.

Focused questions:
1. What happens operationally when you upgrade from one embedding model to another (e.g., ada-002 to text-embedding-3-large) — are the vector spaces compatible, can you query across models, and what are the measured quality impacts of mixing model generations in the same index?
2. What migration strategies exist — full re-embedding, shadow indexing (blue-green), gradual migration with dual reads — and what are the time/cost implications for corpora of 100K–1M chunks?
3. How do vector databases (Qdrant, LanceDB, pgvector) support collection aliasing and atomic switchover to facilitate zero-downtime embedding model migrations?

Primary search targets: Qdrant collection aliases documentation, Qdrant snapshots documentation, LanceDB versioning, pgvector migration patterns, OpenAI model deprecation documentation, Pinecone collection management.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 4: Code Intelligence (CI)

---

## CI-01: tree-sitter Architecture and TypeScript Grammar

Research tree-sitter's architecture as a parsing framework and its TypeScript grammar for structural code analysis.

Focused questions:
1. How does tree-sitter's incremental parsing architecture work — what is the time complexity of re-parsing after an edit, and how does the concrete syntax tree (CST) differ from a traditional AST? Cite the tree-sitter documentation and relevant technical papers.
2. What TypeScript-specific node types does tree-sitter-typescript expose (function_declaration, class_declaration, interface_declaration, type_alias_declaration, import_statement), and how complete is the grammar coverage for modern TypeScript (decorators, generics, conditional types)?
3. What are the practical integration patterns for using tree-sitter from Node.js/TypeScript — the node-tree-sitter and web-tree-sitter bindings, their API surfaces, and performance characteristics for parsing files up to 10K lines?

Primary search targets: tree-sitter.github.io documentation, tree-sitter-typescript GitHub repository, node-tree-sitter npm package, web-tree-sitter npm package, tree-sitter academic paper (Brunsfeld 2018).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## CI-02: tree-sitter for Semantic Code Chunking

Research using tree-sitter's structural parsing to create semantically meaningful code chunks for RAG indexing.

Focused questions:
1. How can tree-sitter's CST be used to chunk code at function/class/module boundaries instead of arbitrary token counts — what tree-sitter query patterns extract complete function bodies with their signatures, docstrings, and decorators?
2. What chunk size distribution results from structure-aware chunking of real TypeScript codebases — are functions/classes typically 50, 200, or 500+ tokens, and how should oversized functions be handled (sub-chunking at block boundaries)?
3. How do existing implementations (LlamaIndex CodeSplitter, LangChain language-specific text splitters) use tree-sitter for code chunking, and what are their limitations compared to a custom tree-sitter query approach?

Primary search targets: LlamaIndex CodeSplitter documentation, LangChain RecursiveCharacterTextSplitter language support, tree-sitter query syntax documentation, Aider repository map implementation, Sourcegraph code chunking approach.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## CI-03: LSP for Headless Code Analysis

Research using the Language Server Protocol (LSP) in headless mode for code intelligence without an IDE.

Focused questions:
1. What LSP capabilities are most valuable for code indexing — go-to-definition, find-references, document-symbols, workspace-symbols — and how can they be accessed programmatically from a Node.js process without an IDE? What TypeScript LSP servers exist (tsserver, typescript-language-server)?
2. What are the practical performance characteristics of running an LSP server headlessly — startup time, memory consumption, and query latency for a project with 500-2000 TypeScript files?
3. What are the challenges of headless LSP usage — initialization handshake complexity, project configuration (tsconfig.json discovery), incremental synchronization protocol — and how do tools like Sourcegraph Cody and Cursor solve these?

Primary search targets: LSP specification (microsoft.github.io/language-server-protocol), typescript-language-server GitHub repository, vscode-languageclient npm package, Sourcegraph SCIP (successor to LSIF), ts-morph library.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## CI-04: Call Graph Extraction from TypeScript

Research techniques for extracting function call graphs from TypeScript codebases for knowledge graph construction.

Focused questions:
1. How can static call graph extraction be implemented for TypeScript — using tree-sitter for syntactic call detection vs. TypeScript compiler API (ts.createProgram + type checker) for type-resolved call detection? What are the precision/recall tradeoffs?
2. What TypeScript-specific challenges complicate call graph extraction — dynamic dispatch, higher-order functions, method chaining, decorator patterns, generic type resolution — and how do existing tools handle these?
3. What is the practical output format and scale — how many call edges does a typical 50K-line TypeScript project produce, and how should these be represented in a property graph (CALLS edges with file_path, line_number, is_dynamic attributes)?

Primary search targets: TypeScript compiler API documentation (ts.createProgram, ts.TypeChecker), ts-morph library documentation, tree-sitter-typescript query patterns, madge (JavaScript dependency graph tool), dependency-cruiser npm package.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## CI-05: Import and Dependency Graph Construction

Research building import/dependency graphs from TypeScript/JavaScript codebases for structural code intelligence.

Focused questions:
1. How do existing tools (madge, dependency-cruiser, ts-morph) extract import graphs from TypeScript — what import types do they handle (static, dynamic, re-exports, barrel files, path aliases), and what are their limitations?
2. What is the practical graph structure — for a 200-file TypeScript project, how many import edges typically exist, what does the degree distribution look like, and how should circular dependencies and barrel file fan-out be handled?
3. How can import graph data enhance RAG retrieval — when a user asks about a function, how does knowing its import chain and dependents improve context assembly compared to pure semantic search?

Primary search targets: madge npm package documentation, dependency-cruiser npm package documentation, ts-morph project analysis, TypeScript compiler API (ts.resolveModuleName), Aider repository map approach to file relationships.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## CI-06: Test File Detection and Coverage Mapping

Research automated detection of test files and mapping of test-to-source relationships in TypeScript codebases.

Focused questions:
1. What heuristics reliably identify test files in TypeScript/JavaScript projects — file naming patterns (*.test.ts, *.spec.ts, __tests__/), directory conventions (test/, tests/, __tests__/), and framework-specific markers (describe/it/test, Jest/Vitest/Mocha config)?
2. How can test-to-source file mappings be extracted — using import graph analysis (test imports source), naming convention matching (foo.test.ts tests foo.ts), and coverage data (Istanbul/c8 coverage reports)?
3. How should test coverage data (line/branch/function coverage percentages) be represented as knowledge graph metadata, and how does coverage information enhance RAG retrieval (e.g., flagging untested code when a user asks about reliability)?

Primary search targets: Jest configuration documentation, Vitest configuration documentation, Istanbul.js/c8 coverage output formats, dependency-cruiser test file detection, TypeScript project conventions.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## CI-07: AST, Control Flow Graph, and Data Flow Fundamentals

Research Abstract Syntax Trees, Control Flow Graphs, and Data Flow Analysis as foundational techniques for code understanding.

Focused questions:
1. What is the relationship between tree-sitter's Concrete Syntax Tree (CST) and a traditional Abstract Syntax Tree (AST) — what information does each preserve, and when is CST vs. AST more appropriate for code analysis tasks like chunking, symbol extraction, and relationship mining?
2. How are Control Flow Graphs (CFGs) constructed from TypeScript code, and what analysis capabilities do they enable — dead code detection, complexity measurement (cyclomatic complexity), and reachability analysis?
3. What practical tools exist for AST/CFG analysis of TypeScript — how do ts-morph, the TypeScript compiler API, and tree-sitter compare in capabilities, and what is the minimum viable analysis for a code intelligence system?

Primary search targets: TypeScript compiler API documentation, ts-morph documentation, tree-sitter documentation, "Engineering a Compiler" (Cooper & Torczon) CFG chapters, ESLint rule development (AST visitors).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## CI-08: Code Search in Practice (Zoekt, ripgrep, Sourcegraph)

Research production code search systems — their architectures, indexing strategies, and integration with semantic search.

Focused questions:
1. How does Zoekt (Google's code search, used by Sourcegraph) work — what is its trigram-based indexing architecture, how does it handle incremental updates, and what are its performance characteristics for repositories with 1M+ files? Cite the Zoekt documentation and Google's "Code Search" paper.
2. How does ripgrep achieve its performance — what regex engine (finite automaton) and file traversal optimizations does it use, and how does it compare to grep and ag (The Silver Searcher) on large codebases?
3. How can lexical code search (Zoekt/ripgrep) be combined with semantic embedding search in a hybrid retrieval system — what are the practical fusion strategies and when does each retrieval mode dominate?

Primary search targets: Zoekt GitHub repository documentation, Google "Code Search" paper (Sadowski et al.), ripgrep documentation (burntsushi/ripgrep), Sourcegraph code search architecture blog posts, ripgrep regex engine blog post.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 5: Vector Databases (VD)

---

## VD-01: Qdrant Deep Dive

Research Qdrant as a vector database for RAG systems — its architecture, features, and performance characteristics.

Focused questions:
1. What is Qdrant's storage architecture — how does it implement HNSW indexing, payload filtering, and quantization (scalar, product, binary), and what are the measured query latency and recall tradeoffs at different quantization levels?
2. What are Qdrant's unique features relevant to RAG — named vectors (multiple embeddings per point), collection aliases for blue-green deployments, snapshot/restore, and recommendation API? How do these compare to alternatives?
3. What are the practical performance characteristics — memory consumption per million 1536d vectors, indexing throughput, and query latency (p50, p99) for filtered similarity search on a collection of 1M vectors? Cite Qdrant benchmarks.

Primary search targets: Qdrant documentation (qdrant.tech/documentation), Qdrant benchmarks page, Qdrant quantization guide, Qdrant GitHub repository, ann-benchmarks.com Qdrant entries.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## VD-02: LanceDB Deep Dive

Research LanceDB as an embedded vector database for local-first RAG systems.

Focused questions:
1. What is LanceDB's architecture — how does the Lance columnar format work, what indexing methods does it support (IVF-PQ, DiskANN), and what are the performance characteristics for collections of 100K–1M vectors without a separate server process?
2. How does LanceDB's embedded (in-process) deployment model compare to client-server databases like Qdrant — what are the concurrency limitations, and how does it handle concurrent reads and writes from a single Node.js process?
3. What are LanceDB's unique features for RAG — full-text search integration, hybrid search, automatic embedding generation, and versioned datasets — and what are the practical limitations (maximum collection size, memory constraints)?

Primary search targets: LanceDB documentation (lancedb.github.io), Lance format specification, LanceDB Python/TypeScript SDK documentation, LanceDB GitHub repository, LanceDB blog posts on DiskANN.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## VD-03: pgvector — PostgreSQL Vector Extension

Research pgvector as a vector search extension for PostgreSQL, evaluating it against purpose-built vector databases.

Focused questions:
1. What index types does pgvector support (ivfflat, HNSW), and what are the measured recall and query latency characteristics at different parameter settings (ef_construction, m, ef_search) for 1M vectors at 1536 dimensions? Cite pgvector benchmarks.
2. What are the advantages of pgvector's PostgreSQL integration — transactional consistency, SQL-based filtering, JOIN capabilities with relational data — and when do these outweigh the performance gap versus purpose-built vector databases?
3. What are pgvector's practical limitations — memory consumption for HNSW indexes, write performance during index building, and concurrent query performance under mixed read/write workloads?

Primary search targets: pgvector GitHub repository documentation, pgvector HNSW documentation, Supabase pgvector guide, Neon pgvector benchmarks, ann-benchmarks.com pgvector entries.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## VD-04: ChromaDB Deep Dive

Research ChromaDB as a developer-friendly embedded vector database for prototyping and small-scale RAG.

Focused questions:
1. What is ChromaDB's architecture — how does it store embeddings (DuckDB+Parquet backend vs. new Rust-based storage), what ANN algorithms does it use, and what are the query performance characteristics for collections up to 100K vectors?
2. What are ChromaDB's developer experience strengths — the simple Python/JS API, automatic embedding generation, metadata filtering, and multi-tenancy — and how do these compare to LanceDB and Qdrant's developer experience?
3. What are ChromaDB's limitations at scale — when does performance degrade, what are the known issues with the current storage backend, and at what collection size should teams migrate to a more production-ready alternative?

Primary search targets: ChromaDB documentation (docs.trychroma.com), ChromaDB GitHub repository, ChromaDB architecture blog posts, ChromaDB roadmap/changelog.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## VD-05: Weaviate Deep Dive

Research Weaviate as a vector database with native hybrid search and module ecosystem for RAG.

Focused questions:
1. How does Weaviate implement native hybrid search (combining BM25 and vector search in a single query) — what fusion algorithm does it use, and how does the alpha parameter control the balance? What are the measured quality differences vs. separate BM25 + vector pipelines?
2. What is Weaviate's module architecture — how do vectorizer modules (text2vec-openai, text2vec-transformers), reranker modules, and generative modules work, and what are the operational implications of this architecture?
3. What are Weaviate's performance characteristics — memory consumption, query latency, and indexing throughput for 1M vectors — and how does it compare to Qdrant and pgvector on ann-benchmarks?

Primary search targets: Weaviate documentation (weaviate.io/developers), Weaviate hybrid search documentation, Weaviate module documentation, ann-benchmarks.com Weaviate entries, Weaviate blog benchmarks.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## VD-06: Vector Database Benchmarking Methodology

Research methodologies for fairly benchmarking vector databases for RAG workloads.

Focused questions:
1. How does ann-benchmarks.com structure its evaluations — what datasets, metrics (recall@k vs. QPS), and parameter sweeps does it use, and what are the known limitations of this methodology for RAG-specific workloads (filtered search, hybrid queries)?
2. What additional benchmarking dimensions matter for RAG that ann-benchmarks doesn't cover — write performance during indexing, concurrent read/write behavior, filtered search performance, memory consumption under load, and recovery time after crashes?
3. What is a practical benchmarking protocol for comparing Qdrant, LanceDB, and pgvector on a local-first RAG workload with 500K chunks, filtered metadata queries, and incremental updates?

Primary search targets: ann-benchmarks.com methodology, Qdrant benchmarks documentation, VectorDBBench (Zilliz), Weaviate benchmark blog posts, pgvector benchmark methodologies.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## VD-07: Vector Index Algorithms (HNSW, IVF, DiskANN)

Research the core vector index algorithms used in vector databases — their mechanics, tradeoffs, and suitability for different workloads.

Focused questions:
1. How does HNSW (Hierarchical Navigable Small World) work algorithmically — what are the key parameters (M, ef_construction, ef_search), how do they affect recall vs. latency tradeoffs, and what are the memory requirements? Cite the original Malkov & Yashunin (2018) paper.
2. How does DiskANN achieve near-memory performance with disk-based storage — what is the Vamana graph algorithm, and how does it compare to HNSW for large-scale collections that exceed RAM? Cite the DiskANN paper (Subramanya et al. 2019).
3. When should IVF-PQ (Inverted File with Product Quantization) be preferred over HNSW — what are the memory savings, and at what quality cost? How does FAISS implement IVF-PQ?

Primary search targets: HNSW paper (Malkov & Yashunin 2018, arXiv:1603.09320), DiskANN paper (Subramanya et al. 2019), FAISS documentation and wiki, Qdrant HNSW implementation docs, LanceDB DiskANN implementation.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 6: Graph Databases (GD)

---

## GD-01: Kuzu Deep Dive

Research Kuzu as an embedded graph database for local-first knowledge graph applications.

Focused questions:
1. What is Kuzu's architecture — how does it implement the property graph model with structured node/relationship tables, and what query language does it use (Cypher)? How does its columnar storage engine differ from Neo4j's native graph storage?
2. What are Kuzu's performance characteristics for typical knowledge graph queries — multi-hop traversals, pattern matching, and aggregation on graphs with 10K–100K nodes? Cite any published benchmarks.
3. What are Kuzu's practical deployment characteristics — embedded (in-process) operation from Node.js/Python, concurrent read/write behavior, disk vs. memory usage, and schema evolution capabilities?

Primary search targets: Kuzu documentation (kuzudb.com/docusaurus), Kuzu GitHub repository, Kuzu blog posts on architecture, Kuzu benchmarks, LDBC Social Network Benchmark results.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## GD-02: SQLite as a Graph Store

Research using SQLite with recursive CTEs and closure tables to implement graph query patterns without a dedicated graph database.

Focused questions:
1. How can recursive Common Table Expressions (CTEs) in SQLite implement multi-hop graph traversals — what is the SQL pattern, what are the performance characteristics for 2-hop and 3-hop queries on 10K–100K edge tables, and what are the limitations (depth limits, cycle detection)?
2. How does the closure table pattern work for materializing transitive relationships — what is the schema, how is it maintained on insert/delete, and how does query performance compare to recursive CTEs?
3. When is SQLite-as-graph-store sufficient vs. when should you use a dedicated graph database (Kuzu, Neo4j)? What query patterns break down — community detection, shortest path, PageRank?

Primary search targets: SQLite recursive CTE documentation, "SQL Antipatterns" (Bill Karwin) closure table chapter, SQLite performance documentation, "Graph Databases" (Robinson et al.) comparison chapters, better-sqlite3 npm package.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## GD-03: Neo4j Deep Dive

Research Neo4j as the leading property graph database — its architecture, Cypher query language, and suitability for RAG knowledge graphs.

Focused questions:
1. What is Neo4j's storage architecture — how does index-free adjacency work, and what are the measured query latency characteristics for multi-hop traversals (2-hop, 3-hop) on graphs with 100K–1M nodes? Cite Neo4j documentation and published benchmarks.
2. What are Neo4j's deployment options relevant to local-first development — Neo4j Community (embedded), Neo4j Desktop, AuraDB cloud — and what are the licensing implications (GPL vs. commercial) for embedding in an MCP server?
3. How does Neo4j's Graph Data Science library support RAG-relevant algorithms — community detection (Louvain, Leiden), PageRank, node similarity, and graph embeddings? What are the API patterns for calling these from application code?

Primary search targets: Neo4j documentation (neo4j.com/docs), Neo4j Graph Data Science library documentation, Neo4j community vs. enterprise comparison, Neo4j performance documentation, LDBC benchmark results.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## GD-04: ArangoDB Multi-Model Deep Dive

Research ArangoDB as a multi-model database combining document, graph, and search capabilities.

Focused questions:
1. How does ArangoDB's multi-model architecture work — can you execute graph traversals (AQL), document queries, and full-text search in a single query language and transaction? What are the practical advantages over using separate databases?
2. What are ArangoDB's graph query performance characteristics compared to Neo4j and Kuzu for multi-hop traversals on 10K–100K node graphs? Cite any published benchmarks or comparisons.
3. What are the deployment and licensing considerations — ArangoDB Community vs. Enterprise, embedded operation capability, and resource requirements for a local-first development tool?

Primary search targets: ArangoDB documentation (arangodb.com/docs), ArangoDB AQL graph traversal documentation, ArangoDB benchmarks, ArangoDB vs. Neo4j comparison documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## GD-05: FalkorDB (Redis-Based Graph)

Research FalkorDB (formerly RedisGraph) as an in-memory graph database built on Redis.

Focused questions:
1. What is FalkorDB's architecture — how does it implement graph storage and Cypher queries on top of Redis, what is the GraphBLAS sparse matrix engine, and what are the performance characteristics for traversal queries?
2. How does FalkorDB's in-memory model affect performance and durability — what are the query latency characteristics compared to disk-based graph databases (Neo4j, Kuzu), and how is persistence handled?
3. What are the practical deployment considerations — memory requirements per million edges, Redis dependency, licensing (source-available vs. open source), and suitability for embedding in a local development tool?

Primary search targets: FalkorDB documentation (docs.falkordb.com), FalkorDB GitHub repository, RedisGraph to FalkorDB migration documentation, GraphBLAS specification, FalkorDB benchmarks.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## GD-06: Graph Database Benchmarking at Small Scale

Research benchmarking methodologies for comparing graph databases at the small scale relevant to local development tools (10K–100K nodes).

Focused questions:
1. What standard graph benchmarks exist (LDBC Social Network Benchmark, LDBC Graphalytics) and are they applicable at small scale (10K–100K nodes), or do they primarily test large-scale performance? What adaptations are needed?
2. What query patterns should be benchmarked for a RAG knowledge graph — multi-hop traversal, pattern matching with property filters, community detection, shortest path, and subgraph extraction — and what metrics matter most (latency, throughput, memory)?
3. What are the published small-scale comparison results between Kuzu, SQLite (recursive CTEs), Neo4j Community, and FalkorDB for 2-hop and 3-hop traversal queries?

Primary search targets: LDBC Benchmark documentation (ldbcouncil.org), Kuzu benchmark blog posts, graph database comparison surveys, "Benchmarking Graph Databases" (academic surveys).

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 7: Evaluation & Quality (EQ)

---

## EQ-02: Retrieval Metrics Comprehensive

Research retrieval evaluation metrics used to measure RAG system quality — precision, recall, NDCG, MRR, and their variants.

Focused questions:
1. How are the core retrieval metrics (Precision@k, Recall@k, NDCG@k, MRR, MAP) defined mathematically, and which metric best captures RAG retrieval quality when the goal is to find all relevant chunks (recall-oriented) vs. the single best chunk (precision-oriented)?
2. What are the practical measurement challenges — how do you obtain relevance judgments (ground truth) for a custom corpus, and what are the tradeoffs between human annotation, LLM-as-judge, and click-through proxies?
3. How do RAGAS context_relevancy and context_recall metrics work as reference-free alternatives, and how well do they correlate with human judgments? Cite the RAGAS paper (Es et al. 2023).

Primary search targets: RAGAS paper (arXiv:2309.15217), BEIR benchmark metrics documentation, trec_eval documentation, LlamaIndex evaluation module documentation, ARES paper (arXiv:2311.09476).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EQ-03: Multi-Hop QA Benchmarks

Research multi-hop question answering benchmarks used to evaluate complex reasoning in RAG systems.

Focused questions:
1. How do HotpotQA, MuSiQue, and 2WikiMultiHopQA differ in their construction — what reasoning types do they test (bridge, comparison, compositional), how many hops are required, and what are the standard evaluation metrics (F1, Exact Match)?
2. What do benchmark results reveal about RAG system capabilities — what is the performance gap between single-hop and multi-hop retrieval on these benchmarks, and which RAG architectures (iterative retrieval, query decomposition, graph-enhanced) perform best?
3. How can these benchmarks be adapted to evaluate a code-focused RAG system — what is the equivalent of multi-hop reasoning for a codebase (e.g., "what function calls the function that implements the auth middleware")?

Primary search targets: HotpotQA paper (Yang et al. 2018), MuSiQue paper (Trivedi et al. 2022), 2WikiMultiHopQA paper, IRCoT paper (Trivedi et al. 2023), BEIR multi-hop subsets.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EQ-04: Golden Question Set Design Methodology

Research methodologies for creating evaluation question sets (golden datasets) for RAG system testing.

Focused questions:
1. What are the established methodologies for creating golden evaluation sets — how many questions are needed for statistical significance, what question type distribution (factoid, comparative, multi-hop, unanswerable) produces the most informative evaluation, and how should ground truth answers be structured?
2. How can LLMs be used to synthetically generate evaluation questions from a corpus — what is the quality of LLM-generated questions compared to human-written ones, and what validation steps are needed? Cite the Promptagator approach and RAGAS test set generation.
3. What are the best practices for maintaining and evolving golden question sets as the corpus changes — how do you detect when questions become stale and how frequently should the set be refreshed?

Primary search targets: RAGAS test set generation documentation, ARES evaluation paper (arXiv:2311.09476), Promptagator paper (Dai et al. 2022), DeepEval test case documentation, LlamaIndex evaluation documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EQ-05: Adversarial Testing for RAG Systems

Research adversarial testing methodologies that probe RAG system weaknesses — hallucination detection, out-of-scope handling, and robustness.

Focused questions:
1. What adversarial test categories are most informative for RAG — unanswerable questions (no relevant context), contradictory context injection, paraphrase sensitivity, and prompt injection through retrieved documents? How should each be constructed?
2. How do existing evaluation frameworks (DeepEval, Promptfoo, RAGAS) support adversarial testing — what built-in adversarial metrics exist, and what custom test suites have been published?
3. What are the measured hallucination rates of production RAG systems when faced with adversarial inputs — how often do systems fabricate answers when no relevant context exists, and what guardrails (Self-RAG reflection tokens, CRAG confidence scoring) reduce this?

Primary search targets: DeepEval documentation, Promptfoo documentation, RAGAS adversarial test generation, Self-RAG paper (arXiv:2310.11511), CRAG paper (arXiv:2401.15884), TruthfulQA benchmark.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## EQ-06: End-to-End Evaluation Pipelines

Research end-to-end evaluation pipelines for continuously monitoring RAG system quality in production.

Focused questions:
1. How can RAGAS and ARES be combined into a continuous evaluation pipeline — what is the architecture for running automated quality checks on production RAG queries, and what thresholds trigger alerts? Cite both papers.
2. What observability infrastructure is needed — how do OpenTelemetry traces, LangSmith, and custom logging capture the full retrieval-generation pipeline for evaluation, and what is the practical implementation cost?
3. What are the reference-free metrics that work without ground truth labels — RAGAS faithfulness, context relevancy, answer relevancy — and how reliable are they as production canaries compared to human evaluation?

Primary search targets: RAGAS paper and documentation, ARES paper (arXiv:2311.09476), LangSmith documentation, OpenTelemetry Python SDK, DeepEval CI/CD integration documentation.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 8: MCP Architecture (MC)

---

## MC-01: MCP Protocol Specification Deep Read

Research the Model Context Protocol (MCP) specification — its architecture, transport mechanisms, and capability model.

Focused questions:
1. What are the core protocol primitives of MCP — how do Tools, Resources, and Prompts differ as capability types, and what are the JSON-RPC message formats for each? Walk through the exact request/response lifecycle for a tool call.
2. How does MCP's stdio transport work technically — what is the message framing protocol, how are concurrent requests handled (JSON-RPC batching vs. sequential), and what are the implications for long-running operations?
3. What capabilities does MCP support for discovery and negotiation — how does capability advertisement work during initialization, and how do clients discover available tools/resources at runtime?

Primary search targets: MCP specification (spec.modelcontextprotocol.io), MCP SDK TypeScript documentation, MCP SDK source code (GitHub), Anthropic MCP announcement blog post.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## MC-02: Existing MCP Server Implementations Survey

Research the ecosystem of existing MCP server implementations to understand design patterns and common architectures.

Focused questions:
1. What are the most widely used MCP servers (filesystem, GitHub, Slack, database servers), and what architectural patterns do they share — tool granularity, error handling, input validation, and state management?
2. How do database-backed MCP servers (Supabase MCP, sqlite-mcp) handle connection management, query safety, and result pagination within the MCP protocol constraints?
3. What are the common implementation pitfalls — servers that block on stdio, servers that leak resources, servers with poor error messages — and what patterns prevent these issues?

Primary search targets: MCP servers directory (github.com/modelcontextprotocol/servers), Supabase MCP server source, SQLite MCP server source, GitHub MCP server source, Anthropic MCP examples.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## MC-03: MCP Tool Design Patterns

Research design patterns for creating effective MCP tools — granularity, naming, input schemas, and output formatting.

Focused questions:
1. What is the optimal granularity for MCP tools — when should operations be combined into one tool vs. split into multiple tools, and what evidence exists about LLM tool selection accuracy as the number of available tools increases?
2. How should MCP tool input schemas be designed — what Zod/JSON Schema patterns produce the best LLM tool-calling accuracy, and how should optional parameters, enums, and complex nested objects be structured?
3. What output formatting patterns work best — when should tools return plain text vs. structured JSON vs. markdown, and how does output format affect the LLM's ability to use the results in subsequent reasoning?

Primary search targets: MCP SDK tool definition documentation, Anthropic tool use documentation, OpenAI function calling best practices, MCP server implementation examples, Claude tool use documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## MC-04: MCP Context Window Management

Research strategies for managing LLM context window consumption when using MCP tools in RAG systems.

Focused questions:
1. How do MCP tool responses consume context window tokens — what is the typical token overhead per tool call (request + response framing), and how does this scale when an agent makes 10-50 tool calls in a session?
2. What strategies exist for controlling MCP tool output size — pagination, truncation, summarization, and progressive disclosure patterns — and how do these affect LLM reasoning quality?
3. How should an MCP server for a RAG system balance returning comprehensive context vs. conserving tokens — what heuristics determine how many chunks to return, and how does Anthropic's extended thinking interact with large tool responses?

Primary search targets: MCP specification (context management sections), Anthropic context window documentation, Claude extended thinking documentation, MCP server pagination patterns in existing implementations.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## MC-05: MCP Server Process Architecture and Security

Research the process architecture and security patterns for production MCP servers running locally.

Focused questions:
1. What is the recommended process model for an MCP server that must handle both low-latency tool calls and background indexing work — single-process with worker_threads, multi-process with IPC, or separate processes communicating via sockets?
2. How should MCP servers manage database connections — connection pooling for SQLite (WAL mode, busy timeout), managing Qdrant/LanceDB client lifecycle, and ensuring connections survive long-running server processes?
3. What security considerations apply to local MCP servers — input validation (preventing path traversal, injection), sandboxing file system access, and credential management for API keys (embedding model API keys)?

Primary search targets: MCP specification (security considerations), Node.js worker_threads documentation, SQLite connection best practices, MCP SDK server lifecycle documentation, OWASP local application security.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 9: Prior Art Studies (PA)

---

## PA-01: Cognee — Open Source KG + RAG System

Research Cognee as an open-source knowledge graph + RAG system, examining its architecture and patterns for knowledge extraction.

Focused questions:
1. What is Cognee's core architecture — how does it build knowledge graphs from documents, what extraction pipeline does it use, and how does it combine graph retrieval with vector search? Examine the GitHub source code structure.
2. How does Cognee's graph construction approach compare to GraphRAG and LightRAG — what entity types, relationship types, and schema patterns does it use, and what are the quality differences in extraction?
3. What are Cognee's practical limitations — what corpus sizes has it been tested on, what are the known failure modes, and what patterns are reusable vs. tightly coupled to Cognee's specific architecture?

Primary search targets: Cognee GitHub repository (topoteretes/cognee), Cognee documentation, GraphRAG paper for comparison, LightRAG paper for comparison.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-02: Microsoft GraphRAG Implementation (Code Study)

Research the Microsoft GraphRAG implementation — its indexing pipeline, community detection, and summarization architecture as implemented in the open-source codebase.

Focused questions:
1. How is GraphRAG's indexing pipeline structured in the codebase — what are the main processing stages (entity extraction, relationship extraction, community detection, summary generation), and what configuration parameters control each stage?
2. How does GraphRAG implement its two-tier retrieval (local search for entity-specific queries, global search for corpus-wide queries) — what are the code paths, and how do community summaries feed into the global search response?
3. What are the practical operational characteristics — indexing time and LLM API cost for a 100K-token corpus, memory consumption during community detection, and the effectiveness of incremental re-indexing?

Primary search targets: GraphRAG GitHub repository (microsoft/graphrag), GraphRAG paper (arXiv:2404.16130), GraphRAG documentation and configuration reference, Microsoft Research blog post on GraphRAG.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-03: LightRAG Architecture Study

Research the LightRAG system in depth — its dual-level retrieval, storage backends, and how it differs from GraphRAG in practice.

Focused questions:
1. How does LightRAG implement its five retrieval modes (Local, Global, Hybrid, Naive, Mix) — what is the technical difference between each mode, and when does the "Mix" mode (combining KG + vector) outperform pure graph or pure vector retrieval?
2. What storage backends does LightRAG support (NetworkX, Neo4j, Memgraph, PostgreSQL AGE), and what are the practical performance differences between them for the same workload? How does backend selection affect deployment complexity?
3. How does LightRAG handle incremental updates and document deletion — what is the mechanism for removing entities and relationships tied to a deleted source document, and how does it prevent orphaned graph nodes?

Primary search targets: LightRAG GitHub repository (HKUDS/LightRAG), LightRAG paper, LightRAG server documentation, LightRAG storage backend implementations.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-04: Cursor Codebase Indexing (Reverse Engineering)

Research how Cursor (AI code editor) implements codebase indexing and context assembly, based on publicly available documentation and user reports.

Focused questions:
1. What is known about Cursor's indexing approach — does it use embeddings, AST analysis, or lexical search (or all three)? What do the @codebase, @file, @symbol directives reveal about the retrieval architecture?
2. How does Cursor manage context window budget — what determines how much codebase context is included in a prompt, and how does it handle large repositories (monorepos with 10K+ files)?
3. What patterns from Cursor's approach (particularly @-symbol context directives, .cursorrules files, and codebase indexing) are portable to an MCP-based code intelligence system?

Primary search targets: Cursor documentation (docs.cursor.com), Cursor @-symbols documentation, Cursor rules documentation, Cursor changelog, Cursor community forum discussions on indexing.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-05: Zed AI Codebase Indexing

Research how Zed editor implements AI-powered code intelligence, based on their engineering blog and documentation.

Focused questions:
1. What has Zed disclosed about their AI context assembly — how do they select relevant code context for LLM prompts, and what role does tree-sitter (which Zed uses extensively for syntax highlighting) play in code intelligence?
2. How does Zed integrate MCP servers for extending AI capabilities — what is the architecture, and what patterns from Zed's MCP integration are applicable to building a standalone code intelligence MCP server?
3. What are the key engineering tradeoffs Zed has discussed regarding responsiveness vs. context richness — how do they balance fast responses with comprehensive codebase understanding?

Primary search targets: Zed blog (zed.dev/blog), Zed AI documentation, Zed MCP documentation, Zed GitHub repository (zed-industries/zed), Zed language server documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-06: LangChain RAG Patterns (Standard vs. Over-Engineered)

Research LangChain's RAG implementation patterns, distinguishing production-robust patterns from over-engineering.

Focused questions:
1. What are LangChain's core RAG abstractions — document loaders, text splitters, retrievers, and chains — and which patterns have proven stable and production-ready vs. which are experimental or frequently changing?
2. How does LangChain implement retriever composition (ensemble retriever, contextual compression, multi-query retriever) — what are the measured quality improvements and the complexity costs of each?
3. What patterns from LangChain are worth adopting as concepts (not dependencies) for a custom RAG system — what is the minimal set of abstractions that covers 80% of RAG use cases without the framework overhead?

Primary search targets: LangChain RAG documentation, LangChain text splitters documentation, LangChain retrievers documentation, LangChain evaluation (LangSmith), LangChain GitHub repository.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-07: LlamaIndex Knowledge Graph Integration

Research LlamaIndex's PropertyGraphIndex and knowledge graph integration patterns for hybrid graph+vector RAG.

Focused questions:
1. How does LlamaIndex's PropertyGraphIndex work — what is the schema (EntityNode, Relation, ChunkNode), how does the extraction pipeline populate the graph, and how does it combine graph retrieval with vector retrieval?
2. What storage backends does LlamaIndex PropertyGraphIndex support (Neo4j, Kuzu, Nebula) and what are the practical integration patterns — connection management, query generation, and result parsing?
3. What are the limitations of LlamaIndex's KG integration for heterogeneous technical corpora — how well does it handle code artifacts (not just text), and what customization is required for non-standard entity types?

Primary search targets: LlamaIndex PropertyGraphIndex documentation, LlamaIndex knowledge graph guide, LlamaIndex graph stores documentation, LlamaIndex GitHub repository (property graph source code).

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-08: GitHub Copilot Workspace Architecture

Research GitHub Copilot Workspace's plan-then-implement approach and its implications for code-aware RAG systems.

Focused questions:
1. What has GitHub disclosed about Copilot Workspace's architecture — how does it gather repository context (file structure, dependencies, symbols) to build a plan before generating code changes across multiple files?
2. How does the planning step (where users confirm/modify the plan before code generation) reduce hallucinations and improve multi-file edit quality compared to direct generation approaches?
3. What patterns from Copilot Workspace's plan-aware context assembly are portable to an MCP-based retrieval system — specifically, how should retrieved context differ when the goal is multi-file planning vs. single-file editing?

Primary search targets: GitHub Copilot Workspace announcement blog, GitHub Next project page, GitHub Copilot documentation, GitHub blog technical posts on Copilot architecture.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-09: Notion AI and Confluence AI (Living Document Systems)

Research how Notion AI and Confluence AI handle document freshness, provenance, and knowledge retrieval in living document systems.

Focused questions:
1. How do Notion AI and Confluence AI handle document freshness — what signals do they use to determine recency, how do they handle stale or outdated content, and what user-facing indicators show information age?
2. How do these systems manage cross-document relationships and references — when Document A references Document B and B is updated, how is the relationship maintained and surfaced in AI responses?
3. What anti-patterns have emerged — stale AI summaries, citation drift, permission leakage — and what mitigations have Notion and Confluence implemented? What lessons transfer to a developer-focused knowledge system?

Primary search targets: Notion AI product documentation, Notion AI help center, Confluence AI product page, Atlassian AI trust documentation, Notion and Confluence AI announcement blog posts.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PA-10: Sourcegraph Cody Architecture

Research Sourcegraph Cody's code intelligence and retrieval architecture — how it combines Zoekt search, symbol analysis, and semantic embeddings.

Focused questions:
1. What is Cody's retrieval stack — how does it combine Zoekt trigram search, Sourcegraph symbol indexing, and embedding-based semantic search to assemble LLM context? What is the relative contribution of each retrieval mode?
2. How does Cody handle context filtering and packing — what heuristics determine which code snippets are included in the context window, and how does it handle large monorepos where the relevant code is a tiny fraction of the codebase?
3. What are Cody's documented failure modes and limitations — when does it retrieve irrelevant code, miss cross-file relationships, or include stale index results — and how do these inform the design of a similar system?

Primary search targets: Sourcegraph Cody documentation, Sourcegraph code search documentation, Cody context filters documentation, Sourcegraph blog technical posts, Zoekt repository.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 10: Data Management (DM)

---

## DM-01: Change Data Capture Patterns for Local File Systems

Research change data capture (CDC) patterns for detecting file system changes in local development environments.

Focused questions:
1. How do Node.js file watching libraries (chokidar, fs.watch, Parcel watcher) compare on reliability, performance, and event types — what are the known issues with each on macOS (FSEvents) and Linux (inotify), and which is most reliable for a development tool?
2. What debouncing and coalescing strategies prevent redundant re-indexing during rapid save sequences (IDE auto-save, git operations that touch many files) — what are the optimal debounce windows and event batching patterns?
3. How should file rename and move operations be detected and handled — what events does the OS generate, and how can a consistent file identity be maintained across renames for graph node stability?

Primary search targets: chokidar npm package documentation, Parcel watcher (Devon Govett), Node.js fs.watch documentation, macOS FSEvents documentation, inotify(7) Linux man page.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## DM-02: Document Versioning and Provenance Tracking

Research document versioning and provenance tracking strategies for RAG systems that must know when and where information came from.

Focused questions:
1. What versioning model is most appropriate for a RAG knowledge base — immutable-append (event sourcing, Datomic-style temporal records) vs. mutable-overwrite (update in place with timestamps) — and what are the storage and query complexity tradeoffs?
2. How should provenance metadata be structured — what fields are needed (source_file, git_sha, chunk_hash, created_at, last_verified_at, extraction_model_version) and how should this metadata be stored in vector database payloads and graph node properties?
3. How can git be leveraged as a provenance backbone — using git blame for line-level attribution, git log for change frequency, and commit SHAs as version anchors — and what are the API costs of querying git history programmatically?

Primary search targets: Datomic architecture documentation, XTDB temporal database documentation, Qdrant payload filtering documentation, git-blame documentation, event sourcing patterns (Martin Fowler).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## DM-03: Staleness Detection and Freshness Scoring

Research techniques for detecting stale information in a knowledge base and computing freshness scores for RAG retrieval.

Focused questions:
1. What decay models are used for information freshness — exponential decay with configurable half-life, step functions based on git commit recency, or signal-based models that weight edit frequency? What empirical evidence supports one approach over another?
2. How can graph structure detect staleness — if Entity A "EXPLAINS" Entity B, and B has been modified but A has not, what graph queries identify this staleness propagation? What are the practical query patterns in Cypher?
3. How should freshness scores be integrated into retrieval ranking — as a multiplicative weight on similarity scores, as a hard filter (exclude chunks older than X), or as metadata passed to the LLM for self-assessment?

Primary search targets: Time-aware information retrieval surveys, TF-IDF temporal variants, git blame documentation, RAGAS context recency metrics, LightRAG weight attribute documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## DM-04: Git Hook Architectures for Automated Indexing

Research git hook mechanisms for triggering automated re-indexing of modified files after commits.

Focused questions:
1. Which git hooks are most appropriate for triggering re-indexing — post-commit, post-merge, post-checkout, post-rewrite — and what are the execution semantics of each (blocking vs. async, arguments received, working directory state)?
2. How can a re-indexing hook be reliably detached from the git process to avoid blocking commits — what are the exact bash/Node.js patterns for background detachment (nohup, setsid, child_process.unref()), and what are the failure modes?
3. How should the hook coexist with existing hooks (Husky, lint-staged, Pythia hooks) — what is the safe injection pattern for adding a hook alongside others, and how do hook managers like Lefthook handle multiple hooks?

Primary search targets: git hooks documentation (git-scm.com), Husky npm package documentation, Lefthook documentation, git post-commit hook examples, Node.js child_process.unref() documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## DM-05: Incremental Indexing Algorithms

Research algorithms for incrementally updating vector and graph indexes when individual files change.

Focused questions:
1. How should chunk identity be maintained across file edits — content-based hashing (if the chunk content hasn't changed, skip re-embedding) vs. position-based identity (chunk 3 of file X) — and what are the tradeoffs for each approach?
2. What is the correct deletion cascade when a file is modified — how do you identify which chunks, vector embeddings, and graph edges were derived from the old version and need to be replaced, without a full re-index?
3. How do vector databases (Qdrant, LanceDB) handle upsert operations — is there atomic replace-or-insert, and how do you ensure consistency between the vector index and the graph database during an incremental update?

Primary search targets: Qdrant point upsert documentation, LanceDB merge/update documentation, content-defined chunking algorithms, LightRAG incremental update source code, pgvector upsert patterns.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## DM-06: Artifact Lifecycle Management

Research lifecycle state management for documents and code artifacts in a knowledge base — from creation through deprecation to archival.

Focused questions:
1. What lifecycle states should a technical artifact support (Draft, Active, Superseded, Deprecated, Archived, Tombstoned), and what are the state transition rules? How should SUPERSEDED_BY graph edges work when a new ADR replaces an old one?
2. How should artifact lifecycle state affect retrieval — should deprecated documents be excluded from search results, included with warnings, or only included when explicitly requested? What do production knowledge management systems do?
3. How can lifecycle state be inferred automatically — using git commit frequency (files not touched in 6 months → stale), YAML frontmatter parsing (status: deprecated), or explicit user annotation via MCP tools?

Primary search targets: MADR (Markdown Any Decision Records) status field, Confluence page archival documentation, document management system lifecycle patterns, soft-delete patterns in database design.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## DM-07: Event-Driven Indexing Architecture

Research event-driven architectures for coordinating file watching, indexing, and MCP server query handling in a single system.

Focused questions:
1. How should a Node.js application handle both low-latency MCP tool requests and background indexing work in the same process — what event loop patterns prevent indexing from blocking MCP response times, and what are the measured impacts?
2. What message queue options are appropriate for an embedded (local-only) system — BullMQ (requires Redis), better-queue (in-process), or a simple EventEmitter-based queue — and what are the reliability vs. complexity tradeoffs?
3. How should backpressure be handled when a large git pull introduces hundreds of changed files simultaneously — what queuing, throttling, and priority patterns prevent the system from being overwhelmed?

Primary search targets: Node.js event loop documentation, BullMQ documentation, better-queue npm package, Node.js worker_threads documentation, SQLite WAL mode concurrent access documentation.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 11: NLP Foundations (NL)

---

## NL-01: Natural Language Inference for Contradiction Detection (v2)

Research using NLI (Natural Language Inference) models to detect contradictions between documents in a knowledge base.

Focused questions:
1. What NLI models are suitable for detecting contradictions in technical text — how do DeBERTa-v3-base-mnli-fever-anli, roberta-large-mnli, and cross-encoder/nli-deberta-v3-base compare on entailment/contradiction/neutral classification accuracy for technical documents?
2. What are the known failure modes of NLI on technical text — how do models handle code-specific language, version-specific claims ("X was added in v3.0"), and implicit contradictions where two statements are factually incompatible but don't use contradictory language?
3. What is the practical cost of running NLI checks — inference latency per document pair, throughput on CPU vs. GPU, and the total cost of checking a 1000-document corpus for pairwise contradictions?

Primary search targets: SNLI paper, MultiNLI paper, DeBERTa-v3 model card (Hugging Face), ANLI (Adversarial NLI) paper, Sentence-Transformers NLI documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## NL-02: Semantic Textual Similarity Beyond Cosine

Research similarity metrics beyond cosine similarity for ranking retrieved passages in RAG systems.

Focused questions:
1. What are the mathematical and practical differences between cosine similarity, dot product, and L2 distance for comparing embeddings — when does cosine similarity fail (e.g., with non-normalized embeddings, high-dimensional spaces, query-document length mismatch)?
2. How do cross-encoder re-rankers compute similarity differently from bi-encoder cosine similarity — what is the measured quality improvement of cross-encoder re-ranking on retrieval benchmarks, and what is the latency cost?
3. What score calibration and normalization techniques are needed when combining similarity scores from different sources (e.g., cosine similarity from embeddings + BM25 scores + graph traversal weights) in a hybrid retrieval system?

Primary search targets: Sentence-BERT paper (Reimers & Gurevych 2019), STS Benchmark documentation, cross-encoder examples (Sentence-Transformers), Cohere Rerank documentation, Weaviate distance metrics documentation.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## NL-03: Text Chunking Algorithms Deep Dive

Research text chunking algorithms in depth — recursive character splitting, token-based splitting, semantic chunking, and structure-aware chunking.

Focused questions:
1. How do the major chunking algorithms differ technically — what are the exact mechanics of LangChain's RecursiveCharacterTextSplitter (separator hierarchy), LlamaIndex's SentenceSplitter (sentence boundary + token budget), and semantic chunking (embedding similarity breakpoints)?
2. What are the measured retrieval quality differences between fixed-size (256/512/1024 tokens), sentence-based, and semantic chunking on standard RAG benchmarks? Cite the Dense X Retrieval paper (Chen et al. 2023) proposition-level results and the Anthropic Contextual Retrieval chunk size analysis.
3. How should chunking strategy differ by artifact type — what chunk sizes and splitting strategies work best for source code (function boundaries), markdown documentation (header boundaries), and ADR documents (section boundaries)?

Primary search targets: LangChain RecursiveCharacterTextSplitter source code, LlamaIndex SentenceSplitter documentation, Dense X Retrieval paper (arXiv:2312.06648), Anthropic Contextual Retrieval blog post, Pinecone chunking strategies guide.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## NL-04: Transformer Attention and Positional Encoding

Research how transformer attention mechanisms and positional encodings affect RAG context assembly — specifically the "lost in the middle" phenomenon.

Focused questions:
1. How do RoPE (Rotary Position Embedding) and ALiBi (Attention with Linear Biases) differ in their treatment of token positions — what are the mathematical differences, and how do they create different attention patterns (primacy bias, recency bias, middle-position neglect)?
2. What does the "Lost in the Middle" paper (Liu et al. 2023) quantify about position-dependent attention — at what context lengths does middle-position degradation become significant, and which model families (GPT-4, Claude, Llama) are most/least affected?
3. What practical context packing strategies mitigate position bias — placing the most relevant chunk first, using separator tokens, repeating key information, or limiting total context length — and what empirical evidence supports each?

Primary search targets: "Lost in the Middle" paper (Liu et al. 2023), RoFormer/RoPE paper, ALiBi paper (Press et al. 2022), "Attention Is All You Need" (Vaswani et al. 2017), LongBench benchmark.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## NL-05: Contradiction Detection Approaches

Research practical approaches to detecting contradictions between documents in a knowledge base — NLI models, LLM judges, and claim decomposition.

Focused questions:
1. How does claim decomposition (breaking documents into atomic claims before NLI comparison) improve contradiction detection compared to full-document NLI — what is the measured precision/recall improvement, and what is the additional processing cost?
2. How do LLM-as-judge approaches (using GPT-4 or Claude to evaluate contradictions) compare to dedicated NLI models (DeBERTa-mnli) on precision, recall, latency, and cost for technical document comparison?
3. How should detected contradictions be represented and surfaced — as graph edges (CONTRADICTS with confidence score), as retrieval-time warnings, or as background alerts? What confidence thresholds prevent false positive noise?

Primary search targets: MultiNLI paper, ANLI paper, Self-RAG self-critique mechanism, CRAG corrective retrieval, Promptagator claim generation, DeepEval contradiction metrics.

Write approximately 2000 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# Domain 12: Production Engineering (PE)

---

## PE-01: Single-Process Daemon Architecture for MCP + Background Indexing

Research architecture patterns for a Node.js daemon that serves low-latency MCP tool calls while running background indexing work.

Focused questions:
1. What are the proven patterns for mixing latency-sensitive RPC handling with CPU-bound background work in a single Node.js process — specifically, how do worker_threads, setImmediate-based cooperative scheduling, and async generator patterns compare for maintaining <100ms MCP response times during active indexing?
2. What queuing libraries are appropriate for an embedded (no external dependencies) system — how do BullMQ (requires Redis), better-queue, p-queue, and a simple EventEmitter compare on reliability, backpressure support, and retry handling?
3. What are the measured event loop lag thresholds that indicate starvation, and how should a production daemon detect and respond to them — what monitoring (perf_hooks.monitorEventLoopDelay) and circuit-breaker patterns prevent indexing from degrading MCP responsiveness?

Primary search targets: Node.js worker_threads documentation, Node.js perf_hooks documentation, BullMQ documentation, p-queue npm package, Google SRE book (monitoring chapter).

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PE-02: Embedded Database Concurrency Patterns

Research concurrency patterns for SQLite and LanceDB when used as embedded databases in a single-process application handling concurrent reads and writes.

Focused questions:
1. How does SQLite WAL (Write-Ahead Logging) mode work for concurrent access — what are the exact isolation guarantees (readers see snapshot, writers are serialized), what PRAGMA settings optimize performance (journal_mode=WAL, busy_timeout, wal_autocheckpoint), and what is the measured impact on read/write throughput?
2. How does LanceDB handle concurrent access from a single process — what locking mechanisms does it use, can multiple readers coexist with a writer, and what are the known failure modes (stale reads, lock contention)?
3. What connection management patterns are appropriate — should a single shared connection be used, or a connection pool, and how do ORM/query builders (better-sqlite3, Drizzle) handle connection lifecycle in a long-running daemon?

Primary search targets: SQLite WAL documentation (sqlite.org/wal.html), SQLite locking documentation, better-sqlite3 npm package documentation, LanceDB concurrency documentation, Drizzle ORM SQLite documentation.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PE-03: Index Rebuild and Migration Strategies

Research strategies for rebuilding and migrating vector and graph indexes — blue-green deployment, atomic cutover, and rolling migration.

Focused questions:
1. What migration strategies are available when changing embedding models or chunking strategies — full rebuild (reindex everything), shadow indexing (build new index alongside old), and blue-green (atomic alias switch) — and what are the time/storage costs for a 500K chunk corpus?
2. How do vector databases support zero-downtime migration — specifically, how do Qdrant collection aliases, LanceDB dataset versioning, and pgvector's approach to schema changes enable atomic switchover?
3. What validation gates should be in place before cutting over to a new index — what metrics (recall@k on golden questions, embedding similarity distribution, latency benchmarks) confirm the new index is at least as good as the old one?

Primary search targets: Qdrant collection aliases documentation, Qdrant snapshots documentation, blue-green deployment patterns (Martin Fowler), LanceDB versioning documentation, pgvector migration patterns.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PE-04: Operational Monitoring for Retrieval Systems

Research monitoring and observability practices for production RAG systems — metrics, alerting, and dashboards.

Focused questions:
1. What metrics are essential for monitoring RAG system health — retrieval metrics (latency, recall proxy, empty result rate), generation metrics (faithfulness, citation accuracy), and infrastructure metrics (index freshness, embedding API latency, database connection health)?
2. How can OpenTelemetry be integrated into a RAG system to trace the full retrieval-generation pipeline — from user query through embedding, vector search, re-ranking, context assembly, and LLM generation — as a single distributed trace?
3. What alerting thresholds and policies prevent alert fatigue while catching real degradation — what burn-rate alerts, anomaly detection, and canary query approaches work for RAG systems?

Primary search targets: OpenTelemetry Node.js SDK documentation, RAGAS continuous monitoring documentation, LangSmith monitoring documentation, Evidently AI monitoring platform, Google SRE monitoring chapter.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

## PE-05: Error Handling and Resilience Patterns

Research error handling and resilience patterns for RAG systems — retry strategies, circuit breakers, graceful degradation, and recovery.

Focused questions:
1. What failure taxonomy covers RAG system errors — transient API failures (embedding API timeout), deterministic data errors (corrupt chunk), infrastructure failures (database lock contention), and cascade failures (embedding API down → retrieval fails → generation fails) — and what is the correct handling strategy for each?
2. How should circuit breakers and retry policies be implemented for a RAG system's external dependencies — what are the appropriate retry counts, backoff strategies (exponential, jitter), and circuit breaker thresholds for embedding APIs, vector database queries, and LLM generation calls?
3. What graceful degradation modes should be supported — when embeddings are unavailable (fall back to lexical search), when the vector database is unavailable (fall back to cached results), when the LLM is unavailable (return raw retrieved context) — and how should the user be informed of degraded quality?

Primary search targets: AWS Builders Library (retry/backoff patterns), Martin Fowler Circuit Breaker pattern, Stripe idempotency design blog, Azure Retry pattern documentation, Node.js error handling best practices.

Write approximately 2500 words of technical analysis with inline source links throughout the text. Ground all claims in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. The bibliography does not count toward the word limit.

---

# END — 81 Prompts Total
