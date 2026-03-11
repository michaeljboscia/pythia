# Local embeddings via Ollama: a practical technical analysis

**Ollama's embedding models now match or exceed OpenAI's mid-tier offerings on standard benchmarks, making zero-cost, privacy-preserving embedding viable for most development workflows.** The top local contender, mxbai-embed-large, achieves an MTEB average of ~64.7—edging past OpenAI's text-embedding-3-large at 64.6—while nomic-embed-text matches text-embedding-3-small at roughly 62.3. These models run entirely on-device with **15–50ms latency** versus 200–800ms for cloud APIs, consume under 1.2 GB of memory on Apple Silicon, and cost nothing per token. The trade-offs are real but manageable: shorter context windows, a meaningful quality gap on code-specific retrieval, and operational pitfalls around model loading and version stability that demand careful configuration.

## Ollama now offers a dozen embedding models spanning every size class

Ollama's [embedding model library](https://ollama.com/search?c=embedding) has grown rapidly, with **nomic-embed-text** leading at over 55 million pulls. The three models most relevant to developer workflows differ sharply in their design points:

**nomic-embed-text** (v1/v1.5) packs **137M parameters** into a 274 MB download, producing 768-dimensional vectors with an **8,192-token context window**—the longest among lightweight local models. The v1.5 release added [Matryoshka representation learning](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5), enabling dimension reduction to 512, 256, or 128 without retraining. Nomic's [technical report](https://arxiv.org/html/2402.01613v2) places the model at **62.39 on the MTEB English average**, surpassing OpenAI's ada-002 (60.99) and matching text-embedding-3-small (62.26). On long-context benchmarks (LoCo), it outperforms both OpenAI models, though it falls short on Jina's long-context evaluation. The model requires task prefixes (`search_document:`, `search_query:`) for optimal performance—a detail that [Ollama's model page](https://ollama.com/library/nomic-embed-text) documents but that many integration frameworks silently handle.

**mxbai-embed-large** from mixedbread.ai scales up to **335M parameters** and 1,024 dimensions at the cost of a **512-token context window**. The [model card](https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1) claims state-of-the-art performance for BERT-large-class models on MTEB, with an overall average of approximately **64.7**—which the mixedbread team [asserts outperforms](https://www.mixedbread.com/blog/mxbai-embed-large-v1) OpenAI's text-embedding-3-large (64.6) while using only 335M parameters versus OpenAI's undisclosed but substantially larger architecture. This is the strongest accuracy-per-byte option available locally.

**all-MiniLM-L6-v2** represents the ultralight extreme: **22M parameters**, 384 dimensions, 256-token context, and a ~45 MB footprint. Its [MTEB average of ~56.3](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) is substantially lower than the other options, but it processes around **14,000 sentences per second** on modest hardware. For low-stakes prototyping or memory-constrained environments, it remains useful.

Beyond these three, the library includes [snowflake-arctic-embed](https://huggingface.co/Snowflake/snowflake-arctic-embed-m) models (retrieval-optimized, achieving **55.98 NDCG@10** on MTEB Retrieval for the large variant), [bge-m3](https://ollama.com/search?c=embedding) with multilingual dense+sparse retrieval at 567M parameters, and the newer [qwen3-embedding](https://ollama.com/search?c=embedding) family scaling up to 8B parameters with 32K-token context windows.

## MTEB benchmarks reveal a narrowing gap with commercial APIs

The most instructive comparison uses retrieval-specific NDCG@10 scores from MTEB, since embedding in development workflows typically serves retrieval-augmented generation. The numbers tell a story of rapid convergence:

| Model | Type | MTEB Avg | Retrieval NDCG@10 | Dimensions | Context | Cost |
|---|---|---|---|---|---|---|
| nomic-embed-text v1 | Local (Ollama) | 62.39 | ~49–50 | 768 | 8,192 | Free |
| mxbai-embed-large v1 | Local (Ollama) | ~64.7 | ~54.4 | 1,024 | 512 | Free |
| snowflake-arctic-embed-l | Local (Ollama) | — | **55.98** | 1,024 | 512 | Free |
| all-MiniLM-L6-v2 | Local (Ollama) | 56.3 | ~42 | 384 | 256 | Free |
| OpenAI text-embedding-3-small | Commercial | 62.3 | ~51.7 | 1,536 | 8,192 | $0.02/M tokens |
| OpenAI text-embedding-3-large | Commercial | 64.6 | **55.4** | 3,072 | 8,192 | $0.13/M tokens |
| Voyage-3-large | Commercial | 66.8 | Top-tier | 1,536 | 32,000 | $0.12/M tokens |
| Cohere embed-v4 | Commercial | 65.2 | ~55.0 | 1,024 | — | $0.10/M tokens |

Sources: [OpenAI official benchmarks](https://openai.com/index/new-embedding-models-and-api-updates/), [Nomic technical report](https://arxiv.org/html/2402.01613v2), [Snowflake Arctic Embed paper](https://arxiv.org/html/2405.05374v1), [Voyage AI blog](https://blog.voyageai.com/2024/05/05/voyage-large-2-instruct-instruction-tuned-and-rank-1-on-mteb/), [Cloudurable MTEB guide](https://cloudurable.com/blog/the-ultimate-guide-to-text-embedding-models-in-202/).

The headline finding: **snowflake-arctic-embed-l and mxbai-embed-large both match OpenAI's text-embedding-3-large on retrieval NDCG@10** (54–56 range), while nomic-embed-text tracks text-embedding-3-small. The real gap opens at the top: Voyage-3-large and Cohere embed-v4 pull ahead by 2–4 points on overall MTEB, and domain-specific Voyage models like [voyage-law-2 outperform text-embedding-3-large by 6% NDCG@10](https://blog.voyageai.com/2024/04/15/domain-specific-embeddings-and-retrieval-legal-edition-voyage-law-2/) on legal retrieval. For general-purpose development use, however, the local models are competitive.

A January 2026 [direct benchmark by Oleksii Aleksapolskyi](https://medium.com/@TheWake/openai-vs-ollama-i-benchmarked-both-embedding-models-on-real-legal-data-8eb01ccb272f) comparing nomic-embed-text against OpenAI on real data found **virtually identical performance on general knowledge retrieval (HotpotQA)**, with OpenAI winning by ~5% on legal text. The study's most striking conclusion: "The gap between embedders (5%) is smaller than the gap between chunk sizes (7%)." Tuning your chunking strategy may matter more than switching models.

One critical caveat on MTEB scores: the leaderboard has been revised across versions, and scores from different sources may not be directly comparable. An [AIlog analysis](https://app.ailog.fr/en/blog/guides/choosing-embedding-models) reports nomic-embed-text at 59.4 while Nomic's own paper shows 62.39, likely reflecting different MTEB versions. Domain-specific benchmarking on your own data remains essential.

## Apple Silicon throughput makes local embedding practical for development

Ollama's [embedding API](https://docs.ollama.com/capabilities/embeddings) supports batch processing via the `/api/embed` endpoint, accepting arrays of strings and returning L2-normalized float32 vectors. Under the hood, [Ollama's implementation](https://deepwiki.com/ollama/ollama/3.3-embedding-api) uses Go's `errgroup` for concurrent processing, with goroutine limits tied to `GOMAXPROCS`. The newer endpoint also supports Matryoshka dimension reduction and automatic input truncation.

Specific throughput data on Apple Silicon remains sparse in rigorous benchmarks. One [enterprise deployment guide](https://collabnix.com/ollama-embedded-models-the-complete-technical-guide-for-2025-enterprise-deployment/) reports the following figures for an **M2 Max (96 GB)**—though these should be treated as approximate, as they come from a content-marketing source rather than an independent benchmark:

- nomic-embed-text: **~9,340 tokens/sec**, batch size 128, ~0.5 GB memory
- mxbai-embed-large: **~6,780 tokens/sec**, batch size 64, ~1.2 GB memory

More reliably, a [GitHub issue (#12591)](https://github.com/ollama/ollama/issues/12591) documents a real deployment achieving **19–21 embeddings/sec** with mxbai-embed-large across two Ollama nodes using ThreadPoolExecutor, with throughput plateauing around batch size 50–100. HTTP/2 multiplexing provided a ~30% latency reduction, and connection reuse delivered a **10x speedup** over naive implementations.

The latency advantage over cloud APIs is substantial. Local embedding calls typically complete in **15–50ms** versus [200–800ms for OpenAI](https://collabnix.com/ollama-embedded-models-the-complete-technical-guide-to-local-ai-embeddings-in-2025/) including network round-trip. For interactive development tools that embed on every keystroke or file save, this difference is transformative.

Apple Silicon's unified memory architecture means embedding models share the same memory pool as the CPU workload—there is no PCIe transfer bottleneck. A 48 GB M3 Max makes its full RAM available to GPU compute via Metal, [exceeding many discrete workstation GPUs](https://medium.com/@michael.hannecke/running-llms-locally-on-apple-silicon-a-practical-guide-for-developers-980deed326d9). However, Ollama uses llama.cpp's Metal backend and **does not leverage Apple's Neural Engine**; frameworks like MLX achieve [30–50% faster inference](https://deepai.tn/glossary/ollama/mlx-faster-than-ollama/) on the same hardware by better exploiting Apple-native optimizations. An [academic analysis](https://arxiv.org/pdf/2511.05502) describes Ollama as "an order of magnitude slower than MLX/MLC in throughput" for production serving, though it remains the most convenient option for development.

A notable performance concern: [GitHub issue #7400](https://github.com/ollama/ollama/issues/7400) demonstrates that Ollama's embedding REST API is **~2x slower than running the same model directly via Sentence Transformers**, due to HTTP serialization overhead. For bulk embedding of large corpora, calling the model directly may be worthwhile.

## Failure modes that can silently break your vector store

The most dangerous operational issue is **embedding value drift across Ollama versions**. [Issue #3777](https://github.com/ollama/ollama/issues/3777) documents that upgrading from v0.1.31 to v0.1.32 silently changed embedding similarity scores, invalidating existing vector indexes. Users had to downgrade to preserve their retrieval pipelines. Similarly, [issue #4207](https://github.com/ollama/ollama/issues/4207) revealed that mxbai-embed-large's Ollama implementation produced cosine similarities vastly different from the HuggingFace reference—a correctness bug later fixed in PR #4941. More recently, [issues #12368 and #12757](https://github.com/ollama/ollama/issues/12757) show that backend changes in v0.12.6 broke Qwen3 embedding models entirely, returning "model does not support embeddings." The practical takeaway: **pin your Ollama version in production and test embedding consistency before any upgrade.**

Model loading behavior creates friction in development workflows. Ollama's default `keep_alive` of **5 minutes** means models unload after brief periods of inactivity, and the next request triggers a cold reload. For embedding models (~274 MB for nomic-embed-text), reloading takes only seconds on SSD, but context-size mismatches between different applications hitting the same Ollama instance will [trigger unexpected model swaps](https://blog.gopenai.com/preventing-model-swapping-in-ollama-a-guide-to-persistent-loading-f81f1dfb858d) even for the same model. Setting `OLLAMA_KEEP_ALIVE=-1` is essential for development use. Since Ollama 0.2, embedding and generation models can [coexist in memory simultaneously](https://medium.com/@simeon.emanuilov/ollama-0-2-revolutionizing-local-model-management-with-concurrency), with `OLLAMA_MAX_LOADED_MODELS` defaulting to 3× GPU count.

Batch processing has its own pitfalls. [Issue #6262](https://github.com/ollama/ollama/issues/6262) reports **progressive quality degradation at batch sizes ≥16**, where cosine similarity scores deviate increasingly from single-item embeddings. Additionally, [issue #9499](https://github.com/ollama/ollama/issues/9499) documents a segmentation fault triggered by text with repetitive punctuation patterns, and [issue #13340](https://github.com/ollama/ollama/issues/13340) describes a memory panic when embedding 3,000+ chunks with nomic-embed-text in v0.13.1.

## Code-specific retrieval is where the quality gap hurts most

For code search and retrieval—a primary use case in development workflows—general-purpose local models fall measurably behind specialized alternatives. nomic-embed-text was trained on [235M text pairs from forums, reviews, and web searches](https://www.nomic.ai/blog/posts/nomic-embed-text-v1), with no code-specific optimization. A [Modal.com comparison](https://modal.com/blog/6-best-code-embedding-models-compared) of code embedding models found that Voyage's code-specific [voyage-code-3 outperforms OpenAI text-embedding-3-large by 5–8 NDCG points](https://github.com/nateschmiedehaus/LiBrainian/issues/261) on CodeSearchNet benchmarks—a gap that general-purpose local models cannot close.

Nomic has released a dedicated [nomic-embed-code](https://huggingface.co/nomic-ai/nomic-embed-code) model trained on deduplicated Stack V2 with docstring-code pairs, but this 7B-parameter model is not yet in Ollama's standard library and requires significantly more resources. The newer [nomic-embed-text-v2-moe](https://ollama.com/library/nomic-embed-text-v2-moe) supports programming languages via its 100+ language coverage, though independent code retrieval benchmarks for it are limited.

For developers doing RAG over codebases, a pragmatic approach is to use local embeddings for natural language documentation and comments while accepting the 5–8 point NDCG gap on pure code retrieval, or to supplement with a specialized code embedding API for the highest-value code search queries.

## Practical configuration for development workflows

The optimal local embedding setup for privacy-preserving development involves several deliberate choices:

- **Model selection**: mxbai-embed-large for maximum retrieval accuracy when documents are under 512 tokens; nomic-embed-text when longer context or smaller memory footprint matters. all-MiniLM only for constrained prototyping.
- **Memory configuration**: Set `OLLAMA_KEEP_ALIVE=-1` and `OLLAMA_MAX_LOADED_MODELS=2` (one embedding model, one generation model). Enable Flash Attention (`OLLAMA_FLASH_ATTENTION=1`) for [40–60% memory reduction](https://docs.ollama.com/faq). Use `ollama ps` to verify loaded models.
- **Batch processing**: Keep batch sizes between 10–32 to avoid quality degradation. Use the `/api/embed` endpoint exclusively—the legacy `/api/embeddings` endpoint lacks batching, normalization, and truncation support.
- **Privacy hardening**: Disable [ChromaDB telemetry](https://www.technetexperts.com/ollama-chromadb-telemetry-fix/) with `ANONYMIZED_TELEMETRY=False` if using ChromaDB as your vector store.
- **Version pinning**: Lock your Ollama version and validate embedding consistency against a reference set before upgrading. A single version bump can invalidate an entire vector index.

## Conclusion

The economics of local embedding have shifted decisively. Models available through Ollama now match OpenAI's text-embedding-3-large on retrieval benchmarks while running at sub-50ms latency on a MacBook Pro and costing nothing per token. The practical barriers are no longer about quality for general text—they are about operational maturity. Embedding value drift across versions, batch quality degradation, and the absence of code-specialized models in Ollama's library are the real constraints. For development workflows prioritizing privacy and cost, a setup combining mxbai-embed-large for retrieval accuracy with nomic-embed-text for long-context tasks covers the vast majority of use cases. The remaining quality gap concentrates in domain-specific tasks—code retrieval, legal text, multilingual search—where commercial APIs like Voyage still justify their cost. The most underappreciated insight from the benchmarks: investing in chunking strategy optimization yields larger retrieval improvements than switching between comparably-ranked embedding models.

## Bibliography

1. **Nomic Embed Text Technical Report** — [arxiv.org/html/2402.01613v2](https://arxiv.org/html/2402.01613v2) — Establishes MTEB score of 62.39 for nomic-embed-text-v1, detailing training on 235M text pairs and comparisons with OpenAI ada-002 and text-embedding-3-small across MTEB, LoCo, and Jina benchmarks.

2. **Ollama Embedding API Documentation** — [docs.ollama.com/capabilities/embeddings](https://docs.ollama.com/capabilities/embeddings) — Official documentation for the `/api/embed` endpoint, covering batch processing, dimension reduction, L2 normalization, and truncation behavior.

3. **Ollama Embedding Models Blog** — [ollama.com/blog/embedding-models](https://ollama.com/blog/embedding-models) — Introduces embedding support in Ollama, lists supported models, and provides RAG integration examples with ChromaDB.

4. **mxbai-embed-large-v1 Model Card** — [huggingface.co/mixedbread-ai/mxbai-embed-large-v1](https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1) — Documents SOTA MTEB performance for BERT-large class models (~64.7 average), CLS pooling, and 1,024-dimensional embeddings with 512-token context.

5. **nomic-embed-text-v1.5 Model Card** — [huggingface.co/nomic-ai/nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) — Documents Matryoshka representation learning enabling variable-dimension output (768, 512, 256, 128) and 8,192-token context.

6. **OpenAI New Embedding Models Announcement** — [openai.com/index/new-embedding-models-and-api-updates](https://openai.com/index/new-embedding-models-and-api-updates/) — Official MTEB scores: ada-002 at 61.0%, text-embedding-3-small at 62.3%, text-embedding-3-large at 64.6%, with MIRACL multilingual scores and pricing.

7. **Snowflake Arctic Embed Paper** — [arxiv.org/html/2405.05374v1](https://arxiv.org/html/2405.05374v1) — Reports NDCG@10 of 55.98 for arctic-embed-l on MTEB Retrieval, with Pareto frontier analysis across model sizes.

8. **Snowflake Arctic Embed 2.0 Paper** — [arxiv.org/html/2412.04506v2](https://arxiv.org/html/2412.04506v2) — Demonstrates that arctic-embed-m-v2.0 outscores Google text-embedding-004 on MTEB-R (0.549 vs 0.524) while retaining 99% quality at 256 dimensions.

9. **Voyage AI: voyage-large-2-instruct Announcement** — [blog.voyageai.com](https://blog.voyageai.com/2024/05/05/voyage-large-2-instruct-instruction-tuned-and-rank-1-on-mteb/) — Reports #1 ranking on MTEB overall, outperforming OpenAI text-embedding-3-large on 5 of 7 task categories.

10. **Ollama GitHub Issue #3777: Embedding Values Changed** — [github.com/ollama/ollama/issues/3777](https://github.com/ollama/ollama/issues/3777) — Documents silent embedding value drift between Ollama v0.1.31 and v0.1.32, breaking existing vector indexes.

11. **Ollama GitHub Issue #4207: mxbai-embed-large Inconsistency** — [github.com/ollama/ollama/issues/4207](https://github.com/ollama/ollama/issues/4207) — Reports cosine similarity scores vastly different from HuggingFace reference implementation; fixed in PR #4941.

12. **Ollama GitHub Issue #6262: Batch Quality Degradation** — [github.com/ollama/ollama/issues/6262](https://github.com/ollama/ollama/issues/6262) — Documents progressive embedding quality degradation at batch sizes ≥16.

13. **Ollama GitHub Issue #7400: REST API 2x Slower Than Sentence Transformers** — [github.com/ollama/ollama/issues/7400](https://github.com/ollama/ollama/issues/7400) — Benchmarks showing Ollama embedding REST API approximately 2x slower than direct Sentence Transformers inference for the same model.

14. **Ollama GitHub Issue #12591: Concurrent Embedding Best Practices** — [github.com/ollama/ollama/issues/12591](https://github.com/ollama/ollama/issues/12591) — Real-world benchmarks: 19–21 embeddings/sec with mxbai-embed-large across two Ollama nodes, HTTP/2 providing 30% latency reduction.

15. **OpenAI vs Ollama Embedding Benchmark (Aleksapolskyi, Jan 2026)** — [medium.com](https://medium.com/@TheWake/openai-vs-ollama-i-benchmarked-both-embedding-models-on-real-legal-data-8eb01ccb272f) — Direct comparison finding identical performance on general knowledge, 5% OpenAI advantage on legal text, and chunking strategy mattering more than model choice.

16. **Modal.com: 6 Best Code Embedding Models Compared** — [modal.com/blog](https://modal.com/blog/6-best-code-embedding-models-compared) — Compares VoyageCode3, OpenAI, Jina Code V2, Nomic Embed Code, and CodeSage; VoyageCode3 leads on CodeSearchNet by 5–8 NDCG points.

17. **Ollama DeepWiki: Embedding API Internals** — [deepwiki.com/ollama/ollama/3.3-embedding-api](https://deepwiki.com/ollama/ollama/3.3-embedding-api) — Source code analysis of Ollama's concurrent batch processing, truncation retry logic, and L2 normalization implementation.

18. **Ollama FAQ** — [docs.ollama.com/faq](https://docs.ollama.com/faq) — Documents OLLAMA_KEEP_ALIVE (default 5min), OLLAMA_MAX_LOADED_MODELS, OLLAMA_NUM_PARALLEL, Flash Attention, and KV cache quantization settings.

19. **Apple Silicon LLM Inference Guide (Hannecke)** — [medium.com](https://medium.com/@michael.hannecke/running-llms-locally-on-apple-silicon-a-practical-guide-for-developers-980deed326d9) — Explains unified memory architecture advantages: full RAM accessible to GPU without transfer bottleneck.

20. **Production-Grade Local LLM Inference on Apple Silicon** — [arxiv.org/pdf/2511.05502](https://arxiv.org/pdf/2511.05502) — Academic analysis characterizing Ollama as "an order of magnitude slower than MLX/MLC in throughput" while noting its convenience for development prototyping.