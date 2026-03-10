# Research Prompt: CI-01 tree-sitter Architecture and TypeScript Grammar

## Research Objective
Execute a hands-on technical deep dive into tree-sitter's architecture, specifically focusing on its TypeScript and TSX grammars. The objective is to evaluate tree-sitter's capability to serve as the foundational parsing engine for the Living Corpus System (LCS), determining how robustly it can extract structural intelligence (classes, functions, interfaces, imports) from raw source code for downstream chunking and graph construction.

## Research Questions
1. **Core Architecture:** How does tree-sitter achieve its famously fast incremental parsing? Explain the underlying GLR (Generalized LR) parser architecture and how it handles broken or syntactically invalid code without failing.
2. **AST Node Representation:** In tree-sitter's AST, what is the difference between named nodes and anonymous nodes? How do you reliably traverse the AST using the Node.js bindings?
3. **Query Language:** How does the tree-sitter query language (S-expressions) work? What is the syntax for capturing specific node types (e.g., extracting all exported functions and their associated JSDoc comments)?
4. **TypeScript Grammar Specifics:** The `tree-sitter-typescript` repository contains two separate grammars: `typescript` and `tsx`. How are they structured, and what are the specific edge cases where the `tsx` grammar fails to parse standard TypeScript correctly (and vice-versa)?
5. **State and Incremental Updates:** How do you pass byte edits to an existing tree-sitter parse tree to update it incrementally? Is this feature necessary for LCS if we only re-index files that change on git commits (see *DM-05*), or is full-file re-parsing fast enough?
6. **Error Nodes and Resilience:** Inject deliberately broken syntax into a TypeScript file. How does tree-sitter represent the `ERROR` node? Does it successfully parse the valid syntax around the error?
7. **Node.js Integration:** What are the performance and memory implications of using the `tree-sitter` npm module (WASM vs native bindings) in a long-running Node.js daemon (*PE-01*)?
8. **Limitations vs ASTs:** What information is inherently lost when using tree-sitter compared to using the official TypeScript Compiler API (e.g., type inference, resolved aliases, cross-file references)?
9. **Capturing Context:** How do you write a tree-sitter query that reliably captures the "context" of a function (e.g., the class it belongs to, or the module-level variables it references)?
10. **Grammar Maintenance:** How frequently are the TypeScript and TSX grammars updated to support new language features (e.g., decorators, new generic syntax)? What is the fallback if a grammar lags behind the language spec?

## Sub-Topics to Explore
- Writing robust S-expression queries with predicates (e.g., `#eq?`, `#match?`).
- Handling nested block structures and scope boundary detection.
- Cross-language parsing: How easily could LCS expand from TypeScript to Python or Rust using the same tree-sitter query engine?
- Extracting metadata: Using tree-sitter to reliably strip out all comments and docstrings from a file.

## Starting Sources
- **Tree-sitter Official Docs:** https://tree-sitter.github.io/tree-sitter/
- **Tree-sitter Node.js Bindings:** https://github.com/tree-sitter/node-tree-sitter
- **Tree-sitter TypeScript Grammar:** https://github.com/tree-sitter/tree-sitter-typescript
- **Query Syntax Guide:** https://tree-sitter.github.io/tree-sitter/using-parsers#pattern-matching-with-queries
- **GitHub's semantic tool:** https://github.com/github/semantic (built on tree-sitter, good prior art)
- **Zed Editor Blog:** "Syntax Highlighting in Zed" (details their tree-sitter usage) - https://zed.dev/blog
- **Cursor/Sourcegraph codebases:** Look for open-source tree-sitter query files used in Sourcegraph.
- **AST Explorer:** https://astexplorer.net/ (Select tree-sitter as the parser to visualize the tree).

## What to Measure & Compare (Hands-On Execution)
- **Parse Speed:** Benchmark the time (in milliseconds) it takes tree-sitter to parse a massive 5,000-line React component from cold start vs. incremental update.
- **Query Execution:** Write a specific tree-sitter query that successfully extracts a tuple of `[FunctionName, LineStart, LineEnd, DocString]` for all exported functions in a file. Measure the execution time of this query.

## Definition of Done
A 3000+ word deep dive combining architectural theory with hands-on proof. The document must contain working Node.js code snippets for initializing tree-sitter, parsing a TS file, and executing a capture query. It must definitively state the limits of tree-sitter's syntax-only understanding.

## Architectural Implication
This is a **P0 BLOCKER** for **ADR-004 (Chunking Strategy)**. The findings determine if tree-sitter is the primary engine for breaking files apart, and what structural metadata we can reliably extract without invoking a full Language Server.