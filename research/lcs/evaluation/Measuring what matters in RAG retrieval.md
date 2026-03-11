# Measuring what matters in RAG retrieval

**The retrieval stage of a Retrieval-Augmented Generation pipeline is only as good as the metrics used to evaluate it.** Five classical information retrieval metrics — Precision@k, Recall@k, NDCG@k, MRR, and MAP — form the quantitative backbone of RAG retrieval evaluation, but choosing among them depends on whether a system needs comprehensive context or a single best passage. Newer reference-free frameworks like RAGAS and ARES attempt to sidestep the expensive ground-truth problem entirely by using LLMs as evaluators, achieving up to **95% agreement with human annotators** on faithfulness judgments. This analysis defines each metric mathematically, examines the practical challenge of obtaining relevance labels, and evaluates how well automated alternatives correlate with human judgment.

## The five core retrieval metrics and their mathematics

Every RAG retrieval evaluator ultimately computes some combination of five metrics inherited from decades of information retrieval research. Understanding their mathematical structure reveals which ones align with different RAG objectives.

**Precision@k** measures the fraction of retrieved documents that are relevant among the top-k results. It is defined as:

    Precision@k = |{relevant documents} ∩ {top-k retrieved}| / k

This metric is position-agnostic within the top-k window — a relevant document at rank 1 and rank k contribute equally. It answers: "Of the chunks I fed to my LLM, how many were actually useful?"

**Recall@k** measures the fraction of all relevant documents that appear in the top-k results:

    Recall@k = |{relevant documents} ∩ {top-k retrieved}| / |{all relevant documents}|

Recall directly captures completeness. For multi-hop reasoning, legal research, or medical QA — where missing a relevant passage can produce an incomplete or wrong answer — Recall@k is the primary metric of interest.

**Mean Reciprocal Rank (MRR)** focuses exclusively on the first relevant result, averaging across queries:

    MRR = (1/N) × Σᵢ (1 / rankᵢ)

where rankᵢ is the position of the first relevant document for query i. MRR is the natural choice when a RAG system uses only the top-1 retrieved passage, as in factoid question answering.

**Mean Average Precision (MAP)** combines rank-awareness with recall sensitivity. Average Precision for a single query is:

    AP = (1/|R|) × Σₖ Precision@k × rel(k)

where |R| is the total number of relevant documents and rel(k) is a binary indicator at rank k. MAP averages AP across all queries. Because non-retrieved relevant documents implicitly receive a precision of zero, MAP penalizes both poor ranking and incomplete retrieval.

**Normalized Discounted Cumulative Gain (NDCG@k)** is the only standard metric that handles graded relevance — distinguishing "highly relevant" from "somewhat relevant" passages:

    DCG@k = Σᵢ₌₁ᵏ relᵢ / log₂(i + 1)
    NDCG@k = DCG@k / IDCG@k

where IDCG@k is the DCG of the ideal (perfectly sorted) ranking. The logarithmic discount heavily rewards relevant documents at higher positions. The BEIR benchmark ([Thakur et al., NeurIPS 2021](https://openreview.net/forum?id=wCu6T5xFjeJ)) chose **NDCG@10 as its primary evaluation metric** precisely because it works with both binary and graded relevance labels, enabling comparable results across heterogeneous datasets. An alternative DCG formulation using (2^relᵢ − 1) in the numerator further amplifies the gap between relevance grades and is common in web search evaluation.

**Which metric for which RAG objective?** For recall-oriented retrieval — where the system must gather all relevant chunks before generation — **Recall@k** (at high k values like 100) combined with **MAP** provides the most diagnostic signal. MAP rewards systems that rank relevant documents highly while penalizing missed documents. For precision-oriented retrieval — where only the single best chunk matters — **MRR** directly measures how quickly the first relevant passage appears, and **Precision@1** gives a simple hit-or-miss score. NDCG@k serves as a strong general-purpose metric that balances both concerns, which explains its adoption as the standard across BEIR's 18 benchmark datasets and the [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard). Typical k values in RAG evaluation range from k=5 for small-context pipelines to k=10 (the BEIR default) for standard evaluation to k=100 for first-stage retrieval before reranking.

## Obtaining relevance judgments is the hardest practical problem

All five metrics above require ground-truth relevance labels — binary or graded judgments indicating which documents are relevant to each query. For a custom enterprise corpus, no such labels exist. This creates the central practical challenge of RAG evaluation.

**The TREC pooling method** remains the gold standard for constructing reusable test collections. Multiple retrieval systems each submit their top-K results (typically K=100) for each query; the union of these results forms a "pool" that human assessors then judge. TREC collections typically assess roughly **1,500 documents per topic** after deduplication, and research by Voorhees demonstrated that while changing assessors affects absolute scores, it preserves relative system rankings — the property that matters most for system comparison. The [trec_eval tool](https://github.com/usnistgov/trec_eval) from NIST computes all standard metrics from a qrels file (query-id, document-id, relevance-score triples) and a ranked results file, and its Python wrapper [pytrec_eval](https://github.com/cvangysel/pytrec_eval) is what BEIR uses internally.

**Synthetic query generation** offers a scalable alternative. The InPars approach ([Bonifacio et al., SIGIR 2022](https://arxiv.org/abs/2301.01820)) uses an LLM to generate plausible queries for each document via few-shot prompting, then filters aggressively — discarding roughly 90% of generated queries based on reranker scores. ARES ([Saad-Falcon et al., NAACL 2024](https://arxiv.org/abs/2311.09476)) extends this by generating full query-passage-answer triples from corpus passages and creating both positive and negative examples for training lightweight evaluation judges. [LlamaIndex's evaluation module](https://docs.llamaindex.ai/en/stable/module_guides/evaluating/usage_pattern_retrieval/) provides a built-in `generate_question_context_pairs` function that automates this process, producing evaluation datasets with query-to-relevant-document mappings. However, research by Chaudhary et al. (2023) found that synthetic query generation approaches "struggle to capture the full nuance of the relevance label space," making them better suited for binary relevance than fine-grained graded judgments.

**Human annotation** remains necessary but can be minimized. Full TREC-style evaluation requires expert assessors spending roughly one minute per query-document pair across thousands of judgments — prohibitively expensive for most teams. The practical middle ground is what ARES demonstrated: a small validation set of **~150 human-annotated datapoints** is sufficient when combined with Prediction-Powered Inference to calibrate automated judges. Crowdsourcing via platforms like Amazon Mechanical Turk has been validated as producing judgments comparable to expert annotations when combined with majority voting and quality control, as shown in the TREC 2011 Crowdsourcing track.

## LLM-as-judge versus click-through proxies versus human labels

The tradeoff between evaluation methods reduces to a three-way tension between cost, reliability, and scalability.

**LLM-as-judge** has become the dominant approach for rapid iteration. The landmark study by [Zheng et al. (NeurIPS 2023)](https://arxiv.org/abs/2306.05685) established that GPT-4 matches human preferences at **over 80% agreement** — the same level as inter-human agreement — across pairwise comparisons on MT-Bench. However, the study identified three systematic biases: **position bias** (favoring the first-presented answer), **verbosity bias** (preferring longer responses regardless of quality), and **self-enhancement bias** (rating outputs from the same model family higher). Mitigation strategies include swapping answer positions and averaging, using chain-of-thought reasoning, and reference-guided grading for objective questions.

For retrieval evaluation specifically, the [SynDL benchmark](https://arxiv.org/abs/2408.16312) (Rahmani et al., WWW 2025) compared system rankings produced by LLM-generated relevance labels against human TREC Deep Learning judgments, finding **Kendall's τ of 0.857 for NDCG@10** — strong enough to reliably rank retrieval systems. Notably, GPT-based retrieval systems did not receive inflated scores from GPT-based judges, partially alleviating self-enhancement concerns for retrieval tasks. The [RAGBench study](https://arxiv.org/abs/2407.11005) (Friel et al., 2024) added an important nuance: a fine-tuned **400M-parameter DeBERTa model was competitive with billion-parameter LLM judges** on RAG evaluation, suggesting that smaller, cheaper models can serve as production evaluators once trained on domain-specific data.

**Click-through and implicit feedback** proxies are viable only for deployed systems with real user traffic. Joachims et al.'s foundational research at Cornell established that raw clicks cannot be interpreted as absolute relevance judgments, but **relative preferences derived from clicks achieve 80–90% accuracy** using strategies like "Click > Skip Above" (inferring that a clicked result is preferred over higher-ranked results the user skipped). The critical limitation is position bias: rank-1 results receive dramatically more clicks regardless of actual relevance. Debiasing methods like Inverse Propensity Weighting correct for position effects but introduce high variance, and companies like Microsoft run randomization experiments ("exploration buckets") to measure position bias factors directly. Click-through data works best for online A/B testing and long-term quality monitoring but is unavailable for pre-deployment evaluation.

The cost structure makes the choice concrete. Expert human annotation costs **$1–5 per judgment** at low throughput (hundreds per day per annotator). LLM-as-judge costs **$0.01–0.10 per assessment** at essentially unlimited throughput. Click-through data has near-zero marginal cost but requires production infrastructure and debiasing models. The emerging consensus across the literature is to use LLM judges for rapid development iteration, calibrate them against a small human-annotated validation set (150–300 examples), and supplement with implicit feedback signals in production.

## RAGAS context metrics as reference-free alternatives

The RAGAS framework ([Es et al., EACL 2024](https://arxiv.org/abs/2309.15217)) introduced three reference-free metrics that evaluate RAG pipelines using only the question, retrieved context, and generated answer — no ground-truth labels required.

**Context Relevance** measures the signal-to-noise ratio of retrieved passages. An LLM extracts sentences from the context that are crucial for answering the question; the metric is the ratio of extracted relevant sentences to total sentences:

    Context Relevance = |extracted relevant sentences| / |total sentences in context|

This captures a distinctly RAG-specific concern: even when all retrieved passages contain a relevant sentence somewhere, padding with irrelevant text can degrade generation quality by diluting the LLM's attention.

**Context Recall** is the one RAGAS metric that requires a reference answer. It decomposes the reference into individual claims, then checks whether each claim can be attributed to the retrieved context:

    Context Recall = |reference claims supported by context| / |total reference claims|

This functions as a recall proxy without requiring document-level relevance labels — instead of asking "did you retrieve the right documents?", it asks "did you retrieve enough information to support the correct answer?"

**Faithfulness** measures hallucination risk by extracting atomic statements from the generated answer and verifying each against the retrieved context:

    Faithfulness = |statements supported by context| / |total extracted statements|

The RAGAS paper validated these metrics against human judgments using WikiEval, a custom dataset of 50 Wikipedia-based question-context-answer triples annotated by two human assessors. Agreement rates in pairwise comparisons were **95% for faithfulness, 78% for answer relevance, and 70% for context relevance**. RAGAS substantially outperformed both naïve GPT-based scoring (0–10 ratings) and direct GPT-based ranking baselines. The strong faithfulness result makes RAGAS particularly reliable for hallucination detection, while the lower context relevance agreement reflects the inherent difficulty of evaluating retrieval quality — longer contexts cause LLMs to struggle more with relevance extraction.

The RAGAS framework has since expanded beyond the original paper to include **Context Precision** (whether relevant chunks are ranked above irrelevant ones, computed as weighted mean of Precision@k) and additional variants with and without LLM involvement, available in the [open-source library](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/).

## ARES addresses RAGAS limitations with statistical guarantees

ARES ([Saad-Falcon et al., NAACL 2024](https://arxiv.org/abs/2311.09476)) directly critiques RAGAS as relying on "a handful of heuristic hand-written prompts" that offer "little adaptability to new RAG evaluation settings." ARES replaces fixed prompts with a three-stage pipeline: synthetic training data generation from the target corpus, fine-tuning of lightweight DeBERTa-v3-Large judges for context relevance, faithfulness, and answer relevance, and scoring via Prediction-Powered Inference (PPI) that combines judge predictions with a small human validation set to produce **confidence intervals** rather than point estimates.

Empirically, ARES outperformed RAGAS by **59.3 percentage points on context relevance** and **14.4 percentage points on answer relevance** across six KILT/SuperGLUE datasets, with a **Kendall's τ improvement of 0.065** in system ranking accuracy. The PPI mechanism provides something RAGAS cannot: statistical guarantees about evaluation quality, requiring only ~150 human-annotated datapoints. ARES also demonstrated that GPT-4 labels can substitute for human annotations at a modest quality reduction (Kendall's τ decrease of 0.05–0.30), dramatically cutting costs from hundreds of annotations to fewer than ten few-shot prompts.

## Choosing an evaluation strategy for production RAG

The practical landscape reveals a clear hierarchy. [LlamaIndex's RetrieverEvaluator](https://docs.llamaindex.ai/en/stable/module_guides/evaluating/usage_pattern_retrieval/) provides the most complete implementation of traditional IR metrics — Hit Rate, MRR, Precision, Recall, AP, and NDCG — against ground-truth document IDs. [LangSmith](https://docs.langchain.com/langsmith/evaluate-rag-tutorial) takes a different approach, relying entirely on LLM-as-judge for all evaluation including retrieval quality. RAGAS, DeepEval, and TruLens sit in between, offering LLM-based retrieval evaluation metrics that approximate classical measures without requiring ground-truth labels.

One finding deserves special attention. The eRAG study ([Salemi et al., 2024](https://arxiv.org/abs/2404.13781)) demonstrated that **traditional query-document relevance labels show low correlation with actual RAG downstream performance** — a document judged "relevant" by IR standards may not actually help the LLM generate a better answer. This suggests that the field is moving toward evaluation paradigms that assess retrieval quality through its effect on generation, rather than through standalone relevance judgments.

The recommended evaluation stack for a production RAG system combines multiple approaches. Use **NDCG@10 and Recall@k** with a small human-annotated test set (150–300 examples) as the anchor metric for retrieval quality. Layer **RAGAS faithfulness** (95% human agreement) for continuous hallucination monitoring. Apply **ARES-style fine-tuned judges with PPI** when you need statistical confidence intervals for stakeholder reporting. And supplement with **click-through analytics** once in production, using position-debiased implicit feedback to detect quality degradation at scale. No single metric or method is sufficient — but this layered approach addresses the complementary needs of development iteration, quality assurance, and production monitoring.

---

## Bibliography

**Es, S., James, J., Espinosa-Anke, L., & Schockaert, S. (2024).** "RAGAS: Automated Evaluation of Retrieval Augmented Generation." *Proceedings of EACL 2024: System Demonstrations*, 150–158. https://arxiv.org/abs/2309.15217 — Introduced reference-free RAG evaluation metrics (faithfulness, answer relevance, context relevance) with 95% faithfulness agreement with human annotators on WikiEval.

**Saad-Falcon, J., Khattab, O., Potts, C., & Zaharia, M. (2024).** "ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems." *Proceedings of NAACL 2024*, 338–354. https://arxiv.org/abs/2311.09476 — Fine-tuned lightweight LM judges with Prediction-Powered Inference; outperformed RAGAS by 59.3 pp on context relevance with only ~150 human annotations.

**Thakur, N., Reimers, N., Rücklé, A., Srivastava, A., & Gurevych, I. (2021).** "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models." *NeurIPS 2021 Datasets and Benchmarks Track*. https://openreview.net/forum?id=wCu6T5xFjeJ — Established NDCG@10 as the standard retrieval evaluation metric across 18 diverse datasets; uses pytrec_eval internally.

**Zheng, L., Chiang, W.-L., Sheng, Y., et al. (2023).** "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." *NeurIPS 2023*. https://arxiv.org/abs/2306.05685 — Found GPT-4 judges achieve >80% agreement with humans; identified position, verbosity, and self-enhancement biases.

**Rahmani, H., et al. (2025).** "SynDL: A Synthetic Test Collection for Passage Retrieval." *Proceedings of WWW 2025*. https://arxiv.org/abs/2408.16312 — Demonstrated Kendall's τ = 0.857 between LLM-generated and human relevance judgments for NDCG@10 system rankings.

**Friel, R., et al. (2024).** "RAGBench: Explainable Benchmark for Retrieval-Augmented Generation Systems." https://arxiv.org/abs/2407.11005 — 100K-example benchmark across 5 domains; showed fine-tuned 400M DeBERTa competitive with billion-parameter LLM judges.

**Salemi, A., et al. (2024).** "eRAG: Enhanced Retrieval Augmented Generation." https://arxiv.org/abs/2404.13781 — Found traditional relevance labels show low correlation with RAG downstream task performance; proposed per-document evaluation through the LLM.

**Bonifacio, L., et al. (2022).** "InPars: Data Augmentation for Information Retrieval using Large Language Models." *SIGIR 2022*. https://arxiv.org/abs/2301.01820 — Synthetic query generation for retrieval training/evaluation via LLM few-shot prompting with aggressive filtering.

**Joachims, T., Granka, L., Pan, B., Hembrooke, H., & Gay, G. (2005).** "Accurately Interpreting Clickthrough Data as Implicit Feedback." *SIGIR 2005*. https://www.cs.cornell.edu/people/tj/publications/joachims_etal_05a.pdf — Established that clicks are "informative but biased"; relative preference strategies achieve 80–90% accuracy.

**NIST trec_eval.** Official TREC evaluation tool. https://github.com/usnistgov/trec_eval — Standard implementation of IR evaluation metrics; metric definitions documented at https://trec.nist.gov/pubs/trec16/appendices/measures.pdf.

**LlamaIndex Retrieval Evaluation Module.** https://docs.llamaindex.ai/en/stable/module_guides/evaluating/usage_pattern_retrieval/ — Provides Hit Rate, MRR, Precision, Recall, AP, and NDCG evaluation against ground-truth document IDs with synthetic dataset generation.

**LangSmith RAG Evaluation Tutorial.** https://docs.langchain.com/langsmith/evaluate-rag-tutorial — LLM-as-judge framework for correctness, relevance, groundedness, and retrieval relevance evaluation.

**RAGAS Metrics Documentation.** https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/ — Extended metric library including Context Precision, Context Recall, Noise Sensitivity, and LLM/non-LLM variants.