# LCS Deep Research Pipeline State

**This file is the AUTHORITATIVE state for the research pipeline.**
**On compaction recovery: read this file FIRST before any other action.**

---

## ⚡ RESUME INSTRUCTIONS — paste this to restart the loop after any quit/compaction

```
/loop 5m You are managing the LCS (Living Corpus System) deep research pipeline. This is a fully autonomous loop tick. Execute all steps precisely.

STEP 1 — READ STATE: Read /Users/mikeboscia/pythia/research/lcs/active-research-runs.md to get all active DR IDs, output file paths, queue, and completions counter.

STEP 2 — CHECK ALL ACTIVE DRs: For each row in the "Active DR Runs" table that has a real DR ID (not "_empty_"), call mcp__gemini__gemini-check-research with that DR ID.

STEP 3 — HANDLE COMPLETIONS (do this for EACH completed DR):
  a. IMMEDIATELY write the research content from the check-research response to the output file path shown in the table. Use the Write tool. This is the FIRST action — before updating anything else.
  b. Update active-research-runs.md: move the item to the Completed table with method "DR (focused) ✓", clear the slot to "_empty_", increment "Completions so far" by 1.
  c. If the new "Completions so far" value is divisible by 4: run git -C /Users/mikeboscia/pythia add research/lcs/ and git commit and git push.

STEP 4 — FILL EMPTY SLOTS: For each empty slot in Active DR Runs:
  a. Take QUEUE[0] from the queue. Note its domain path and filename.
  b. Read the prompt file at /Users/mikeboscia/pythia/research/lcs/{domain_path}/prompt/{filename_without_extension}_prompt.md
  c. Distill to 3-4 focused questions. Build a DR query ending with: "Write approximately 2000 words grounded in sources you actually read. Close with a ## Bibliography section listing title, URL/DOI, and key contribution for each source. Bibliography is outside the 2000-word body."
  d. Call mcp__gemini__gemini-deep-research with the focused query and format "Technical research document. Lead with Executive Summary (150 words). Use ## headers. Quantify claims. End with ## Bibliography (outside word count)."
  e. IMMEDIATELY capture the DR ID from the response — this is critical.
  f. Update active-research-runs.md: fill the slot with item name, DR ID, full output file path, and current timestamp. Remove QUEUE[0] and shift remaining queue items up by 1.

STEP 5 — FAILURE HANDLING: If any active DR has been processing for more than 35 minutes, mark it as FAILED in the state file, clear the slot, and add it back to QUEUE[0].

IRON LAWS:
- Write content to disk IMMEDIATELY when check-research returns complete — before any other action
- Capture DR IDs IMMEDIATELY after launching — before any other action
- All file paths must be fully qualified absolute paths
- State file path: /Users/mikeboscia/pythia/research/lcs/active-research-runs.md
```

---

## Pipeline Config

- Max concurrent runs: 5
- Completions before checkpoint: 4
- Completions so far: 9

---

## Active DR Runs (check these first via gemini-check-research)

| Slot | Research Item | DR ID | Output File | Started |
|------|---------------|-------|-------------|---------|
| 1 | CI-01 tree-sitter Architecture | `v1_ChdQM3l3YWYzTkJNR2JqckVQNXVQb2tRWRIXUDN5d2FmM05CTUdianJFUDV1UG9rUVk` | `/Users/mikeboscia/pythia/research/lcs/code-intelligence/CI-01_tree-sitter-Architecture-and-TypeScript-Grammar.md` | 2026-03-10T20:17:03 |
| 2 | CI-02 tree-sitter Code Chunking | `v1_ChdTWHl3YVpIbEVQakMtc0FQXzdPSndBdxIXU1h5d2FaSGxFUGpDLXNBUF83T0p3QXc` | `/Users/mikeboscia/pythia/research/lcs/code-intelligence/CI-02_tree-sitter-for-Code-Chunking.md` | 2026-03-10T20:17:13 |
| 3 | GD-01 Kuzu Deep Dive | `v1_ChdVbnl3YWMtdUZlSDNqckVQdzlTWnFRcxIXVW55d2FjLXVGZUgzanJFUHc5U1pxUXM` | `/Users/mikeboscia/pythia/research/lcs/graph-databases/GD-01_Kuzu-Deep-Dive.md` | 2026-03-10T20:17:22 |
| 4 | GD-02 SQLite as Graph Store | `v1_ChdYWHl3YWZxQUpxeWpfUFVQc29USi1RVRIXWFh5d2FmcUFKcXlqX1BVUHNvVEotUVU` | `/Users/mikeboscia/pythia/research/lcs/graph-databases/GD-02_SQLite-as-Graph-Store.md` | 2026-03-10T20:17:33 |
| 5 | VD-02 LanceDB Deep Dive | `v1_Chdabnl3YVpMdENvUFktOFlQaWI2T21BOBIXWm55d2FaTHRDb1BZLThZUGliNk9tQTg` | `/Users/mikeboscia/pythia/research/lcs/vector-databases/VD-02_LanceDB-Deep-Dive.md` | 2026-03-10T20:17:42 |

---

## Queue (next up when slots open)

Position in queue — next item to launch is QUEUE[0]:

```
QUEUE[0]  = EM-03  Voyage AI Embeddings                → embedding-models/EM-03_Voyage-AI-Embedding-Models.md
QUEUE[1]  = EM-05  Code Embedding Models               → embedding-models/EM-05_Code-Embedding-Models-Survey.md
QUEUE[2]  = CI-03  LSP Headless Analysis               → code-intelligence/CI-03_LSP-for-Headless-Code-Analysis.md
QUEUE[3]  = VD-01  Qdrant Deep Dive                    → vector-databases/VD-01_Qdrant-Deep-Dive.md
QUEUE[4]  = VD-06  Vector DB Benchmarking              → vector-databases/VD-06_Vector-DB-Benchmarking-Methodology.md
QUEUE[5]  = GD-06  Graph DB Benchmarking               → graph-databases/GD-06_Graph-DB-Benchmarking-at-Small-Scale.md
QUEUE[6]  = MC-01  MCP Protocol Spec                   → mcp-architecture/MC-01_MCP-Protocol-Specification-Full-Deep-Read.md
QUEUE[7]  = EQ-02  Retrieval Metrics                   → evaluation/EQ-02_Retrieval-Metrics-Comprehensive.md
QUEUE[8]  = EQ-04  Golden Question Set                 → evaluation/EQ-04_Golden-Question-Set-Design-Methodology.md
QUEUE[9]  = NL-03  Text Chunking Algorithms            → nlp-foundations/NL-03_Text-Chunking-Algorithms-Deep-Dive.md
QUEUE[10] = PE-02  Embedded DB Concurrency             → production-engineering/PE-02_Embedded-Database-Concurrency-Patterns.md
QUEUE[11] = RF-03  Hybrid Retrieval (retry 4)          → retrieval-fundamentals/RF-03_Hybrid-Retrieval-Dense-+-Sparse-Fusion.md
QUEUE[12] = RF-08  Context Window Packing (retry 4)    → retrieval-fundamentals/RF-08_Context-Window-Packing-Strategies.md
QUEUE[13] = EM-01  MTEB Leaderboard (retry 3)          → embedding-models/EM-01_MTEB-Leaderboard-Deep-Analysis.md
QUEUE[14] = EM-02  OpenAI Embeddings (retry 3)         → embedding-models/EM-02_OpenAI-text-embedding-3-Family.md
QUEUE[15] = KG-09  Relationship Extraction (retry 4)   → knowledge-graphs/KG-09_Relationship-Extraction-Strategies-Compared.md
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
| 6 | KG-02 RAPTOR Paper | DR (focused) ✓ | `/Users/mikeboscia/pythia/research/lcs/knowledge-graphs/KG-02_RAPTOR-Paper-Stanford.md` | 2026-03-10T13:26 |
| 7 | RF-10 RAG Production | DR (focused) ✓ | `/Users/mikeboscia/pythia/research/lcs/retrieval-fundamentals/RF-10_RAG-Production-Patterns.md` | 2026-03-10T13:26 |
| 8 | RF-09 Chunking Strategies | DR (focused) ✓ | `/Users/mikeboscia/pythia/research/lcs/retrieval-fundamentals/RF-09_Chunking-Strategies-Comprehensive-Survey.md` | 2026-03-10T14:15 |
| 9 | KG-03 Property Graphs vs RDF | DR (focused) ✓ | `/Users/mikeboscia/pythia/research/lcs/knowledge-graphs/KG-03_Property-Graphs-vs-RDF-OWL.md` | 2026-03-10T14:15 |

⚠️ = gemini-search + Claude synthesis (not DR-grounded). Numbers/benchmarks need source verification before ADRs rely on them. Consider re-running as focused DR for P0 blockers.

## Abandoned / Purged DR IDs (do not check these)

These original DR IDs used 12-question prompts and hung at 112+ minutes. Abandoned.

- KG-01 original: `v1_ChdWZnV2YVpfNUNkbU5tdGtQODR5cnVRRRIXVmZ1dmFaXzVDZG1ObXRrUDg0eXJ1UUU`
- KG-02 original: `v1_ChdZX3V2YWVlSUc2SFV6N0lQcHE3eXNROBIXWV91dmFlZUlHNkhVejdJUHBxN3lzUTg`
- RF-10 original: `v1_ChdhUHV2YWNINUhJMk02ZGtQN0p1Vm9BOBIXYVB1dmFjSDVISTJNNmRrUDdKdVZvQTg`
- EQ-01 original: `v1_ChdkZnV2YWJpb0FvTGxxdHNQNjkzdmtBNBIXZGZ1dmFiaW9Bb0xscXRzUDY5M3ZrQTQ`

Batch 2 failures — focused prompts but hung at 60+ minutes (API reported 0s elapsed = lost tracking). Abandoned 2026-03-10T14:31.

- RF-03 attempt 1: `v1_ChdBeDZ3YWFtTEdQN256N0lQd1p2a3FBVRIXQXg2d2FhbUxHUDduejdJUHdadmtxQVU`
- RF-08 attempt 1: `v1_ChdEaDZ3YWZ6UktzSG56N0lQMnBEWm1BOBIXRGg2d2FmelJLc0huejdJUDJwRFptQTg`
- KG-09 attempt 1: `v1_ChdMaDZ3YWJDcE5lcjhxdHNQNFlTWnFRRRIXTGg2d2FiQ3BOZXI4cXRzUDRZU1pxUUU`

Batch 3 failures — exceeded 35-min threshold. Abandoned 2026-03-10T14:56.

- EM-01 attempt 1: `v1_ChdreWl3YWNQc0s3alF6N0lQanZ2MW9RcxIXa3lpd2FjUHNLN2pRejdJUGp2djFvUXM`
- EM-02 attempt 1: `v1_ChdtU2l3YVlyX05JN1h6N0lQd1lUZjhRcxIXbVNpd2FZcl9OSTdYejdJUHdZVGY4UXM`

Batch 4 failures — exceeded 35-min threshold. Abandoned 2026-03-10T15:08.

- RF-03 attempt 2: `v1_ChdWQ3V3YWE3dU9yV0xxdHNQa3YtZDJBRRIXVkN1d2FhN3VPcldMcXRzUGt2LWQyQUU`
- RF-08 attempt 2: `v1_ChdYeXV3YVotTkQ2ZkZxdHNQdjlyR29BRRIXWHl1d2FaLU5ENmZGcXRzUHY5ckdvQUU`
- KG-09 attempt 2: `v1_ChdhU3V3YWZTVUZLWHN6N0lQNGRleW1ROBIXYVN1d2FmU1VGS1hzejdJUDRkZXltUTg`

Batch 5 failures — zombie pattern (0s elapsed after 60+ min). Abandoned 2026-03-10T20:15. Requeued at back as retry 3-4.

- RF-03 attempt 3: `v1_Chc5ek93YWYtMU5mbkItc0FQeXNxbHNBWRIXOXpPd2FmLTFOZm5CLXNBUHlzcWxzQVk`
- RF-08 attempt 3: `v1_ChdfVE93YVpDQ0U2eWEtc0FQcm91VHFBNBIXX1RPd2FaQ0NFNnlhLXNBUHJvdVRxQTQ`
- EM-01 attempt 2: `v1_ChZOakd3YWU2bU9MSG96N0lQdzdMbFNREhZOakd3YWU2bU9MSG96N0lQdzdMbFNR`
- EM-02 attempt 2: `v1_ChdQekd3YVlydU9henB6N0lQLU5IazBBTRIXUHpHd2FZcnVPYXpwejdJUC1OSGswQU0`
- KG-09 attempt 3: `v1_ChdBalN3YVpITENQLWJfdU1Qb1p1WmlBSRIXQWpTd2FaSExDUC1iX3VNUG9adVppQUk`

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
