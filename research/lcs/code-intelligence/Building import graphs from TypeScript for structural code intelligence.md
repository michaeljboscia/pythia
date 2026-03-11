# Building import graphs from TypeScript for structural code intelligence

**Import/dependency graphs extracted from TypeScript codebases are the most underused lever in code-aware RAG systems.** Three mature toolchains — madge, dependency-cruiser, and ts-morph — can produce these graphs today, but each makes different trade-offs between extraction completeness, rule expressiveness, and performance. For a typical 200-file TypeScript project, the resulting graph contains roughly 600–1,600 directed edges with a heavily right-skewed degree distribution, where barrel files create artificial hub nodes that inflate the graph by up to 3×. When this structural signal is combined with semantic retrieval, recent systems like CodexGraph and RepoFuse consistently outperform pure vector search — and Aider's production-proven PageRank-over-code-graphs approach demonstrates the technique works at scale.

## Three tools, three extraction strategies

The three dominant tools for extracting TypeScript import graphs each sit at a different point on the simplicity–power spectrum. **Madge** delegates parsing to a stack of `dependency-tree` → `precinct` → language-specific "detective" modules (e.g., [`detective-typescript`](https://github.com/pahen/madge) for `.ts` files) and resolution to `filing-cabinet`. It handles ES6 static imports, CommonJS `require()`, AMD, and re-exports out of the box, and it accepts a `tsConfig` option for path alias resolution. Its API is minimal: `.obj()` returns an adjacency list, `.circular()` finds cycles, and `.image()` renders via Graphviz. The core limitation is that dynamic imports with non-literal arguments produce `undefined` entries in the dependency list ([madge issue #157](https://github.com/pahen/madge/issues/157)), and there is no mechanism for architectural rule enforcement — madge detects problems but cannot codify policy.

**Dependency-cruiser** occupies the power-user end. It parses JavaScript with [acorn](https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md) (with swc and tsc as alternative parser options) and uses webpack's `enhanced-resolve` for module resolution. This architecture gives it the broadest import-type coverage of any tool: static imports, dynamic `import()` with string literals, `import type`, re-exports, triple-slash references, `process.getBuiltinModule()` (since v17.3.0), and even [JSDoc `@import` tags](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md) when paired with TypeScript ≥5.5. Since v16.0.0, it classifies every edge with fine-grained dependency types — `type-only`, `dynamic-import`, `aliased-tsconfig`, `export`, and [roughly 20 others](https://github.com/sverweij/dependency-cruiser/releases/tag/v16.0.0) — enabling rules like "flag circular dependencies only if the cycle contains non-type-only edges." Its `--collapse` option can aggregate modules to the folder level, which is essential for visualizing larger projects. The trade-off is memory: `enhanced-resolve`'s cache can consume gigabytes on very large codebases, though the `cacheDuration` option mitigates this ([dependency-cruiser FAQ](https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md)).

**ts-morph** takes a different approach entirely. Rather than being a dedicated graph tool, it wraps the TypeScript compiler API and exposes import/export analysis as first-class operations. The critical method for graph building is [`importDeclaration.getModuleSpecifierSourceFile()`](https://ts-morph.com/details/imports), which resolves an import specifier to the actual `SourceFile` using the compiler's own module resolution — automatically handling path aliases, `baseUrl`, and all resolution modes. For reverse dependencies, `sourceFile.getReferencingSourceFiles()` returns every file that imports the target, covering static imports, export declarations, and [dynamic `import()` calls](https://ts-morph.com/details/source-files). The `getExportedDeclarations()` method follows `export * from` chains transitively, making it barrel-file-aware, though this operation [can take ~1 second even for small files](https://github.com/dsherret/ts-morph/issues/644) with deep re-export chains. ts-morph provides no built-in graph data structure ([issue #679](https://github.com/dsherret/ts-morph/issues/679) requested one), so you must iterate source files and accumulate edges yourself. For raw performance on large codebases, calling [`ts.resolveModuleName()`](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) directly with a `ModuleResolutionCache` avoids ts-morph's wrapper-object overhead entirely.

All three tools share a fundamental limitation: **dynamic imports with computed specifiers** (e.g., `import(pathVariable)`) cannot be statically resolved. This affects lazy-loaded routes, plugin architectures, and locale-loading patterns. The practical impact is that any import graph built from static analysis will undercount edges in codebases that rely heavily on dynamic loading.

## What the graph actually looks like at 200 files

Import graphs are sparse directed graphs. Software dependency graphs are [classified alongside road networks and social networks](https://web.engr.oregonstate.edu/~huanlian/algorithms_course/3-graph/classify_represent.html) where |E| = O(|V|), not O(|V|²). In a typical 200-file TypeScript project, each file has **3–8 import statements**, yielding roughly **600–1,600 directed edges** — a graph density of only 1.5–4%. An adjacency-list (or `Map<string, Set<string>>`) representation is the natural fit; an adjacency matrix would waste 40,000 cells for ~1,000 non-zero entries.

The degree distribution is heavily right-skewed. Most files have a fan-in of 1–5 and a fan-out of 2–8. A small number of hub files — typically `utils.ts`, `types.ts`, `constants.ts`, and barrel files — accumulate fan-in of **20–50+** in a 200-file project. The [`ts-dependency-graph`](https://github.com/PSeitz/ts-dependency-graph) tool has a `--hotspots` flag specifically designed to identify these high-degree nodes. The [deprank](https://github.com/codemix/deprank) project takes this further, running PageRank on the dependency-cruiser output to rank files by structural importance — useful for prioritizing TypeScript migration in JavaScript codebases.

**Barrel files distort this topology dramatically.** A barrel `index.ts` that re-exports 20 sibling modules has fan-out of 20, and if 50 consumers import from it, fan-in of 50 — making it the highest-degree node in the graph despite containing no logic. Cascading barrels amplify this exponentially. [Vercel documented](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) that popular libraries can have up to **10,000 re-exports** in their entry barrel, and recursive barrels with 4 levels × 10 exports produced 10,000 modules that took ~30 seconds to compile. TkDodo reported that in a Next.js project, pages were loading **11,000 modules** that dropped to **3,500** (a 68% reduction) after [removing internal barrel files](https://tkdodo.eu/blog/please-stop-using-barrel-files). Most dramatically, [Atlassian's Jira frontend team](https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files) achieved **75% faster builds** after systematically removing barrel files from their thousands-of-packages codebase, where chains of barrel-to-barrel imports forced tools to process hundreds of unnecessary modules for every single import.

For graph construction, the practical recommendation is to either collapse barrel files into their re-export targets (treating `import { X } from './feature'` as a direct edge to the file that defines `X`) or to annotate barrel edges distinctly. Dependency-cruiser's `--collapse` flag does the former automatically. ts-morph's `getExportedDeclarations()` can resolve through barrels to find the ultimate source, though at a performance cost.

**Circular dependencies** are best detected with Tarjan's strongly connected components algorithm at O(V + E) time complexity. A [pull request to `circular-dependency-plugin`](https://github.com/aackerman/circular-dependency-plugin/pull/49) documented that the previous naive DFS approach was effectively quadratic, taking ~1 second for 5,500 modules; switching to Tarjan's made detection imperceptible. The most common circular pattern in TypeScript is barrel-file-induced: a module inside a directory imports from its own `index.ts`, which re-exports that same module. Dependency-cruiser's `viaOnly` restriction lets you [ignore type-only cycles](https://github.com/sverweij/dependency-cruiser/releases/tag/v16.0.0), which are harmless at runtime since `import type` statements are erased during compilation.

## Import graphs as a RAG retrieval signal

Pure semantic search retrieves code that *looks similar* to a query. Structural retrieval finds code that is *connected* to the query target. The most compelling evidence that these are complementary comes from the STALL+ study, which found that **static analysis integration outperforms pure RAG** for repository-level code completion because dependency context provides full parameter information that similarity-based retrieval misses ([STALL+ paper](https://mingwei-liu.github.io/assets/pdf/arxiv2024STALL.pdf)).

[Aider's repository map](https://aider.chat/2023/10/22/repomap.html) is the most production-tested implementation of this idea. It builds a [NetworkX `MultiDiGraph`](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping) where nodes are file paths and edges represent shared identifiers between files — if file A defines `processOrder` and file B references it, an edge connects them. Aider then runs **PageRank with personalization**: files currently in the chat context receive a personalization weight of +100, mentioned identifiers get a ×10 edge multiplier, and private symbols (prefixed with `_`) are dampened by ×0.1. The algorithm distributes each node's rank across its outgoing edges proportionally to weight, producing a ranked list of (file, identifier) pairs. A binary search then finds the maximum number of these pairs that fit within a token budget (default 1,024 tokens), and tree-sitter extracts the relevant code lines for each. This gives the LLM a compressed but structurally-informed view of the entire codebase.

The key insight for RAG is that **import chains provide transitive context that embedding similarity cannot**. When a user asks about `handlePayment()`, an import graph immediately reveals that it calls `validateCard()` from `validation.ts` and `chargeStripe()` from `billing.ts`, and that it is called by `checkoutController()` in `routes.ts`. Pure vector search might surface `processRefund()` (semantically similar but structurally unrelated) while missing `validateCard()` (semantically distant but a direct dependency). The [AST-Derived Graph-RAG paper](https://arxiv.org/pdf/2601.08773) formalized this with bidirectional graph expansion: when a retrieved class implements an interface, the system additionally pulls in consumers of that interface, crossing abstraction boundaries that embedding search cannot see.

Several recent systems operationalize this fusion. [RepoFuse](https://arxiv.org/html/2402.14323v2) explicitly combines "rationale context" (derived from import analysis — what constructs are available via imports) with "analogy context" (traditional similarity retrieval), using rank-truncated generation to fit within token budgets. [CodexGraph](https://arxiv.org/html/2408.03910v2) stores code structure in a Neo4j property graph with nodes for modules, classes, and functions, then lets an LLM agent compose Cypher queries for multi-hop structural retrieval — achieving **27.9% exact match** on CrossCodeEval versus 21.2% for the best embedding baseline. [DraCo](https://arxiv.org/html/2405.19782) extends this with type-sensitive dependency relations, building a repo-specific context graph where edges represent `contains`, `depends`, and `inherits` relationships, then retrieving background knowledge rather than similar snippets.

The practical architecture for a TypeScript code intelligence system is therefore a hybrid: use dependency-cruiser or ts-morph to extract the import graph at index time, store it as an adjacency list alongside chunk embeddings, and at query time perform a two-phase retrieval — semantic search to identify seed files, then **k-hop graph expansion** along import edges to gather structural context. This mirrors the approach used by the [Code-Graph-RAG](https://github.com/vitali87/code-graph-rag) open-source system, which combines tree-sitter parsing, a Memgraph knowledge graph, and UniXcoder embeddings in a hybrid retrieval strategy. The graph expansion step is cheap (a BFS over a sparse adjacency list is effectively O(k × average_degree)) and provides context that no amount of embedding refinement can replicate.

## Conclusion

The tooling for extracting TypeScript import graphs is mature but fragmented. Dependency-cruiser offers the richest extraction with **30+ dependency types** and architectural rule enforcement; ts-morph provides compiler-grade resolution through `getModuleSpecifierSourceFile()` and transitive barrel resolution via `getExportedDeclarations()`; madge remains the quickest path to a basic adjacency list. The resulting graphs are sparse (3–8× edge-to-node ratio), hub-dominated (barrel files and utilities concentrate edges), and most efficiently stored as adjacency sets. For code intelligence, the graph's unique contribution is *transitive structural context* — import chains, reverse dependents, and interface crossings that embedding similarity fundamentally cannot capture. The strongest current evidence suggests that combining structural graph expansion with semantic retrieval yields meaningfully better results than either alone, and that PageRank-style importance ranking (as demonstrated by Aider) is an effective way to compress a full-codebase graph into a token-limited context window.

## Bibliography

1. **madge — GitHub repository and npm documentation**
   URL: https://github.com/pahen/madge
   Key contribution: Widely-adopted tool for generating visual module dependency graphs and detecting circular dependencies in JS/TS/CSS codebases, using the `dependency-tree` → `precinct` → `detective-*` parser stack.

2. **dependency-cruiser — GitHub repository**
   URL: https://github.com/sverweij/dependency-cruiser
   Key contribution: Rule-based dependency validation and visualization tool supporting 30+ dependency type classifications, fine-grained circular dependency detection with `viaOnly` restrictions, and multiple output formats including interactive HTML and Mermaid.

3. **dependency-cruiser options reference**
   URL: https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md
   Key contribution: Detailed documentation of parser options (acorn/swc/tsc), `tsPreCompilationDeps`, `detectJSDocImports`, and `enhancedResolveOptions` for TypeScript path alias resolution.

4. **dependency-cruiser FAQ**
   URL: https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md
   Key contribution: Performance tuning guidance for large codebases, explanation of transpiler peer dependency model, and dynamic import handling limitations.

5. **ts-morph — Imports documentation**
   URL: https://ts-morph.com/details/imports
   Key contribution: API reference for `getImportDeclarations()`, `getModuleSpecifierSourceFile()`, and `getModuleSpecifierValue()` — the core methods for building import graphs from the TypeScript compiler API.

6. **ts-morph — Exports documentation**
   URL: https://ts-morph.com/details/exports
   Key contribution: Documentation of `getExportedDeclarations()` which transitively resolves through re-export chains and barrel files, and `getModuleSpecifierSourceFile()` on export declarations.

7. **ts-morph — Source Files documentation**
   URL: https://ts-morph.com/details/source-files
   Key contribution: Documentation of `getReferencedSourceFiles()` and `getReferencingSourceFiles()` methods covering forward and reverse dependencies including dynamic imports.

8. **ts-morph issue #679 — "How to use ts-morph to make TypeScript dependency graph?"**
   URL: https://github.com/dsherret/ts-morph/issues/679
   Key contribution: Confirms ts-morph does not provide a built-in dependency graph API; users must build graphs by iterating source files.

9. **ts-morph issue #644 — getExportedDeclarations performance**
   URL: https://github.com/dsherret/ts-morph/issues/644
   Key contribution: Documents that `getExportedDeclarations()` can be slow (~1 second for small files with re-export chains), relevant to barrel file resolution performance.

10. **TypeScript Compiler API — Using the Compiler API (wiki)**
    URL: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
    Key contribution: Official documentation for `ts.resolveModuleName()`, `ModuleResolutionCache`, and the `ResolvedModuleWithFailedLookupLocations` return type.

11. **Aider — "Building a better repository map with tree sitter"**
    URL: https://aider.chat/2023/10/22/repomap.html
    Key contribution: Describes Aider's approach of using tree-sitter to extract code definitions and references, building a file-level dependency graph, and applying personalized PageRank to rank files for LLM context.

12. **Aider — Repository Mapping (DeepWiki)**
    URL: https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping
    Key contribution: Detailed technical analysis of Aider's `RepoMap` class including NetworkX `MultiDiGraph` construction, PageRank edge weight multipliers, personalization vectors, and binary-search token budgeting.

13. **Vercel — "How we optimized package imports in Next.js"**
    URL: https://vercel.com/blog/how-we-optimized-package-imports-in-next-js
    Key contribution: Documents that popular libraries can have up to 10,000 re-exports in barrel files, that recursive barrels take ~30s to compile, and that `optimizePackageImports` achieves 40% faster cold boots and 28% faster builds.

14. **TkDodo — "Please Stop Using Barrel Files"**
    URL: https://tkdodo.eu/blog/please-stop-using-barrel-files
    Key contribution: Reports a 68% module reduction (11,000 → 3,500) after removing internal barrel files in a Next.js project, and documents the barrel-file-induced circular import pattern.

15. **Atlassian — "How We Achieved 75% Faster Builds by Removing Barrel Files"**
    URL: https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files
    Key contribution: Large-scale case study of barrel file removal in Jira's frontend codebase (thousands of packages), achieving 75% faster builds and dramatically improved TypeScript tooling responsiveness.

16. **circular-dependency-plugin — PR #49 (Tarjan's SCC)**
    URL: https://github.com/aackerman/circular-dependency-plugin/pull/49
    Key contribution: Documents the performance improvement from switching circular dependency detection from naive DFS (quadratic) to Tarjan's SCC (linear), reducing detection time from ~1 second to imperceptible for 5,500 modules.

17. **deprank — GitHub repository**
    URL: https://github.com/codemix/deprank
    Key contribution: Applies PageRank to dependency-cruiser output to rank files by structural importance, useful for TypeScript migration prioritization.

18. **CodexGraph (Liu et al., 2024)**
    URL: https://arxiv.org/html/2408.03910v2
    Key contribution: Integrates LLM agents with Neo4j code property graphs for multi-hop structural retrieval via Cypher queries, achieving 27.9% exact match on CrossCodeEval vs. 21.2% for best baseline.

19. **RepoFuse (Liang et al., 2024)**
    URL: https://arxiv.org/html/2402.14323v2
    Key contribution: Fuses import-derived "rationale context" with similarity-based "analogy context" using rank-truncated generation for repository-level code completion.

20. **DraCo (Cheng et al., 2024)**
    URL: https://arxiv.org/html/2405.19782
    Key contribution: Extends dataflow analysis with type-sensitive dependency relations, building repo-specific context graphs with `contains`, `depends`, and `inherits` edges for background knowledge retrieval.

21. **AST-Derived Reliable Graph-RAG**
    URL: https://arxiv.org/pdf/2601.08773
    Key contribution: Compares LLM-generated vs. AST-derived code graphs for RAG, finding that deterministic compiler-inspired graphs are complete and reliable, and that bidirectional graph expansion crosses interface boundaries.

22. **STALL+ — Static analysis integration for code completion**
    URL: https://mingwei-liu.github.io/assets/pdf/arxiv2024STALL.pdf
    Key contribution: Finds that static analysis integration (file-level dependency context) outperforms pure RAG for repository-level code completion.

23. **Code-Graph-RAG — GitHub repository**
    URL: https://github.com/vitali87/code-graph-rag
    Key contribution: Open-source hybrid retrieval system combining tree-sitter parsing, Memgraph knowledge graph, and UniXcoder embeddings with semantic-first, graph-first, and hybrid retrieval strategies.

24. **Oregon State University — Graph classification and representation**
    URL: https://web.engr.oregonstate.edu/~huanlian/algorithms_course/3-graph/classify_represent.html
    Key contribution: Classifies software dependency graphs as sparse directed graphs where |E| = O(|V|), supporting adjacency-list representation.