# DR Prompt — API Surface Extraction: Tier 2 Language Server Lifecycle from Node.js

## Context

We are building `pythia_api_surface`, a new MCP tool inside a Node.js 22 TypeScript MCP server.
For languages without compiler-level extraction (Python, C/C++, Ruby, PHP), the Language Server
Protocol (LSP) is the best available source of resolved, semantically correct API surface —
constructor signatures, inferred types, hover documentation, and "go to definition" chains.

Pythia already starts a TypeScript language server (`tsserver`) on demand in its slow-path
indexer. The research question is: what is the production pattern for managing multiple LSP
server processes across many languages from a single long-running Node.js daemon?

## Research Questions

### 1. Multi-LSP Process Management Patterns

Production editors (VS Code, Zed, Neovim) manage multiple LSP servers simultaneously.
What are the architectural patterns they use for:

- **Lazy startup**: spinning up `pyright`, `clangd`, `ruby-lsp`, `phpactor` only when a file
  of that language is first requested
- **Process pooling**: reusing an already-running LSP server across multiple requests vs
  spawning fresh per-file
- **Idle shutdown**: detecting when an LSP server has been unused for N minutes and terminating it
- **Crash recovery**: restarting a dead LSP server transparently without losing in-flight requests

Which of these patterns is most appropriate for a tool server (not an editor) where requests
are bursty but infrequent?

### 2. LSP Client Implementation in Node.js

What are the best Node.js libraries for acting as an LSP client (speaking the JSON-RPC
Language Server Protocol to a subprocess)?

- **`vscode-languageclient`**: designed for VS Code extensions — can it be used outside VS Code?
- **`@volar/language-server`**: Volar's standalone client infrastructure
- **`language-server-protocol`**: Microsoft's type definitions only — no client impl
- **Raw JSON-RPC over stdio**: `child_process.spawn` + readline — is this viable at scale?

For each: maintenance status, bundle size, whether it works in a non-editor Node.js process,
and examples of tools that use it outside of VS Code.

### 3. Per-Language LSP Server Recommendations

For each language below, what is the recommended LSP server for programmatic API surface
extraction (not editor integration), and how is it invoked?

- **Python**: Pyright vs `python-lsp-server` (`pylsp`) vs `basedpyright` — which exposes
  the best programmatic type information? Can Pyright be used as a library (not subprocess)?
- **C / C++**: `clangd` — what compilation database is required? Can it analyze a single
  file without a `compile_commands.json`?
- **Ruby**: `ruby-lsp` vs `solargraph` — which is more reliable for hover/definition?
  Does Sorbet/RBS type information improve results significantly?
- **PHP**: `phpactor` vs `intelephense` — licensing, quality, programmatic use

### 4. The Hover + Definition Chain Pattern

The RATester paper uses LSP "hover" to resolve type definitions transitively (following
imports to get constructor shapes). What is the exact LSP request sequence for:

1. Opening a file in the LSP (`textDocument/didOpen`)
2. Getting the hover information for an identifier at a position (`textDocument/hover`)
3. Getting the definition location (`textDocument/definition`)
4. Following the definition to extract the target's own hover information

What are the pitfalls of this approach (workspace initialization time, missing compilation
database, LSP server cold-start latency)? What is the minimum viable request sequence for
single-file API surface extraction without a full workspace?

### 5. Memory and Resource Bounds

How much memory does each recommended LSP server consume at idle vs during active analysis?

- `pyright` (Python)
- `clangd` (C/C++)
- `ruby-lsp` (Ruby)
- `phpactor` (PHP)

What is the maximum number of concurrent LSP servers a 4GB Node.js daemon can safely manage?
What are the shutdown/cleanup patterns that prevent zombie LSP processes?

### 6. Prior Art: Tools That Do This Today

Are there existing tools that manage multiple LSP servers from Node.js for non-editor purposes?
Specifically:

- **Sourcegraph's `scip-*` family**: how do they extract LSP-level symbols for indexing?
- **GitHub Semantic** (retired): what was its multi-language LSP architecture?
- **`tree-sitter-language-pack`** and similar: do any of these bundle LSP alongside tree-sitter?
- **AI coding tools** (Cursor, Continue.dev, Cody): do they expose their LSP management
  infrastructure as a library?

## Constraints

- MCP server startup must remain <2 seconds (LSP servers are lazy-started, not eager)
- Each LSP server process must be killable on SIGTERM without leaving zombie processes
- No hard runtime dependencies — each LSP server must be detected and skipped if absent
- Node.js 22 LTS, ESM

## Expected Output

Concrete recommendation per language: which LSP server, how to spawn it, minimum request
sequence for single-file hover extraction, memory footprint, and a working Node.js code
example using stdio JSON-RPC.
