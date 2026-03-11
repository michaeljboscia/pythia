# Voyage AI's code embedding models lead benchmarks, but the full picture is nuanced

Voyage AI's **voyage-code-3** achieves a **92.28% average NDCG@10** on code retrieval tasks—outperforming OpenAI's text-embedding-3-large by nearly 14 percentage points on Voyage's own 32-dataset evaluation suite ([blog.voyageai.com/2024/12/04/voyage-code-3](https://blog.voyageai.com/2024/12/04/voyage-code-3/)). This gap is striking, but the claim comes with caveats: the benchmarks are vendor-produced, no fully independent replication exists, and Cohere's embed-v3 lacks any code-specific evaluation data. Released December 2024, voyage-code-3 represents Voyage AI's domain-specialized approach to embedding models—purpose-built for code retrieval across nine programming languages, with Matryoshka dimension support and quantization-aware training that enables dramatic storage reductions with minimal quality loss. Voyage AI was acquired by MongoDB in 2025 ([mongodb.com/products/platform/ai-search-and-retrieval](https://www.mongodb.com/products/platform/ai-search-and-retrieval)), integrating these capabilities into the Atlas Vector Search ecosystem. Understanding where voyage-code-3 genuinely excels and where competitors hold advantages requires examining benchmark methodology, API design, and the economics of embedding at scale.

## Voyage-code-3 claims a 14-point lead over OpenAI on code retrieval

The headline numbers are compelling. Voyage AI evaluated voyage-code-3 across **32 datasets spanning five categories**: text-to-code retrieval, code-to-code retrieval, docstring-to-code matching, repurposed QA datasets, and SWE-Bench-derived repository-level retrieval ([blog.voyageai.com/2024/12/04/code-retrieval-eval](https://blog.voyageai.com/2024/12/04/code-retrieval-eval/)). At the default **1024 dimensions**, voyage-code-3 scored **92.28% NDCG@10** versus **77.64%** for OpenAI's text-embedding-3-large at the same dimensionality—a **14.64% improvement**. Even when comparing against OpenAI at its full 3072 dimensions, voyage-code-3 at 1024 dimensions still outperformed by **13.80%** while requiring one-third the vector storage ([blog.voyageai.com/2024/12/04/voyage-code-3](https://blog.voyageai.com/2024/12/04/voyage-code-3/)).

The advantage persists at reduced dimensions. At 256 dimensions, voyage-code-3 achieved **91.34%** versus OpenAI's **73.68%**—a **17.66% gap**. Against CodeSage-large (2048 dimensions, 75.47%), voyage-code-3 outperformed by **16.81%** on average. Voyage claims superiority across all five dataset categories, exceeding OpenAI's text-embedding-3-large by **16.30%** when averaged across groups ([blog.voyageai.com/2024/12/04/voyage-code-3](https://blog.voyageai.com/2024/12/04/voyage-code-3/)).

On the standard MTEB/CoIR benchmark, voyage-code-3's HuggingFace model card reports strong individual task scores: **98.37 NDCG@10** on COIRCodeSearchNetRetrieval (Python) and **93.62** on AppsRetrieval ([huggingface.co/voyageai/voyage-code-3](https://huggingface.co/voyageai/voyage-code-3)). However, the predecessor model voyage-code-2 scored a mean of **52.86 NDCG@10** on the original CoIR benchmark, and while it topped that leaderboard, the authors noted "no single model dominates across all tasks" ([arxiv.org/html/2407.02883v1](https://arxiv.org/html/2407.02883v1)). Notably, voyage-code-3 does not appear in the top 10 of the standardized MTEB-Code leaderboard as of late 2025, which is dominated by larger general-purpose models like Qwen3-Embedding-8B (80.69) and Seed1.6-Embedding (80.71) ([alphaxiv.org/overview/2512.21332v1](https://www.alphaxiv.org/overview/2512.21332v1)).

An independent academic evaluation corroborates the directional advantage: a study on "Practical Code RAG at Scale" found voyage-code-3 achieved approximately **0.72 mean NDCG** on bug localization tasks versus 0.59 for E5-large and 0.57 for BM25, though the gap was smaller than Voyage's own reported margins ([arxiv.org/pdf/2510.20609](https://arxiv.org/pdf/2510.20609)). Mistral's Codestral Embed launch (May 2025) claimed to outperform voyage-code-3 on SWE-Bench-derived tasks, adding a credible competitor to the landscape ([mistral.ai/news/codestral-embed](https://mistral.ai/news/codestral-embed)).

**Cohere's embed-english-v3.0 has no published code retrieval benchmarks whatsoever.** Neither version 3 nor version 4 of Cohere's Embed model is optimized for code, and Cohere has published no code-specific evaluation data ([docs.cohere.com/changelog/embed-multimodal-v4](https://docs.cohere.com/changelog/embed-multimodal-v4)). The 512-token context limit of embed-v3.0 ([docs.cohere.com/docs/cohere-embed](https://docs.cohere.com/docs/cohere-embed)) makes it fundamentally unsuitable for most code retrieval scenarios, where source files routinely exceed this limit. For general retrieval benchmarks, Voyage AI claims voyage-3-large outperforms Cohere-v3-English by **20.71%** across 100 datasets ([blog.voyageai.com/2025/01/07/voyage-3-large](https://blog.voyageai.com/2025/01/07/voyage-3-large/)), and on MTEB overall scores, embed-english-v3.0 achieves **64.5** versus OpenAI's **64.6** ([zilliz.com/ai-models/embed-english-v3.0](https://zilliz.com/ai-models/embed-english-v3.0); [openai.com/index/new-embedding-models-and-api-updates](https://openai.com/index/new-embedding-models-and-api-updates/)).

## A critical look at the benchmark methodology

Voyage AI's reported margins are large enough to warrant scrutiny of the evaluation methodology. The company designed a custom 32-dataset suite rather than relying solely on standard MTEB/CoIR tasks, citing legitimate concerns: the CoSQA dataset contains approximately **51% mismatched query-code pairs**, and CodeSearchNet tasks are "overly simplistic" because docstrings are copy-pasted as queries, artificially inflating all models' scores ([blog.voyageai.com/2024/12/04/code-retrieval-eval](https://blog.voyageai.com/2024/12/04/code-retrieval-eval/)). These are valid criticisms supported by the original CoIR paper, which found anomalous scoring patterns on several tasks ([arxiv.org/html/2407.02883v1](https://arxiv.org/html/2407.02883v1)).

However, Voyage's evaluation combines public datasets with **proprietary in-house datasets** that cannot be independently reproduced. The company states datasets are "carefully curated to avoid contamination" ([blog.voyageai.com/2024/12/04/code-retrieval-eval](https://blog.voyageai.com/2024/12/04/code-retrieval-eval/)), but the use of proprietary data means the claimed 14-point advantage cannot be verified by third parties. The full evaluation results are published in a Google Sheet ([docs.google.com/spreadsheets/d/1Q5GDXOXueHuBT9demPrL9bz3_LMgajcZs_-GPeawrYk](https://docs.google.com/spreadsheets/d/1Q5GDXOXueHuBT9demPrL9bz3_LMgajcZs_-GPeawrYk/)), which adds transparency but does not resolve the reproducibility gap. The directional finding—that voyage-code-3 substantially outperforms general-purpose embedding models on code tasks—is plausible and partially corroborated by independent sources, but the exact magnitude should be treated as an upper-bound estimate.

## Input types, Matryoshka dimensions, and quantization create real operational advantages

All three providers implement an **input type parameter** that differentiates how queries and documents are embedded, but the implementations differ meaningfully. Voyage AI offers `query`, `document`, and `None` options; internally, these prepend task-specific prompts to guide the model toward asymmetric retrieval optimization ([docs.voyageai.com/docs/embeddings](https://docs.voyageai.com/docs/embeddings)). Cohere's `input_type` is **mandatory** for v3+ and provides four options—`search_document`, `search_query`, `classification`, and `clustering`—making it the most prescriptive implementation ([docs.cohere.com/reference/embed](https://docs.cohere.com/reference/embed)). OpenAI's text-embedding-3-large has no input type parameter; queries and documents receive identical treatment, which simplifies the API but sacrifices the retrieval quality gains that asymmetric embeddings provide.

Voyage-code-3's **Matryoshka dimension support** (256, 512, 1024, 2048) enables a powerful workflow: embed documents once at 2048 dimensions, then truncate to lower dimensions without re-embedding ([blog.voyageai.com/2024/12/04/voyage-code-3](https://blog.voyageai.com/2024/12/04/voyage-code-3/)). OpenAI's text-embedding-3-large also supports Matryoshka-style dimension reduction via the `dimensions` parameter, accepting any value up to 3072 ([openai.com/index/new-embedding-models-and-api-updates](https://openai.com/index/new-embedding-models-and-api-updates/)). Cohere's embed-v3.0, however, outputs only fixed **1024 dimensions** with no reduction option ([docs.cohere.com/docs/cohere-embed](https://docs.cohere.com/docs/cohere-embed)).

Where Voyage-code-3 genuinely differentiates is **quantization-aware training**. The model natively supports `float`, `int8`, `uint8`, `binary`, and `ubinary` output types via the API—trained specifically to minimize quality loss at reduced precision ([docs.voyageai.com/docs/embeddings](https://docs.voyageai.com/docs/embeddings)). At binary 2048 dimensions, quality drops only from 92.12% to 91.59% NDCG@10, and **binary rescoring** recovers most of that loss, achieving 91.95% ([blog.voyageai.com/2024/12/04/voyage-code-3](https://blog.voyageai.com/2024/12/04/voyage-code-3/)). Cohere embed-v3 supports the same quantization types ([docs.cohere.com/reference/embed](https://docs.cohere.com/reference/embed)), while OpenAI offers only `float` and `base64` encoding formats with no native quantization.

**Context length** is perhaps the starkest differentiator for code workloads. Voyage-code-3 supports **32,000 tokens**—enough to embed entire source files. OpenAI's text-embedding-3-large accepts **8,191 tokens** and returns errors (no automatic truncation) for longer inputs ([platform.openai.com/docs/guides/embeddings](https://platform.openai.com/docs/guides/embeddings)). Cohere's embed-v3.0 is limited to **512 tokens** ([docs.cohere.com/docs/cohere-embed](https://docs.cohere.com/docs/cohere-embed)), requiring aggressive chunking that fragments code structure and destroys function-level context. For a 500-line Python file (~2,000 tokens), Cohere would need four chunks while Voyage embeds it whole. Both Voyage and Cohere offer configurable truncation (Voyage: `True`/`False`; Cohere: `NONE`, `START`, `END`), while OpenAI simply rejects over-length inputs.

## Pricing favors Voyage's general models, but voyage-code-3 carries a premium

For the specific workload of embedding **1 million tokens of mixed code and documentation**, the direct API costs are:

| Provider & Model | Cost per 1M tokens | 1M token cost | Batch discount | Batch cost |
|---|---|---|---|---|
| **Voyage voyage-code-3** | $0.18 | **$0.18** | 33% off | $0.12 |
| OpenAI text-embedding-3-large | $0.13 | **$0.13** | 50% off | $0.065 |
| Cohere embed-english-v3.0 | $0.10 | **$0.10** | N/A (batch jobs available) | ~$0.10 |
| Voyage voyage-3 (general) | $0.06 | **$0.06** | 33% off | $0.04 |

Sources: [docs.voyageai.com/docs/pricing](https://docs.voyageai.com/docs/pricing), [openai.com/index/new-embedding-models-and-api-updates](https://openai.com/index/new-embedding-models-and-api-updates/), [pecollective.com/tools/cohere-pricing](https://pecollective.com/tools/cohere-pricing/).

Voyage-code-3 is the **most expensive** at $0.18/1M tokens—38% more than OpenAI and 80% more than Cohere. However, voyage-code-3's Matryoshka and quantization features reduce downstream storage costs significantly. At binary 256 dimensions versus OpenAI's float 3072 dimensions, Voyage achieves **384× storage reduction** while still outperforming OpenAI by 4.81% on retrieval quality ([blog.voyageai.com/2024/12/04/voyage-code-3](https://blog.voyageai.com/2024/12/04/voyage-code-3/)). For production systems with millions of code vectors, the storage savings can dwarf the embedding cost differential. All three providers offer free tiers: Voyage provides **200M free tokens** for voyage-code-3 ([docs.voyageai.com/docs/pricing](https://docs.voyageai.com/docs/pricing)), while OpenAI and Cohere gate access through tier qualifications and trial keys respectively.

## Rate limits and latency reveal different scaling profiles

Rate limits determine how quickly a workload can complete. For embedding 1M tokens in real-time:

- **Voyage voyage-code-3**: 3M tokens per minute (Tier 1), completing in roughly **20 seconds**. Scales to 9M TPM at Tier 3. Max 1,000 texts and 120K tokens per request ([docs.voyageai.com/docs/rate-limits](https://docs.voyageai.com/docs/rate-limits)).
- **OpenAI text-embedding-3-large**: Tier-dependent. At Tier 5, up to **10M TPM** (completing in ~6 seconds), but Tier 1 users face significantly lower limits. Rate limits are shared across all embedding models ([platform.openai.com/docs/guides/rate-limits](https://platform.openai.com/docs/guides/rate-limits)).
- **Cohere embed-english-v3.0**: 2,000 inputs per minute with a maximum of **96 texts per API call** ([docs.cohere.com/docs/rate-limits](https://docs.cohere.com/docs/rate-limits)). At 512 tokens per input maximum, the theoretical ceiling is ~1M tokens per minute, but the 96-text batch limit forces at least 21 API calls for 2,000 inputs.

Latency characteristics differ substantially. A comprehensive benchmark by the Milvus/Zilliz team testing 20+ embedding APIs found the following median latency ranking (fastest to slowest): **Cohere > Google Vertex AI > Voyage AI > OpenAI > AWS Bedrock** ([milvus.io/blog/we-benchmarked-20-embedding-apis](https://milvus.io/blog/we-benchmarked-20-embedding-apis-with-milvus-7-insights-that-will-surprise-you.md)). Voyage AI showed **significant latency variability** and clear sensitivity to input token length, suggesting less aggressive backend batching compared to OpenAI. The Agentset leaderboard measured OpenAI's text-embedding-3-large at roughly **18ms mean latency** per request ([agentset.ai/embeddings/openai-text-embedding-3-large](https://agentset.ai/embeddings/openai-text-embedding-3-large)), while Voyage AI's AWS SageMaker deployment measured **90ms for voyage-code-3** and **62.5ms for voyage-3** on single queries of ~100 tokens ([aws.amazon.com/marketplace/pp/prodview-d5nri3kbddsrw](https://aws.amazon.com/marketplace/pp/prodview-d5nri3kbddsrw)). The roughly **5× latency gap** between OpenAI and Voyage on per-request timing matters for real-time applications but is less relevant for batch indexing workflows.

## The practical choice depends on your code retrieval architecture

The data supports a clear hierarchy for code retrieval specifically: **voyage-code-3 leads substantially**, OpenAI's text-embedding-3-large serves as a capable general-purpose alternative, and Cohere's embed-v3.0 is unsuitable due to its 512-token context limit. For general text retrieval, the picture tightens—Voyage's general models (voyage-3, voyage-3.5) outperform OpenAI by 5–8% on Voyage's benchmarks, but the MTEB overall scores are closer (Voyage-3-large: ~66.8, Cohere embed-v4: 65.2, OpenAI: 64.6) ([app.ailog.fr/en/blog/guides/choosing-embedding-models](https://app.ailog.fr/en/blog/guides/choosing-embedding-models)).

Three architectural insights emerge from this analysis. First, **voyage-code-3's 32K context window is a structural advantage** that no benchmark score fully captures—embedding entire files preserves code semantics that chunking destroys. Second, **binary quantization with rescoring** offers a compelling production pattern: use binary embeddings for fast initial retrieval, then rescore the top candidates with full-precision vectors, achieving 91.50% NDCG@10 at 1024 binary dimensions versus 92.28% at 1024 float. Third, voyage-code-3's higher per-token cost ($0.18 vs $0.13) is partially offset by its ability to produce quality embeddings at lower dimensions—1024 dimensions at 92.28% versus OpenAI's 3072 dimensions at 78.48% means **3× less storage per vector with better retrieval**.

The most important caveat remains the benchmark provenance. All three providers evaluate primarily on their own terms. Until a fully independent evaluation compares these models head-to-head on standardized code retrieval tasks, the exact performance gap remains vendor-claimed rather than independently verified. The directional finding—that domain-specialized code embedding models outperform general-purpose alternatives—is well-supported. The specific 14-point margin should be treated as indicative rather than definitive.

## Bibliography

**Voyage AI, "Introducing Voyage Code 3."** Blog post, December 4, 2024. https://blog.voyageai.com/2024/12/04/voyage-code-3/ — Primary source for voyage-code-3 benchmark scores, Matryoshka dimension support, and quantization performance across 32 code retrieval datasets.

**Voyage AI, "Evaluating Code Retrieval."** Blog post, December 4, 2024. https://blog.voyageai.com/2024/12/04/code-retrieval-eval/ — Companion methodology post explaining dataset curation, contamination avoidance, and critiques of existing benchmarks like CoSQA and CodeSearchNet.

**Voyage AI, "Embeddings Documentation."** https://docs.voyageai.com/docs/embeddings — Official API reference for all Voyage models including context lengths, input types, truncation behavior, and output dtype options.

**Voyage AI, "Pricing."** https://docs.voyageai.com/docs/pricing — Current pricing for all Voyage models including batch API discounts and free tier allocations.

**Voyage AI, "Rate Limits."** https://docs.voyageai.com/docs/rate-limits — Tiered rate limit structure (TPM and RPM) for all Voyage models.

**Voyage AI, "Introducing Voyage 3."** Blog post, September 18, 2024. https://blog.voyageai.com/2024/09/18/voyage-3/ — Original voyage-3 launch benchmarks comparing against OpenAI and Cohere across 40+ datasets and 8 domains.

**Voyage AI, "Voyage 3 Large."** Blog post, January 7, 2025. https://blog.voyageai.com/2025/01/07/voyage-3-large/ — Extended 100-dataset evaluation showing voyage-3-large outperforming OpenAI by 9.74% and Cohere-v3 by 20.71%.

**Voyage AI, "voyage-code-3 Full Evaluation Results."** Google Sheets. https://docs.google.com/spreadsheets/d/1Q5GDXOXueHuBT9demPrL9bz3_LMgajcZs_-GPeawrYk/ — Complete per-dataset benchmark scores for all models evaluated in the voyage-code-3 paper.

**OpenAI, "New Embedding Models and API Updates."** Blog post, January 25, 2024. https://openai.com/index/new-embedding-models-and-api-updates/ — Launch announcement for text-embedding-3-large with MTEB (64.6%) and MIRACL (54.9%) scores, Matryoshka dimension support, and pricing.

**OpenAI, "Embeddings Guide."** https://platform.openai.com/docs/guides/embeddings — Official documentation for OpenAI embedding models including input format, tokenization, and dimension reduction.

**OpenAI, "Rate Limits."** https://platform.openai.com/docs/guides/rate-limits — Tier-based rate limit structure for all OpenAI API endpoints.

**Cohere, "Cohere Embed."** https://docs.cohere.com/docs/cohere-embed — Official embed-v3 documentation covering model variants, dimensions, max tokens (512), and input type requirements.

**Cohere, "Embed API Reference."** https://docs.cohere.com/reference/embed — API reference for embed endpoint including truncation options, embedding types, and batch constraints (96 texts max).

**Cohere, "Rate Limits."** https://docs.cohere.com/docs/rate-limits — Trial and production rate limits for Cohere API endpoints.

**Zilliz, "embed-english-v3.0 Model Card."** https://zilliz.com/ai-models/embed-english-v3.0 — Third-party model profile reporting MTEB score of 64.5 and BEIR score of 55.9 for Cohere embed-english-v3.0.

**Li et al., "CoIR: A Comprehensive Benchmark for Code Information Retrieval Models."** arXiv:2407.02883, 2024. https://arxiv.org/html/2407.02883v1 — Original CoIR benchmark paper establishing standardized code retrieval evaluation tasks; reported voyage-code-2 at 52.86 mean NDCG@10.

**Milvus/Zilliz, "We Benchmarked 20+ Embedding APIs."** Blog post, May 2025. https://milvus.io/blog/we-benchmarked-20-embedding-apis-with-milvus-7-insights-that-will-surprise-you.md — Independent latency benchmark ranking Cohere fastest, followed by Voyage AI, then OpenAI for North America deployments.

**Agentset, "OpenAI text-embedding-3-large."** https://agentset.ai/embeddings/openai-text-embedding-3-large — Independent evaluation reporting 18ms mean latency and 0.709 nDCG@10 accuracy for OpenAI's large embedding model.

**AWS Marketplace, "Voyage Code 3 on SageMaker."** https://aws.amazon.com/marketplace/pp/prodview-d5nri3kbddsrw — Self-hosted deployment specs showing 90ms latency and 12.6M tokens/hour throughput on ml.g6.xlarge.

**Mistral AI, "Codestral Embed."** May 28, 2025. https://mistral.ai/news/codestral-embed — Vendor benchmark claiming superiority over voyage-code-3 on SWE-Bench and text-to-code tasks, providing an additional competitive reference point.

**Ailog, "Choosing Embedding Models."** https://app.ailog.fr/en/blog/guides/choosing-embedding-models — Third-party MTEB leaderboard summary reporting Voyage-3-large at 66.8, Cohere embed-v4 at 65.2, and OpenAI at 64.6 overall MTEB scores.

**HuggingFace, "voyageai/voyage-code-3."** https://huggingface.co/voyageai/voyage-code-3 — Model card with self-reported MTEB evaluation results including AppsRetrieval (93.62) and COIRCodeSearchNetRetrieval-Python (98.37) NDCG@10 scores.