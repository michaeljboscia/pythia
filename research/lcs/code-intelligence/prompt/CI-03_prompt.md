# Research Prompt: CI-03 LSP for Headless Code Analysis

## Research Objective
Evaluate the feasibility, performance, and operational constraints of running a Language Server (specifically `tsserver` or `typescript-language-server`) headlessly to extract deep code intelligence for the Living Corpus System (LCS). The goal is to determine if LSP can be used as a batch-processing engine during indexing to resolve cross-file dependencies and call graphs that tree-sitter cannot see.

## Research Questions
1. **LSP vs Tree-Sitter:** Tree-sitter parses syntax; LSP computes semantics. Detail exactly what intelligence an LSP provides that tree-sitter fundamentally cannot (e.g., resolving imported aliases, type inference across files, finding all references of an interface).
2. **Headless Execution:** How do you programmatically spin up an LSP instance in a Node.js background process (*PE-01*) without an IDE? What is the standard protocol for sending `initialize`, `textDocument/didOpen`, and `textDocument/references` requests over stdio/IPC?
3. **Initialization Cost:** What is the memory and CPU footprint of initializing `tsserver` on a medium-sized project (e.g., 2000 TypeScript files)? How long does it take to build the initial project graph before it can answer queries?
4. **Batch Extraction Viability:** LSPs are designed for single-file, low-latency, interactive querying. Are they suitable for exhaustive batch extraction (e.g., "Give me the call graph of every function in the project")? What are the timeout or memory-leak risks?
5. **Protocol Specifics:** Document the exact JSON-RPC payloads required to execute "Go to Definition", "Find All References", and "Document Symbol" requests against a headless LSP.
6. **Handling Monorepos/Workspaces:** How does the LSP behave in a monorepo setup (e.g., yarn workspaces, pnpm)? How do you configure it to properly resolve cross-package dependencies?
7. **LSIF/SCIP Alternative:** Evaluate LSIF (Language Server Index Format) and SCIP (Source Code Intelligence Protocol). Should LCS rely on pre-compiled SCIP indexes generated via CI/CD instead of querying a live LSP during local ingestion?
8. **TypeScript Compiler API:** Is it more efficient to bypass the LSP entirely and use the official TypeScript Compiler API (`ts.createProgram`) directly in Node.js to extract the AST and TypeChecker data?
9. **Staleness and Updates:** If LCS relies on an LSP, how do we keep the LSP's internal state synchronized with changes on the filesystem (see *DM-01* CDC patterns) to ensure cross-file intelligence is up to date?
10. **Fallback Gracefully:** If the LSP fails to boot or crashes due to memory limits, can LCS degrade gracefully to pure tree-sitter indexing, and what cross-file intelligence is sacrificed?

## Sub-Topics to Explore
- The architecture of `tsserver` vs standard `typescript-language-server`.
- Memory profiling of V8 instances running large TypeScript projects.
- Sourcegraph's transition from LSIF to SCIP for codebase indexing.
- Connecting an MCP Server directly to an LSP instance.

## Starting Sources
- **LSP Specification:** https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
- **TypeScript Server (tsserver) Protocol:** https://github.com/microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29
- **Sourcegraph SCIP:** https://github.com/sourcegraph/scip
- **LSIF Specification:** https://microsoft.github.io/language-server-protocol/specifications/lsif/0.6.0/specification/
- **Using TypeScript Compiler API:** https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- **VSCode LSP Node client/server:** https://github.com/microsoft/vscode-languageserver-node
- **Blog:** "How we use the TypeScript Compiler API" (look for engineering blogs from tools like Typedoc or API Extractor).
- **GitHub Code Search Architecture:** How they index cross references.

## What to Measure & Compare
- Benchmark the startup time and RAM consumption of instantiating the TypeScript Compiler API (`ts.createProgram`) on the LCS repository itself vs firing up `tsserver`.
- Compare the JSON output structure of a tree-sitter query for "function calls" vs an LSP `textDocument/references` response.

## Definition of Done
A 3000-5000 word highly technical assessment that definitively answers whether LCS should integrate a headless LSP, rely on SCIP/LSIF static indexing, or fall back to the TypeScript Compiler API. It must include working code or RPC payloads demonstrating how to extract cross-file references programmatically.

## Architectural Implication
This is a **P0 BLOCKER** for **ADR-005 (Relationship Extraction)**. It dictates how the Knowledge Graph (*KG-01*, *KG-08*) builds relationships between disparate files. If LSP is rejected, the graph will be severely limited to intra-file syntax and LLM-guessed relationships.