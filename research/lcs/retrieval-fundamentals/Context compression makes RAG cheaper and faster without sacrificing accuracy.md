# Context compression makes RAG cheaper and faster without sacrificing accuracy

**Prompt compression can cut RAG context by 5–20× while preserving over 95% of downstream QA accuracy**, fundamentally changing the cost calculus for retrieval-augmented generation. Two leading approaches—Microsoft's [LLMLingua](https://arxiv.org/abs/2310.05736) family (token-level pruning via small language models) and [RECOMP](https://arxiv.org/abs/2310.04408) (trained extractive and abstractive compressors)—represent distinct engineering tradeoffs between generality, faithfulness, and compression efficiency. With LLM API input costs ranging from $2.50 to $15 per million tokens, the economics favor compression at scale, especially since the compression models themselves are small enough to run on a single GPU at negligible marginal cost.

## LLMLingua prunes tokens using perplexity as a proxy for importance

[LLMLingua](https://arxiv.org/abs/2310.05736), published at EMNLP 2023 by Jiang et al. at Microsoft Research, introduced a coarse-to-fine prompt compression framework built on three interlocking components. The **budget controller** dynamically allocates compression ratios across prompt segments (instruction, demonstrations, question), recognizing that different components tolerate different levels of pruning. The **iterative token-level compressor** then operates within each segment, using a small language model—typically [LLaMA-7B or GPT-2](https://www.microsoft.com/en-us/research/blog/llmlingua-innovating-llm-efficiency-with-prompt-compression/)—to compute per-token perplexity scores. Tokens with low perplexity (high predictability) are pruned iteratively rather than in a single pass, preserving interdependencies between remaining tokens. A **distribution alignment** module fine-tunes the small model to better match the target LLM's token importance distribution.

The results are striking. On [GSM8K mathematical reasoning](https://www.llmlingua.com/llmlingua.html), LLMLingua achieves **20× compression** (from 2,366 to 117 tokens) with only a **1.5 EM point drop** (77.33 vs. 78.85) when using GPT-3.5-Turbo as the target LLM. On Big-Bench Hard, 7× compression yields 56.85 EM compared to 70.07 for uncompressed prompts—a larger degradation reflecting the sensitivity of complex reasoning to context removal. Ablation studies confirm that iterative compression is critical: removing it drops GSM8K EM from 79.08 to 72.93 at 5× compression.

[LLMLingua-2](https://arxiv.org/abs/2403.12968), published at ACL 2024 Findings by Pan et al., rethinks the compression mechanism entirely. Rather than using causal language model perplexity, it frames compression as a **binary token classification problem**: for each token, predict whether to preserve or discard it. The training data comes from a data distillation process where GPT-4 performs extractive compression on [MeetingBank](https://arxiv.org/html/2403.12968v2) transcripts, and the resulting preserve/discard labels train a **bidirectional Transformer encoder** (XLM-RoBERTa-large at 560M parameters, or mBERT at 110M). This architectural shift from a 7B autoregressive model to a 560M encoder delivers **3–6× faster compression** and **8× lower GPU memory** compared to the original LLMLingua. Despite being trained only on meeting transcripts, LLMLingua-2 generalizes well to out-of-domain benchmarks including LongBench, GSM8K, and BBH. When paired with Mistral-7B as the target, compressed prompts sometimes [outperform uncompressed ones](https://llmlingua.com/llmlingua2.html)—likely because the compressed prompt's higher information density mitigates the model's difficulty with long contexts.

## RECOMP compresses at the sentence and summary level, not the token level

[RECOMP](https://arxiv.org/abs/2310.04408) (Xu et al., ICLR 2024) takes a fundamentally different approach to context compression by operating at the sentence and document level rather than pruning individual tokens. It offers two compressor architectures—extractive and abstractive—each with distinct tradeoffs for RAG pipelines.

The **extractive compressor** is a dual-encoder model initialized from [Contriever](https://arxiv.org/html/2310.04408) (110M parameters). It independently encodes the input query and each candidate sentence from retrieved documents, then ranks sentences by the inner product of their embeddings. The top-ranked sentences (typically just **one sentence** for NaturalQuestions and TriviaQA, two for HotpotQA) form the compressed context. Training uses contrastive learning: positive examples are sentences that maximize the base LM's likelihood of generating the correct answer, while hard negatives are high-similarity but low-utility sentences.

The **abstractive compressor** uses T5-large (**775M parameters**) to generate query-focused summaries that synthesize information across all retrieved documents. Training follows a symbolic distillation pipeline: GPT-3.5 generates candidate summaries, a critic selects those that most improve end-task performance on Flan-UL2, and the filtered pairs train the student T5 model. Crucially, when retrieved documents are irrelevant, the abstractive compressor can output an empty string—implementing [selective augmentation](https://arxiv.org/pdf/2310.04408) that avoids polluting the context.

On NaturalQuestions with Flan-UL2 (20B), the extractive compressor achieves **36.57 EM** and the abstractive compressor **37.04 EM**, compared to **39.39 EM** for uncompressed top-5 documents—but using only **37 and 36 tokens** respectively versus 660, a roughly **18× reduction**. On TriviaQA, extractive reaches **58.99 EM** and abstractive **58.68 EM** versus **62.37 EM** for full documents, compressing 677 tokens to roughly 35. The tradeoff between the two modes depends on task structure: **abstractive compression wins on single-hop QA** (NQ, TriviaQA) where synthesis is straightforward, while **extractive compression is superior for multi-hop reasoning** (HotpotQA: 30.40 vs. 28.20 EM), where abstractive models struggle to faithfully synthesize across multiple documents.

The faithfulness distinction matters for production systems. Extractive compression preserves original text verbatim, making hallucination essentially impossible at the compression stage. Abstractive compression, while achieving slightly higher compression ratios (4.7% vs. 5.6% of tokens on TriviaQA), introduces hallucination risk—[subsequent work](https://arxiv.org/html/2508.19282) has documented cases where RECOMP's abstractive summaries generated factually incorrect dates and attributions.

## Token-level pruning versus sentence-level selection creates distinct engineering tradeoffs

LLMLingua and RECOMP represent two philosophies of context compression that differ along several axes relevant to system design. LLMLingua's **token-level granularity** can achieve very high compression ratios (up to 20×) because it removes individual redundant words while potentially preserving fragments from many different passages. RECOMP's **sentence-level granularity** produces more coherent compressed contexts but is constrained by the informativeness of individual sentences—if no single sentence contains the answer, extractive compression fails.

On generality, [LLMLingua-2 requires no task-specific training](https://llmlingua.com/llmlingua2.html): its MeetingBank-trained token classifier transfers across domains. RECOMP requires training separate compressors per dataset with task-specific contrastive objectives and distillation from a teacher LLM. This makes LLMLingua-2 more practical as a drop-in component for diverse RAG applications. However, RECOMP's task-specific training yields very aggressive compression (5–6% of original tokens) with modest accuracy loss.

Direct head-to-head comparisons are limited because the two methods were evaluated with different base LLMs and benchmarks in their original papers. Third-party evaluations from the [EXIT paper](https://arxiv.org/pdf/2412.12559) with Llama-3.1-8B-Instruct show RECOMP-Abstractive at 31.3 EM on NQ versus 34.6 for uncompressed documents, while RECOMP-Extractive matches uncompressed at 34.6. The [Provence paper (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/file/5e956fef0946dc1e39760f94b78045fe-Paper-Conference.pdf) identifies limitations in both: RECOMP assumes only one sentence per context is relevant, while LLMLingua requires a fixed compression ratio specified as a hyperparameter rather than adapting to content difficulty.

## The economics strongly favor compression at scale with expensive models

The cost-benefit calculus of prompt compression hinges on three variables: the per-token cost of the target LLM, query volume, and the marginal cost of running the compression model. [LLMLingua's latency benchmarks](https://www.llmlingua.com/llmlingua.html) on a V100 GPU show compression overhead of just **0.2–0.8 seconds** for ~2,300-token prompts, while end-to-end inference time drops from 8.6 seconds to 1.3 seconds at 10× compression—a **5.7× speedup** that includes the compression overhead. LLMLingua-2 further reduces this overhead by 3–6× thanks to its smaller encoder architecture.

At current [OpenAI pricing](https://developers.openai.com/api/docs/pricing/) ($2.50/1M input tokens for GPT-4o), a RAG pipeline processing **10,000 queries per day** with ~5,000 tokens of retrieved context per query spends roughly **$3,950/month on input tokens alone**. A 4× compression ratio cuts this to approximately **$988/month**—a $2,962 monthly saving. The compression model itself (LLMLingua-2 with XLM-RoBERTa-large) runs comfortably on a single A10G GPU at [~$0.75/hour on cloud](https://jetthoughts.com/blog/cost-optimization-llm-applications-token-management/), costing roughly $540/month for continuous operation. **Net savings: ~$2,400/month**, with the ratio improving as query volume or model cost increases.

For [premium models like Claude Opus](https://platform.claude.com/docs/en/about-claude/pricing) ($15/1M input tokens), the same scenario yields $18,750/month in input costs, making 4× compression worth over $14,000/month in savings—easily justifying dedicated compression infrastructure. Conversely, for cheap models like GPT-4o-mini at $0.15/1M input tokens, the same pipeline costs only $237/month uncompressed, making compression hardware overhead hard to justify.

[LangChain's ContextualCompressionRetriever](https://python.langchain.com/v0.2/docs/how_to/contextual_compression/) provides a production-ready integration pattern, supporting LLMLingua directly via [`LLMLinguaCompressor`](https://docs.langchain.com/oss/python/integrations/retrievers/llmlingua) alongside simpler alternatives like `EmbeddingsFilter` (cosine similarity thresholding, no GPU required) and `LLMChainExtractor` (which uses the target LLM itself for compression—useful when you want maximum quality and the target model is cheap, but counterproductive for cost reduction). The framework's pipeline architecture allows chaining compressors: for example, an embeddings filter for coarse document-level filtering followed by LLMLingua-2 for fine-grained token pruning.

## Conclusion

Context compression for RAG has matured from a research curiosity into a practical engineering tool with well-characterized tradeoffs. LLMLingua-2 represents the current sweet spot for most production deployments: its BERT-sized encoder runs cheaply, requires no task-specific training, and achieves compression ratios of 2–5× with minimal accuracy degradation. RECOMP's sentence-level approach offers an alternative when interpretability and faithfulness are paramount—its extractive compressor cannot hallucinate by construction. The most underappreciated finding across both lines of work is that moderate compression (2–5×) often *improves* downstream accuracy by increasing information density and mitigating the "lost in the middle" effect that plagues long-context LLMs. For engineering teams, the decision framework is straightforward: if your target model costs more than $1/1M input tokens and you process more than a few thousand queries per day, prompt compression delivers positive ROI within the first month.

## Bibliography

**LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models**
Huiqiang Jiang, Qianhui Wu, Chin-Yew Lin, Yuqing Yang, Lili Qiu. EMNLP 2023.
URL: https://arxiv.org/abs/2310.05736
*Key contribution:* Introduced coarse-to-fine perplexity-based token pruning using a small LM, achieving up to 20× compression with minimal accuracy loss.

**LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression**
Zhuoshi Pan, Qianhui Wu, Huiqiang Jiang, Menglin Xia, Xufang Luo, Jue Zhang, Qingwei Lin, Victor Rühle, Yuqing Yang, Chin-Yew Lin, H. Vicky Zhao, Lili Qiu, Dongmei Zhang. ACL 2024 Findings.
URL: https://arxiv.org/abs/2403.12968
*Key contribution:* Reformulated compression as token classification with a bidirectional encoder, achieving 3–6× faster compression with a model 12× smaller than LLMLingua.

**RECOMP: Improving Retrieval-Augmented LMs with Compression and Selective Augmentation**
Fangyuan Xu, Weijia Shi, Eunsol Choi. ICLR 2024.
URL: https://arxiv.org/abs/2310.04408
*Key contribution:* Introduced trained extractive (dual-encoder) and abstractive (T5-based) compressors for RAG, compressing retrieved contexts to 5–6% of original tokens.

**LongLLMLingua: Accelerating and Enhancing LLMs in Long Context Scenarios via Prompt Compression**
Huiqiang Jiang et al. ACL 2024.
URL: https://arxiv.org/abs/2310.06839
*Key contribution:* Extended LLMLingua with question-aware compression for RAG, achieving up to 21.4% accuracy improvement on NaturalQuestions at 4× compression.

**LLMLingua Project Pages and Microsoft Research Blog**
URL: https://www.llmlingua.com/llmlingua.html | https://llmlingua.com/llmlingua2.html | https://www.microsoft.com/en-us/research/blog/llmlingua-innovating-llm-efficiency-with-prompt-compression/
*Key contribution:* Detailed benchmark tables, latency measurements, and compression examples.

**LangChain Contextual Compression Documentation**
URL: https://python.langchain.com/v0.2/docs/how_to/contextual_compression/ | https://docs.langchain.com/oss/python/integrations/retrievers/llmlingua
*Key contribution:* Production integration patterns for compression retrievers including LLMLingua, embeddings filters, and LLM-based extractors.

**EXIT: Context-Aware Extractive Compression for RAG**
URL: https://arxiv.org/pdf/2412.12559
*Key contribution:* Third-party benchmark comparing RECOMP, LongLLMLingua, and newer compression methods on identical evaluation settings.

**Provence (ICLR 2025)**
URL: https://proceedings.iclr.cc/paper_files/paper/2025/file/5e956fef0946dc1e39760f94b78045fe-Paper-Conference.pdf
*Key contribution:* Identified limitations of both RECOMP's independent sentence encoding and LLMLingua's fixed compression ratio.

**OpenAI API Pricing**
URL: https://developers.openai.com/api/docs/pricing/
*Key contribution:* Current token pricing for GPT-4o, GPT-4o-mini, and other models used in cost analysis.

**Anthropic Claude Pricing**
URL: https://platform.claude.com/docs/en/about-claude/pricing
*Key contribution:* Current token pricing for Claude model family.