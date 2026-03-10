# Context Pressure Monitoring and Memory Management for LLM Serving Systems

**Source:** Gemini Deep Research
**Research ID:** `v1_ChdTcC12YWZfSU5QNnhqTWNQc3F2Mm9RcxIXU3AtdmFmX0lOUDZ4ak1jUHNxdjJvUXM`
**Duration:** ~10m
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T04-45-03-179Z.json`

---

## Key Points

- **KV cache is the primary memory bottleneck** in LLM serving — memory per token = 2 x 2 x L x d x b (K+V matrices, float16, layers, hidden dim, batch)
- **PagedAttention (vLLM)** eliminates 60-80% memory waste from fragmentation by using OS-style virtual memory with block tables mapping logical→physical blocks
- **Copy-on-Write** enables zero-overhead memory sharing for shared prefixes (system prompts); reference counting triggers copy only on divergence
- **Denning's Working Set Theory** applies directly to attention — LLMs exhibit temporal locality (recent tokens) and structural locality (sink tokens, formatting tokens)
- **Character-to-token ratios vary dramatically:** English prose ~4.2, Python ~3.1, C++/Rust ~2.6, CJK ~1.2 — naive `chars/4` estimation fails catastrophically
- **PID controllers** for dynamic threshold management prevent oscillation between swapping and computing

---

## 1. The Memory Bottleneck in LLM Serving

During autoregressive generation, LLMs cache Key and Value tensors for all previously processed tokens to prevent redundant computation. This KV cache is the primary source of dynamic memory consumption.

For a model with L layers, d hidden dimensions, and context length N, memory per token:

```
M_token = 2 × 2 × L × d × b
```

- First 2: Key and Value matrices
- Second 2: bytes per float16/bfloat16
- b: batch size

For a 70B parameter model, storing KV cache for a single user with 100K tokens can consume **tens of gigabytes** of VRAM. With multiple concurrent users, this scales linearly with batch size.

---

## 2. vLLM PagedAttention Architecture

### 2.1 The Fragmentation Problem

Pre-PagedAttention systems allocated contiguous memory based on maximum expected lengths:

- **Internal Fragmentation:** Over-allocating for short responses wastes memory within the allocated block
- **External Fragmentation:** As variable-length requests complete, free VRAM fragments into non-contiguous holes
- Empirical studies show **60-80% of KV cache memory wasted** to fragmentation

### 2.2 PagedAttention Mechanism

Directly inspired by OS virtual memory:

- KV cache divided into fixed-size **blocks** (pages) — each holds KV tensors for a fixed number of tokens (typically 16 or 32)
- **Logical blocks** = sequential chunks in a user's prompt
- **Physical blocks** = specific VRAM slices
- **Block Table** per request maps logical→physical

Modified attention computation:

```
A_i = softmax(q_i · [K_B(1), K_B(2), ..., K_B(m)]^T / sqrt(d)) · V_B(1..m)
```

Where B(j) = physical block index for j-th logical block.

### 2.3 Copy-on-Write (CoW) for Memory Sharing

Multiple requests sharing a system prompt → block tables point to same physical blocks.

For beam search / diverging sequences:
- Each physical block maintains a **reference count**
- If sequence needs to append to block with refcount > 1 → allocate new block, copy, decrement original refcount, append to new
- Zero memory overhead for shared prefixes

```python
# Pseudocode: Copy-on-Write in PagedAttention
def append_token_to_kv_cache(logical_block_id, token_kv, block_table, physical_memory):
    physical_block_id = block_table[logical_block_id]

    if physical_memory.get_ref_count(physical_block_id) > 1:
        # CoW triggered
        new_physical_block_id = physical_memory.allocate_block()
        physical_memory.copy(src=physical_block_id, dest=new_physical_block_id)
        physical_memory.decrement_ref_count(physical_block_id)
        block_table[logical_block_id] = new_physical_block_id
        physical_block_id = new_physical_block_id

    physical_memory.insert_token(physical_block_id, token_kv)
```

### 2.4 Block Size Trade-offs

- **Small blocks (1 token):** Zero internal fragmentation, maximum block table overhead and pointer chasing
- **Large blocks (256 tokens):** Efficient access patterns, reintroduces internal fragmentation
- **Optimal: 16 or 32 tokens** — near 96% memory utilization with high hardware utilization

---

## 3. Denning's Working Set Theory Applied to LLM Context

### 3.1 Classical Theory (1968)

Working set W(t, τ) = set of distinct memory pages referenced during interval (t-τ, t).

Foundational principle — **locality of reference:**
1. **Temporal Locality:** Recently accessed pages likely accessed again
2. **Spatial Locality:** Pages near recently accessed pages likely accessed

### 3.2 Translation to Attention Mechanisms

In LLMs, "memory pages" = KV cache blocks, "references" = attention scores.

LLM attention locality:
1. **Temporal (Local) Attention:** Heavy attention to last 50-100 tokens (immediate syntactic/semantic context)
2. **Spatial (Structural) Attention:** Consistent attention to structurally critical tokens (system prompt, formatting, entities)
3. **Attention Sinks (StreamingLLM):** Massive attention weights on very first few tokens regardless of semantic meaning — if evicted, perplexity explodes

### 3.3 Formalizing the LLM Working Set

Let a(t,k) = attention weight from current token t to previous token k.

```
W_LLM(t, τ, ε) = { k ∈ [0, t-1] | (1/τ) Σ_{i=0}^{τ-1} a(t-i, k) > ε }
```

Tokens outside this working set → candidates for eviction or swapping to CPU RAM / NVMe.

### 3.4 Heavy Hitter Oracle (H₂O) Eviction Policy

1. **Retain Initial Tokens:** Always keep first k_sink tokens (attention sink preservation)
2. **Retain Local Window:** Always keep most recent k_local tokens (temporal locality)
3. **Evict the Rest:** For tokens between sink and local window, compute moving average attention score — evict below threshold ε

Result: Effectively infinite context lengths with bounded GPU memory, if ε is properly calibrated.

---

## 4. Tokenizer Accuracy: BPE vs Character Counting

### 4.1 Why Character Counting Fails

BPE tokenizers are sensitive to:
- **Whitespace/Indentation:** Space sequences may merge into single tokens
- **Special Characters:** Math symbols, brackets, operators often fail to merge with adjacent text
- **Non-Latin Scripts:** Languages like Korean/Japanese/Arabic fall back to multi-token byte representations

### 4.2 Quantitative Character-to-Token Ratios

| Content Type | Mean Ratio (μ_R) | Variance (σ²_R) | BPE Behavior |
|-------------|-----------------|-----------------|--------------|
| **English Prose** | 4.2 chars/token | 0.8 | High merge frequency for common words |
| **Technical Docs** | 3.8 chars/token | 1.1 | Jargon splits into 2-3 subwords |
| **Python Code** | 3.1 chars/token | 1.5 | Underscores, camelCase, syntax symbols |
| **C++/Rust Code** | 2.6 chars/token | 1.8 | Brackets, pointers, non-dictionary names |
| **Mixed (Markdown/JSON)** | 3.4 chars/token | 1.6 | Structural formatting breaks BPE merges |
| **CJK Scripts** | 1.2 chars/token | 0.4 | Tokenizer fallback to bytes |

### 4.3 Domain-Aware Prediction Model

For accurate pressure monitoring:

```
T_hat = Σ_{d ∈ D} (C_d / μ_{R,d} + z · σ_{R,d} / sqrt(n))
```

Where C_d = character count of domain d, z = safety margin factor from standard normal distribution.

For mixed payloads (instructions + JSON), parse structural boundaries and apply appropriate ratio distributions.

---

## 5. Thrashing Prevention in Checkpoint-Driven Systems

### 5.1 The Anatomy of LLM Thrashing

Thrashing condition:

```
T_swap_in + T_swap_out > T_compute
```

Modern GPUs compute in milliseconds. PCIe Gen5 bandwidth caps at ~64 GB/s. Swapping a 10GB context for a single token → swap time dominates, throughput collapses.

### 5.2 Detection Telemetry

1. **PCIe Bus Utilization:** Sustained saturation of host-to-device bandwidth
2. **GPU SM Active Time:** Precipitous drop despite high request concurrency
3. **Swap Rate:** KV cache GB/s swapped

### 5.3 Prevention Strategies

#### Working Set-Aware Swapping
Integrate with Denning's theory — only swap blocks outside active W_LLM. If all working sets can't fit → preempt requests, don't swap blocks.

#### Request-Level Preemption (NOT Block-Level)
Attention requires ALL tokens in working set for EVERY generation step. Block-level swapping guarantees thrashing. Instead: pause entire users, swap their entire KV cache to CPU RAM, restore when active requests finish.

#### Continuous Batching with Admission Control
Only admit new requests if predicted peak memory of working set + active requests remains below safety threshold.

---

## 6. Optimal Checkpoint Thresholds

### 6.1 Cost Model: Swap vs Recompute

**Cost of Swapping:**
```
C_swap(N) = N · M_token / B_PCIe
```

**Cost of Recomputation:**
```
C_recompute(N) ≈ FLOPs_prefill(N) / Throughput_GPU
```

### 6.2 Critical Threshold Length

Find N_crit where C_swap = C_recompute:
- N < N_crit → faster to discard and recompute
- N > N_crit → must pay PCIe transfer penalty and swap

### 6.3 PID Controller for Dynamic Thresholds

Static thresholds fail under dynamic workloads. Use PID controller:

```
u(t) = K_p · e(t) + K_i · ∫e(τ)dτ + K_d · de(t)/dt
```

Where e(t) = error between target memory headroom (e.g., 5% free VRAM) and actual free VRAM.

- **Proportional (K_p):** Immediate reaction to sudden drops (large document submission)
- **Integral (K_i):** Long-term utilization stays near target
- **Derivative (K_d):** Dampens oscillation (prevents swap thrashing)

Feed u(t) into scheduler → dynamically tune max concurrent tokens → graceful degradation (queuing) instead of OOM crashes.

---

## Recommendations for Pythia

1. **Pythia's absolute headroom model is sound** — but should use domain-aware token estimation, not raw character count
2. **Build a character-to-token ratio lookup** for corpus content types (markdown docs ~3.8, JSON configs ~3.4, code examples ~3.1)
3. **Implement attention sink awareness** in checkpoint extraction — critical facts near the middle of the context are at highest risk of loss
4. **PID-style threshold smoothing** for pressure checks — prevent oscillating between "healthy" and "checkpoint needed" on sequential calls
5. **Request-level preemption** maps to Pythia's pool model — when pressure exceeds threshold, dismiss least-recently-queried pool member entirely rather than trying to partially evict context
6. **Copy-on-Write inspiration** for shared corpus — pool members sharing identical corpus content should not duplicate storage; Pythia's manifest hash already enables this detection
