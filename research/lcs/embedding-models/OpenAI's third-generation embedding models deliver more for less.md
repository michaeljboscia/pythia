# OpenAI's third-generation embedding models deliver more for less

OpenAI's **text-embedding-3-small** (1536 dimensions) and **text-embedding-3-large** (3072 dimensions), released January 25, 2024, represent a generational leap over their predecessor text-embedding-ada-002 — achieving higher benchmark scores at dramatically lower cost while introducing a novel dimension-reduction capability rooted in Matryoshka Representation Learning. The small model scores **62.3%** on MTEB versus ada-002's **61.0%** at one-fifth the price; the large model reaches **64.6%** at a modest premium. Perhaps most remarkably, the large model truncated to just 256 dimensions still outperforms the full 1536-dimension ada-002 embedding — a 6× reduction in vector size with no quality loss. These gains stem from training with multi-granularity loss functions that front-load semantic information into earlier dimensions, a technique that reshapes cost-performance tradeoffs for production retrieval systems.

## MTEB and MIRACL benchmarks reveal outsized multilingual gains

OpenAI published benchmark results for both models against ada-002 across two evaluation suites: MTEB (Massive Text Embedding Benchmark), the standard English-task evaluation covering retrieval, classification, clustering, and semantic similarity; and MIRACL, a multilingual retrieval benchmark spanning 18 languages ([OpenAI blog, January 2024](https://openai.com/index/new-embedding-models-and-api-updates/)).

The headline numbers tell a clear story. On MTEB overall average, text-embedding-3-small scores **62.3%**, text-embedding-3-large scores **64.6%**, and text-embedding-ada-002 scores **61.0%** ([OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)). The 3-small model thus represents a **1.3 percentage-point improvement** over ada-002, while the 3-large model achieves a **3.6 percentage-point gain**. These are meaningful but modest improvements on the English-centric MTEB suite.

The multilingual story is far more dramatic. On MIRACL, ada-002 scored only **31.4%**, while 3-small reached **44.0%** (a **12.6-point jump**) and 3-large hit **54.9%** (a **23.5-point improvement**) ([OpenAI blog](https://openai.com/index/new-embedding-models-and-api-updates/)). This nearly doubled multilingual retrieval performance, suggesting that the v3 models received substantially more multilingual training data or architectural improvements targeted at cross-lingual representation.

OpenAI did not publish per-task MTEB sub-scores (such as retrieval-only or classification-only breakdowns), providing only aggregated averages. Independent testing has offered some task-level data: on the StackOverflowDupQuestions retrieval task, ada-002 scored 50.5% while 3-small scored 51.4%, consistent with the modest English-task improvement pattern ([LanceDB benchmark, Medium](https://medium.com/etoai/openais-new-embeddings-with-lancedb-embeddings-api-a9d109f59305)). It is worth noting that the MTEB leaderboard has evolved considerably since January 2024, and numerous open-source models (including BGE, GTE, and Nomic variants) now exceed OpenAI's scores on specific tasks. OpenAI's v3 models were not submitted to the public MTEB leaderboard on Hugging Face, so direct apples-to-apples comparisons with newer open-source models require independent evaluation.

What distinguishes the v3 models from ada-002 most clearly is not raw English-task performance but rather the **combination of improved multilingual capability, lower pricing, and the dimension-reduction feature** — a trifecta that makes them categorically more versatile for production deployments.

## Matryoshka learning front-loads meaning into early dimensions

Both v3 models were trained using **Matryoshka Representation Learning (MRL)**, a technique introduced by Kusupati et al. at NeurIPS 2022 ([arXiv:2205.13147](https://arxiv.org/abs/2205.13147)). OpenAI confirmed this after their January 2024 announcement, linking to the MRL paper with a footnote in their blog post. The confirmation was further corroborated by Pinecone, who reported that OpenAI acknowledged the technique "after some prodding" ([Pinecone analysis](https://www.pinecone.io/learn/openai-embeddings-v3/)).

**How MRL works at the training level.** In standard embedding model training, a single loss function is computed on the full-dimension output vector. MRL modifies this by computing losses at **multiple prefix dimensionalities simultaneously** — for example, at dimensions 256, 512, 1024, and the full dimension. These losses are summed into a composite objective: `L_total = L(first 256d) + L(first 512d) + L(first 1024d) + L(full d)`. Optimizing this composite loss forces the model to **pack the most semantically important information into the earliest dimensions**, with later dimensions adding progressively finer detail ([Hugging Face MRL tutorial](https://huggingface.co/blog/matryoshka)). The metaphor is apt: like Russian nesting dolls (matryoshki), each prefix of the embedding contains a complete, if lower-resolution, representation.

Critically, MRL adds **negligible training overhead** — only extra loss computations, not additional forward passes. The technique is architecture-agnostic and has been demonstrated across vision models (ResNet, ViT), vision-language models (ALIGN), and language models (BERT) ([Kusupati et al., 2022](https://arxiv.org/abs/2205.13147)).

**Reverse-engineering OpenAI's training granularities.** Weaviate's engineering team analyzed the standard deviation of embedding values across dimensions for 10,000 sample texts, revealing distinct plateaus that correspond to MRL loss boundaries. Their analysis concluded that text-embedding-3-large was trained with **four aggregated loss functions at dimensions {512, 1024, 1536, 3072}**, while text-embedding-3-small was trained at **{512, 1536}** ([Weaviate blog](https://weaviate.io/blog/openais-matryoshka-embeddings-in-weaviate)). This means the information density within each "band" of dimensions is relatively uniform, with discrete jumps in representation quality at each MRL checkpoint.

**Measured quality at reduced dimensions.** OpenAI published MTEB scores at selected dimension levels in their announcement blog post. The key data points are:

- text-embedding-3-large at **3072d** (full): **64.6%** MTEB
- text-embedding-3-large at **1024d**: approximately **64.1%** MTEB
- text-embedding-3-large at **256d**: approximately **62.0%** MTEB
- text-embedding-3-small at **1536d** (full): **62.3%** MTEB
- text-embedding-3-small at **512d**: approximately **61.6%** MTEB
- text-embedding-ada-002 at **1536d** (full): **61.0%** MTEB

The precise sub-full-dimension scores were displayed in a chart rather than as text values in OpenAI's blog; the approximate figures above are drawn from community analysis of that chart ([OpenAI Community Forum](https://community.openai.com/t/mteb-benchmark-for-v3-small-embedding-model-with-256-dimensions/613369)). The standout finding: **text-embedding-3-large at just 256 dimensions (~62.0%) outperforms full-dimension ada-002 (~61.0%)**, achieving better quality with **6× fewer dimensions** and proportionally less storage and compute for similarity operations.

Microsoft's Azure SQL team independently validated that **1024 dimensions is a practical "sweet spot"** for text-embedding-3-large, delivering "pretty much the same performance as 3072 dimensions" while using only 4 KB per vector instead of 12 KB ([Azure SQL Dev Corner](https://devblogs.microsoft.com/azure-sql/embedding-models-and-dimensions-optimizing-the-performance-resource-usage-ratio/)). Weaviate's PCA visualization showed that by 512 dimensions, the overall structure of the vector space is well-defined, with dimensions beyond ~2000 contributing only minor jittering ([Weaviate blog](https://weaviate.io/blog/openais-matryoshka-embeddings-in-weaviate)).

**Comparison with post-hoc reduction methods.** MRL's advantage over PCA or SVD-based dimension reduction is substantial. The original MRL paper demonstrated **up to 14× compression** with negligible accuracy loss on ImageNet-1K, while post-hoc SVD compression and random projection methods "drastically lose accuracy" at comparable compression ratios ([Kusupati et al., 2022](https://arxiv.org/abs/2205.13147)). A 2024 follow-up paper on Matryoshka-Adaptor confirmed that PCA can actually cause performance degradation at higher dimensions, while MRL-based methods maintain quality across the spectrum ([arXiv:2407.20243](https://arxiv.org/html/2407.20243v1)).

**Normalization after truncation.** When using the `dimensions` API parameter, OpenAI handles re-normalization automatically — the returned vector has L2 norm = 1 and is ready for cosine similarity computation. When truncating stored embeddings manually, developers must re-normalize: divide each truncated vector by its L2 norm. Without this step, cosine similarity calculations produce incorrect results because truncation changes the vector's magnitude ([OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)).

## Operational realities for production embedding pipelines

**Token limits and tokenization.** All three embedding models (3-small, 3-large, and ada-002) accept a maximum of **8,191 tokens per individual text input** and use the **cl100k_base tokenizer**, the same tokenizer used by GPT-4 ([OpenAI Cookbook](https://cookbook.openai.com/examples/embedding_long_inputs)). Texts exceeding this limit must be chunked, with the resulting chunk embeddings either stored separately or averaged (weighted by chunk length) to produce a single document-level vector. The `tiktoken` Python library provides client-side token counting before submission.

**Current pricing.** Pricing is assessed purely on input tokens — there are no output token charges, and reducing the `dimensions` parameter does not affect cost. As of early 2026, the confirmed rates are:

- **text-embedding-3-small**: **$0.02 per million tokens** (standard), $0.01 per million tokens (Batch API)
- **text-embedding-3-large**: **$0.13 per million tokens** (standard), $0.065 per million tokens (Batch API)
- **text-embedding-ada-002**: $0.10 per million tokens (standard), $0.05 per million tokens (Batch API)

These prices were established at launch and confirmed through actual billing records and OpenAI support responses ([CostGoat pricing calculator](https://costgoat.com/pricing/openai-embeddings); [OpenAI Community](https://community.openai.com/t/pricing-discrepancy-for-embedding-models-between-pricing-page-and-model-docs/1346972)). The 3-small model is thus **5× cheaper** than ada-002 while delivering better performance — a rare case of simultaneous quality improvement and cost reduction. The 3-large model costs **30% more** than ada-002, justified by its superior quality and flexible dimensionality.

**Batching and rate limits.** The synchronous embeddings endpoint accepts up to **2,048 text strings per request** with a combined maximum of **300,000 tokens across all inputs** in a single call ([OpenAI API Reference](https://platform.openai.com/docs/api-reference/embeddings/create)). Rate limits vary by account tier and are viewable in each organization's dashboard; at Tier 5 (qualifying with $1,000+ spend over 30 days), community reports indicate **10,000 requests per minute** and **10,000,000 tokens per minute** for embedding models ([OpenAI Rate Limits Guide](https://platform.openai.com/docs/guides/rate-limits)). The asynchronous Batch API accepts up to 50,000 requests per batch file, with a 24-hour completion window (often faster in practice), at a 50% price discount using a separate rate-limit pool ([OpenAI Batch Guide](https://platform.openai.com/docs/guides/batch)).

**Latency characteristics.** Nixiesearch conducted a week-long latency benchmark in April 2025, sending single-text requests to text-embedding-3-small from AWS us-east-1 at 1 request per 5 seconds. They measured **median (P50) latency of approximately 200–300 ms**, **P90 of ~500 ms**, and **P99 extending to ~5 seconds**, with an error rate of 0.05% ([Nixiesearch benchmark](https://nixiesearch.substack.com/p/benchmarking-api-latency-of-embedding)). A notable finding: **latency showed no meaningful correlation with input token length**, suggesting OpenAI batches incoming requests server-side with an internal batching window of approximately 300 ms. A separate Milvus benchmark (May 2025) confirmed that OpenAI's latency was fairly consistent between small and large batch sizes, and that the 3-small and 3-large models exhibited minimal latency differences ([Milvus blog](https://milvus.io/blog/we-benchmarked-20-embedding-apis-with-milvus-7-insights-that-will-surprise-you.md)).

**Concrete cost and throughput example.** Embedding 1,000 documents of 512 tokens each totals **512,000 tokens**. This exceeds the 300,000-token per-request limit, requiring **two API calls** (e.g., ~585 documents in the first call, ~415 in the second). The cost would be **$0.01** with text-embedding-3-small or **$0.067** with text-embedding-3-large. At median latency and accounting for batching, wall-clock time for both calls would be roughly **1–3 seconds** with a warmed connection, dominated by server-side batch processing rather than per-token computation. Using the Batch API, the same workload costs **$0.005** (3-small) or **$0.033** (3-large) but with a latency window of up to 24 hours.

## Choosing dimensions and models in practice

The practical decision framework for these models centers on a three-way tradeoff: **quality, storage cost, and compute cost** for similarity operations. For most retrieval and RAG applications, text-embedding-3-small at full 1536 dimensions offers the best cost-to-performance ratio — it matches or exceeds ada-002's quality at 80% less cost. For applications where retrieval precision is critical (legal search, scientific literature, complex multilingual queries), text-embedding-3-large at 1024 or 3072 dimensions provides measurably better results. The dimension-reduction feature makes text-embedding-3-large at 256 dimensions an intriguing middle ground: **better quality than ada-002 at full dimension**, with vector storage costs reduced by 6× compared to the large model's default and competitive with the small model's storage footprint.

One important caveat: **embeddings from different models are not interchangeable**. A 256-dimensional vector from text-embedding-3-large and a 256-dimensional vector from text-embedding-3-small encode different semantic spaces. They cannot be mixed in the same vector index or compared meaningfully. Any dimension-reduction decision must be made per-model and applied consistently across an entire index.

## Conclusion

OpenAI's v3 embedding models represent a meaningful advance over ada-002, particularly in multilingual retrieval where MIRACL scores nearly doubled. The integration of Matryoshka Representation Learning transforms embeddings from fixed-size artifacts into flexible, multi-resolution representations — enabling developers to precisely calibrate the tradeoff between vector size and semantic fidelity after model training. The 1024-dimension sweet spot for text-embedding-3-large, delivering ~99.2% of full-dimension quality at one-third the storage, is perhaps the most actionable insight for production systems. At **$0.02 per million tokens**, the small model has made high-quality embeddings effectively free for most workloads, while the Batch API's 50% discount further reduces costs for offline indexing. The remaining gap in OpenAI's documentation is the absence of per-task MTEB breakdowns and formal architecture disclosure — limitations that matter less for practitioners focused on end-to-end retrieval quality but more for researchers seeking to understand and improve upon these representations.

## Bibliography

**"New embedding models and API updates"** — OpenAI Blog, January 25, 2024.
https://openai.com/index/new-embedding-models-and-api-updates/
Primary announcement of text-embedding-3-small and text-embedding-3-large. Provides MTEB and MIRACL benchmark scores, pricing, and the dimension-reduction feature description. The authoritative source for all headline performance claims.

**OpenAI Embeddings Guide** — OpenAI Platform Documentation.
https://platform.openai.com/docs/guides/embeddings
Official guide covering model specifications, max token limits (8,191), usage examples, dimension parameter behavior, and normalization requirements after truncation.

**OpenAI API Reference: Embeddings** — OpenAI Platform Documentation.
https://platform.openai.com/docs/api-reference/embeddings/create
Technical API specification including the 2,048-item batch limit, 300,000-token per-request cap, and supported parameters (model, input, dimensions, encoding_format).

**"Matryoshka Representation Learning"** — Aditya Kusupati, Gantavya Bhatt, Aniket Rege, Matthew Wallingford, Aditya Sinha, Vivek Ramanujan, William Howard-Snyder, Kaifeng Chen, Sham Kakade, Prateek Jain, Ali Farhadi. NeurIPS 2022.
https://arxiv.org/abs/2205.13147
Foundational paper introducing multi-granularity loss training for embeddings. Demonstrates up to 14× compression with negligible accuracy loss and proves superiority over post-hoc SVD and random projection methods.

**"OpenAI's Matryoshka Embeddings in Weaviate"** — Weaviate Blog.
https://weaviate.io/blog/openais-matryoshka-embeddings-in-weaviate
Reverse-engineers MRL training granularities for both v3 models via standard-deviation analysis. Identifies text-embedding-3-large's loss checkpoints at {512, 1024, 1536, 3072} and text-embedding-3-small at {512, 1536}. Includes PCA visualizations of dimension contribution.

**"OpenAI Embeddings v3"** — Pinecone Learning Center.
https://www.pinecone.io/learn/openai-embeddings-v3/
Independent analysis confirming OpenAI's use of MRL training. Provides detailed walkthrough of dimension-reduction behavior and practical implementation guidance.

**"Embedding models and dimensions: optimizing the performance-resource-usage ratio"** — Azure SQL Dev Corner, Microsoft Developer Blogs.
https://devblogs.microsoft.com/azure-sql/embedding-models-and-dimensions-optimizing-the-performance-resource-usage-ratio/
Identifies 1024 dimensions as the practical sweet spot for text-embedding-3-large, demonstrating near-full-dimension quality at one-third the storage cost.

**"Benchmarking API latency of embedding providers"** — Nixiesearch, April 2025.
https://nixiesearch.substack.com/p/benchmarking-api-latency-of-embedding
Week-long latency study from AWS us-east-1 measuring P50 (~200–300 ms), P90 (~500 ms), and P99 (~5 s) for text-embedding-3-small. Reveals that input length does not meaningfully affect latency, implying server-side request batching.

**"We benchmarked 20 embedding APIs — 7 insights that will surprise you"** — Milvus Blog, May 2025.
https://milvus.io/blog/we-benchmarked-20-embedding-apis-with-milvus-7-insights-that-will-surprise-you.md
Multi-provider latency and throughput comparison. Confirms OpenAI's consistent latency between model sizes and batch configurations.

**OpenAI Embeddings API Pricing Calculator** — CostGoat, March 2026.
https://costgoat.com/pricing/openai-embeddings
Independent pricing verification: text-embedding-3-small at $0.02/1M tokens, text-embedding-3-large at $0.13/1M tokens, with Batch API at 50% discount.

**OpenAI Rate Limits Guide** — OpenAI Platform Documentation.
https://platform.openai.com/docs/guides/rate-limits
Official documentation on tier-based rate limiting, including RPM/TPM structure and exponential backoff recommendations.

**"Matryoshka Representation Learning"** — Hugging Face Blog Tutorial.
https://huggingface.co/blog/matryoshka
Accessible tutorial explaining MRL training methodology, composite loss function implementation, and integration with the Sentence Transformers library.

**"Embedding Long Inputs"** — OpenAI Cookbook.
https://cookbook.openai.com/examples/embedding_long_inputs
Official guidance on handling texts exceeding the 8,191-token limit, including chunking strategies and weighted averaging of chunk embeddings. Confirms cl100k_base tokenizer usage.