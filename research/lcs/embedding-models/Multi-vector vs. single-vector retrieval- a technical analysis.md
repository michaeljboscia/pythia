# Multi-vector vs. single-vector retrieval: a technical analysis

**ColBERT-style multi-vector representations deliver 5–21 nDCG@10 points above standard bi-encoders on out-of-domain benchmarks, but the raw storage penalty—once 50× larger—has been compressed to near-parity with single-vector indices.** For RAG systems serving mixed code and documentation, the strongest architecture combines a fast single-vector first stage with ColBERT re-ranking, capturing both speed and the fine-grained token matching that code retrieval demands. This report grounds every claim in benchmark data from the [ColBERTv2 paper](https://aclanthology.org/2022.naacl-main.272.pdf), the [BEIR benchmark](https://arxiv.org/pdf/2104.08663), the [PLAID engine paper](https://arxiv.org/abs/2205.09707), and production telemetry from [Vespa](https://blog.vespa.ai/improving-zero-shot-ranking-with-vespa-part-two/) and [Qdrant](https://qdrant.tech/documentation/tutorials-search-engineering/using-multivector-representations/).

---

## How much better is ColBERT on BEIR and MS MARCO?

The quality gap between multi-vector and single-vector retrieval is substantial and consistent, though it varies dramatically by task type.

**On MS MARCO passage ranking** (in-domain), ColBERTv2 achieves **39.7 MRR@10**, the highest of any standalone retriever reported in the [ColBERTv2 paper's Table 4](https://aclanthology.org/2022.naacl-main.272.pdf). For context, representative bi-encoders score: DPR at 31.1, ANCE at 33.0, and the distilled TAS-B at 34.7. Even the strongest distilled single-vector model, RocketQAv2, reaches only 38.8—still nearly a full MRR point behind ColBERTv2. The original ColBERT v1 (without distillation) already hit 36.0 MRR@10, outperforming every non-distilled bi-encoder by **3–5 points**. Recall@1000 shows a tighter spread: ColBERTv2 at 98.4 versus DPR at 95.2, indicating the biggest gains appear in top-of-funnel precision rather than deep recall.

**On the BEIR benchmark** (zero-shot, out-of-domain), the gap widens. Using the 13 publicly available datasets from the ColBERTv2 paper, approximate average nDCG@10 scores are: DPR at ~35.0, ANCE at ~38.0, TAS-B at ~42.4, ColBERT v1 at ~44.0, and ColBERTv2 at ~48.1. ColBERTv2 thus exceeds the best non-distilled bi-encoder (ANCE) by roughly **10 nDCG@10 points** on average, and beats the distilled TAS-B by ~6 points. The only model matching ColBERTv2 on BEIR is SPLADEv2, a learned sparse model, at ~48.5—a fundamentally different architecture that relies on vocabulary expansion rather than dense token embeddings.

The gains are not uniform across datasets, and understanding where multi-vector shines reveals when the quality premium justifies extra cost:

- **Largest gains over DPR**: DBPedia entity retrieval (+21.0), SciFact scientific claims (+21.5), HotpotQA multi-hop questions (+22.2), TREC-COVID biomedical search (+17.7), and Natural Questions (+16.4). These are tasks with specialized terminology, precise entities, and short queries—exactly the conditions where token-level matching catches what a single compressed vector misses.

- **Smallest gains or underperformance**: ArguAna counter-argument retrieval (ColBERT v1 scored 23.3 versus DPR's 41.4—a **reversal**), Climate-FEVER (ColBERTv2 at 17.6 versus TAS-B at 22.8), and Touché argument retrieval where BM25 at 0.367 nDCG@10 outperformed all neural models. These tasks involve very long queries (~193 words for ArguAna) or require holistic semantic matching where fine-grained token interaction adds noise rather than signal.

**The quality gain justifies the overhead when** the retrieval task involves short-to-medium queries against specialized or heterogeneous corpora—particularly when out-of-domain generalization matters. For semantic relatedness tasks with long queries, single-vector representations can match or exceed ColBERT, and the storage cost is harder to justify.

---

## Storage overhead: from 154 GB to near-parity

The storage story has changed dramatically between ColBERT v1 and v2. Understanding the exact bytes-per-passage math reveals why compression was essential and how it was achieved.

**ColBERT v1** projects BERT's 768-dimensional hidden states to **128 dimensions** per token via a linear layer. At fp16 precision (2 bytes per dimension), each token embedding occupies **256 bytes**. An average MS MARCO passage produces ~75 token embeddings, yielding approximately **19,200 bytes (~19 KB) per passage**. Across 8.8 million passages, the full index consumed **154 GB** at fp16—or roughly 650 GB for Wikipedia's 21 million passages. A single-vector bi-encoder using 768-dimensional fp32 embeddings stores just **3,072 bytes per passage**, making ColBERT v1 roughly **6× larger per passage** even at fp16. At fp16 single-vector (1,536 bytes), the gap widens to **12×**.

**ColBERTv2's residual compression** closed this gap through a three-step process described in the [ColBERTv2 paper](https://aclanthology.org/2022.naacl-main.272.pdf). First, all corpus token embeddings are clustered via k-means into a codebook of centroids (with |C| proportional to √n, where n is the total embedding count). Second, for each token vector v, the nearest centroid C_t is identified and the residual r = v − C_t is computed. Third, each dimension of this residual is quantized to just **1 or 2 bits**. The storage per vector breaks down to:

- **2-bit residual**: 4 bytes (centroid ID) + 128 × 2 bits (32 bytes) = **36 bytes per vector**
- **1-bit residual**: 4 bytes (centroid ID) + 128 × 1 bit (16 bytes) = **20 bytes per vector**

At 2-bit precision with ~75 tokens per passage, ColBERTv2 requires approximately **2,700 bytes per passage**—close to the **3,072 bytes** of a 768-dimensional fp32 single vector. The MS MARCO index shrinks from 154 GB to **25 GB** (a **6× compression**) with no MRR@10 degradation (36.2 for both v1 and compressed v2). At 1-bit, the index reaches **16 GB** (a **10× compression**) with only 0.7 MRR@10 loss (35.5 versus 36.2). These numbers are confirmed in [Omar Khattab's Stanford lecture slides](https://web.stanford.edu/class/cs224v/lectures_2023/ColBERT-Stanford-224V-talk-Nov2023.pdf) and are consistent across multiple secondary sources.

| Representation | Bytes per passage | MS MARCO (8.8M) index | MRR@10 |
|---|---|---|---|
| ColBERT v1 (fp16) | ~19,200 | 154 GB | 36.2 |
| ColBERTv2 (2-bit) | ~2,700 | 25 GB | 36.2 |
| ColBERTv2 (1-bit) | ~1,500 | 16 GB | 35.5 |
| Single-vector (768d, fp32) | 3,072 | ~27 GB | — |
| Single-vector (768d, fp16) | 1,536 | ~13.5 GB | — |
| Single-vector (384d, fp32) | 1,536 | ~13.5 GB | — |

**Beyond residual compression**, several additional techniques further reduce multi-vector storage. [Token pooling](https://www.answer.ai/posts/colbert-pooling.html) from Answer.AI clusters similar token embeddings within each document and averages them, achieving **50% vector count reduction** at pool factor 2 with virtually no retrieval degradation, or **66% reduction** at factor 3 with minimal loss. This requires no model modification—it is applied as a post-processing step during indexing. [Vespa's binary ColBERT implementation](https://blog.vespa.ai/announcing-colbert-embedder-in-vespa/) binarizes each 128-dimensional vector to just **16 bytes** (1 bit per dimension, packed into bytes), achieving **32× compression** from fp32. Static token pruning—removing stopword embeddings—can cut token counts by ~30% with less than 0.01 MRR@10 loss. These techniques stack: ColBERTv2 residual compression plus token pooling at factor 2 could bring per-passage storage to roughly **1,350 bytes**—comparable to a 384-dimensional fp16 single vector.

The [PLAID engine](https://arxiv.org/abs/2205.09707) addressed the retrieval latency side of the efficiency problem. It treats each passage as a lightweight "bag of centroids," computing query-centroid distances once and reusing them across all passages. Only a small set of final candidates undergo full residual decompression and scoring. PLAID achieves **7× speedup on GPU and 45× on CPU** versus vanilla ColBERTv2, reaching tens of milliseconds per query at scale.

---

## The right architecture for RAG over code and documentation

For a RAG system indexing mixed code and documentation, **neither pure single-vector nor pure multi-vector retrieval is optimal alone—a hybrid pipeline captures the strengths of both**. The recommended architecture is a two-or-three-stage funnel that uses fast first-stage retrieval for recall and ColBERT re-ranking for precision.

**Why multi-vector matching matters specifically for code.** Single-vector embeddings compress an entire code snippet into one point in embedding space, creating an information bottleneck that is particularly damaging for code. Function names like `calculateTax()`, variable names, API calls, and import statements carry precise semantic meaning at the token level. ColBERT's MaxSim operation—which finds the best-matching document token for each query token and sums these scores—preserves distinctions that single-vector averaging destroys. A query about "sorting arrays" can match directly to `Arrays.sort()` tokens in a code snippet, even when the surrounding code context differs substantially. ColBERT's strong **zero-shot generalization** on BEIR (outperforming bi-encoders by 6–10 nDCG@10 points on out-of-domain tasks) is directly relevant here: specialized codebases are rarely represented in pre-training data, and token-level matching generalizes better to unseen terminology.

**The practical hybrid pipeline.** Production systems from [Vespa](https://blog.vespa.ai/pretrained-transformer-language-models-for-search-part-3/) and [Qdrant](https://qdrant.tech/documentation/advanced-tutorials/reranking-hybrid-search/) converge on a consistent architecture:

- **Stage 1 — Fast recall (BM25 + dense bi-encoder):** BM25 is critical for code because it handles exact identifier matching—searching for `torch.nn.Linear` should retrieve passages containing that exact string. A dense bi-encoder (e.g., E5, BGE, or a code-specialized model like Voyage Code-3) captures semantic similarity for documentation queries. Fuse both candidate sets via Reciprocal Rank Fusion (RRF). Retrieve **100–1,000 candidates** in under 25ms.

- **Stage 2 — ColBERT re-ranking:** Re-rank the top candidates using precomputed ColBERT document token embeddings with MaxSim scoring. This is where the quality gain materializes. Vespa's production benchmarks show MRR@10 jumping from **0.310 to 0.359** when adding ColBERT re-ranking to dense retrieval on MS MARCO, with total end-to-end latency of just **39ms**. On BEIR, Vespa's hybrid + ColBERT pipeline achieved best results on **12 of 13 datasets**, averaging 0.481 nDCG@10 in under 60ms. ColBERT consumes roughly **100× fewer FLOPs than cross-encoders**, allowing it to process 1,000+ candidates where a cross-encoder is limited to 10–50.

- **Stage 3 (optional) — Cross-encoder on top 10:** For high-stakes queries where maximum precision matters, a cross-encoder can refine the final ranking. This adds 40–80ms but is only necessary for the most demanding use cases.

**Implementation paths.** [RAGatouille](https://github.com/AnswerDotAI/RAGatouille) provides the fastest entry point: its `rerank()` method operates index-free, encoding documents and computing MaxSim at query time without a pre-built index. This is practical for re-ranking small candidate sets (up to a few hundred on GPU) and integrates directly into LangChain via `as_langchain_document_compressor()`. For production scale, Vespa offers native ColBERT support with SIMD-accelerated MaxSim and phased ranking pipelines, while Qdrant supports storing multi-vectors alongside dense vectors in the same collection—with HNSW indexing enabled for dense vectors (retrieval) and disabled for ColBERT vectors (re-ranking only).

**A specific recommendation for mixed code and documentation** is to tag each chunk with its content type during indexing. Code chunks should be split along function and class boundaries using language-aware chunking, while documentation uses semantic paragraph-level splits. The BM25 component of Stage 1 handles exact code identifier matching, the dense component handles natural-language documentation queries, and ColBERT re-ranking in Stage 2 bridges the cross-modal gap between natural-language questions and code tokens. [Jina ColBERT v2](https://jina.ai/news/jina-colbert-v2-multilingual-late-interaction-retriever-for-embedding-and-reranking/) is particularly suited here, having been trained with programming languages in its corpus and supporting 8,192-token context lengths with up to **50% storage reduction** via Matryoshka representation learning at flexible dimensions (128, 96, or 64).

---

## Conclusion

The multi-vector versus single-vector decision is no longer binary. ColBERTv2's residual compression reduced the storage gap from **50× to roughly 1×** compared to standard 768-dimensional embeddings, while preserving a consistent **5–10 nDCG@10 point advantage** on out-of-domain benchmarks. The quality premium is largest on specialized, entity-rich, and terminology-heavy tasks—precisely the profile of mixed code-and-documentation corpora. The most effective production architecture does not choose between approaches but layers them: BM25 plus dense bi-encoder for fast, high-recall first-stage retrieval, followed by ColBERT re-ranking that adds token-level precision at minimal latency cost (under 60ms end-to-end in Vespa benchmarks). For teams building RAG systems today, RAGatouille offers the lowest-friction path to ColBERT re-ranking, while Vespa and Qdrant provide the infrastructure for production-scale hybrid pipelines. The key insight is that **compression has neutralized ColBERT's storage weakness without touching its quality advantage**, making the hybrid approach dominant for any retrieval task where out-of-domain generalization and fine-grained matching matter.