# LangChain RAG patterns: what to steal, what to skip

**LangChain's most enduring contribution to RAG isn't its code — it's a handful of architectural patterns that have become industry-standard, even among developers who've abandoned the framework entirely.** After three years of rapid iteration from v0.0.x through [v1.0 (November 2025)](https://changelog.langchain.com/announcements/langchain-1-0-now-generally-available), the project has settled on a small set of stable abstractions worth understanding: the `Document` model, recursive text splitting, the retriever interface, and hybrid search composition. Everything else — the chain classes, LCEL ceremony, and prompt template objects — represents framework overhead that experienced developers consistently strip away. This report dissects the specific patterns, their measured performance characteristics, and what a custom RAG system should borrow conceptually.

## The four abstractions that survived three rewrites

LangChain's RAG architecture has undergone violent churn. The [package split in December 2023](https://blog.langchain.com/the-new-langchain-architecture-langchain-core-v0-1-langchain-community-and-a-path-to-langchain-v0-1/) fractured a monolithic library into `langchain-core`, `langchain-community`, `langchain-text-splitters`, and provider-specific packages like `langchain-openai`. Then [v0.2 (May 2024)](https://python.langchain.com/v0.2/docs/versions/v0_2/) deprecated `AgentExecutor` in favor of LangGraph. [v0.3 (September 2024)](https://blog.langchain.com/announcing-langchain-v0-3/) forced a Pydantic v1→v2 migration. And [v1.0](https://blog.langchain.com/langchain-langgraph-1dot0/) swept legacy chains like `RetrievalQA` and `ConversationalRetrievalChain` into a `langchain-classic` graveyard package. Through all of this, four low-level abstractions remained stable.

**`Document(page_content: str, metadata: dict)`** is the universal currency of the pipeline. It's trivially simple — a string plus a dictionary — and that simplicity is exactly why it works. Every loader outputs documents, every splitter transforms them, every retriever returns them. The pattern costs nothing to reimplement and eliminates constant type-conversion friction.

**`BaseLoader`** defines a generator-based interface: implement `lazy_load()` yielding `Document` objects, get `load()` for free as `list(self.lazy_load())`. The design correctly separates data acquisition from parsing via the `Blob`/`BaseBlobParser` abstractions in `langchain-core`. However, LangChain's *specific* loader implementations are widely criticized. As [one practitioner noted](https://medium.com/@aldendorosario/langchain-is-not-for-production-use-here-is-why-9f1eca6cce80): "There is a reason that LangChain has FIVE different PDF parsers. Nobody knows which one to use and under what conditions." The interface pattern is sound; the implementations need vetting.

**`RecursiveCharacterTextSplitter`** is the most universally praised component across all sources. Its algorithm — try splitting by paragraphs first (`\n\n`), fall back to newlines (`\n`), then spaces, then characters — elegantly preserves semantic coherence while respecting chunk size constraints. The `from_language()` factory adds syntax-aware splitting for Python, JavaScript, Markdown, HTML, and LaTeX. This splitter lives in `langchain-text-splitters` (current version 1.1.1) and its API (`chunk_size`, `chunk_overlap`, `separators`) has not changed across any version. Even developers who've [removed LangChain entirely](https://news.ycombinator.com/item?id=40739982) reimplemented this pattern.

**`BaseRetriever`** extends `RunnableSerializable[str, list[Document]]`, meaning it takes a query string and returns documents while participating in LangChain's composition system. The [core interface](https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/retrievers.py) requires subclasses to implement only `_get_relevant_documents(query: str) → list[Document]`. This survived every version transition, though `get_relevant_documents()` was [deprecated in v0.1.46](https://api.python.langchain.com/en/latest/retrievers/langchain_core.retrievers.BaseRetriever.html) in favor of the Runnable-standard `invoke()`.

## Retriever composition: measured gains versus complexity tax

LangChain offers six retriever composition patterns. Their quality improvements range from well-documented to entirely unverified, and their complexity costs vary dramatically. Here's what the evidence actually shows.

**EnsembleRetriever delivers the best cost-to-quality ratio in the entire RAG toolbox.** It combines multiple retrievers — typically BM25 sparse search plus dense vector search — using Reciprocal Rank Fusion (RRF). It requires **zero additional LLM calls**, adds negligible latency (BM25 is sub-millisecond; the fusion is trivial arithmetic), and the quality gains are robustly benchmarked. The [Blended RAG paper from IBM (arXiv 2404.07220)](https://arxiv.org/html/2404.07220v1) demonstrated **88.77% top-10 retrieval accuracy on Natural Questions** and nDCG@10 improvements of 5.8–8.2% over single-method baselines. Research compiled across multiple studies shows hybrid search consistently improves recall by **15–30%** over either method alone. OpenAI/Qdrant benchmarks report recall jumping from ~0.72 (BM25 alone) to ~0.91 (hybrid). The implementation cost is maintaining two indexes — an inverted index for BM25 and a vector store — which is manageable in production. The recommended starting weights are **60% semantic / 40% keyword**, adjustable per domain.

**ParentDocumentRetriever** solves a genuine architectural tension: small chunks embed more precisely, but large chunks provide better generation context. It indexes child chunks (e.g., 400 characters) in the vector store, then at query time retrieves the parent documents (e.g., 2000 characters) containing the matched children, using a separate `docstore` for the mapping. This requires **zero LLM calls at query time** — the overhead is one dictionary lookup per result. The trade-off is increased indexing cost (many more embeddings per document) and the operational complexity of maintaining two stores. No formal benchmarks exist comparing this to standard single-level retrieval, but the underlying principle — that optimal embedding granularity differs from optimal generation context — is validated by chunking research across the field.

**MultiQueryRetriever** uses an LLM to generate three reformulations of the user's query, retrieves documents for each, and returns their union. It costs **one LLM call** (~0.5–2 seconds latency) plus 3× the vector search. The quality improvement addresses vocabulary mismatch between user queries and document language. However, **no formal benchmarks have been published** comparing its retrieval quality to single-query baselines. A significant caveat from [practitioners](https://dev.to/sreeni5018): when the domain diverges significantly from the LLM's training data, query reformulations can hallucinate, degrading retrieval rather than improving it.

**ContextualCompressionRetriever** wraps a base retriever with post-retrieval filtering. The LLM-based variant (`LLMChainExtractor`) runs **one LLM call per retrieved document** to extract only relevant passages — retrieving k=4 documents adds 2–12 seconds of latency depending on whether calls run sequentially. The cheaper `EmbeddingsFilter` variant skips the LLM, using embedding similarity with a threshold (~0.76 recommended) to filter documents. No rigorous benchmarks exist for either variant. The [Full Stack Retrieval community warns](https://community.fullstackretrieval.com/document-transform/contextual-compression): "You'll be doing an additional API call(s) based on the number of retrieved documents you have. This will increase costs and latency of your application." For most production systems, a cross-encoder reranker (like ColBERT or a Cohere reranking model) achieves similar noise reduction with better latency characteristics.

**SelfQueryRetriever** parses natural language into a semantic query plus structured metadata filters ("science fiction movies after 2000" → query: "science fiction movies" + filter: year > 2000). It costs one LLM call for query parsing. This pattern is genuinely useful but only for **metadata-rich corpora** where queries naturally contain filterable attributes. It requires pre-defining metadata schemas and ensuring your vector store supports filtering operators. The LLM parsing can misfire on ambiguous queries.

**MultiVectorRetriever** — the parent class of `ParentDocumentRetriever` — generalizes the idea of storing multiple vector representations per document. The summary-embedding strategy (generate LLM summaries, embed those, but return originals) and hypothetical-questions strategy (generate questions a document might answer) shift all LLM costs to index time. For a 1,000-document corpus, that's 1,000 LLM calls at indexing — expensive but amortized. Query-time latency is identical to standard vector search. The concept is sound but again lacks published benchmarks in LangChain's implementation.

A critical finding across this research: **no published formal A/B benchmark exists comparing all six LangChain retriever patterns on the same dataset with standardized metrics.** The robust evidence is limited to hybrid search (EnsembleRetriever) gains. The other five patterns rely on qualitative arguments and architectural reasoning rather than measured improvements. The [RAGAS evaluation framework](https://docs.ragas.io) and [LangSmith](https://docs.langchain.com/langsmith/evaluate-rag-tutorial) provide tooling for such evaluations, but published results are application-specific rather than systematic.

## What experienced developers keep after leaving LangChain

The community sentiment toward LangChain is polarized but instructive. A [Hacker News thread titled "Why we no longer use LangChain"](https://news.ycombinator.com/item?id=40739982) garnered 480 points and 297 comments. [Max Woolf of BuzzFeed wrote the seminal criticism](https://minimaxir.com/2023/07/langchain-problem/): "LangChain's vaunted prompt engineering is just f-strings... but with extra steps." The AI testing startup Octomind [reported](https://news.ycombinator.com/item?id=40739982) that after removing LangChain, "we could just code." [Droptica, who kept LangChain in production for 6+ months](https://www.droptica.com/blog/langchain-vs-langgraph-vs-raw-openai-how-choose-your-rag-stack/), offered a more balanced take but noted the learning curve: "Understanding LangChain's abstractions (Documents, Retrievers, Chains, Runnables) takes weeks."

The pattern that emerges from these accounts is consistent. Developers keep certain *concepts* while discarding the framework dependency:

The **Load → Split → Embed → Store → Retrieve → Generate pipeline** has become universal. LangChain didn't invent it, but popularized it so effectively that virtually every RAG tutorial, including those from [Microsoft Azure](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-solution-design-and-evaluation-guide) and [Humanloop](https://humanloop.com/blog/rag-architectures), follows this structure. The pipeline stages map to clear module boundaries in any codebase.

The **recursive chunking with overlap** algorithm from `RecursiveCharacterTextSplitter` is reimplemented everywhere. The core logic is under 100 lines: try increasingly granular separators, merge chunks up to a target size, maintain configurable overlap between adjacent chunks for context continuity.

The **retriever as a composable interface** with a uniform `query → documents` contract enables swapping strategies without changing downstream code. Whether you're doing simple vector similarity, MMR for diversity, or hybrid BM25+dense search, the consuming code doesn't change. This interface-based approach is worth adopting even without LangChain's `Runnable` infrastructure.

**Metadata propagation through the pipeline** — attaching source, page number, section headings, and other provenance data to every chunk at splitting time, then surfacing it at retrieval time — is essential for production citation tracking and debugging. LangChain's `Document.metadata` dict pattern is minimal but effective.

What developers consistently *discard*: `ChatPromptTemplate` and its message subclasses (f-strings work fine), LCEL pipe syntax (standard function composition is more debuggable), the `Chain` abstraction entirely (a function that calls a retriever then an LLM is more transparent), and most of LangChain's agent infrastructure (direct API calls with structured outputs via Pydantic are simpler and more predictable).

## The minimal custom RAG stack: 80% of value, 20% of complexity

Based on the convergent recommendations from [production practitioners](https://towardsdatascience.com/six-lessons-learned-building-rag-systems-in-production/), [GitHub community discussions](https://github.com/orgs/community/discussions/182015), and the [Droptica production comparison](https://www.droptica.com/blog/langchain-vs-langgraph-vs-raw-openai-how-choose-your-rag-stack/), the minimal architecture that covers the majority of RAG use cases involves five components with no framework dependency.

**A Document model** — a dataclass or Pydantic model with `content: str` and `metadata: dict[str, Any]`. Add `id: str` for deduplication and `embedding: list[float] | None` for caching. This replaces LangChain's `Document` class.

**A recursive text splitter** — reimplement the `RecursiveCharacterTextSplitter` algorithm. Accept configurable separators, chunk size, overlap, and a length function (character count for simplicity, token count via `tiktoken` for precision). Add `MarkdownHeaderTextSplitter`-style logic if your corpus is structured: split on headers first, then apply recursive splitting within sections, propagating header hierarchy into metadata.

**A retriever protocol** — define `retrieve(query: str, k: int) → list[Document]` as a Python protocol or ABC. Implement `VectorRetriever` wrapping your vector store's similarity search, `BM25Retriever` wrapping a keyword index (using the `rank-bm25` library), and `HybridRetriever` combining both with RRF. This covers the only retriever composition pattern with robust benchmarks. Skip `MultiQueryRetriever`, `ContextualCompressionRetriever`, and `SelfQueryRetriever` initially — their unverified quality gains don't justify the added LLM calls and latency for most use cases.

**A generation function** — call your LLM API directly with the retrieved context formatted into a prompt string. Use Pydantic models for structured outputs when needed. The entire "chain" is: `docs = retriever.retrieve(query)` → `context = format_docs(docs)` → `response = llm.chat(prompt.format(context=context, question=query))`. This replaces `create_retrieval_chain`, `create_stuff_documents_chain`, and all LCEL composition.

**An indexing pipeline** — a script or service that runs: load files → split into chunks → compute embeddings → upsert into vector store and keyword index. Add LangChain's `RecordManager` concept (track content hashes to avoid re-embedding unchanged documents) if your corpus updates frequently. The [Indexing API blog post](https://blog.langchain.com/syncing-data-sources-to-vector-stores/) describes this pattern well: track document hashes, write timestamps, and source IDs to enable incremental and full cleanup modes.

This architecture maps to roughly 500–1,000 lines of Python with zero framework dependencies beyond your vector store client, an embedding API, and an LLM API. As one [Hacker News commenter](https://news.ycombinator.com/item?id=40739982) put it: "Your requirements.txt has 3-5 packages instead of 50."

## Where LangChain's experimental patterns point the field

Several LangChain patterns, while not yet benchmarked rigorously, represent the direction RAG architecture is heading — and are worth monitoring even if not adopting today.

**Agentic RAG** — where the LLM decides *whether* to retrieve rather than always retrieving — is the biggest architectural shift. LangChain's v1.0 `create_agent` wraps a retriever as a tool the LLM can invoke selectively. This reduces unnecessary retrieval for queries answerable from the model's parametric knowledge. The [LangGraph adaptive RAG tutorial](https://langchain-ai.github.io/langgraph/tutorials/rag/langgraph_adaptive_rag/) shows a state machine that routes queries to vector search or web search based on query analysis, grades retrieved documents for relevance, and retries with reformulated queries if grading fails. The concept is compelling; implementing it as a simple state machine (with explicit states for "retrieve," "grade," "generate," "retry") requires no framework beyond basic Python control flow.

**Semantic chunking** — splitting text based on embedding similarity between adjacent sentences rather than character counts — remains in `langchain-experimental` via `SemanticChunker`. A [GitHub feature request (#35553)](https://github.com/langchain-ai/langchain/issues/35553) to graduate it to the stable package is still open. The algorithm (based on [Greg Kamradt's "5 Levels of Text Splitting"](https://github.com/FullStackRetrieval-com/RetrievalTutorials)) computes embeddings for sliding windows of sentences and splits where cosine distance exceeds a threshold. It's conceptually elegant but adds embedding computation at chunking time and the threshold tuning is domain-specific. For structured documents (Markdown, HTML), header-based splitting typically outperforms it with zero embedding cost.

**Multi-vector indexing** — storing LLM-generated summaries or hypothetical questions as embeddings that map back to original documents — shifts LLM costs entirely to index time. This is particularly promising for **heterogeneous corpora** (mixing tables, images, and text) where a summary embedding captures the semantic content better than embedding the raw text. The cost is substantial at indexing time (one LLM call per document) but query-time performance is identical to standard vector search.

## API stability: what the version history reveals

The stability story is a tale of two layers. **Low-level abstractions are remarkably stable**: `Document`, `BaseRetriever`, `RecursiveCharacterTextSplitter`, and `VectorStore.as_retriever()` have maintained their interfaces across every major version. **High-level orchestration has been rewritten three times**: `LLMChain` → LCEL pipes → `create_retrieval_chain` → `create_agent`. The agent pattern has gone through four iterations: `initialize_agent` → `AgentExecutor` → `langgraph.create_react_agent` → `langchain.create_agent`.

For a custom RAG system, this pattern teaches a clear lesson: **invest in stable, low-level interfaces; keep orchestration thin and replaceable.** Your `Document` model and `Retriever` protocol will outlast any framework. Your RAG pipeline orchestration code — the glue connecting retrieval to generation — should be simple enough to rewrite in an afternoon when requirements change.

The [v1.0 migration guide](https://docs.langchain.com/oss/python/migrate/langchain-v1) explicitly moved `MultiQueryRetriever`, `ParentDocumentRetriever`, and the indexing API to `langchain-classic`, signaling that even LangChain considers these patterns mature enough to stabilize but not core enough to maintain in the primary package. The retrievers that remain in active development are tool-wrapped retrievers used within the agentic paradigm — further evidence that the field is moving from pipeline RAG toward agent-controlled retrieval.

## Conclusion

LangChain's most valuable legacy is not its code but its **taxonomy of RAG patterns**. The field has converged on a shared vocabulary — document loaders, text splitters, retrievers, chains — that transcends any single framework. For a custom implementation, the evidence supports adopting four specific patterns: the `Document(content, metadata)` model, recursive character text splitting with overlap, a retriever interface that wraps both vector and keyword search behind a uniform contract, and hybrid retrieval with Reciprocal Rank Fusion (the only composition pattern with robust benchmarks showing **15–30% recall improvement**).

The remaining retriever compositions — `MultiQueryRetriever`, `ContextualCompressionRetriever`, `SelfQueryRetriever` — lack published quality benchmarks and add LLM calls that increase latency and cost. They're worth evaluating against your specific data once your baseline is solid, using frameworks like [RAGAS](https://docs.ragas.io) to measure whether the complexity pays off. The emerging agentic RAG pattern (LLM-decides-when-to-retrieve) represents a genuine architectural advance but is best implemented as a simple state machine rather than through LangGraph's graph abstraction.

Build your abstractions at the same layer as LangChain's stable interfaces (`langchain-core`), not its volatile orchestration layer. The patterns that have survived three rewrites are the ones worth encoding into your own system.

---

## Bibliography

1. **LangChain v1.0 GA Announcement** — https://changelog.langchain.com/announcements/langchain-1-0-now-generally-available — Confirms v1.0 release (Oct 2025), langchain-classic package creation, and commitment to no breaking changes until 2.0.

2. **LangChain v0.3 Announcement** — https://blog.langchain.com/announcing-langchain-v0-3/ — Documents Pydantic v2 migration, Python 3.8 drop, and package restructuring (Sep 2024).

3. **LangChain Architecture Blog Post** — https://blog.langchain.com/the-new-langchain-architecture-langchain-core-v0-1-langchain-community-and-a-path-to-langchain-v0-1/ — Explains the Dec 2023 package split into langchain-core, langchain-community, and partner packages.

4. **LangChain v1.0 Migration Guide** — https://docs.langchain.com/oss/python/migrate/langchain-v1 — Details what moved to langchain-classic, breaking changes, and new APIs.

5. **BaseRetriever Source Code** — https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/retrievers.py — Definitive reference for the retriever interface, Runnable integration, and deprecation of get_relevant_documents().

6. **BaseLoader API Reference** — https://python.langchain.com/api_reference/core/document_loaders/langchain_core.document_loaders.base.BaseLoader.html — Documents lazy_load(), load(), and Blob/BaseBlobParser abstractions.

7. **Blended RAG Paper (IBM)** — https://arxiv.org/html/2404.07220v1 — arXiv 2404.07220. Provides the most rigorous benchmarks for hybrid retrieval: 88.77% top-10 accuracy on NQ, nDCG@10 improvements of 5.8–8.2%.

8. **LangChain Contextual Compression Blog** — https://blog.langchain.com/improving-document-retrieval-with-contextual-compression — Introduces LLMChainExtractor, LLMChainFilter, and EmbeddingsFilter patterns.

9. **LangChain Indexing API Blog** — https://blog.langchain.com/syncing-data-sources-to-vector-stores/ — Describes RecordManager pattern for incremental indexing with deduplication.

10. **Max Woolf: "The Problem With LangChain"** — https://minimaxir.com/2023/07/langchain-problem/ — Seminal practitioner criticism based on BuzzFeed production experience. Key contribution: demonstrates that LangChain's abstractions add complexity without proportional value.

11. **Droptica: "LangChain vs LangGraph vs Raw OpenAI"** — https://www.droptica.com/blog/langchain-vs-langgraph-vs-raw-openai-how-choose-your-rag-stack/ — Balanced production comparison (Nov 2025) from a team that chose LangChain. Key contribution: practical decision framework for when frameworks add value.

12. **Hacker News: "Why we no longer use LangChain"** — https://news.ycombinator.com/item?id=40739982 — 480 points, 297 comments. Key contribution: aggregates practitioner experiences of leaving LangChain, including Octomind's account of removing it entirely.

13. **GitHub Community Discussion: "Is LangChain becoming too complex?"** — https://github.com/orgs/community/discussions/182015 — 2025 discussion providing consensus view on minimal RAG architecture (vanilla Python + Pydantic + vector DB).

14. **RAGAS Documentation** — https://docs.ragas.io — Reference-free RAG evaluation framework with faithfulness, answer relevancy, context precision, and context recall metrics.

15. **LangSmith RAG Evaluation Tutorial** — https://docs.langchain.com/langsmith/evaluate-rag-tutorial — Documents LLM-as-judge evaluators, annotation queues, and pairwise comparison methods for RAG.

16. **Towards Data Science: "Six Lessons Learned Building RAG in Production"** — https://towardsdatascience.com/six-lessons-learned-building-rag-systems-in-production/ — Key contribution: emphasizes data quality over architecture, narrow use case definition, and evaluation from day one.

17. **LangGraph Adaptive RAG Tutorial** — https://langchain-ai.github.io/langgraph/tutorials/rag/langgraph_adaptive_rag/ — Documents state machine approach to agentic RAG with query routing, document grading, and retry loops.

18. **Full Stack Retrieval: Contextual Compression** — https://community.fullstackretrieval.com/document-transform/contextual-compression — Practical analysis of latency and cost trade-offs for compression retrievers.

19. **langchain-text-splitters on PyPI** — https://pypi.org/project/langchain-text-splitters/ — Confirms current version 1.1.1 and package independence from main langchain.

20. **GitHub Issue #35553: SemanticChunker migration** — https://github.com/langchain-ai/langchain/issues/35553 — Open feature request to move SemanticChunker from experimental to stable, confirming its experimental status as of 2026.

21. **Humanloop: "8 RAG Architectures You Should Know in 2025"** — https://humanloop.com/blog/rag-architectures — Framework-independent overview of RAG architecture patterns including corrective RAG, self-RAG, and adaptive RAG.

22. **Sider.ai: "Is LangChain Still Worth It? A 2025 Review"** — https://sider.ai/blog/ai-tools/is-langchain-still-worth-it-a-2025-review-of-features-limits-and-real-world-fit — Balanced 2025 assessment covering strengths (ecosystem, prototyping speed) and weaknesses (abstraction overhead, debugging difficulty).