# Embedding models for retrieval: a 2025 MTEB performance analysis

**The best embedding model for retrieval depends heavily on whether you can self-host.** NVIDIA's NV-Embed-v2 leads MTEB retrieval benchmarks with an NDCG@10 of 62.65, but its non-commercial license limits production use. For commercial deployments, Voyage AI's models offer the strongest retrieval quality per dollar, while Alibaba's Qwen3-Embedding-8B dominates the open-source leaderboard. Matryoshka-trained models retain 99% of retrieval performance at one-quarter their full dimensionality, making 256–512 dimensions the practical sweet spot for most production systems. This analysis synthesizes MTEB leaderboard data, Matryoshka Representation Learning research, and current API pricing to guide model selection for retrieval-focused applications.

## The top-5 retrieval models reveal a gap between overall and retrieval scores

The [Massive Text Embedding Benchmark (MTEB)](https://huggingface.co/spaces/mteb/leaderboard) evaluates embedding models across eight task categories—classification, clustering, pair classification, reranking, retrieval, semantic textual similarity (STS), summarization, and bitext mining. Retrieval tasks use **NDCG@10** across 15 BEIR datasets as the primary metric. A critical insight for practitioners: overall MTEB scores average across all task types, which can mask retrieval-specific weaknesses. Models optimized for STS or classification earn inflated overall scores while underperforming at the search tasks that matter most for RAG pipelines.

On the [MTEB v1 English benchmark](https://huggingface.co/spaces/mteb/leaderboard) (56 datasets), the top-5 models ranked by retrieval NDCG@10 are:

| Rank | Model | Retrieval (NDCG@10) | Overall MTEB | Params | Dimensions | License |
|------|-------|---------------------|-------------|--------|------------|---------|
| 1 | [NV-Embed-v2](https://huggingface.co/nvidia/NV-Embed-v2) | **62.65** | 72.31 | 7.85B | 4096 | CC-BY-NC-4.0 |
| 2 | [SFR-Embedding-Mistral](https://www.salesforce.com/blog/sfr-embedding/) | **59.00** | 67.56 | ~7B | 4096 | Research only |
| 3 | [E5-Mistral-7B-Instruct](https://huggingface.co/intfloat/e5-mistral-7b-instruct) | **~56.9** | 66.63 | 7B | 4096 | MIT |
| 4 | [text-embedding-3-large](https://platform.openai.com/docs/guides/embeddings) (OpenAI) | **55.4** | 64.6 | Proprietary | 3072 | Commercial API |
| 5 | [embed-english-v3](https://docs.cohere.com/v2/reference/embed) (Cohere) | **55.0** | 64.5 | Proprietary | 1024 | Commercial API |

Every model shows a **7–10 point gap** between retrieval and overall scores. NV-Embed-v2 scores 72.31 overall but only 62.65 on retrieval—a 9.66-point delta. OpenAI's text-embedding-3-large drops from 64.6 to 55.4, a 9.2-point gap. This pattern confirms that retrieval is consistently the hardest MTEB category and that teams selecting models for search or RAG must evaluate retrieval sub-scores specifically.

The competitive landscape shifted substantially in 2025. [Qwen3-Embedding-8B](https://qwenlm.github.io/blog/qwen3-embedding/) from Alibaba now scores **75.22 on MTEB English v2** and 70.58 on the multilingual benchmark, claiming the overall leaderboard crown with an Apache 2.0 license. [Google's Gemini-embedding-001](https://ai.google.dev/gemini-api/docs/embeddings) posts 73.30 on English v2. However, these scores come from [MTEB v2 and MMTEB](https://arxiv.org/html/2506.21182v1), which use different datasets and evaluation protocols, making direct comparison with MTEB v1 scores impossible.

Among commercial models, [Voyage AI's voyage-3-large](https://blog.voyageai.com/2025/01/07/voyage-3-large/) claims to outperform OpenAI text-embedding-3-large by **9.74%** and Cohere embed-v3 by **20.71%** on Voyage's own 100-dataset retrieval evaluation. Their [newer voyage-4 series](https://docs.voyageai.com/docs/embeddings) extends this with a mixture-of-experts architecture and shared embedding spaces across model tiers. Cohere's [embed-v4](https://docs.cohere.com/changelog) raises the bar with **128K token context** and multimodal support, though its retrieval-specific MTEB numbers remain comparable to v3.

One cautionary note: [data contamination is a growing concern](https://arxiv.org/html/2506.21182v1). MTEB maintainers have shifted from self-reported to verified results after discovering models fine-tuned directly on benchmark training sets. Voyage AI itself offers a model called voyage-3-m-exp explicitly "tailored to datasets similar to MTEB." The [NV-Embed-v2 paper](https://arxiv.org/html/2405.17428v3) also highlights that SFR-Embedding-2R beats SFR-Embedding-Mistral on MTEB overall (70.31 vs 67.56) yet trails it on the independent AIR-Bench retrieval benchmark (49.47 vs 51.58), suggesting MTEB retrieval scores do not always predict real-world search quality.

## Matryoshka embeddings make 256 dimensions almost as good as 3072

The [Matryoshka Representation Learning (MRL) paper](https://arxiv.org/abs/2205.13147) by Kusupati et al. (NeurIPS 2022) introduced a training technique that produces embeddings effective at multiple nested dimensionalities. The method modifies the loss function to simultaneously optimize at each truncation point—say, dimensions {8, 16, 32, 64, 128, 256, 512, 1024, 2048}. This forces the model to **frontload the most important semantic information into the earliest dimensions**, creating a coarse-to-fine representation hierarchy with negligible training overhead.

The most detailed dimension-by-dimension retrieval data comes from the [jina-embeddings-v3 paper](https://arxiv.org/abs/2409.10173) (Table 7), which reports NDCG@10 on retrieval tasks at each MRL truncation point:

| Dimensions | Retrieval NDCG@10 | % of Full (1024d) | Marginal Gain |
|-----------|-------------------|-------------------|---------------|
| 32 | 52.54 | 82.9% | — |
| 128 | 61.64 | 97.3% | +9.10 |
| 256 | 62.72 | **99.0%** | +1.08 |
| 512 | 63.16 | 99.7% | +0.44 |
| 768 | 63.30 | 99.9% | +0.14 |
| 1024 | 63.35 | 100.0% | +0.05 |

The diminishing returns are stark. Going from 128 to 256 dimensions adds just 1.08 NDCG points. From 256 to 512, the gain drops to 0.44 points. **Beyond 512 dimensions, each doubling yields less than 0.2 points**—a difference unlikely to matter in production. [DeepLearning.AI's analysis](https://www.deeplearning.ai/the-batch/jina-ai-launches-jina-embeddings-v3-a-text-embedding-model-with-task-specific-adapters/) confirmed that "using embeddings that are one-eighth the typical size degrades performance by only 2%." Jina AI's own evaluation finds their model [retains 92% of retrieval performance at just 64 dimensions](https://jina.ai/models/jina-embeddings-v3/).

OpenAI's implementation provides additional evidence. Their [embedding models announcement](https://openai.com/index/new-embedding-models-and-api-updates/) revealed that **text-embedding-3-large truncated to 256 dimensions outperforms the full 1536-dimensional text-embedding-ada-002** on MTEB—a 6× size reduction beating the previous generation at full size. A [Microsoft Azure SQL team analysis](https://devblogs.microsoft.com/azure-sql/embedding-models-and-dimensions-optimizing-the-performance-resource-usage-ratio/) concluded that **1024 dimensions is the "sweet spot"** for text-embedding-3-large, delivering "pretty much the same performance" as 3072 dimensions while using 3× less storage. [Weaviate's PCA visualization study](https://weaviate.io/blog/openais-matryoshka-embeddings-in-weaviate) of text-embedding-3-large showed that vector space structure is well-defined by 512 dimensions, with dimensions beyond 2000 contributing only negligible jittering.

The general principle emerging from MRL research: **approximately 25% of the full dimension captures ~99% of retrieval performance**, while 12.5% (1/8th) retains 97–98%. For a 3072-dimensional model, 768 dimensions suffice; for a 1024-dimensional model, 256 is adequate. Models now widely supporting MRL include [OpenAI's text-embedding-3 series](https://platform.openai.com/docs/guides/embeddings), [Cohere embed-v4](https://docs.cohere.com/v2/reference/embed) (256–1536d), [Voyage AI's voyage-4 family](https://docs.voyageai.com/docs/embeddings) (256–2048d), [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) (64–768d), and [Qwen3-Embedding](https://qwenlm.github.io/blog/qwen3-embedding/) (32–4096d).

Follow-up work has extended MRL further. [Matryoshka-Adaptor](https://arxiv.org/abs/2407.20243) (2024) applies post-hoc dimensionality reduction to black-box API embeddings, achieving 2–6× compression with no performance loss on BEIR datasets. Mixedbread's [2D-Matryoshka approach](https://www.mixedbread.com/blog/mxbai-embed-2d-large-v1) extends MRL to also truncate model layers, enabling combined 8× dimension reduction plus 50% layer reduction while maintaining competitive retrieval quality.

## API pricing spans 6× but latency differences are surprisingly small

The commercial embedding API market has compressed dramatically on price. At the budget tier, [OpenAI's text-embedding-3-small](https://platform.openai.com/docs/guides/embeddings) and [Voyage AI's voyage-4-lite](https://docs.voyageai.com/docs/pricing) both cost **$0.02 per million tokens**. OpenAI's batch API halves this to $0.01/1M tokens. At the premium tier, [OpenAI text-embedding-3-large costs $0.13/1M tokens](https://platform.openai.com/docs/guides/embeddings), [Voyage AI voyage-4-large costs $0.12/1M tokens](https://docs.voyageai.com/docs/pricing), and [Cohere embed-v4 costs $0.12/1M tokens](https://cohere.com/pricing).

| Provider / Model | Price/1M Tokens | Batch Price | Max Context | Dimensions | Quantization |
|---|---|---|---|---|---|
| OpenAI text-embedding-3-small | $0.02 | $0.01 | 8,192 | 1536 (MRL) | Float only |
| OpenAI text-embedding-3-large | $0.13 | $0.065 | 8,192 | 3072 (MRL) | Float only |
| Voyage AI voyage-4-lite | $0.02 | ~$0.013 | 32,000 | 1024 (MRL) | float/int8/binary |
| Voyage AI voyage-4 | $0.06 | ~$0.04 | 32,000 | 1024 (MRL) | float/int8/binary |
| Voyage AI voyage-4-large | $0.12 | ~$0.08 | 32,000 | 2048 (MRL) | float/int8/binary |
| Cohere embed-v4 | $0.12 | N/A | 128,000 | 1536 (MRL) | float/int8/binary |
| Cohere embed-v3 | $0.10 | N/A | 512 | 1024 | float/int8/binary |

The **best retrieval quality per dollar** likely belongs to Voyage AI's voyage-4 at $0.06/1M tokens—roughly half the cost of OpenAI text-embedding-3-large while [outperforming it on retrieval benchmarks](https://blog.voyageai.com/2025/01/07/voyage-3-large/). Cohere embed-v4's **128K context window** is unique and eliminates chunking for long-document use cases, though at a premium price with no batch discount. Voyage AI's [shared embedding space across the v4 series](https://docs.voyageai.com/docs/embeddings) enables an asymmetric strategy: embed documents with voyage-4-large and queries with voyage-4-lite, cutting query-time costs while maintaining document-side quality.

On latency, a [Nixiesearch benchmark (April 2025)](https://nixiesearch.substack.com/p/benchmarking-api-latency-of-embedding) found Cohere delivers the **lowest median latency** among major providers, with OpenAI showing P90 latency around 500ms and P99 spikes to 5 seconds. A [comprehensive Milvus benchmark (May 2025)](https://milvus.io/blog/we-benchmarked-20-embedding-apis-with-milvus-7-insights-that-will-surprise-you.md) confirmed the ranking as Cohere > Google Vertex > Voyage AI > OpenAI for North American deployments. All cloud APIs typically land in the **200–500ms median latency range** for single requests, with cross-region calls adding a 3–4× penalty.

## Self-hosting drops costs by 10–50× at scale

Open-source models offer dramatically lower per-token costs at sufficient volume. [BGE-large-en-v1.5](https://huggingface.co/BAAI/bge-large-en-v1.5) (335M params, MIT license) running on an A10G GPU via [HuggingFace Text Embeddings Inference (TEI)](https://github.com/huggingface/text-embeddings-inference) achieves **450+ requests/second** at sequence length 512, translating to roughly **$0.002 per million tokens**—65× cheaper than OpenAI text-embedding-3-large. For higher quality, [GTE-Qwen2-7B-instruct](https://huggingface.co/Alibaba-NLP/gte-Qwen2-7B-instruct) (Apache 2.0) scores 70.72 on MTEB with a retrieval NDCG@10 of 58.09, but requires an A100 80GB GPU (~$1.49/hr on specialized providers like [JarvisLabs](https://docs.jarvislabs.ai/blog/a100-price)) and processes roughly 2,000 tokens/second—yielding an effective cost around $0.01–0.02/1M tokens.

The break-even calculus depends on volume and model size. For **small encoder models** (BGE-large at 335M params), API pricing is so cheap ($0.02/1M for OpenAI's small model) that self-hosting only wins above roughly **10 billion tokens per month**—a volume most teams never reach. For **7B decoder-based models** like E5-Mistral or GTE-Qwen2-7B, an A100 running 24/7 costs ~$1,100/month and can process unlimited tokens; this breaks even against API pricing around 10–50B tokens/month depending on the API model chosen.

Self-hosting's real advantages are **latency and control**. Local GPU inference achieves **4–10ms per request** versus 200–500ms for cloud APIs—a 50× improvement critical for real-time applications. CPU inference with ONNX-quantized models like [BGE-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) (33M params, 127MB) can hit sub-10ms latency on modern server CPUs. Self-hosting also enables custom fine-tuning, data privacy guarantees, and freedom from rate limits. The practical deployment tiers break down as follows: a T4 GPU (~$0.27/hr) handles BGE-small/base at 1–5K sentences/second; an L4 or A10G (~$0.39–0.50/hr) serves BGE-large or [BGE-M3](https://huggingface.co/BAAI/bge-m3) (568M params, 8K context, multi-vector retrieval) at production throughput; and an A100 ($1.49/hr) runs the 7B-parameter models that compete with commercial APIs on quality.

## Conclusion

Three findings stand out from this analysis. First, **retrieval benchmarks tell a different story than overall MTEB scores**—the gap runs 7–10 points consistently, and teams building search or RAG systems who select models on overall score are likely making suboptimal choices. Second, **Matryoshka representation learning has effectively decoupled embedding quality from dimension count**: 256 dimensions retain 99% of retrieval performance for a 1024-dimensional model, enabling 4× storage savings and faster similarity search with negligible accuracy loss. The practical sweet spot sits at roughly 25% of a model's full dimensionality. Third, the **commercial API price war has made self-hosting economically justified only at extreme scale** (10B+ tokens/month) unless latency, privacy, or fine-tuning requirements dominate. For most teams, Voyage AI's voyage-4 at $0.06/1M tokens offers the best retrieval quality per dollar among APIs, while BGE-large-en-v1.5 remains the workhorse open-source model for cost-sensitive deployments. The emergence of Qwen3-Embedding-8B with Apache 2.0 licensing and state-of-the-art scores may shift this landscape—it combines frontier quality with the freedom to self-host, fine-tune, and deploy without restriction.

## Bibliography

- **MTEB: Massive Text Embedding Benchmark** — Muennighoff et al., 2022. [https://huggingface.co/spaces/mteb/leaderboard](https://huggingface.co/spaces/mteb/leaderboard). Establishes the standard benchmark for embedding model evaluation across 8 task categories and 56+ datasets.

- **Matryoshka Representation Learning** — Kusupati et al., NeurIPS 2022. [https://arxiv.org/abs/2205.13147](https://arxiv.org/abs/2205.13147). Introduces multi-scale embedding training that enables flexible dimensionality with graceful performance degradation.

- **NV-Embed: Improved Techniques for Training LLMs as Generalist Embedding Models** — Lee et al., NVIDIA, 2024. [https://arxiv.org/html/2405.17428v3](https://arxiv.org/html/2405.17428v3). Describes latent attention pooling and two-stage instruction tuning that achieved #1 on MTEB.

- **Jina Embeddings v3: A Frontier Multilingual Embedding Model** — Sturua et al., 2024. [https://arxiv.org/abs/2409.10173](https://arxiv.org/abs/2409.10173). Provides the most detailed MRL dimension-by-dimension retrieval ablation data (Table 7).

- **OpenAI New Embedding Models and API Updates** — OpenAI, January 2024. [https://openai.com/index/new-embedding-models-and-api-updates/](https://openai.com/index/new-embedding-models-and-api-updates/). Announces text-embedding-3-large/small with native Matryoshka support and shows 256d outperforming ada-002 at 1536d.

- **Embedding Models and Dimensions: Optimizing Performance-Resource Ratio** — Microsoft Azure SQL Team, 2024. [https://devblogs.microsoft.com/azure-sql/embedding-models-and-dimensions-optimizing-the-performance-resource-usage-ratio/](https://devblogs.microsoft.com/azure-sql/embedding-models-and-dimensions-optimizing-the-performance-resource-usage-ratio/). Identifies 1024 dimensions as the sweet spot for text-embedding-3-large.

- **OpenAI's Matryoshka Embeddings in Weaviate** — Weaviate Blog, 2024. [https://weaviate.io/blog/openais-matryoshka-embeddings-in-weaviate](https://weaviate.io/blog/openais-matryoshka-embeddings-in-weaviate). PCA visualization study showing vector space structure stabilizes by 512 dimensions.

- **Voyage-3-large Announcement** — Voyage AI Blog, January 2025. [https://blog.voyageai.com/2025/01/07/voyage-3-large/](https://blog.voyageai.com/2025/01/07/voyage-3-large/). Reports 9.74% retrieval improvement over OpenAI text-embedding-3-large.

- **Voyage AI Embedding Documentation and Pricing** — Voyage AI, 2025–2026. [https://docs.voyageai.com/docs/pricing](https://docs.voyageai.com/docs/pricing). Current pricing for voyage-4 series and feature documentation.

- **Cohere Embed v4 Documentation** — Cohere, 2025. [https://cohere.com/pricing](https://cohere.com/pricing) and [https://docs.cohere.com/v2/reference/embed](https://docs.cohere.com/v2/reference/embed). Pricing, 128K context, and multimodal capabilities.

- **OpenAI Embeddings Guide and Pricing** — OpenAI, 2024–2025. [https://platform.openai.com/docs/guides/embeddings](https://platform.openai.com/docs/guides/embeddings). Model specifications, dimension options, and batch API pricing.

- **Qwen3-Embedding Blog** — Alibaba Qwen Team, 2025. [https://qwenlm.github.io/blog/qwen3-embedding/](https://qwenlm.github.io/blog/qwen3-embedding/). Reports MTEB English v2 score of 75.22 and multilingual score of 70.58.

- **SFR-Embedding: Salesforce AI Research** — Salesforce, 2024. [https://www.salesforce.com/blog/sfr-embedding/](https://www.salesforce.com/blog/sfr-embedding/). Describes task-homogeneous batching for retrieval-optimized embeddings.

- **BGE-large-en-v1.5 Model Card** — BAAI, 2023. [https://huggingface.co/BAAI/bge-large-en-v1.5](https://huggingface.co/BAAI/bge-large-en-v1.5). MIT-licensed 335M-parameter model specifications and MTEB score of 64.23.

- **BGE-M3 Model Card** — BAAI, 2024. [https://huggingface.co/BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3). Multi-retrieval-mode (dense/sparse/multi-vector) embedding model supporting 100+ languages.

- **GTE-Qwen2-7B-Instruct Model Card** — Alibaba NLP, 2024. [https://huggingface.co/Alibaba-NLP/gte-Qwen2-7B-instruct](https://huggingface.co/Alibaba-NLP/gte-Qwen2-7B-instruct). Reports MTEB English 70.72 and retrieval NDCG@10 of 58.09.

- **E5-Mistral-7B-Instruct Model Card** — Microsoft, 2024. [https://huggingface.co/intfloat/e5-mistral-7b-instruct](https://huggingface.co/intfloat/e5-mistral-7b-instruct). MIT-licensed 7B decoder-based embedding model with MTEB score of 66.63.

- **Benchmarking API Latency of Embedding Models** — Nixiesearch, April 2025. [https://nixiesearch.substack.com/p/benchmarking-api-latency-of-embedding](https://nixiesearch.substack.com/p/benchmarking-api-latency-of-embedding). Comparative latency measurements across commercial embedding APIs.

- **We Benchmarked 20 Embedding APIs** — Milvus/Zilliz, May 2025. [https://milvus.io/blog/we-benchmarked-20-embedding-apis-with-milvus-7-insights-that-will-surprise-you.md](https://milvus.io/blog/we-benchmarked-20-embedding-apis-with-milvus-7-insights-that-will-surprise-you.md). Comprehensive latency and reliability benchmark across providers.

- **HuggingFace Text Embeddings Inference** — HuggingFace, 2024–2025. [https://github.com/huggingface/text-embeddings-inference](https://github.com/huggingface/text-embeddings-inference). Rust-based high-performance embedding inference server.

- **Matryoshka-Adaptor: Unsupervised and Supervised Tuning for Smaller Embedding Dimensions** — Yoon et al., 2024. [https://arxiv.org/abs/2407.20243](https://arxiv.org/abs/2407.20243). Post-hoc adaptor achieving 2–6× dimension reduction on black-box API embeddings with no performance loss.

- **Nomic Embed Text v1.5** — Nomic AI, 2024. [https://huggingface.co/nomic-ai/nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5). Demonstrates MRL-trained 768d model outperforming ada-002 (1536d) at 512 dimensions.

- **MMTEB: Massive Multilingual Text Embedding Benchmark** — Enevoldsen et al., 2025. [https://arxiv.org/html/2502.13595](https://arxiv.org/html/2502.13595). Expands MTEB to 500+ tasks across 250+ languages.