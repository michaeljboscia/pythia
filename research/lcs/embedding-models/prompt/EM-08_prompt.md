# Research Prompt: EM-08 Embedding Fine-Tuning with Synthetic Training Pairs (V2 Track)

## Research Objective
Design a credible v2 plan for domain-adapting embedding models using synthetic training pairs generated from the LCS corpus, with rigorous controls against overfitting and hallucinated supervision. This research should determine whether fine-tuning yields meaningful retrieval gains over strong off-the-shelf models and what minimum data/quality gates are required before investment. Output feeds ADR-003 as a deferred-but-specified pathway.

## Research Questions
1. Which synthetic data generation strategy produces the most useful query-document pairs for LCS: LLM-generated queries, claim extraction pairs, hard-negative mining, or hybrid bootstrapping?
2. How should synthetic pair generation be constrained to preserve factual grounding and avoid reinforcing extraction errors from KG-09 pipelines?
3. What balance of positive pairs, hard negatives, and in-batch negatives yields the best retrieval gains for mixed code+prose corpora?
4. Which sentence-transformers losses are most appropriate (MultipleNegativesRankingLoss, MarginMSE, contrastive variants) for LCS objectives?
5. How much synthetic data is needed before gains plateau, and how does data quantity interact with label noise quality?
6. What evaluation design prevents false optimism (data leakage, train/test contamination, prompt leakage from synthetic generators)?
7. How should fine-tuned models be validated against baseline models across BEIR-like tasks and LCS custom tasks (cross-reference EQ-04/EQ-06)?
8. What are the practical training costs (GPU hours, batch sizing, memory requirements) and reproducibility constraints for home-server vs cloud training?
9. How does fine-tuning affect embedding dimension choices and migration complexity (cross-reference EM-06, EM-09)?
10. Which failure modes are common in synthetic supervision pipelines (shortcut learning, lexical memorization, domain over-specialization)?
11. What governance controls are needed before deployment (offline eval thresholds, canary rollout, rollback path, model card requirements)?
12. Is there a lower-risk alternative (better reranking/chunking) that beats fine-tuning ROI for LCS v2?

## Starting Sources
- Sentence Transformers training overview — https://www.sbert.net/docs/sentence_transformer/training_overview.html
- Sentence Transformers losses reference — https://www.sbert.net/docs/package_reference/sentence_transformer/losses.html
- Sentence Transformers MS MARCO training example — https://www.sbert.net/examples/sentence_transformer/training/ms_marco/README.html
- BEIR benchmark repository — https://github.com/beir-cellar/beir
- MTEB benchmark repository — https://github.com/embeddings-benchmark/mteb
- GPL: Generative Pseudo Labeling for Domain Adaptation of Dense Retrieval — https://arxiv.org/abs/2112.07577
- InPars: Data Augmentation for Information Retrieval using LLMs — https://arxiv.org/abs/2202.05144
- Promptagator: Few-shot Dense Retrieval From 8 Examples — https://arxiv.org/abs/2209.11755
- TSDAE (unsupervised domain adaptation for sentence embeddings) — https://arxiv.org/abs/2104.06979
- Hugging Face Sentence Transformers docs — https://www.sbert.net/

## What to Measure, Compare, or Evaluate
- Retrieval uplift vs baseline models: Recall@k, MRR@k, NDCG@k on held-out LCS query set and external benchmark subsets.
- Robustness metrics: performance on out-of-domain queries and adversarial/noisy phrasing.
- Overfitting diagnostics: train-dev gap, memorization checks, and contamination audits.
- Data quality metrics: synthetic pair acceptance rate, label-noise estimation, hard-negative difficulty distribution.
- Training economics: total compute cost, wall-clock time, and reproducibility variability across runs/seeds.
- Operational impact: model size, inference latency, embedding throughput, and deployment complexity.
- Safety checks: degradation on mission-critical query classes even if global metrics improve.

## Definition of Done
- A full fine-tuning experiment design is documented (data generation, filtering, training config, evaluation protocol).
- At least one pilot run is specified or executed with reproducible scripts and clear baselines.
- A go/no-go threshold for v2 adoption is defined (minimum uplift, maximum allowed regressions, cost ceiling).
- Risks and mitigation plan are explicit (rollback, drift monitoring, periodic re-training cadence).
- ADR-003 receives a deferred implementation plan with decision gates, not an open-ended “future work” note.

## How Findings Feed LCS Architecture Decisions
This research shapes ADR-003’s v2 branch for custom embeddings and informs EM-09 migration requirements for model-rollout safety. It also provides constraints for ADR-010 evaluation pipelines to detect regression and domain overfitting before any fine-tuned model reaches production.
