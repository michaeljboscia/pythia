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
