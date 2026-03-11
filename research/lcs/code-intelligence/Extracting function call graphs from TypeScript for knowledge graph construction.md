# Extracting function call graphs from TypeScript for knowledge graph construction

**Building a precise function-level call graph from a TypeScript codebase requires navigating a fundamental tradeoff between speed and semantic accuracy.** Two dominant approaches exist: syntactic extraction via [tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript), which parses fast but resolves nothing, and type-aware extraction via the [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), which leverages `ts.TypeChecker` to resolve call targets through the full type system. The right choice depends on whether you need a rapid, approximate graph or a precise one suitable for security analysis or refactoring tools. This analysis covers both approaches in depth, examines TypeScript-specific complications, surveys the existing tool landscape, and proposes a concrete property graph schema for storing call edges at scale.

## The TypeScript Compiler API provides type-resolved call detection

The highest-fidelity approach to call graph extraction uses the TypeScript compiler's own type checker. The core workflow begins with [`ts.createProgram`](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), which parses all source files and builds a full program representation including type information. From the `Program`, you obtain a `TypeChecker` instance — the same engine that powers IDE features like "Go to Definition" and "Find All References."

The canonical pattern for resolving a `CallExpression` to its target declaration works in two steps. First, walk the AST using `ts.forEachChild` to find every node where `ts.isCallExpression(node)` returns true. Second, resolve what function is actually being called:

```typescript
const program = ts.createProgram(rootFiles, compilerOptions);
const checker = program.getTypeChecker();

function visit(node: ts.Node) {
  if (ts.isCallExpression(node)) {
    const symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol) {
      const resolved = (symbol.flags & ts.SymbolFlags.Alias)
        ? checker.getAliasedSymbol(symbol)
        : symbol;
      const declarations = resolved.getDeclarations();
      // declarations[0] is the target FunctionDeclaration or MethodDeclaration
    }
  }
  ts.forEachChild(node, visit);
}
```

The key method here is [`getSymbolAtLocation`](https://typestrong.org/typedoc-auto-docs/typedoc/interfaces/TypeScript.TypeChecker.html), which retrieves the `ts.Symbol` associated with any AST node. For imported functions, the symbol initially points to the import alias; calling [`getAliasedSymbol`](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) follows the alias chain back to the original declaration. An alternative approach uses [`getResolvedSignature`](https://github.com/Microsoft/TypeScript/issues/20051), which returns a `ts.Signature` whose `getDeclaration()` method yields the target — this is particularly useful for overloaded functions, since it resolves to the specific overload selected by the type checker.

**A known pitfall**: `getSymbolAtLocation` sometimes returns `undefined` even when an internal `.symbol` property exists on the node. This is [TypeScript issue #5218](https://github.com/Microsoft/TypeScript/issues/5218), and the common workaround is to access `(node as any).symbol` directly, though this uses an unstable internal API.

The [ts-morph](https://github.com/dsherret/ts-morph) library wraps the compiler API with a more ergonomic interface. Its [`findReferences`](https://ts-morph.com/navigation/finding-references) and `findReferencesAsNodes` methods provide a simpler way to discover all call sites for a given function declaration. You can also use `getDescendantsOfKind(SyntaxKind.CallExpression)` to find all call expressions in a file, then resolve each via `expression.getSymbol()`. However, ts-morph has its own limitations: [issue #798](https://github.com/dsherret/ts-morph/issues/798) documents that `findReferences` does not find "second-hand" references — when a function is assigned to a property, references to the property aren't returned as references to the original function. And [issue #582](https://github.com/dsherret/ts-morph/issues/582) reports that barrel export chains can cause incomplete results.

TypeScript 3.8+ also added a [Call Hierarchy API](https://typestrong.org/typedoc-auto-docs/typedoc/interfaces/TypeScript.LanguageService.html) to the Language Service: `prepareCallHierarchy`, `provideCallHierarchyIncomingCalls`, and `provideCallHierarchyOutgoingCalls`. These are the same APIs that power the "Call Hierarchy" feature in VS Code. They provide a ready-made solution for point queries ("who calls this function?" or "what does this function call?"), but building a full project-wide call graph requires iterating over every function declaration and querying incoming/outgoing calls for each — which can be slow on large codebases since the Language Service wasn't designed for bulk extraction.

**Performance characteristics** of the compiler API approach: creating a `Program` is expensive. It parses all files, resolves all imports, and builds the full type graph. For a **50,000-line TypeScript project**, expect initialization to take 2–8 seconds depending on `node_modules` inclusion and tsconfig complexity. AST walking itself is fast — the per-node overhead of `getSymbolAtLocation` is microseconds, but the cumulative cost of resolving tens of thousands of call expressions adds up. A [gentle introduction to the compiler API](https://www.january.sh/posts/gentle-introduction-to-typescript-compiler-api) notes that obtaining a `Program` is "much more resource-heavy than obtaining a simple `SourceFile`," so any approach that doesn't need type information should avoid it.

## Tree-sitter trades semantic precision for raw speed

[Tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript) provides an alternative: parse the source into a concrete syntax tree without any type resolution. The grammar extends [tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript) with TypeScript-specific node types for generics, type annotations, enums, and decorators. The key AST nodes for call extraction are `call_expression` (with a `function` field pointing to the callee) and `new_expression` (for constructor calls).

S-expression queries provide a declarative way to extract call sites:

```scheme
;; Simple function calls: foo()
(call_expression
  function: (identifier) @callee
  arguments: (arguments) @args)

;; Method calls: obj.method()
(call_expression
  function: (member_expression
    object: (identifier) @receiver
    property: (property_identifier) @method)
  arguments: (arguments) @args)

;; Constructor calls: new Foo()
(new_expression
  constructor: (identifier) @class_name)
```

These queries run against the parse tree and return matching nodes with their source positions. For chained calls like `builder.setX().setY().build()`, the AST nests `call_expression` nodes — the outer call's `function` field is a `member_expression` whose `object` is another `call_expression`. Tree-sitter's [query documentation](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) explains the pattern syntax, but as [Cycode's practical guide](https://cycode.com/blog/tips-for-using-tree-sitter-queries/) notes, deeply nested member expressions like `a.b.c.d.method()` become unwieldy in query form — programmatic tree walking is more practical for complex patterns.

Tree-sitter's **performance advantage is dramatic**. Benchmarks show it parses at roughly [50,000 lines in ~250ms](https://github.com/Idorobots/tree-sitter-vs-peg), and its LR(1)/GLR parsing algorithm guarantees O(n) time complexity. A [parser benchmark comparison](https://medium.com/@hchan_nvim/benchmark-typescript-parsers-demystify-rust-tooling-performance-025ebfd391a3) found tree-sitter competitive with TypeScript's own parser for large files. Its incremental parsing capability — where editing a file only re-parses the changed region — [can reduce parsing time by up to 70%](https://dasroot.net/posts/2026/02/incremental-parsing-tree-sitter-code-analysis/) for repeated analysis of evolving codebases.

The critical limitation is straightforward: **tree-sitter has no type information**. It cannot resolve which overload of a function is called. It cannot follow import aliases to their original declarations. It cannot determine that `x.method()` calls `ClassA.method` rather than `ClassB.method` when `x` is typed as a union. It produces only syntactic name strings — `"foo"` or `"obj.method"` — not resolved symbols. Even [GitHub's own code navigation](https://tomassetti.me/incremental-parsing-using-tree-sitter/), which uses tree-sitter, is described as providing only "partial symbol resolution." For call graph purposes, this means tree-sitter yields high recall (it finds every syntactic call site) but lower precision (it cannot distinguish calls to different functions with the same name).

## Precision and recall diverge sharply between approaches

The most rigorous empirical data on JavaScript/TypeScript call graph precision comes from [Antal et al.'s comparative study](https://arxiv.org/abs/2405.07206) (IEEE SCAM 2018, extended 2024), which evaluated five static analysis tools against manually validated call edges across SunSpider benchmarks and real Node.js modules. The **ACG (Approximate Call Graph)** algorithm by [Feldthaus et al. (ICSE 2013)](https://ieeexplore.ieee.org/document/6606621/) achieved **>99% precision and >90% recall** — the best of any tool tested. TAJS (Type Analysis for JavaScript) reached 98% precision but lower recall. Combining ACG and TAJS captured 99% of all true edges at 98% combined precision.

These numbers establish an important baseline: even type-aware analysis with flow-sensitive algorithms doesn't achieve perfect recall on JavaScript, due to the language's inherent dynamism. A pure syntactic approach (tree-sitter) would have near-100% recall for syntactic call sites but significantly lower precision, since name-based matching conflates calls to different functions that share a name. The practical tradeoff looks like this:

- **Tree-sitter (syntactic)**: ~100% recall of syntactic call sites, but precision degrades with codebase size as name collisions increase. No cross-file resolution without a separate import analysis layer. Best for rapid prototyping, approximate graphs, or as a first pass.
- **TypeScript Compiler API (type-aware)**: High precision for statically resolvable calls (direct function calls, method calls with known receiver types). Recall drops for dynamic patterns — callbacks, computed property access, `apply`/`call`/`bind`. Best for precise analysis where correctness matters.
- **Jelly/ACG (flow analysis)**: The highest combined precision-recall, using points-to analysis and field-based flow. [Jelly](https://github.com/cs-au-dk/jelly) from Aarhus University is the current state of the art, backed by [five published papers](https://dl.acm.org/doi/10.1145/3460319.3464836) including work on [approximate interpretation (PLDI 2024)](https://dl.acm.org/doi/10.1145/3656424) and [indirection bounding (ECOOP 2024)](https://doi.org/10.4230/LIPIcs.ECOOP.2024.10) that yields **~2x speedup with only 5% recall reduction**.

## TypeScript's type system creates five distinct challenges

**Dynamic dispatch on union types** is perhaps the most pervasive complication. When a variable is typed as `A | B` and you call `x.process()`, the TypeScript type checker knows both `A` and `B` have a `process` method, but a static call graph must include edges to both implementations. Discriminated unions with a `kind` or `type` field can narrow this, but only with flow-sensitive analysis that tracks type guards through conditional branches — something `getSymbolAtLocation` does not do out of the box.

**Higher-order functions and callbacks** pervade TypeScript codebases. When `array.map(transform)` is called, the call graph should include an edge from `Array.prototype.map` to whatever `transform` resolves to. But `getSymbolAtLocation` on the `transform` argument gives you the symbol for the local variable, not the function it was assigned from. Tracing this requires points-to analysis — following the dataflow from the function definition through assignments and parameter passing to the call site. The [ACG algorithm](https://github.com/Persper/js-callgraph) handles this with field-based flow analysis, though it conflates properties with the same name across different objects.

**Method chaining** (fluent APIs) requires tracking return types through chains. In `builder.setName("x").setAge(30).build()`, each method returns `this` or a new builder type, and the call graph must resolve each chained method to the correct declaration. The TypeScript compiler handles this internally through `getResolvedSignature`, which resolves each call in the chain sequentially.

**Decorators** create implicit call edges invisible in the source. A `@Injectable()` decorator in Angular calls a factory function that wraps the class. A `@log` method decorator wraps the original method. These create edges from the decorator factory to the decorated entity and from call sites to the wrapper rather than the original — none of which appear as explicit `CallExpression` nodes in the AST.

**Generic type resolution** complicates analysis when generic functions constrain their behavior based on type parameters. A function `function process<T extends Handler>(handler: T)` has different possible call targets depending on what concrete type `T` is instantiated with. The TypeScript compiler resolves this at each call site, but building a project-wide call graph requires considering all instantiation sites.

## The tool landscape has a critical gap at function-level granularity

The most widely-used tools operate at **module level only**. [Madge](https://github.com/pahen/madge) (~5K GitHub stars) builds file-to-file dependency graphs from import/require statements, using the `dependency-tree` package internally. It supports TypeScript via a peer dependency and handles path aliases through tsconfig.json. [Dependency-cruiser](https://github.com/sverweij/dependency-cruiser) (1.1M+ weekly npm downloads) provides rule-based dependency validation with rich output formats including interactive HTML reports. Its [FAQ explicitly states](https://github.com/sverweij/dependency-cruiser): "Static analysis of classes, functions and methods and their dependencies is _very_ interesting to dive into, but it'd make dependency-cruiser a different tool altogether." [Skott](https://github.com/antoine-coulon/skott) is a newer alternative claiming **5–7.5x faster performance** than madge, using meriyah and typescript-estree for parsing.

None of these tools produce function-level call graphs. They answer "which files depend on which files" — useful for architecture visualization but insufficient for constructing a knowledge graph with `CALLS` edges between individual functions.

For **function-level extraction**, the landscape thins considerably. [Jelly](https://github.com/cs-au-dk/jelly) (Aarhus University, BSD-3-Clause, actively maintained through December 2025) is the clear state of the art. It performs flow-insensitive points-to analysis with access paths, outputs JSON call graphs, and even supports comparing static versus dynamic call graphs for precision measurement. Its `--max-indirections` flag enables scalability tuning. However, it is memory-intensive and analysis times can be significant for large projects with dependencies.

The [Persper/js-callgraph](https://github.com/Persper/js-callgraph) implements the original ACG algorithm and supports both JavaScript and TypeScript, but uses Esprima for parsing (limiting modern syntax support) and conflates like-named properties — `user.save()` and `document.save()` produce edges to the same target. [TypeScript-Call-Graph](https://github.com/whyboris/TypeScript-Call-Graph) is a basic CLI tool using the compiler API but provides only name-based matching without cross-file resolution.

For code property graphs that go beyond call graphs, the [Fraunhofer AISEC CPG library](https://github.com/Fraunhofer-AISEC/cpg) is the **only major CPG tool with explicit TypeScript support**, using TypeScript's own parser in its `cpg-language-typescript` module. [Joern](https://docs.joern.io/) is the gold standard for code property graph analysis in security contexts, supporting JavaScript (but not TypeScript natively) via its `jssrc2cpg` frontend.

## Representing call edges in a property graph at scale

The [Joern Code Property Graph specification v1.1](https://cpg.joern.io/) provides the most mature schema for representing code structure in a graph database. Its layered architecture separates AST nodes, control flow edges, call graph edges, and data dependence edges into distinct layers that can be queried independently. The `CALL` node type carries properties including `name`, `methodFullName`, `dispatchType` (either `STATIC_DISPATCH` or `DYNAMIC_DISPATCH`), `lineNumber`, and `columnNumber`. Joern [exports directly to Neo4j CSV format](https://docs.joern.io/export/) via `joern-export --repr=all --format=neo4jcsv`.

For a TypeScript-specific knowledge graph, a practical schema adapts these concepts. The [CodeGraph Analyzer](https://github.com/ChrisRoyse/CodeGraph) project demonstrates a working implementation using ts-morph for parsing and Neo4j for storage, with a two-pass architecture that first builds per-file ASTs and then resolves cross-file relationships. Similarly, [GraphAware's approach](https://graphaware.com/blog/graph-assisted-typescript-refactoring/) uses ts-morph to extract class/method structures and the Neo4j JavaScript driver to store them.

A recommended schema for `CALLS` edges:

```
(:Function {name, full_name, file_path, line_number, is_exported, is_async, parameter_count})
-[:CALLS {
    file_path,          // source file where call occurs
    line_number,        // exact line
    column_number,      // exact column
    is_dynamic,         // computed property access, eval, apply/call
    dispatch_type,      // "STATIC" or "DYNAMIC"
    argument_count,     // number of arguments at call site
    confidence          // 0.0-1.0 for uncertain resolutions
}]->
(:Function)
```

The `is_dynamic` flag marks edges that were resolved heuristically (e.g., matching by name rather than type resolution). The `confidence` score enables downstream consumers to filter uncertain edges. The `dispatch_type` distinguishes direct calls (where the target is statically known) from virtual calls on interfaces or union types.

**How many edges does a typical project produce?** The [comparative study by Antal et al.](https://arxiv.org/html/2405.07206v1) provides some grounding data: small benchmark programs (100–500 LOC) produce 10–50 call edges, while real-world Node.js modules produce hundreds. Extrapolating from these ratios and from enterprise code analysis research on [automated call graph discovery](https://arxiv.org/pdf/1610.04594), a **50,000-line TypeScript project** would likely produce **3,000–15,000 function-level call edges** depending on code density and framework usage. Angular/React projects with heavy decorator and component patterns tend toward the higher end. Module-level import edges are far fewer — typically 1,000–3,000 for a project with 500 files. Full code property graphs including AST nodes are vastly larger: a single 10-line function generates ~30–50 CPG nodes, so a 50K-line project could contain **millions of CPG nodes** if you store the full AST.

## A practical two-pass architecture maximizes both speed and precision

The most effective implementation combines both approaches. **Pass one** uses tree-sitter for rapid syntactic extraction: parse all files in parallel, extract every `call_expression` and `new_expression` with source positions, and build a preliminary graph with name-based edges. This pass completes in seconds even for large codebases, leveraging tree-sitter's [O(n) parsing guarantee](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html). **Pass two** uses `ts.createProgram` and the `TypeChecker` to refine ambiguous edges: resolve import aliases via `getAliasedSymbol`, disambiguate overloads via `getResolvedSignature`, and mark dynamic dispatch sites with `is_dynamic: true`. This pass is slower but focuses only on edges that need type resolution.

For the property graph storage layer, [Neo4j](https://neo4j.com/blog/developer/codebase-knowledge-graph/) remains the most common choice, with Cypher queries enabling powerful traversal patterns like "find all transitive callers of function X" or "identify all functions reachable from this entry point." [FalkorDB](https://www.falkordb.com/blog/code-graph-analysis-visualize-source-code/) (Redis-based, OpenCypher-compatible) offers significantly lower query latency for aggregate expansion queries. [Memgraph](https://github.com/vitali87/code-graph-rag) is used by the Code-Graph-RAG project for tree-sitter-based code graphs with semantic search integration.

The [IBM tree-sitter-codeviews (COMEX)](https://github.com/IBM/tree-sitter-codeviews) project from ASE 2023 demonstrates a declarative approach to extracting multiple code views (call graphs, data flow, program dependence) from tree-sitter parse trees, though it currently supports only Java and C#. The [tree-sitter-graph](https://github.com/tree-sitter/tree-sitter-graph) DSL offers a language-agnostic way to define graph construction rules over parse trees, which could be adapted for TypeScript call graph extraction.

## Conclusion

Three insights emerge from this analysis that aren't obvious from any single source. First, **the precision gap between syntactic and type-aware analysis is smaller than expected for well-structured TypeScript** — if your codebase follows consistent naming conventions and avoids heavy metaprogramming, name-based matching from tree-sitter gets you surprisingly far, and a separate import-resolution layer (which only requires parsing import statements, not full type checking) closes most of the remaining gap. Second, **the academic state of the art (Jelly) has advanced significantly beyond what most practitioners realize**, with the 2024 indirection-bounding technique making flow analysis practical for large codebases at roughly 2x the cost of simple AST walking. Third, **the real bottleneck in building a useful code knowledge graph is not call graph extraction but edge classification** — knowing that function A calls function B is less valuable than knowing whether that call is a direct invocation, a callback registration, a decorator application, or a dynamic dispatch. The `dispatch_type`, `is_dynamic`, and `confidence` properties on `CALLS` edges are what transform a flat call graph into a queryable knowledge structure.

## Bibliography

| Source | URL | Key contribution |
|--------|-----|-----------------|
| TypeScript Compiler API Wiki | https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API | Official documentation for ts.createProgram, TypeChecker, AST traversal |
| ts-morph Finding References | https://ts-morph.com/navigation/finding-references | findReferences and findReferencesAsNodes API documentation |
| ts-morph Type Checker | https://ts-morph.com/navigation/type-checker | TypeChecker wrapper API and symbol resolution |
| ts-morph GitHub | https://github.com/dsherret/ts-morph | Source repository; issues #798, #582, #105 document findReferences limitations |
| TypeScript TypeChecker Interface | https://typestrong.org/typedoc-auto-docs/typedoc/interfaces/TypeScript.TypeChecker.html | Complete method listing for TypeChecker |
| TypeScript LanguageService Interface | https://typestrong.org/typedoc-auto-docs/typedoc/interfaces/TypeScript.LanguageService.html | Call hierarchy API methods (TS 3.8+) |
| Resolving CallExpression (TS Issue #20051) | https://github.com/Microsoft/TypeScript/issues/20051 | Canonical pattern for resolving call targets via getSymbolAtLocation |
| getSymbolAtLocation bug (TS Issue #5218) | https://github.com/Microsoft/TypeScript/issues/5218 | Known issue where getSymbolAtLocation returns undefined |
| tree-sitter-typescript | https://github.com/tree-sitter/tree-sitter-typescript | Grammar definition, node types for call expressions |
| Tree-sitter Query Syntax | https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html | S-expression query pattern documentation |
| Cycode Tree-sitter Query Tips | https://cycode.com/blog/tips-for-using-tree-sitter-queries/ | Practical limitations of query-based extraction for nested patterns |
| Tree-sitter Parser Benchmark | https://medium.com/@hchan_nvim/benchmark-typescript-parsers-demystify-rust-tooling-performance-025ebfd391a3 | Performance comparison of TypeScript parsers |
| tree-sitter-graph | https://github.com/tree-sitter/tree-sitter-graph | DSL for constructing graphs from tree-sitter parse trees |
| IBM COMEX / tree-sitter-codeviews | https://github.com/IBM/tree-sitter-codeviews | Multi-view code graph extraction (ASE 2023) |
| Feldthaus et al., "Efficient Construction of Approximate Call Graphs for JavaScript IDE Services" | https://ieeexplore.ieee.org/document/6606621/ | ACG algorithm (ICSE 2013); foundational field-based flow analysis |
| Antal et al., "Static JavaScript Call Graphs: a Comparative Study" | https://arxiv.org/abs/2405.07206 | Precision/recall benchmarks for five JS call graph tools (SCAM 2018) |
| Nielsen et al., "JAM: Modular Call Graph Construction" | https://dl.acm.org/doi/10.1145/3460319.3464836 | Modular analysis with access paths (ISSTA 2021); foundation for Jelly |
| Laursen et al., "Reducing Static Analysis Unsoundness with Approximate Interpretation" | https://dl.acm.org/doi/10.1145/3656424 | Approximate interpretation technique (PLDI 2024) |
| Chakraborty et al., "Indirection-Bounded Call Graph Analysis" | https://doi.org/10.4230/LIPIcs.ECOOP.2024.10 | Scalability via indirection bounding (ECOOP 2024); 2x speedup, 5% recall loss |
| Jelly | https://github.com/cs-au-dk/jelly | State-of-the-art JS/TS call graph tool from Aarhus University |
| Persper/js-callgraph (ACG implementation) | https://github.com/Persper/js-callgraph | Field-based call graph construction for JS/TS |
| TypeScript-Call-Graph | https://github.com/whyboris/TypeScript-Call-Graph | Basic CLI tool using TypeScript compiler API |
| Madge | https://github.com/pahen/madge | Module-level dependency graph tool |
| dependency-cruiser | https://github.com/sverweij/dependency-cruiser | Rule-based module dependency validation |
| Skott | https://github.com/antoine-coulon/skott | Fast module-level dependency graph (5-7x faster than madge) |
| Joern CPG Specification | https://cpg.joern.io/ | Code Property Graph schema v1.1; node/edge type definitions |
| Joern Documentation | https://docs.joern.io/ | CPG analysis platform; Neo4j CSV export |
| Fraunhofer AISEC CPG | https://github.com/Fraunhofer-AISEC/cpg | CPG library with explicit TypeScript support |
| CodeGraph Analyzer | https://github.com/ChrisRoyse/CodeGraph | ts-morph + Neo4j two-pass implementation |
| Neo4j Codebase Knowledge Graph | https://neo4j.com/blog/developer/codebase-knowledge-graph/ | Schema design for code → Neo4j ETL |
| GraphAware TS Refactoring | https://graphaware.com/blog/graph-assisted-typescript-refactoring/ | ts-morph to Neo4j integration pattern |
| Code-Graph-RAG | https://github.com/vitali87/code-graph-rag | Tree-sitter + Memgraph for code knowledge graphs |
| DZone Call Graph Tutorial | https://dzone.com/articles/call-graphs-code-exploration-tree-sitter | Tree-sitter to Neo4j/Memgraph pipeline |
| Gentle Intro to TS Compiler API | https://www.january.sh/posts/gentle-introduction-to-typescript-compiler-api | Practical guide to ts.createProgram setup |
| TS AST and TypeChecker | https://www.satellytes.com/blog/post/typescript-ast-type-checker/ | Symbol and Type interface explanation |
| Veenendaal et al., "Code Definition Analysis for Call Graph Generation" | https://arxiv.org/pdf/1610.04594 | Enterprise call graph metrics; 78.26% automated accuracy |