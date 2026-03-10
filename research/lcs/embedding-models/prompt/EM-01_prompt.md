# Research Prompt: EM-01 MTEB Leaderboard Deep Analysis

## Research Objective
Conduct a rigorous and comprehensive analysis of the Massive Text Embedding Benchmark (MTEB). The objective is to demystify the leaderboard's scoring mechanics, isolate the specific benchmark datasets that accurately reflect the Living Corpus System (LCS) use case (heterogeneous retrieval across code, architecture decisions, and logs), and identify the true state-of-the-art models for our specific needs, disregarding generalized or irrelevant task categories.

## Research Questions
1. **Task Taxonomy:** MTEB aggregates scores across 7+ task categories (Classification, Clustering, PairClassification, Reranking, Retrieval, STS, Summarization). Which of these categories mechanically align with LCS's primary operation, and why should the others be weighted down or ignored?
2. **Retrieval Benchmark Specifics:** Within the "Retrieval" category, what are the specific underlying datasets (e.g., MS MARCO, NQ, SciFact, FiQA, CQADupStack)? Which of these datasets most closely mimic the syntax-heavy, technical nature of a codebase and markdown corpus?
3. **The Code Blindspot:** Does standard MTEB adequately test code retrieval? Investigate benchmarks like CodeSearchNet or SWE-bench. Are the top MTEB models inherently weak at structural code search despite high overall scores?
4. **Size vs. Performance Tradeoffs:** Analyze the correlation between model size (parameters/dimensions) and retrieval score. Is there a point of diminishing returns where a 7B parameter embedding model offers negligible improvement over a 330M parameter model for retrieval tasks?
5. **Context Window Limits:** Many top MTEB models are constrained to 512 tokens. How does this limitation interact with the LCS chunking strategy (see *CI-02* and *RF-09*)? Which top-tier models natively support 8k+ context windows?
6. **Open vs. Closed Weights:** Compare the performance delta between the best proprietary API models (OpenAI, Voyage, Cohere) and the best open-weight models (BAAI, Nomic, Mixedbread) specifically on the Retrieval slice of MTEB.
7. **Cross-Lingual/Multilingual Noise:** How much of the average MTEB score is inflated by multilingual capabilities (e.g., BGE-M3)? If LCS is primarily English and Code, how should the leaderboard be re-ranked?
8. **Evaluation Flaws:** What are the known criticisms of MTEB? (e.g., data contamination in training sets, bias towards specific prompt structures, saturation of metrics). How can LCS avoid falling for a model that overfit the benchmark?
9. **Instruction-Tuned Embeddings:** How do models requiring specific task instructions (e.g., `Instruct: Given a code snippet, find...`) compare to models that don't? What is the operational overhead of using instruction-tuned embeddings in an MCP server?
10. **Hardware Feasibility:** For the top 5 open-weight models on the Retrieval leaderboard, what are the VRAM requirements for generating embeddings locally, and what throughput (tokens/sec) can be expected on standard consumer hardware?

## Sub-Topics to Explore
- Breakdown of BEIR (Benchmarking IR) datasets included in MTEB.
- Task-specific prompts for embeddings (e.g., E5 and BGE prompt structures).
- The impact of domain-specific fine-tuning versus generalized scaling laws in embeddings.
- Synthetic data contamination in modern embedding model training.

## Starting Sources
- **MTEB Leaderboard:** https://huggingface.co/spaces/mteb/leaderboard
- **MTEB Original Paper:** "MTEB: Massive Text Embedding Benchmark" (Muennighoff et al.) - https://arxiv.org/abs/2210.07316
- **BEIR Benchmark Paper:** "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models" - https://arxiv.org/abs/2104.08663
- **LoCo Benchmark (Long Context Retrieval):** https://arxiv.org/abs/2402.13781
- **CodeSearchNet Challenge:** https://github.com/github/CodeSearchNet
- **BGE-M3 Paper:** https://arxiv.org/abs/2402.03216
- **E5 Paper:** "Text Embeddings by Weakly-Supervised Contrastive Pre-training" - https://arxiv.org/abs/2212.03533
- **Cohere Blog on Embedding Benchmarks:** https://cohere.com/blog/mteb-is-not-enough

## What to Measure & Compare
- Re-calculate a hypothetical "LCS Score" for the top 10 models by taking the weighted average of only the Retrieval datasets that feature technical, structural, or long-form documentation (e.g., SciFact, CQADupStack, TREC).
- Compare the exact delta in Retrieval Recall@10 between the #1 proprietary model and the #1 open-weight model (< 1B parameters).

## Definition of Done
A 3000+ word research report that fundamentally deconstructs the MTEB leaderboard. It must produce a custom-filtered ranking of the top 5 proprietary and top 5 local models tailored specifically for LCS, stripping away the noise of STS, Classification, and Multilingual tasks.

## Architectural Implication
This is a **P0 BLOCKER** for **ADR-003 (Embedding Model Strategy)**. The findings directly determine which models are shortlisted for hands-on evaluation in EM-02, EM-03, and EM-04.