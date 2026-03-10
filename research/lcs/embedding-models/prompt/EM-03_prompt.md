# Research Prompt: EM-03 Voyage AI Embedding Models

## Research Objective
Perform an exhaustive evaluation of Voyage AI's embedding models, specifically comparing `voyage-3` (general purpose) and `voyage-code-3` (code-optimized). The goal is to investigate their strong benchmark claims, measure the actual quality delta for code-heavy retrieval against OpenAI, and determine if domain-specific embeddings are strictly necessary for the Living Corpus System (LCS).

## Research Questions
1. **Code vs General:** What are the architectural or training data differences between `voyage-3` and `voyage-code-3`? How does `voyage-code-3` handle AST-level semantic understanding versus simple token overlap?
2. **Context Window Limits:** `voyage-3` supports 32k tokens, while `voyage-code-3` supports 16k. How effectively do these models maintain vector fidelity for massive chunks (e.g., passing an entire 1000-line React component) compared to chunking it into 512-token segments?
3. **Benchmark Validation:** Voyage claims superiority over OpenAI on specific Retrieval tasks. Which exact datasets form the basis of these claims? Are these datasets representative of internal codebase search, or are they biased towards stack-overflow style QA?
4. **Multi-Vector Routing:** For a heterogeneous corpus (ADRs, raw code, logs), should LCS dynamically route code files to `voyage-code-3` and markdown to `voyage-3`? How do you rank/fuse scores from two completely different vector spaces (see *RF-07*)?
5. **Pricing vs Value:** Voyage APIs are generally more expensive than `text-embedding-3-small`. Does the theoretical boost in Recall@10 for code files mathematically justify the increased cost at a 10M token scale?
6. **API Latency and Limits:** Compare Voyage AI's API latency, uptime, and rate limiting structure to OpenAI. Are they reliable enough to serve as the backbone for an active, living indexing daemon?
7. **Vector Dimensionality:** What are the default dimensions for Voyage models, and do they support Matryoshka-style truncation? How does their vector size affect the memory footprint in databases like Qdrant?
8. **Handling of Mixed Contexts:** How does `voyage-code-3` embed a file that is 50% markdown and 50% code (e.g., MDX files, Jupyter notebooks)? Does it hallucinate or degrade compared to the general model?
9. **Security & Privacy:** What are Voyage AI's data retention policies? Do they train on customer embedding data by default?
10. **Integration Friction:** Evaluate the quality of their Python/Node SDKs. Do they drop natively into LangChain/LlamaIndex, or is custom API mapping required?

## Sub-Topics to Explore
- CodeSearchNet and AdvTest benchmarks specifically applied to Voyage.
- The mechanics of mapping disparate embedding spaces if multiple models are used.
- Impact of very long context windows (16k/32k) on the quality of a single global representation vector.
- Vector database sizing calculations specific to Voyage dimensions (typically 1024d).

## Starting Sources
- **Voyage-3 Announcement Blog:** https://blog.voyageai.com/2024/09/18/voyage-3/
- **Voyage-Code-2/3 Release Notes:** https://blog.voyageai.com/2024/01/23/voyage-code-2-elevating-code-retrieval/
- **Voyage AI Documentation:** https://docs.voyageai.com/docs/embeddings
- **Voyage AI Pricing:** https://www.voyageai.com/pricing
- **Independent comparisons:** Reddit/LocalLLaMA, Twitter/X ML researcher evaluations of Voyage vs OpenAI.
- **Stanford CRFM Ecosystem Graph:** https://crfm.stanford.edu/ecosystem-graphs/
- **LangChain Voyage Integration:** https://python.langchain.com/docs/integrations/text_embedding/voyageai
- **MTEB Leaderboard:** filtering specifically for Voyage entries.

## What to Measure & Compare
- Map out the exact pricing to embed 1 million tokens, 10 million tokens, and 100 million tokens using `voyage-code-3` vs `text-embedding-3-small`.
- Design a theoretical multi-vector routing architecture for LCS. Explain how a query like "Find the ADR that explains the Auth module" would be vectorized and searched across a `voyage-3` index and a `voyage-code-3` index simultaneously.

## Definition of Done
A 3000-5000 word deep dive explicitly proving or disproving Voyage AI's superiority for codebase retrieval. The research must provide a firm "Yes/No" recommendation on whether LCS should use domain-specific code embeddings over generalized models.

## Architectural Implication
Feeds **ADR-003 (Embedding Model Strategy)**. It directly challenges the assumption that a single, general-purpose embedding model (like OpenAI) is sufficient for a system whose primary artifact is source code.