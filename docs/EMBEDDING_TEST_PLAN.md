# Pythia Embedding Test Plan
**Version:** 1.0
**Date:** 2026-03-13
**Status:** Active

This plan defines what to benchmark, how to measure it, and what the results mean.
Every scenario maps to a documented config pattern in the README.

---

## Why This Plan Exists

On the first real-world test, Pythia OOM'd a 36GB MacBook. Root causes identified:

1. **`.pythiaignore` didn't exclude `node_modules/`** — thousands of third-party files
   were indexed, generating hundreds of large chunks for embedding. Fixed in v1.
2. **`dtype: "fp32"` is hardcoded** — no config knob to use q8/int8 model variant.
   ONNX fp32 model + large batches = large intermediate tensor allocations.
3. **Default `embedding_batch_size: 32`** is too aggressive for local inference on
   laptops. Recommended setting for local mode: `embedding_batch_size: 4`.

---

## Measurement Targets

For every scenario, we measure:

| Metric | Why |
|--------|-----|
| **Peak RSS (MB)** | Real memory pressure — includes ONNX native allocations, not just V8 heap |
| **Model warm time (s)** | Cold-start UX impact |
| **Embed time (s) for N chunks** | Indexing throughput |
| **Chunks/sec** | Normalized throughput for comparison |
| **MRR@10 on CSN** | Retrieval quality vs. baseline |
| **Cost/1M tokens** | Operational cost for openai_compatible/vertex_ai modes |

---

## Encoding Scenarios

### Scenario 1 — Local ONNX, fp32 (current default)

**Config:**
```json
{
  "embeddings": { "mode": "local", "dimensions": 256 },
  "indexing": { "embedding_batch_size": 4 }
}
```

**Target hardware:** MacBook M-series, ≥16GB RAM
**File scale:** <200 source files (exclude node_modules, dist)

**Run commands:**
```bash
# Perf benchmark
node scripts/perf-benchmark.mjs --label "macbook-fp32-b4" --batch-size 4

# Retrieval quality (CodeSearchNet)
node scripts/csn-benchmark.mjs --samples 500 --lang javascript --baseline
```

**Expected results (estimates):**
- Model warm: ~90s cold (cached after first run)
- Peak RSS: 1.5–2.5 GB (batch 4, fp32)
- Chunks/sec: 3–8 (CPU-only)
- MRR@10: 0.55–0.70 (fp32 quality reference)

**Pass/Fail gates:**
- ✅ Peak RSS < 8GB on 16GB Mac
- ✅ Model loads without OOM
- ✅ MRR@10 > 0.50
- ✅ 200-file repo indexes in < 10 minutes

---

### Scenario 1b — Local ONNX, q8 (planned for Sprint 10)

**Requires:** Add `dtype` field to local embeddings config schema.
**Config:**
```json
{
  "embeddings": { "mode": "local", "dimensions": 256, "dtype": "q8" },
  "indexing": { "embedding_batch_size": 8 }
}
```

**Expected improvement vs fp32:**
- Peak RSS: ~50% reduction (q8 = 8-bit weights vs 32-bit)
- Warm time: ~50% reduction
- Quality delta: -2 to -5% MRR@10 (quantization noise)
- Chunks/sec: likely 2–3× faster (less memory bandwidth)

**Pass/Fail gates:**
- ✅ Peak RSS < 4GB on 16GB Mac
- ✅ MRR@10 degradation < 5% vs fp32 baseline
- ✅ Model loads on nomic-embed-text-v1.5 without fallback

---

### Scenario 2 — Off-box via openai_compatible (Homebox Ollama)

**Hardware:** Homebox at 192.168.2.110, 30GB RAM
**Setup:**
```bash
# On homebox
ollama pull nomic-embed-text
ollama serve  # port 11434
```

**Config:**
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "http://192.168.2.110:11434",
    "api_key": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 256
  },
  "indexing": { "embedding_batch_size": 32, "embedding_concurrency": 2 }
}
```

**Why this scenario matters:**
- No ONNX Runtime on client — zero local RAM for model weights
- Ollama uses its own C++ inference stack (llama.cpp), often faster than ONNX on CPU
- Network hop adds latency but concurrency compensates
- Can handle larger repos (up to 2K files per the documented compute tiers)

**Run commands:**
```bash
# Verify homebox is reachable
curl http://192.168.2.110:11434/v1/models

# Perf benchmark (uses openai_compatible backend)
node scripts/perf-benchmark.mjs --label "homebox-ollama-b32-c2" \
  --config /tmp/pythia-homebox-config.json

# Retrieval quality
node scripts/csn-benchmark.mjs --samples 500 --lang javascript
```

**Expected results:**
- Model warm: <1s (model already loaded in Ollama)
- Peak client RSS: ~200MB (no local ONNX, just HTTP overhead)
- Network latency: 1–5ms LAN
- Chunks/sec: 20–80 (depending on Ollama concurrency)
- Quality: identical to local nomic-embed-text (same model, same math)

**Pass/Fail gates:**
- ✅ Client peak RSS < 500MB
- ✅ Chunks/sec ≥ 15 (meaningful improvement over local)
- ✅ MRR@10 within 1% of local baseline (same model)
- ✅ 1,000-file repo indexes in < 5 minutes

---

### Scenario 3 — Vertex AI (textembedding-gecko@003)

**Requirements:** GCP project with Vertex AI API enabled, `gcloud auth application-default login`

**Config:**
```json
{
  "embeddings": {
    "mode": "vertex_ai",
    "project": "YOUR_GCP_PROJECT",
    "location": "us-central1",
    "model": "textembedding-gecko@003",
    "dimensions": 256
  },
  "indexing": { "embedding_batch_size": 32, "embedding_concurrency": 4 }
}
```

**Why this scenario matters:**
- Zero local compute — fully serverless
- Scales to any repo size
- Google's production embedding model — quality may differ from nomic
- Cost: $0.0001/1K characters (~$0.10/M tokens)

**Run commands:**
```bash
# Verify auth
gcloud auth application-default print-access-token

# Set env for tests
export PYTHIA_TEST_VERTEX_TOKEN=$(gcloud auth application-default print-access-token)

# Perf benchmark
node scripts/perf-benchmark.mjs --label "vertex-gecko003-b32-c4" \
  --config /tmp/pythia-vertex-config.json

# Retrieval quality (this will incur GCP costs ~$0.01 for 500 samples)
node scripts/csn-benchmark.mjs --samples 500 --lang javascript
```

**Expected results:**
- Model warm: ~200ms (network round-trip to GCP)
- Peak client RSS: ~200MB (no local ONNX)
- Chunks/sec: 50–200 (GCP handles the compute, concurrency matters)
- Quality: likely different MRR@10 from nomic (different model)
- Cost per 500-sample run: ~$0.01

**Pass/Fail gates:**
- ✅ Authentication succeeds without manual steps post-setup
- ✅ Batch of 32 chunks embeds without 429 rate-limit errors
- ✅ MRR@10 ≥ 0.45 (gecko may score differently — needs own baseline)
- ✅ Cost per 10K-file repo index < $1.00

---

### Scenario 4 — GCP GCE + GPU (Ollama on L4)

**Hardware:** GCP G2 instance (L4 GPU, 24GB VRAM), Debian 12
**Setup:**
```bash
# On GCE instance (after GPU driver + libcuda1 install)
apt-get install libcuda1  # CRITICAL — see LESSONS.md
ollama pull nomic-embed-text
ollama serve
```

**Config:**
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "http://INSTANCE_IP:11434",
    "api_key": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 256
  },
  "indexing": { "embedding_batch_size": 128, "embedding_concurrency": 4 }
}
```

**Why this scenario matters:**
- GPU-accelerated inference: expect 10–50× throughput vs CPU Ollama
- Enables GPU/API tier (>2K files) documented in compute boundaries
- One-time GPU instance cost: ~$0.80/hr G2 on-demand

**Run commands:**
```bash
# Verify GPU is used (watch during embedding)
# On GCE: nvidia-smi dmon -s u  (should show GPU utilization > 0)

# Perf benchmark
node scripts/perf-benchmark.mjs --label "gce-l4-ollama-b128-c4" \
  --config /tmp/pythia-gce-config.json

# Retrieval quality
node scripts/csn-benchmark.mjs --samples 500 --lang javascript
```

**Expected results (GPU):**
- Chunks/sec: 200–1000 (GPU-parallelized inference)
- 10K-file repo: < 30 minutes
- Client peak RSS: ~200MB (all compute on GCE)

**Pass/Fail gates:**
- ✅ `nvidia-smi` shows VRAM usage > 0 during embedding (not CPU fallback)
- ✅ Chunks/sec ≥ 100 (meaningful vs homebox CPU)
- ✅ Quality identical to homebox Ollama (same model, same math)
- ✅ Ollama doesn't OOM L4 VRAM (nomic-embed fits in 2GB easily)

---

### Scenario 5 — Nomic Embed API (cloud, same model)

**Not yet wired** — requires openai_compatible mode with Nomic's hosted endpoint.

**Config:**
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "https://api-atlas.nomic.ai/v1",
    "api_key": "YOUR_NOMIC_API_KEY",
    "model": "nomic-embed-text-v1.5",
    "dimensions": 256
  }
}
```

**Value:** Same model as local, zero compute, free tier available. Useful for comparing
local fp32 vs API quality (should be identical — same weights, same math).

---

### Scenario 6 — OpenAI text-embedding-3-small (quality baseline)

**Config:**
```json
{
  "embeddings": {
    "mode": "openai_compatible",
    "base_url": "https://api.openai.com/v1",
    "api_key": "YOUR_OPENAI_KEY",
    "model": "text-embedding-3-small",
    "dimensions": 256
  }
}
```

**Value:** Industry benchmark. text-embedding-3-small at 256d is the reference point
for "good" retrieval quality. If nomic-embed-text-v1.5 is within 5% MRR@10, the
local ONNX path is justified. Cost: $0.02/1M tokens.

---

## Test Matrix

| Scenario | Hardware | Mode | Batch | Concurrency | Expected RSS | Expected Chunks/s |
|----------|----------|------|-------|-------------|--------------|-------------------|
| 1: Local fp32 | MacBook | local | 4 | 1 | 1.5–2.5 GB | 3–8 |
| 1b: Local q8 | MacBook | local | 8 | 1 | 0.8–1.2 GB | 6–15 |
| 2: Homebox Ollama | Homebox | openai_compat | 32 | 2 | ~200 MB | 20–80 |
| 3: Vertex AI | GCP | vertex_ai | 32 | 4 | ~200 MB | 50–200 |
| 4: GCE L4 GPU | GCE | openai_compat | 128 | 4 | ~200 MB | 200–1000 |
| 5: Nomic API | Cloud | openai_compat | 32 | 2 | ~200 MB | 50–150 |
| 6: OpenAI 3-small | Cloud | openai_compat | 32 | 2 | ~200 MB | 50–200 |

---

## Execution Order

Run in this order — each scenario gates the next:

1. **Scenario 1** (local fp32, batch=4) — establish quality baseline + confirm OOM is fixed
2. **Scenario 2** (homebox Ollama) — validate off-box path before touching GCP
3. **Scenario 3** (Vertex AI) — validate cloud path, measure quality delta vs nomic
4. **Scenario 4** (GCE L4) — GPU tier, only if Scenarios 2+3 pass
5. **Scenario 1b** (local q8) — after Sprint 10 adds `dtype` config field
6. **Scenarios 5+6** — quality cross-reference, not blocking

---

## Known Gaps / Sprint 10 Items

| Gap | Impact | Fix |
|-----|--------|-----|
| No max_files_per_index limit | Runaway indexing on huge repos | Config knob: `indexing.max_files` |
| No per-run memory report from `pythia init` | User doesn't know peak RSS | Add `--perf` flag to `pythia init` |
| CSN benchmark uses local mode only | Can't compare quality across backends | Extend `csn-benchmark.mjs` with `--embedding-config` flag |

---

## Documentation Update Required (after each scenario)

After running each scenario, update `README.md` Compute Boundaries table:

```
| Tier | Files | Mode | Hardware | Throughput | Peak RAM |
|------|-------|------|----------|-----------|---------|
| Local | <200 | local (q8 fp32) | MacBook | Xcps | YGB |
| Remote CPU | <2K | openai_compatible | Homebox | Xcps | ~200MB |
| GPU | >2K | openai_compatible | GCE L4 | Xcps | ~200MB |
```

Fill in actual measured values — no hardcoded estimates.
