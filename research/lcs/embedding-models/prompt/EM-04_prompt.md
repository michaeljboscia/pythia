# Research Prompt: EM-04 Local Embedding Models via Ollama

## Research Objective
Extensively research the viability of running open-weight embedding models locally (via Ollama or SentenceTransformers) as the primary ingestion engine for the Living Corpus System (LCS). The objective is to determine if models like `nomic-embed-text` or `mxbai-embed-large` can match API models in quality while eliminating API costs and ensuring absolute data privacy.

## Research Questions
1. **The Nomic Ecosystem:** Deep dive into `nomic-embed-text-v1.5`. How does its implementation of Matryoshka learning allow for dynamic vector sizing (e.g., from 768 to 64 dimensions)? What is the measured quality loss at 256 dimensions?
2. **The Mixedbread Contender:** Analyze `mxbai-embed-large-v1`. Why does it score so highly on MTEB Retrieval tasks? What is its architecture, and does it require specific prompt formatting (e.g., `Represent this sentence for searching relevant passages:`)?
3. **Hardware & Throughput Limits:** On an M-series Mac or a standard home server (e.g., 8-core CPU, minimal GPU), what is the practical throughput (tokens/second) for generating embeddings using Ollama? How long would it take to embed a 5M token corpus locally?
4. **Context Window Constraints:** Most local models (like `all-MiniLM-L6-v2` or `bge-base`) are hard-capped at 512 or 8192 tokens. How does this force changes to the chunking strategy (see *RF-09* and *CI-02*) compared to using Voyage's 32k window?
5. **Instruction Tuning Overhead:** Do top local models require symmetric/asymmetric instruction prefixes? How complex is it to maintain these prefix rules within the LCS ingestion/query pipeline?
6. **Code Retrieval Efficacy:** How do these general-purpose local models perform on structured source code? Are there any local models specifically fine-tuned for codebase search (e.g., StarEncoder) that can run via Ollama?
7. **Daemon Architecture:** If LCS runs as a background Node.js daemon (*PE-01*), how do we reliably manage an Ollama subprocess or SentenceTransformer Python bridge? What happens when the host machine goes to sleep or is under heavy CPU load during an index rebuild?
8. **Memory Footprint:** What is the exact RAM/VRAM footprint required to keep `nomic-embed-text` or `mxbai-embed-large` loaded in memory permanently for instant query vectorization?
9. **Quantization Impact:** Ollama typically serves quantized models (Q4_0, Q8_0). How does 4-bit or 8-bit quantization of the *embedding model weights* affect the mathematical accuracy of the output vectors?
10. **Cost-Quality Matrix:** If local embedding costs $0 but takes 10x longer and scores 5% lower on Recall@10 than OpenAI, what is the architectural justification for choosing it for LCS?

## Sub-Topics to Explore
- Deep architecture of the Nomic embedding model and its training dataset.
- Asymmetric vs Symmetric embedding tasks and prompt engineering for vectors.
- Running embedding models purely in ONNX / WASM (via Xenova/Transformers.js) natively in Node.js vs calling an Ollama HTTP server.
- The tradeoff between indexing speed (batching in Python) versus querying latency (single-shot via REST).

## Starting Sources
- **Nomic Embed Paper/Blog:** https://blog.nomic.ai/posts/nomic-embed-text-v1_5
- **Mixedbread AI Model Blog:** https://www.mixedbread.ai/blog/mxbai-embed-large-v1
- **Ollama Embedding Docs:** https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings
- **HuggingFace BGE-M3 Docs:** https://huggingface.co/BAAI/bge-m3
- **Transformers.js (WASM Embeddings):** https://huggingface.co/docs/transformers.js/index
- **Sentence-Transformers Library:** https://sbert.net/
- **LocalLLaMA Subreddit:** Search for "embedding throughput" and "nomic vs mxbai".
- **MTEB Leaderboard:** filtering for open weights < 1B parameters.

## What to Measure & Compare
- Benchmark theoretical time-to-index for 100,000 documents (approx 50M tokens): OpenAI Batch API vs Ollama running `mxbai-embed-large` on a local M2 chip.
- Create a matrix comparing Context Limit, Default Dimensions, Parameter Count, and Required VRAM for: `nomic-embed-text`, `mxbai-embed-large`, `bge-base-en-v1.5`, and `all-MiniLM-L6-v2`.

## Definition of Done
A 3000-5000 word engineering assessment determining if local embeddings are production-ready for LCS. The output must define the exact hardware requirements, specify the best open-weight model, and dictate the architectural integration pattern (Ollama vs Transformers.js).

## Architectural Implication
Feeds **ADR-003 (Embedding Model Strategy)** and **ADR-007 (MCP Tool Schema)**. If local embeddings are selected, the system is fully air-gapped but heavily constrained by local compute, forcing smaller chunk sizes and more aggressive caching strategies.