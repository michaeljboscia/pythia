# DR Prompt — API Surface Extraction: Tier 3 Tree-sitter Skeleton Queries Across Languages

## Context

We are building `pythia_api_surface`, a new MCP tool inside a Node.js 22 TypeScript MCP server.
For languages without a compiler or LSP (SQL, CSS, Bash, Lua, XML, YAML) — and as a fallback
for any language where the compiler or LSP is unavailable — we use tree-sitter to extract API
surface via "skeleton queries": parse the AST and return only the declaration headers, stripping
implementation bodies.

Pythia already uses tree-sitter extensively for code chunking. The research question is: what
are the correct, canonical tree-sitter S-expression query patterns for skeleton extraction across
each language, and how consistent or inconsistent are those patterns across grammars?

## Research Questions

### 1. The Skeleton Query Pattern — Core Concept

Tree-sitter queries use S-expressions to match AST nodes. The "skeleton" pattern needs to:

1. Match function/method/class declaration nodes
2. Return the declaration header (name, parameters, return type annotations if present)
3. Explicitly EXCLUDE the body node (the `block`, `statement_block`, `body`, etc.)

What is the canonical way to write a tree-sitter query that captures a function's signature
without its body? Is there a standard pattern that works across multiple grammars, or does
each grammar require a completely custom query?

Example: for TypeScript, the relevant node is `function_declaration` with a `statement_block`
body child. The skeleton query should match the function but not return the `statement_block`.
How is this expressed in tree-sitter's query syntax using captures and predicates?

### 2. Per-Language Grammar Analysis

For each language below, provide:
- The tree-sitter grammar package name (`tree-sitter-<lang>`)
- The AST node types for: function declarations, class declarations, method declarations,
  enum declarations (where applicable)
- The node type name for the "body" that should be excluded
- The complete S-expression skeleton query
- Any grammar-specific edge cases (e.g., Python's lack of braces, SQL's CREATE variants)

**Languages to cover:**

- **Python** (`tree-sitter-python`): `def`, `class`, type annotations via PEP 526/604
- **PHP** (`tree-sitter-php`): `function_declaration`, `class_declaration`, visibility modifiers
- **Ruby** (`tree-sitter-ruby`): `method`, `class`, `module` — no explicit types
- **Lua** (`tree-sitter-lua`): `function_declaration`, `local_function` — minimal type info
- **Bash** (`tree-sitter-bash`): `function_definition` — signature only, no types
- **SQL** (`tree-sitter-sql`): `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE TRIGGER` —
  note: Pythia already handles this in Sprint 7 for PostgreSQL-style SQL
- **CSS** (`tree-sitter-css`): `rule_set` selector extraction, `@keyframes`, custom properties
  (no "body strip" needed — return full rule headers)
- **Go** (`tree-sitter-go`): as tree-sitter fallback when `go doc` is unavailable
- **Rust** (`tree-sitter-rust`): as tree-sitter fallback when `rustdoc` is unavailable
- **Java** (`tree-sitter-java`): as tree-sitter fallback — method declarations, class signatures
- **C** (`tree-sitter-c`): function declarations and prototypes
- **C++** (`tree-sitter-cpp`): class declarations, method signatures, templates (simplified)

### 3. Grammar Inconsistency Patterns

Where do tree-sitter grammars disagree on node naming conventions? Specifically:

- Is the body node called `block`, `statement_block`, `body`, `compound_statement`, or
  something else? Map this across all grammars above.
- Which grammars use `identifier` for names vs `name` vs `property_identifier`?
- Which grammars embed visibility/access modifiers as sibling nodes vs parent wrappers?
- Which grammars have multiple node types for the same concept
  (e.g., `function_declaration` vs `arrow_function` vs `function_expression` in JavaScript)?

### 4. Community Query Libraries

Is there an existing community library of tree-sitter queries for skeleton/signature extraction?

- Does `nvim-treesitter` have a standardized `locals.scm` or `tags.scm` format that captures
  function/class definitions across all languages? Can this be reused?
- Does GitHub's `tree-sitter-languages` or `linguist` project include extraction queries?
- Is there a `tree-sitter-tags` standard that covers this use case?
- Are there npm packages that expose pre-written queries per grammar for symbol extraction?

### 5. Handling Languages With No Type Annotations

For dynamically typed languages (Ruby, Lua, Bash, older Python), the skeleton query returns
function names and parameter names but no types. What is the best practice for representing
this in a structured JSON output that an LLM will consume?

Options:
- Return parameters as a list of strings (names only)
- Return `null` for type fields
- Add a `typed: false` flag to the output
- Infer types from default values where possible (e.g., `def foo(x=0)` implies `x` is numeric)

Which representation minimizes LLM confusion when mixed with fully-typed language output?

### 6. Error Recovery in Skeleton Extraction

Tree-sitter is error-tolerant — it produces partial ASTs for files with syntax errors. What is
the recommended pattern for:

- Detecting `ERROR` nodes in the AST and deciding whether to skip the declaration or return
  partial information
- Handling incomplete files (e.g., a function declaration without a closing brace)
- Logging `parse_errors` in the output so the caller knows extraction was partial

Pythia's Sprint 7 SQL chunker already implements `ERROR` node detection — is that pattern
generalizable? What does production tree-sitter tooling do here?

### 7. Performance Characteristics

For a 10,000-line Python file or a 5,000-line PHP file, what is the expected latency of:
- Full tree-sitter parse
- Running a skeleton query over the resulting AST

Is there a performance difference between running queries via `node-tree-sitter` bindings vs
WASM builds of tree-sitter? At what file size does tree-sitter skeleton extraction become
too slow for interactive use (<500ms target)?

## Constraints

- Node.js 22 LTS, `node-tree-sitter` bindings (already used in Pythia)
- Must handle files up to ~10,000 lines in <500ms
- Output must be JSON-serializable
- Must include `parse_errors` field when extraction is partial
- Queries must be static strings (no runtime query generation) to enable caching

## Expected Output

For each language: the exact tree-sitter grammar package, the S-expression skeleton query,
the body node type to exclude, edge cases, and a JSON example of the expected output.
Include a cross-language inconsistency table mapping body node names and declaration node
names across all grammars.
