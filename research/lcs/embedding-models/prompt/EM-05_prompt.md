# Research Prompt: EM-05 Code Embedding Models Survey

## Research Objective
Execute a deep-dive survey into embedding models specifically engineered for source code (CodeBERT, GraphCodeBERT, UniXcoder, StarEncoder). The goal is to understand the fundamental difference between semantic prose embeddings and structural code embeddings, evaluating how variable names, syntax trees, and control flow impact the latent space, and whether LCS must adopt a specialized code model.

## Research Questions
1. **Lexical vs Structural:** How do general text models (like OpenAI v3) interpret code? Do they just read variable names and comments, or do they understand control flow? How does a model like GraphCodeBERT mathematically incorporate data flow and structural syntax?
2. **The CodeBERT Lineage:** Trace the evolution from CodeBERT -> GraphCodeBERT -> UniXcoder. What specific limitations of previous models did each subsequent generation solve regarding code retrieval?
3. **Tokenization Strategies:** How does tokenizing source code differ from prose? Discuss the impact of subword tokenization (BPE) on camelCase, snake_case, and heavily symbolic syntax (brackets, pointers). Why do standard text tokenizers often butcher code?
4. **Cross-Lingual Code Search:** Do models like UniXcoder map identical logic in Python and TypeScript to the same vector space? How effective is cross-language zero-shot retrieval?
5. **Context Limitations:** Most specialized code models (like CodeBERT) are strictly limited to 512 tokens. Given that many functions/classes exceed this, how does this force extreme chunking strategies (see *CI-02*), and does the loss of surrounding context negate the benefits of the specialized model?
6. **Code + Prose Modality:** In LCS, a user might query "How does the authentication middleware handle JWT expiry?" This is natural language searching for code. How do StarEncoder or Voyage Code bridge the modality gap between an English query and a TypeScript vector?
7. **Vulnerability to Obfuscation:** If variable names are minified or stripped, do these models still recognize the algorithm (e.g., sorting, hashing) purely from structure?
8. **Recent SOTA:** Have large LLM-derived embeddings (like StarEncoder, based on StarCoder) rendered the older BERT-based architectures obsolete? What is the current state-of-the-art specifically for codebase retrieval?
9. **Benchmarking Code Models:** Analyze the CodeSearchNet, AdvTest, and SWE-bench datasets. What are the specific metrics that prove these models outperform general text embeddings?
10. **Implementation Complexity:** What is the engineering overhead of running a specialized model like UniXcoder via SentenceTransformers compared to a simple API call to a general model?

## Sub-Topics to Explore
- Abstract Syntax Tree (AST) injection into transformer models.
- The difference between code generation (LLMs) and code representation (Encoders).
- Contrastive learning techniques used to align natural language docstrings with source code.
- "Code Hallucination" in vector space (similar syntax, entirely different behavior).

## Starting Sources
- **CodeBERT Paper:** https://arxiv.org/abs/2002.08155
- **GraphCodeBERT Paper:** https://arxiv.org/abs/2009.08366
- **UniXcoder Paper:** https://arxiv.org/abs/2203.03835
- **StarEncoder Paper:** https://arxiv.org/abs/2305.06161
- **CodeSearchNet Dataset:** https://arxiv.org/abs/1909.09436
- **Voyage Code 3 Docs:** https://docs.voyageai.com/docs/embeddings (for comparison).
- **HuggingFace Models:** Search for the specific model cards (e.g., `microsoft/codebert-base`, `microsoft/unixcoder-base`).
- **AdvTest Benchmark:** Look for papers referencing robustness in code search.

## What to Measure & Compare
- Contrast the tokenization of a highly symbolic 5-line TypeScript function using the OpenAI `cl100k_base` tokenizer versus the CodeBERT tokenizer. Show the exact token arrays to highlight the difference.
- Compare the architecture (Parameter Count, Context Size, Training Data volume) of UniXcoder versus StarEncoder.

## Definition of Done
A 3000-5000 word comprehensive survey detailing the mechanics of code representation learning. The document must conclude with a specific recommendation: either LCS must run a specialized code embedding model for the codebase (in tandem with a text model for docs), or modern general models (like OpenAI v3) have rendered this distinction obsolete.

## Architectural Implication
Feeds **ADR-003 (Embedding Model Strategy)** and **ADR-004 (Chunking Strategy)**. If an AST-aware model like UniXcoder is required, LCS must implement a bifurcated embedding pipeline (routing code to one model, markdown to another) and enforce strict 512-token syntax-aware chunking.