# Research Prompt: CI-02 tree-sitter for Code Chunking

## Research Objective
Investigate the efficacy of using tree-sitter to perform syntax-aware chunking of source code, as opposed to naive recursive character splitting. The objective is to design a chunking algorithm for LCS that respects semantic boundaries (functions, classes, blocks) to ensure that vector embeddings capture coherent logic rather than arbitrarily sliced strings.

## Research Questions
1. **The Semantic Boundary Problem:** Why do naive splitting algorithms (like LangChain's `RecursiveCharacterTextSplitter`) degrade code retrieval quality? Provide specific examples of how splitting across a function definition or loop boundary destroys the resulting embedding vector.
2. **Chunking Strategies:** How do we define the "ideal" chunk size for code? Is it at the class level, function level, or block level? How does this decision interact with the embedding model's context window (*EM-02* / *EM-04*)?
3. **Handling Large Functions:** When a single function (e.g., a massive React `render()` method) exceeds the target token limit, how do we use tree-sitter to intelligently subdivide it? What AST nodes (e.g., `if_statement`, `for_statement`, `switch_statement`) are safe to split on?
4. **Context Injection:** When chunking at the function level, how much surrounding context (imports, class definition, global variables) must be prepended to the function's chunk to ensure the embedding model understands it? 
5. **Relationship to Graph Nodes:** If a chunk represents a function, how does this text chunk map to a logical entity node in the Knowledge Graph (*KG-08*)? Are chunks 1:1 with graph nodes?
6. **Language Agnosticism:** Can we design a unified chunking algorithm that operates purely on generic tree-sitter node concepts (e.g., "declaration", "block"), or must we write custom chunking logic for every supported language (TS, Python, Rust)?
7. **Code + Comment Grouping:** How do we use tree-sitter to guarantee that a function's JSDoc/docstring is physically attached to the function's chunk, rather than being orphaned in a separate chunk?
8. **Overlap Logic:** Does semantic chunking still require chunk overlap? If we chunk cleanly at function boundaries, is there any value in duplicating the end of Function A into the start of Function B?
9. **Evaluation of Chunk Quality:** How do we quantitatively measure that syntax-aware chunks perform better in retrieval than naive chunks? What benchmark datasets (*EQ-01*) specifically test this?
10. **The "Skeleton" Chunk:** Should we create a "file skeleton" chunk that contains only the imports, exports, and function signatures (omitting all bodies) to act as a high-level router for file-level queries?

## Sub-Topics to Explore
- Extracting and persisting AST paths (e.g., `Class[Auth] -> Method[login] -> IfStatement`) as metadata attached to the chunk vector.
- How LlamaIndex's `CodeSplitter` and LangChain's `Language.from_language` implement tree-sitter under the hood.
- Handling boilerplate, generated code, and massive arrays/objects.

## Starting Sources
- **LangChain Code Splitter Docs:** https://python.langchain.com/docs/modules/data_connection/document_transformers/code_splitter
- **LlamaIndex CodeSplitter:** https://docs.llamaindex.ai/en/stable/api_reference/node_parsers/code/
- **Bloop.ai Chunking Blog:** "How to chunk code for LLMs" - https://bloop.ai/blog/how-to-chunk-code
- **Sweep.dev Chunking Strategy:** https://github.com/sweepai/sweep (look at their indexing logic).
- **Sourcegraph Cody Architecture:** How Cody chunks context for embeddings.
- **Tree-sitter Query Documentation:** https://tree-sitter.github.io/tree-sitter/using-parsers#pattern-matching-with-queries
- **Related Papers:** Search for papers on "Semantic chunking for source code" or "Code representation learning chunking."
- **Anthropic Context Window Guides:** How to format code chunks within long prompts.

## What to Measure & Compare
- Write a Python/Node script to chunk a known 1000-line React file using LangChain's recursive splitter vs a custom tree-sitter function-level splitter. Visually compare the cohesion of the output chunks.
- Calculate the total number of chunks produced by both methods and the resulting token variance (is tree-sitter producing chunks that are too small or wildly uneven in size?).

## Definition of Done
A 3000+ word engineering blueprint detailing the exact algorithm LCS will use to chunk code. It must include the specific tree-sitter query strings used to identify split boundaries and dictate how context (imports/class names) is injected into isolated function chunks.

## Architectural Implication
Feeds **ADR-004 (Chunking Strategy)**. Determines the exact pipeline that transforms raw files into the text payloads that are sent to the embedding model (*EM-03*) and stored in the vector database (*VD-01*).