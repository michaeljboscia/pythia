# LCS Deep Research Pipeline State

**This file is the AUTHORITATIVE state for the research pipeline.**
**On compaction recovery: read this file FIRST before any other action.**

---

## Pipeline Config

- Max concurrent runs: 2 (conservative — validate focused DR approach first)
- Completions before checkpoint: 4
- Completions so far: 5

---

## Active DR Runs (check these first via gemini-check-research)

| Slot | Research Item | DR ID | Output File | Started |
|------|---------------|-------|-------------|---------|
| 1 | KG-02 RAPTOR Paper | `v1_ChdWQmF3YVo2V0JxZUd6N0lQa3VPQjRBNBIXVkJhd2FaNldCcWVHejdJUGt1T0I0QTQ` | `/Users/mikeboscia/pythia/research/lcs/knowledge-graphs/KG-02_RAPTOR-Paper-Stanford.md` | 2026-03-10T13:02:12 |
| 2 | RF-10 RAG Production | `v1_ChdYeGF3YVp2NUtyZml6N0lQaHRTenNBTRIXWHhhd2FadjVLcmZpejdJUGh0U3pzQU0` | `/Users/mikeboscia/pythia/research/lcs/retrieval-fundamentals/RF-10_RAG-Production-Patterns.md` | 2026-03-10T13:02:24 |

---

## Queue (next up when slots open)

Position in queue — next item to launch is QUEUE[0]:

```
QUEUE[0]  = RF-03  Hybrid Retrieval                    → retrieval-fundamentals/RF-03_Hybrid-Retrieval-Dense-+-Sparse-Fusion.md
QUEUE[1]  = RF-08  Context Window Packing              → retrieval-fundamentals/RF-08_Context-Window-Packing-Strategies.md
QUEUE[2]  = RF-09  Chunking Strategies                 → retrieval-fundamentals/RF-09_Chunking-Strategies-Comprehensive-Survey.md
QUEUE[3]  = KG-03  Property Graphs vs RDF/OWL          → knowledge-graphs/KG-03_Property-Graphs-vs-RDF-OWL.md
QUEUE[4]  = KG-09  Relationship Extraction             → knowledge-graphs/KG-09_Relationship-Extraction-Strategies-Compared.md
QUEUE[5]  = EM-01  MTEB Leaderboard                    → embedding-models/EM-01_MTEB-Leaderboard-Deep-Analysis.md
QUEUE[6]  = EM-02  OpenAI Embeddings                   → embedding-models/EM-02_OpenAI-text-embedding-3-Family.md
QUEUE[7]  = EM-03  Voyage AI Embeddings                → embedding-models/EM-03_Voyage-AI-Embedding-Models.md
QUEUE[8]  = EM-05  Code Embedding Models               → embedding-models/EM-05_Code-Embedding-Models-Survey.md
QUEUE[9]  = CI-01  tree-sitter Architecture            → code-intelligence/CI-01_tree-sitter-Architecture-and-TypeScript-Grammar.md
QUEUE[10] = CI-02  tree-sitter Code Chunking           → code-intelligence/CI-02_tree-sitter-for-Code-Chunking.md
QUEUE[11] = CI-03  LSP Headless Analysis               → code-intelligence/CI-03_LSP-for-Headless-Code-Analysis.md
QUEUE[12] = VD-01  Qdrant Deep Dive                    → vector-databases/VD-01_Qdrant-Deep-Dive.md
QUEUE[13] = VD-02  LanceDB Deep Dive                   → vector-databases/VD-02_LanceDB-Deep-Dive.md
QUEUE[14] = VD-06  Vector DB Benchmarking              → vector-databases/VD-06_Vector-DB-Benchmarking-Methodology.md
QUEUE[15] = GD-01  Kuzu Deep Dive                      → graph-databases/GD-01_Kuzu-Deep-Dive.md
QUEUE[16] = GD-02  SQLite as Graph Store               → graph-databases/GD-02_SQLite-as-Graph-Store.md
QUEUE[17] = GD-06  Graph DB Benchmarking               → graph-databases/GD-06_Graph-DB-Benchmarking-at-Small-Scale.md
QUEUE[18] = MC-01  MCP Protocol Spec                   → mcp-architecture/MC-01_MCP-Protocol-Specification-Full-Deep-Read.md
QUEUE[19] = EQ-02  Retrieval Metrics                   → evaluation/EQ-02_Retrieval-Metrics-Comprehensive.md
QUEUE[20] = EQ-04  Golden Question Set                 → evaluation/EQ-04_Golden-Question-Set-Design-Methodology.md
QUEUE[21] = NL-03  Text Chunking Algorithms            → nlp-foundations/NL-03_Text-Chunking-Algorithms-Deep-Dive.md
QUEUE[22] = PE-02  Embedded DB Concurrency             → production-engineering/PE-02_Embedded-Database-Concurrency-Patterns.md
```

Queue base path: `/Users/mikeboscia/pythia/research/lcs/`
Prompt path: append `prompt/<filename_without_ext>_prompt.md`

---

## Completed

| # | Research Item | Method | Output File | Completed |
|---|---------------|--------|-------------|-----------|
| 1 | RF-07 Lost-in-Middle | DR (fallback) | `/Users/mikeboscia/pythia/research/lcs/retrieval-fundamentals/RF-07_Lost-in-the-Middle-Problem.md` | 2026-03-10T12:30 |
| 2 | RF-01 Dense Retrieval | gemini-search ⚠️ | `/Users/mikeboscia/pythia/research/lcs/retrieval-fundamentals/RF-01_Dense-Retrieval-Fundamentals.md` | 2026-03-10T13:00 |
| 3 | RF-02 Sparse Retrieval BM25 | gemini-search ⚠️ | `/Users/mikeboscia/pythia/research/lcs/retrieval-fundamentals/RF-02_Sparse-Retrieval-BM25-and-TF-IDF.md` | 2026-03-10T13:05 |
| 4 | KG-01 GraphRAG Paper | gemini-search ⚠️ | `/Users/mikeboscia/pythia/research/lcs/knowledge-graphs/KG-01_GraphRAG-Paper-Microsoft-2024.md` | 2026-03-10T13:10 |
| 5 | EQ-01 RAGAS Framework | gemini-search ⚠️ | `/Users/mikeboscia/pythia/research/lcs/evaluation/EQ-01_RAGAS-Framework-Deep-Dive.md` | 2026-03-10T13:10 |

⚠️ = gemini-search + Claude synthesis (not DR-grounded). Numbers/benchmarks need source verification before ADRs rely on them. Consider re-running as focused DR for P0 blockers.

## Abandoned / Purged DR IDs (do not check these)

These original DR IDs used 12-question prompts and hung at 112+ minutes. Abandoned.

- KG-01 original: `v1_ChdWZnV2YVpfNUNkbU5tdGtQODR5cnVRRRIXVmZ1dmFaXzVDZG1ObXRrUDg0eXJ1UUU`
- KG-02 original: `v1_ChdZX3V2YWVlSUc2SFV6N0lQcHE3eXNROBIXWV91dmFlZUlHNkhVejdJUHBxN3lzUTg`
- RF-10 original: `v1_ChdhUHV2YWNINUhJMk02ZGtQN0p1Vm9BOBIXYVB1dmFjSDVISTJNNmRrUDdKdVZvQTg`
- EQ-01 original: `v1_ChdkZnV2YWJpb0FvTGxxdHNQNjkzdmtBNBIXZGZ1dmFiaW9Bb0xscXRzUDY5M3ZrQTQ`

---

## DR Query Template (focused — use this going forward)

```
Research [SPECIFIC TOPIC] ([paper citation if applicable]).

Focused questions:
1. [Question 1 — specific, measurable]
2. [Question 2 — specific, measurable]
3. [Question 3 — specific, measurable]
4. [Question 4 — optional]

Primary sources to read: [2-3 specific URLs]

Write approximately 2000 words of technical analysis grounded in sources you actually read.
Close with a ## Bibliography section (title, URL/DOI, key contribution for each source).
The bibliography does not count toward the 2000-word body.
```

Format parameter: "Technical research document with clearly labeled sections. Lead with Executive Summary (150 words). Use ## headers. Quantify all claims with numbers from sources. End with ## Bibliography (outside word count)."

---

## How the Loop Works (manual mode — no auto-loop)

When checking in manually:
1. Read this file to get active DR IDs and queue position
2. For each active DR ID, call `mcp__gemini__gemini-check-research`
3. If complete: write output to output file, mark slot empty, increment completion counter
4. If any slots empty: read prompt file for QUEUE[0], distill to 3-5 focused questions, call `mcp__gemini__gemini-deep-research` with focused prompt + bibliography requirement
5. Capture DR ID immediately and write to this file before doing anything else
6. Every 4 completions: save session notes + git commit + push
