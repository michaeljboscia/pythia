# NLI models for contradiction detection in knowledge bases

**DeBERTa-v3-base fine-tuned on multiple NLI datasets is the strongest choice for detecting contradictions in technical knowledge bases, but all current NLI models share critical blind spots on numerical reasoning, implicit type conflicts, and domain-specific vocabulary that demand a hybrid detection pipeline.** Pairwise NLI checking across a 1,000-document corpus is computationally tractable — under 10 minutes on a single T4 GPU — yet the O(n²) scaling of naive pairwise comparison makes embedding-based pre-filtering the single most important architectural decision. This analysis synthesizes benchmark data, documented failure modes, and inference cost modeling from primary sources to guide system design.

---

## Three models, two architectures, one surprising result

The three models under evaluation share a common task — classifying sentence pairs as *entailment*, *neutral*, or *contradiction* — but differ meaningfully in architecture, training data, and downstream strengths.

**MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli** uses Microsoft's [DeBERTa-v3-base](https://huggingface.co/microsoft/deberta-v3-base) as its backbone: 12 transformer layers, 768 hidden dimensions, and **86 million backbone parameters** plus 98 million in its 128K-token vocabulary embedding. DeBERTa-v3's key architectural innovation is *disentangled attention*, which represents each token with separate content and position vectors, computing content-to-content, content-to-position, and position-to-content attention matrices independently. This mechanism, introduced in [He et al. (2021)](https://arxiv.org/abs/2006.03654), gives the model finer-grained syntactic sensitivity than standard BERT-style attention. The v3 variant adds ELECTRA-style *Replaced Token Detection* pre-training with *Gradient-Disentangled Embedding Sharing* ([He et al., 2023](https://arxiv.org/abs/2111.09543)), which trains on all tokens rather than only 15% masked tokens, dramatically improving sample efficiency. Laurer fine-tuned this backbone on **763,913 NLI pairs** spanning [MultiNLI](https://arxiv.org/abs/1704.05426) (392K pairs across 10 genres), [FEVER-NLI](https://arxiv.org/abs/1803.05355) (fact-verification claims derived from Wikipedia), and [Adversarial NLI](https://arxiv.org/abs/1910.14599) (162K human-adversarial examples). The result is a model that scores **90.3% on MNLI matched/mismatched**, **77.7% on FEVER-NLI**, and **57.9% on ANLI combined** ([model card](https://huggingface.co/MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli)). The ANLI score matters most for contradiction detection: ANLI was constructed through an iterative human-and-model-in-the-loop process where annotators specifically craft examples that fool state-of-the-art models, requiring multi-hop reasoning, world knowledge, and numerical understanding ([Nie et al., 2020](https://arxiv.org/abs/1910.14599)).

**cross-encoder/nli-deberta-v3-base** shares the identical DeBERTa-v3-base backbone but differs in training and framework. Developed within the [Sentence-Transformers](https://www.sbert.net/docs/cross_encoder/pretrained_models.html) ecosystem, it is trained as a *cross-encoder* — both sentences are concatenated and processed in a single forward pass with full token-level cross-attention. It was trained on SNLI (570K pairs from [Bowman et al., 2015](https://arxiv.org/abs/1508.05326)) and MultiNLI, achieving **92.38% on SNLI test** and **90.04% on MNLI mismatched** ([model card](https://huggingface.co/cross-encoder/nli-deberta-v3-base)). Notably, ANLI was not included in its training data, meaning it lacks explicit adversarial robustness training. Its SNLI score is the highest among the cross-encoder NLI family, surpassing even the DeBERTa-v3-large variant (92.20%) on that benchmark.

**FacebookAI/roberta-large-mnli** is architecturally simpler but substantially larger: 24 transformer layers, 1024 hidden dimensions, and **355 million parameters**. RoBERTa is BERT with optimized training — dynamic masking, removal of next-sentence prediction, larger batches, and 160GB of training text — as demonstrated by [Liu et al. (2019)](https://arxiv.org/abs/1907.11692). Fine-tuned on MultiNLI alone, it achieves **90.2% on MNLI matched** and **91.3% on XNLI English** ([model card](https://huggingface.co/FacebookAI/roberta-large-mnli)). Without ANLI or FEVER training data, its adversarial robustness is limited: on ANLI Round 3, RoBERTa-large scored only **44.4%** even when trained on prior ANLI rounds ([Nie et al., 2020](https://arxiv.org/abs/1910.14599)).

The surprising result is that **DeBERTa-v3-base matches or exceeds RoBERTa-large on MNLI with half the parameters**. The [DeBERTa-v3 paper](https://arxiv.org/abs/2111.09543) reports DeBERTa-v3-base at 90.6% MNLI matched versus RoBERTa-large's 90.2%, a meaningful gap given that the base model is 86M backbone parameters versus 355M. For contradiction detection in knowledge bases, Laurer's multi-dataset fine-tuning adds FEVER and ANLI robustness at no additional parameter cost.

| Model | Params | MNLI-m | SNLI | ANLI-all | Training data |
|-------|--------|--------|------|----------|---------------|
| DeBERTa-v3-base-mnli-fever-anli | 184M | 90.3% | — | 57.9% | MNLI + FEVER + ANLI |
| cross-encoder/nli-deberta-v3-base | 184M | 90.0% (mm) | 92.4% | — | SNLI + MNLI |
| roberta-large-mnli | 355M | 90.2% | — | — | MNLI only |

For technical knowledge base applications, the Laurer DeBERTa variant is the strongest default. Its ANLI training provides exposure to adversarial reasoning patterns — numerical inference, coreference, world knowledge — that map directly onto the challenges of technical text. The cross-encoder variant trades ANLI robustness for slightly higher SNLI accuracy, valuable if the primary concern is clean sentence-pair classification rather than adversarial robustness. RoBERTa-large-mnli offers no architectural or accuracy advantage over the DeBERTa options while consuming roughly twice the memory.

---

## Why NLI models fail on technical documentation

The literature documents a taxonomy of failure modes that become especially severe when NLI models encounter technical text. Understanding these failure modes is essential for designing effective contradiction detection systems.

**Annotation artifacts create systematic bias.** [Gururangan et al. (2018)](https://aclanthology.org/N18-2017/) demonstrated that a classifier using only the hypothesis — without seeing the premise — achieves **67% accuracy on SNLI** and **53% on MultiNLI**. The mechanism is straightforward: crowd-workers writing contradiction hypotheses disproportionately use negation words ("nobody," "never," "nothing"), while entailment hypotheses tend to be shorter and use vague language. Models trained on these datasets internalize these spurious correlations. For technical documentation, this means statements containing "does not support," "not compatible," or "no longer available" may trigger false contradiction predictions regardless of the premise content. Conversely, [LLM-generated NLI data exhibits the same artifacts](https://arxiv.org/html/2410.08996v1) — hypothesis-only classifiers achieve **86–96% accuracy** on datasets elicited from GPT-4 and Llama-2.

**Lexical overlap heuristics cause high-overlap false entailment.** [McCoy, Pavlick, and Linzen (2019)](https://aclanthology.org/P19-1334/) introduced the HANS evaluation set, revealing that BERT fine-tuned on MNLI achieves **near-zero accuracy** on non-entailment examples where premise and hypothesis share most words. The model learns three fallible heuristics: lexical overlap → entailment, subsequence → entailment, constituent → entailment. Technical documentation is uniquely vulnerable because related statements about the same API, function, or configuration necessarily share extensive vocabulary. "The `parse()` function returns a list of tokens" and "The `parse()` function returns a dictionary of tokens" differ by a single word — but that word changes the return type entirely. An NLI model relying on overlap heuristics would predict entailment.

**Numerical and version-specific reasoning is effectively absent.** [Naik et al. (2018)](https://aclanthology.org/C18-1198/) identified numerical reasoning as one of six systematic failure categories in NLI stress tests. Models trained on SNLI do not learn to use number words for classification because matching object references is sufficient for most training pairs. The [LoNLI benchmark](https://arxiv.org/abs/2112.02333) (Tarunesh et al., 2021) confirms that numerical, comparative, and scalar reasoning remain persistent bottlenecks across model families. For technical knowledge bases, this is devastating: version-specific claims ("the walrus operator was added in Python 3.8" vs. "Python 3.9 introduced the walrus operator"), port numbers ("the server runs on port 8080" vs. "port 3000"), and parameter counts are all invisible to NLI models. The models lack any mechanism to treat version numbers as ordered quantities or to infer that `v3.8 ≠ v3.9` constitutes a factual contradiction.

**Negation scope confuses even strong models.** The [NaN-NLI test suite](https://arxiv.org/abs/2210.03256) (Truong et al., 2022) focuses specifically on sub-clausal negation — cases where "not" modifies a phrase rather than a clause. RoBERTa-MNLI shows significantly degraded performance on these examples, frequently confusing contradiction and entailment when negation scope is ambiguous. [ScoNe-NLI](https://liner.com/review/scone-benchmarking-negation-reasoning-in-language-models-with-finetuning-and) found that InstructGPT's performance mirrors an "ignore negation" baseline: **100% accuracy on zero/double negation, 0% on single negation**. Technical documentation relies heavily on precise negation: "This function does not raise exceptions" versus "This function may not handle all edge cases" differ fundamentally in meaning despite similar surface structure.

**Implicit contradictions remain the hardest unsolved case.** The [Implied NLI Dataset (INLI)](https://arxiv.org/abs/2501.07719) (Havaldar et al., 2025) formalizes implicit inference and finds that standard NLI models **perform at chance on implicit entailment** unless explicitly augmented. Two statements can be factually incompatible without using negation or antonyms — "the function returns a list" versus "the function returns a dictionary" requires knowing that `list ≠ dictionary` in programming. [Glockner, Shwartz, and Goldberg (2018)](https://aclanthology.org/P18-2103/) showed that replacing a single word in SNLI premises to require basic lexical knowledge (synonyms, antonyms, hypernyms) causes substantial accuracy drops, even though these modified examples are superficially simpler than the originals. For technical domains, the relevant lexical relationships — between programming types, API methods, configuration options — are entirely absent from NLI training data.

**Domain shift compounds all other failures.** [Dima (2021)](https://onlinelibrary.wiley.com/doi/abs/10.1002/ail2.33) argues that NLP is fundamentally "not ready for technical domains" because training corpora don't represent technical language, and standard syntactic assumptions break down for technical text featuring inconsistent punctuation, domain-specific abbreviations, camelCase identifiers, and non-standard syntax. [Zero-shot domain adaptation experiments](https://www.sciencedirect.com/science/article/abs/pii/S095070512100455X) show accuracy drops to near-random (**47.6%**) for some domain pairs. No published NLI dataset specifically targets code documentation, making performance on software knowledge bases completely untested.

The practical implication is that NLI models will reliably catch explicit contradictions where one statement directly negates another using standard language, but will systematically miss the most important class of technical contradictions: those involving type mismatches, version conflicts, numerical disagreements, and domain-specific semantic incompatibilities.

---

## How NLI applies to knowledge base consistency at scale

Despite these limitations, NLI remains the most practical tool for automated contradiction detection in knowledge bases, provided the system design accounts for its weaknesses. The literature offers both theoretical grounding and practical patterns.

[SummaC](https://arxiv.org/abs/2111.09525) (Laban et al., 2022) demonstrated that NLI models underperform on document-level consistency checking due to **input granularity mismatch** — NLI datasets are sentence-level, but real documents contain multi-sentence arguments. Their solution, SummaCConv, segments documents into sentence units, creates M×N NLI pair matrices, and aggregates scores, achieving **74.4% balanced accuracy** on factual consistency benchmarks, a 5-point improvement over prior approaches. This sentence-level decomposition strategy is directly applicable to knowledge base checking.

Recent work on [global consistency checking](https://arxiv.org/html/2601.13600) (2025) formalizes the problem of verifying whether a set of natural-language facts is globally consistent. The authors show that pairwise NLI checks are theoretically insufficient for global coherence — exponentially many queries may be needed in the worst case — but propose adaptive divide-and-conquer algorithms that make the problem tractable. For practical systems, this means pairwise NLI should be treated as a high-recall first pass, with flagged contradictions reviewed by more sophisticated reasoning (human or LLM-based).

The [FEVER shared task](https://arxiv.org/abs/1803.05355) (Thorne et al., 2018) established the dominant pipeline architecture for fact verification: evidence retrieval followed by NLI-style classification. Its 185,445 claims, each requiring evidence retrieval from Wikipedia, showed that **evidence retrieval is the bottleneck** — the best systems at the time achieved only 64.21% FEVER score. This two-stage architecture maps naturally onto knowledge base contradiction detection: first retrieve candidate pairs that might conflict, then classify with NLI.

The [ALICE system](https://link.springer.com/article/10.1007/s10515-024-00452-x) (Gärtner et al., 2024) tested NLI for requirement contradiction detection in engineering and found that pure NLI approaches fail on implicit contradictions. Integrating formal logic with LLMs detected **60% of contradictions**, substantially more than NLI alone. This confirms that production systems should augment NLI with domain-specific rules or LLM reasoning for the implicit contradiction cases that NLI models miss.

---

## The O(n²) problem and what it actually costs

A 1,000-document corpus generates **499,500 unique pairs** for pairwise comparison. The computational cost depends heavily on hardware, optimization level, and — most critically — whether pre-filtering reduces the pair count.

**Model memory footprints** are modest. DeBERTa-v3-base requires approximately **700MB in FP32** or **350MB in FP16**, fitting comfortably on any modern GPU. RoBERTa-large requires roughly **1.4GB in FP32**, still well within even a T4's 16GB VRAM. Both models need only **1–2GB of system RAM** for CPU inference ([model card discussion](https://huggingface.co/microsoft/deberta-v3-base/discussions/6)).

**GPU inference is fast and cheap.** On an NVIDIA T4 (the most cost-effective cloud GPU at ~$0.53/hour on AWS g4dn.xlarge), DeBERTa-v3-base processes roughly **500–800 pairs per second** with batch size 32 in unoptimized PyTorch, based on benchmarks showing [BERT-base at 5–8ms per inference on T4](https://developer.nvidia.com/blog/real-time-nlp-with-bert-using-tensorrt-updated/) with DeBERTa adding approximately 20–50% overhead due to disentangled attention. ONNX Runtime optimization increases throughput to roughly **1,000–1,500 pairs per second** — [Sentence-Transformers documents 1.4–3× speedups from ONNX conversion](https://sbert.net/docs/cross_encoder/usage/efficiency.html). On an A100 with TensorRT, throughput reaches **3,000–5,000 pairs per second**.

For the full 499,500-pair workload without pre-filtering:

| Configuration | Time | Cost |
|---|---|---|
| T4, PyTorch unoptimized (BS=32) | ~17 minutes | ~$0.15 |
| T4, ONNX optimized | ~7 minutes | ~$0.06 |
| A100, TensorRT | ~2 minutes | ~$0.14 |
| CPU (16 vCPU), ONNX INT8 quantized | ~3.5 hours | ~$1.40 |

These numbers are manageable for a 1,000-document corpus. The problem emerges at scale: 5,000 documents produce 12.5 million pairs, and 10,000 documents produce nearly 50 million. At 10,000 documents, even an A100 with TensorRT needs roughly **3.5 hours** — feasible but expensive.

**Pre-filtering is the decisive optimization.** A bi-encoder embedding model such as [all-MiniLM-L6-v2](https://www.sbert.net/docs/cross_encoder/pretrained_models.html) can encode all 1,000 documents in seconds (O(n) rather than O(n²)), then approximate nearest neighbor search identifies only the high-similarity pairs worth sending to the cross-encoder. If this step reduces pairs by **90%** — from 499,500 to ~50,000 — the T4 ONNX time drops to about **40 seconds at $0.006**. The [Sentence-Transformers documentation](https://www.sbert.net/docs/cross_encoder/pretrained_models.html) explicitly recommends this bi-encoder → cross-encoder pipeline as the production best practice, with the bi-encoder providing high recall and the cross-encoder providing high precision.

Additional optimization paths include [INT8 quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html), which reduces model size by 4× (700MB → 175MB) with typically less than 1% accuracy loss, and the pre-exported `model_qint8_avx512_vnni.onnx` available directly from the [cross-encoder model repository](https://huggingface.co/cross-encoder/nli-deberta-v3-base). [Knowledge distillation](https://getstream.io/blog/optimize-transformer-inference/) to DeBERTa-v3-xsmall (22M backbone parameters, one-quarter of base) retains strong MNLI performance while cutting inference time substantially.

RoBERTa-large-mnli's **355M parameters** roughly double inference time and memory relative to either DeBERTa-v3-base variant, with no accuracy advantage on the MNLI benchmark. For cost-conscious deployments, it is strictly dominated.

---

## Designing a practical contradiction detection pipeline

The evidence converges on a three-stage architecture that balances NLI's strengths against its documented weaknesses.

**Stage 1: Semantic pre-filtering.** Encode all documents with a fast bi-encoder, then use cosine similarity or FAISS nearest-neighbor search to identify candidate pairs above a similarity threshold. This reduces the quadratic pair space to a manageable linear or near-linear set. The threshold should be tuned conservatively — contradictory statements often share high lexical overlap (they discuss the same topic but make incompatible claims), so a similarity threshold of 0.5–0.7 captures most potential contradictions while eliminating clearly unrelated pairs.

**Stage 2: NLI classification.** Run DeBERTa-v3-base-mnli-fever-anli on the filtered pairs, using ONNX Runtime with INT8 quantization for optimal throughput. Flag all pairs classified as "contradiction" with confidence above a tunable threshold. The ANLI training data in Laurer's model provides the best available robustness against adversarial patterns. For the cross-encoder variant from Sentence-Transformers, the built-in `predict()` method with batch processing handles inference efficiently.

**Stage 3: Domain-specific verification.** The flagged contradictions from Stage 2 will include both true contradictions and false positives from annotation artifacts (negation bias) and lexical overlap heuristics. Simultaneously, NLI will miss implicit contradictions involving type mismatches, version conflicts, and numerical disagreements. This stage requires either domain-specific rules (regex-based version comparison, type compatibility checks) or LLM-based reasoning to catch what NLI misses and filter what NLI gets wrong. The [ALICE system's](https://link.springer.com/article/10.1007/s10515-024-00452-x) finding that combining formal logic with language models detects 60% of contradictions — versus much less with NLI alone — underscores the need for this hybrid approach.

The total cost for a 1,000-document knowledge base with this pipeline is well under a dollar on cloud GPU infrastructure, with processing time measured in minutes rather than hours. The real engineering challenge is not computational cost but building the domain-specific verification layer that compensates for NLI's systematic blind spots on technical text.

---

## Conclusion

DeBERTa-v3-base-mnli-fever-anli offers the best accuracy-to-cost ratio for knowledge base contradiction detection, matching RoBERTa-large's MNLI accuracy at half the parameter count while adding adversarial and fact-verification robustness from ANLI and FEVER training. The cross-encoder variant provides marginally better clean-benchmark scores at the cost of ANLI robustness. RoBERTa-large-mnli is dominated on both efficiency and accuracy metrics.

The most important insight from this analysis is not about model selection but about **what NLI cannot do**. The documented failure modes — numerical reasoning blindness, implicit contradiction invisibility, domain shift degradation, and annotation artifact bias — are not edge cases for technical knowledge bases; they describe the *primary* contradiction types in software documentation. Version conflicts, type mismatches, and configuration incompatibilities are the contradictions that matter most, and they are precisely the ones NLI models are least equipped to detect.

A viable system therefore uses NLI as a high-throughput first pass with embedding pre-filtering to manage O(n²) scaling, then layers domain-aware verification — whether rule-based or LLM-powered — to catch the contradictions that fall through NLI's systematic gaps. The computational infrastructure for this approach is inexpensive and well-understood; the open research problem is building the domain-specific reasoning layer that closes the gap between what NLI detects and what actually matters.

---

## Bibliography

1. **Bowman, S.R., Angeli, G., Potts, C., & Manning, C.D. (2015).** "A large annotated corpus for learning natural language inference." *EMNLP 2015.* https://arxiv.org/abs/1508.05326 — Introduced the 570K-pair SNLI dataset, enabling neural approaches to NLI.

2. **Williams, A., Nangia, N., & Bowman, S.R. (2018).** "A Broad-Coverage Challenge Corpus for Sentence Understanding through Inference." *NAACL 2018.* https://arxiv.org/abs/1704.05426 — Created MultiNLI with 433K pairs across 10 genres, establishing cross-domain NLI evaluation.

3. **Nie, Y., Williams, A., Dinan, E., Bansal, M., Weston, J., & Kiela, D. (2020).** "Adversarial NLI: A New Benchmark for Natural Language Understanding." *ACL 2020.* https://arxiv.org/abs/1910.14599 — Human-adversarial NLI dataset revealing systematic model weaknesses in multi-hop and numerical reasoning.

4. **He, P., Liu, X., Gao, J., & Chen, W. (2021).** "DeBERTa: Decoding-enhanced BERT with Disentangled Attention." *ICLR 2021.* https://arxiv.org/abs/2006.03654 — Introduced disentangled attention and Enhanced Mask Decoder; surpassed human performance on SuperGLUE.

5. **He, P., Gao, J., & Chen, W. (2023).** "DeBERTaV3: Improving DeBERTa using ELECTRA-Style Pre-Training with Gradient-Disentangled Embedding Sharing." *ICLR 2023.* https://arxiv.org/abs/2111.09543 — Added RTD pre-training and GDES, achieving 91.37% GLUE average with DeBERTa-v3-large.

6. **Liu, Y., Ott, M., Goyal, N., Du, J., et al. (2019).** "RoBERTa: A Robustly Optimized BERT Pretraining Approach." https://arxiv.org/abs/1907.11692 — Demonstrated that BERT was significantly undertrained; established RoBERTa as the de facto NLI baseline.

7. **Thorne, J., Vlachos, A., Christodoulopoulos, C., & Mittal, A. (2018).** "FEVER: A Large-scale Dataset for Fact Extraction and VERification." *NAACL 2018.* https://arxiv.org/abs/1803.05355 — 185K fact-verification claims establishing the retrieve-then-classify pipeline.

8. **Gururangan, S., Swayamdipta, S., Levy, O., Schwartz, R., Bowman, S.R., & Smith, N.A. (2018).** "Annotation Artifacts in Natural Language Inference Data." *NAACL-HLT 2018.* https://aclanthology.org/N18-2017/ — Showed hypothesis-only baselines achieve 67% on SNLI, revealing systematic annotation artifacts.

9. **McCoy, R.T., Pavlick, E., & Linzen, T. (2019).** "Right for the Wrong Reasons: Diagnosing Syntactic Heuristics in Natural Language Inference." *ACL 2019.* https://aclanthology.org/P19-1334/ — HANS evaluation set exposing near-complete reliance on lexical overlap heuristics.

10. **Glockner, M., Shwartz, V., & Goldberg, Y. (2018).** "Breaking NLI Systems with Sentences that Require Simple Lexical Inferences." *ACL 2018.* https://aclanthology.org/P18-2103/ — Single-word substitutions requiring basic lexical knowledge cause major accuracy drops.

11. **Naik, A., Ravichander, A., Sadeh, N., Rose, C., & Neubig, G. (2018).** "Stress Test Evaluation for Natural Language Inference." *COLING 2018.* https://aclanthology.org/C18-1198/ — Identified six systematic failure categories including numerical reasoning and negation.

12. **Truong, T., et al. (2022).** "Not another Negation Benchmark: The NaN-NLI Test Suite for Sub-clausal Negation." *AACL 2022.* https://arxiv.org/abs/2210.03256 — Demonstrated severe degradation on sub-clausal negation scope.

13. **Laban, P., Schnabel, T., Bennett, P.N., & Hearst, M.A. (2022).** "SummaC: Re-Visiting NLI-based Models for Inconsistency Detection in Summarization." *TACL 2022.* https://arxiv.org/abs/2111.09525 — Sentence-level NLI decomposition achieves 74.4% balanced accuracy on document-level consistency.

14. **Dima, A. (2021).** "Adapting Natural Language Processing for Technical Text." *Applied AI Letters.* https://onlinelibrary.wiley.com/doi/abs/10.1002/ail2.33 — Argued NLP is not ready for technical domains; documented domain-specific challenges.

15. **Gärtner, M., et al. (2024).** "ALICE: Automated Logical Inference and Contradiction Engine." *Automated Software Engineering.* https://link.springer.com/article/10.1007/s10515-024-00452-x — Showed that integrating formal logic with LLMs detects 60% of requirement contradictions.

16. **Havaldar, S., et al. (2025).** "Implied NLI Dataset (INLI)." https://arxiv.org/abs/2501.07719 — Formalized implicit entailment; standard NLI models perform at chance on implicit cases.

17. **Tarunesh, I., et al. (2021).** "LoNLI: An Extensible Framework for Testing Diverse Logical Reasoning." https://arxiv.org/abs/2112.02333 — Evaluates 17 reasoning dimensions; numerical, comparative, and spatial reasoning are persistent bottlenecks.

18. **MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli model card.** https://huggingface.co/MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli — Benchmark scores and training details for the primary recommended model.

19. **cross-encoder/nli-deberta-v3-base model card.** https://huggingface.co/cross-encoder/nli-deberta-v3-base — Cross-encoder architecture details, SNLI/MNLI scores, and ONNX export availability.

20. **FacebookAI/roberta-large-mnli model card.** https://huggingface.co/FacebookAI/roberta-large-mnli — RoBERTa-large NLI fine-tuning details and known bias documentation.

21. **Sentence-Transformers cross-encoder documentation.** https://www.sbert.net/docs/cross_encoder/pretrained_models.html — Cross-encoder vs. bi-encoder comparison, inference optimization guidance.

22. **NVIDIA.** "Achieving Real-Time BERT Inference with TensorRT." https://developer.nvidia.com/blog/real-time-nlp-with-bert-using-tensorrt-updated/ — GPU inference benchmarks for BERT-family models.

23. **ONNX Runtime quantization documentation.** https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html — INT8 quantization methods and accuracy impact.