# DR Prompt — API Surface Extraction: Tier 1 Compiler Invocation from Node.js

## Context

We are building `pythia_api_surface`, a new MCP tool inside a Node.js 22 TypeScript server
(ESM, no CommonJS). The tool extracts ground-truth API surface — exported symbols, constructor
signatures, enum values, visibility modifiers, JSDoc — from source files across many languages,
to eliminate LLM hallucination of API shapes when generating tests or consuming internal code.

For languages with strong compilers (TypeScript, Go, Rust, Java, C#, Kotlin, Swift), the
compiler's own symbol emission is the most accurate extraction mechanism. TypeScript is already
solved via `ts-morph` in-memory `.d.ts` emit. The research question is about the remaining
Tier 1 languages.

## Research Questions

### 1. Programmatic Invocation Patterns — Per Language

For each of the following languages, what is the canonical way to invoke the compiler or its
symbol-extraction tooling programmatically from a Node.js `child_process.spawn`? What exact
CLI flags produce machine-readable API surface output (JSON preferred)?

- **Go**: `go doc`, `go/ast`, or `gomod`-aware tooling
- **Rust**: `rustdoc --output-format json` (stabilized in 1.76) — exact invocation, output schema
- **Java**: `javac` symbol table extraction, `javadoc -doclet`, or tooling like `jdeps` / `jbang`
- **C#**: Roslyn `ISymbol` via `dotnet-script` or `roslyn-api` CLI tools
- **Kotlin**: Dokka programmatic API or `kotlinc` symbol dump
- **Swift**: `swift-doc` or SourceKit-LSP `editor.open` response structure

For each: what does the output JSON look like? What is the minimum installed toolchain required?

### 2. Dependency Detection and Graceful Degradation

The MCP server cannot hard-require all these compilers. Users may have Go but not Rust, Java
but not Swift. What is the production pattern for:

- Detecting whether a compiler is available at runtime (`which go`, PATH inspection, etc.)
- Gracefully falling back to tree-sitter skeleton extraction when compiler is absent
- Caching detection results so the server doesn't re-probe on every request
- Communicating to the caller which extraction tier was used (compiler-exact vs heuristic)

Are there Node.js packages that handle compiler detection across language ecosystems?
(e.g., `which`, `@npmcli/which`, `execa`)

### 3. WASM / Embedded Compiler Builds

Are there WebAssembly builds of any of these compilers that could be bundled with the MCP
server, eliminating the external dependency requirement entirely?

- Is there a WASM build of the Go `go/doc` package?
- Is there a WASM build of `rustdoc` or the Rust analyzer?
- Are there prior art projects that have embedded compiler symbol extraction into a Node.js
  package without requiring the full compiler toolchain?

### 4. Pre-Built npm Packages

Are there existing npm packages that wrap compiler-level symbol extraction for these languages?
What is the quality, maintenance status, and adoption of:

- Go: any `go-parser`, `go-doc` npm wrappers?
- Rust: `rust-analyzer` has a JSON protocol — is there a Node.js client?
- Java: any packages wrapping `javap` or Javadoc extraction?
- C#: Roslyn scripting packages for Node.js?

### 5. Prior Art in Production Tools

How do production tools that support multi-language API surface extraction handle this problem?
Specifically:

- How does **Sourcegraph** extract symbol information across Go, Rust, Java, C#?
- How does **GitHub Copilot Workspace** build its cross-language context?
- How does **JetBrains AI Assistant** extract signatures for its test generation feature?
- How does **Semgrep** handle multi-language symbol extraction?

## Constraints

- Node.js 22 LTS, ESM only
- MCP server must start in <2 seconds — no JVM or heavy runtime at startup
- Extraction per file must complete in <5 seconds for interactive use
- Output must be JSON-serializable for MCP tool response
- Cannot require compilers to be installed — must degrade gracefully

## Expected Output

Concrete comparison table: per language, recommended invocation method, output format,
install requirement, fallback strategy. Include working CLI examples for each.
