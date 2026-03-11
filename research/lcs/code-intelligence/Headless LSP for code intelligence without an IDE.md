# Headless LSP for code intelligence without an IDE

**Running a Language Server Protocol server outside an editor unlocks programmatic access to go-to-definition, find-references, and symbol indexing — but the protocol was designed for interactive editors, not batch pipelines.** The practical path forward depends on whether you need real-time incremental intelligence (headless LSP), offline batch indexing (SCIP), or deep AST access for code transformation (ts-morph). This analysis covers the protocol mechanics, TypeScript server options, performance realities, tooling ecosystem, and the npm packages that make headless LSP viable in Node.js.

## LSP capabilities that matter for code indexing

The [LSP specification v3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) defines dozens of request types, but five are essential for building a code index. [`textDocument/documentSymbol`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) returns a hierarchical tree of every symbol in a file — classes, functions, variables, interfaces — each tagged with a `SymbolKind` enum and precise `Range`. This is the natural starting point: iterate every file, collect its symbol tree. [`textDocument/definition`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) resolves where a symbol at a given `(line, character)` position is declared, returning a `Location` with URI and range. [`textDocument/references`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) does the inverse — given a position, it returns every `Location[]` across the workspace that references that symbol. Together, these three methods build a complete cross-reference graph.

[`workspace/symbol`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) provides workspace-wide symbol search by query string, useful for fuzzy lookup rather than exhaustive enumeration. [`textDocument/hover`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) extracts type signatures and documentation as `MarkupContent` for any position. Two additional methods round out advanced indexing: [`textDocument/typeDefinition`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) navigates from a variable to its type's declaration, and [`callHierarchy/incomingCalls` and `callHierarchy/outgoingCalls`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) build call graphs.

A critical architectural constraint shapes all of these: as [Aleksey Kladov (matklad)](https://matklad.github.io/2023/10/12/lsp-could-have-been-better.html) observes, **LSP requests map to editor widgets, not to underlying language concepts**. There is no "get AST" request. You cannot ask "where is `Foo.bar` defined" by name — you must provide `file:line:column`. [José Valim echoed this](https://x.com/josevalim/status/2002312493713015160), noting that "most LSP APIs are awkward for agentic usage." This position-centric design means a headless client must first know *where* in a file to query, typically by combining `documentSymbol` enumeration with targeted `definition` and `references` lookups.

## TypeScript LSP servers and the JSON-RPC transport

Three TypeScript language servers exist today, with a fourth on the horizon. **tsserver** is the TypeScript compiler's built-in server, bundled at `node_modules/typescript/lib/tsserver.js`. It uses its [own custom protocol](https://github.com/microsoft/TypeScript/wiki/Standalone-Server-(tsserver)) — not LSP. Requests are JSON objects written to stdin (`{"seq":1,"type":"request","command":"definition","arguments":{"file":"...","line":10,"offset":5}}`), and responses arrive on stdout with `Content-Length` headers. Notably, tsserver uses **1-based line/offset** positioning, unlike LSP's 0-based scheme. Its protocol is defined in [`src/server/protocol.ts`](https://github.com/microsoft/TypeScript/blob/main/src/server/protocol.ts) in the TypeScript repository.

[**typescript-language-server**](https://github.com/typescript-language-server/typescript-language-server) wraps tsserver in a standards-compliant LSP shell. Install it via `npm install -g typescript-language-server typescript` and run with `typescript-language-server --stdio`. It translates LSP messages into tsserver's custom protocol internally, supporting definition, references, documentSymbol, workspace/symbol, hover, completion, rename, call hierarchy, semantic tokens, and more. Configuration flows through `initializationOptions` in the `initialize` request — key options include `tsserver.path`, `maxTsServerMemory`, and `preferences`. The project's [configuration docs](https://github.com/typescript-language-server/typescript-language-server/blob/master/docs/configuration.md) detail all options. A notable alternative is [**vtsls**](https://github.com/yioneko/vtsls), which wraps the actual VS Code TypeScript extension code rather than just tsserver, achieving closer feature parity with VS Code's built-in experience.

Looking ahead, **TypeScript 7** ([typescript-go](https://devblogs.microsoft.com/typescript/typescript-native-port/)) is a complete Go rewrite that includes **native LSP support**, potentially superseding the community wrapper. The [typescript-language-server README](https://github.com/typescript-language-server/typescript-language-server) explicitly acknowledges this may make their project unnecessary.

### The initialization handshake

The [LSP base protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) uses JSON-RPC 2.0 with HTTP-style framing: `Content-Length: <byte-length>\r\n\r\n<JSON body>`. The lifecycle is a strict three-step handshake. First, the client sends an `initialize` request with `processId`, `rootUri` (pointing to the workspace root containing `tsconfig.json`), `capabilities` (declaring which features the client supports), and optionally `workspaceFolders`. The server responds with `ServerCapabilities` announcing which features it provides — if `definitionProvider` is absent, the client must not send definition requests. Second, the client sends an `initialized` notification confirming receipt. Third, before querying any file, the client must send `textDocument/didOpen` with the file's full text content, URI, language ID, and version number. The server operates on these virtual documents, **not the files on disk**.

This handshake represents the first major friction point for headless usage. The server may also send requests *back* to the client — typescript-language-server frequently sends [`workspace/configuration`](https://github.com/typescript-language-server/typescript-language-server) requests for formatting preferences that a headless client must handle or at minimum respond to with empty results.

## Performance reality: startup, memory, and query latency

Running tsserver headlessly is resource-intensive. The most authoritative benchmarks come from [Microsoft's March 2025 announcement](https://devblogs.microsoft.com/typescript/typescript-native-port/) of the Go-based compiler. For the **VS Code codebase (1.5M LOC)**, full `tsc` type-checking takes **77.8 seconds** and editor project load takes **~9.6 seconds**. For Playwright (356K LOC), checking takes 11.1 seconds. Even the small tRPC project (18K LOC) takes 5.5 seconds due to baseline compiler startup costs.

Community reports paint a starker picture for real-world headless scenarios. A project with [100 TypeScript project references](https://github.com/microsoft/TypeScript/issues/39144) saw **22-second delays** just to open a file. A large monorepo reported [`updateGraphWorker` taking 68 seconds](https://github.com/microsoft/TypeScript/issues/49633) for initial project load. Users of [Neovim with large monorepos](https://neovim.discourse.group/t/slow-lsp-on-large-ts-monorepo-project-caching/2668) report ~1-minute delays before go-to-definition works.

Memory consumption is the binding constraint. An [empty project with just `@types/node`](https://github.com/microsoft/TypeScript/issues/46028) peaks at **~188 MB**. Adding a single large dependency like aws-sdk [balloons memory by ~400 MB](https://swatinem.de/blog/optimizing-tsc/) because tsserver loads all type declaration files into AST nodes (~160 bytes each). Projects with 15–20 dependencies routinely [hit nearly 1 GB](https://github.com/microsoft/TypeScript/issues/46028). Large projects (200K+ LOC) [consume 2–3 GB](https://github.com/microsoft/TypeScript/issues/40138) and frequently crash at the default `maxTsServerMemory` limit of [3072 MB in VS Code](https://github.com/microsoft/vscode/issues/140090). The [Zed editor defaults to 8 GB](https://zed.dev/docs/languages/typescript) for its TypeScript LSP. **tsserver has no internal memory pressure management** — it simply uses memory until the Node.js heap limit triggers a crash.

Query latency after warmup varies dramatically. Simple completions on warm servers run in [**8–10ms**](https://github.com/Microsoft/TypeScript/issues/19458). But the first completion after an edit can take [**2.4 seconds**](https://github.com/Microsoft/TypeScript/issues/19458) because tsserver must run `updateGraphWorker` to revalidate the project graph. For large projects, [semantic diagnostics take 7+ seconds](https://github.com/microsoft/TypeScript/issues/53609) after edits, and find-references in the VS Code codebase takes ["up to a second"](https://github.com/Microsoft/TypeScript/issues/17385). The [Deno team's LSP optimization work](https://deno.com/blog/optimizing-our-lsp) found auto-completion took **6–8 seconds** in a 75K LOC codebase before optimization, dropping to under 1 second after introducing caching layers.

The Go rewrite promises transformative improvements: **8–10x faster builds**, **~50% memory reduction**, and editor load for the VS Code codebase dropping from 9.6 seconds to [**~1.2 seconds**](https://devblogs.microsoft.com/typescript/typescript-native-port/). Expected availability is early-to-mid 2026.

## Challenges of headless LSP and how tools solve them

Beyond initialization complexity and performance, headless LSP faces fundamental protocol-level challenges. [Document synchronization](https://www.michaelpj.com/blog/2024/09/03/lsp-good-bad-ugly.html) requires the client to maintain full document state and send `didOpen`/`didChange`/`didClose` notifications — the server tracks virtual documents, not disk state. As [michaelpj (Haskell Language Server maintainer)](https://www.michaelpj.com/blog/2024/09/03/lsp-good-bad-ugly.html) explains, **LSP has missing causality**: the client "has no idea whether or not the results it is getting are up-to-date" because the server processes changes asynchronously. File watching (`workspace/didChangeWatchedFiles`) must be implemented or simulated. Error handling requires supervision logic for server crashes with no built-in recovery mechanism.

**Cursor** addresses these challenges through its [Shadow Workspace architecture](https://cursor.com/blog/shadow-workspace). When an AI agent needs diagnostics for generated code, Cursor spawns a hidden Electron window (`show: false`) for the same workspace, applies the AI's edits in this shadow environment, and retrieves lints without polluting the user's language server state. Simpler approaches failed: copying TextModels polluted go-to-references results, and spawning separate language servers was too complex. The shadow workspace communicates via gRPC over IPC and exposes a [simple Protobuf API](https://gist.github.com/arvid220u/b976c87c7ec9f6f66595dc0ebc0f07d6). A limitation: [rust-analyzer doesn't work](https://cursor.com/blog/shadow-workspace) in this model because it requires files on disk.

**Sourcegraph Cody** [does not use live LSP at all](https://sourcegraph.com/blog/how-cody-understands-your-codebase). Instead, it relies on pre-computed **SCIP indexes** for precise code navigation, combined with code search and embeddings for context retrieval. Cody is described as ["a natural language layer on top of Sourcegraph"](https://github.com/sourcegraph/handbook/blob/main/content/departments/engineering/teams/cody/about-cody-faq.md) that uses the same search and code navigation features a human would.

**Continue.dev** [integrates with LSP through the host IDE's APIs](https://deepwiki.com/continuedev/continue/6.6-lsp-context-integration), not headlessly. Its ["Root Path Context" strategy](https://blog.continue.dev/root-path-context-the-secret-ingredient-in-continues-autocomplete-prompt/) walks the AST from cursor position to root, using LSP go-to-definition at each level to gather type definitions. They acknowledge that ["a problem with relying on the LSP to 'go to definition' is that we have little control over responsiveness"](https://docs.continue.dev/autocomplete/context-selection).

**Claude Code** represents true headless LSP: its [plugin system](https://code.claude.com/docs/en/plugins-reference) uses `.lsp.json` configuration files to spawn and manage language servers independently as a CLI tool, supporting 11+ languages with community-maintained [plugin bundles](https://github.com/Piebald-AI/claude-code-lsps). Before LSP integration, Claude Code relied on grep-based search (30–60s per query); with LSP, precise answers arrive in ~50ms.

### SCIP and LSIF as offline alternatives

[LSIF (Language Server Index Format)](https://microsoft.github.io/language-server-protocol/overviews/lsif/overview/), announced in [February 2019](https://code.visualstudio.com/blogs/2019/02/19/lsif), lets language servers dump their knowledge into a static graph-based JSON index. The goal is ["rich code navigation without needing a local copy of the source code"](https://microsoft.github.io/language-server-protocol/specifications/lsif/0.4.0/specification/). LSIF uses the same data types as LSP but focuses on read-only navigation — no completions or diagnostics.

[**SCIP (SCIP Code Intelligence Protocol)**](https://sourcegraph.com/blog/announcing-scip), announced by Sourcegraph in June 2022, supersedes LSIF with a Protobuf-based format using human-readable symbol strings instead of opaque numeric IDs. SCIP indexes are [**8x smaller and 3x faster to process**](https://sourcegraph.com/blog/announcing-scip) than LSIF equivalents (per Don Stewart at Meta). The [SCIP repository](https://github.com/sourcegraph/scip) provides indexers for TypeScript (`scip-typescript`), Java, Python, Go, Rust, Ruby, and more.

The tradeoff matrix is clear. **Live LSP** provides full compiler accuracy with real-time updates across all features (completions, diagnostics, refactoring) but requires a heavy server process tied to a single workspace. **SCIP/LSIF** provides compiler-accurate navigation (definition, references, hover) from a lightweight pre-computed index that scales across repositories — Sourcegraph processes [thousands of uploads daily across 45k+ repos](https://sourcegraph.com/docs/code-search/code-navigation/precise_code_navigation) — but produces point-in-time snapshots with no support for completion or diagnostics. For web-based code browsing, SCIP is strictly superior. For real-time editing intelligence, live LSP remains necessary.

## ts-morph offers a fundamentally different model

[ts-morph](https://github.com/dsherret/ts-morph) (formerly ts-simple-ast) wraps the TypeScript Compiler API as an in-process library with [over 11 million npm downloads](https://www.npmjs.com/package/ts-morph). Unlike LSP's position-based request-response protocol, ts-morph gives **direct programmatic access to the AST, type system, and code manipulation**. You create a `Project`, add source files (or point to a `tsconfig.json`), and then navigate with methods like `sourceFile.getClassOrThrow("MyClass").getProperties()`. Every compiler node is wrapped with [helper methods](https://ts-morph.com/navigation/), and you can always access the raw compiler node via `.compilerNode`.

The most important difference: **ts-morph can modify code**. It supports arbitrary AST transformations — adding properties, renaming classes, generating entire source files from [structure objects](https://ts-morph.com/manipulation/performance), removing declarations. LSP only supports constrained mutations (rename symbol, organize imports, apply code actions). The [Codemod platform](https://codemod.com/blog/ts-morph-support) officially supports ts-morph as a codemod engine, and [Sourcegraph maintains a codemod toolkit](https://github.com/sourcegraph/codemod) powered by it.

For batch analysis, ts-morph is dramatically more efficient. It can iterate every symbol in every file synchronously, with zero IPC overhead. LSP requires one JSON-RPC round-trip per query position. For type introspection, ts-morph exposes the full TypeScript type checker — you can query `type.isUnion()`, `type.getProperties()`, generic parameters, conditional types. LSP returns only hover text, a string representation. As [one developer noted](https://news.ycombinator.com/item?id=42695511): "you can't use the LSP to determine all valid in-scope objects for an assignment... you'll need type analysis yourself."

The tradeoff: ts-morph is **TypeScript-only** and lacks LSP's incremental update optimization. After each code manipulation, ts-morph [re-parses the entire source file](https://ts-morph.com/manipulation/performance). The [documentation recommends](https://ts-morph.com/manipulation/performance) a two-phase approach: analyze first, then manipulate. ts-morph's creator [explicitly recommends the raw TypeScript Compiler API](https://github.com/dsherret/ts-morph/issues/834) for plugin development, and the lighter [`@ts-morph/bootstrap`](https://github.com/dsherret/ts-morph) package exists for cases where you want easy project setup but plan to work with raw compiler nodes.

**Use ts-morph for**: codemods, code generation, custom static analysis rules, documentation extraction, architectural constraint checking. **Use headless LSP for**: real-time code intelligence, language-agnostic tooling, incremental feedback on edits, AI agent integration. They can complement each other — ts-morph for batch analysis in CI, LSP for real-time feedback.

## npm packages for building a headless LSP client

The [microsoft/vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node) monorepo contains six packages with critically different VS Code dependencies. **`vscode-languageclient`** ([npm](https://www.npmjs.com/package/vscode-languageclient)) is the full-featured LSP client for VS Code extensions — it **cannot be used outside VS Code** due to a [hard dependency on the `vscode` module](https://github.com/microsoft/vscode-languageserver-node/issues/542). Attempting to import it in a standalone Node.js process throws `Error: Cannot find module 'vscode'`.

The standalone building blocks are three packages lower in the stack. [**`vscode-jsonrpc`**](https://www.npmjs.com/package/vscode-jsonrpc) (~5.4M weekly downloads) provides JSON-RPC 2.0 over streams, **automatically handling `Content-Length` header framing** via `StreamMessageReader` and `StreamMessageWriter`. It has zero VS Code dependency. [**`vscode-languageserver-protocol`**](https://www.npmjs.com/package/vscode-languageserver-protocol) (~8M weekly downloads) layers all LSP type definitions on top — `InitializeRequest`, `HoverRequest`, `DefinitionRequest`, `TextDocumentPositionParams`, and every other protocol type. Its [README explicitly states](https://github.com/microsoft/vscode-languageserver-node/tree/main/protocol): "This npm module is a tool independent implementation of the language server protocol and can be used in any type of node application." [**`vscode-languageserver-types`**](https://www.npmjs.com/package/vscode-languageserver-types) provides just the data structures (`Range`, `Position`, `Location`, `SymbolKind`).

The recommended pattern for a headless client combines `vscode-jsonrpc/node` and `vscode-languageserver-protocol`:

```typescript
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { InitializeRequest, DidOpenTextDocumentNotification, HoverRequest } from 'vscode-languageserver-protocol';
import * as cp from 'child_process';

const server = cp.spawn('typescript-language-server', ['--stdio']);
const connection = createMessageConnection(
  new StreamMessageReader(server.stdout),
  new StreamMessageWriter(server.stdin)
);
connection.listen();

const result = await connection.sendRequest(InitializeRequest.type, {
  processId: process.pid,
  rootUri: 'file:///path/to/project',
  capabilities: {}
});
connection.sendNotification('initialized', {});
```

For a higher-level alternative, [**`ts-lsp-client`**](https://github.com/ImperiumMaximus/ts-lsp-client) (~15K weekly downloads) is a purpose-built standalone LSP client with minimal dependencies, [explicitly designed](https://www.npmjs.com/package/ts-lsp-client) as "a standalone library with minimal dependencies in contrast to the official one implemented by MS which depends on VSCode node libraries." It wraps the JSON-RPC transport and exposes LSP methods directly. For WebSocket transport, [**`vscode-ws-jsonrpc`**](https://github.com/TypeFox/vscode-ws-jsonrpc) from TypeFox provides JSON-RPC over WebSocket connections.

A minimal client must handle several non-obvious requirements: responding to server-initiated requests like `workspace/configuration` and `window/logMessage`, managing the document lifecycle (every file must be explicitly opened with `textDocument/didOpen` including full text content before any queries), and implementing the `shutdown`/`exit` sequence for clean teardown.

## Conclusion

Headless LSP is viable but demands careful engineering around a protocol designed for interactive editors. For TypeScript specifically, **`typescript-language-server` over stdio with `vscode-jsonrpc` + `vscode-languageserver-protocol`** is the most practical stack today — it provides standards-compliant access to definition, references, symbols, and hover without VS Code dependencies. Expect **3–30 second cold starts** and **300 MB–3 GB memory** for projects in the 500–2000 file range, with warm query latency from 10ms to several seconds depending on operation type and project complexity.

The landscape is shifting in three directions. **TypeScript 7's native Go-based LSP** will deliver 8–10x performance improvements when it arrives in 2026, making headless LSP dramatically more practical for large codebases. **SCIP** has emerged as the clear winner for offline/batch code intelligence at scale, offering compiler-accurate navigation without the resource cost of a live server. And **ts-morph** remains the right tool when you need what LSP fundamentally cannot provide: direct AST access, programmatic code transformation, and deep type system introspection. The most sophisticated systems — Cursor's Shadow Workspace, Sourcegraph's SCIP pipeline, Claude Code's plugin architecture — demonstrate that production-grade code intelligence increasingly requires combining these approaches rather than relying on any single one.

---

## Bibliography

| Source | URL | Contribution |
|--------|-----|-------------|
| LSP Specification v3.17 | https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ | Definitive protocol reference for all request types, message formats, and capability negotiation |
| LSP Overview | https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/ | High-level protocol architecture and wire format examples |
| typescript-language-server GitHub | https://github.com/typescript-language-server/typescript-language-server | Primary TypeScript LSP wrapper: architecture, configuration, supported features |
| typescript-language-server Configuration Docs | https://github.com/typescript-language-server/typescript-language-server/blob/master/docs/configuration.md | Detailed initializationOptions and server configuration reference |
| tsserver Wiki | https://github.com/microsoft/TypeScript/wiki/Standalone-Server-(tsserver) | Custom protocol documentation, command reference, communication format |
| tsserver Protocol Source | https://github.com/microsoft/TypeScript/blob/main/src/server/protocol.ts | Authoritative protocol type definitions for tsserver commands |
| TypeScript Native Port Announcement | https://devblogs.microsoft.com/typescript/typescript-native-port/ | Official benchmarks for current JS and upcoming Go compiler performance |
| TypeScript Performance Wiki | https://github.com/microsoft/TypeScript/wiki/Performance | Microsoft's guidance on scaling TypeScript for large codebases |
| TypeScript Issue #46028 | https://github.com/microsoft/TypeScript/issues/46028 | Memory consumption data for empty and small projects |
| TypeScript Issue #40138 | https://github.com/microsoft/TypeScript/issues/40138 | Performance reports for 200K+ LOC projects |
| TypeScript Issue #39144 | https://github.com/microsoft/TypeScript/issues/39144 | Project references startup delay (22-second `updateOpen`) |
| TypeScript Issue #49633 | https://github.com/microsoft/TypeScript/issues/49633 | 68-second `updateGraphWorker` in large monorepos |
| TypeScript Issue #19458 | https://github.com/Microsoft/TypeScript/issues/19458 | Query latency measurements (completion times) |
| Optimizing tsc (swatinem.de) | https://swatinem.de/blog/optimizing-tsc/ | Memory profiling, AST node costs, dependency impact analysis |
| Deno LSP Optimization Blog | https://deno.com/blog/optimizing-our-lsp | Auto-completion latency before/after optimization (6–8s → <1s) |
| vtsls GitHub | https://github.com/yioneko/vtsls | Alternative TypeScript LSP wrapping VS Code extension code |
| Zed TypeScript Docs | https://zed.dev/docs/languages/typescript | Memory defaults (8 GB) for TypeScript LSP |
| Matklad — "LSP could have been better" | https://matklad.github.io/2023/10/12/lsp-could-have-been-better.html | Architectural critique of LSP's widget-oriented design |
| michaelpj — "LSP: the good, the bad, and the ugly" | https://www.michaelpj.com/blog/2024/09/03/lsp-good-bad-ugly.html | State synchronization and causality problems in LSP |
| Cursor Shadow Workspace Blog | https://cursor.com/blog/shadow-workspace | Architecture for AI-driven headless LSP diagnostics |
| Sourcegraph — How Cody Understands Your Codebase | https://sourcegraph.com/blog/how-cody-understands-your-codebase | SCIP-based code intelligence architecture for AI context |
| Sourcegraph Cody FAQ | https://github.com/sourcegraph/handbook/blob/main/content/departments/engineering/teams/cody/about-cody-faq.md | Cody's relationship to Sourcegraph search and code navigation |
| Continue.dev LSP Context Integration | https://deepwiki.com/continuedev/continue/6.6-lsp-context-integration | Root Path Context strategy and LSP integration architecture |
| Continue.dev Blog — Root Path Context | https://blog.continue.dev/root-path-context-the-secret-ingredient-in-continues-autocomplete-prompt/ | Autocomplete prompt construction using LSP definitions |
| Claude Code Plugins Reference | https://code.claude.com/docs/en/plugins-reference | Native headless LSP plugin system for CLI tool |
| LSIF Overview | https://microsoft.github.io/language-server-protocol/overviews/lsif/overview/ | Language Server Index Format design and motivation |
| LSIF Specification 0.4.0 | https://microsoft.github.io/language-server-protocol/specifications/lsif/0.4.0/specification/ | Graph-based format with vertices/edges, project configuration |
| VS Code LSIF Announcement | https://code.visualstudio.com/blogs/2019/02/19/lsif | Original LSIF launch blog with design rationale |
| Sourcegraph — Announcing SCIP | https://sourcegraph.com/blog/announcing-scip | SCIP design, 8x size reduction vs LSIF, Protobuf schema |
| SCIP GitHub Repository | https://github.com/sourcegraph/scip | Protocol definition, CLI tooling, available indexers |
| Sourcegraph Precise Code Navigation | https://sourcegraph.com/docs/code-search/code-navigation/precise_code_navigation | Production SCIP deployment at scale |
| ts-morph GitHub | https://github.com/dsherret/ts-morph | Library architecture, API design, @ts-morph/bootstrap |
| ts-morph npm | https://www.npmjs.com/package/ts-morph | Usage examples, download statistics, feature overview |
| ts-morph Navigation Docs | https://ts-morph.com/navigation/ | AST traversal methods, language service access |
| ts-morph Manipulation Performance | https://ts-morph.com/manipulation/performance | Two-phase analysis pattern, structure-based generation |
| ts-morph Compiler Nodes | https://ts-morph.com/navigation/compiler-nodes | Bridge to raw TypeScript Compiler API |
| ts-morph Issue #834 | https://github.com/dsherret/ts-morph/issues/834 | Author's recommendation for when to use raw Compiler API |
| Codemod — ts-morph Support | https://codemod.com/blog/ts-morph-support | ts-morph as official codemod engine |
| vscode-languageserver-node GitHub | https://github.com/microsoft/vscode-languageserver-node | Monorepo containing all 6 LSP npm packages |
| vscode-languageclient npm | https://www.npmjs.com/package/vscode-languageclient | VS Code-specific LSP client (requires VS Code runtime) |
| vscode-languageserver-protocol npm | https://www.npmjs.com/package/vscode-languageserver-protocol | Standalone LSP type definitions, tool-independent |
| vscode-jsonrpc npm | https://www.npmjs.com/package/vscode-jsonrpc | Standalone JSON-RPC transport with Content-Length framing |
| vscode-languageserver-node Issue #542 | https://github.com/microsoft/vscode-languageserver-node/issues/542 | Confirmation that vscode-languageclient requires VS Code |
| ts-lsp-client GitHub | https://github.com/ImperiumMaximus/ts-lsp-client | Standalone LSP client with minimal dependencies |
| ts-lsp-client npm | https://www.npmjs.com/package/ts-lsp-client | Purpose-built alternative to VS Code-coupled client |
| vscode-ws-jsonrpc GitHub | https://github.com/TypeFox/vscode-ws-jsonrpc | JSON-RPC over WebSocket transport |
| Shopify — Project References Migration | https://shopify.engineering/migrating-large-typescript-codebases-project-references | Real-world scaling strategy for large TypeScript codebases |
| VS Code Language Server Extension Guide | https://code.visualstudio.com/api/language-extensions/language-server-extension-guide | Official tutorial for LSP client/server in VS Code |