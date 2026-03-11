# CI-07: AST, Control Flow Graph, and Data Flow Fundamentals

A code intelligence system that understands TypeScript needs three foundational layers of program representation: the syntax tree for structural queries, the control flow graph for execution path reasoning, and data flow analysis for tracking how values move through code. **This document covers the theory and practical tooling behind each layer**, giving a senior developer the knowledge to select the right parsing strategy, construct or leverage control flow graphs, and choose a minimum viable analysis stack. The core architectural decision every code intelligence system faces — fast syntactic analysis via tree-sitter's Concrete Syntax Tree versus deep semantic analysis via the TypeScript compiler's Abstract Syntax Tree — is not an either/or choice but a layered one, and the right combination depends on which questions you need to answer.

## What tree-sitter actually produces, and why it matters

The distinction between a Concrete Syntax Tree and an Abstract Syntax Tree is foundational to choosing the right tool for any code analysis task. A CST preserves every token that appears in the source: keywords, punctuation, delimiters, and operators all exist as nodes in the tree. An AST abstracts away these syntactic details, keeping only the semantically meaningful structure. As [Eli Bendersky explains](https://eli.thegreenplace.net/2009/02/16/abstract-vs-concrete-syntax-trees), "CSTs are more concrete... they represent the input in a tree-like form, in the way it was parsed by the parser. ASTs are more abstract. They drop all the syntactic clutter and focus on the structure of the input."

Tree-sitter [explicitly produces a CST](https://github.com/tree-sitter/tree-sitter). Its README states it "builds a concrete syntax tree for a source file and efficiently updates the syntax tree as the source file is edited." For the JSON input `[1, null]`, the tree-sitter [documentation](https://tree-sitter.github.io/tree-sitter/using-parsers/1-getting-started.html) shows that the `array` node has **five children** — the bracket `[`, the number `1`, the comma `,`, the literal `null`, and the closing bracket `]` — but only **two named children** (the `number` and `null` nodes). The default S-expression output hides the anonymous nodes, displaying only `(document (array (number) (null)))`.

This reveals tree-sitter's critical architectural distinction: **named nodes versus anonymous nodes**. Named nodes correspond to explicitly named grammar rules (`function_declaration`, `identifier`, `binary_expression`) and carry semantic meaning. Anonymous nodes correspond to literal string tokens in the grammar (`"if"`, `"("`, `";"`) and represent syntactic punctuation. The [tree-sitter documentation](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html) explains that by using the named-node API variants — `ts_node_named_child()`, `ts_node_named_child_count()`, `ts_node_next_named_sibling()` — "the syntax tree functions much like an abstract syntax tree." The [ast-grep documentation](https://ast-grep.github.io/advanced/core-concepts.html) puts it directly: "We can get AST from CST by only keeping named nodes."

Consider how a function declaration is represented. In tree-sitter's CST for `function double(x: number): number { return x * 2; }`, the full tree includes anonymous children for the `function` keyword, parentheses, colon, braces, `return` keyword, `*` operator, and semicolon. But using field-name access — `node.child_by_field_name('name')`, `node.child_by_field_name('parameters')`, `node.child_by_field_name('body')` — you get clean semantic traversal. The S-expression shows only the meaningful structure:

```
(program
  (function_declaration
    name: (identifier)
    parameters: (formal_parameters
      (required_parameter
        pattern: (identifier)
        type: (type_annotation (predefined_type))))
    return_type: (type_annotation (predefined_type))
    body: (statement_block
      (return_statement (binary_expression
        left: (identifier) right: (number))))))
```

Compare this to the [ESTree specification](https://github.com/estree/estree/blob/master/es5.md) used by ESLint and `@typescript-eslint`. As the [ESLint glossary](https://eslint.org/docs/latest/use/core-concepts/glossary) shows, the expression `1 + 2;` becomes `{type: "ExpressionStatement", expression: {type: "BinaryExpression", left: {type: "Literal", value: 1}, operator: "+", right: {type: "Literal", value: 2}}}`. The operator `+` is a **string property** on the `BinaryExpression` node, not a child node. No semicolon node exists. Parentheses are implicit in the tree structure — as [Wikipedia notes](https://en.wikipedia.org/wiki/Abstract_syntax_tree), "grouping parentheses are implicit in the tree structure, so these do not have to be represented as separate nodes."

One subtlety: tree-sitter does **not** preserve whitespace as nodes. Whitespace falls in the gaps between node byte ranges, which tree-sitter tracks precisely via start/end byte offsets and row/column coordinates. This means exact source reconstruction is still possible, but whitespace is not part of the tree itself.

## When CST versus AST wins for code intelligence

The choice between CST and AST depends on the specific analysis task. For **symbol extraction**, tree-sitter's CST is excellent. [GitHub's code navigation system](https://dl.acm.org/doi/fullHtml/10.1145/3487019.3487022) uses tree-sitter with `tags.scm` query files per language to extract definitions and references, serving over **40,000 requests per minute**. The declarative [query language](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) lets you write patterns like `(function_declaration name: (identifier) @name)` to capture function names across any language tree-sitter supports. GitHub chose tree-sitter over canonical language parsers because it handles multiple language versions gracefully, requires no project-level build configuration, and delivers results in seconds rather than minutes.

For **code chunking** — splitting source files into semantically meaningful segments for retrieval-augmented generation or embeddings — tree-sitter's precise byte boundaries make it ideal. You can split a file at function boundaries with exact start/end positions and reconstruct the original source. [Sourcegraph's engineering](https://sourcegraph.com/blog/announcing-scip) explored tree-sitter-based chunking for their AI features, and their search-based code navigation is powered by tree-sitter combined with ctags.

For **relationship mining** that requires type resolution — determining that `foo.bar()` calls a specific method on a specific class — tree-sitter falls short because it provides no semantic information. [Sourcegraph's precise code navigation](https://sourcegraph.com/blog/announcing-scip) uses SCIP indexers that invoke actual language compilers (e.g., `scip-typescript` uses TypeScript's type checker) rather than tree-sitter. The practical pattern is: **tree-sitter for fast structural queries, the TypeScript compiler for semantic depth**.

Tree-sitter also provides robust **error recovery**. It produces ERROR and MISSING nodes for invalid syntax but continues parsing the rest of the file, always returning a usable tree. This matters enormously for editor-integrated code intelligence where the file is frequently in an incomplete state mid-edit. The TypeScript compiler's parser has limited error recovery by comparison.

## Building control flow graphs from TypeScript

A [Control Flow Graph](https://en.wikipedia.org/wiki/Control-flow_graph) is a directed graph G = (N, E) where each node represents a **basic block** — a maximal straight-line sequence of instructions with a single entry point and single exit point — and each edge represents a possible transfer of control. The algorithm for identifying basic blocks, described in Cooper and Torczon's *Engineering a Compiler*, identifies **leaders** (the first statement, any jump target, any statement following a conditional/unconditional jump) and groups each leader with all subsequent statements until the next leader.

Edges come in several flavors. **Unconditional edges** represent fall-through or explicit jumps. **Conditional edges** split into true and false branches at `if` statements or ternary expressions. **Back edges** point to a dominating block, indicating loops. The graph has a distinguished **entry node** (where execution begins) and **exit node** (where it ends).

TypeScript's compiler builds its own control flow graph, though it uses a different representation than traditional basic-block CFGs. The architecture splits across two phases, as documented in the [TypeScript compiler wiki](https://github.com/microsoft/TypeScript/wiki/Codebase-Compiler-Binder) and explored in depth by [Dan Vanderkam's analysis of FlowNodes](https://effectivetypescript.com/2024/03/24/flownodes/).

**The binder (`binder.ts`) greedily constructs the flow graph** during its first walk of the AST after parsing. It maintains a `currentFlow` variable and creates `FlowNode` objects as it encounters statements and expressions that affect control flow. **The checker (`checker.ts`) lazily evaluates the graph** only when it needs the type of a variable at a specific location. This separation is deliberate: the binder constructs without knowing what analysis will run; the checker queries on demand.

All FlowNodes share a [uniform shape](https://github.com/microsoft/TypeScript/blob/main/src/compiler/types.ts) with four fields: `flags` (a `FlowFlags` enum identifying the node kind), `id` (used by the checker's flow type cache), `node` (the associated AST node), and `antecedent` (pointer(s) to preceding flow nodes). The key FlowFlags values are:

```typescript
export const enum FlowFlags {
    Unreachable    = 1 << 0,   // Unreachable code
    Start          = 1 << 1,   // Start of flow graph
    BranchLabel    = 1 << 2,   // Non-looping junction
    LoopLabel      = 1 << 3,   // Looping junction
    Assignment     = 1 << 4,   // Assignment
    TrueCondition  = 1 << 5,   // Condition known to be true
    FalseCondition = 1 << 6,   // Condition known to be false
    SwitchClause   = 1 << 7,   // Switch statement clause
    ArrayMutation  = 1 << 8,   // Potential array mutation
}
```

A critical detail: **TypeScript's flow graph is built in reverse**. Each FlowNode points backward to its antecedents (the nodes that executed before it), not forward to successors. This makes backward traversal — which is exactly what the checker needs when determining a variable's type at a use site — natural and efficient.

Consider how the binder handles an `if/else`:

```typescript
function f(x: string | number) {
  if (typeof x === 'string') {
    return x;
  } else {
    console.log(x);
  }
  return x;
}
```

The binder creates a `FlowStart` at function entry. At the `if` condition, it creates two `FlowCondition` nodes — one `TrueCondition` and one `FalseCondition` — both with the `FlowStart` as their antecedent. After `return x` in the then-branch, it sets `currentFlow` to `Unreachable`. The post-if convergence point is a `FlowLabel` (with `BranchLabel` flag) whose antecedent array collects both branches — though the unreachable then-branch contributes nothing. Loops work similarly: a `while` loop creates a `LoopLabel` whose antecedents include both the pre-loop flow and the back edge from the loop body's end, forming a cycle.

## Type narrowing as control flow analysis in practice

TypeScript's [type narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) is the most visible application of its internal CFG. When you write `if (typeof x === 'string')`, TypeScript narrows `x` from `string | number` to `string` inside the then-block. This is implemented through the checker's workhorse function, `getFlowTypeOfReference`, which [Dan Vanderkam documents](https://effectivetypescript.com/2024/03/24/flownodes/) as over 1,200 lines of code in `checker.ts`.

The algorithm traverses the flow graph **backward** from the use site: at a `FlowAssignment`, it checks whether the assignment affects the variable being analyzed; at a `FlowCondition`, it applies narrowing functions like `narrowTypeByTypeof`, `narrowTypeByEquality`, `narrowTypeByInstanceof`, or `narrowTypeByTypePredicate`; at a `FlowBranchLabel`, it traverses all antecedent branches and **unions** the resulting types; at `FlowStart`, it returns the declared type; at `FlowUnreachable`, it returns the `never` type.

[Definite assignment analysis](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html), introduced in TypeScript 2.0 with `strictNullChecks`, uses the same flow graph. The checker walks backward from every variable use to verify that an assignment exists on all possible paths. If any path reaches `FlowStart` without passing through a `FlowAssignment` for that variable, and the variable's type does not include `undefined`, TypeScript reports an error.

The lazy evaluation strategy is key to performance: **TypeScript only computes flow types when they are actually needed**. Variables whose narrowed types are never queried are never analyzed. This means the full cost of CFA is only paid for code paths that the checker actually visits.

## Dead code detection, reachability, and cyclomatic complexity

CFGs enable three critical analysis capabilities. **Reachability analysis** determines which basic blocks can be reached from the entry node via graph traversal. Any block not visited is unreachable. In TypeScript's implementation, after `return`, `throw`, or unconditional `break` statements, the binder sets `currentFlow` to the `Unreachable` sentinel. The compiler option `allowUnreachableCode: false` reports diagnostics for such dead code.

**[Cyclomatic complexity](https://en.wikipedia.org/wiki/Cyclomatic_complexity)**, introduced by Thomas McCabe in 1976, quantifies the number of linearly independent paths through a function. It is computed directly from the CFG: **M = E − N + 2P**, where E is the number of edges, N the number of nodes, and P the number of connected components (typically 1 for a single function). A simplified form counts decision points: **M = D + 1** where D is the number of `if`, `while`, `for`, `case`, `&&`, and `||` constructs. A function with a single `if/else` has cyclomatic complexity 2 — the then-path and the else-path. Values above 10 indicate moderate risk; above 20, high risk. The metric directly corresponds to the minimum number of test cases needed for full branch coverage.

**Dead code detection** combines reachability with data flow: if a variable's definition has no uses reachable from it (an empty def-use chain), the definition is dead code. If a basic block has no incoming edges from the entry, it is unreachable. Both analyses depend on a well-constructed CFG.

## Data flow analysis builds on the CFG foundation

[Data flow analysis](https://en.wikipedia.org/wiki/Data-flow_analysis) is a family of techniques for computing information about possible values at each program point. Every data flow analysis operates on the CFG and uses an iterative fixed-point algorithm. The framework requires a CFG, a domain of data flow facts, transfer functions for each node, and a combining operator at join points — union for "may" analyses (facts true on *some* path) or intersection for "must" analyses (facts true on *all* paths).

**[Reaching definitions](https://en.wikipedia.org/wiki/Reaching_definition)** is the canonical forward "may" analysis. A definition of variable `x` at statement S *reaches* statement T if there exists a path from S to T with no intervening redefinition of `x`. The data flow equations, as taught in [UW-Madison's CS704](https://pages.cs.wisc.edu/~horwitz/CS704-NOTES/2.DATAFLOW.html) and [Harvard's CS153](https://groups.seas.harvard.edu/courses/cs153/2019fa/lectures/Lec20-Dataflow-analysis.pdf), are:

```
REACH_out[S] = GEN[S] ∪ (REACH_in[S] − KILL[S])
REACH_in[S]  = ∪ { REACH_out[P] : P is predecessor of S }
```

Where `GEN[S]` is the set of definitions created at S, and `KILL[S]` is the set of other definitions of the same variable that S overwrites. The algorithm initializes all OUT sets to empty, places all nodes on a worklist, and iterates: recompute each node's IN and OUT sets; if OUT changes, add successors to the worklist. Iterate until no OUT set changes (the fixed point).

**[Def-use and use-def chains](https://en.wikipedia.org/wiki/Use-define_chain)** are built from reaching definitions. A **use-def (UD) chain** links each use of a variable to all definitions that can reach it. A **def-use (DU) chain** is the inverse — linking each definition to all uses it can reach. These chains enable [dead code elimination](https://www.cs.cornell.edu/courses/cs4120/2011fa/lectures/lec25-fa11.pdf) (a definition with an empty DU chain is dead), constant propagation (if all definitions in a UD chain assign the same constant, replace the use), and copy propagation.

**Live variable analysis** is a backward "may" analysis: a variable `v` is *live* at point `p` if there exists a path from `p` to a use of `v` without an intervening redefinition. The transfer function is `f(S) = (S − KILL) ∪ GEN`, where `KILL` contains variables defined and `GEN` contains variables used. This enables register allocation and further dead code elimination.

TypeScript's type narrowing is conceptually similar to a forward data flow analysis where the "facts" are type constraints. At each `FlowCondition`, the transfer function narrows the type; at each `FlowBranchLabel` (join point), the combining operator takes the union of types from all antecedent branches. The checker's backward traversal is an implementation choice — it achieves the same result as a forward analysis but only computes what is needed.

## Practical tooling: three approaches to TypeScript analysis

Three primary tools exist for TypeScript AST analysis, each occupying a distinct niche. The right choice depends on whether you need speed, semantic depth, or ergonomics.

**The TypeScript Compiler API** (`typescript` package) is the authoritative foundation. [The official wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) documents two usage tiers. For structural analysis without types, `ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)` parses a string into an AST. Traversal uses the recursive `ts.forEachChild(node, visitor)` pattern with type guards like `ts.isFunctionDeclaration(node)` and `ts.isIdentifier(node)`:

```typescript
import * as ts from "typescript";

const sourceFile = ts.createSourceFile("ex.ts", code, ts.ScriptTarget.Latest, true);

function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    console.log(`Function: ${node.name.text}`);
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
```

For semantic analysis, `ts.createProgram(fileNames, compilerOptions)` builds a full program, and `program.getTypeChecker()` exposes the type checker with methods like `getTypeAtLocation(node)`, `getSymbolAtLocation(node)`, and `typeToString(type)`. The type checker is what powers narrowing, definite assignment, and all of TypeScript's type-level intelligence.

A [benchmark by Herrington Darkholme](https://medium.com/@hchan_nvim/benchmark-typescript-parsers-demystify-rust-tooling-performance-025ebfd391a3) on Apple M1 silicon reveals a surprising fact: **the TypeScript parser is the fastest synchronous parser** for TypeScript code, outperforming even Rust-based alternatives like SWC and OXC when used from JavaScript. The reason: JS-native parsers avoid FFI and serialization overhead. Native parsers must pay `FFI_time + parse_time + serde_time`, where serde (serializing the entire AST to JSON for the JS boundary) dominates for large files. Tree-sitter avoids serde overhead by returning a tree object with native method calls, reaching roughly **78% of the TypeScript parser's speed** for large files like `checker.ts` (2.79MB). The common perception that "tsc is slow" refers to type checking, not parsing.

**[ts-morph](https://ts-morph.com/)** wraps the TypeScript Compiler API with an object-oriented convenience layer. Created by David Sherret, it provides classes like `Project`, `SourceFile`, and typed `Node` subclasses with rich navigation — `sourceFile.getClasses()`, `myClass.getMethods()`, `node.forEachDescendant()` with [traversal control](https://ts-morph.com/navigation/) (`skip`, `up`, `stop`). Every ts-morph node exposes `.compilerNode` for direct compiler API access. Its primary advantage is code **manipulation**: `myClass.rename("NewName")` handles reference updates, `addProperty()` generates correct syntax, and `project.save()` writes changes to disk. The tradeoff is overhead — ts-morph wraps every node in a JavaScript object, consuming more memory than the raw compiler API. For read-only analysis at scale, the lighter `@ts-morph/bootstrap` package provides project setup without the full wrapper layer.

**[tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript)** provides two separate grammars (TypeScript and TSX) for tree-sitter. Bindings exist for [Node.js native](https://www.npmjs.com/package/tree-sitter) (fastest), [WASM](https://www.npmjs.com/package/web-tree-sitter) (browser-compatible but slower), Rust, Python, and C. The standout feature is **incremental parsing**: `parser.parse(newCode, oldTree)` reuses unchanged portions of the old tree, enabling sub-100ms re-parsing even for large files. The [query API](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) supports pattern matching with S-expression syntax, making structural search declarative. The fundamental limitation is the absence of type information — tree-sitter is a syntactic tool that cannot resolve types, understand generics, or perform cross-file analysis.

**[@typescript-eslint/parser](https://typescript-eslint.io/packages/parser/)** deserves mention as a fourth approach. It [invokes the TypeScript compiler](https://typescript-eslint.io/blog/asts-and-typescript-eslint/) internally, converts the TypeScript AST to ESTree format, and exposes `parserServices` for type-aware analysis. The [visitor pattern in ESLint rules](https://eslint.org/docs/latest/extend/custom-rules) — returning an object mapping node types to handler functions — is an elegant model for code analysis. The `@typescript-eslint/scope-manager` builds a scope model from the AST, tracking variable definitions and references. However, the double-AST creation (TypeScript AST → ESTree conversion) adds overhead that makes it less suitable as a general analysis foundation.

## The minimum viable analysis stack

For a code intelligence system, **the minimum viable stack is the TypeScript Compiler API alone**: `ts.createSourceFile()` for fast structural parsing, `ts.createProgram()` with `getTypeChecker()` for semantic analysis, and `ts.forEachChild()` for traversal. This gives you the fastest synchronous parser, complete type information, symbol resolution, and zero additional dependencies beyond the `typescript` package.

Add **tree-sitter** when you need incremental real-time parsing (editor integration), cross-language structural queries, browser-side analysis (via WASM), or robust error recovery for incomplete code. The practical architecture is a two-tier system: tree-sitter handles the fast, syntactic outer layer — chunking, symbol extraction, structural pattern matching — while the TypeScript compiler handles the slow, semantic inner layer — type resolution, call graph construction, cross-file reference tracking.

Add **ts-morph** only if your system writes or transforms code. For read-only analysis, the raw compiler API with a thin utility layer you write yourself will outperform ts-morph while giving you full control.

The key insight is that **no tool can provide type information without invoking the TypeScript compiler**. Tree-sitter, SWC, and every fast parser hit this wall. The compiler's flow analysis — the FlowNode graph in `binder.ts`, the narrowing functions in `checker.ts` — is irreplaceable for semantic understanding. Your analysis stack should embrace this reality: use fast tools for structural tasks that do not need types, and pay the cost of the full compiler only when semantic depth is required.

## Conclusion

The three layers of program representation — syntax trees, control flow graphs, and data flow analysis — form a progression from structure to semantics. Tree-sitter's CST gives you every token with sub-millisecond incremental updates, and its named-node API bridges the gap to AST-level queries without sacrificing byte-accurate source mapping. TypeScript's compiler builds a reverse-linked flow graph of FlowNodes that the checker traverses lazily, powering type narrowing and definite assignment without paying for analysis of unused code paths. Data flow analysis — reaching definitions, def-use chains, live variables — extends the CFG into value-level reasoning that enables dead code detection, constant propagation, and the deeper analyses a code intelligence system ultimately needs.

The practical takeaway for system design is that **the boundary between syntactic and semantic analysis is your primary architectural decision**. Tree-sitter operating at 78% of tsc's parsing speed with incremental updates and error recovery handles the syntactic tier. The TypeScript compiler, despite its heavier footprint, is non-negotiable for the semantic tier. Building a code intelligence system means knowing which questions each layer can answer — and routing queries to the cheapest layer that suffices.

## Bibliography

**Tree-sitter Official Documentation — Basic Parsing**
https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html
Defines named vs. anonymous nodes, field names, and the DOM-style API. Documents that using named-node traversal makes the CST function like an AST.

**Tree-sitter GitHub Repository**
https://github.com/tree-sitter/tree-sitter
States tree-sitter "builds a concrete syntax tree" and describes the four core objects: TSLanguage, TSParser, TSTree, TSNode. Documents incremental parsing and design goals.

**Eli Bendersky — Abstract vs. Concrete Syntax Trees**
https://eli.thegreenplace.net/2009/02/16/abstract-vs-concrete-syntax-trees
Clearly defines the distinction: CSTs preserve full syntactic structure; ASTs abstract away clutter to focus on meaning.

**ESTree Specification (ES5)**
https://github.com/estree/estree/blob/master/es5.md
Community standard AST format for JavaScript. Defines node types like BinaryExpression, Identifier, Literal with operators as string properties.

**ESLint Core Concepts Glossary**
https://eslint.org/docs/latest/use/core-concepts/glossary
Shows ESTree AST examples and confirms ESLint uses ESTree format. Demonstrates how `1 + 2;` is represented without punctuation nodes.

**ast-grep Core Concepts**
https://ast-grep.github.io/advanced/core-concepts.html
States "We can get AST from CST by only keeping named nodes" — bridging tree-sitter's CST to AST-level analysis.

**GitHub — Static Analysis at Scale (ACM 2021)**
https://dl.acm.org/doi/fullHtml/10.1145/3487019.3487022
Documents GitHub's use of tree-sitter for code navigation serving 40,000+ requests/minute. Describes the decision to use tree-sitter over canonical parsers.

**Sourcegraph — Announcing SCIP**
https://sourcegraph.com/blog/announcing-scip
Distinguishes search-based navigation (tree-sitter/ctags) from precise navigation (SCIP/LSIF compiler indexers). Key for understanding the two-tier architecture.

**Tree-sitter Code Navigation**
https://tree-sitter.github.io/tree-sitter/4-code-navigation.html
Documents `tags.scm` query files for extracting definitions and references across languages.

**Tree-sitter Query Syntax**
https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html
Defines S-expression pattern matching, captures, predicates, wildcards, and quantifiers.

**Dan Vanderkam — Flow Nodes: How Type Inference Is Implemented (Effective TypeScript)**
https://effectivetypescript.com/2024/03/24/flownodes/
The most comprehensive external analysis of TypeScript's internal FlowNode system. Documents `getFlowTypeOfReference`, lazy evaluation, and the backward traversal algorithm.

**TypeScript Wiki — Codebase Compiler Binder**
https://github.com/microsoft/TypeScript/wiki/Codebase-Compiler-Binder
Official documentation of how the binder constructs the flow graph during its first AST walk.

**TypeScript Compiler Source — types.ts**
https://github.com/microsoft/TypeScript/blob/main/src/compiler/types.ts
Contains FlowFlags enum, FlowNode interfaces, and the uniform 4-field FlowNode shape.

**TypeScript-Compiler-Notes — Binder**
https://github.com/microsoft/TypeScript-Compiler-Notes/blob/main/codebase/src/compiler/binder.md
Microsoft's internal notes on binder architecture, flow node creation functions, and container handling.

**TypeScript Handbook — Narrowing**
https://www.typescriptlang.org/docs/handbook/2/narrowing.html
Official documentation of type narrowing with typeof guards, truthiness, equality, instanceof, discriminated unions, and exhaustiveness checking.

**TypeScript 2.0 Release Notes**
https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html
Documents the introduction of control flow analysis for types and definite assignment analysis with strictNullChecks.

**Wikipedia — Control-Flow Graph**
https://en.wikipedia.org/wiki/Control-flow_graph
Defines CFG as G = (N, E) with basic blocks, edges, entry/exit nodes, and the relationship to compiler optimization.

**Wikipedia — Cyclomatic Complexity**
https://en.wikipedia.org/wiki/Cyclomatic_complexity
Documents McCabe's 1976 metric: M = E − N + 2P. Provides interpretation thresholds and relationship to test coverage.

**Wikipedia — Data-Flow Analysis**
https://en.wikipedia.org/wiki/Data-flow_analysis
Defines the framework: domain, transfer functions, combining operators, forward/backward and may/must distinctions.

**Wikipedia — Reaching Definition**
https://en.wikipedia.org/wiki/Reaching_definition
Documents the reaching definitions problem, GEN/KILL sets, and the iterative worklist algorithm.

**Wikipedia — Use-Define Chain**
https://en.wikipedia.org/wiki/Use-define_chain
Defines UD and DU chains, their construction from reaching definitions, and applications in optimization.

**UW-Madison CS704 — Dataflow Analysis Lecture Notes**
https://pages.cs.wisc.edu/~horwitz/CS704-NOTES/2.DATAFLOW.html
Formal treatment of data flow frameworks, transfer functions, and fixed-point computation.

**Harvard CS153 — Dataflow Analysis Lecture**
https://groups.seas.harvard.edu/courses/cs153/2019fa/lectures/Lec20-Dataflow-analysis.pdf
Covers reaching definitions, live variables, and the iterative algorithm with worked examples.

**Cornell CS4120 — Reaching Definitions, Webs, SSA**
https://www.cs.cornell.edu/courses/cs4120/2011fa/lectures/lec25-fa11.pdf
Connects def-use chains to SSA form and documents applications in dead code elimination and optimization.

**Herrington Darkholme — Benchmark TypeScript Parsers**
https://medium.com/@hchan_nvim/benchmark-typescript-parsers-demystify-rust-tooling-performance-025ebfd391a3
Benchmarks TypeScript, Babel, tree-sitter, SWC, and OXC. Reveals TypeScript parser is fastest synchronous parser due to zero FFI/serde overhead.

**ts-morph Documentation**
https://ts-morph.com/
Official docs for the TypeScript Compiler API wrapper. Documents Project, SourceFile, Node classes, navigation, and manipulation APIs.

**ts-morph Navigation**
https://ts-morph.com/navigation/
Documents forEachDescendant with traversal control (skip, up, stop), getChildren, and type-specific navigation methods.

**TypeScript Wiki — Using the Compiler API**
https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
Official guide to ts.createSourceFile, ts.createProgram, type checker, transformations, and the printer API.

**tree-sitter-typescript GitHub Repository**
https://github.com/tree-sitter/tree-sitter-typescript
Two grammars (TypeScript and TSX), bindings for Node.js, WASM, Rust, Python, and C.

**@typescript-eslint/parser**
https://typescript-eslint.io/packages/parser/
Documents how the parser invokes the TypeScript compiler, converts to ESTree, and exposes parserServices for type-aware rules.

**typescript-eslint Blog — ASTs and typescript-eslint**
https://typescript-eslint.io/blog/asts-and-typescript-eslint/
Explains the dual-AST pipeline: TypeScript AST → ESTree conversion, and how parserServices bridges back to the type checker.

**ESLint — Custom Rules Documentation**
https://eslint.org/docs/latest/extend/custom-rules
Documents the visitor pattern for AST traversal in ESLint rules, including selector syntax and :exit variants.

**Symflower Blog — Parsing Code with Tree-sitter**
https://symflower.com/en/company/blog/2023/parsing-code-with-tree-sitter/
Reports 36x speedup migrating from JavaParser to tree-sitter for Java code analysis.

**Cloudaffle — Control Flow Analysis in TypeScript**
https://cloudaffle.com/blog/control-flow-analysis-typescript
Explains TypeScript's CFA from a developer perspective with examples of narrowing behavior.