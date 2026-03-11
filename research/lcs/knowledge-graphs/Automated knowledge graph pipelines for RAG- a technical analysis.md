# Automated knowledge graph pipelines for RAG: a technical analysis

**LLM-based extraction pipelines like GraphRAG and LightRAG produce richer, more contextual knowledge graphs than traditional NER/RE tools, but at 60–1,300× the cost of simple vector embedding and with no universally accepted extraction-quality benchmarks.** The choice between approaches hinges on corpus scale, budget, and whether you need broad relational coverage or precise entity typing. Fine-tuned supervised models still outperform zero-shot LLMs on standard NER benchmarks by **30–60 F1 points**, but LLMs excel at open-domain relation discovery where no training data exists. Entity resolution remains the weakest link in both GraphRAG and LightRAG, which default to naive exact string matching — a gap that production systems fill with blocking, probabilistic matching, and cascading classifiers.

## LLM extraction versus traditional pipelines: precision meets flexibility

The central trade-off in KG construction is between the precision of supervised models and the flexibility of LLM prompting. On the [OntoNotes 5.0 benchmark](https://huggingface.co/spacy/en_core_web_trf), spaCy's transformer-based model (`en_core_web_trf`) achieves **NER F1 of 90.2%**, while its CNN-based counterpart (`en_core_web_lg`) reaches [85.4% F1](https://huggingface.co/spacy/en_core_web_lg). State-of-the-art supervised NER on CoNLL-2003 hits [94.6% F1](http://nlpprogress.com/english/named_entity_recognition.html) with the ACE model. These numbers represent a mature, well-understood capability for typed entity extraction.

LLMs in zero-shot settings fall well short. The [UniversalNER benchmark](https://universal-ner.github.io/) across 43 NER datasets showed ChatGPT (gpt-3.5-turbo) achieving only **34.9% average F1** in zero-shot mode, while a distilled 7B model (UniversalNER) reached 41.7%. A comprehensive evaluation by [Han et al. (2023)](https://arxiv.org/abs/2305.14450v1) across 17 IE datasets found a "huge performance gap" between ChatGPT and supervised SOTA across all information extraction tasks — NER, relation extraction, and event extraction alike. ChatGPT particularly struggles with subject-object relationships in relation extraction tasks.

However, the picture shifts in domain-specific and open-domain scenarios. [GPT-4 with optimized prompts](https://arxiv.org/abs/2303.16416) achieves 86.1% relaxed F1 on clinical NER — approaching but not matching fine-tuned BioClinicalBERT at 90.1%. For geo-entity detection, [GPT-4 matches XLM-RoBERTa](https://arxiv.org/pdf/2412.20414) in achieving the best F1 through balanced precision and recall. The key advantage of LLM-based extraction is not superior accuracy on benchmarks — it is the ability to extract **arbitrary entity types and rich relational descriptions** without any training data, which is precisely what GraphRAG and LightRAG exploit.

Open Information Extraction (OpenIE) systems occupy an awkward middle ground. On the [BenchIE fact-based evaluation](https://github.com/gkiril/benchie), the best system (ClausIE) achieves only **33.9% F1**, while Stanford OpenIE manages just **13.0% F1** with precision of only 11.1%. These systems generate many redundant extractions — Stanford OpenIE can produce up to 140 tuples per sentence — and their outputs lack the typed, descriptive richness that LLM extraction provides. SpaCy notably [does not include built-in relation extraction](https://explosion.ai/blog/relation-extraction); it offers only a trainable framework requiring custom model development.

## Inside GraphRAG and LightRAG extraction architectures

Microsoft's [GraphRAG](https://arxiv.org/abs/2404.16130) implements a six-phase indexing pipeline detailed in its [official dataflow documentation](https://microsoft.github.io/graphrag/index/default_dataflow/). Documents are chunked into TextUnits (default **1,200 tokens**, though the paper used 600-token chunks with 100-token overlaps). Each chunk is then processed by an LLM that extracts entities (with title, type, and natural-language description) and relationships (with source, target, and description). Entities sharing the same name and type across chunks are merged, and the LLM summarizes their combined descriptions into a single coherent profile.

The system then applies [Leiden community detection](https://microsoft.github.io/graphrag/index/methods/) hierarchically to partition the graph, and generates LLM-written report-like summaries for each community at every level — consuming approximately **5,000 tokens per community report**. The extraction prompt uses [auto-tuned few-shot examples](https://www.microsoft.com/en-us/research/blog/graphrag-auto-tuning-provides-rapid-adaptation-to-new-domains/) with fifteen entity examples and twelve relationship examples, plus a "gleanings" mechanism that prompts the LLM across multiple turns to extract additional information. On their Podcast dataset (~1M tokens), GraphRAG produced a graph with **8,564 nodes and 20,691 edges** across 1,669 chunks. Graph extraction alone constitutes roughly **75% of total indexing cost**.

[LightRAG](https://arxiv.org/html/2410.05779v1) (HKUDS, 28.3K GitHub stars) streamlines this architecture into three steps, formally defined as `D̂ = Dedupe ∘ Prof(Recog(D))`. The extraction step (`Recog`) prompts the LLM once per chunk to identify entities and relationships with a richer output schema than GraphRAG — relationships include keywords, descriptions, and explicit **strength scores** as visible in the [prompt source code](https://github.com/HKUDS/LightRAG/blob/main/lightrag/prompt.py). Entity names are normalized to title case for consistency, and default types span person, organization, location, event, and concept.

The critical architectural difference is that LightRAG **eliminates community detection and community summarization entirely**, replacing GraphRAG's global map-reduce retrieval with a [dual-level keyword-to-entity and keyword-to-relation retrieval](https://github.com/HKUDS/LightRAG) backed by vector search. This means LightRAG avoids the massive token cost of generating and regenerating community reports. The [LightRAG paper reports](https://arxiv.org/html/2410.05779v1) that GraphRAG consumed **610,000 tokens** per global query versus fewer than **100 tokens** for LightRAG — a roughly 6,000× difference at retrieval time. LightRAG also supports [incremental updates](https://github.com/HKUDS/LightRAG/blob/main/lightrag/api/README.md) through simple graph union, while GraphRAG must rebuild its entire community hierarchy when new documents arrive.

Neither system reports traditional precision/recall metrics for extraction quality. Both evaluate downstream answer quality using LLM-as-judge on comprehensiveness and diversity, where [LightRAG outperformed GraphRAG](https://arxiv.org/html/2410.05779v1) across multiple UltraDomain benchmark datasets with an 84.8% win rate on complex queries.

## Entity resolution remains the critical weakness

Both GraphRAG and LightRAG handle entity deduplication through **exact string matching** — a known and [acknowledged limitation](https://www.stephendiehl.com/posts/graphrag1/). GraphRAG's [paper states explicitly](https://arxiv.org/abs/2404.16130) that "our analysis uses exact string matching for entity matching," relying on community detection to cluster duplicates together for downstream summarization. LightRAG's deduplication function similarly [merges entities based on exact name keys](https://github.com/HKUDS/LightRAG/issues/1631), meaning "Donald J. Trump" and "President Trump" remain as separate nodes.

Production knowledge graph systems employ far more sophisticated approaches. The standard pipeline consists of four stages: **blocking, matching, clustering, and canonicalization**. Blocking is the most critical stage — naive pairwise comparison requires n²/2 operations, making it [computationally intractable](https://medium.com/@shereshevsky/entity-resolution-at-scale-deduplication-strategies-for-knowledge-graph-construction-7499a60a97c3) at scale (1M records would take 1.6 years without blocking versus 1.4 hours with effective blocking reducing candidates to 0.1%).

Modern blocking strategies include **Locality-Sensitive Hashing (LSH)** using MinHash for token-level similarity, and **semantic blocking with embeddings** using sentence transformers plus FAISS for k-NN search — the latter catching semantic equivalences like "Software Engineer" ≈ "SWE" that token-based methods miss. For matching, the [Ditto system](https://arxiv.org/html/2310.11244v4) (VLDB 2020) treats entity matching as sequence-pair classification by serializing records and fine-tuning BERT, achieving up to **29% F1 improvement** over prior state-of-the-art. [Peeters and Bizer (2024)](https://arxiv.org/html/2310.11244v4) found that GPT-4 outperforms fine-tuned pre-trained language models by **40–68% on unseen entity types** in zero-shot entity matching — though at vastly higher cost.

The production best practice is a **cascade pattern**: fast deterministic rules handle ~40% of decisions (exact ID matches, definite non-matches), an ML model like Ditto handles ~55% (high/low confidence thresholds), and an LLM resolves the remaining ~5% of ambiguous edge cases. Tools like [Splink](https://moj-analytical-services.github.io/splink/) (UK Ministry of Justice, Fellegi-Sunter probabilistic model, handles 100M+ records via Spark) and [Zingg](https://github.com/zinggAI/zingg) (ML-based, active learning, [used in AWS Glue](https://aws.amazon.com/blogs/big-data/entity-resolution-and-fuzzy-matches-in-aws-glue-using-the-zingg-open-source-library/)) represent mature options. For mission-critical applications, [Senzing](https://senzing.com/entity-resolved-knowledge-graphs/) provides a commercial sixth-generation ER engine with real-time resolution. Connected components clustering is then refined using Louvain community detection to prevent over-merging — a real risk since transitive closure (A≈B and B≈C implies A≈C) can [contaminate attributes across unrelated entities](https://hal.science/hal-02955445/file/CSUR5306-127_LR.pdf).

## The real cost of building a knowledge graph from 100K tokens

Microsoft's [official cost analysis](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/graphrag-costs-explained-what-you-need-to-know/4207978) provides the clearest benchmark. For "The Wizard of Oz" (~38K tokens), vectorization for standard RAG costs **$0.006** while GraphRAG construction costs **60–1,300× more** depending on model choice. Community [reports on GitHub](https://github.com/microsoft/graphrag/discussions/440) document real-world costs: a 1,000-page PDF with GPT-4-Turbo cost **$120** for graph construction, while 1 million words with DeepSeek cost approximately **$8.20**.

For a **100K-token technical corpus**, rough cost modeling based on GraphRAG's typical 5–10× token amplification during indexing (due to chunked prompts with few-shot examples plus output generation) yields these estimates:

- **GPT-4o**: $15–30 total (input + output tokens)
- **GPT-4o mini**: $0.50–1.00
- **Claude Sonnet 4.5**: $10–20
- **Claude Haiku 4.5**: $3–5
- **DeepSeek R1**: $1–2

GraphRAG's [indexing benchmark](https://arxiv.org/abs/2404.16130) showed **281 minutes** for ~1M tokens using GPT-4-turbo. A [Neo4j integration analysis](https://neo4j.com/blog/developer/global-graphrag-neo4j-langchain/) reported 35 ± 5 minutes and **~$30 with GPT-4o** for their dataset. Query-time costs diverge dramatically: [GraphRAG global queries](https://baeke.info/2024/07/11/token-consumption-in-microsofts-graph-rag/) consume ~150,000 tokens across 12 parallel LLM calls (~$0.80/query), while LightRAG queries use fewer than 100 tokens at ~80ms latency.

Open-source alternatives dramatically reduce costs. A [2025 SAP Research paper](https://arxiv.org/html/2507.03226v2) demonstrated that spaCy dependency parsing achieves **94% of LLM-based KG performance** (61.87% vs 65.83% on downstream tasks) at zero API cost and "orders of magnitude faster" processing. [GLiNER](https://github.com/urchade/GLiNER), a compact bidirectional transformer under 500M parameters, runs NER on CPU with zero-shot performance [matching or exceeding ChatGPT](https://medium.com/@zilliz_learn/gliner-generalist-model-for-named-entity-recognition-using-bidirectional-transformer-ed65165a4877). Its successor [GLiNER2](https://github.com/fastino-ai/GLiNER2) (205M parameters) unifies NER and relation extraction, achieving **0.590 NER F1 on CrossNER** versus GPT-4o's 0.599 — near-parity at zero marginal cost. [REBEL](https://huggingface.co/Babelscape/rebel-large), a BART-based seq2seq model, extracts 200+ relation types and achieves state-of-the-art F1 of **93.4% on NYT** and 76.65% on CoNLL04 for end-to-end relation extraction.

The practical recommendation stratifies by corpus scale: fewer than 100 documents warrant LLM extraction with GPT-4o or Claude Sonnet for maximum quality; 100–1,500 documents benefit from GPT-4o mini or DeepSeek with careful prompt engineering; beyond 1,500 documents, hybrid approaches — GLiNER or dependency parsing for bulk extraction with LLM refinement for ambiguous cases — become economically necessary.

## Conclusion

The knowledge graph construction landscape in 2026 presents a clear architectural pattern: **LLM-based extraction wins on relational richness but loses on cost and precision metrics**, while traditional NER/RE tools win on speed and per-entity accuracy but cannot discover open-domain relationships. The most underappreciated finding is that neither GraphRAG nor LightRAG has solved entity resolution — both rely on exact string matching, leaving substantial graph fragmentation that production ER tools (Splink, Zingg, cascade classifiers) can address. The cost landscape is shifting rapidly; GPT-4o mini has already compressed GraphRAG's indexing cost for 100K tokens from ~$30 to under $1, and open-source models like GLiNER2 achieve near-LLM quality at zero marginal cost. For practitioners building production pipelines, the optimal architecture likely combines open-source NER (GLiNER2 or spaCy) for entity extraction, LLM calls for relation discovery on critical chunks, embedding-based blocking with probabilistic matching for entity resolution, and LightRAG-style dual-level retrieval to avoid GraphRAG's costly community summarization.

---

## Bibliography

1. **"From Local to Global: A Graph RAG Approach to Query-Focused Summarization"** — Edge, Trinh, et al. (Microsoft Research, 2024). arXiv:2404.16130. URL: https://arxiv.org/abs/2404.16130. *Key contribution: Introduces the six-phase GraphRAG indexing pipeline with LLM-based entity/relationship extraction, Leiden community detection, and hierarchical community summarization.*

2. **"LightRAG: Simple and Fast Retrieval-Augmented Generation"** — Guo, Xia, et al. (HKUDS, EMNLP 2025). arXiv:2410.05779. URL: https://arxiv.org/html/2410.05779v1. *Key contribution: Presents a streamlined three-step KG construction pipeline eliminating community detection, achieving 6,000× token reduction at query time versus GraphRAG.*

3. **GraphRAG Official Documentation — Default Dataflow**. Microsoft. URL: https://microsoft.github.io/graphrag/index/default_dataflow/. *Key contribution: Detailed technical specification of GraphRAG's extraction phases, chunk sizes, and pipeline configuration.*

4. **GraphRAG Methods Documentation**. Microsoft. URL: https://microsoft.github.io/graphrag/index/methods/. *Key contribution: Documents FastGraphRAG alternative using NLP-based extraction, reports that graph extraction constitutes 75% of indexing cost.*

5. **"GraphRAG Auto-Tuning Provides Rapid Adaptation to New Domains"** — Microsoft Research Blog. URL: https://www.microsoft.com/en-us/research/blog/graphrag-auto-tuning-provides-rapid-adaptation-to-new-domains/. *Key contribution: Details the four-section extraction prompt structure and few-shot example auto-tuning process.*

6. **LightRAG GitHub Repository** — HKUDS. URL: https://github.com/HKUDS/LightRAG. *Key contribution: Source code for extraction prompts, deduplication parameters, and dual-level retrieval implementation.*

7. **spaCy en_core_web_trf Model Card**. Explosion AI. URL: https://huggingface.co/spacy/en_core_web_trf. *Key contribution: Reports NER F1 of 90.2% on OntoNotes 5.0 for spaCy's transformer-based pipeline.*

8. **"Is Information Extraction Solved by ChatGPT?"** — Han et al. (2023). arXiv:2305.14450. URL: https://arxiv.org/abs/2305.14450v1. *Key contribution: Comprehensive evaluation of ChatGPT across 17 IE datasets showing large performance gap versus supervised SOTA.*

9. **"UniversalNER: Targeted Distillation from Large Language Models for Open Named Entity Recognition"** — Zhou et al. (2023). arXiv:2308.03279. URL: https://universal-ner.github.io/. *Key contribution: Benchmarks ChatGPT at 34.9% zero-shot NER F1 across 43 datasets; distilled 7B model achieves 41.7%.*

10. **BenchIE: Open Information Extraction Benchmark**. Gashteovski et al. URL: https://github.com/gkiril/benchie. *Key contribution: Fact-based evaluation framework showing ClausIE at 33.9% F1 and Stanford OpenIE at 13.0% F1.*

11. **"Entity Matching using Large Language Models"** — Peeters & Bizer (2024). arXiv:2310.11244. URL: https://arxiv.org/html/2310.11244v4. *Key contribution: Demonstrates GPT-4 outperforms fine-tuned PLMs by 40–68% on unseen entity types for entity matching.*

12. **"Entity Resolution at Scale: Deduplication Strategies for Knowledge Graph Construction"** — Shereshevsky (2024). URL: https://medium.com/@shereshevsky/entity-resolution-at-scale-deduplication-strategies-for-knowledge-graph-construction-7499a60a97c3. *Key contribution: Production-oriented guide covering blocking, matching, clustering, and cascade pattern architecture.*

13. **"Blocking and Filtering Techniques for Entity Resolution: A Survey"** — Papadakis et al. (ACM Computing Surveys, 2020). DOI: 10.1145/3377455. URL: https://dl.acm.org/doi/abs/10.1145/3377455. *Key contribution: Comprehensive taxonomy of blocking methods including LSH, canopy clustering, and sorted neighborhood.*

14. **"GraphRAG Costs Explained: What You Need to Know"** — Microsoft Tech Community. URL: https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/graphrag-costs-explained-what-you-need-to-know/4207978. *Key contribution: Official cost analysis showing GraphRAG construction is 60–1,300× more expensive than vector embedding.*

15. **"Token Consumption in Microsoft's Graph RAG"** — Baeke (2024). URL: https://baeke.info/2024/07/11/token-consumption-in-microsofts-graph-rag/. *Key contribution: Measured ~150,000 tokens and ~$0.80 per global query using GPT-4o on "1984."*

16. **SAP Research: Dependency Parsing for KG Construction** (2025). arXiv:2507.03226. URL: https://arxiv.org/html/2507.03226v2. *Key contribution: Demonstrates spaCy-based dependency parsing achieves 94% of LLM-based KG quality at zero API cost.*

17. **GLiNER: Generalist Model for Named Entity Recognition**. Zaratiana et al. (2023). arXiv:2311.08526. URL: https://github.com/urchade/GLiNER. *Key contribution: Sub-500M parameter model matching or exceeding ChatGPT on zero-shot NER while running on CPU.*

18. **GLiNER2: Unified Model for NER, RE, and Structured Extraction**. URL: https://github.com/fastino-ai/GLiNER2. *Key contribution: 205M parameter model achieving NER F1 of 0.590 on CrossNER versus GPT-4o's 0.599.*

19. **REBEL: Relation Extraction By End-to-end Language Generation**. Babelscape (EMNLP Findings 2021). URL: https://huggingface.co/Babelscape/rebel-large. *Key contribution: BART-based seq2seq model extracting 200+ relation types, achieving 93.4% F1 on NYT dataset.*

20. **Splink: Probabilistic Record Linkage at Scale**. UK Ministry of Justice. URL: https://moj-analytical-services.github.io/splink/. *Key contribution: Production-grade Fellegi-Sunter implementation handling 100M+ records with DuckDB/Spark backends.*

21. **Zingg: ML-Based Entity Resolution**. URL: https://github.com/zinggAI/zingg. *Key contribution: Spark-native active learning ER tool processing datasets up to 24M records in production.*

22. **"Entity Resolved Knowledge Graphs"** — Neo4j Developer Blog. URL: https://neo4j.com/blog/developer/entity-resolved-knowledge-graphs/. *Key contribution: End-to-end tutorial combining Senzing ER with Neo4j graph construction on 85K business records.*

23. **GraphRAG GitHub Discussions #440 — Cost Reports**. URL: https://github.com/microsoft/graphrag/discussions/440. *Key contribution: Community-reported costs including $120 for a 1,000-page PDF with GPT-4-Turbo.*

24. **"An Overview of End-to-End Entity Resolution for Big Data"** — Christophides et al. (ACM Computing Surveys, 2020). URL: https://hal.science/hal-02955445/file/CSUR5306-127_LR.pdf. *Key contribution: Comprehensive survey of blocking, matching, and clustering for large-scale entity resolution.*