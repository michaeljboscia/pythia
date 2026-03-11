# Detecting contradictions across a living knowledge base

**The most effective contradiction detection pipeline combines claim decomposition with lightweight NLI models, not monolithic LLM judges.** Research consistently shows that breaking documents into atomic claims before running sentence-level Natural Language Inference yields dramatically better results than full-document comparison — [SummaC demonstrated a 5-percentage-point improvement](https://arxiv.org/abs/2111.09525) in balanced accuracy by addressing the granularity mismatch between NLI training data and real documents. Meanwhile, dedicated NLI models like DeBERTa achieve [AUC-PR scores within striking distance of GPT-4](https://arxiv.org/abs/2303.08896) at **300–7,000× lower cost** and **100–600× lower latency**. The practical question is not which single approach wins, but how to layer these methods into a production system that catches real contradictions without drowning users in false positives.

This analysis draws on primary papers, model benchmarks, and production implementations to answer three engineering questions: how claim decomposition changes precision and recall, how LLM judges compare to NLI classifiers, and how to surface detected contradictions without creating noise.

## Why document-level NLI fails and sentence-level comparison rescues it

The fundamental problem with applying NLI models to contradiction detection is a **granularity mismatch**. Models like DeBERTa are trained on sentence pairs from datasets like [MultiNLI (433,000 pairs across 10 genres)](https://arxiv.org/abs/1704.05426) and [Adversarial NLI (162,865 examples)](https://arxiv.org/abs/1910.14599), where each example is a short premise paired with a short hypothesis. When you feed an entire document pair into these models, they consistently fail. [Kryscinski et al. (2020) found that out-of-the-box NLI models achieved only ~52% accuracy on document-level inconsistency detection](https://aclanthology.org/2022.tacl-1.10/) — barely above random guessing.

The [SummaC framework (Laban et al., 2022)](https://arxiv.org/abs/2111.09525) solved this by segmenting documents into sentences and building an NLI pair matrix of all sentence-pair scores, then aggregating. Their SummaCConv method achieved **74.4% balanced accuracy** on a benchmark of six inconsistency detection datasets — a 5-point improvement over prior state of the art. Critically, they found that **(one sentence, one sentence)** granularity, matching NLI training data, produced the best results. They also demonstrated that NLI dataset choice has a stronger influence on performance than model architecture, which means the right training data matters more than the right transformer variant.

The [Atomic-SNLI work (Huang, 2025)](https://arxiv.org/abs/2601.06528) pushes this further by decomposing sentences into atomic facts. With simple logical aggregation rules applied to 3-fact hypotheses, contradiction detection showed **high recall but low precision** — models over-predicted contradiction when finding any contradictory atomic evidence. Only probability-based soft aggregation maintained balanced precision and recall across all three NLI classes. This finding is directly actionable: if you decompose and then apply hard boolean logic ("any contradiction means the pair contradicts"), you will drown in false positives. Soft scoring and threshold calibration are essential.

## Claim decomposition delivers precision but imposes quadratic cost

Claim decomposition — extracting atomic, self-contained factual statements from text before comparison — has become the standard approach in fact verification. [FActScore (Min et al., 2023)](https://arxiv.org/abs/2305.14251) defines an atomic fact as "a short sentence conveying one piece of information" and uses GPT-3.5 to decompose text sentence by sentence. They found that **40% of ChatGPT-generated sentences contain a mix of supported and unsupported facts**, which full-sentence comparison would miss entirely. Their automated estimator achieves less than 2% error rate compared to human annotations.

The [WiCE dataset (Kamoi et al., 2023)](https://arxiv.org/abs/2303.01432) validates this approach more rigorously with 1,970 claims decomposed into 5,380 subclaims from Wikipedia. Their Claim-Split method — using GPT-3.5 to decompose claims into subclaims, predicting subclaim-level entailment, then aggregating — **directly improved entailment model performance across multiple datasets**. Reducing claim complexity through decomposition consistently helped models that otherwise struggled with compound statements.

However, [decomposition is not universally beneficial](https://arxiv.org/abs/2411.02400). The Decomposition Dilemmas paper (Hu et al., 2025) found that on the FELM dataset, ChatGPT's accuracy improved with claim-level decomposition but **GPT-4's accuracy actually declined**. Error categories included ambiguous sub-claims lacking clear references, meaning-altering decomposition, and incomplete causal context. [Wanner et al. (2024)](https://arxiv.org/abs/2403.11903) showed that FActScore-style metrics are sensitive to the decomposition method used — different methods yield different factual precision scores for the same text. The choice of decomposition method directly affects downstream contradiction detection quality.

The computational cost is significant and scales quadratically. [FActScore-style pipelines require over 100 seconds per response](https://arxiv.org/html/2505.16973) for full evaluation with many sequential LLM calls. For cross-document contradiction detection with N atomic claims from Document A and M claims from Document B, you need **N × M NLI inferences**. A typical 10-paragraph technical document yields roughly 50–100 atomic claims. Comparing two such documents therefore requires **2,500–10,000 pairwise NLI comparisons**. At DeBERTa's throughput of [696 sentence pairs per second on an A100 GPU](https://huggingface.co/MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli), this takes 4–14 seconds — manageable for batch processing but potentially too slow for real-time retrieval pipelines where [retrieval already consumes 41–47% of time-to-first-token latency](https://arxiv.org/html/2412.11854v1).

The token overhead for decomposition itself roughly doubles or triples the original text in LLM token usage when accounting for the decomposition prompt, few-shot examples, and structured output. [VeriScore (Song et al., 2024)](https://arxiv.org/abs/2406.19276) addresses this by extracting only verifiable claims, filtering out opinions and hypotheticals, but sacrifices completeness — it generates zero claims for some responses in specialized domains.

**The practical recommendation**: decompose into atomic claims for batch consistency checks, but use sentence-level segmentation (not full atomic decomposition) for retrieval-time checks where latency matters. Reserve atomic decomposition for flagged pairs that need deeper analysis.

## DeBERTa matches LLM judges at a fraction of the cost

The comparison between dedicated NLI models and LLM-as-judge approaches reveals a surprising near-parity in accuracy alongside a massive cost gap. [SelfCheckGPT (Manakul et al., 2023)](https://arxiv.org/abs/2303.08896) is the most directly relevant comparison study. It tested five methods for detecting inconsistency: BERTScore, question-answering, n-gram, NLI (DeBERTa-v3-large), and LLM prompting (GPT-3.5). The LLM prompting method was the best performer, but **only marginally better than NLI**. DeBERTa-based NLI achieved an AUC-PR of approximately 92.5 for non-factual sentence detection. NLI performance proved sensitive to model checkpoint choice — up to 4 AUC-PR points difference between [the SelfCheckGPT-specific DeBERTa fine-tune](https://huggingface.co/MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli) and other DeBERTa variants.

The [CRAG paper (Yan et al., 2024)](https://arxiv.org/abs/2401.15884) reinforces this finding from a different angle. Their **0.77-billion-parameter fine-tuned T5-large evaluator outperformed ChatGPT** for retrieval relevance assessment. This lightweight model is plug-and-play, running on a single GPU, and demonstrates that specialized smaller models can beat general-purpose LLMs on focused evaluation tasks. CRAG's three-tier confidence system — correct, incorrect, ambiguous — provides a production-ready pattern for routing decisions based on evaluator confidence.

The cost differential is stark. [GPT-4o costs approximately $2.50 per million input tokens](https://openai.com/api/pricing/), translating to roughly **$0.003–$0.007 per contradiction judgment** for a typical document pair of 1,000–2,000 tokens. DeBERTa self-hosted on a T4 GPU (approximately $0.35/hour on cloud) processes 100–500 sentence pairs per second at a cost of roughly **$0.000001–$0.00001 per pair**. That is a **300–7,000× cost difference**. Latency follows a similar pattern: DeBERTa runs in 5–20 milliseconds per pair versus 1–3 seconds for a GPT-4o API call.

[The MT-Bench study (Zheng et al., 2023)](https://arxiv.org/abs/2306.05685) established that GPT-4 achieves over 80% agreement with human preferences, matching inter-human agreement levels. But this was measured on **preference judgment tasks**, not factual contradiction detection specifically. The study also identified systematic biases — position bias, verbosity bias, and self-enhancement bias — that are particularly concerning for contradiction detection where subtle factual differences matter more than stylistic preferences.

An [Amazon research paper from 2025](https://arxiv.org/html/2504.00180v1) delivered a sobering finding: even state-of-the-art LLMs including GPT-4, GPT-3.5, and LLaMA-3 **performed only slightly better than random guessing** on their synthetic contradiction detection benchmark. Chain-of-thought prompting improved some models but actually hindered others. This suggests that LLM-as-judge approaches require careful prompt engineering and domain-specific calibration rather than naive application.

The optimal architecture is a **tiered pipeline**. Use DeBERTa-based NLI as the high-throughput first pass, processing all candidate pairs at minimal cost and latency. Route only ambiguous cases — those scoring between 0.4 and 0.7 on the contradiction probability — to an LLM judge for nuanced reasoning. This hybrid approach captures the cost efficiency of NLI for clear cases and the reasoning capability of LLMs for genuinely ambiguous contradictions.

## Choosing the right NLI backbone

Not all NLI models are equal for contradiction detection. The [MoritzLaurer DeBERTa-v3-large model trained on MNLI, FEVER-NLI, ANLI, LingNLI, and WANLI](https://huggingface.co/MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli) is currently the strongest off-the-shelf option, achieving **91.2% on MNLI matched and 70.2% on ANLI combined** — the ANLI number matters more for production robustness because [ANLI specifically tests adversarial robustness](https://arxiv.org/abs/1910.14599) against patterns that fool NLI models. Models trained only on MNLI, like Microsoft's [deberta-large-mnli](https://huggingface.co/microsoft/deberta-large-mnli), achieve 91.3% on MNLI but lack adversarial robustness.

The [DeBERTa architecture](https://arxiv.org/abs/2006.03654) uses disentangled attention — separating content and position vectors — plus an enhanced mask decoder. Each input is formatted as `[CLS] premise [SEP] hypothesis [SEP]`, and the model outputs a softmax probability distribution over entailment, neutral, and contradiction. The contradiction probability serves directly as a contradiction confidence score.

For knowledge bases with more than 10,000 potential document pairs, a two-stage approach is necessary. [Cross-encoders (which process premise-hypothesis pairs jointly) outperform bi-encoders by 4+ points nDCG@10](https://sbert.net/docs/cross_encoder/pretrained_models.html) in zero-shot settings, but they cannot precompute embeddings. The practical pipeline: use a bi-encoder (sentence-transformers) to precompute document embeddings and identify semantically similar candidate pairs via approximate nearest neighbor search, then run a cross-encoder NLI model ([cross-encoder/nli-deberta-v3-base](https://huggingface.co/cross-encoder/nli-deberta-v3-base)) on the top-K candidates for precise contradiction scoring.

Domain-specific performance varies dramatically. [NLI4CT (Jullien et al., 2023)](https://aclanthology.org/2023.emnlp-main.1041/) found that six state-of-the-art NLI models achieved a **maximum F1 of only 0.627** on clinical trial report inference. [Clinical contradiction detection](https://aclanthology.org/2023.emnlp-main.80/) using distant supervision from the SNOMED ontology flagged only 6% of sampled abstracts as potentially contradictory. Fine-tuning with domain terminology improved smaller models more than larger ones. For technical knowledge bases, domain-specific fine-tuning or at minimum domain-specific threshold calibration is likely necessary.

## How to represent and surface contradictions without creating noise

The representation and surfacing strategy must balance thoroughness against false-positive fatigue. Three patterns emerge from research and production systems, each suited to different operational contexts.

**Graph edges with confidence scores** are the most structured approach. [Wikidata uses a "conflicts-with" constraint](https://www.wikidata.org/wiki/Help:Property_constraints_portal/Conflicts_with) that specifies when items with one property should not have certain other statements. Violations are listed in reports with three severity levels — mandatory constraint, normal constraint, and suggestion — with **29.2% of constraints marked as mandatory**. Wikidata's [constraint violation reports have a 12–36 hour lag](https://www.wikidata.org/wiki/Wikidata:Constraint_violation_report_input), but community discussion has consistently favored real-time checking because users are more likely to fix errors while still engaged with the content. [NELL (Never-Ending Language Learner)](https://www.researchgate.net/figure/NELL-KB-size-over-time-Total-number-of-beliefs-left-and-number-of-high-confidence_fig3_324764911) demonstrates the importance of confidence thresholds: of approximately 120 million extracted beliefs, **only 3% are held at high confidence**. This aggressive filtering prevents low-quality contradictions from polluting the knowledge base.

For production knowledge bases, the [Dataroots KnowledgeBase Guardian](https://github.com/datarootsio/knowledgebase_guardian) demonstrates an ingestion-time pattern: before adding a new document, it retrieves semantically similar existing documents via vector search, then uses an LLM to compare and detect contradictions. If a contradiction is detected, the document is rejected and logged. This prevents contradictions from entering the knowledge base but risks rejecting valid updates to genuinely outdated information.

**Retrieval-time warnings** suit RAG systems where contradictions must be surfaced in context. [Self-RAG's ISSUP (IsSupported) reflection token](https://arxiv.org/abs/2310.11511) evaluates whether generated output is supported by retrieved passages, outputting "fully supported," "partially supported," or "no support" — the last category signals contradiction. Self-RAG achieves approximately **81% accuracy on FEVER** for fact verification, and its segment-level beam search allows selecting the most consistent output from multiple retrieved passages. [DeepEval's FaithfulnessMetric](https://deepeval.com/docs/metrics-faithfulness) implements a similar two-step process — extract claims from generated output, then verdict each claim as "yes" (supported), "no" (directly contradicted), or "idk" (not backed up) against retrieval context. The explicit instruction in their template — "only use 'no' if retrieval context DIRECTLY CONTRADICTS the claim" — is a practical false-positive suppression technique.

**Background batch alerts** work best for evolving knowledge bases where documents change over time. [The IDA (Inconsistency Detection Algorithm) for evolving knowledge graphs](https://alenaschmickl.medium.com/5-steps-to-find-inconsistencies-in-evolving-knowledge-graphs-6f3f88c0ab7b) provides a five-step approach for graphs subject to periodic updates, such as medical coding catalogs updated biannually. This eliminates the need for full graph reconstruction on each update. The [survey on uncertainty management in knowledge bases (Dagstuhl, 2024)](https://drops.dagstuhl.de/storage/08tgdk/tgdk-vol003/tgdk-vol003-issue001/TGDK.3.1.3/TGDK.3.1.3.pdf) describes a canonical pipeline: knowledge extraction → alignment (deduplication and contradiction detection) → fusion (conflict resolution) → consistency checking. Each triple gets a confidence score plus provenance information, and contradictions are resolved through knowledge fusion policies.

## Calibrating confidence thresholds to control false-positive noise

No universal optimal threshold exists for contradiction detection. [Lipton and Elkan proved](https://pmc.ncbi.nlm.nih.gov/articles/PMC4442797/) that for calibrated classifiers, the optimal threshold to maximize F1 is half the optimal F1 value (threshold = F*/2). Since the achievable F1 varies by domain and model, thresholds must be calibrated per deployment.

The practical range for contradiction alerts in technical knowledge bases sits between **0.7 and 0.9** on the NLI contradiction probability, but the right value depends on the cost of false positives versus false negatives. Consider three operational regimes:

- **High-precision mode (threshold ≥ 0.85)**: Surfaces only high-confidence contradictions. Appropriate for automated blocking (rejecting document ingestion) or generating alerts that interrupt user workflows. At this threshold, expect to catch roughly 40–60% of real contradictions while keeping false positives below 5%.
- **Balanced mode (threshold 0.65–0.85)**: Appropriate for background reports reviewed periodically by knowledge base maintainers. Flags more candidates at the cost of some noise. Pairs well with severity tagging — a practice [recommended by production guides](https://www.shadecoder.com/topics/contradiction-detection-a-comprehensive-guide-for-2025) that assigns high/medium/low severity labels to route items for appropriate review.
- **High-recall mode (threshold ≤ 0.65)**: Catches nearly all potential contradictions but generates significant noise. Appropriate only for initial knowledge base audits or when a second-pass LLM judge will filter results.

[CRAG's three-tier system](https://arxiv.org/abs/2401.15884) — correct, incorrect, ambiguous — provides a production-tested alternative to single-threshold decisions. Documents scoring above the upper threshold proceed normally, those below the lower threshold are flagged as contradictory, and the ambiguous middle band triggers additional processing (web search fallback, LLM review, or human escalation).

## Temporal contradictions require special handling

A statement that "Python 3.9 is the latest release" was true in 2021 but contradicts current reality. This is not a factual contradiction in the classical sense but a temporal one. [The formal framework from Max Planck Institute (Dylla et al., 2011)](https://people.mpi-inf.mpg.de/alumni/d5/2014/mdylla/publications/BTW11.pdf) models this as selecting a consistent subset of temporally-annotated facts that maximizes total weight — a problem shown to be NP-hard. [Fact duration prediction (Jang et al., 2023)](https://arxiv.org/abs/2305.14824) offers a practical alternative: predicting how long a given fact will remain true, then automatically deprecating facts prone to rapid change.

[OpenAI's temporal agents cookbook](https://developers.openai.com/cookbook/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents/) recommends ISO-8601 timestamps on all extracted triples, with an explicit invalidation agent that performs temporal validity checks and spots statements invalidated by new information. [Medical RAG research (2025)](https://arxiv.org/html/2511.06668) found that contradictions between highly similar abstracts from different time periods degraded LLM performance, with GPT-OSS showing only 14% degradation — the most robust among five tested models. This confirms that temporal metadata is not optional for contradiction-aware retrieval.

For production systems, the recommended approach is to **timestamp all claims at extraction time**, maintain a temporal validity window for each claim type (configurable per domain), and treat expired claims as "potentially outdated" rather than "contradictory." Only claims with overlapping temporal validity windows that make incompatible assertions should be flagged as true contradictions.

## A practical production architecture

Synthesizing across all the research, the recommended production pipeline for contradiction detection in a technical knowledge base has four stages:

1. **Ingestion-time screening**: When a new document enters the knowledge base, use bi-encoder similarity search to find the top-20 most similar existing documents. Run sentence-level DeBERTa NLI ([MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli](https://huggingface.co/MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli)) on all sentence pairs between the new document and each candidate. Flag pairs scoring above 0.75 contradiction probability. Cost: sub-second per document on GPU.

2. **Batch consistency audit**: Weekly, decompose all documents updated in the past period into atomic claims using a lightweight model or structured extraction. Run pairwise NLI on claims within topically related document clusters. Store results as weighted CONTRADICTS edges in a knowledge graph with confidence scores and provenance. Route pairs scoring 0.65–0.85 to an LLM judge for tiebreaking.

3. **Retrieval-time warnings**: When serving a RAG query, if retrieved documents contain any pre-computed CONTRADICTS edges above 0.80 confidence, surface an inline warning with the specific contradicting claims highlighted. This adds zero latency because the contradiction was pre-computed.

4. **Escalation**: Contradictions above 0.90 confidence on high-priority documents trigger notifications to knowledge base maintainers with both claims, their sources, and timestamps for resolution.

This architecture keeps the expensive operations (claim decomposition, LLM judging) in batch processing, uses the fast operations (sentence NLI, pre-computed graph lookups) at serving time, and applies graduated confidence thresholds to prevent alert fatigue while catching genuine inconsistencies.

---

## Bibliography

1. **Williams, A., Nangia, N., & Bowman, S. (2018).** "A Broad-Coverage Challenge Corpus for Sentence Understanding through Inference." *NAACL-HLT 2018.* URL: https://arxiv.org/abs/1704.05426 — Introduced MultiNLI, the foundational 433k-pair, 10-genre NLI benchmark that trains most production contradiction detectors.

2. **Nie, Y., Williams, A., Dinan, E., Bansal, M., Weston, J., & Kiela, D. (2020).** "Adversarial NLI: A New Benchmark for Natural Language Understanding." *ACL 2020.* URL: https://arxiv.org/abs/1910.14599 — Created ANLI with 162k adversarially-collected examples; exposed model brittleness with accuracy drops to ~55% for RoBERTa-Large.

3. **He, P., Liu, X., Gao, J., & Chen, W. (2021).** "DeBERTa: Decoding-enhanced BERT with Disentangled Attention." *ICLR 2021.* URL: https://arxiv.org/abs/2006.03654 — Introduced disentangled attention mechanism achieving 91.3% on MNLI and surpassing human performance on SuperGLUE.

4. **MoritzLaurer DeBERTa-v3-large-mnli-fever-anli-ling-wanli.** Hugging Face Model Card. URL: https://huggingface.co/MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli — Best off-the-shelf NLI model: 91.2% MNLI, 70.2% ANLI, 696 texts/sec on A100.

5. **Laban, P., Schnabel, T., Bennett, P., & Hearst, M. (2022).** "SummaC: Re-Visiting NLI-based Models for Inconsistency Detection in Summarization." *TACL 2022.* URL: https://arxiv.org/abs/2111.09525 — Proved sentence-level NLI dramatically outperforms document-level (+5pp balanced accuracy); introduced NLI pair matrix approach.

6. **Min, S., Krishna, K., Lyu, X., Lewis, M., Yih, W., Koh, P., ... & Zettlemoyer, L. (2023).** "FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation." *EMNLP 2023.* URL: https://arxiv.org/abs/2305.14251 — Defined atomic fact decomposition for factual evaluation; found 40% of ChatGPT sentences mix supported/unsupported facts.

7. **Thorne, J., Vlachos, A., Christodoulopoulos, C., & Mittal, A. (2018).** "FEVER: a Large-scale Dataset for Fact Extraction and VERification." *NAACL 2018.* URL: https://arxiv.org/abs/1803.05355 — Created 185k-claim fact verification benchmark establishing the retrieve-then-verify paradigm.

8. **Huang, J. (2025).** "Atomic-SNLI: Atomic-level Evaluation of Natural Language Inference." URL: https://arxiv.org/abs/2601.06528 — Showed atomic decomposition yields high recall but low precision for contradiction; soft aggregation needed for balanced detection.

9. **Kamoi, R., et al. (2023).** "WiCE: Real-World Entailment for Claims in Wikipedia." *EMNLP 2023.* URL: https://arxiv.org/abs/2303.01432 — 1,970 claims / 5,380 subclaims benchmark; proved claim-split decomposition improves entailment models.

10. **Hu, Q., et al. (2025).** "Decomposition Dilemmas: Does Claim Decomposition Boost or Burden Fact-Checking?" *NAACL 2025.* URL: https://arxiv.org/abs/2411.02400 — Found decomposition doesn't always help; GPT-4 accuracy can decline with decomposition due to noise introduction.

11. **Manakul, P., Liusie, A., & Gales, M. (2023).** "SelfCheckGPT: Zero-Resource Black-Box Hallucination Detection." *EMNLP 2023.* URL: https://arxiv.org/abs/2303.08896 — Key comparison: LLM prompting only marginally outperforms DeBERTa-NLI (AUC-PR ~92.5) for inconsistency detection.

12. **Asai, A., Wu, Z., Wang, Y., Sil, A., & Hajishirzi, H. (2023).** "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection." *ICLR 2024.* URL: https://arxiv.org/abs/2310.11511 — Introduced reflection tokens (ISSUP) for in-generation contradiction detection; 81% on FEVER.

13. **Yan, S., Gu, J., Zhu, Y., & Ling, Z. (2024).** "Corrective Retrieval Augmented Generation." URL: https://arxiv.org/abs/2401.15884 — 0.77B evaluator outperformed ChatGPT; three-tier confidence system for retrieval quality.

14. **Zheng, L., Chiang, W., Sheng, Y., et al. (2023).** "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." *NeurIPS 2023.* URL: https://arxiv.org/abs/2306.05685 — GPT-4 achieves >80% agreement with humans; identified position, verbosity, and self-enhancement biases.

15. **DeepEval FaithfulnessMetric Documentation.** URL: https://deepeval.com/docs/metrics-faithfulness — Production framework for claim extraction + verdict generation with yes/no/idk scoring against retrieval context.

16. **Song, Y., et al. (2024).** "VeriScore: Evaluating the factuality of verifiable claims in long-form text." *EMNLP Findings 2024.* URL: https://arxiv.org/abs/2406.19276 — Improved over FActScore by extracting only verifiable, self-contained claims.

17. **Wanner, L., et al. (2024).** "A Closer Look at Claim Decomposition." URL: https://arxiv.org/abs/2403.11903 — FActScore sensitivity to decomposition method; introduced DecompScore.

18. **Gokul, S., Tenneti, S., & Nakkiran, P. (2025).** "Contradiction Detection in RAG Systems." *Amazon Research.* URL: https://arxiv.org/html/2504.00180v1 — LLMs perform only slightly better than random on synthetic contradiction benchmarks.

19. **Lipton, Z. & Elkan, C. (2014).** "Optimal Thresholding of Classifiers to Maximize F1 Measure." URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC4442797/ — Proved optimal F1 threshold equals F*/2 for calibrated classifiers.

20. **Jullien, M., et al. (2023).** "NLI4CT: Multi-Evidence Natural Language Inference for Clinical Trial Reports." *EMNLP 2023.* URL: https://aclanthology.org/2023.emnlp-main.1041/ — Six SOTA NLI models achieved maximum F1 of 0.627 on clinical trial inference.

21. **Wikidata Constraint Violation Reports.** URL: https://www.wikidata.org/wiki/Help:Property_constraints_portal/Conflicts_with — Documents "conflicts-with" constraint with three severity levels; 29.2% mandatory.

22. **Dataroots KnowledgeBase Guardian.** GitHub. URL: https://github.com/datarootsio/knowledgebase_guardian — Open-source ingestion-time contradiction detection for vector store knowledge bases.

23. **Dylla, M., et al. (2011).** "Resolving Temporal Conflicts in Inconsistent RDF Knowledge Bases." *Max Planck Institute.* URL: https://people.mpi-inf.mpg.de/alumni/d5/2014/mdylla/publications/BTW11.pdf — Formal temporal conflict resolution framework; proved NP-hardness.

24. **OpenAI Temporal Agents with Knowledge Graphs Cookbook.** URL: https://developers.openai.com/cookbook/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents/ — Production patterns for temporally-aware knowledge graph construction with invalidation agents.

25. **Dealing with Inconsistency for Reasoning over Knowledge Graphs: A Survey (2025).** URL: https://arxiv.org/html/2502.19023v1 — Comprehensive survey: detection, repair, and tolerance of KG inconsistency; PSpace-completeness for expressive languages.

26. **Knowledge Conflicts Survey (EMNLP 2024).** URL: https://aclanthology.org/2024.emnlp-main.486.pdf — Covers context-memory and context-context conflicts; LLMs biased toward frequent/recent evidence.

27. **SBERT Pretrained Cross-Encoders.** URL: https://sbert.net/docs/cross_encoder/pretrained_models.html — Documents cross-encoder NLI models including nli-deberta-v3-base for contradiction scoring.