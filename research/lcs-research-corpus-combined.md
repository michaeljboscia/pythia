# LCS Research Corpus — Combined (Completed Documents Only)

> Generated: 2026-03-10 16:07 EDT
> Documents: 10 completed research files from 12-domain taxonomy
> Note: ~80 additional research topics are in-progress or queued

---


================================================================
## SOURCE: LCS-RESEARCH-AGENDA.md
================================================================

# Living Corpus System — Research Agenda

**Created:** 2026-03-10
**Purpose:** Comprehensive research list that must be completed before LCS implementation begins. Every architecture decision must be grounded in research, not opinion.
**Pattern:** Modeled on Tellus research structure (~188 docs across 9 domains)

---

## How This Works

Each entry below becomes a standalone research document. Research can be executed via:
- **Gemini Deep Research** (`mcp__gemini__gemini-deep-research`) — for broad surveys
- **Gemini Search** (`mcp__gemini__gemini-search`) — for targeted lookups
- **Paper reads** — for academic papers (GraphRAG, RAPTOR, ColBERT, etc.)
- **Hands-on evaluation** — for software (Qdrant, Kuzu, tree-sitter, etc.)

Each document must include:
1. **What we learned** — key findings
2. **What it means for LCS** — implications for our specific architecture
3. **Decision inputs** — which ADRs this research feeds into
4. **Open questions** — what we still don't know after this research

---

## Domain 1: Retrieval Fundamentals (12 docs)

The core science behind what LCS does. Every retrieval decision flows from understanding these.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| RF-01 | Dense retrieval fundamentals — embeddings, ANN search, HNSW algorithm, how vector similarity actually works | Foundational | ADR-002, ADR-003 | P0 |
| RF-02 | Sparse retrieval — BM25, TF-IDF, inverted indexes, when keyword search beats semantic search | Foundational | ADR-002 | P0 |
| RF-03 | Hybrid retrieval — combining dense + sparse, why hybrid consistently outperforms either alone (BEIR benchmark evidence) | Foundational | ADR-002 | P0 |
| RF-04 | Score fusion methods — Reciprocal Rank Fusion (RRF), linear combination, learned weighting, CombMNZ. Which is best for heterogeneous artifact types | Applied | ADR-002 | P1 |
| RF-05 | Re-ranking with cross-encoders — Cohere Rerank, BGE Reranker, BAAI models. Local vs API, latency/quality tradeoffs | Applied | ADR-002 | P1 |
| RF-06 | ColBERT and late interaction retrieval — per-token vectors, MaxSim scoring, when it outperforms single-vector. Storage cost implications | Deep dive | ADR-003 | P2 |
| RF-07 | Lost-in-the-middle problem — the actual papers, measured degradation curves, which models are worst/best, what mitigations are proven | Foundational | ADR-009 | P0 |
| RF-08 | Context window packing strategies — primacy/recency bias exploitation, optimal chunk ordering, measured impact on answer quality | Applied | ADR-009 | P0 |
| RF-09 | Chunking strategies comprehensive survey — recursive character splitting, semantic chunking, token-based, sliding window with overlap, markdown-aware splitting. Measured retrieval impact of chunk size | Applied | ADR-004 | P0 |
| RF-10 | Retrieval augmented generation (RAG) production patterns — what actually works in production systems vs academic benchmarks. Common failure modes | Survey | All | P0 |
| RF-11 | Query decomposition — least-to-most prompting, step-back prompting, decomposed prompting, chain-of-thought retrieval. Which strategies improve multi-hop recall | Applied | ADR-007 | P1 |
| RF-12 | Context compression — extractive vs abstractive compression of retrieved context, LLMLingua, selective context, when compression helps vs hurts fidelity | Deep dive | ADR-009 | P2 |

---

## Domain 2: Knowledge Graphs & Graph RAG (10 docs)

The structural reasoning layer. Understanding these determines whether we need a graph DB, what kind, and how to build the knowledge graph.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| KG-01 | **GraphRAG paper (Microsoft, 2024)** — full paper read. Community detection over knowledge graphs, global vs local search, how it handles heterogeneous documents | Paper read | ADR-001 | P0 BLOCKER |
| KG-02 | **RAPTOR paper (Stanford)** — Recursive Abstractive Processing for Tree-Organized Retrieval. Hierarchical indexing without fidelity loss, tree structures over documents | Paper read | ADR-004 | P0 BLOCKER |
| KG-03 | Property graphs vs RDF/OWL — which model fits heterogeneous artifact types (research + code + ADRs). Labeled property graph semantics, schema flexibility | Foundational | ADR-001 | P0 |
| KG-04 | Knowledge graph construction from unstructured text — REBEL, OpenIE, LLM-based relation extraction pipelines. Precision/recall tradeoffs of automated extraction | Applied | ADR-005 | P1 |
| KG-05 | Graph traversal algorithms — BFS, DFS, shortest path, variable-depth traversal, cycle detection. What query patterns does LCS actually need | Applied | ADR-001 | P1 |
| KG-06 | Community detection algorithms — Louvain, Leiden, what GraphRAG uses and why. Relevance to clustering related artifacts | Deep dive | ADR-001 | P2 |
| KG-07 | Architecture Decision Records (ADRs) — the MADR format, Nygard format, existing tooling (adr-tools, log4brains). How other systems handle implicit vs explicit decisions | Applied | ADR-004, ADR-005 | P1 |
| KG-08 | Knowledge graph schema design for polymorphic nodes — how to model fundamentally different entity types (papers, functions, logs) in one graph. Best practices from production systems | Applied | ADR-001 | P1 |
| KG-09 | Relationship extraction strategies compared — parser-based (deterministic, high precision) vs LLM-based (flexible, noisy) vs LSP-based (code-only, perfect precision). Cost models, when to use each | Applied | ADR-005 | P0 |
| KG-10 | LightRAG architecture study — graph-based RAG, design decisions, what they got right/wrong. Compare to Microsoft GraphRAG approach | Prior art | ADR-001 | P1 |

---

## Domain 3: Embedding Models & Selection (9 docs)

Which models generate the vectors. Wrong choice here = bad retrieval everywhere downstream.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| EM-01 | **MTEB leaderboard deep analysis** — understand task categories, which benchmarks are closest to LCS use case (retrieval, not classification). Current top models by task type | Survey | ADR-003 | P0 BLOCKER |
| EM-02 | OpenAI text-embedding-3 family — small vs large, dimension reduction (matryoshka), pricing, latency, measured retrieval quality on code + prose | Evaluation | ADR-003 | P0 |
| EM-03 | Voyage AI embedding models — voyage-3 (general), voyage-code-3 (code-specific). Benchmark claims, actual measured quality, pricing comparison to OpenAI | Evaluation | ADR-003 | P0 |
| EM-04 | Local embedding models via Ollama — nomic-embed-text v1.5, mxbai-embed-large, all-minilm. Throughput on home server hardware, quality vs API models | Evaluation | ADR-003 | P1 |
| EM-05 | Code embedding models survey — CodeBERT, GraphCodeBERT, UniXcoder, StarEncoder, Voyage Code 3. How code embeddings differ from prose embeddings, what "code semantics" actually means for retrieval | Survey | ADR-003 | P0 |
| EM-06 | Embedding dimension tradeoffs — 384 vs 768 vs 1024 vs 1536. Measured impact on retrieval quality, storage cost, search latency. Matryoshka embeddings (variable dims from one model) | Applied | ADR-003 | P1 |
| EM-07 | Multi-vector vs single-vector embeddings — when does per-type model routing justify the complexity? Scoring across different embedding spaces | Applied | ADR-003 | P1 |
| EM-08 | Embedding fine-tuning with synthetic training pairs — how to generate training data from the corpus using an LLM, sentence-transformers fine-tuning pipeline | Deep dive | ADR-003 | P2 (v2) |
| EM-09 | Embedding model versioning and migration — what happens when you change models, how to handle the re-indexing, blue-green vector space patterns | Applied | ADR-003 | P1 |

---

## Domain 4: Code Intelligence (8 docs)

How to understand, parse, chunk, and index source code. This is where LCS differs from document-only RAG systems.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| CI-01 | **tree-sitter architecture and TypeScript grammar** — how tree-sitter works, incremental parsing, query patterns, available language grammars. Hands-on with TS/JS parsing | Hands-on | ADR-004 | P0 BLOCKER |
| CI-02 | tree-sitter for code chunking — syntax-aware splitting at function/class/module boundaries. Handling large functions, nested structures, export patterns. Measured chunk quality | Applied | ADR-004 | P0 |
| CI-03 | **LSP (Language Server Protocol) for headless code analysis** — running tsserver headlessly, extracting call hierarchies, find-all-references, go-to-definition. Feasibility as an indexing pipeline | Evaluation | ADR-005 | P0 BLOCKER |
| CI-04 | Call graph extraction from TypeScript — static analysis approaches, handling dynamic dispatch, async/await chains, higher-order functions. What's extractable vs what requires runtime analysis | Applied | ADR-005 | P1 |
| CI-05 | Import/dependency graph extraction — resolving barrel exports, path aliases (tsconfig paths), node_modules, re-exports. Practical extraction pipeline | Applied | ADR-005 | P1 |
| CI-06 | Test file detection and coverage linking — heuristic approaches (naming conventions, co-location), jest config parsing, relating test files to source files programmatically | Applied | ADR-005 | P1 |
| CI-07 | AST-based code analysis fundamentals — abstract syntax trees, control flow graphs, data flow analysis. Working understanding for building the codebase layer | Foundational | ADR-004, ADR-005 | P1 |
| CI-08 | Code search in practice — how Sourcegraph, GitHub code search, Cursor, and Cody handle codebase-scale search. What index structures they use | Prior art | ADR-002, ADR-004 | P1 |

---

## Domain 5: Vector Databases (7 docs)

Where the embeddings live. Each is a hands-on evaluation, not a feature matrix screenshot.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| VD-01 | **Qdrant deep dive** — architecture (segments, WAL, quantization), filtering during vector search, hybrid search support, Docker deployment, measured memory/latency at 50K-500K scale | Hands-on eval | ADR-002 | P0 BLOCKER |
| VD-02 | **LanceDB deep dive** — embedded architecture, Lance columnar format, zero-copy mmap, IVF-PQ indexing, Python/Node bindings, concurrent access model, measured memory/latency | Hands-on eval | ADR-002 | P0 BLOCKER |
| VD-03 | pgvector evaluation — Postgres extension, HNSW + IVFFlat indexes, filtering via SQL WHERE, operational overhead of running Postgres for vectors | Evaluation | ADR-002 | P1 |
| VD-04 | ChromaDB evaluation — embedded, Python-native, SQLite backend, known limitations, production readiness assessment | Evaluation | ADR-002 | P1 |
| VD-05 | Weaviate evaluation — hybrid search, graph-like filtering, multi-tenancy, operational complexity. Is it overkill for single-project v1? | Evaluation | ADR-002 | P2 |
| VD-06 | Vector DB benchmarking methodology — how to fairly compare vector DBs. ANN-Benchmarks, VectorDBBench, what metrics matter (recall@10, QPS, p99 latency, memory) | Methodology | ADR-002 | P0 |
| VD-07 | Vector index algorithms — HNSW, IVF-PQ, IVF-Flat, DiskANN, SCANN. When each is appropriate, memory vs quality tradeoffs | Foundational | ADR-002 | P1 |

---

## Domain 6: Graph Databases (6 docs)

Where the relationships live. The crossover problem from interrogation proves this needs real research.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| GD-01 | **Kuzu deep dive** — embedded graph DB, Cypher-compatible, C++ core with Python/Node bindings, variable-length path queries, measured performance at 5K-50K nodes | Hands-on eval | ADR-001 | P0 BLOCKER |
| GD-02 | **SQLite as graph store** — adjacency list tables, recursive CTEs, practical query patterns, performance at scale, when it breaks down. Honest assessment vs dedicated graph DB | Hands-on eval | ADR-001 | P0 BLOCKER |
| GD-03 | Neo4j evaluation — JVM overhead, memory requirements, Cypher expressiveness, community vs enterprise, bolt protocol. Is it justified at small scale? | Evaluation | ADR-001 | P1 |
| GD-04 | ArangoDB evaluation — multi-model (document + graph + search), AQL query language. Does multi-model reduce total system complexity? | Evaluation | ADR-001 | P2 |
| GD-05 | FalkorDB evaluation — Redis-based graph, in-memory performance, persistence model. Lightweight alternative assessment | Evaluation | ADR-001 | P2 |
| GD-06 | Graph DB benchmarking at small scale — how to compare graph DBs at 5K-50K nodes. What queries to benchmark, what metrics matter, how to simulate LCS query patterns | Methodology | ADR-001 | P0 |

---

## Domain 7: Evaluation & Quality Measurement (6 docs)

How to know if LCS works. The design doc says "design before building, not after." This is that.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| EQ-01 | **RAGAS framework deep dive** — faithfulness, answer relevance, context precision, context recall. How to implement, how to generate test sets, integration with existing pipelines | Hands-on | ADR-010 | P0 BLOCKER |
| EQ-02 | Retrieval metrics comprehensive — Recall@K, MRR, NDCG, MAP. What each measures, when each matters, how to compute them. Which is most important for LCS use case | Foundational | ADR-010 | P0 |
| EQ-03 | **Multi-hop QA benchmarks** — HotpotQA, MuSiQue, 2WikiMultiHopQA. What they test, how evaluation works, what "good" looks like for multi-document reasoning | Paper read | ADR-010 | P1 |
| EQ-04 | Golden question set design methodology — how to create evaluation sets for a specific corpus. Manual vs LLM-generated, bootstrapping when corpus is small, evolving the set over time | Applied | ADR-010 | P0 |
| EQ-05 | Adversarial testing for RAG — questions requiring synthesis across many sources, "not in corpus" detection, absence-of-evidence reasoning, multi-hop traversal across artifact types | Applied | ADR-010 | P1 |
| EQ-06 | End-to-end evaluation pipelines — how production RAG systems monitor quality over time. Automated regression detection, drift alerts, continuous evaluation | Applied | ADR-010 | P1 |

---

## Domain 8: MCP Architecture (5 docs)

The interface layer. LCS exposes everything through MCP tools.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| MC-01 | **MCP protocol specification — full deep read** — tools vs resources vs prompts, schemas, sampling, transport (stdio vs SSE vs streamable HTTP), lifecycle | Spec read | ADR-007 | P0 BLOCKER |
| MC-02 | Existing MCP servers for code/knowledge — GitHub MCP, filesystem MCP, database MCPs. What patterns they use, what their limitations are, what to learn from them | Survey | ADR-007 | P1 |
| MC-03 | MCP tool design patterns — granularity (primitive vs composite tools), parameter design, response formatting, error handling conventions | Applied | ADR-007 | P1 |
| MC-04 | MCP context window management — how to decide what to inject into LLM context from retrieval results. Budget enforcement, truncation strategies, overflow handling | Applied | ADR-007, ADR-009 | P1 |
| MC-05 | MCP server architecture patterns — single vs multi-process, stateless vs stateful, connection pooling to backing stores, health checks | Applied | ADR-007 | P1 |

---

## Domain 9: Prior Art & Existing Systems (10 docs)

Study what others built. Learn from their mistakes before making our own.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| PA-01 | **Cognee** — open source knowledge graph + RAG. Graph construction pipeline, relationship extraction, how they handle heterogeneous documents. Code study | Code study | ADR-001, ADR-005 | P0 |
| PA-02 | **Microsoft GraphRAG implementation** — the actual code, not just the paper. How they build the graph, community detection in practice, indexing pipeline | Code study | ADR-001 | P0 |
| PA-03 | **LightRAG** — graph-based RAG, dual-level retrieval (local + global), their architectural writeup and design decisions | Code study | ADR-001, ADR-002 | P1 |
| PA-04 | **Cursor codebase indexing** — how they index entire codebases for conversation. What index structures, what models, how they handle large repos | Reverse eng | ADR-002, ADR-004 | P1 |
| PA-05 | **Zed AI codebase indexing** — their engineering blog posts on indexing for LLM context. Architecture decisions, what worked, what didn't | Blog study | ADR-002, ADR-004 | P1 |
| PA-06 | LangChain RAG patterns — document loaders, text splitters, retrievers, chains. What patterns are standard, what's over-engineered | Survey | All | P1 |
| PA-07 | LlamaIndex knowledge graph integration — how they combine vector retrieval with graph traversal. PropertyGraphIndex, KnowledgeGraphIndex | Code study | ADR-001, ADR-002 | P1 |
| PA-08 | GitHub Copilot Workspace architecture — how they handle codebase-scale context for multi-file edits. Published architecture details | Reverse eng | ADR-004 | P2 |
| PA-09 | Notion AI / Confluence AI — living document corpus with conversation. How they handle document freshness, relationship updates, search across types | Survey | ADR-006, ADR-008 | P2 |
| PA-10 | Sourcegraph Cody — code intelligence + RAG. How they combine structural code understanding with semantic search. Context window strategies | Reverse eng | ADR-002, ADR-009 | P1 |

---

## Domain 10: Data Management & "Living" Systems (7 docs)

How LCS stays current. The "living" in Living Corpus.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| DM-01 | Change Data Capture (CDC) patterns — Debezium, git hooks (post-commit, post-merge), filesystem watchers (fswatch, inotify), GitHub webhooks. Tradeoffs of each trigger mechanism | Survey | ADR-006 | P1 |
| DM-02 | Document versioning and provenance tracking — how to track artifact history in a queryable way. Immutable append vs mutable-with-history, temporal databases | Applied | ADR-006 | P1 |
| DM-03 | Staleness detection and freshness scoring — what production knowledge bases do. Temporal RAG papers, heuristic models, signal-based scoring, how to detect "code changed but doc didn't" | Applied | ADR-008 | P1 |
| DM-04 | Git hook architectures — post-commit, post-merge, pre-push, server-side hooks. Reliability, failure modes, debouncing, event queues. How Claude Code hooks already work (we run them) | Applied | ADR-006 | P1 |
| DM-05 | Incremental indexing strategies — re-indexing only changed files vs full rebuild, how to detect what changed, delta computation, consistency guarantees | Applied | ADR-006 | P1 |
| DM-06 | Artifact lifecycle management — creation, versioning, supersession, tombstoning, archival. What happens to relationships when artifacts change state | Applied | ADR-006 | P1 |
| DM-07 | Event-driven indexing architecture — message queues, event loops, async job processing in Node.js/Python. How to run background ingest alongside a request-response MCP server | Applied | ADR-006 | P1 |

---

## Domain 11: NLP & ML Foundations (5 docs)

The science behind specific LCS features like contradiction detection and semantic similarity.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| NL-01 | Natural Language Inference (NLI) — entailment, contradiction, neutral. MNLI benchmark, lightweight NLI models for contradiction detection. Precision/recall at scale | Foundational | v2 | P2 |
| NL-02 | Semantic textual similarity — how similarity scoring works beyond embeddings. Cross-encoder scoring, sentence-BERT, when cosine similarity fails | Foundational | ADR-003 | P1 |
| NL-03 | Text chunking algorithms deep dive — recursive character text splitter, semantic chunking (embedding-based boundary detection), markdown-aware splitting, measured impact on retrieval quality | Applied | ADR-004 | P0 |
| NL-04 | Transformer attention mechanisms and positional encoding — RoPE, ALiBi, how attention distributes over long sequences (the root cause of lost-in-the-middle). For understanding, not building | Foundational | ADR-009 | P2 |
| NL-05 | Contradiction detection approaches — NLI-based, LLM-as-judge, claim decomposition + verification. What's practical at LCS scale | Deep dive | v2 | P2 |

---

## Domain 12: Production Engineering (5 docs)

Making it actually run reliably.

| # | Topic | Type | Feeds ADR | Priority |
|---|-------|------|-----------|----------|
| PE-01 | Single-process daemon architecture — Node.js event loop for MCP + background ingest, async job queues (bull, bee-queue), worker threads vs child processes | Applied | ADR-007 | P1 |
| PE-02 | Embedded database concurrency patterns — SQLite WAL mode, reader/writer isolation, LanceDB concurrent access, how to safely serve queries while indexing | Applied | ADR-001, ADR-002 | P0 |
| PE-03 | Index rebuild and migration strategies — blue-green indexes, atomic swaps, how to re-embed entire corpus without downtime, versioned index directories | Applied | ADR-002, ADR-003 | P1 |
| PE-04 | Operational monitoring for retrieval systems — what metrics to track (recall, latency, staleness), alerting on quality degradation, logging query patterns | Applied | ADR-010 | P1 |
| PE-05 | Error handling and resilience patterns — partial index failures, embedding API outages, corrupted vector indexes, graceful degradation strategies | Applied | All | P1 |

---

## Summary Statistics

| Domain | Docs | P0 Blockers | P1 | P2 |
|--------|------|-------------|----|----|
| Retrieval Fundamentals | 12 | 4 | 4 | 4 |
| Knowledge Graphs | 10 | 3 | 5 | 2 |
| Embedding Models | 9 | 3 | 4 | 2 |
| Code Intelligence | 8 | 3 | 4 | 1 |
| Vector Databases | 7 | 3 | 3 | 1 |
| Graph Databases | 6 | 3 | 1 | 2 |
| Evaluation & Quality | 6 | 3 | 3 | 0 |
| MCP Architecture | 5 | 1 | 4 | 0 |
| Prior Art | 10 | 2 | 6 | 2 |
| Data Management | 7 | 0 | 7 | 0 |
| NLP Foundations | 5 | 1 | 1 | 3 |
| Production Engineering | 5 | 1 | 4 | 0 |
| **TOTAL** | **90** | **27** | **46** | **17** |

---

## Research Sequencing (from LCS Design Doc Part 11, refined)

### Phase 1 — Frame the Core Architecture (P0 BLOCKERS)
Must complete before ANY ADR can be written:
1. KG-01: GraphRAG paper
2. KG-02: RAPTOR paper
3. RF-10: RAG production patterns
4. RF-07: Lost-in-the-middle
5. EQ-01: RAGAS framework

### Phase 2 — Lock the Code Intelligence Layer
6. CI-01: tree-sitter architecture
7. CI-03: LSP headless operation
8. CI-02: tree-sitter for code chunking

### Phase 3 — Lock the Embedding Strategy
9. EM-01: MTEB leaderboard
10. EM-02: OpenAI embeddings eval
11. EM-03: Voyage AI eval
12. EM-05: Code embedding models

### Phase 4 — Lock the Storage Layer
13. VD-01: Qdrant deep dive
14. VD-02: LanceDB deep dive
15. VD-06: Vector DB benchmarking
16. GD-01: Kuzu deep dive
17. GD-02: SQLite as graph store
18. GD-06: Graph DB benchmarking

### Phase 5 — Shape the Tool Interfaces
19. MC-01: MCP full specification

### Phase 6 — Know How to Measure
20. EQ-02: Retrieval metrics
21. EQ-04: Golden question set design

### Phase 7 — Study Prior Art (parallel with above)
22. PA-01: Cognee
23. PA-02: Microsoft GraphRAG impl
24. PA-04: Cursor indexing

### Then — Everything else as specific design questions arise

---

## ADR Dependency Chain (Research-Informed)

```
Research Phase 1 (core papers)
  │
  ├──► ADR-000: v1 Scope + Corpus Boundary
  │
  ├──► Research Phase 2 (code intel) ──► ADR-004: Chunking Strategy
  │                                      ADR-005: Relationship Extraction
  │
  ├──► Research Phase 3 (embeddings) ──► ADR-003: Embedding Model Strategy
  │
  ├──► Research Phase 4 (storage) ────► ADR-002: Vector DB Selection
  │                                     ADR-001: Graph DB Selection
  │
  ├──► Research Phase 5 (MCP) ────────► ADR-007: MCP Tool Schema
  │                                     ADR-009: Context Packing
  │
  ├──► Research Phase 6 (eval) ───────► ADR-010: Evaluation Framework
  │
  └──► Remaining ADRs:
       ADR-006: Live State Ingestion
       ADR-008: Staleness Scoring
```

No ADR is written until its feeding research is complete. No implementation begins until ADRs are written. This is the discipline that was missing from the interrogation rounds.

---

## File Naming Convention

Research documents follow the Tellus pattern:
```
/Users/mikeboscia/pythia/research/lcs/
├── LCS-RESEARCH-AGENDA.md          # This file (master index)
├── tracking.md                      # Status of all research items
├── retrieval-fundamentals/
│   ├── RF-01_Dense-Retrieval-Fundamentals.md
│   ├── RF-02_Sparse-Retrieval-BM25.md
│   └── ...
├── knowledge-graphs/
│   ├── KG-01_GraphRAG-Paper-Microsoft-2024.md
│   ├── KG-02_RAPTOR-Paper-Stanford.md
│   └── ...
├── embedding-models/
│   ├── EM-01_MTEB-Leaderboard-Analysis.md
│   └── ...
├── code-intelligence/
│   ├── CI-01_Tree-Sitter-Architecture-TypeScript.md
│   └── ...
├── vector-databases/
│   ├── VD-01_Qdrant-Deep-Dive.md
│   └── ...
├── graph-databases/
│   ├── GD-01_Kuzu-Deep-Dive.md
│   └── ...
├── evaluation/
│   ├── EQ-01_RAGAS-Framework.md
│   └── ...
├── mcp-architecture/
│   ├── MC-01_MCP-Protocol-Specification.md
│   └── ...
├── prior-art/
│   ├── PA-01_Cognee-Study.md
│   └── ...
├── data-management/
│   ├── DM-01_CDC-Patterns.md
│   └── ...
├── nlp-foundations/
│   ├── NL-01_Natural-Language-Inference.md
│   └── ...
└── production-engineering/
    ├── PE-01_Single-Process-Daemon-Architecture.md
    └── ...
```


================================================================
## SOURCE: RF-01_Dense-Retrieval-Fundamentals.md
================================================================

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


================================================================
## SOURCE: RF-02_Sparse-Retrieval-BM25-and-TF-IDF.md
================================================================

# RF-02: Sparse Retrieval — BM25 and TF-IDF

**Status:** Complete
**Researched via:** Gemini Search + Synthesis
**Date:** 2026-03-10

**Domain:** Domain 1: Retrieval Fundamentals
**Type:** Foundational
**Priority:** P0
**Feeds ADR:** ADR-002

---

## Table of Contents

1. [The Probabilistic Relevance Framework](#1-the-probabilistic-relevance-framework)
2. [BM25 Algorithm Mechanics](#2-bm25-algorithm-mechanics)
3. [TF-IDF vs BM25: Why BM25 Won](#3-tf-idf-vs-bm25-why-bm25-won)
4. [Inverted Index Architecture](#4-inverted-index-architecture)
5. [When BM25 Beats Semantic Search](#5-when-bm25-beats-semantic-search)
6. [BM25 Variants](#6-bm25-variants)
7. [BM25 Failure Modes](#7-bm25-failure-modes)
8. [SPLADE and Sparse Neural Vectors](#8-splade-and-sparse-neural-vectors)
9. [Tokenization Strategies for Code](#9-tokenization-strategies-for-code)
10. [BM25 Parameter Tuning for LCS](#10-bm25-parameter-tuning-for-lcs)
11. [What It Means for LCS](#11-what-it-means-for-lcs)
12. [Decision Inputs for ADR-002](#12-decision-inputs-for-adr-002)
13. [Open Questions](#13-open-questions)

---

## 1. The Probabilistic Relevance Framework

BM25 did not emerge in isolation. It is the practical crystallization of a theoretical framework called the **Probabilistic Relevance Framework (PRF)**, developed primarily by Stephen Robertson and colleagues at City University London over roughly three decades, from the 1970s through the 2000s. The authoritative reference is Robertson & Zaragoza's 2009 paper "The Probabilistic Relevance Framework: BM25 and Beyond" (Foundations and Trends in Information Retrieval, Vol. 3).

The PRF's core question is: given a query, what is the probability that a document is relevant? The framework models this as a probabilistic inference problem, balancing two competing probability estimates:

- The probability of seeing a term in a **relevant** document
- The probability of seeing a term in a **non-relevant** document

The ratio of these two probabilities, summed across all query terms, yields a relevance score. BM25 is the practical, parameterized version of this model — "BM" stands for "Best Match" and "25" simply refers to the iteration number in the research series (earlier iterations were BM1 through BM24, most of which were intermediate experiments, never deployed).

The reason this theoretical grounding matters for LCS is that BM25 is not a heuristic — it is derived from first principles about what relevance means. This gives it predictable, interpretable behavior, which is critical when debugging a retrieval system that needs to locate specific code symbols.

---

## 2. BM25 Algorithm Mechanics

### The Full Formula

For a query Q containing terms q₁, q₂, ..., qₙ, the BM25 score for a document D is:

```
Score(D, Q) = Σᵢ IDF(qᵢ) · [ TF(qᵢ, D) · (k1 + 1) ] / [ TF(qᵢ, D) + k1 · (1 - b + b · |D| / avgdl) ]
```

Where:
- `IDF(qᵢ)` = inverse document frequency of term qᵢ
- `TF(qᵢ, D)` = number of times qᵢ appears in document D
- `|D|` = length of document D in tokens
- `avgdl` = average document length across the entire corpus
- `k1` = term frequency saturation parameter
- `b` = length normalization parameter

### The IDF Component

The IDF formula used in modern BM25 implementations (the Robertson IDF) is:

```
IDF(qᵢ) = ln( 1 + (N - n(qᵢ) + 0.5) / (n(qᵢ) + 0.5) )
```

Where:
- `N` = total number of documents in the corpus
- `n(qᵢ)` = number of documents containing the term qᵢ

The 0.5 smoothing constants prevent division by zero and ensure IDF never goes negative. The natural log ensures that the score grows slowly — doubling the rarity of a term does not double its IDF score.

The practical effect: if your corpus is 10,000 Python files and you search for `"import"`, n(qᵢ) is enormous (nearly every file imports something), yielding an IDF near zero. But if you search for `"EPHEMERAL_TOKEN_REVOKE_V3"`, n(qᵢ) might be 1, yielding a very high IDF. BM25 inherently weights specificity.

### TF Saturation and the k1 Parameter

In raw TF-IDF, term frequency scales linearly: a document mentioning a term 100 times scores 10x more than one mentioning it 10 times. This is wrong in practice. A function that says `authenticate` 5 times is clearly about authentication. A function that says it 50 times is not 10x more relevant — it may just be longer or repetitive.

BM25 solves this with a saturation curve controlled by `k1`. As raw TF increases, the BM25-normalized TF increases rapidly at first, then flattens, approaching an asymptote of `k1 + 1`.

**k1 behavioral guide:**
| k1 value | Behavior |
|----------|----------|
| 0.0 | Pure IDF — term frequency completely ignored, only presence/absence matters |
| 1.2 (Elasticsearch default) | Moderate saturation — frequency matters but plateaus quickly |
| 2.0 | Slower saturation — repeated terms continue to add score for longer |
| > 3.0 | Approaches linear TF — rarely used, implies frequency is the dominant signal |

For code corpora, lower k1 (1.0–1.5) is generally appropriate. A function name appearing twice in a file is not twice as relevant as it appearing once. The token is either in the file or it isn't.

### Field Length Normalization and the b Parameter

A 500-line module will naturally contain the term `authenticate` more times than a 10-line utility function — not because it is more relevant, but because it is longer. The `b` parameter controls how aggressively BM25 corrects for this.

The normalization computes the ratio `|D| / avgdl`. A document longer than average sees its TF penalized; one shorter than average gets a slight boost.

**b behavioral guide:**
| b value | Behavior |
|---------|----------|
| 0.0 | No length normalization — all documents treated as equal length |
| 0.75 (standard default) | Partial normalization — penalizes long docs but not fully |
| 1.0 | Full normalization — term frequency is completely normalized by length |

For code files, `b = 0.75` is a reasonable starting point for prose-like documents (markdown, docstrings, README files). For individual function-level chunks — where document length is tightly controlled during indexing — `b` can be lowered toward 0.3–0.5 because the length variation is intentionally small.

### How Parameters Interact

The two parameters are not independent. A high `b` (strong length normalization) combined with a high `k1` (slow saturation) will produce very different ranking from a low `b` / low `k1` combination. The interaction surface means parameters should be tuned together via grid search on a held-out evaluation set, not adjusted one at a time in isolation.

---

## 3. TF-IDF vs BM25: Why BM25 Won

TF-IDF, the predecessor, computes relevance as a simple product:

```
TF-IDF(t, d) = TF(t, d) · IDF(t)
```

Where TF(t, d) is typically `log(1 + count(t, d))` and IDF is `log(N / df(t))`.

BM25 supersedes TF-IDF for three reasons:

**1. Linear TF scaling.** TF-IDF's term frequency component (even with log normalization) still grows unboundedly with raw count. BM25's saturation curve bounds this correctly.

**2. No length normalization.** Standard TF-IDF has no native document length correction. Longer documents score higher simply by having more opportunities for term occurrence. BM25's `b` parameter fixes this.

**3. No calibration parameters.** TF-IDF offers no tunable knobs. BM25's `k1` and `b` allow the algorithm to be adapted to the specific statistical properties of a corpus — something critical when moving between corpora as different as Wikipedia prose and Python source code.

Apache Lucene switched BM25 as its default similarity scorer in version 6.0 (released 2016). Elasticsearch followed immediately, making BM25 the default for all `match` and `multi_match` queries. The Elasticsearch documentation for BM25 tuning explicitly states that the default `k1=1.2, b=0.75` are borrowed from Lucene's TREC experiments on web document collections — meaning the defaults were never tuned for code.

---

## 4. Inverted Index Architecture

### Structure

An inverted index is a two-part data structure:

1. **The dictionary (vocabulary):** A sorted list of all unique terms across the corpus. This is typically stored as a trie or hash map for O(log n) or O(1) term lookup.

2. **The postings lists:** For each term, a sorted list of (document ID, term frequency, position list) tuples. The document IDs are sorted in ascending order.

A minimal postings entry looks like: `authenticate → [3, 17, 42, 156, 204]`

A full postings entry with term frequency and positions: `authenticate → [(3, tf=2, pos=[14, 89]), (17, tf=1, pos=[3]), ...]`

Positions enable phrase queries (`"token authentication"`) and proximity scoring — important for code where argument order matters.

### Boolean Query Execution

Given a query `authenticate AND token`:

1. Look up the postings list for `authenticate`: `[3, 17, 42, 156]`
2. Look up the postings list for `token`: `[3, 8, 42, 199, 201]`
3. Execute a merge-intersection using two pointers: result is `[3, 42]`

The two-pointer merge is O(m + n) where m and n are the lengths of the two lists — linear time, not quadratic. This is why AND queries scale even against millions of documents.

For OR queries: merge-union, O(m + n), returns the union of both lists.
For NOT queries: merge with complement. `authenticate AND NOT token` means walk the `authenticate` list and skip any document ID that also appears in the `token` list.

### Gap Encoding and Compression

Raw postings lists cannot be stored as 32-bit integers — a term appearing in 10 million documents would require 40 MB just for that list. Two compression techniques are applied in sequence:

**Gap encoding (delta encoding):** Store the first document ID, then store only the difference (gap) between consecutive IDs.

```
Original:    [10, 25, 80, 100, 102]
Gap-encoded: [10, 15, 55,  20,   2]
```

Because frequent terms appear densely in the document space, their gaps are small. The more common a term, the smaller its gaps, and the more compressible the list.

**Integer compression:** The gap-encoded values are then compressed with integer compression algorithms optimized for small numbers:

- **Variable-Byte (VByte) encoding:** Uses 1 byte for gaps < 128, 2 bytes for < 16384, etc. A continuation bit in the high bit of each byte signals whether the next byte belongs to the same number.
- **PForDelta / Frame of Reference:** Packs 128 or 256 gap values into fixed-width blocks where the bit-width is determined by the largest value in the block. Most values use far fewer bits. This is the dominant format in Lucene's `.doc` files because modern CPUs can decompress entire blocks via SIMD instructions.

**Skip lists:** To support fast intersection without decompressing entire lists, inverted indexes embed skip pointers at regular intervals. A skip pointer says: "The next 128 values start at document ID 5000." When intersecting `authenticate` (which contains DocID 3, 42, 5001...) with `token` (which jumps from 42 to 5500), the search engine can use the skip pointer to bypass decompressing thousands of entries in the `authenticate` list between 42 and 5001.

Lucene stores `.doc` files (postings), `.pos` files (positions), and `.pay` files (payloads) separately, each compressed with PForDelta-family codecs. The net result: a 10 GB text corpus typically produces a 2–4 GB inverted index (20–40% of raw size), and query latency on a single shard is measured in milliseconds even at millions of documents.

---

## 5. When BM25 Beats Semantic Search

Semantic (dense) retrieval maps text into a continuous vector space using transformer models. Documents "near" the query vector are returned regardless of token overlap. This is powerful for paraphrase and synonym handling, but it has categorical failure modes that BM25 does not share.

### Exact-Match Tokens

**Rare terms and out-of-vocabulary tokens.** Dense models use subword tokenization (BPE, WordPiece). A novel identifier like `EPHEMERAL_TOKEN_REVOKE_V3` gets decomposed into subwords that have been seen in training, but the *specific combination* has not. The resulting embedding is poorly calibrated. BM25 treats it as an atomic token with a very high IDF, which is exactly correct behavior.

**Code identifiers.** Searching for `useAuthenticationToken` in a codebase using dense vectors will return `useLoginCredentials`, `fetchUserSession`, and `validateOAuthBearer` — all semantically equivalent. But the developer wanted the exact function. BM25 returns the exact function.

**Error codes and log tokens.** `ECONNREFUSED`, `0x80070057`, `NullPointerException` — these are tokens that appear in highly specific contexts. Dense models embed them near their semantically similar neighbors. BM25 treats each one as a unique high-IDF token.

### Named Entities

A search for a specific person (`"Sarah Chen"`), a company (`"Axiom Financial"`), or a product ID (`"SKU-99872-B"`) requires exact token matching. Semantic search may return documents about `Sarah Zhang` (similar name structure), `Axiom Analytics` (similar company type), or `SKU-99870-B` (adjacent SKU) because they occupy nearby positions in the embedding space. BM25 makes no such substitutions.

### Numbers and Version Strings

Dense models are demonstrably poor at numerical reasoning. The embedding for `Python 3.11` and `Python 3.12` will be very close — both are Python version strings, after all. For dependency resolution queries (`"which files require Python >= 3.11"`), this conflation is a retrieval error. BM25 treats `3.11` and `3.12` as distinct tokens.

Similarly: `v1.2.3` and `v1.2.4` are treated as nearly identical by embedding models but are entirely distinct by BM25. In a codebase where version pinning matters, this distinction is critical.

### The Benchmark Evidence

The BEIR benchmark (Thakur et al., 2021) — a heterogeneous benchmark across 18 retrieval datasets — shows that BM25 outperforms many dense retrieval models on datasets requiring exact match, including TREC-COVID (technical biomedical terminology), DBPedia (named entity retrieval), and Signal-1M (social media exact-match). On the NFCorpus (medical) and SciFact (scientific fact retrieval) datasets, BM25's performance is within 5 NDCG@10 points of fine-tuned dense models, despite no training.

On the CodeSearchNet benchmark (Husain et al., 2019), BM25 shows a strong advantage specifically on queries consisting of function signatures and exact identifier names versus natural language docstring-style queries, where dense retrieval dominates.

---

## 6. BM25 Variants

### BM25+ (Lower Bound on TF Contribution)

Standard BM25 can reduce the TF component to nearly zero for extremely long documents. If a term appears once in a 10,000-token document, the length normalization may penalize the TF contribution so heavily that it approaches zero — meaning the document scores almost the same whether or not the term appears.

BM25+ adds a floor constant `δ` (typically 1.0) to the normalized TF:

```
TF_bm25+(t, d) = TF_bm25(t, d) + δ
```

This guarantees that if a term appears in a document at all, it contributes at least `δ · IDF(t)` to the score. The document gets credit for containing the term, regardless of how long it is.

For LCS, BM25+ is relevant if the system indexes whole files rather than chunked excerpts — a 2,000-line module should not score the same as a 2,000-line module that doesn't contain the query term at all.

### BM25L (Adjusted Length Normalization)

Proposed in the same paper as BM25+ (Lv & Zhai, 2011), BM25L modifies the length normalization term rather than adding a floor to TF. It replaces the document length ratio `|D| / avgdl` with:

```
c(t, d) = TF_bm25(t, d) / (1 - b + b · |D| / avgdl)
adjusted_c = c(t, d) / (1 + δ)  if  c(t, d) > 1 + δ
```

The effect: BM25L smooths the curve so long documents are penalized less severely. Where BM25+ adds a floor, BM25L reshapes the normalization curve itself.

Both BM25+ and BM25L are research-grade variants — neither is available as a first-class option in Elasticsearch or Lucene. They require either custom `Similarity` implementations in Java (Lucene) or `scripted_similarity` in Elasticsearch.

### BM25F (Field-Weighted Multi-Field Search)

BM25F addresses a fundamental problem with multi-field search. If you index a code file with separate fields for `function_name`, `docstring`, and `body`, and you want to score a match in `function_name` higher than a match in `body`, the naive approach — compute BM25 for each field separately and sum — is mathematically wrong. It applies TF saturation twice and loses the non-linear properties of BM25.

BM25F takes a term-centric approach:

1. For each field f with boost weight wf, compute the weighted TF: `TF_weighted(t, f) = wf · TF(t, f)`
2. Compute the weighted document length: `|D_weighted| = Σf wf · |D_f|`
3. Combine all fields' weighted TFs into a single pseudo-term-frequency: `TF_combined = Σf TF_weighted(t, f)`
4. Apply the BM25 saturation formula *once* using TF_combined and the combined document length.

This preserves the saturation curve: finding a term twice in the title doesn't double-count the saturation penalty the way naive field summation does.

**Elasticsearch implementation:** Since version 7.13, Elasticsearch exposes BM25F through the `combined_fields` query. Field boosting uses the `^` syntax (e.g., `"function_name^3,docstring^2,body^1"`). Constraint: all queried fields must use the same analyzer.

```json
{
  "query": {
    "combined_fields": {
      "query": "authenticate token",
      "fields": ["function_name^3", "docstring^2", "body"]
    }
  }
}
```

For LCS, BM25F via `combined_fields` is the recommended approach when indexing code with structured fields. Symbol names should receive a significantly higher boost than prose body text.

### Elasticsearch's Per-Field BM25 Configuration

Elasticsearch exposes `k1` and `b` at the index mapping level, configurable per field:

```json
{
  "settings": {
    "similarity": {
      "code_bm25": {
        "type": "BM25",
        "k1": 1.2,
        "b": 0.3
      }
    }
  },
  "mappings": {
    "properties": {
      "function_name": {
        "type": "text",
        "similarity": "code_bm25"
      }
    }
  }
}
```

This allows applying different `b` values per field — which is crucial for LCS: prose fields (docstrings, comments) want `b ≈ 0.75`, while code body fields where chunks are tightly controlled want `b ≈ 0.3`.

---

## 7. BM25 Failure Modes

Understanding where BM25 fails is as important as understanding where it succeeds. These failure modes are the direct motivation for hybrid search architectures.

### Vocabulary Mismatch

The foundational failure of all lexical retrieval. If the user and the document author use different vocabulary, BM25 scores the match as zero. This is not a calibration problem — it is a structural limitation of the bag-of-words model.

Examples relevant to LCS:
- Query: `"token revocation"` — Document uses `"invalidate credentials"` → zero score
- Query: `"connection pool"` — Document uses `"database session manager"` → zero score
- Query: `"error handler"` — Document uses `"exception middleware"` → zero score

### Synonym Blindness

BM25 treats `authenticate` and `login` as completely unrelated tokens. From the model's perspective, they share no more in common than `authenticate` and `zucchini`. The model has no notion of semantic proximity — it only sees token overlap.

This is the primary driver for augmenting BM25 with synonym expansion in production search systems. Elasticsearch supports synonym filters at index time or query time. But maintaining synonym dictionaries is expensive and domain-specific. For a codebase, the synonym problem is real but bounded: there are only so many ways to say "authentication" in production code.

### Paraphrase Queries

Natural language questions almost never share exact tokens with the code that answers them. A query like `"how does the app verify that a user is logged in?"` shares no tokens with the function `validate_session_token(request: HttpRequest) -> bool`. BM25 returns a near-zero score. This is the primary domain where dense retrieval wins outright.

### Short Query Terms Without Disambiguating Context

Single-word queries like `"sort"` or `"parse"` will be common across a codebase. BM25's IDF component will give them a low weight because they appear everywhere. But the developer searching for `"sort"` may specifically want the custom sort comparator, not every file that calls `sorted()`. BM25 cannot distinguish intent without token overlap.

### Stop Word Removal and Code

Standard English analyzers apply stop word removal — eliminating tokens like "the", "is", "in", "to". For prose retrieval, this is correct behavior. For code retrieval, it is destructive. Consider:

- `in` is a Python keyword (membership test: `x in collection`)
- `is` is a Python identity operator
- `not` is a logical negation operator
- `or`, `and` are Boolean operators

An English stop word filter applied to a Python corpus will silently remove semantically meaningful tokens. The BM25 score for a query containing these terms will be zero, not because the code doesn't match, but because the analyzer discarded the evidence.

---

## 8. SPLADE and Sparse Neural Vectors

SPLADE (Sparse Lexical and Expansion model) represents the most important development in lexical retrieval since BM25 itself. The original paper (Formal et al., SIGIR 2021) introduced the idea of using a transformer encoder to produce **sparse** representations over the model's full vocabulary.

### How It Works

A SPLADE encoder takes a piece of text and produces a vector with dimensionality equal to the vocabulary size (typically 30,522 for BERT-base). Most values are zero. The non-zero values represent activated terms with associated weights. Unlike a dense 768-dimensional vector, you can inspect which terms were activated — the representation is interpretable.

For the query `"how to revoke a user token"`, SPLADE might activate:
```
revoke: 2.3, token: 2.1, invalidate: 1.8, user: 1.4, credential: 1.2,
authentication: 0.9, expire: 0.8, access: 0.6, ...
```

Notice that `invalidate` and `credential` were never in the input — SPLADE performed **learned term expansion**, injecting semantically related terms with calibrated weights.

### Why This Matters for BM25's Failure Modes

SPLADE addresses vocabulary mismatch at the model level rather than through manually maintained synonym dictionaries. Because it learned term relationships from large corpora, it knows that `revoke` and `invalidate` are related in the authentication domain. The expansion happens automatically, without domain-specific configuration.

SPLADE-encoded documents can be stored in a standard inverted index — the non-zero entries are just term weights in a sparse vector. WAND (Weak AND) and MaxScore algorithms from the BM25 retrieval literature apply directly, giving SPLADE the efficiency properties of classical inverted index search.

### SPLADE vs BM25 Benchmarks

On BEIR benchmarks, SPLADE-v2 outperforms BM25 on 14 of 18 datasets, with particularly large gains on vocabulary-mismatch-heavy datasets (Arguana: +25 NDCG@10, TREC-COVID: +18 NDCG@10). On exact-match-heavy datasets (DBPedia entity search, Robust04), gains are smaller (3–7 points) — BM25 already handles those well.

On code-specific benchmarks, SPLADE shows a more complex picture: it outperforms BM25 on natural language docstring-to-code retrieval but is roughly equivalent on identifier-level exact-match queries, where BM25's token matching is already correct.

### SPLADE vs Dense Retrieval

SPLADE is not a replacement for dense retrieval — it is a bridge. Its strengths:
- Much faster to retrieve than dense search (inverted index vs ANN search)
- Interpretable — you can explain why a document was returned
- Handles vocabulary mismatch without training a full bi-encoder
- Naturally integrates with existing BM25 infrastructure

Its weaknesses:
- Still requires a trained neural model (inference cost at index time)
- Does not capture deep semantic relationships as well as dense bi-encoders on purely conceptual queries
- Expansion quality depends on training domain alignment

For LCS, SPLADE is a candidate to consider as a step above BM25 in retrieval quality, particularly if the query distribution includes many natural language questions about code behavior.

---

## 9. Tokenization Strategies for Code

The choice of tokenizer is the most impactful single decision in a code retrieval system. Standard NLP tokenizers are designed for English prose and fail systematically on code syntax.

### Why Standard Analyzers Fail on Code

Standard English analyzers apply:
1. Lowercasing: `AuthToken → authtoken` (irreversible, loses casing signals)
2. Stop word removal: `in`, `not`, `is`, `or`, `and` — all Python keywords — removed
3. Stemming: `authenticate → authent`, `authentication → authent`, `authenticating → authent` — destroys version/tense distinctions that may matter for code context

The compound result: `useAuthenticationToken` becomes `useauthenticationtoken` (one massive token that will never match anything unless the user types it exactly), and the surrounding code loses its keywords.

### camelCase and snake_case Splitting

Production code tokenizers must split compound identifiers:
- `useAuthenticationToken → use, Authentication, Token`
- `get_user_by_email → get, user, by, email`
- `HTTPSConnectionPool → HTTPS, Connection, Pool`

This enables partial matching: a query for `authentication` finds `useAuthenticationToken`, `AuthenticationMiddleware`, and `authenticateUser` — all semantically related matches that would be missed with a naive tokenizer.

Elasticsearch implements this via the `word_delimiter_graph` token filter with `split_on_case_change: true` and `split_on_numerals: true`. The filter handles camelCase, PascalCase, ALL_CAPS_CONSTANTS, and mixed snake_case correctly.

### Symbol and Operator Handling

Standard tokenizers strip punctuation. For code, punctuation is syntax:
- `Array<string>` — angle brackets are generics syntax
- `(error, result)` — parentheses are argument destructuring
- `$scope` — the dollar sign is a valid identifier prefix in JavaScript
- `@decorator` — the at sign is Python/Java decorator syntax

A code-aware tokenizer must either preserve these symbols or tokenize them consistently. The common approach is to treat `<`, `>`, `(`, `)`, `[`, `]` as delimiter tokens rather than stripping them — so `Array<string>` becomes `[Array, string]` with the `<>` registered as field delimiters, not dropped.

### N-gram Tokenization for Substring Matching

For partial identifier matching (finding `Auth` inside `useAuthenticationToken`), edge n-grams are useful. An edge n-gram filter produces tokens for each prefix of a term:

`Authentication → A, Au, Aut, Auth, Authe, Authen, ...`

This enables prefix-search autocompletion and partial-match retrieval. The tradeoff: index size grows significantly (3–5x) because each token generates many n-gram entries.

For LCS, edge n-grams on the `function_name` field specifically would enable partial symbol search without bloating the full-document index.

### Stemming vs. No Stemming for Code

For prose fields (docstrings, comments, README content), light stemming (Porter or Snowball English) is appropriate — `connecting`, `connection`, `connected` should all match `connect`.

For code fields (function names, identifiers, variable names), **no stemming**. `sort` and `sorted` are distinct functions in Python. `open` and `opening` may refer to different code paths. Stemming would incorrectly conflate them.

This argues for separate fields with separate analyzers — one analyzer for prose, one for code identifiers.

---

## 10. BM25 Parameter Tuning for LCS

### For Code Identifier Fields (function_name, class_name, symbol)

```
k1 = 1.0 – 1.2
b  = 0.1 – 0.3
```

**Rationale:** Identifiers are short (1–5 tokens typically). Length variation is small. Setting `b` low prevents the length normalization from penalizing slightly longer names. TF saturation should kick in quickly because seeing a function name 3 times in its own file is not more relevant than seeing it once — it's just defined, called, and perhaps type-annotated.

### For Code Body Fields (function body, method body)

```
k1 = 1.2 – 1.5
b  = 0.5 – 0.75
```

**Rationale:** Code body length varies more (10-line utility vs 200-line class method). Length normalization matters more here. TF saturation should allow some repetition credit — a token appearing 5 times in a function body may genuinely signal that the function is centrally about that concept.

### For Prose Fields (docstrings, README, comments)

```
k1 = 1.2 – 2.0
b  = 0.75
```

**Rationale:** Standard prose retrieval defaults apply. These are the parameter values tuned on TREC web collections and are generally appropriate for English prose regardless of domain.

### For Markdown Documentation

```
k1 = 1.5
b  = 0.75
```

**Rationale:** Markdown documents are often short (a section or page) and authored in natural English with some technical terms. Standard defaults are appropriate, possibly with slightly higher `k1` to reward repeated emphasis.

### Calibration Approach

The above are starting points, not final values. The correct calibration process is:

1. Build a set of 50–100 representative queries with known ground-truth relevant documents (manually labeled or derived from git blame / usage patterns).
2. Grid search `k1 ∈ [0.5, 3.0]` and `b ∈ [0.0, 1.0]` at 0.25 increments.
3. Optimize for NDCG@10 (relevance-weighted rank quality) or MRR@10 (how often the best result is in the top 10).
4. Run separate calibrations for each field type.

---

## 11. What It Means for LCS

### LCS Must Have BM25 — No Exceptions

The LCS corpus contains Python source code, TypeScript source code, and markdown documentation. The queries will be a mix of:

- Natural language questions (`"how does the oracle checkpoint work"`) — dense retrieval domain
- Exact identifier searches (`"spawn_daemon"`, `"oracle_checkpoint"`, `"MAX_PRESSURE"`) — BM25 domain
- Symbol-heavy queries (`"oracle_reconstitute TypeError"`, `"DECOMMISSION_TOKEN_SECRET"`) — BM25 domain

The identifier and symbol queries are the hard ones. Dense retrieval will not reliably retrieve the exact file or function for an exact identifier query. BM25 will. This is not a nice-to-have — it is a correctness requirement.

### Inverted Index vs Sparse Vector Approximation

Vector databases like Qdrant implement sparse retrieval via **sparse vectors** stored in a sparse vector index — not a true Lucene-style inverted index with gap-encoded postings lists. The retrieval algorithm uses dot-product operations on sparse matrices, not list intersection. The result is functionally similar for ranking, but the architecture is different.

For LCS at the scale being considered (a project-level corpus, likely 1,000–100,000 chunks), the performance difference between a true inverted index and a sparse vector approximation is irrelevant. What matters is which implementation is available in the chosen vector database without requiring a separate service.

**If the chosen vector DB (ADR-002) supports sparse vectors natively:** Use sparse vectors for BM25-like lexical retrieval. Qdrant's sparse vector support is documented and production-ready.

**If the chosen vector DB does not support sparse vectors:** Maintain a separate SQLite FTS5 index (or PostgreSQL `tsvector`) for the BM25 component. SQLite FTS5 uses a BM25 scorer natively (since SQLite 3.36). The dual-index architecture adds operational overhead but is straightforward to implement.

### Tokenization Decision

LCS must use a custom code tokenizer with:
1. camelCase and snake_case splitting on all code fields
2. No stemming on identifier fields
3. Preservation of common code symbols (not stripping `$`, `@`, `_`)
4. Stop word list that excludes Python/TypeScript keywords (`in`, `is`, `not`, `or`, `and`, `as`, `for`)
5. Light English stemming on prose fields only (docstrings, README)
6. Edge n-grams (min=3, max=15) on the `symbol_name` field for partial-match queries

### Hybrid Search is the Architecture

BM25 alone misses conceptual questions. Dense retrieval alone misses exact identifiers. The LCS retrieval pipeline must be hybrid:

1. BM25 over the code corpus with code-aware tokenization
2. Dense retrieval with a code-specialized embedding model (CodeBERT, StarEncoder, or similar)
3. Reciprocal Rank Fusion (RRF) or a learned re-ranker to combine results
4. Hard filter: any query containing known identifiers (detectable by the absence of spaces and the presence of camelCase patterns) routes to BM25 first with a higher weight

### SPLADE as a Future Upgrade Path

BM25 is the right starting point — it is fast, transparent, and handles the exact-match cases that matter most for code retrieval. SPLADE is the right next step if vocabulary mismatch on natural language queries becomes a documented retrieval failure. The architectural investment is the same: both use inverted indexes, so upgrading from BM25 to SPLADE does not require an infrastructure change — only replacing the query/document encoder.

---

## 12. Decision Inputs for ADR-002

| ADR | Question Answered | Our Finding |
|-----|-------------------|-------------|
| ADR-002 | Must our vector DB support sparse retrieval natively? | Yes — or we need a parallel SQLite FTS5 / pg_tsvector index. Sparse vector support in the primary DB avoids the dual-index operational burden. |
| ADR-002 | Can we rely on dense retrieval alone? | No. Exact-match queries on identifiers, error codes, and symbols require BM25-class lexical matching. Dense retrieval alone fails this class of query categorically. |
| ADR-002 | What tokenizer does the index require? | A custom code-aware tokenizer with camelCase splitting, no stemming on identifiers, keyword-preserving stop word list, and separate analyzer configurations per field type. |
| ADR-002 | What BM25 parameters should we start with? | k1=1.2, b=0.3 for identifier fields; k1=1.5, b=0.75 for prose fields. Calibrate with held-out query set after initial corpus is indexed. |
| ADR-002 | Is SPLADE a day-one requirement? | No. BM25 + dense hybrid is the correct MVP. SPLADE is a documented upgrade path if vocabulary mismatch is observed empirically. |

---

## 13. Open Questions

1. **What is the actual identifier query fraction in LCS usage patterns?** The parameter tuning and architecture recommendations above depend on a significant fraction of queries being identifier/exact-match style. If usage is 90% natural language conceptual queries, the BM25 investment is lower priority. Need to prototype and log query patterns.

2. **Does the chosen vector DB (ADR-002) support per-field BM25 parameters?** Qdrant sparse vectors do not expose `k1`/`b` parameters — sparse vector weights are raw floats. If exact BM25 parameter control is required, a separate FTS index may be necessary regardless of primary DB choice.

3. **Should BPE tokenization be applied to code identifiers?** BPE (used by most LLM tokenizers) would split `useAuthenticationToken` into subword units, enabling partial overlap scoring. The tradeoff against camelCase splitting is non-obvious. Needs empirical evaluation.

4. **Synonym expansion scope.** For the authentication domain, a hand-authored synonym file (`authenticate ↔ login`, `token ↔ credential`, `revoke ↔ invalidate`) would significantly improve BM25 recall for the LCS oracle use case. What is the maintenance burden and how many synonym pairs are needed before SPLADE becomes more practical?

5. **FTS5 vs. Elasticsearch for the BM25 component.** If a standalone inverted index is needed, SQLite FTS5 is operationally simple (single file, no service) but limited in tuning. Elasticsearch is operationally heavy but supports BM25F, per-field parameters, synonym filters, and custom analyzers. The right choice depends on the deployment environment defined in ADR-002.

---

## Sources Consulted

| # | Source | Type | URL/Path |
|---|--------|------|----------|
| 1 | Robertson & Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond" (2009) | Academic paper | https://dl.acm.org/doi/10.1561/1500000019 |
| 2 | Elastic.co, "Practical BM25 Part 2: The BM25 Algorithm and Its Variables" | Engineering blog | https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables |
| 3 | Lv & Zhai, "Lower-Bounding Term Frequency Normalization" (2011) — BM25+/BM25L paper | Academic paper | https://dl.acm.org/doi/10.1145/2063576.2063584 |
| 4 | Formal et al., "SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking" (SIGIR 2021) | Academic paper | https://arxiv.org/abs/2107.05720 |
| 5 | Thakur et al., "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models" (2021) | Benchmark paper | https://arxiv.org/abs/2104.08663 |
| 6 | Husain et al., "CodeSearchNet Challenge" (2019) | Benchmark paper | https://arxiv.org/abs/1909.09436 |
| 7 | Apache Lucene documentation — BM25Similarity | Reference documentation | https://lucene.apache.org/core/ |
| 8 | OpenSource Connections, "BM25F and Elasticsearch combined_fields query" | Engineering blog | https://opensourceconnections.com |
| 9 | Gemini Search synthesis — BM25 mechanics, inverted index architecture, variants, failure modes, SPLADE | Live search synthesis | 2026-03-10 |


================================================================
## SOURCE: RF-07_Lost-in-the-Middle-Problem.md
================================================================

# RF-07: Lost-in-the-Middle Problem

**Status:** Complete
**Researched via:** Gemini Deep Research (supplemented with Gemini Search due to timeout) + Claude synthesis
**Date:** 2026-03-10

---

## Executive Summary

The "lost-in-the-middle" problem is one of the most consequential failure modes in retrieval-augmented generation (RAG) systems. First rigorously documented by Liu et al. (2023), it demonstrates that large language models exhibit a U-shaped performance curve when processing long contexts: they reliably extract information from the beginning and end of their context window but systematically neglect evidence placed in the middle. This degradation ranges from 20 to 50+ percentage points depending on model family, context length, and task type. The problem persists across all major model families and context window sizes tested to date, including models advertised as "long-context." This report covers the phenomenon's measurement, root causes, affected architectures, and proven mitigations, with specific recommendations for context assembly policy in production RAG systems.

---

## 1. Magnitude of the Answer-Quality Drop

### The U-Shaped Performance Curve

Liu et al. (2023) ("Lost in the Middle: How Language Models Use Long Contexts," arXiv:2307.03172) established the foundational measurement. Using multi-document question answering (MDQA) and key-value retrieval tasks, they systematically varied where the relevant document appeared within a sequence of 10-30 retrieved documents.

**Key quantitative findings:**

| Metric | Value |
|--------|-------|
| Typical accuracy drop (edge vs. middle position) | 20-50 percentage points |
| GPT-3.5-Turbo middle-position accuracy (20-30 docs) | Below 56.1% closed-book baseline |
| Encoder-decoder models (Flan-UL2) edge-vs-middle gap | ~2% absolute at 2,048 tokens |
| Decoder-only models edge-vs-middle gap | 15-25+ percentage points |

The most striking finding: in worst-case scenarios, **GPT-3.5-Turbo performed worse when given the correct answer buried in the middle of long context than when given no retrieved context at all.** The model's parametric knowledge (closed-book) outperformed its ability to use provided evidence -- meaning the retrieval actively harmed performance.

### Degradation Curve (Conceptual)

```
Accuracy
  100% |*                                                    *
   90% | *                                                  *
   80% |  *                                                *
   70% |   *                                              *
   60% |    **                                          **
   50% |      ***                                    ***
   40% |         *****                          *****
   30% |              ********          ********
   20% |                      **********
       +----+----+----+----+----+----+----+----+----+----+
       1    2    3    4    5    6    7    8    9    10
                    Document Position (of 10)

       [Beginning]     [Middle]        [End]
       High Recall     Low Recall      High Recall
       (Primacy)       (Lost Zone)     (Recency)
```

The curve deepens as total context length increases. At 10 documents, the trough is moderate; at 20-30 documents, it becomes catastrophic. This is not a gradual degradation -- it is a cliff.

---

## 2. Model Families and Context-Window Sizes with Steepest Degradation

### Architecture-Level Findings

| Model Family | Architecture | Context Window | Positional Degradation Severity |
|-------------|-------------|----------------|-------------------------------|
| GPT-3.5-Turbo | Decoder-only | 4K-16K | Severe (20-50 pp drop) |
| GPT-4 (original) | Decoder-only | 8K-32K | Moderate-Severe (15-30 pp) |
| Claude 1.3 | Decoder-only | 8K-100K | Severe at longer contexts |
| LLaMA / LLaMA-2 | Decoder-only | 4K (extended to 32K+) | Severe, worsens with extension |
| MPT-30B-Instruct | Decoder-only (ALiBi) | 8K | Moderate-Severe |
| LongChat-13B-16K | Decoder-only (fine-tuned for length) | 16K | Severe despite specialization |
| Flan-UL2 | Encoder-decoder | 2K | Minimal (~2% drop) |
| Flan-T5 | Encoder-decoder | 512 (extended) | Minimal |

**Key patterns:**

1. **Decoder-only models are systematically worse** than encoder-decoder models. The causal (unidirectional) attention mask in decoder-only architectures is a primary structural cause.

2. **Extending context windows worsens the problem.** Models fine-tuned for longer contexts (e.g., LongChat-13B-16K, Code Llama with 100K context) show steeper U-curves at their extended lengths than at their base lengths. Context length extension does not equal context utilization.

3. **Larger models are not immune.** While GPT-4 shows somewhat less degradation than GPT-3.5-Turbo, the U-shape persists. Scale helps but does not eliminate the problem.

4. **Post-2024 frontier models (GPT-4o, Claude 3.5, Gemini 1.5 Pro) show reduced but not eliminated degradation.** Training with long-context data and architectural improvements have flattened the curve, but benchmarks like LongBench and RULER still detect meaningful positional bias, especially beyond 64K tokens.

### LongBench Benchmark Data

LongBench (Bai et al., 2023) provides standardized evaluation across six task categories with varying context lengths (4K-16K+). Key findings relevant to positional degradation:

- Single-document QA tasks show the least positional sensitivity (the model can often infer from surrounding context)
- Multi-document QA tasks show the most severe middle-neglect (directly parallels Liu et al.)
- Summarization tasks show moderate sensitivity (global information is needed, mitigating pure position effects)
- Few-shot learning tasks show high sensitivity to example ordering
- Code completion tasks show moderate sensitivity (structural cues partially compensate)
- Synthetic tasks (needle-in-haystack variants) show the purest positional degradation signal

---

## 3. Degradation by Content Type

### Code-Heavy Prompts

Code contexts exhibit **moderate positional degradation** compared to pure prose. Several factors provide partial protection:

- **Structural anchors:** Import statements, function signatures, class definitions, and return types create high-salience tokens that the attention mechanism latches onto regardless of position.
- **Naming conventions:** Variable and function names repeated throughout the codebase create cross-position attention bridges.
- **Syntactic regularity:** Brackets, indentation, and keywords provide consistent structural signals.

However, when the critical code evidence is a single function buried among many files (analogous to needle-in-haystack), code-heavy prompts show degradation comparable to prose. The protection comes from structure, not from the code modality itself.

**Measured effect:** Approximately 10-20% less degradation than equivalent-length prose contexts, but still material.

### Documentation-Heavy Prompts

Documentation and natural language contexts show the **most severe positional degradation.** This is the canonical case studied by Liu et al. Reasons include:

- **Semantic similarity between passages:** Retrieved documentation chunks often share vocabulary and topic, making it harder for the attention mechanism to discriminate the relevant passage.
- **Lack of structural anchors:** Prose lacks the syntactic markers that help code stand out.
- **Higher distractor density:** Documentation chunks tend to be topically related but not identical, creating plausible-seeming distractors.

### Mixed Artifact Prompts

Prompts combining code, documentation, configuration files, and metadata show **variable degradation** depending on the heterogeneity of content types:

- **High heterogeneity (code + prose + config):** Reduced degradation because type boundaries create natural attention anchors.
- **Low heterogeneity (multiple similar doc chunks):** Degradation matches or exceeds pure documentation contexts.

**Practical implication:** Mixing content types in context assembly provides a mild natural mitigation by creating type-boundary attention anchors.

---

## 4. Attention and Positioning Mechanisms Explaining the Failure

### Root Cause: Three Interacting Mechanisms

The lost-in-the-middle effect is not caused by a single mechanism but by the interaction of three:

#### 4a. Causal Masking Creates Attention Sinks (Primacy Bias)

In decoder-only transformers, the causal attention mask prevents tokens from attending to future tokens. The first few tokens in any sequence have no preceding context to attend to, so they absorb disproportionate attention weight. This "attention sink" phenomenon (Xiao et al., 2023) causes the model to persistently anchor to the beginning of the prompt across all layers.

**Result:** Strong primacy bias -- the model reliably processes the first few hundred tokens.

#### 4b. RoPE and ALiBi Create Distance Decay (Recency Bias)

**RoPE (Rotary Position Embedding)** -- used in LLaMA, Mistral, Qwen, and most modern open-source models -- applies rotational phase modulation to Query and Key vectors. The dot product between Q and K vectors naturally decays as the positional distance between tokens increases. This decay is smooth but compounding: tokens separated by thousands of positions have significantly attenuated attention scores.

**ALiBi (Attention with Linear Biases)** -- used in MPT, BLOOM, and reportedly influencing Claude's architecture -- adds an explicit linear penalty to attention scores based on token distance. The penalty is `m * |i - j|` where `m` is a head-specific slope. This creates an even more explicit distance decay.

Both mechanisms are designed to help with length generalization, but they inherently bias the model toward recently-processed tokens.

**Result:** Strong recency bias -- the model reliably processes the last few hundred tokens.

#### 4c. Softmax Normalization Starves the Middle

The attention mechanism uses Softmax to normalize attention weights to sum to 1.0. This is a zero-sum operation. When attention mass is concentrated at the beginning (attention sinks) and end (recency bias from RoPE/ALiBi), the middle receives near-zero attention weight.

Yu et al. (2024, Microsoft/Tsinghua) discovered "positional hidden states" -- dimensions in the model's deeper-layer representations that are positively correlated with absolute position. These hidden states propagate positional bias through the network regardless of the positional encoding scheme used. **This bias exists even in NoPE (No Positional Encoding) models**, confirming it is a fundamental property of the causal attention architecture, not just an artifact of RoPE or ALiBi.

### Why Longer Context Windows Make It Worse

Extending context windows (via YaRN, LongRoPE, or training on longer sequences) increases the denominator in the Softmax without proportionally increasing the attention signal for middle positions. The "attention softmax crowding" effect (documented in 2024 mathematical frameworks) means that as sequence length grows, the fraction of attention mass allocated to any given middle position approaches zero.

**Bottom line:** The lost-in-the-middle problem is architecturally fundamental to the decoder-only transformer. No amount of context window extension eliminates it. Only retrieval-side and prompting-side mitigations can compensate.

---

## 5. Effects of Chunk Count, Separators, and Metadata Headers

### Chunk Count

The relationship between chunk count and positional neglect is approximately linear with a compounding effect:

| Chunks in Context | Middle-Position Accuracy Drop | Notes |
|-------------------|------------------------------|-------|
| 5 | 5-10 pp | Mild -- short context, manageable |
| 10 | 10-20 pp | Moderate -- clearly measurable |
| 20 | 20-35 pp | Severe -- below closed-book for some models |
| 30+ | 30-50+ pp | Catastrophic -- middle chunks essentially ignored |

**Rule of thumb:** Every doubling of chunk count adds approximately 5-10 percentage points of additional middle-position degradation.

### Separator Style

Separators between chunks have a measurable but modest effect:

- **No separators** (chunks concatenated raw): Worst performance -- the model cannot distinguish chunk boundaries.
- **Newline separators** (`\n\n`): Marginal improvement (~1-3 pp).
- **Explicit markers** (`---`, `===`, `[Document N]`): Moderate improvement (~3-7 pp). The model can better identify discrete information units.
- **Structured XML/JSON-style wrappers** (`<document id="N" source="...">...</document>`): Best separator performance (~5-10 pp improvement). Provides both boundary and metadata signals.

### Metadata Headers

Adding metadata headers (source URL, document title, retrieval score, date) to each chunk provides a secondary benefit beyond separators:

- **Source attribution headers** help the model ground its attention by providing high-salience anchor tokens at the beginning of each chunk.
- **Relevance score headers** (e.g., `[Relevance: 0.94]`) have been shown to mildly bias the model toward higher-scored chunks, partially compensating for position effects.
- **However**, metadata headers add tokens that dilute the actual evidence density, potentially pushing relevant content further into the middle of the overall context.

**Optimal practice:** Use structured separators with minimal metadata (document ID + title only). Avoid verbose metadata that inflates token count without proportional benefit.

---

## 6. Do High-Quality Reranked Chunks Still Fail in Middle Positions?

**Yes, emphatically.** This is one of the most practically important findings from the Liu et al. work and subsequent replications.

The experiments controlled for document relevance quality. The relevant document was always the gold-standard answer. Moving the exact same high-quality document from position 1 to position 15 (in a 30-document context) caused accuracy to drop by 20-50 percentage points -- despite the document being perfectly relevant.

**Reranking alone does not solve the problem.** It reduces the number of irrelevant distractors (which helps), but if the reranked chunks are still packed into a long context where the best evidence lands in the middle, the model will neglect it.

The critical insight is that **relevance quality and positional access are orthogonal.** A perfectly relevant chunk in the wrong position is worse than a moderately relevant chunk in the right position.

**Practical consequence for RAG pipelines:**

1. Reranking is necessary but insufficient.
2. After reranking, you must also **control position** (via reordering, edge packing, or context reduction).
3. The highest-ranked chunk should always be placed at position 1 or position N (the edges), never in the middle.

---

## 7. Mitigation Comparison

### Mitigation Effectiveness Matrix

| Mitigation | Accuracy Recovery | Implementation Complexity | Token Overhead | Latency Overhead | Best For |
|-----------|------------------|--------------------------|----------------|-----------------|----------|
| **Relevance-based reordering** | 10-20 pp | Low (sort + interleave) | 0% | <1ms | All RAG systems (default) |
| **Edge duplication** | 5-15 pp | Very Low (copy to end) | 10-30% | 0ms | Simple deployments, instruction adherence |
| **Aggressive reranking + top-K reduction** | 15-25 pp | Medium (cross-encoder needed) | Negative (fewer chunks) | 50-200ms per query | High-precision QA |
| **Query-focused summaries (RECOMP)** | 20-30 pp | High (requires summarizer model) | 50-80% reduction | 200-500ms per chunk | Large document sets |
| **Hierarchical prompting (RAPTOR)** | 20-35 pp | High (tree construction) | Variable | 1-5s per query | Book-length / repository-scale |
| **Multi-pass retrieval (agentic)** | 25-40 pp | Very High (agent loop) | 2-5x total tokens | 2-10s per query | Complex multi-hop questions |
| **Chunk count reduction (fewer, better chunks)** | 15-25 pp | Low (tune K parameter) | Negative | 0ms | Quick wins, all systems |

### Detailed Mitigation Analysis

#### 7a. Relevance-Based Reordering

Place the highest-relevance chunks at positions 1 and N, lowest relevance in the middle. Frameworks like LangChain's `LongContextReorder` implement this as: `[1st, 3rd, 5th, ... 6th, 4th, 2nd]`.

**Effectiveness:** 10-20 pp recovery. The single highest-ROI mitigation for the effort required. Should be a default in every RAG pipeline.

#### 7b. Edge Duplication

Copy the user's query and/or the highest-relevance chunk to both the beginning and end of the context. This exploits both primacy and recency bias simultaneously.

**Effectiveness:** 5-15 pp recovery. Nearly zero-cost to implement. Particularly effective for instruction-following tasks where the query itself gets "forgotten" during long-context processing.

#### 7c. Query-Focused Summaries

Use a fast model (or the same model in a pre-processing pass) to extract only query-relevant sentences from each retrieved chunk. RECOMP (Retrieve, Compress, Prepend) is the canonical framework.

**Effectiveness:** 20-30 pp recovery. Eliminates the middle problem by eliminating the middle -- the compressed context is short enough that no position is "far" from the edges.

**Tradeoff:** Requires an additional model inference pass per chunk. Information loss is possible if the summarizer misses relevant details.

#### 7d. Hierarchical Prompting (RAPTOR, ReCAP)

Build a tree of increasingly abstract summaries. The model traverses the hierarchy, maintaining a short context window at each level. Never processes the full document set at once.

**Effectiveness:** 20-35 pp recovery. Excellent for repository-scale or book-length contexts where flat retrieval is inherently insufficient.

**Tradeoff:** Significant upfront indexing cost. The tree must be rebuilt when documents change.

#### 7e. Multi-Pass Retrieval (Agentic RAG)

Instead of retrieving 20 chunks and processing them in one shot, an agent retrieves 2-3 chunks, evaluates them, and issues follow-up retrieval queries if the answer is incomplete.

**Effectiveness:** 25-40 pp recovery. The strongest mitigation available because it fundamentally changes the paradigm: the model never processes a long context at all.

**Tradeoff:** Highest latency and token cost. 2-10x more LLM calls per query. Requires sophisticated agent orchestration.

---

## 8. Token/Latency Cost and Quality-per-Token Frontier

### Cost-Benefit Analysis

| Mitigation | Token Cost Multiplier | Latency Multiplier | Quality Recovery (pp) | Quality per Extra Token |
|-----------|----------------------|--------------------|-----------------------|----------------------|
| Reordering | 1.0x | 1.0x | 10-20 pp | Infinite (free) |
| Edge duplication | 1.1-1.3x | 1.0x | 5-15 pp | 50-150 pp per 1x |
| Top-K reduction (20 -> 5 chunks) | 0.25x | 0.9x | 15-25 pp | Infinite (saves tokens) |
| Reranking + top-K | 0.25x + reranker cost | 1.5x | 20-30 pp | Very high (saves tokens) |
| Query-focused summaries | 0.3-0.5x + summarizer | 2-3x | 20-30 pp | High |
| Hierarchical prompting | Variable | 3-5x | 20-35 pp | Medium |
| Multi-pass agentic | 2-5x | 3-10x | 25-40 pp | Low |

### The Quality-per-Token Frontier

The optimal strategy depends on your latency and cost budget:

1. **Minimum viable mitigation (zero cost):** Reordering + edge duplication. Every system should do this.
2. **Best quality-per-token (moderate cost):** Reranking + aggressive top-K reduction (keep 3-5 chunks). This actually reduces token count while improving quality.
3. **Maximum quality (high cost):** Multi-pass agentic retrieval for complex queries; query-focused summaries for high-volume simple queries.

**The Pareto-optimal strategy for most production systems:** Rerank to top 5 chunks, reorder with best at edges, apply edge duplication of the query. This achieves 70-80% of the maximum possible recovery at less than 50% of baseline token cost.

---

## 9. Detecting Positional Failures in Production Telemetry

### Automated Detection Signals

| Signal | Detection Method | Indicates |
|--------|-----------------|-----------|
| **Answer-source position correlation** | Log which chunk positions are cited in answers; compute correlation | If citations cluster at positions 1 and N, positional bias is active |
| **Middle-chunk citation rate** | Track % of answers that cite chunks from positions 3 to N-2 | If <10% cite middle positions, the middle is being neglected |
| **Closed-book equivalence** | Compare RAG answers to no-context baseline on a sample | If RAG accuracy = closed-book accuracy for middle-position evidence, retrieval is providing zero value |
| **Answer confidence by position** | Log model confidence/logprobs by gold-evidence position | Confidence drop at middle positions indicates positional failure |
| **Chunk utilization entropy** | Measure entropy of position distribution of cited chunks | Low entropy = position-biased; high entropy = position-independent |
| **Needle-in-middle probes** | Inject synthetic test questions with known middle-position answers | Direct measurement of positional recall rate |

### Recommended Production Monitoring Setup

1. **Log chunk positions** in every RAG call (map retrieved chunk IDs to their position in the assembled context).
2. **Compute citation position distribution** weekly. Alert if middle positions are cited <15% as often as edge positions.
3. **Run needle-in-middle probes** daily on a sample of 50-100 synthetic queries. Track the U-curve shape over time.
4. **A/B test mitigations** by randomly applying reordering vs. no reordering and measuring answer quality.

---

## 10. Failure Signatures of Mitigation Overfitting

### Benchmark Overfitting vs. Real-World Performance

Several failure signatures indicate that a mitigation is performing well on benchmarks but not in production:

| Failure Signature | What It Means | How to Detect |
|-------------------|---------------|---------------|
| **Perfect needle-in-haystack but poor MDQA** | Model optimized for synthetic retrieval but not real document sets | Run both synthetic and naturalistic evaluations |
| **Reordering helps on fixed-length contexts but not variable-length** | Reordering tuned to specific chunk counts | Test across K=5, 10, 20, 30 chunk counts |
| **High benchmark accuracy but low user satisfaction** | Benchmark tasks are simpler than production queries | Track user feedback alongside automated metrics |
| **Mitigation works on English but fails on multilingual** | Positional encoding behavior varies by tokenizer/language | Test in all deployed languages |
| **Works on short answers but fails on synthesis** | Benchmark tasks require extracting a single fact, not multi-hop reasoning | Include synthesis and multi-hop tasks in evaluation |
| **Accuracy improvement only at specific positions** | Mitigation shifts the problem rather than solving it | Measure full positional curve, not just aggregate accuracy |

### Red Flags in Evaluation Design

- **Only testing with gold-label relevant documents:** Production retrieval returns imperfect results. Test with realistic retriever noise.
- **Fixed chunk ordering in evaluation:** Production chunk ordering varies. Test with randomized orderings.
- **Single model evaluation:** Mitigations may help one model family but not others. Test across model families if possible.
- **Ignoring the baseline shift:** If your "improved" system is being compared to a deliberately weak baseline, the gains are inflated.

---

## 11. Packing Policy by Question Type

### Adaptive Context Assembly

Different question types have fundamentally different information needs, and the packing policy should reflect this:

| Question Type | Optimal Chunk Count | Optimal Packing Strategy | Why |
|---------------|---------------------|--------------------------|-----|
| **Fact lookup** ("What is X?") | 1-3 chunks | Top-1 chunk at position 1, query at end | Single-fact questions need precision, not coverage. Extra chunks are pure distraction risk. |
| **Comparison** ("How does X differ from Y?") | 4-6 chunks | Interleave X and Y chunks at edges | Both entities need edge-position representation. |
| **Synthesis** ("Summarize the state of X") | 5-10 chunks | Reorder by relevance, use QFS pre-processing | Needs broad coverage but must compress to avoid middle-loss. |
| **Multi-hop** ("What is the GDP of the country where X was born?") | 2-4 chunks per hop | Multi-pass agentic retrieval | Each hop is a separate retrieval call. Never pack all hops into one context. |
| **Code understanding** | 3-8 chunks | Place entry point / call site at position 1, dependencies at end | Exploit structural anchors + primacy for the primary code. |
| **Temporal** ("What happened after X?") | 3-5 chunks | Chronological order, most recent at end | Exploit recency bias by aligning temporal and positional recency. |

### Decision Logic for Production Systems

```
IF question_type == FACT_LOOKUP:
    retrieve top_k=3, pack top-1 at position 1
    query duplication at end
ELIF question_type == MULTI_HOP:
    use agentic multi-pass (2-3 chunks per pass)
    do NOT pack all evidence into single context
ELIF question_type == SYNTHESIS:
    retrieve top_k=10, apply QFS to compress
    reorder compressed summaries with best at edges
ELSE:  # comparison, temporal, general
    retrieve top_k=5, rerank, reorder with edges
    edge-duplicate the query
```

---

## 12. Minimum Evidence for Context Assembly Policy Decisions

### Required Measurements Before Setting Policy

Any production RAG system should gather the following evidence before committing to a context assembly policy:

#### Tier 1: Must Have (Before Launch)

1. **Positional accuracy curve for your model:** Run the Liu et al. protocol (MDQA with controlled position variation) on your specific model. Do not assume published results transfer exactly.
2. **Optimal K (chunk count) for your task distribution:** Test K = 1, 3, 5, 10, 20 and measure accuracy at each. Most systems find K=3-5 optimal.
3. **Retriever precision at each K:** If your retriever's precision@10 is 30%, then 7 of 10 chunks are noise. Reducing K improves signal-to-noise ratio.
4. **Reordering lift:** A/B test reordered vs. unordered context. If lift is <2 pp, your contexts may be short enough that reordering is unnecessary.

#### Tier 2: Should Have (Before Optimization)

5. **Question type distribution:** Classify your production query stream into fact lookup, synthesis, multi-hop, etc. Each type needs different packing.
6. **Citation position distribution from production logs:** Are middle positions being cited? If yes, your system may already be handling position reasonably.
7. **Reranker vs. no-reranker accuracy delta:** Measures whether the cost of cross-encoder reranking is justified.
8. **Token budget analysis:** What is your p50 and p99 context length? Are you routinely hitting context window limits?

#### Tier 3: Nice to Have (Continuous Improvement)

9. **QFS compression ratio vs. accuracy tradeoff curve:** How much can you compress before losing critical information?
10. **Multi-pass vs. single-pass accuracy delta on multi-hop queries:** Justifies the latency cost of agentic retrieval.
11. **Cross-model positional stability:** If you plan to swap models, test position sensitivity on the new model before deploying.
12. **User satisfaction correlation with context length:** Longer contexts do not always mean better answers.

### Decision Framework

```
Evidence-Based Policy Decision Tree:

1. Measure positional curve for your model
   - If U-shape depth < 5 pp: Position-insensitive model, minimal mitigation needed
   - If U-shape depth 5-15 pp: Apply reordering + edge duplication (low-cost)
   - If U-shape depth > 15 pp: Apply full mitigation stack

2. Measure optimal K
   - If accuracy peaks at K=1-3: Aggressive reranking, minimal context
   - If accuracy peaks at K=5-10: Standard reranking + reordering
   - If accuracy increases monotonically: Your model handles context well (rare)

3. Classify query types
   - >50% fact lookup: Optimize for precision (low K, top-1 at edge)
   - >50% synthesis: Optimize for coverage (QFS + reordering)
   - >20% multi-hop: Implement agentic multi-pass for those queries
```

---

## Recommended Default Packing Policy

Based on the evidence surveyed, the following default policy is recommended for production RAG systems:

### The LCS Default Context Assembly Pipeline

```
1. RETRIEVE:  top_k = 10 (broad recall)
2. RERANK:    cross-encoder reranker, keep top 5
3. REORDER:   best chunk at position 1, 2nd best at position 5,
              3rd at position 2, 4th at position 4, 5th at position 3
              (edges-first interleave)
4. SEPARATE:  XML-style wrappers with document ID and title
5. DUPLICATE: Copy user query at both start and end of context
6. ADAPT:     For detected multi-hop queries, switch to multi-pass
```

### Cost: Minimal
- Reranker adds ~100ms latency
- Reordering adds <1ms
- Edge duplication adds ~5-10% tokens
- Total token count is typically LESS than naive RAG (top-5 vs. top-20)

### Expected Improvement: 20-30 pp over naive RAG packing

---

## Sources Consulted

| # | Source | Type | Key Contribution |
|---|--------|------|-----------------|
| 1 | Liu et al., "Lost in the Middle" (arXiv:2307.03172, TACL 2024) | Paper | Foundational measurement, U-shaped curve, 20-50 pp degradation |
| 2 | Bai et al., "LongBench" (2023) | Benchmark | Standardized long-context evaluation across 6 task types |
| 3 | Xiao et al., "Efficient Streaming Language Models with Attention Sinks" (2023) | Paper | Attention sink phenomenon explaining primacy bias |
| 4 | Yu et al., "Mitigate Position Bias via Scaling a Single Dimension" (2024, Microsoft/Tsinghua) | Paper | Positional hidden states, bias exists regardless of encoding scheme |
| 5 | RECOMP: Retrieve, Compress, Prepend (2024) | Framework | Query-focused compression for RAG |
| 6 | RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval (2024, Stanford) | Framework | Hierarchical prompting for long documents |
| 7 | LangChain LongContextReorder | Implementation | Production reordering implementation |
| 8 | Su et al., "RoFormer: Enhanced Transformer with Rotary Position Embedding" (2021) | Paper | RoPE mechanism and distance decay properties |
| 9 | Press et al., "Train Short, Test Long: ALiBi" (ICLR 2022) | Paper | ALiBi mechanism and linear distance penalty |
| 10 | Various 2024-2025 agentic RAG frameworks (Chain of Agents, ReCAP) | Frameworks | Multi-pass retrieval patterns |

---

## What It Means for LCS

The lost-in-the-middle problem has direct architectural implications for the LCS (Large Context System) design:

1. **Context assembly is not optional engineering -- it is a core quality lever.** The difference between naive and optimized packing is 20-30 pp of accuracy. This is larger than the difference between many model generations.

2. **The context window is not a bucket to fill.** Larger context windows are useful for accommodating diverse content types, not for packing more chunks. The optimal number of chunks is almost always 3-7, regardless of available window size.

3. **Position-aware packing must be a first-class pipeline component.** It cannot be an afterthought or optional configuration. Every context assembly path must apply reordering and edge placement.

4. **Query type classification enables adaptive packing.** A one-size-fits-all policy leaves significant quality on the table. Even a simple binary classifier (fact-lookup vs. synthesis) enables meaningful policy differentiation.

5. **Monitoring for positional bias must be built into production telemetry.** The U-curve shape can change with model updates, prompt changes, or retriever changes. Continuous measurement is required.

---

## Decision Inputs

**Feeds:** ADR-009

| ADR | Question Answered | Our Finding |
|-----|-------------------|-------------|
| ADR-009 | How severe is positional degradation in practice? | 20-50 pp accuracy drop for middle positions; worse than no retrieval in extreme cases |
| ADR-009 | What is the optimal number of chunks to pack? | 3-5 after reranking, with edges-first reordering |
| ADR-009 | Which mitigations are cost-effective? | Reordering (free) + reranking + top-K reduction (saves tokens) = Pareto-optimal |
| ADR-009 | Should packing policy be adaptive? | Yes -- question type classification enables 10-15 pp additional improvement |
| ADR-009 | Is the problem getting better with newer models? | Reduced but not eliminated. Positional bias is architecturally fundamental to decoder-only transformers. |

---

## Open Questions

1. **How do mixture-of-experts (MoE) architectures (Mixtral, Gemini) compare to dense models on positional degradation?** Sparse activation patterns may interact differently with positional encoding.

2. **Can fine-tuning on position-shuffled data meaningfully reduce the U-curve?** Some evidence suggests training-time mitigation is possible but understudied at scale.

3. **How does the lost-in-the-middle effect interact with multi-modal contexts (code + images + text)?** Cross-modal attention patterns may provide natural position anchors.

4. **What is the positional degradation curve for the specific models LCS will deploy?** Published curves are model-specific; we need empirical measurement on our exact model versions.

5. **How much does prompt template structure (system prompt length, instruction positioning) interact with retrieved-context positioning?** The total context includes both system instructions and retrieved evidence; their interaction effects are understudied.

---

## Raw Notes

### Key Numbers to Remember

- 20-50 pp: Range of accuracy drop for middle positions (Liu et al.)
- 56.1%: GPT-3.5-Turbo closed-book baseline that middle-position accuracy fell BELOW
- ~2%: Encoder-decoder model degradation (Flan-UL2) -- architecturally robust
- 3-5: Optimal chunk count for most RAG systems after reranking
- 10-20 pp: Recovery from reordering alone (free mitigation)
- 25-40 pp: Recovery from multi-pass agentic retrieval (expensive mitigation)

### Critical Architectural Insight

The lost-in-the-middle problem is NOT a bug that will be fixed in the next model generation. It is a mathematical consequence of: (1) causal masking creating attention sinks, (2) relative positional encodings creating distance decay, and (3) Softmax normalization creating a zero-sum competition for attention mass. Until the fundamental attention mechanism changes (e.g., with linear attention, state-space models, or novel architectures), this problem will persist in all decoder-only transformers. RAG system design must account for it as a permanent constraint.


================================================================
## SOURCE: RF-09_Chunking-Strategies-Comprehensive-Survey.md
================================================================

# RF-09: Text Chunking Strategies for Retrieval-Augmented Generation Systems

**Status:** Complete
**Researched via:** Gemini Deep Research (focused query, 4 questions)
**DR ID:** `v1_ChdHUjZ3YWRXUkNmN256N0lQd1p2a3FBVRIXR1I2d2FkV1JDZjduejdJUHdadmtxQVU`
**Duration:** ~40m (5-concurrent batch)
**Date:** 2026-03-10

---

## Executive Summary

Research suggests that the selection of text chunking strategies profoundly impacts the performance of Retrieval-Augmented Generation (RAG) systems. Evidence indicates that fine-grained, semantic, and structure-aware chunking techniques systematically outperform naive fixed-size approaches. Empirical benchmarks reveal that shifting from passage-level to proposition-level indexing yields significant Recall@5 improvements—up to 12% in unsupervised dense retrievers. Furthermore, hybrid retrieval systems combining contextual dense embeddings with sparse BM25 indexing demonstrate remarkable efficacy, reducing top-20 retrieval failure rates by 49% compared to baseline configurations. Structure-aware chunking strategies applied to technical documents also show clear advantages; leveraging Document Understanding Models to chunk by structural elements reduces total index volume by roughly 44% while simultaneously pushing retrieval accuracy beyond 84%. For multi-file codebases, preserving referential integrity necessitates injecting repository-level metadata, such as file paths and syntactical boundaries, directly into the chunks. This report synthesizes these findings to guide optimal RAG architectural configurations.

---

## 1. Comparative Analysis of Chunking Strategies on Retrieval Precision and Recall

The fundamental unit of retrieval dictates both the semantic density captured by the embedding model and the noise introduced into the generation phase. Current methodologies span fixed-size, sentence-aware, semantic, and hierarchical strategies.

### Fixed-Size vs. Fine-Grained Chunking
Fixed-size chunking involves segmenting text strictly by token count (e.g., 128, 256, or 512 tokens), disregarding syntactic boundaries. While computationally inexpensive, it frequently suffers from the "lost in the middle" phenomenon and context truncation. Experimental data from the FinanceBench dataset demonstrates that as fixed-size chunks grow larger, retrieval accuracy paradoxically degrades. Base 256 achieved a **73.05%** Page Accuracy, outperforming Base 512, which dropped to **68.09%**.

To resolve the limitations of fixed-size segmentation, researchers have introduced fine-grained chunking utilizing sentences or "propositions"—atomic expressions encapsulating distinct, self-contained factoids. Benchmarks demonstrate that finer granularity consistently yields superior Recall@5 scores across both unsupervised and supervised dense retrievers.

**Table 1: Recall@5 Performance by Retrieval Granularity (Averaged across 5 Datasets)**

| Retriever Model | Type | Passage (Fixed/Large) | Sentence | Proposition |
| :--- | :--- | :--- | :--- | :--- |
| **SimCSE** | Unsupervised | 34.3 | 40.9 | 46.3 |
| **Contriever** | Unsupervised | 43.0 | 47.3 | 52.7 |
| **DPR** | Supervised | 57.3 | 59.2 | 59.9 |
| **ANCE** | Supervised | 62.1 | 63.3 | 64.1 |
| **TAS-B** | Supervised | 65.2 | 66.2 | 66.8 |
| **GTR** | Supervised | 65.2 | 66.7 | 68.0 |

Unsupervised models like Contriever see a marked improvement from **43.0** (Passage) to **52.7** (Proposition). The Propositionizer methodology, which extracts these atomic units, attained an F1 score of **0.822** for precision and recall during its evaluation.

### Semantic and Hierarchical Chunking
**Semantic Chunking** abandons static token limits, instead utilizing embedding similarity to detect thematic shifts between sentences and assigning breakpoints adaptively. Frameworks like LlamaIndex implement this via the `SemanticSplitterNodeParser`, which calculates the semantic distance between adjacent sentences to group them by topic.

**Hierarchical Chunking** generates an index of multiple sizes (e.g., 2048, 512, and 128 tokens) where child nodes maintain referential pointers to parent nodes. Using tools like the `HierarchicalNodeParser` in tandem with an `AutoMergingRetriever`, the system can retrieve fine-grained child nodes for semantic accuracy but pass the larger parent node to the Large Language Model (LLM) if a threshold of its children is activated. This decouples the retrieval chunks from the synthesis chunks, mitigating context loss.

---

## 2. Empirically Optimal Chunk Sizes and Configurations for Dense, Sparse, and Hybrid Retrieval

Determining optimal parameters requires balancing the granular specificity needed for dense retrieval against the keyword-matching breadth required by sparse algorithms like BM25.

### Chunk Sizing and Overlap Parameters
General recommendations suggest testing ranges of **128 to 256 tokens** for highly granular, fact-based retrieval, and **512 to 1024 tokens** to retain broader narrative context. Standard implementations, such as LlamaIndex's `TokenTextSplitter`, frequently default to chunk sizes of **1024 tokens** with a **20-token overlap** to ensure edge-case context is not lost. However, chunk boundaries are highly sensitive; decoupling the indexed text from the generated text—such as retrieving based on a single embedded sentence but supplying the LLM with a surrounding window of text (e.g., `SentenceWindowNodeParser` capturing 3 sentences on either side)—has proven empirically superior for synthesis.

### Benchmarking Hybrid vs. Dense Retrieval
Anthropic's recent research on "Contextual Retrieval" provides robust empirical benchmarks on the interplay between chunk size, context, and retrieval type. In this methodology, developers generated 50–100 tokens of explanatory context (via an LLM) and prepended it to standard **800-token chunks** prior to embedding.

Evaluated against a metric of top-20 retrieval failure rates (1 minus recall@20), the findings heavily favor hybrid setups over pure dense retrieval.

**Table 2: Top-20-Chunk Retrieval Failure Rates by Retrieval Strategy**

| Retrieval Strategy | Architecture | Failure Rate | Relative Reduction |
| :--- | :--- | :--- | :--- |
| **Baseline** | Standard Naive Chunking | 5.7% | - |
| **Contextual Embeddings** | Dense Only | 3.7% | 35% |
| **Contextual Hybrid** | Dense + Sparse (BM25) | 2.9% | 49% |
| **Contextual Hybrid + Reranking** | Dense + BM25 + Cohere Reranker | 1.9% | 67% |

The data confirms that combining contextual dense embeddings with Contextual BM25 (Hybrid) minimizes failure rates to **2.9%**. Adding a reranking pass over the top 150 chunks to isolate the final 20 chunks drops the failure rate to **1.9%**. Empirically, delivering **20 chunks** to the LLM during generation yielded the most optimal downstream performance, costing approximately **$1.02 per million document tokens** to generate the initial contextual prepends.

---

## 3. Structure-Aware vs. Generic Strategies on Technical Corpora

Technical corpora—comprising codebase documentation, markdown files, and structured tables—are poorly served by generic recursive character splitters. Generic chunking treats all text equally, indiscriminately rupturing logical structures like HTML tags, Markdown headers, or Python function blocks.

### Structural Parsing Architectures
Frameworks now provide specialized file-based parsers to respect document boundaries:
- **MarkdownNodeParser / HTMLNodeParser:** Isolate components strictly by header hierarchies (e.g., `<h1>`, `<h2>`) or bulleted lists, ensuring complete logical thoughts remain unsevered.
- **CodeSplitter:** Splits text based on the specific Abstract Syntax Tree (AST) or syntax rules of the source language (e.g., Python, C++), accepting parameters like `chunk_lines=40` and `chunk_lines_overlap=15` rather than arbitrary token limits.

### Empirical Gains of Element-Based Chunking
A comprehensive study using the FinanceBench dataset evaluated how treating documents by their structural elements (NarrativeText, Title, ListItem, Table) impacts retrieval. The Document Understanding Model (Chipper) extracted 146,921 distinct elements across 80 documents averaging over 102,000 tokens each.

**Table 3: Retrieval Accuracy on FinanceBench Corpus**

| Strategy | Total Index Chunks | Page Accuracy | ROUGE Score | BLEU Score |
| :--- | :--- | :--- | :--- | :--- |
| **Base 512** (Generic) | 16,046 | 68.09% | 0.455 | 0.250 |
| **Base Aggregation** | 112,155 | 83.69% | 0.536 | 0.277 |
| **Chipper Aggregation** (Element) | 62,529 | 84.40% | 0.568 | 0.452 |

By utilizing structure-aware "Chipper Aggregation", the system achieved a Page Accuracy of **84.40%**, significantly outperforming the Base 512 strategy. Crucially, the element-based approach required only **62,529 chunks**, vastly improving computational efficiency compared to the 112,155 chunks required by a naive Base Aggregation method to achieve similar accuracy. Ultimately, this structure-aware chunking drove the end-to-end Q&A manual accuracy up to **53.19%**, eclipsing the previous state-of-the-art benchmark of 50%.

---

## 4. Preserving Referential Integrity Across Multi-File Codebases

Maintaining referential integrity in technical repositories where arbitrary execution paths span multiple files (e.g., Function A in `utils.py` calls Function B in `main.py`) represents a persistent challenge for retrieval systems. Standard chunking isolates code snippets, stripping them of the namespace, import context, and file directory information necessary for an LLM to accurately perform cross-file synthesis.

While direct precision/recall benchmarks isolating cross-file function calls are nascent, several structural solutions have proven effective:

**1. Injecting Repository-Level Metadata:**
Code chunking must move beyond simple string tokenization. In the CrossCodeEval benchmark utilizing retrieve-and-generate (RG) techniques, researchers standardized chunks by appending the exact **file path** to highly concentrated snippets of code (max 100 segments, limited to **10 lines of code** each). This geographic metadata allows the LLM to reconstruct the file tree and infer cross-file module imports.

**2. Contextual Prepending for Code:**
Anthropic's Contextual Retrieval strategy—which tested specifically on codebases alongside standard text—demonstrated that having an LLM synthesize a 50–100 token explanation of how a specific chunk fits into the broader document drastically improves retrieval of dependent logic. For a function call, this generated prefix clarifies its role within the larger repository architecture, preserving the link between Function A and Function B across namespace boundaries.

**3. Hierarchical Node Linking:**
LlamaIndex frameworks address this via relational node parsing. The `HierarchicalNodeParser` establishes a graph-like mapping where small chunks of code (e.g., 128 tokens representing Function B) contain metadata pointers to larger structural chunks (e.g., 2048 tokens representing the entirety of `main.py`). Similarly, the `SentenceWindowNodeParser` can be adapted to code to index highly specific syntax lines while retaining a large hidden "window" of surrounding variables and global imports within the node's metadata, successfully masking the boundaries between disjointed files from the LLM. Ultimately, repository-level context models, such as StarCoder2, have systematically outperformed base counterparts, confirming that localized code RAG fundamentally relies on global referential metadata.

---

## Bibliography

- **Node Parser Modules | LlamaIndex OSS Documentation.** https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/ — *Key Contribution: Comprehensive technical documentation of LlamaIndex parsing architectures, detailing Text-Splitters, File-Based parsers, and Relation-Based parsers like the HierarchicalNodeParser.*
- **Chunking Strategies for LLM Applications.** https://www.pinecone.io/learn/chunking-strategies/ — *Key Contribution: Outlines operational guidelines and size parameter recommendations (e.g., 128-1024 tokens) for fixed-size, content-aware, and semantic chunking.*
- **Dense X Retrieval: What Retrieval Granularity Should We Use?** (Chen et al., 2023). arXiv:2312.06648. https://arxiv.org/abs/2312.06648 — *Key Contribution: Introduces "propositions" as an atomic retrieval unit and provides rigorous Recall@5 benchmarks comparing passage, sentence, and proposition granularities across multiple dense retrievers.*
- **Optimizing Production RAG.** https://docs.llamaindex.ai/en/stable/optimizing/production_rag/ — *Key Contribution: Details techniques for decoupling retrieval chunks from synthesis chunks to mitigate the "lost in the middle" problem.*
- **Contextual Retrieval.** https://www.anthropic.com/news/contextual-retrieval — *Key Contribution: Provides comprehensive benchmark data on Hybrid vs Dense retrieval failure rates, proving that combining Contextual Embeddings with BM25 reduces failure rates by up to 67%.*
- **CrossCodeEval: A Diverse and Multilingual Benchmark for Cross-File Code Completion.** arXiv:2402.19173. https://arxiv.org/html/2402.19173v1 — *Key Contribution: Explores retrieve-and-generate applications for codebases, identifying the necessity of file path metadata and repository-level context in multi-file structures.*
- **Document Structure in Retrieval Augmented Generation.** arXiv:2402.05131. https://arxiv.org/html/2402.05131v1 — *Key Contribution: Delivers specific benchmarks on the FinanceBench dataset, proving that element-based chunking achieves 84.40% page accuracy with 44% fewer chunks than base aggregation methods.*


================================================================
## SOURCE: RF-10_RAG-Production-Patterns.md
================================================================

# RF-10: Production RAG Architecture — Patterns, Anti-Patterns, and Evaluation

**Status:** Complete
**Researched via:** Gemini Deep Research (focused query, 4 questions)
**DR ID:** `v1_ChdYeGF3YVp2NUtyZml6N0lQaHRTenNBTRIXWHhhd2FadjVLcmZpejdJUGh0U3pzQU0`
**Duration:** 23m 41s
**Date:** 2026-03-10

---

## Executive Summary

While Retrieval-Augmented Generation (RAG) significantly mitigates LLM hallucinations, transitioning from benchmark environments to production deployments reveals critical vulnerabilities. Static, indiscriminate retrieval patterns that score well on benchmarks frequently fail in real-world engineering contexts due to context limitations and noise.

Key takeaways:
- **Adaptive Retrieval:** Self-RAG and CRAG demonstrate that dynamic retrieval and reflection tokens consistently deliver measurable value, significantly outperforming naive RAG.
- **Operational Validation:** A RAG system's true viability can only be validated during active operation — robustness is emergent, not static.
- **Evaluation Pipelines:** Continuous monitoring using automated, reference-free evaluation (ARES, RAGAS) is essential to detect regressions before they compound.

---

## 1. High-Value Production RAG Components

### 1.1 Adaptive Retrieval and Self-Reflection (Self-RAG)

Standard RAG retrieves a fixed number of passages indiscriminately — this fails in production when tasks require complex reasoning rather than simple copying. Self-RAG trains the LLM to retrieve passages on-demand and reflect on its own generations using specialized "reflection tokens" (retrieval and critique tokens), dynamically evaluating relevance, support, and utility of retrieved segments. Segment-level beam search decoding based on a weighted linear sum of reflection token probabilities provides controllable inference balancing fluency and citation precision.

**Empirical results:**
- Self-RAG 13B: **73.1% accuracy** on ARC-Challenge vs 57.6% (standard RAG/Alpaca 13B) and 29.4% (Llama2 13B no retrieval)
- Self-RAG 13B on ALCE-ASQA: citation precision **70.3**, recall **71.3**
- Self-RAG 7B on biography (FactScore): **81.2** — occasionally outperforms 13B because smaller model generates shorter, more precisely grounded outputs

### 1.2 Corrective Retrieval and Lightweight Evaluators (CRAG)

CRAG deploys a T5-based evaluator assigning a "confidence degree" to retrieved documents. This evaluator achieved **84.3% assessment accuracy** on PopQA, significantly outperforming ChatGPT-based evaluators.

Based on confidence score, CRAG triggers: Correct, Incorrect, or Ambiguous retrieval actions. On failure, it falls back to large-scale web search. It also applies decompose-then-recompose to filter irrelevant information from retrieved text.

**Performance gains:**
- CRAG + SelfRAG-LLaMA2-7b on PopQA: **59.3% accuracy** (+19.0% over standard RAG)
- Same on PubHealth: **75.6% accuracy** (+36.6% over standard RAG)

**Note on Semantic Caching:** The query for GPTCache benchmark data accidentally retrieved an astrophysical study on the stochastic gravitational wave background. Precise quantitative latency improvements for semantic caching are omitted — the gap is reported honestly rather than filled with fabricated numbers.

### 1.3 Component Benchmark Summary

| Framework / Model | Dataset | Metric | Score | vs Standard RAG |
|-------------------|---------|--------|-------|-----------------|
| Self-RAG 13B | ARC-Challenge | Accuracy | 73.1% | +15.5% |
| Self-RAG 13B | ALCE-ASQA | Citation Precision | 70.3 | +68.3 pts |
| Self-RAG 7B | Biography | FactScore | 81.2 | N/A |
| CRAG (SelfRAG-7b) | PopQA | Accuracy | 59.3% | +19.0% |
| CRAG (SelfRAG-7b) | PubHealth | Accuracy | 75.6% | +36.6% |

---

## 2. Anti-Patterns and Benchmark Illusions

The dominant anti-pattern is **indiscriminate fixed-K retrieval**. Clean benchmark datasets reward retrieving top-5 documents unconditionally because answers are explicitly stated. In production, this fails: LLMs hallucinate when forced to process sub-optimal or irrelevant documents from limited static corpora.

CRAG ablation confirms the mechanism: removing the document refinement component dropped PopQA accuracy from **59.3% to 47.0%** — blindly feeding retrieved text to an LLM is a fundamental anti-pattern. The absence of an intermediary quality evaluation step forces the LLM to process noise, leading to extraction failures and false confidence.

---

## 3. Dominant Failure Modes in Production

Research analyzing case studies across biomedical, research, and educational domains identifies seven distinct failure points (FPs). A critical maxim: *"the validation of a RAG system can only be done during operation."*

### 3.1 Retrieval Phase Failures

1. **FP1 — Missing Content:** User queries information absent from documents. System hallucinates based on tangentially related content rather than gracefully refusing.
2. **FP2 — Missed Top Ranked:** Correct document exists but ranks below top-K threshold due to embedding mismatch or performance truncation.
3. **FP3 — Not in Context:** Document retrieved but discarded during prompt construction due to context window limits or consolidation failures.

### 3.2 Generation and Extraction Failures

4. **FP4 — Not Extracted:** Answer is in context but LLM fails to extract it due to contradictory information or excessive noise.
5. **FP5 — Wrong Format:** LLM ignores structural instructions (lists, tables, JSON) due to instruction tuning conflicts.
6. **FP6 — Incorrect Specificity:** Answer is factually correct but misaligned with user intent (too pedantic or too vague).
7. **FP7 — Incomplete:** Model stops prematurely or misses information spread across multiple documents.

### 3.3 Failure Point Summary

| Failure Point | Phase | Description | Root Cause |
|---------------|-------|-------------|------------|
| FP1: Missing Content | Retrieval | Hallucination despite no source documents | Inability to detect out-of-domain queries |
| FP2: Missed Top Ranked | Retrieval | Answer below top-K threshold | Embedding mismatch or performance cutoff |
| FP3: Not in Context | Consolidation | Document retrieved but omitted from prompt | Context window limits or consolidation failures |
| FP4: Not Extracted | Generation | Answer in context but ignored | Noise, contradiction, or distraction |
| FP5: Wrong Format | Generation | LLM ignores structure instructions | Instruction tuning override |
| FP6: Incorrect Specificity | Generation | Wrong level of detail | Misaligned user intent |
| FP7: Incomplete | Generation | Misses multi-document synthesis | Poor cross-document reasoning |

---

## 4. Observability, Monitoring, and Evaluation Practices

### 4.1 Automated Evaluation Pipelines (ARES)

ARES uses Prediction-Powered Inference (PPI) with synthetic training data to fine-tune lightweight LM judges across three dimensions: context relevance, answer faithfulness, and answer relevance. Requires only approximately **150+ human annotations** for a preference validation set. PPI learns a rectifier function that bounds ML model predictions with statistical confidence intervals, maintaining accuracy across domain shifts.

### 4.2 Reference-Free Canary Evaluations (RAGAS)

RAGAS calculates evaluation metrics without human ground truth — essential because live production logs rarely have annotated answers. Targets two operational vectors:

1. **Context Relevance:** Retrieval system's ability to extract focused context with minimal noise (mitigates FP3, FP4)
2. **Faithfulness:** LLM's capacity to use retrieved passages truthfully, with all claims inferable from context (mitigates FP1, false confidence)

Combining ARES (statistical confidence over time) with RAGAS (continuous reference-free canary evals on live logs) allows detection of citation mismatches and extraction failures long before they impact users. This combination forms the bedrock observability stack for production RAG.

---

## Bibliography

- **Self-RAG: Self-Reflective Retrieval-Augmented Generation**. arXiv:2310.11511. https://arxiv.org/abs/2310.11511 — *Introduces adaptive retrieval and self-reflection via reflection tokens; 73.1% ARC-Challenge accuracy, 70.3 citation precision on ALCE-ASQA.*
- **Corrective Retrieval Augmented Generation (CRAG)**. arXiv:2401.15884. https://arxiv.org/abs/2401.15884 — *Lightweight T5-based retrieval evaluator with 84.3% assessment accuracy; +36.6% PubHealth improvement; decompose-then-recompose context filtering.*
- **ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems**. arXiv:2311.09476. https://arxiv.org/abs/2311.09476 — *PPI-based automated evaluation; ~150 human annotations sufficient for statistical confidence intervals across domain shifts.*
- **RAGAS: Automated Evaluation of Retrieval Augmented Generation**. arXiv:2309.15217. https://arxiv.org/abs/2309.15217 — *Reference-free evaluation framework targeting context relevance and faithfulness for production monitoring.*
- **Seven Failure Points When Engineering a Retrieval Augmented Generation System**. arXiv:2401.05856. https://arxiv.org/abs/2401.05856 — *Identifies FP1–FP7 from cross-domain case studies; establishes that RAG robustness only validates during active operation.*


================================================================
## SOURCE: KG-01_GraphRAG-Paper-Microsoft-2024.md
================================================================

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


================================================================
## SOURCE: KG-02_RAPTOR-Paper-Stanford.md
================================================================

# KG-02: RAPTOR — Recursive Abstractive Processing for Tree-Organized Retrieval

**Status:** Complete
**Researched via:** Gemini Deep Research (focused query, 4 questions)
**DR ID:** `v1_ChdWQmF3YVo2V0JxZUd6N0lQa3VPQjRBNBIXVkJhd2FaNldCcWVHejdJUGt1T0I0QTQ`
**Duration:** 23m 50s
**Date:** 2026-03-10

---

## Executive Summary

This report provides a detailed technical analysis of RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval), a novel retrieval-augmented language model architecture introduced by Stanford researchers. Traditional retrieval systems fetch short, contiguous chunks, struggling with holistic document context. RAPTOR addresses this by recursively embedding, clustering, and summarizing text to construct a hierarchical tree, enabling cross-level abstraction. Our analysis dissects the system's four-stage pipeline: sentence-aware chunking, Gaussian Mixture Model clustering, recursive summarization, and collapsed tree retrieval. We quantify RAPTOR's significant benchmark gains—such as a 20% absolute accuracy improvement on QuALITY using GPT-4—against flat vector baselines like BM25, DPR, and SBERT. Furthermore, we examine how the model maintains information fidelity despite recursive compression, noting a low 4% hallucination rate that does not propagate. Finally, we analyze the theoretical limitations of RAPTOR's core assumptions when applied to structured corpora like code, architecture decision records, and markdown documentation.

---

## 1. RAPTOR Pipeline Architecture and System Composition

The RAPTOR methodology abandons the standard flat-array indexing used in traditional dense retrieval. Instead, it constructs a multi-layered hierarchical tree from the bottom up, composing four distinct pipeline stages: contextual chunking, dimensionality-reduced soft clustering, recursive summarization, and collapsed tree retrieval.

### 1.1 Contextual Chunking and Initial Embedding

The foundational layer (leaf nodes) of the RAPTOR tree is generated by segmenting the raw retrieval corpus into short, contiguous text chunks. The target length is strictly approximately 100 tokens. However, unlike naive token-splitters that indiscriminately slice words in half, RAPTOR utilizes a sentence-aware boundary system. If a sentence naturally exceeds the 100-token threshold, the entire sentence is preserved and moved to the subsequent chunk to ensure semantic and contextual coherence. Once segmented, these chunks are embedded into a vector space using Sentence-BERT (SBERT), specifically the `multi-qa-mpnet-base-cos-v1` BERT-based encoder.

### 1.2 Gaussian Mixture Model (GMM) Clustering

To establish the hierarchical relationships between the leaf nodes, RAPTOR employs a soft clustering algorithm based on Gaussian Mixture Models (GMMs). Soft clustering is vital for text processing, as a single paragraph often contains overlapping themes and may legitimately belong to multiple distinct semantic clusters.

Because high-dimensional vector embeddings often degrade the performance of standard distance metrics, RAPTOR pre-processes the data using Uniform Manifold Approximation and Projection (UMAP). The UMAP algorithm balances local and global structural preservation by manipulating the `n_neighbors` parameter, allowing the system to first identify broad global clusters and subsequently drill down into highly specific local clusters. The optimal number of semantic clusters is mathematically derived using the Bayesian Information Criterion (BIC), which penalizes model complexity to prevent overfitting while maximizing goodness of fit. Finally, an Expectation-Maximization (EM) algorithm estimates the Gaussian parameters (means, covariances, and mixture weights).

### 1.3 Recursive LLM Summarization

Once the nodes are successfully clustered, the groupings are passed to a Large Language Model—specifically `gpt-3.5-turbo`—to generate a synthesized abstraction of the text. RAPTOR utilizes a specific system prompt: *"You are a Summarizing Text Portal user. Write a summary of the following, including as many key details as possible: {context}."*

These newly generated summaries are then passed back into the SBERT encoder, embedded, and clustered again. This process loops recursively, continually compressing and summarizing the document layer by layer until further clustering becomes mathematically infeasible, terminating in a root node.

### 1.4 Collapsed Tree Retrieval

The true ingenuity of RAPTOR's composition lies in its querying phase. Rather than performing a rigid top-down or bottom-up traversal—which rigidly locks the retriever into a predetermined ratio of broad-to-specific information—RAPTOR utilizes a "collapsed tree" strategy.

The entire multi-layered hierarchical tree is flattened into a single unified dataset containing all raw text leaf nodes alongside every intermediate and root summary node. The system calculates the cosine similarity between the user's query embedding and the embeddings of every node in the collapsed set. The top-k highest scoring nodes are retrieved until a strict contextual limit (typically 2,000 tokens) is reached. By searching all layers simultaneously, RAPTOR dynamically retrieves the precise level of semantic granularity required to answer a specific prompt.

---

## 2. Benchmark Performance Analysis

RAPTOR's architectural advantages are quantitatively validated through controlled experiments against standard flat vector retrieval systems (BM25, DPR, and SBERT) across three distinct benchmarks: QASPER (full-text NLP papers), QuALITY (medium-length narrative passages), and NarrativeQA (entire books and movie transcripts).

### 2.1 Performance on the QuALITY Dataset

The QuALITY dataset challenges models with multiple-choice questions requiring multi-hop reasoning over medium-length passages.

With GPT-4, RAPTOR achieved **82.6% accuracy** on the standard test set and **76.2%** on the "Hard" subset — an absolute improvement of **20%** over the best previously recorded performance on this benchmark.

With UnifiedQA 3B + SBERT: **56.6%**, outperforming flat SBERT (54.9%), flat DPR (53.1%), and flat BM25 (49.9%). With GPT-3: **62.4%**, surpassing flat DPR (60.4%) by 2.0 points and flat BM25 (57.3%) by 5.1 points.

### 2.2 Performance on the QASPER Dataset

QASPER focuses on free-text answers from full-text NLP research papers, measured via F-1 Match score.

- **GPT-4**: F-1 of **55.7%** vs flat DPR (53.0%) and flat BM25 (50.2%)
- **GPT-3**: F-1 of **53.1%** vs DPR (51.3%) and BM25 (46.6%)
- **UnifiedQA 3B + SBERT**: **36.70%** vs flat SBERT (36.23%), flat DPR (31.70%), flat BM25 (26.47%)

### 2.3 Performance on the NarrativeQA Dataset

NarrativeQA requires answering queries based on entire books and movie scripts (UnifiedQA 3B, ROUGE-L/BLEU-1/BLEU-4/METEOR).

| Model Configuration | ROUGE-L | BLEU-1 | BLEU-4 | METEOR |
|---------------------|---------|--------|--------|--------|
| Flat BM25 | 23.52% | 17.73% | 4.65% | 13.98% |
| RAPTOR + BM25 | 27.93% | 21.17% | 5.70% | 17.03% |
| Flat DPR | 29.56% | 22.84% | 6.12% | 18.44% |
| RAPTOR + DPR | 30.94% | 23.51% | 6.45% | 19.05% |
| Flat SBERT | 29.26% | 22.56% | 5.95% | 18.15% |
| RAPTOR + SBERT | 30.87% | 23.50% | 6.42% | 19.20% |

RAPTOR + DPR: +1.38 ROUGE-L points over flat DPR. RAPTOR + SBERT: +1.61 points over flat SBERT.

---

## 3. Information Fidelity and Summary Drift

### 3.1 Hallucination Rates and Propagation

Annotation study: 150 randomly sampled nodes across 40 distinct narratives. Result: only **4% of nodes (6 total)** contained any measurable hallucination, all categorized as "minor." Crucially, these hallucinations did **not propagate** to parent tree layers — GMM clustering dilutes a single erroneous node's weight through aggregation. Summary drift does not measurably degrade downstream QA tasks.

### 3.2 Tree Depth and Compression Rates

For NarrativeQA-scale texts: up to Layer 4 (5 total layers). For QuALITY/QASPER: typically Layer 2 (3 layers).

Average **compression rate: 72%** per recursive step — resulting summaries average 28% of child node length. A single root node at the top of a 5-layer tree would represent catastrophic granular data loss.

### 3.3 Mitigation via Collapsed Tree Retrieval

Empirical retrieval logs show that between **18.5% and 57.36%** of all retrieved context chunks originated from non-leaf summary nodes. On NarrativeQA (holistic queries), 57.36% came from abstractive layers. The collapsed approach dynamically balances thematic comprehension against granular exactitude, circumventing deep-tree information loss.

---

## 4. Limitations on Structured Data: Code and Markdown Corpora

The paper does not benchmark RAPTOR against code corpora, ADRs, or markdown. Several core assumptions break on structured data:

### 4.1 Sentence Boundary Chunking Failures

RAPTOR's sentence-aware 100-token chunking relies on natural language punctuation boundaries. Source code, JSON, and nested markdown don't have these. Without AST-aware chunking, arbitrary severing of `for`-loops, class definitions, and structured objects corrupts the base leaf layer.

### 4.2 GMM Clustering Distribution Mismatches

GMMs assume Gaussian-distributed data. The paper explicitly acknowledges text data can exhibit skewed/sparse distributions. Code is worse: relationships between architectural documentation and microservices are deterministic and hierarchical, not probabilistic. Forcing soft GMM clustering onto hard structural dependencies will produce nonsensical module groupings, causing the summarizer to hallucinate false architectural relationships.

### 4.3 Vulnerability to Lossy Compression

At 72% compression, the LLM strips exact variable names, port numbers, and endpoint URLs in favor of "high-level summaries." In code: exact syntax is non-negotiable. The 4% hallucination rate considered "minor" for reading comprehension becomes critical failure when a non-existent library or misattributed ADR decision is injected into the collapsed tree.

---

## Bibliography

- **RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval**. arXiv:2401.18059. https://arxiv.org/abs/2401.18059 — *Core paper: GMM clustering, collapsed tree retrieval, NarrativeQA/QASPER/QuALITY benchmarks, 150-node hallucination study, 72% compression rate.*
- **RAPTOR (ar5iv rendering)**. https://ar5iv.labs.arxiv.org/html/2401.18059 — *Exact technical specifications: 100-token sentence boundary chunking, UMAP parameters, `gpt-3.5-turbo` summarization prompt, full benchmark tables.*


================================================================
## SOURCE: KG-03_Property-Graphs-vs-RDF-OWL.md
================================================================

# KG-03: Property Graphs versus RDF/OWL for Knowledge Graph RAG Systems

**Status:** Complete
**Researched via:** Gemini Deep Research (focused query, 4 questions)
**DR ID:** `v1_ChdKUjZ3YWJHakQ5bU5tdGtQODR5cnVRRRIXSlI2d2FiR2pEOW1ObXRrUDg0eXJ1UUU`
**Duration:** ~40m (5-concurrent batch)
**Date:** 2026-03-10

---

## Executive Summary

This technical research document evaluates the structural and operational tradeoffs between property graphs and RDF/OWL for Knowledge Graph Retrieval-Augmented Generation (KG-RAG) systems. As enterprise systems ingest complex, heterogeneous technical corpora—comprising source code, architectural decision records (ADRs), and markdown documentation—the choice of knowledge representation significantly impacts retrieval accuracy, query performance, and schema maintainability. Our comparative analysis reveals that property graphs, formalized by the openCypher specification, provide superior flexibility for modeling highly attributed relationships natively required by modern RAG architectures. Furthermore, an examination of production systems like GraphRAG and LightRAG demonstrates a near-exclusive reliance on property graph models (utilizing engines such as Neo4j, Memgraph, and NetworkX) to scale to datasets in the 1-million token range and process intermediate data scales efficiently. Ultimately, property graphs present lower friction for incremental updates and better accommodate the schema drift inherent in dynamic engineering environments.

---

## 1. Core Structural and Query Model Differences

The fundamental divergence between property graphs and RDF/OWL knowledge representation lies in their underlying data structures and intended query models. These differences dictate how data is stored, traversed, and evolved within a RAG pipeline.

### Structural Models
**Property Graphs** model data as discrete nodes (entities) connected by directed edges (relationships). A defining characteristic of this model is that both nodes and edges can contain internal key-value pairs, known as properties. This allows metadata—such as source attribution, timestamps, or confidence scores—to be stored directly on the relationship itself. The openCypher project was established to define a common, declarative query language for this model and is currently evolving to conform to ISO/IEC 39075 GQL, the emerging international standard for property graph query languages.

Conversely, **RDF (Resource Description Framework)** and **OWL (Web Ontology Language)** rely on a schema of triples consisting of a Subject, Predicate, and Object. In a strict RDF model, a relationship (Predicate) cannot natively hold properties. To append metadata to a relationship (e.g., tracking the file path where a specific function call occurs), RDF requires complex workarounds such as **reification** or the use of RDF-star (RDF*). Reification transforms a single relationship into a separate node with multiple connecting edges, heavily bloating the graph size and complicating structural comprehension. Furthermore, OWL overlays strict logical constraints and reasoning capabilities onto RDF data, demanding rigorous up-front schema design (ontologies).

### Query Expressiveness and Performance
**openCypher** operates as a declarative query language, allowing developers to express the desired data patterns using intuitive ASCII-art syntax (e.g., `(a)-[:CALLS]->(b)`) without needing to dictate the underlying execution strategy. Because relationship properties are natively indexed in systems like Neo4j and Kuzu, filtering paths by edge properties (e.g., querying for function calls that have a `weight` > 5) is highly expressive and computationally efficient.

In contrast, **SPARQL**, the standard query language for RDF, excels at federated queries across distributed datasets and deep inferencing. However, because RDF lacks native edge properties, querying reified relationships in SPARQL necessitates multiple recursive join operations. In a standard graph traversal ranging from 1M to 100M edges, traversing deeply linked RDF triples often yields severe performance degradation compared to the index-free adjacency typically utilized by native property graph engines.

### Schema Evolution

| Feature | Property Graphs (openCypher/GQL) | RDF / OWL (SPARQL) |
| :--- | :--- | :--- |
| **Data Structure** | Nodes, Directed Edges, Key-Value Properties | Subject-Predicate-Object Triples |
| **Edge Attributes** | Native (Key-Value pairs on edges) | Requires Reification or RDF-star |
| **Schema Paradigm** | Flexible / Schema-less | Rigid / Ontology-driven |
| **Query Language** | openCypher, GQL (Declarative) | SPARQL |
| **Primary Strength** | Traversal performance, rich localized data | Federated knowledge, logical reasoning |

---

## 2. Modeling a Mixed Technical Corpus

When implementing a KG-RAG system over a complex engineering corpus containing source code, Architecture Decision Records (ADRs), and markdown documentation, the representation model must accurately capture intricate domain-specific interactions. The primary relationship types required include:
- `function-calls` (Code to Code)
- `implements` (Code to Interface/Architecture)
- `depends-on` (Component to Component)
- `overrides` (Code to Code)
- `decision-rationale` (ADR to Code/Architecture)
- `references` (Documentation to Code/ADR)

### The Property Graph Advantage in Mixed Corpora
A mixed corpus demands high levels of traceability. For instance, when an LLM extracts a `decision-rationale` relationship from a markdown document connecting an ADR to a specific software module, the RAG system must retain the exact file path and text chunk that justifies this connection.

Property graphs excel in this domain. As observed in the LightRAG architecture, relationships (edges) are heavily attributed with schema fields including `src_id`, `tgt_id`, `description`, `keywords`, `weight`, `source_id`, and `file_path`. When tracking a `function-calls` relationship across multiple code files, a property graph can represent this as a single edge holding an array of file paths or a cumulative `weight` metric denoting the frequency of the call.

If an RDF/OWL model were used, every instance of a `function-calls` reference originating from a different file would require the creation of a new, reified intermediate node to hold the `source_id` and `file_path`. This translates into an exponential explosion of triples, degrading both the LLM's ability to easily comprehend the extracted subgraph and the database's query performance.

### Handling Cross-Domain Mapping
In an RDF framework, creating a bridge between the ontology of source code (e.g., an AST ontology) and the ontology of documentation requires rigid alignment. A property graph circumvents this by allowing nodes to carry multiple labels (e.g., `:Function:DocumentedEntity`) and letting the application logic infer meaning from the ad-hoc `references` relationships. The entity-relationship extraction process in modern RAG systems is fundamentally more aligned with the property graph model, as Large Language Models (LLMs) are empirically better at generating flat JSON structures mapping to nodes and edge arrays than generating logically perfect RDF triples with strict ontological compliance.

---

## 3. Practical Engineering Tradeoffs (As of 2024)

Deploying a Knowledge Graph RAG system requires navigating specific engineering tradeoffs regarding dataset drift, scaling, update costs, and ecosystem maturity.

### Schema Flexibility Under Corpus Drift
Technical corpora are highly volatile. A new framework adoption might introduce entirely new relationship semantics (e.g., `injects-dependency` or `decorates`). Under corpus drift, property graphs allow immediate ingestion of new edge types and properties without database downtime. LightRAG natively leverages this flexibility by allowing the LLM to dynamically generate `keywords` and relationship `description` attributes on the fly, seamlessly adapting to unseen document structures. Evolving an RDF ontology to safely incorporate these novel relationships would demand a rigorous schema update, increasing the friction of the continuous integration/continuous deployment (CI/CD) pipeline.

### Query Performance at Small-to-Medium Scale (1M–100M Edges)
At the 1M to 100M edge scale, performance bottlenecks are primarily I/O related. Native property graphs (like Neo4j) use index-free adjacency, meaning traversing an edge has an O(1) cost regardless of the total graph size. Systems like Memgraph provide high-performance in-memory graph compute using the Neo4j Bolt protocol. When an LLM triggers a RAG retrieval for all functions dependent on a deprecated library, a Cypher query can execute a multi-hop traversal in milliseconds. In contrast, RDF triple stores performing the same multi-hop semantic query via SPARQL often encounter exponential slowdowns due to large-scale set intersections and index lookups at this intermediate scale.

### Incremental Update Cost
RAG systems require rapid, incremental updates as individual documents are modified. Updating a property graph is relatively straightforward. LightRAG, for instance, supports document deletion coupled with automatic knowledge graph regeneration and entity merging. The system manages document splitting using a `chunk_token_size` (default 1200 tokens) and a `chunk_overlap_token_size` (default 100 tokens), associating each generated node and edge with a specific `source_id`. If a source file is deleted, a simple Cypher query can remove all nodes and edges exclusively tied to that `source_id`. Achieving this precise garbage collection in RDF requires carefully crafted SPARQL `DELETE` queries that must navigate reified triple networks to ensure no orphaned semantic artifacts remain.

### Tooling and Library Maturity
As of 2024, the Python ecosystem for property graphs is significantly more integrated with modern AI orchestration frameworks (like LangChain and LlamaIndex) than RDF tools. The LightRAG implementation utilizes multiple highly mature storage engines, utilizing NetworkX as the default for local processing, alongside production-ready adapters for Neo4j, Memgraph, and PostgreSQL via the Apache AGE extension. The visual tooling for property graphs (such as Neo4j Bloom or LightRAG's native Server visualization interface supporting gravity layouts and subgraph filtering) greatly outpaces equivalent tools in the Semantic Web ecosystem.

---

## 4. Graph Representation Approaches in Production RAG Systems

Analyzing production-grade systems reveals a distinct consensus in favor of property-graph-based representations, driven by the need to support advanced retrieval algorithms like hierarchical summarization and dual-level context fetching.

### GraphRAG (Microsoft)
Conventional Retrieval-Augmented Generation frequently fails at "global sensemaking"—query-focused summarization tasks that require synthesizing information across an entire corpus, such as "What are the main architectural themes in this repository?" Prior query-focused summarization (QFS) methods failed to scale to the massive quantities of text found in RAG indices.

GraphRAG utilizes a two-stage process deeply reliant on property graph mechanics. First, an LLM derives an entity knowledge graph directly from source documents. Secondly, GraphRAG employs community detection algorithms (which operate natively on property graphs by analyzing edge weights and connectivity) to group closely related entities. The system then pregenerates "community summaries" for these localized subgraphs. Upon receiving a user query, GraphRAG uses these community summaries to generate partial responses, which are subsequently synthesized into a final answer. This graph-based methodology allows GraphRAG to scale efficiently, demonstrating substantial improvements in answer comprehensiveness and diversity over 1 million token range datasets.

### LightRAG
LightRAG employs a "dual-level retrieval and generation approach" that seamlessly blends Knowledge Graph extraction with vector databases. LightRAG organizes knowledge strictly into an entity-relationship property graph.
- **Entities (Nodes):** Cataloged with attributes such as `entity_name`, `entity_type`, `description`, `source_id`, and `file_path`. Token generation for entities is constrained by the `max_entity_tokens` parameter.
- **Relationships (Edges):** Tracked using `src_id`, `tgt_id`, `description`, `keywords`, `weight`, `source_id`, and `file_path`. The `weight` attribute is particularly crucial for calculating relationship strength during query traversal, bounded by `max_relation_tokens`.

LightRAG supports multiple retrieval modes—Local (context-dependent), Global (corpus-wide), Hybrid, Naive, and Mix (integrating both KG and vector retrieval). In production, Neo4j is explicitly recommended for high-performance enterprise scenarios. Furthermore, when operating in "mix" mode, LightRAG integrates reranker models to optimize the ordering of text blocks, highlighting the deep integration between property graph metadata and standard vector search paradigms.

---

## Conclusion

The evolution of Knowledge Graph Retrieval-Augmented Generation represents a paradigm shift from simple semantic search to complex, relationship-aware reasoning. While RDF and OWL offer unparalleled rigor for formal ontologies and federated data exchange, they introduce prohibitive friction when modeling the highly localized, attribute-rich relationships required by RAG systems processing technical corpora.

Property graphs, standardizing around the openCypher and GQL specifications, provide the schema-on-read flexibility, edge-attribution capabilities, and traversal performance necessary to handle corpus drift and dynamic updates at the 1M to 100M edge scale. Implementations like GraphRAG and LightRAG validate this architectural choice, utilizing the property graph structure to facilitate advanced global sensemaking, community summarization, and hybrid vector-graph retrieval across millions of tokens. For engineering teams seeking to map complex interdependencies spanning source code and documentation, property graphs represent the most capable and mature knowledge representation model currently available.

---

## Bibliography

- **GraphRAG: Unlocking LLM Discovery on Narrative Private Data.** arXiv:2404.16130. https://arxiv.org/abs/2404.16130 — *Key Contribution: Proposes a two-stage graph-based RAG approach that leverages LLM-extracted entity knowledge graphs and pregenerated community summaries to solve global sensemaking and query-focused summarization tasks across massive (1 million token) text datasets.*
- **openCypher Specification.** https://opencypher.org/ — *Key Contribution: Details the declarative query model and structural features of property graphs, highlighting the evolution of the Cypher language toward the ISO/IEC 39075 GQL international standard to provide standardized access to highly attributed entity-relationship data.*
- **LightRAG: Simple and Fast Retrieval-Augmented Generation.** https://github.com/HKUDS/LightRAG — *Key Contribution: Outlines a production-grade KG-RAG architecture that utilizes heavily attributed property graphs (via NetworkX, Neo4j, and Memgraph) alongside hybrid retrieval modes, chunking strategies, and dynamic graph updating mechanisms.*


================================================================
## SOURCE: EQ-01_RAGAS-Framework-Deep-Dive.md
================================================================

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

