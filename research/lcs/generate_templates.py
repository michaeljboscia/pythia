#!/usr/bin/env python3
"""Generate all 90 LCS research document templates."""

import os
from pathlib import Path

BASE = Path("/Users/mikeboscia/pythia/research/lcs")

# Each entry: (id, title, type, feeds_adr, priority, description)
DOMAINS = {
    "retrieval-fundamentals": [
        ("RF-01", "Dense Retrieval Fundamentals", "Foundational", "ADR-002, ADR-003", "P0",
         "Embeddings, ANN search, HNSW algorithm, how vector similarity actually works. The mathematical foundation that makes semantic search possible."),
        ("RF-02", "Sparse Retrieval — BM25 and TF-IDF", "Foundational", "ADR-002", "P0",
         "BM25, TF-IDF, inverted indexes, when keyword search beats semantic search. Understanding the complementary strengths of lexical matching."),
        ("RF-03", "Hybrid Retrieval — Dense + Sparse Fusion", "Foundational", "ADR-002", "P0",
         "Combining dense + sparse retrieval, why hybrid consistently outperforms either alone. BEIR benchmark evidence for the hybrid advantage."),
        ("RF-04", "Score Fusion Methods", "Applied", "ADR-002", "P1",
         "Reciprocal Rank Fusion (RRF), linear combination, learned weighting, CombMNZ. Which fusion method is best for heterogeneous artifact types."),
        ("RF-05", "Re-ranking with Cross-Encoders", "Applied", "ADR-002", "P1",
         "Cohere Rerank, BGE Reranker, BAAI models. Local vs API options, latency/quality tradeoffs in two-stage retrieval."),
        ("RF-06", "ColBERT and Late Interaction Retrieval", "Deep dive", "ADR-003", "P2",
         "Per-token vectors, MaxSim scoring, when late interaction outperforms single-vector approaches. Storage cost implications at LCS scale."),
        ("RF-07", "Lost-in-the-Middle Problem", "Foundational", "ADR-009", "P0",
         "The actual papers on positional degradation, measured degradation curves, which models are worst/best, and what mitigations are proven effective."),
        ("RF-08", "Context Window Packing Strategies", "Applied", "ADR-009", "P0",
         "Primacy/recency bias exploitation, optimal chunk ordering, measured impact on answer quality. How to arrange retrieved context for maximum fidelity."),
        ("RF-09", "Chunking Strategies Comprehensive Survey", "Applied", "ADR-004", "P0",
         "Recursive character splitting, semantic chunking, token-based, sliding window with overlap, markdown-aware splitting. Measured retrieval impact of chunk size choices."),
        ("RF-10", "RAG Production Patterns", "Survey", "All ADRs", "P0",
         "What actually works in production RAG systems vs academic benchmarks. Common failure modes, deployment patterns, lessons from teams running RAG at scale."),
        ("RF-11", "Query Decomposition Strategies", "Applied", "ADR-007", "P1",
         "Least-to-most prompting, step-back prompting, decomposed prompting, chain-of-thought retrieval. Which strategies improve multi-hop recall."),
        ("RF-12", "Context Compression Techniques", "Deep dive", "ADR-009", "P2",
         "Extractive vs abstractive compression of retrieved context, LLMLingua, selective context. When compression helps vs hurts answer fidelity."),
    ],
    "knowledge-graphs": [
        ("KG-01", "GraphRAG Paper — Microsoft 2024", "Paper read", "ADR-001", "P0 BLOCKER",
         "Full paper read of Microsoft's GraphRAG. Community detection over knowledge graphs, global vs local search, how it handles heterogeneous documents. The foundational reference for our graph layer."),
        ("KG-02", "RAPTOR Paper — Stanford", "Paper read", "ADR-004", "P0 BLOCKER",
         "Recursive Abstractive Processing for Tree-Organized Retrieval. Hierarchical indexing without fidelity loss, tree structures over documents. Alternative to flat chunking."),
        ("KG-03", "Property Graphs vs RDF/OWL", "Foundational", "ADR-001", "P0",
         "Which graph model fits heterogeneous artifact types (research + code + ADRs). Labeled property graph semantics, schema flexibility, and the tradeoffs of each approach."),
        ("KG-04", "Knowledge Graph Construction from Unstructured Text", "Applied", "ADR-005", "P1",
         "REBEL, OpenIE, LLM-based relation extraction pipelines. Precision/recall tradeoffs of automated extraction methods for building KGs from documents."),
        ("KG-05", "Graph Traversal Algorithms", "Applied", "ADR-001", "P1",
         "BFS, DFS, shortest path, variable-depth traversal, cycle detection. What query patterns does LCS actually need, and how are they best expressed."),
        ("KG-06", "Community Detection Algorithms", "Deep dive", "ADR-001", "P2",
         "Louvain, Leiden, what GraphRAG uses and why. Relevance to clustering related artifacts into coherent communities for global search."),
        ("KG-07", "Architecture Decision Records (ADRs)", "Applied", "ADR-004, ADR-005", "P1",
         "The MADR format, Nygard format, existing tooling (adr-tools, log4brains). How other systems handle decision tracking and implicit vs explicit decisions."),
        ("KG-08", "Knowledge Graph Schema Design for Polymorphic Nodes", "Applied", "ADR-001", "P1",
         "How to model fundamentally different entity types (papers, functions, logs) in one graph. Best practices from production knowledge graph systems."),
        ("KG-09", "Relationship Extraction Strategies Compared", "Applied", "ADR-005", "P0",
         "Parser-based (deterministic, high precision) vs LLM-based (flexible, noisy) vs LSP-based (code-only, perfect precision). Cost models and when to use each approach."),
        ("KG-10", "LightRAG Architecture Study", "Prior art", "ADR-001", "P1",
         "Graph-based RAG, design decisions, what they got right/wrong. Compare to Microsoft GraphRAG approach. Dual-level retrieval (local + global)."),
    ],
    "embedding-models": [
        ("EM-01", "MTEB Leaderboard Deep Analysis", "Survey", "ADR-003", "P0 BLOCKER",
         "Understanding MTEB task categories, which benchmarks are closest to LCS use case (retrieval, not classification). Current top models by task type. The empirical foundation for model selection."),
        ("EM-02", "OpenAI text-embedding-3 Family", "Evaluation", "ADR-003", "P0",
         "text-embedding-3-small vs text-embedding-3-large, dimension reduction (matryoshka), pricing, latency, measured retrieval quality on code + prose corpora."),
        ("EM-03", "Voyage AI Embedding Models", "Evaluation", "ADR-003", "P0",
         "voyage-3 (general), voyage-code-3 (code-specific). Benchmark claims vs actual measured quality, pricing comparison to OpenAI, API ergonomics."),
        ("EM-04", "Local Embedding Models via Ollama", "Evaluation", "ADR-003", "P1",
         "nomic-embed-text v1.5, mxbai-embed-large, all-minilm. Throughput on home server hardware, quality vs API models, when local makes sense."),
        ("EM-05", "Code Embedding Models Survey", "Survey", "ADR-003", "P0",
         "CodeBERT, GraphCodeBERT, UniXcoder, StarEncoder, Voyage Code 3. How code embeddings differ from prose embeddings, what 'code semantics' actually means for retrieval."),
        ("EM-06", "Embedding Dimension Tradeoffs", "Applied", "ADR-003", "P1",
         "384 vs 768 vs 1024 vs 1536 dimensions. Measured impact on retrieval quality, storage cost, search latency. Matryoshka embeddings (variable dims from one model)."),
        ("EM-07", "Multi-Vector vs Single-Vector Embeddings", "Applied", "ADR-003", "P1",
         "When does per-type model routing justify the complexity? Scoring across different embedding spaces, operational overhead of maintaining multiple indexes."),
        ("EM-08", "Embedding Fine-Tuning with Synthetic Training Pairs", "Deep dive", "ADR-003", "P2 (v2)",
         "How to generate training data from the corpus using an LLM, sentence-transformers fine-tuning pipeline. A v2 capability but worth understanding the approach now."),
        ("EM-09", "Embedding Model Versioning and Migration", "Applied", "ADR-003", "P1",
         "What happens when you change models, how to handle re-indexing, blue-green vector space patterns, atomic cutover strategies."),
    ],
    "code-intelligence": [
        ("CI-01", "tree-sitter Architecture and TypeScript Grammar", "Hands-on", "ADR-004", "P0 BLOCKER",
         "How tree-sitter works, incremental parsing, query patterns, available language grammars. Hands-on evaluation with TypeScript/JavaScript parsing."),
        ("CI-02", "tree-sitter for Code Chunking", "Applied", "ADR-004", "P0",
         "Syntax-aware splitting at function/class/module boundaries. Handling large functions, nested structures, export patterns. Measured chunk quality vs naive splitting."),
        ("CI-03", "LSP for Headless Code Analysis", "Evaluation", "ADR-005", "P0 BLOCKER",
         "Running tsserver headlessly, extracting call hierarchies, find-all-references, go-to-definition. Feasibility assessment as an indexing pipeline component."),
        ("CI-04", "Call Graph Extraction from TypeScript", "Applied", "ADR-005", "P1",
         "Static analysis approaches, handling dynamic dispatch, async/await chains, higher-order functions. What's extractable via static analysis vs what requires runtime."),
        ("CI-05", "Import and Dependency Graph Extraction", "Applied", "ADR-005", "P1",
         "Resolving barrel exports, path aliases (tsconfig paths), node_modules, re-exports. Building a practical extraction pipeline for TypeScript projects."),
        ("CI-06", "Test File Detection and Coverage Linking", "Applied", "ADR-005", "P1",
         "Heuristic approaches (naming conventions, co-location), jest config parsing, relating test files to source files programmatically."),
        ("CI-07", "AST-Based Code Analysis Fundamentals", "Foundational", "ADR-004, ADR-005", "P1",
         "Abstract syntax trees, control flow graphs, data flow analysis. Working understanding needed for building the code intelligence layer."),
        ("CI-08", "Code Search in Practice", "Prior art", "ADR-002, ADR-004", "P1",
         "How Sourcegraph, GitHub code search, Cursor, and Cody handle codebase-scale search. What index structures they use, what tradeoffs they make."),
    ],
    "vector-databases": [
        ("VD-01", "Qdrant Deep Dive", "Hands-on eval", "ADR-002", "P0 BLOCKER",
         "Architecture (segments, WAL, quantization), filtering during vector search, hybrid search support, Docker deployment. Measured memory/latency at 50K-500K scale."),
        ("VD-02", "LanceDB Deep Dive", "Hands-on eval", "ADR-002", "P0 BLOCKER",
         "Embedded architecture, Lance columnar format, zero-copy mmap, IVF-PQ indexing, Python/Node bindings, concurrent access model. Measured memory/latency."),
        ("VD-03", "pgvector Evaluation", "Evaluation", "ADR-002", "P1",
         "Postgres extension, HNSW + IVFFlat indexes, filtering via SQL WHERE, operational overhead of running Postgres for vectors."),
        ("VD-04", "ChromaDB Evaluation", "Evaluation", "ADR-002", "P1",
         "Embedded, Python-native, SQLite backend, known limitations, production readiness assessment for long-lived services."),
        ("VD-05", "Weaviate Evaluation", "Evaluation", "ADR-002", "P2",
         "Hybrid search, graph-like filtering, multi-tenancy, operational complexity. Assessment of whether it's overkill for single-project v1."),
        ("VD-06", "Vector DB Benchmarking Methodology", "Methodology", "ADR-002", "P0",
         "How to fairly compare vector DBs. ANN-Benchmarks, VectorDBBench, what metrics matter (recall@10, QPS, p99 latency, memory footprint)."),
        ("VD-07", "Vector Index Algorithms", "Foundational", "ADR-002", "P1",
         "HNSW, IVF-PQ, IVF-Flat, DiskANN, SCANN. When each is appropriate, memory vs quality tradeoffs, how they scale with dataset size."),
    ],
    "graph-databases": [
        ("GD-01", "Kuzu Deep Dive", "Hands-on eval", "ADR-001", "P0 BLOCKER",
         "Embedded graph DB, Cypher-compatible, C++ core with Python/Node bindings, variable-length path queries. Measured performance at 5K-50K nodes."),
        ("GD-02", "SQLite as Graph Store", "Hands-on eval", "ADR-001", "P0 BLOCKER",
         "Adjacency list tables, recursive CTEs, practical query patterns, performance at scale, where it breaks down. Honest assessment vs dedicated graph DB."),
        ("GD-03", "Neo4j Evaluation", "Evaluation", "ADR-001", "P1",
         "JVM overhead, memory requirements, Cypher expressiveness, community vs enterprise, bolt protocol. Is it justified at small scale?"),
        ("GD-04", "ArangoDB Evaluation", "Evaluation", "ADR-001", "P2",
         "Multi-model (document + graph + search), AQL query language. Does multi-model reduce total system complexity?"),
        ("GD-05", "FalkorDB Evaluation", "Evaluation", "ADR-001", "P2",
         "Redis-based graph, in-memory performance, persistence model. Lightweight alternative assessment for small-scale deployments."),
        ("GD-06", "Graph DB Benchmarking at Small Scale", "Methodology", "ADR-001", "P0",
         "How to compare graph DBs at 5K-50K nodes. What queries to benchmark, what metrics matter, how to simulate LCS query patterns."),
    ],
    "evaluation": [
        ("EQ-01", "RAGAS Framework Deep Dive", "Hands-on", "ADR-010", "P0 BLOCKER",
         "Faithfulness, answer relevance, context precision, context recall. How to implement, how to generate test sets, integration with existing pipelines."),
        ("EQ-02", "Retrieval Metrics Comprehensive", "Foundational", "ADR-010", "P0",
         "Recall@K, MRR, NDCG, MAP. What each measures, when each matters, how to compute them. Which is most important for LCS use case."),
        ("EQ-03", "Multi-Hop QA Benchmarks", "Paper read", "ADR-010", "P1",
         "HotpotQA, MuSiQue, 2WikiMultiHopQA. What they test, how evaluation works, what 'good' looks like for multi-document reasoning."),
        ("EQ-04", "Golden Question Set Design Methodology", "Applied", "ADR-010", "P0",
         "How to create evaluation sets for a specific corpus. Manual vs LLM-generated, bootstrapping when corpus is small, evolving the set over time."),
        ("EQ-05", "Adversarial Testing for RAG", "Applied", "ADR-010", "P1",
         "Questions requiring synthesis across many sources, 'not in corpus' detection, absence-of-evidence reasoning, multi-hop traversal across artifact types."),
        ("EQ-06", "End-to-End Evaluation Pipelines", "Applied", "ADR-010", "P1",
         "How production RAG systems monitor quality over time. Automated regression detection, drift alerts, continuous evaluation."),
    ],
    "mcp-architecture": [
        ("MC-01", "MCP Protocol Specification — Full Deep Read", "Spec read", "ADR-007", "P0 BLOCKER",
         "Tools vs resources vs prompts, schemas, sampling, transport (stdio vs SSE vs streamable HTTP), lifecycle. The authoritative protocol reference."),
        ("MC-02", "Existing MCP Servers for Code and Knowledge", "Survey", "ADR-007", "P1",
         "GitHub MCP, filesystem MCP, database MCPs. What patterns they use, what their limitations are, what to learn from existing implementations."),
        ("MC-03", "MCP Tool Design Patterns", "Applied", "ADR-007", "P1",
         "Granularity (primitive vs composite tools), parameter design, response formatting, error handling conventions. Best practices for tool API design."),
        ("MC-04", "MCP Context Window Management", "Applied", "ADR-007, ADR-009", "P1",
         "How to decide what to inject into LLM context from retrieval results. Budget enforcement, truncation strategies, overflow handling."),
        ("MC-05", "MCP Server Architecture Patterns", "Applied", "ADR-007", "P1",
         "Single vs multi-process, stateless vs stateful, connection pooling to backing stores, health checks. Operational patterns for MCP servers."),
    ],
    "prior-art": [
        ("PA-01", "Cognee — Open Source KG + RAG", "Code study", "ADR-001, ADR-005", "P0",
         "Graph construction pipeline, relationship extraction, how they handle heterogeneous documents. Study the code and architecture decisions."),
        ("PA-02", "Microsoft GraphRAG Implementation", "Code study", "ADR-001", "P0",
         "The actual codebase, not just the paper. How they build the graph, community detection in practice, indexing pipeline architecture."),
        ("PA-03", "LightRAG", "Code study", "ADR-001, ADR-002", "P1",
         "Graph-based RAG, dual-level retrieval (local + global), their architectural writeup and design decisions. Comparison to Microsoft GraphRAG."),
        ("PA-04", "Cursor Codebase Indexing", "Reverse eng", "ADR-002, ADR-004", "P1",
         "How Cursor indexes entire codebases for conversation. What index structures, what models, how they handle large repos."),
        ("PA-05", "Zed AI Codebase Indexing", "Blog study", "ADR-002, ADR-004", "P1",
         "Engineering blog posts on indexing for LLM context. Architecture decisions, what worked, what didn't."),
        ("PA-06", "LangChain RAG Patterns", "Survey", "All ADRs", "P1",
         "Document loaders, text splitters, retrievers, chains. What patterns are standard, what's over-engineered, what to learn from their abstractions."),
        ("PA-07", "LlamaIndex Knowledge Graph Integration", "Code study", "ADR-001, ADR-002", "P1",
         "How they combine vector retrieval with graph traversal. PropertyGraphIndex, KnowledgeGraphIndex. Bridging the two retrieval paradigms."),
        ("PA-08", "GitHub Copilot Workspace Architecture", "Reverse eng", "ADR-004", "P2",
         "How they handle codebase-scale context for multi-file edits. Published architecture details and public engineering writeups."),
        ("PA-09", "Notion AI and Confluence AI", "Survey", "ADR-006, ADR-008", "P2",
         "Living document corpus with conversation. How they handle document freshness, relationship updates, search across heterogeneous types."),
        ("PA-10", "Sourcegraph Cody", "Reverse eng", "ADR-002, ADR-009", "P1",
         "Code intelligence + RAG. How they combine structural code understanding with semantic search. Context window strategies."),
    ],
    "data-management": [
        ("DM-01", "Change Data Capture (CDC) Patterns", "Survey", "ADR-006", "P1",
         "Debezium, git hooks (post-commit, post-merge), filesystem watchers (fswatch, inotify), GitHub webhooks. Tradeoffs of each trigger mechanism."),
        ("DM-02", "Document Versioning and Provenance Tracking", "Applied", "ADR-006", "P1",
         "How to track artifact history in a queryable way. Immutable append vs mutable-with-history, temporal databases, provenance chains."),
        ("DM-03", "Staleness Detection and Freshness Scoring", "Applied", "ADR-008", "P1",
         "What production knowledge bases do for freshness. Temporal RAG papers, heuristic models, signal-based scoring, detecting 'code changed but doc didn't'."),
        ("DM-04", "Git Hook Architectures", "Applied", "ADR-006", "P1",
         "post-commit, post-merge, pre-push, server-side hooks. Reliability, failure modes, debouncing, event queues. How Claude Code hooks already work."),
        ("DM-05", "Incremental Indexing Strategies", "Applied", "ADR-006", "P1",
         "Re-indexing only changed files vs full rebuild, how to detect what changed, delta computation, consistency guarantees across stores."),
        ("DM-06", "Artifact Lifecycle Management", "Applied", "ADR-006", "P1",
         "Creation, versioning, supersession, tombstoning, archival. What happens to relationships when artifacts change state."),
        ("DM-07", "Event-Driven Indexing Architecture", "Applied", "ADR-006", "P1",
         "Message queues, event loops, async job processing in Node.js/Python. How to run background ingest alongside a request-response MCP server."),
    ],
    "nlp-foundations": [
        ("NL-01", "Natural Language Inference (NLI)", "Foundational", "v2", "P2",
         "Entailment, contradiction, neutral classification. MNLI benchmark, lightweight NLI models for contradiction detection. Precision/recall at scale."),
        ("NL-02", "Semantic Textual Similarity", "Foundational", "ADR-003", "P1",
         "How similarity scoring works beyond embeddings. Cross-encoder scoring, sentence-BERT, when cosine similarity fails as a semantic metric."),
        ("NL-03", "Text Chunking Algorithms Deep Dive", "Applied", "ADR-004", "P0",
         "Recursive character text splitter, semantic chunking (embedding-based boundary detection), markdown-aware splitting. Measured impact on retrieval quality."),
        ("NL-04", "Transformer Attention Mechanisms and Positional Encoding", "Foundational", "ADR-009", "P2",
         "RoPE, ALiBi, how attention distributes over long sequences. Understanding the root cause of lost-in-the-middle for informed mitigation."),
        ("NL-05", "Contradiction Detection Approaches", "Deep dive", "v2", "P2",
         "NLI-based, LLM-as-judge, claim decomposition + verification. What's practical at LCS scale. A v2 capability but worth researching early."),
    ],
    "production-engineering": [
        ("PE-01", "Single-Process Daemon Architecture", "Applied", "ADR-007", "P1",
         "Node.js event loop for MCP + background ingest, async job queues (bull, bee-queue), worker threads vs child processes. Process model options."),
        ("PE-02", "Embedded Database Concurrency Patterns", "Applied", "ADR-001, ADR-002", "P0",
         "SQLite WAL mode, reader/writer isolation, LanceDB concurrent access, how to safely serve queries while indexing in the same process or sibling processes."),
        ("PE-03", "Index Rebuild and Migration Strategies", "Applied", "ADR-002, ADR-003", "P1",
         "Blue-green indexes, atomic swaps, how to re-embed entire corpus without downtime, versioned index directories."),
        ("PE-04", "Operational Monitoring for Retrieval Systems", "Applied", "ADR-010", "P1",
         "What metrics to track (recall, latency, staleness), alerting on quality degradation, logging query patterns for continuous improvement."),
        ("PE-05", "Error Handling and Resilience Patterns", "Applied", "All ADRs", "P1",
         "Partial index failures, embedding API outages, corrupted vector indexes, graceful degradation strategies. How to fail safely."),
    ],
}

DOMAIN_TITLES = {
    "retrieval-fundamentals": "Domain 1: Retrieval Fundamentals",
    "knowledge-graphs": "Domain 2: Knowledge Graphs & Graph RAG",
    "embedding-models": "Domain 3: Embedding Models & Selection",
    "code-intelligence": "Domain 4: Code Intelligence",
    "vector-databases": "Domain 5: Vector Databases",
    "graph-databases": "Domain 6: Graph Databases",
    "evaluation": "Domain 7: Evaluation & Quality Measurement",
    "mcp-architecture": "Domain 8: MCP Architecture",
    "prior-art": "Domain 9: Prior Art & Existing Systems",
    "data-management": "Domain 10: Data Management & Living Systems",
    "nlp-foundations": "Domain 11: NLP & ML Foundations",
    "production-engineering": "Domain 12: Production Engineering",
}

TEMPLATE = """# {id}: {title}

**Domain:** {domain_title}
**Type:** {doc_type}
**Priority:** {priority}
**Feeds ADR:** {feeds_adr}
**Status:** Not Started
**Researcher:** _unassigned_
**Date Completed:** _pending_

---

## Scope

{description}

---

## Research Questions

_What specific questions must this document answer?_

1.
2.
3.

---

## Sources Consulted

_Papers, docs, blog posts, repos, benchmarks used._

| # | Source | Type | URL/Path |
|---|--------|------|----------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## What We Learned

_Key findings from research. Be specific — cite sources, quote numbers, reference benchmarks._



---

## What It Means for LCS

_How do these findings affect our specific architecture? What constraints do they impose? What possibilities do they open?_



---

## Decision Inputs

_Which ADRs does this research feed? What specific questions does it answer for those ADRs?_

**Feeds:** {feeds_adr}

| ADR | Question Answered | Our Finding |
|-----|-------------------|-------------|
| | | |

---

## Open Questions

_What we still don't know after this research. What follow-up investigation is needed._

1.
2.
3.

---

## Raw Notes

_Working notes, quotes, data points collected during research._


"""

def slugify(title):
    """Convert title to filename-safe slug."""
    slug = title.replace(" — ", "-").replace("—", "-")
    slug = slug.replace(" & ", "-and-")
    slug = slug.replace("/", "-")
    slug = slug.replace("(", "").replace(")", "")
    slug = slug.replace(",", "")
    slug = slug.replace("'", "")
    slug = slug.replace('"', "")
    slug = slug.replace(":", "")
    slug = slug.replace(".", "")
    slug = slug.replace("  ", " ")
    slug = slug.replace(" ", "-")
    # Remove double hyphens
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")

def main():
    total = 0
    tracking_lines = []
    tracking_lines.append("# LCS Research Tracking\n")
    tracking_lines.append(f"**Last Updated:** _auto-generated_\n")
    tracking_lines.append("**Total Documents:** 90\n")
    tracking_lines.append("")
    tracking_lines.append("## Status Legend\n")
    tracking_lines.append("- `[ ]` Not Started")
    tracking_lines.append("- `[~]` In Progress")
    tracking_lines.append("- `[x]` Complete")
    tracking_lines.append("- `[!]` Blocked")
    tracking_lines.append("")

    for domain_key, items in DOMAINS.items():
        domain_title = DOMAIN_TITLES[domain_key]
        tracking_lines.append(f"## {domain_title}\n")
        tracking_lines.append(f"| Status | ID | Title | Priority | Feeds ADR | Researcher |")
        tracking_lines.append(f"|--------|----|-------|----------|-----------|------------|")

        for item_id, title, doc_type, feeds_adr, priority, description in items:
            slug = slugify(title)
            filename = f"{item_id}_{slug}.md"
            filepath = BASE / domain_key / filename

            content = TEMPLATE.format(
                id=item_id,
                title=title,
                domain_title=domain_title,
                doc_type=doc_type,
                priority=priority,
                feeds_adr=feeds_adr,
                description=description,
            )

            filepath.write_text(content)
            total += 1
            tracking_lines.append(f"| [ ] | {item_id} | [{title}]({domain_key}/{filename}) | {priority} | {feeds_adr} | — |")

        tracking_lines.append("")

    # Summary at bottom
    tracking_lines.append("## Progress Summary\n")
    tracking_lines.append("| Metric | Count |")
    tracking_lines.append("|--------|-------|")
    tracking_lines.append(f"| Total | {total} |")
    tracking_lines.append("| Not Started | 90 |")
    tracking_lines.append("| In Progress | 0 |")
    tracking_lines.append("| Complete | 0 |")
    tracking_lines.append("| Blocked | 0 |")
    tracking_lines.append("")

    tracking_path = BASE / "tracking.md"
    tracking_path.write_text("\n".join(tracking_lines))

    print(f"Generated {total} research document templates")
    print(f"Generated tracking.md")

if __name__ == "__main__":
    main()
