# Pythia — Local Code Search + Oracle Memory

Pythia is an MCP server that makes Claude Code deeply aware of any codebase.
It combines two capabilities:

- **Local Code Search (LCS):** Tree-sitter chunking + sqlite-vec RAG — semantic search over your actual source code, with structural graph traversal.
- **Oracle Engine:** Persistent Gemini daemon sessions that hold architectural memory across conversations, checkpoint before context exhaustion, and reconstitute across generations.

**Install once. Point at any repo. Ask Claude how the codebase works.**

---

## ⚠️ Compute Requirements

**Read this before running `pythia init` on a large repo.**

Pythia embeds every indexed file locally using an ONNX model. The time and
memory required depend on your repo size:

| Repo size | Tier | Config | Expected time |
|-----------|------|--------|---------------|
| < 200 files | Local (default) | None — works out of the box | 1–5 min |
| 200–2,000 files | Remote CPU | `embeddings.mode = "openai_compatible"` | 5–30 min |
| 2,000+ files | GPU or API backend | `embeddings.mode = "openai_compatible"` with GPU endpoint | Minutes |

**Use `.pythiaignore`** to exclude non-source directories before your first
run. Most repos have large `docs/`, `research/`, or `node_modules/`-adjacent
trees that don't benefit from semantic search:

```
# .pythiaignore (place at workspace root)
docs/
research/
design/
*.md
node_modules/
```

Without a `.pythiaignore`, a repo with 400+ documents and research artifacts
will OOM-kill the local embedder. Scope it to `src/` first.

---

## Quickstart

```bash
npm install -g @pythia/lcs

cd /your/project

# Create .pythiaignore first if you have >200 non-source files
echo "docs/\nresearch/\n*.md" > .pythiaignore

pythia init       # index workspace, create .pythia/lcs.db
pythia mcp install  # register with Claude Code
```

Then restart Claude Code. Pythia tools are now available.

---

## MCP Tools

### Code Search

**`lcs_investigate`** — Semantic code investigation with hybrid retrieval.

```
Query: "how does the chunking pipeline work"
→ Returns: ranked code chunks with file paths, line numbers, type annotations
```

Uses: vector similarity (cosine) + FTS keyword search, RRF fusion, structural BFS traversal for definitional queries.

**`pythia_force_index`** — Force-reindex a specific file or the whole workspace.

### Oracle Memory

**`spawn_oracle`** — Start a persistent Gemini session loaded with your architectural docs.

**`ask_oracle`** — Query the oracle. It holds your full research corpus in its context.

**`oracle_commit_decision`** — Write an architectural decision record (MADR format) to the oracle's permanent ledger.

**`oracle_decommission`** — Archive an oracle session with TOTP-gated confirmation.

---

## Configuration

Global config at `~/.pythia/config.json`:

```json
{
  "embeddings": {
    "mode": "local"
  },
  "gc": {
    "deleted_chunk_retention_days": 7
  },
  "indexing": {
    "scan_on_start": false
  }
}
```

For large repos, switch `embeddings.mode` to `"openai_compatible"` or `"vertex_ai"`.
See **Off-Box Embeddings** below.

---

## Off-Box Embeddings (Large Repos)

If your repo exceeds ~200 files, run embeddings on a remote machine.

**Option 1 — Remote Ollama (LAN server / homebox):**
```bash
# On your GPU server or homebox:
ollama serve
ollama pull nomic-embed-text
```
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "http://192.168.2.110:11434/v1",
    "api_key": "ollama",
    "model": "nomic-embed-text"
  }
}
```

**Option 2 — GCP GPU VM + Ollama:**

Spin up a GCP VM with an L4 or T4 GPU, install Ollama, and point Pythia at it.
No per-token cost — you only pay for the VM while it runs.

```bash
# On the GCP VM (Debian 12):
apt-get install -y nvidia-driver libcuda1
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull nomic-embed-text
```
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "http://<GCP-VM-INTERNAL-IP>:11434/v1",
    "api_key": "ollama",
    "model": "nomic-embed-text"
  }
}
```

> **GCP tip:** Lock the Ollama port (11434) to your own IP in the firewall rules.
> Never expose it to `0.0.0.0/0`.

**Option 3 — Vertex AI managed embeddings:**

Use Google's `text-embedding-005` model (or later) directly. No VM to manage.
Requires a GCP project with the Vertex AI API enabled and ADC credentials
(`gcloud auth application-default login`).

```json
{
  "embeddings": {
    "mode": "vertex_ai",
    "project": "my-gcp-project",
    "location": "us-central1",
    "model": "text-embedding-005"
  }
}
```

Vertex AI embeddings are billed per character. For a one-time index of a large
repo, this is typically a few dollars. Incremental re-indexing (CDC) only
re-embeds changed files, keeping ongoing costs near zero.

**Option 4 — Cloud API (Voyage, OpenAI, etc.):**
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "https://api.voyageai.com/v1",
    "api_key": "pa-...",
    "model": "voyage-code-2"
  }
}
```

---

## Architecture

```
<workspace>/
└── .pythia/
    └── lcs.db            ← SQLite: chunks, embeddings, FTS, graph edges

~/.pythia/
├── config.json           ← global config (Zod-validated)
└── models/               ← cached ONNX models
```

**Indexing pipeline:** Tree-sitter parse → CNI-format chunks → BLAKE3 content hash (CDC) → ONNX embeddings (256d Matryoshka) → atomic SQLite write (chunks + vec + FTS + graph edges in one `BEGIN IMMEDIATE`)

**Retrieval pipeline:** Query embedding → top-30 vec cosine + top-30 FTS → RRF fusion → cross-encoder rerank → top-12

**Supported languages:** TypeScript, JavaScript, Python, Go, Rust, Java (Tree-sitter fast path), plus Markdown as plaintext.

---

## Requirements

- **Node.js ≥ 22**
- **Claude Code** (MCP client)
- RAM: ≥ 4GB for local embedding mode; ~500MB ONNX model loaded on first query

---

## Quick Context (For AI)

This repo is Pythia v1 — a single MCP server combining LCS indexing and oracle memory.

- All source: `/Users/mikeboscia/pythia/src/`
- Design spec (authoritative): `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md`
- DB per workspace: `<workspace>/.pythia/lcs.db`
- Global config: `~/.pythia/config.json`
- 6 MCP tools: `lcs_investigate`, `pythia_force_index`, `spawn_oracle`, `ask_oracle`, `oracle_commit_decision`, `oracle_decommission`
- Worker Thread handles all indexing; Main Thread handles all MCP requests
- Embedding: nomic-embed-text-v1.5 ONNX, 256d Matryoshka truncation
- `.pythiaignore` mirrors `.gitignore` semantics — use it to scope the index
