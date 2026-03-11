# How positional encodings shape RAG's blind spots

**Transformer attention mechanisms systematically neglect information placed in the middle of long contexts, and the mathematical properties of positional encodings are a primary driver.** This phenomenon — termed "lost in the middle" by [Liu et al. (2023)](https://arxiv.org/abs/2307.03172) — creates a U-shaped performance curve where models reliably extract facts from the beginning and end of their context window but miss critical information sandwiched between. The effect is not merely an academic curiosity: it directly determines whether a RAG system's carefully retrieved documents actually influence the model's answer. Understanding *why* this happens requires tracing the math from positional encoding formulas through attention score computation to the softmax bottleneck — and then translating that understanding into concrete context-assembly strategies.

---

## The mathematics behind RoPE and ALiBi create fundamentally different attention geometries

Modern large language models encode token position through two dominant schemes: **Rotary Position Embedding (RoPE)**, introduced by [Su et al. (2021)](https://arxiv.org/abs/2104.09864), and **Attention with Linear Biases (ALiBi)**, introduced by [Press et al. (2022)](https://arxiv.org/abs/2108.12409). They differ not just in implementation but in the geometric structure they impose on attention patterns.

**RoPE encodes position through rotation in embedding space.** After projecting token embeddings into query and key vectors via learned weight matrices, RoPE applies a position-dependent rotation. For a token at position *m*, the query becomes q'_m = R(m) · W_q · x_m, where R(m) is a block-diagonal matrix of 2×2 rotation blocks. Each block rotates a pair of dimensions by angle mθ_i:

R_i(m) = [[cos(mθ_i), −sin(mθ_i)], [sin(mθ_i), cos(mθ_i)]]

The frequency parameters follow a geometric progression: θ_i = 10000^(−2(i−1)/d), matching the original sinusoidal encoding's frequency schedule. The critical mathematical property emerges when computing the dot product between a query at position *m* and a key at position *n*: because R(m)^T · R(n) = R(n−m), the attention score reduces to x_m^T · W_q^T · R(n−m) · W_k · x_n. **The score depends only on relative distance (n−m), not on absolute positions** — achieving relative position encoding through absolute rotation. Su et al. proved this via complex number representation: representing each 2D subspace in the complex plane, f(x,m) = x · e^(imθ), so the inner product yields a phase factor of e^(i(m−n)θ) that captures only relative distance.

RoPE also exhibits a provable **long-term decay property**. Using Abel transformation, the [RoFormer paper](https://arxiv.org/abs/2104.09864) demonstrates that the upper bound on the dot product magnitude decreases as |m−n| grows. Intuitively, as two tokens move farther apart, their rotated embeddings become increasingly "misaligned" across the d/2 frequency components, reducing the expected attention score. This creates a natural **recency bias** — nearby tokens receive higher attention — without any explicit penalty term.

RoPE is applied only to queries and keys, never to values, and operates at every attention layer rather than just at input. It is the dominant positional encoding in today's LLM ecosystem: **Llama 1/2/3, Mistral, Mixtral, Gemma, DeepSeek, Qwen, and GPT-NeoX** all use RoPE or its scaled variants ([EleutherAI blog](https://blog.eleuther.ai/rotary-embeddings/)). Its out-of-the-box length extrapolation is limited (~100–200 tokens beyond training length), but scaling techniques like Position Interpolation, NTK-aware scaling, and YaRN extend it to 128K+ tokens with minimal fine-tuning.

**ALiBi takes the opposite approach: no positional embeddings at all.** Instead, it adds a static, non-learned bias directly to the pre-softmax attention logits:

attention_score(i, j) = q_i · k_j + m · (−|i − j|)

The penalty is proportional to token distance, with *m* being a head-specific slope drawn from a geometric sequence. For *n* attention heads, slopes are set as m_h = 2^(−8h/n) for h = 1, …, n. For an 8-head model, this yields slopes of {1/2, 1/4, 1/8, …, 1/256}. These slopes are **fixed before training and never learned** — adding zero parameters and negligible memory overhead ([Press et al., 2022](https://arxiv.org/abs/2108.12409)).

The key difference from RoPE: ALiBi's linear penalty in logit space translates to an **exponential decay in attention probability** after softmax. Heads with steep slopes (e.g., m = 0.5) concentrate attention tightly on nearby tokens, while heads with shallow slopes (e.g., m = 0.004) attend more uniformly across the context. This creates a **multi-scale attention mechanism** — different heads effectively operate at different context "wavelengths." ALiBi's explicit design goal is recency: the [paper states directly](https://arxiv.org/abs/2108.12409) that "ALiBi has an inductive bias towards recency."

ALiBi's length generalization is its strongest selling point. A 1.3B-parameter model trained on 1024-token sequences achieves the same perplexity as a sinusoidal model trained on 2048 tokens when both are tested at 2048 — effectively doubling the useful context for free. However, later analysis by Chi et al. (2022) suggested ALiBi's extrapolation success comes partly from an "implicit windowed attention effect" rather than true long-range reasoning. ALiBi powers **BLOOM (176B), MPT, BloombergGPT, and MosaicBERT**, though its adoption has declined relative to RoPE since 2024 as RoPE scaling techniques closed the extrapolation gap.

The table below summarizes the key architectural differences:

| Property | RoPE | ALiBi |
|---|---|---|
| Position injection | Multiplicative rotation of Q, K | Additive bias to attention logits |
| Affects values? | No | No |
| Applied where | Every attention layer (Q, K only) | Every attention layer (logits only) |
| Learnable position params | None (fixed frequencies) | None (fixed slopes) |
| Distance decay mechanism | Bounded dot-product decay (geometric) | Linear logit penalty → exponential probability decay |
| Recency bias strength | Moderate (implicit from decay) | Strong (explicit by design) |
| Primacy bias | Strong (via attention sinks + causal mask) | Weaker (less attention sink amplification) |
| Length extrapolation | Limited raw; excellent with PI/YaRN | ~2× training length out-of-box |
| Model families | Llama, Mistral, Gemma, DeepSeek, Qwen | BLOOM, MPT, Bloomberg |

---

## What "Lost in the Middle" quantifies about position-dependent performance

The landmark [Liu et al. (2023)](https://arxiv.org/abs/2307.03172) study, published in *Transactions of the ACL* (2024), provided the first rigorous quantification of position-dependent attention failures across model families. The experimental design was elegant: present models with *k* documents where exactly one contains the answer, systematically vary the position of that gold document, and measure accuracy as a function of position.

**The core finding is a U-shaped performance curve.** Across virtually all models and tasks, accuracy peaks when the relevant document appears at the very beginning or end of the context and drops sharply for middle positions. On multi-document question answering with 20 retrieved passages, **GPT-3.5-Turbo's accuracy plummets to 52.9% when the answer sits at position 10** — compared to roughly 88% in the oracle (single-document) setting. This **more-than-20-percentage-point drop** is dramatic enough that mid-context performance falls *below the closed-book baseline of 56.1%*. In other words, stuffing the context with documents that include the answer actually makes the model perform worse than having no documents at all, if the answer happens to land in the middle.

The degradation intensifies with context length. At 30 documents, GPT-3.5-Turbo (16K) drops to **49.5% at position 10** — nearly 40 points below oracle performance. The 10-document setting shows a milder but still measurable U-shape, confirming that middle-position neglect begins at modest context lengths (**~1,000–2,000 tokens**) and becomes severe by 4,000–6,000 tokens.

**Model families vary substantially in susceptibility.** Claude-1.3 achieved **near-perfect accuracy on key-value retrieval across all context lengths** (75, 140, and 300 key-value pairs), making it a dramatic outlier. GPT-3.5-Turbo (16K), by contrast, dropped to **45.6% on 300 KV pairs** when retrieving from middle positions without query-aware contextualization. With query-aware contextualization — placing the query at both the beginning *and* end of the prompt — GPT-3.5-Turbo (16K) recovered to **100% on the same 300-pair task**, demonstrating that the information is *present* in the context but simply not *attended to*. Open-source models (MPT-30B-Instruct, LongChat-13B) showed significant degradation comparable to GPT-3.5.

A critical and often overlooked finding: **extended context windows do not improve context utilization.** GPT-3.5-Turbo (16K) and Claude-1.3 (100K) performed nearly identically to their shorter-context counterparts on overlapping settings. The paper also found that **encoder-decoder models (Flan-UL2, Flan-T5-XXL) are substantially more robust** within their training-time sequence length, because their bidirectional encoder can contextualize each document against both the query and future documents. The U-shape appears in these models only when sequences exceed training length. Instruction tuning does not cause the phenomenon — base MPT-30B exhibits the same U-shape as MPT-30B-Instruct, just at lower absolute accuracy.

The practical RAG implication is stark: **adding more retrieved documents beyond ~20 yields diminishing returns.** Liu et al. found that increasing from 20 to 50 documents improved GPT-3.5-Turbo accuracy by only ~1.5% despite substantially higher retriever recall, because the additional relevant passages end up in middle positions where they're effectively invisible.

Follow-up research has both deepened and complicated these findings. [Zhang et al. (2024)](https://arxiv.org/abs/2403.04797) introduced Ms-PoE (Multi-scale Positional Encoding), a training-free approach that assigns different position scaling ratios to different attention heads based on their position-sensitivity, achieving **0.6 to 3.8 point improvements** on ZeroSCROLLS benchmarks across Llama-2 and Vicuna models. Their root-cause analysis attributes the lost-in-the-middle phenomenon specifically to the joint effect of causal attention masking and RoPE's long-term decay. The LongBench benchmark ([Bai et al., 2023](https://arxiv.org/abs/2308.14508)) documented **up to 17% accuracy loss** as inputs grow from 0–4K to 8K+ tokens across 21 diverse tasks.

---

## Why attention sinks and softmax competition create the U-shape

The mathematical explanation for middle-position neglect requires understanding three interacting mechanisms: the **softmax bottleneck**, **causal masking asymmetry**, and **positional encoding decay**.

Softmax normalizes attention scores into a probability distribution summing to 1.0. As [Xiao et al. (2023)](https://arxiv.org/abs/2309.17453) demonstrated in their StreamingLLM work (ICLR 2024), this sum-to-one constraint means the model *cannot* assign near-zero attention to irrelevant positions — it must distribute its fixed attention budget somewhere. When a query has no strong content match among previous tokens, the "excess" attention gravitates toward the first token, which functions as a **"no-op" attention sink**. This phenomenon is architecture-independent: [Gu et al. (2024)](https://arxiv.org/abs/2410.10781) proved at ICLR 2025 that replacing softmax with sigmoid attention eliminates sinks entirely, confirming the normalization constraint as the root cause.

Causal masking compounds this effect. In decoder-only models, token 0 is visible to all N−1 subsequent tokens, while token N−1 is visible only to itself. [Wu et al. (2025)](https://arxiv.org/html/2502.01951v1) provided a graph-theoretic proof that in multi-layer causal attention, **the influence of the first token grows exponentially with depth** — each layer's contextualized representations carry disproportionate information from earlier tokens, and subsequent layers amplify this asymmetry. The causal mask itself acts as an implicit positional encoding, enabling position-dependent behavior even without explicit position information.

The U-shape emerges from the collision of these forces. **Beginning tokens benefit from the attention sink mechanism and causal mask amplification (primacy bias).** End tokens benefit from RoPE's decay-with-distance property or ALiBi's linear penalty (recency bias). **Middle tokens receive neither advantage** — they are too far from the query position to benefit from recency effects, yet lack the structural privilege that the causal mask grants to initial tokens. The result is an attention "valley" at intermediate positions that deepens as context length grows and the fixed attention budget is diluted across more tokens.

---

## Practical context packing strategies and their empirical support

Translating these mechanistic insights into RAG engineering yields several actionable strategies, each with varying levels of empirical support.

**Limiting total context length is the highest-confidence intervention.** The [Databricks long-context RAG study](https://www.databricks.com/blog/long-context-rag-performance-llms) tested 20+ LLMs across 2K to 2M tokens and found sharp model-specific saturation points: Mixtral-Instruct peaks at just **4K tokens**, DBRX at 8K, GPT-4-Turbo and Claude-3-Sonnet at 16K, and Llama-3.1-405B at 32K. Only GPT-4o, Claude-3.5-Sonnet, and GPT-4o-mini maintained consistent performance as length increased. [Pinecone's analysis](https://www.pinecone.io/blog/why-use-retrieval-instead-of-larger-context/) found that RAG preserved **95% of accuracy using only 25% of the tokens** compared to processing entire documents. The practical recommendation: **restrict context to 3–5 highly relevant documents**, even when the model's context window could fit dozens. Multiple analyses converge on a heuristic that performance degrades past roughly **50% of stated context window capacity**.

**Sandwich ordering (most relevant at both extremes) is widely implemented but its real-world impact is debated.** Both [LangChain](https://python.langchain.com/docs/how_to/long_context_reorder/) and [LlamaIndex](https://docs.llamaindex.ai/en/stable/examples/node_postprocessor/LongContextReorder/) ship `LongContextReorder` modules that place the highest-relevance documents at positions 1 and *k*, with lower-relevance documents filling the middle. This directly exploits the U-shaped attention curve. However, a [2025 EMNLP paper](https://arxiv.org/html/2505.15561v1) titled "Do RAG Systems Really Suffer From Positional Bias?" complicates this picture: in realistic retrieval pipelines (as opposed to controlled synthetic settings), top-*k* results contain both relevant *and* strongly distracting passages clustered near the top of the ranking. The simultaneous presence of both types at attention-favored positions partially cancels the benefit, and the authors found that **rearranging passages based on position preference was not more effective than random ordering** in their realistic evaluation. This suggests the lost-in-the-middle effect, while real, may be less severe in production RAG systems than benchmark numbers imply.

**Recency-first ordering (most relevant last) shows promise for decoder-only models.** [Peysakhovich and Lerer (2023)](https://arxiv.org/abs/2310.01427) developed "attention sorting" — running one decoding step, measuring per-document average attention, and re-sorting so the highest-attention documents appear last. On Llama-2 models, this recovered **40–45 percentage points on 30K-token QA benchmarks** versus unsorted baselines, with just 1–2 sorting iterations needed. A [dynamic context selection study](https://arxiv.org/html/2512.14313) confirmed on MuSiQue-Ans that placing relevant passages at the end yielded the highest F1 scores. Critically, optimal ordering is model-dependent: [research on multilingual position bias](https://arxiv.org/html/2505.16134) showed that **Qwen2.5-7B and DeepSeek-7B favor late positions while Llama-3.1-8B prefers early ones**.

**Context compression delivers the strongest per-token gains.** Microsoft's [LongLLMLingua](https://aclanthology.org/2024.acl-long.91/) (ACL 2024) achieves **up to 21.4% performance improvement at 4× compression** on NaturalQuestions, reduces costs by 94% on the LooGLE benchmark, and accelerates end-to-end latency by 1.4–2.6×. The approach uses a small language model to identify and remove non-essential tokens while preserving critical information. Removing its question-aware coarse-grained compression component causes up to a **35.8-point drop**, highlighting that compression must be relevance-aware to work. The predecessor [LLMLingua](https://github.com/microsoft/LLMLingua) (EMNLP 2023) demonstrated up to **20× compression with only 1.5 points of performance loss** across diverse benchmarks. Compression directly addresses the attention dilution problem: fewer tokens mean each remaining token captures a larger share of the fixed attention budget.

**Separator tokens and document demarcation lack dedicated empirical study** but appear in standard practice. The Lost in the Middle paper itself uses explicit markers like "Document [1] (Title: ...)" between passages, providing structural cues. Chroma's [chunking evaluation](https://research.trychroma.com/evaluating-chunking) found that recursive character splitting with explicit separators (newlines, periods, spaces) performed consistently well. No controlled study was found isolating separator tokens as an independent variable for RAG accuracy, making this an under-researched area.

**Repeating key information at both context extremes** follows logically from the U-shaped curve but lacks direct empirical validation. The sandwich ordering pattern is the closest practical implementation — by placing highly relevant documents at both positions 1 and *k*, it ensures critical information appears at both attention peaks. Query-aware contextualization (placing the query at both the beginning and end of the prompt) achieved dramatic results in Liu et al.'s study: GPT-3.5-Turbo (16K) jumped from **45.6% to 100%** on 300-pair key-value retrieval.

The positional encoding scheme should inform strategy choice. For **RoPE-based models** (Llama, Mistral, most modern LLMs), the sandwich pattern addresses both the causal-mask-driven primacy bias and the rotation-decay-driven recency bias. For **ALiBi-based models** (MPT, BLOOM), the explicit distance penalty makes recency bias dominant, so placing the most relevant document last may be most effective. An [embedding study](https://arxiv.org/html/2412.15241) quantified this difference: RoPE models show a **15.4% cosine similarity decrease** when irrelevant text is inserted at the beginning versus the end, while ALiBi models show only a **1.8% decrease** — confirming ALiBi's greater robustness to positional perturbation but stronger recency dependence.

---

## Emerging fixes target the mechanism, not just the symptoms

Beyond context-assembly heuristics, several approaches address the underlying attention mechanics. [Ms-PoE](https://arxiv.org/abs/2403.04797) (NeurIPS 2024) is a training-free, plug-and-play method that assigns different position-index scaling ratios to different attention heads based on measured position-sensitivity, improving middle-position retrieval by **20–40%** with zero computational overhead. The [Found-in-the-Middle attention calibration](https://aclanthology.org/2024.findings-acl.890/) method disentangles positional bias from content-based attention scores, achieving **up to 15 percentage points of improvement** when gold documents are placed mid-sequence.

More radical architectural changes are also under investigation. Replacing softmax with **sigmoid attention** eliminates attention sinks entirely — as [Gu et al. (2024)](https://arxiv.org/abs/2410.10781) demonstrated, without the sum-to-one constraint, models have no need to dump excess attention on position 0. StreamingLLM's practical solution — **retaining KV states for 4 initial "sink" tokens alongside a sliding window** — enables stable inference up to 4 million+ tokens with a 22.2× speedup over full recomputation ([Xiao et al., 2023](https://arxiv.org/abs/2309.17453)). Microsoft's IN2 training approach forces position-invariant attention patterns during fine-tuning, producing models like FILM-7B that demonstrate improved retrieval across 32K-token contexts.

---

## Conclusion

The lost-in-the-middle phenomenon is not a bug in any single model — it is an emergent property of how softmax normalization, causal masking, and positional encoding decay interact in the transformer architecture. **RoPE's rotational decay and ALiBi's linear penalty both create recency bias through different mathematical paths**, while the causal mask's exponential amplification of early-token influence across layers creates primacy bias. Middle positions fall into the attention valley between these two forces.

For RAG practitioners, the evidence hierarchy is clear. The highest-confidence intervention is **aggressive context limiting** — most models saturate well below their stated context windows, and RAG achieves near-full accuracy with far fewer tokens than the window allows. Context compression via tools like LongLLMLingua offers the best accuracy-per-token ratio. Ordering strategies (sandwich, recency-first) provide measurable gains in controlled settings, though the 2025 EMNLP finding that realistic retrieval pipelines partially neutralize positional bias suggests these gains may be smaller in production than benchmarks predict. The most important takeaway may be the least intuitive: **a shorter, denser context with 5 well-chosen documents will almost always outperform a longer context with 30 documents, even when the longer context contains more relevant information.** The attention mechanism's fixed budget makes information density, not information volume, the governing constraint.

---

## Bibliography

1. **"Attention Is All You Need"** — Vaswani, Shazeer, Parmar, Uszkoreit, Jones, Gomez, Kaiser, Polosukhin (NeurIPS 2017). https://arxiv.org/abs/1706.03762. Introduced the transformer architecture, scaled dot-product attention, multi-head attention, and sinusoidal positional encodings.

2. **"RoFormer: Enhanced Transformer with Rotary Position Embedding"** — Su, Lu, Pan, Murtadha, Wen, Liu (2021). https://arxiv.org/abs/2104.09864. Proposed RoPE, proving that rotation-based encoding achieves relative position sensitivity through absolute position application, with long-term decay property.

3. **"Train Short, Test Long: Attention with Linear Biases Enables Input Length Generalization"** — Press, Smith, Lewis (ICLR 2022). https://arxiv.org/abs/2108.12409. Introduced ALiBi, demonstrating that a simple linear distance penalty on attention scores enables length extrapolation without positional embeddings.

4. **"Lost in the Middle: How Language Models Use Long Contexts"** — Liu, Lin, Hewitt, Paranjape, Bevilacqua, Petroni, Liang (TACL 2024). https://arxiv.org/abs/2307.03172. Quantified the U-shaped performance curve across model families, showing >20% accuracy drops for middle-positioned information.

5. **"Efficient Streaming Language Models with Attention Sinks"** — Xiao, Tian, Chen, Han, Lin (ICLR 2024). https://arxiv.org/abs/2309.17453. Identified the attention sink phenomenon and proposed StreamingLLM for stable long-sequence inference.

6. **"When Attention Sink Emerges in Language Models: An Empirical View"** — Gu, Dao, Ermon, Rudra, Ré (ICLR 2025 Spotlight). https://arxiv.org/abs/2410.10781. Proved softmax normalization is the root cause of attention sinks, independent of positional encoding type.

7. **"Found in the Middle: How Language Models Use Long Contexts Better via Plug-and-Play Positional Encoding" (Ms-PoE)** — Zhang, Chen, Liu, Zhou, He (NeurIPS 2024). https://arxiv.org/abs/2403.04797. Training-free multi-scale positional encoding fix improving middle-position retrieval by 20–40%.

8. **"LongLLMLingua: Accelerating and Enhancing LLMs in Long Context Scenarios via Prompt Compression"** — Jiang, Wu, Luo, Li, Lin, Yang, Qiu (ACL 2024). https://aclanthology.org/2024.acl-long.91/. Achieved 21.4% RAG performance boost at 4× compression via question-aware prompt compression.

9. **"Attention Sorting Combats Recency Bias in Long Context Language Models"** — Peysakhovich, Lerer (2023). https://arxiv.org/abs/2310.01427. Demonstrated 40–45 percentage point recovery on long-context QA through attention-based document reordering.

10. **"On the Emergence of Position Bias in Transformers"** — Wu, Marks, Tegmark (MIT, 2025). https://arxiv.org/html/2502.01951v1. Graph-theoretic proof that causal masking amplifies first-token influence exponentially with transformer depth.

11. **"LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding"** — Bai, Lv, Zhang, et al. (ACL 2024). https://arxiv.org/abs/2308.14508. Multi-task long-context benchmark documenting up to 17% accuracy loss from 0–4K to 8K+ tokens.

12. **"Do RAG Systems Really Suffer From Positional Bias?"** — EMNLP 2025. https://arxiv.org/html/2505.15561v1. Showed that realistic retrieval pipelines partially neutralize positional bias effects observed in synthetic settings.

13. **Databricks Long Context RAG Performance Study** — Databricks Mosaic Research (2024). https://www.databricks.com/blog/long-context-rag-performance-llms. Tested 20+ LLMs across 2K–2M tokens, mapping model-specific optimal context lengths.

14. **"Rotary Embeddings: A Relative Revolution"** — EleutherAI Blog. https://blog.eleuther.ai/rotary-embeddings/. Technical deep-dive on RoPE's mathematical derivation and implementation.

15. **LangChain LongContextReorder Documentation** — https://python.langchain.com/docs/how_to/long_context_reorder/. Reference implementation of sandwich-pattern document reordering for RAG systems.

16. **LlamaIndex LongContextReorder Documentation** — https://docs.llamaindex.ai/en/stable/examples/node_postprocessor/LongContextReorder/. Node postprocessor implementing extrema ordering and LongLLMLingua integration.

17. **"Positional Biases in Text Embedding Models"** — (2024). https://arxiv.org/html/2412.15241. Quantified RoPE's 15.4% vs ALiBi's 1.8% cosine similarity sensitivity to positional perturbation.

18. **"Found in the Middle: Calibrating Positional Attention Bias Improves Long Context Utilization"** — UW, MIT, Google Cloud AI (ACL Findings 2024). https://aclanthology.org/2024.findings-acl.890/. Attention calibration method achieving up to 15 percentage point improvement on mid-position retrieval.