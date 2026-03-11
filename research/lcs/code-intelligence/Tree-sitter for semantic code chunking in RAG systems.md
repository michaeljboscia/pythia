# Tree-sitter for semantic code chunking in RAG systems

**Structure-aware code chunking using tree-sitter dramatically outperforms naive text splitting for code retrieval**, with benchmarks showing **65% improvement in Recall@5** over fixed-size baselines. Tree-sitter's concrete syntax tree (CST) lets you split code at function, class, and module boundaries—preserving complete semantic units that embedding models can meaningfully encode. This matters because code is inherently hierarchical: a function split mid-body loses its signature, context, and logical coherence, yielding chunks that match poorly against natural-language queries. The dominant algorithm across production systems—from Sweep AI to LlamaIndex to the CMU cAST paper—is recursive split-then-merge on CST nodes, but existing off-the-shelf implementations have significant limitations that a custom tree-sitter query approach can address.

## How tree-sitter's CST enables structural code chunking

Tree-sitter parses source code into a [concrete syntax tree](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) that preserves every token, including whitespace, comments, decorators, and punctuation, with exact byte offsets. Unlike Python's built-in `ast` module which produces an abstract syntax tree discarding formatting, tree-sitter's CST is **lossless**: extracting `source_bytes[node.start_byte:node.end_byte]` recovers the exact original source text. This property is what makes it ideal for chunking—you get verbatim code, not reconstructed approximations.

The [py-tree-sitter](https://github.com/tree-sitter/py-tree-sitter) bindings (v0.22+) expose three extraction patterns of increasing sophistication. The simplest is recursive node walking—iterating `node.children` and checking `node.type` against target types like `function_definition`. More efficient is the [TreeCursor API](https://tree-sitter.github.io/py-tree-sitter/classes/tree_sitter.Node.html), which avoids allocating intermediate node objects. But the most powerful approach is **tree-sitter queries**: S-expression patterns that declaratively match node structures and capture them by name.

A tree-sitter query for extracting Python functions with their decorators and docstrings looks like this:

```scheme
;; Decorated functions (captures decorator + function as one unit)
(decorated_definition
  (decorator)+ @decorators
  definition: (function_definition
    name: (identifier) @name
    body: (block) @body)) @chunk

;; Undecorated functions
(function_definition
  name: (identifier) @name
  body: (block) @body) @chunk

;; Functions with docstrings (the . anchor enforces first-child position)
(function_definition
  name: (identifier) @name
  body: (block
    . (expression_statement (string) @docstring))) @chunk
```

The critical detail for Python is that **decorators wrap the function in a `decorated_definition` parent node**—if you only match `function_definition`, you'll miss the `@property` or `@staticmethod` decorators. The `.` anchor operator enforces adjacency, ensuring the [docstring pattern only matches strings that are the first statement](https://github.com/tree-sitter/tree-sitter-python/issues/168) in a block.

For TypeScript, the grammar differs substantially. Functions appear as `function_declaration` nodes, but arrow functions are `arrow_function` nodes nested inside `lexical_declaration > variable_declarator`. Classes use `type_identifier` for names (not `identifier`), and exports wrap declarations in `export_statement` nodes. A comprehensive TypeScript extraction query must cover all these forms:

```scheme
;; Named function declarations
(function_declaration
  name: (identifier) @name
  body: (statement_block) @body) @chunk

;; Arrow functions assigned to const/let
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function
      body: (_) @body))) @chunk

;; Class declarations with their full body
(class_declaration
  name: (type_identifier) @name
  body: (class_body) @body) @chunk

;; Exported declarations (wraps any of the above)
(export_statement
  declaration: (_) @inner) @chunk

;; Interface and type definitions
(interface_declaration
  name: (type_identifier) @name) @chunk
(type_alias_declaration
  name: (type_identifier) @name) @chunk
```

These queries are drawn from the [tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) and [tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python) grammars. The query syntax supports [predicates](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html) like `#match?` for regex filtering and `#any-of?` for matching against string lists, enabling fine-grained control over what gets captured.

Using the modern py-tree-sitter API, executing these queries in Python is straightforward:

```python
import tree_sitter_python as tspython
from tree_sitter import Language, Parser, Query, QueryCursor

PY_LANGUAGE = Language(tspython.language())
parser = Parser(PY_LANGUAGE)
tree = parser.parse(source_bytes)

query = Query(PY_LANGUAGE, query_string)
cursor = QueryCursor(query)
captures = cursor.captures(tree.root_node)
# captures["chunk"] contains all matched function/class nodes
```

The `captures()` method returns a dictionary mapping capture names to lists of nodes, while `matches()` groups related captures per pattern match—useful when you need to associate a function name with its body in a single operation.

## Chunk size distributions and the oversized function problem

Real-world codebases produce a **wide distribution of chunk sizes** when split at structural boundaries. The [CodeSearchNet dataset](https://github.com/github/CodeSearchNet)—containing ~6 million functions extracted via tree-sitter from popular open-source repositories across Python, JavaScript, Go, Java, Ruby, and PHP—shows that most functions after filtering (removing those under 3 lines) span **5–50 lines of code**, which translates roughly to **50–500 tokens** depending on language verbosity and formatting. The cAST paper from CMU [notes that](https://arxiv.org/abs/2506.15655) "two code segments with identical line counts may contain vastly different amounts of code," which is why they recommend **non-whitespace character count** rather than line count as the size metric.

Production systems converge on similar size targets. [Sweep AI uses a default of **1,500 characters**](https://github.com/sweepai/sweep/blob/main/docs/pages/blogs/chunking-2m-files.mdx) (~300–500 tokens) per chunk. [Qodo (formerly Codium) targets **~500 characters**](https://www.qodo.ai/blog/rag-for-large-scale-code-repos/) per chunk, arguing that "embedding smaller chunks generally leads to better performance." The [Chroma technical report](https://www.firecrawl.dev/blog/best-chunking-strategies-rag) found that **400 tokens** provides the best balance of recall and precision for general retrieval, with 256–512 tokens optimal for factoid queries.

The hard problem is **oversized functions**: a 200-line React component or a 300-line data processing function that far exceeds any reasonable chunk budget. The dominant solution is **recursive descent into child nodes**. When a function body exceeds the token budget, you recurse into its `block` (Python) or `statement_block` (TypeScript) children and attempt to split at the next structural level—`if_statement`, `for_statement`, `try_statement`, `switch_statement`, and similar block boundaries. The [supermemory/code-chunk](https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/) library implements this as a greedy window algorithm: accumulate sibling nodes until the budget is exceeded, then flush the current chunk and continue. If a single child node still exceeds the budget, recurse deeper into its children.

This recursive approach means chunks always break at syntactic boundaries—never mid-expression or mid-statement. The tradeoff is that very deeply nested code can produce small, fragmented chunks. The [cAST paper](https://arxiv.org/abs/2506.15655) addresses this with a formal split-then-merge algorithm that first splits top-down, then greedily merges adjacent small siblings bottom-up, ensuring chunks are packed close to but never exceeding the size budget.

## LlamaIndex and LangChain both fall short

**LangChain's `RecursiveCharacterTextSplitter.from_language()` does not use tree-sitter at all.** Despite its name suggesting language awareness, it relies on [hardcoded string separators](https://github.com/langchain-ai/langchain/blob/master/libs/text-splitters/langchain_text_splitters/character.py) for each language. For Python, these separators are simply `"\nclass "`, `"\ndef "`, `"\n\tdef "`, `"\nif "`, and progressively finer string-level splits. This means it can split a decorated function between its decorator and `def` line, break an `async def` that doesn't match the pattern, or cleave a method from its class context. It supports 26 languages but with purely syntactic string matching—no parsing, no tree structure, no understanding of nesting. LangChain does have a separate [`TreeSitterSegmenter`](https://python.langchain.com/docs/integrations/document_loaders/source_code/) class that uses tree-sitter queries, but it exists in the document loader pipeline, not the text splitter pipeline—a confusing architectural split.

**LlamaIndex's `CodeSplitter` does use tree-sitter**, but with a significant limitation: it walks CST children generically without using tree-sitter queries. The algorithm, [adopted directly from Sweep AI](https://github.com/sweepai/sweep/blob/main/docs/pages/blogs/chunking-2m-files.mdx), iterates through all children of each node and greedily concatenates them into chunks up to a `max_chars` limit (default 1,500). When a child exceeds the limit, it recurses into that child. The [source code](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/node_parser/text/code.py) reveals several issues:

- It treats all node types equally—an import statement, a function definition, and a comment are all just "children" to merge. There's no semantic differentiation.
- A [known byte-vs-character bug](https://github.com/sweepai/sweep/issues/4124) means size calculations are incorrect for non-ASCII content, since tree-sitter reports byte offsets but the algorithm compares against character limits.
- When a large class is split, the resulting method chunks lose their class context, imports, and relationship metadata.
- [Dependency issues](https://github.com/run-llama/llama_index/issues/13521) between `tree_sitter_languages` and newer `tree-sitter` versions have caused runtime errors.

Neither implementation uses tree-sitter queries to target specific construct types, labels chunks with semantic metadata, or preserves hierarchical context. LlamaIndex does offer a more advanced [`CodeHierarchyNodeParser`](https://github.com/run-llama/llama_index/blob/main/llama-index-packs/llama-index-packs-code-hierarchy/llama_index/packs/code_hierarchy/code_hierarchy.py) in a separate pack that maintains parent-child relationships, but it's not part of the core library.

## What production systems actually do with tree-sitter

The most sophisticated tree-sitter implementations go well beyond simple chunking. **Aider** uses tree-sitter not for chunking but for [building a ranked repository map](https://aider.chat/2023/10/22/repomap.html). It loads `.scm` tag query files from tree-sitter grammars to extract function/class definitions and references, then constructs a `networkx` directed graph where nodes are files and edges are cross-file identifier references. PageRank with personalization (chat files get +100 weight) produces a ranked list of the most relevant code symbols, which are rendered as concise structural summaries using the `grep_ast` package. This graph-based approach captures relationships that flat chunking misses entirely.

**[Continue.dev](https://blog.continue.dev/accuracy-limits-of-codebase-retrieval/)** takes a hybrid approach: if a file fits within the embedding window (512 tokens), use it whole. Otherwise, extract top-level constructs via tree-sitter. If a construct still exceeds the budget, truncate method bodies to show just structure—`def method(self): ...`—preserving the class skeleton while compressing implementation details. They combine this with HyDE (Hypothetical Document Embedding), generating an imagined code snippet from the query for better semantic matching.

**[Supermemory's code-chunk library](https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/)** represents the current state of the art for AST-aware chunking. It implements the cAST paper's recursive split-then-merge algorithm but adds critical production features: rich entity extraction (identifying functions, methods, classes, interfaces, types, enums, imports), a hierarchical scope tree capturing nesting relationships, and—most importantly—**contextualized text for embeddings**. Each chunk gets a prepended header containing its file path, scope chain, entity signatures, and imported modules before being sent to the embedding model. On an enhanced RepoEval benchmark, this approach achieves **70.1% Recall@5 versus 42.4% for fixed-size baselines**—and versus 49.0% for Chonkie's code chunker that lacks the contextualization layer.

**Sourcegraph's Cody** took a notably different path: they [moved away from embeddings entirely](https://sourcegraph.com/blog/how-cody-understands-your-codebase) for their Enterprise GA, using tree-sitter primarily for client-side autocomplete intent classification rather than chunk-based retrieval. Their reasoning—third-party data concerns, complexity of keeping embeddings updated at scale, and difficulty serving 100k+ repositories—is worth considering as a counterpoint to the chunking-centric approach.

## Benchmarks confirm structural chunking wins decisively

The quantitative evidence for structural chunking is strong across multiple independent evaluations. The [cAST paper](https://arxiv.org/abs/2506.15655) (EMNLP 2025 Findings) demonstrated **+4.3 points Recall@5 on RepoEval** and **+2.67 points Pass@1 on SWE-bench** compared to fixed-size line-based chunking, evaluated across Python, Java, C#, and TypeScript with multiple retrieval models including CodeSage. Critically, they found that fixed-size line-based chunking shows "notably higher performance variation across languages" compared to AST-aligned chunking—a line limit tuned for Python over-segments TypeScript or under-segments verbose Java.

The [systematic document chunking study](https://arxiv.org/html/2603.06976) (36 strategies, 1,080 configurations, 5 embedding models) found that content-aware chunking significantly outperforms naive fixed-length splitting, with fixed-size character chunking scoring **nDCG@5 below 0.244**—the worst of all strategies tested. While this study covers general documents rather than code specifically, it establishes that structure awareness is universally beneficial for retrieval quality.

A separate evaluation by [supermemory](https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/) using 500 hard negatives and IoU threshold 0.3 found their AST-aware chunker achieved **70.1% Recall@5** with an **IoU@5 of 0.43**, compared to 42.4% Recall@5 and 0.34 IoU@5 for fixed-size chunking. Their SWE-bench Lite evaluation showed that semantic search agents using AST-aware chunks consumed **44% fewer tokens** and **37% less time** than operations-only approaches.

## Building a custom tree-sitter chunking pipeline

Based on the landscape analysis, a custom implementation should combine tree-sitter queries for precise construct targeting with the recursive split-then-merge algorithm for size management, plus context enrichment for embedding quality. The key architectural decisions are:

**Use queries, not generic tree walking.** Tree-sitter queries let you declaratively specify exactly which constructs become chunk boundaries—and the query captures provide semantic labels (function, class, interface) as free metadata. This is strictly more powerful than LlamaIndex's approach of walking all children generically. [The query syntax](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) supports alternations (`[type_a type_b]`), optional children (`?`), and predicates for regex matching, giving fine-grained control without custom traversal code.

**Measure in tokens, not characters or lines.** The byte-vs-character bugs in Sweep/LlamaIndex and the cAST paper's observation about line-count inconsistency both point toward using actual token counts. Integrating [tiktoken](https://github.com/openai/tiktoken) with the target embedding model's tokenizer ensures chunks fit the model's context window. For performance, token counting can be approximated at ~4 characters per token for GPT models, or precomputed using cumulative sum arrays as supermemory does for non-whitespace character counts.

**Enrich chunks with structural context.** The single highest-impact optimization is prepending contextual metadata to each chunk before embedding. [Qodo's approach](https://www.qodo.ai/blog/rag-for-large-scale-code-repos/) of including imports, class signatures, and `__init__` methods with every method chunk, and [supermemory's](https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/) pattern of adding file path, scope chain, and entity signatures, both significantly improve retrieval by giving the embedding model the semantic context it needs. A method called `getUser` means very different things in `AuthService` versus `DatabaseAdapter`—the scope chain disambiguates.

**Handle the long tail of oversized constructs.** For functions exceeding the token budget, recurse into the function body's children and split at block-level boundaries (`if_statement`, `for_statement`, `try_statement`). For TypeScript specifically, target `statement_block` children. When even individual statements exceed the budget (rare but possible with large object literals or template strings), fall back to the parent chunk with truncation rather than producing incoherent fragments.

A complete implementation targeting Python and TypeScript should capture these node types at the top level:

- **Python**: `decorated_definition`, `function_definition`, `class_definition`, `import_statement`, `import_from_statement`, plus top-level `expression_statement` (for module-level assignments and docstrings)
- **TypeScript**: `function_declaration`, `class_declaration`, `abstract_class_declaration`, `lexical_declaration` (filtering for arrow function values), `export_statement`, `interface_declaration`, `type_alias_declaration`, `enum_declaration`, `import_statement`

For sub-chunking within oversized functions, the split boundaries should be: `if_statement`, `for_statement`, `while_statement`, `try_statement`, `with_statement` (Python) and `if_statement`, `for_statement`, `for_in_statement`, `while_statement`, `try_statement`, `switch_statement` (TypeScript).

## Conclusion

The landscape of tree-sitter-based code chunking has converged on a clear best practice: **recursive split-then-merge on AST nodes with context enrichment**, pioneered by Sweep AI's algorithm and refined by the cAST paper and supermemory's code-chunk library. LlamaIndex's CodeSplitter implements the basic algorithm but misses the query-based targeting and context preservation that drive retrieval quality. LangChain's code splitter doesn't use tree-sitter at all, relying on brittle string matching. For a production RAG pipeline, a custom implementation using tree-sitter queries provides three capabilities no off-the-shelf tool combines: declarative construct targeting that adapts per language grammar, semantic metadata (node type, scope chain, entity names) as a byproduct of query captures, and context-enriched chunk text that embeds with dramatically higher retrieval precision. The ~65% improvement in Recall@5 from AST-aware chunking over fixed-size baselines makes this one of the highest-leverage optimizations available in a code RAG pipeline.

## Bibliography

| # | Title | URL | Key contribution |
|---|-------|-----|-----------------|
| 1 | Tree-sitter Query Syntax Documentation | https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html | Authoritative reference for S-expression query patterns, captures, predicates, anchors, and quantifiers |
| 2 | Tree-sitter Predicates and Directives | https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html | Documentation of `#eq?`, `#match?`, `#any-of?` and other query predicates for filtering captures |
| 3 | py-tree-sitter GitHub Repository | https://github.com/tree-sitter/py-tree-sitter | Official Python bindings with Query, QueryCursor, Node, and Parser APIs; setup examples for modern API |
| 4 | tree-sitter-python Grammar | https://github.com/tree-sitter/tree-sitter-python | Python grammar defining node types (function_definition, decorated_definition, class_definition, block) |
| 5 | tree-sitter-python Docstring Query Issue #168 | https://github.com/tree-sitter/tree-sitter-python/issues/168 | Community patterns for capturing docstrings using the `.` anchor operator |
| 6 | tree-sitter-typescript Grammar | https://github.com/tree-sitter/tree-sitter-typescript | TypeScript/TSX grammar with node types for function_declaration, class_declaration, arrow_function, interface_declaration |
| 7 | Sweep AI — Chunking 2M+ Files a Day | https://github.com/sweepai/sweep/blob/main/docs/pages/blogs/chunking-2m-files.mdx | Original recursive CST child-merging algorithm adopted by LlamaIndex; documents parser reliability issues |
| 8 | LlamaIndex CodeSplitter Source Code | https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/node_parser/text/code.py | Implementation of Sweep's algorithm in LlamaIndex; demonstrates greedy recursive chunking without queries |
| 9 | LlamaIndex CodeSplitter API Documentation | https://docs.llamaindex.ai/en/stable/api_reference/node_parsers/code/ | Configuration options: chunk_lines, chunk_lines_overlap, max_chars, language, parser |
| 10 | LangChain RecursiveCharacterTextSplitter Source | https://github.com/langchain-ai/langchain/blob/master/libs/text-splitters/langchain_text_splitters/character.py | Hardcoded string separators per language; no tree-sitter parsing; supports 26 languages |
| 11 | LangChain Source Code Loading with Tree-sitter | https://python.langchain.com/docs/integrations/document_loaders/source_code/ | TreeSitterSegmenter for document loading (not splitting); uses tree-sitter queries for extraction |
| 12 | cAST: Enhancing Code RAG with Structural Chunking via AST | https://arxiv.org/abs/2506.15655 | EMNLP 2025; recursive split-then-merge algorithm; +4.3 Recall@5 on RepoEval; language-invariant chunking |
| 13 | A Systematic Investigation of Document Chunking Strategies | https://arxiv.org/html/2603.06976 | 36 strategies × 5 embedding models; fixed-size chunking scores nDCG@5 < 0.244; content-aware chunking significantly better |
| 14 | Aider Repository Map Blog Post | https://aider.chat/2023/10/22/repomap.html | Graph-based approach using tree-sitter tag queries + PageRank for ranked code context |
| 15 | Aider RepoMap Source Code | https://github.com/Aider-AI/aider/blob/4bf56b77/aider/repomap.py | Implementation of query-based definition/reference extraction with networkx graph ranking |
| 16 | Sourcegraph — How Cody Understands Your Codebase | https://sourcegraph.com/blog/how-cody-understands-your-codebase | Documents move away from embeddings to structural search; tree-sitter used for autocomplete intent |
| 17 | Continue.dev — Accuracy Limits of Codebase Retrieval | https://blog.continue.dev/accuracy-limits-of-codebase-retrieval/ | Tree-sitter for top-level construct extraction; HyDE for query augmentation; truncation-based compression |
| 18 | Qodo — RAG for a Codebase with 10k Repos | https://www.qodo.ai/blog/rag-for-large-scale-code-repos/ | ~500 char target chunks; context enrichment with imports and class signatures; enterprise-scale lessons |
| 19 | Supermemory — Building code-chunk: AST Aware Code Chunking | https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/ | 70.1% vs 42.4% Recall@5; contextualized text with scope chains; scope tree and entity extraction |
| 20 | supermemoryai/code-chunk GitHub Repository | https://github.com/supermemoryai/code-chunk | TypeScript library with scope tree, entity signatures, streaming, WASM support |
| 21 | yilinjz/astchunk GitHub Repository | https://github.com/yilinjz/astchunk | Reference implementation of cAST paper; Python package with metadata templates and chunk expansion |
| 22 | CodeSearchNet Challenge Dataset | https://github.com/github/CodeSearchNet | ~6M functions across 6 languages extracted via tree-sitter; baseline for function size distributions |
| 23 | Sweep AI Byte vs Character Bug Report | https://github.com/sweepai/sweep/issues/4124 | Documents the byte/character comparison bug in the recursive chunking algorithm |
| 24 | LlamaIndex CodeSplitter Compatibility Issue #13521 | https://github.com/run-llama/llama_index/issues/13521 | Documents tree_sitter_languages version incompatibility causing runtime errors |
| 25 | Firecrawl — Best Chunking Strategies for RAG | https://www.firecrawl.dev/blog/best-chunking-strategies-rag | Aggregates Chroma and NVIDIA benchmarks; recommends 400–512 tokens; code-aware separator guidance |
| 26 | benbrandt/text-splitter (semantic-text-splitter) | https://github.com/benbrandt/text-splitter | Rust crate using tree-sitter AST depth as semantic levels; Python bindings via semantic-text-splitter |
| 27 | LanceDB — Building RAG on Codebases | https://lancedb.com/blog/building-rag-on-codebases-part-1/ | Syntax-level chunking with tree-sitter; recommends hybrid search + re-ranking for code retrieval |
| 28 | Tree-sitter Code Navigation (Tags) | https://tree-sitter.github.io/tree-sitter/4-code-navigation.html | Official documentation for tags.scm query patterns used by Aider and code editors |
| 29 | Repomix Repository | https://github.com/yamadashy/repomix | Tree-sitter --compress flag achieves ~70% token reduction by extracting structural skeletons |
| 30 | Late Chunking: Contextual Chunk Embeddings | https://arxiv.org/html/2409.04701v3 | Jina AI; embeds full document then chunks after transformer pass; preserves cross-chunk context |