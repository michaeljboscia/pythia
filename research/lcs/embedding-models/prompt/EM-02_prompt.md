# Research Prompt: EM-02 OpenAI text-embedding-3 Family

## Research Objective
Execute a rigorous technical and economic evaluation of the OpenAI `text-embedding-3` family (`small` and `large`). The goal is to determine if the dimension-reduction capabilities (Matryoshka Representation Learning), cost structure, and empirical retrieval quality—particularly on source code and technical documents—make it the optimal default choice for the Living Corpus System (LCS) over local alternatives.

## Research Questions
1. **Matryoshka Mechanics:** How exactly does OpenAI implement dimension reduction? If `text-embedding-3-large` is truncated from 3072 to 1024 dimensions, how much information is geometrically lost compared to the native 1536 dimensions of `text-embedding-3-small`?
2. **Quality on Code:** How do the `v3` models perform specifically on source code retrieval compared to `v2` (ada-002)? Do they adequately capture structural semantics (variable scopes, imports, typing) or do they rely entirely on lexical overlap in comments?
3. **Small vs Large Tradeoffs:** At what point does `text-embedding-3-large` structurally justify its 6x higher cost per token compared to `text-embedding-3-small`? What specific query complexities fail on `small` but succeed on `large`?
4. **Latency Profile:** What is the API latency distribution (p50, p95, p99) for embedding batches of 100 code chunks (approx. 50,000 tokens)? How does this impact the ingestion pipeline daemon proposed in *PE-01*?
5. **Context Window Behavior:** The `v3` models support 8191 tokens. How does attention degradation (the "lost in the middle" problem, see *RF-07*) affect embeddings generated from chunks larger than 2000 tokens? Is it better to chunk smaller or rely on the large context window?
6. **Cost Projection:** For a living corpus that mutates frequently (re-embedding 100,000 tokens per day due to git commits), what is the projected monthly cost, and how does this scale if the corpus expands by 10x?
7. **Rate Limits & Resilience:** What are the tier-specific TPM/RPM rate limits for the embeddings endpoint? How must the LCS MCP server implement backoff, jitter, and queueing to handle mass re-indexing events without halting?
8. **Vector Database Impact:** How does storing 3072-dimensional vectors (if using `large` un-truncated) impact RAM requirements in Qdrant/LanceDB compared to standard 768-dimensional local models?
9. **Vendor Lock-in vs Portability:** If we embed 500,000 documents with `text-embedding-3`, how difficult is it to migrate to Voyage or a local model later? What is the blue-green indexing strategy (see *PE-03*) required?
10. **Multilingual/Polyglot Interference:** Does the heavily multilingual training of `v3` models introduce "hallucinated similarity" between completely unrelated concepts in different languages, and does this impact code/English retrieval?

## Sub-Topics to Explore
- Matryoshka Representation Learning (MRL) underlying theory.
- The shift from `text-embedding-ada-002` to `v3` and the architectural changes involved.
- Batch API capabilities for mass embedding generation.
- The geometric properties of normalized vs un-normalized vectors from the OpenAI API.

## Starting Sources
- **OpenAI v3 Announcement Blog:** https://openai.com/blog/new-embedding-models-and-api-updates
- **Matryoshka Representation Learning Paper:** https://arxiv.org/abs/2205.13147
- **OpenAI Embeddings API Docs:** https://platform.openai.com/docs/guides/embeddings
- **OpenAI Pricing Page:** https://openai.com/pricing
- **Supabase Blog on OpenAI v3:** https://supabase.com/blog/openai-embeddings-v3
- **Qdrant dimension reduction analysis:** https://qdrant.tech/articles/openai-embedding-v3/
- **LlamaIndex Integration Guide:** https://docs.llamaindex.ai/en/stable/examples/embeddings/OpenAI/
- **SWE-bench / Code Retrieval Papers** discussing generalized vs code-specific embeddings.

## What to Measure & Compare
- Calculate the Exact Cost to embed a 5 million token corpus using `text-embedding-3-small`, `text-embedding-3-large` (3072d), and `text-embedding-ada-002`.
- Contrast the MTEB Retrieval metrics of `text-embedding-3-small` against the top open-source 384d model (e.g., `all-MiniLM-L6-v2` or `nomic-embed-text` truncated).

## Definition of Done
A 3000-4000 word technical and economic evaluation. It must definitively state whether the `text-embedding-3` family provides a statistically significant improvement over local models for code and technical documents, and whether `small` or `large` is the recommended default.

## Architectural Implication
Directly feeds **ADR-003 (Embedding Model Strategy)**. A decision here locks in the vector dimension size (affecting ADR-002) and sets the baseline operational cost for the LCS data ingestion pipeline.