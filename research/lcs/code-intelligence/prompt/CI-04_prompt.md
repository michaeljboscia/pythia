# Research Prompt: CI-04 Call Graph Extraction from TypeScript

## Research Objective
Investigate the specific algorithms, tools, and edge cases involved in statically extracting an accurate Call Graph (which function calls which other functions) from a TypeScript codebase. The goal is to determine how to populate the `CALLS` edges in the LCS Knowledge Graph (*KG-08*) reliably, despite the dynamic nature of JavaScript/TypeScript.

## Research Questions
1. **Static Analysis Limitations:** What are the fundamental limits of static call graph extraction in TypeScript? Give concrete examples of how dynamic dispatch, reflection (`Reflect.apply`), and `eval` defeat static analysis.
2. **First-Class Functions & Callbacks:** How do you accurately map a call graph when functions are passed as arguments (higher-order functions), stored in arrays, or returned from other functions? What does the graph edge look like for a `map` or `filter` callback?
3. **Async/Await Chains:** How does asynchronous execution impact the call graph? If `FunctionA` awaits `FunctionB`, does the static analysis tool accurately capture this, or does it map to the Promise wrapper?
4. **Polymorphism and Interfaces:** If `ClassA` and `ClassB` both implement `interface ILogger` and have a `log()` method, and `FunctionX` calls `logger.log()`, how does static extraction handle the ambiguity? Does it draw an edge to both, neither, or the interface?
5. **Tool Evaluation:** Evaluate existing tools for call graph extraction in TS/JS (e.g., CodeQL, WALA, TS-Call-Graph, Madge). Which tool provides the best balance of speed, accuracy, and ease of programmatic integration?
6. **LSP vs AST Extraction:** Compare the accuracy of building a call graph by walking the AST (via tree-sitter or TS Compiler) and manually tracking identifiers, versus repeatedly querying an LSP for "Go To Definition" on every call expression.
7. **Graph Noise Reduction:** How do you filter out calls to standard library functions (e.g., `console.log`, `Array.push`) and external node_modules to ensure the resulting Knowledge Graph isn't polluted with thousands of irrelevant edges?
8. **Handling Path Aliases:** How must the extraction pipeline parse `tsconfig.json` compiler options (specifically `paths` and `baseUrl`) to accurately resolve cross-file function calls?
9. **Anonymous Functions:** How are anonymous/arrow functions represented as nodes in the call graph? If they are assigned to a variable, do they take the variable's name?
10. **Scale and Computation:** Extracting a full call graph is an $O(N^2)$ problem in the worst case. How long does it take to compute a complete static call graph for a 100,000 LOC project?

## Sub-Topics to Explore
- Control Flow Graphs (CFG) vs Call Graphs (CG).
- The difference between a precise (sound) call graph and a heuristic (over-approximated) call graph, and which is better for RAG.
- Integration of the extracted graph with Graph DBs (like Kuzu or Neo4j - *GD-01*).
- Visualizing massive call graphs (Graphviz, D3.js) for debugging the extraction logic.

## Starting Sources
- **WALA (T.J. Watson Libraries for Analysis):** Detailed research on JS call graphs - https://wala.github.io/
- **CodeQL for JavaScript:** How GitHub's CodeQL constructs call graphs - https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/
- **Madge:** A developer tool for generating dependency graphs - https://github.com/pahen/madge
- **TS-Call-Graph:** https://github.com/whyboris/ts-call-graph
- **Paper:** "Constructing Call Graphs of JavaScript Programs: A Comparative Study" - https://dl.acm.org/doi/10.1145/3611643.3616258
- **Paper:** "Static Analysis of Async/Await in JavaScript" (Search for literature on handling promises in static analysis).
- **TypeScript AST Viewer / Compiler API:** For building custom AST walkers.
- **SCIP Documentation:** Look at how SCIP encodes relationships.

## What to Measure & Compare
- Run `madge` (or a similar tool) against a medium-sized React repository. Measure the execution time and evaluate the visual output: how many false positives (wrong connections) or false negatives (missed connections) occur due to React's highly dynamic nature (e.g., hooks, context)?
- Compare the size of a raw AST JSON dump vs a distilled JSON array of `[Caller, Callee]` tuples for a single dense file.

## Definition of Done
A 3000+ word technical report that establishes the exact boundaries of what LCS can and cannot know about code execution without running the code. It must recommend a specific library or methodology for generating the call graph data required to populate the LCS Knowledge Graph.

## Architectural Implication
Feeds **ADR-005 (Relationship Extraction)** and **ADR-001 (Graph DB Selection)**. If call graphs are too noisy or impossible to extract accurately for TS/React, LCS must pivot away from deep code execution reasoning and focus instead on high-level module dependency tracking (e.g., File A imports File B).