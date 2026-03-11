# Tree-sitter Query Reference — Node.js

Parse and query TypeScript/JavaScript source code using the `tree-sitter` Node.js bindings.
The Node bindings ship a native C extension; they are faster than `web-tree-sitter` (WASM)
and expose `node.text` directly, which the raw C API does not.

Sources:
- [node-tree-sitter README](https://github.com/tree-sitter/node-tree-sitter/blob/master/README.md)
- [node-tree-sitter API docs](https://tree-sitter.github.io/node-tree-sitter/)
- [Tree-sitter query syntax](https://tree-sitter.github.io/tree-sitter/using-parsers/queries)
- [tree-sitter-typescript node types](https://github.com/tree-sitter/tree-sitter-typescript)

---

## Install

```bash
npm install tree-sitter tree-sitter-typescript
# For JavaScript-only files:
npm install tree-sitter tree-sitter-javascript
```

---

## 1. Parse a String

```js
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript');

// ⚠️  tree-sitter-typescript exports TWO grammars — pick one.
// Use .typescript for .ts files, .tsx for .tsx files.
// WRONG: require('tree-sitter-typescript')          ← bare export is undefined
// RIGHT:
const tsLang = TypeScript.typescript;   // or TypeScript.tsx

const parser = new Parser();
parser.setLanguage(tsLang);

const sourceCode = `
  function greet(name: string): string {
    return \`Hello, \${name}!\`;
  }
`;

// parser.parse(source) → Tree
// Second arg is optional old tree for incremental re-parse
const tree = parser.parse(sourceCode);

// Root of the AST
const root = tree.rootNode;  // SyntaxNode

// Print S-expression of the full tree (great for debugging)
console.log(root.toString());
// (program
//   (function_declaration
//     name: (identifier)
//     parameters: (formal_parameters ...)
//     return_type: (type_annotation ...)
//     body: (statement_block ...)))
```

---

## 2. Node Properties

```js
const node = root.namedChildren[0];   // first named child

// --- Type ---
node.type          // string: 'function_declaration', 'identifier', etc.
node.isNamed       // boolean: true for named nodes, false for punctuation/"keywords"
node.grammarType   // same as .type unless the node is an alias in the grammar

// --- Text content ---
// .text is only available in Node.js bindings (not the raw C API).
// Returns the source substring this node spans.
node.text          // string: the raw source text

// --- Position (0-indexed) ---
node.startPosition  // { row: number, column: number }
node.endPosition    // { row: number, column: number }
node.startIndex     // byte offset from start of source
node.endIndex       // byte offset (exclusive)

// Convention: add 1 to row for human-readable line numbers
const lineNumber = node.startPosition.row + 1;

// --- Error state ---
node.hasError   // true if this subtree contains any parse errors
node.isError    // true if this node itself is an ERROR node
node.isMissing  // true if this is a zero-width implicit token inserted for recovery
```

---

## 3. Walk Children Without a Query

```js
// .children     → ALL children (named + anonymous: keywords, punctuation, etc.)
// .namedChildren → only named children (usually what you want)
// Prefer namedChildren to skip noise like '{', '}', ';', ','

for (const child of node.namedChildren) {
  console.log(child.type, child.text);
}

// Get child by field name (see node type tables below for field names)
const nameNode = funcNode.childForFieldName('name');
const bodyNode = funcNode.childForFieldName('body');
const paramsNode = funcNode.childForFieldName('parameters');

// Shorthand navigation
node.firstChild          // first child (named or anonymous)
node.firstNamedChild     // first named child
node.lastChild
node.lastNamedChild
node.parent
node.nextSibling
node.nextNamedSibling
node.previousSibling
node.previousNamedSibling

// Counts
node.childCount          // total children
node.namedChildCount     // named children only

// Efficient bulk search — no query needed
const allFunctions = root.descendantsOfType('function_declaration');
// or multiple types:
const allCallables = root.descendantsOfType([
  'function_declaration',
  'arrow_function',
  'method_definition',
]);
```

---

## 4. Queries

```js
// Query constructor: new Parser.Query(language, querySource)
// ⚠️  Query is a static class on Parser — not a standalone import.
// ⚠️  Query strings must use double quotes, NOT single quotes.

const query = new Parser.Query(tsLang, `
  (function_declaration
    name: (identifier) @fn.name) @fn.def
`);

// --- matches(node, options?) → QueryMatch[] ---
// Returns array ordered by match discovery.
// Each match = { pattern: number, captures: QueryCapture[] }
// captures = [{ name: string, node: SyntaxNode }, ...]
const matches = query.matches(root);
for (const match of matches) {
  for (const cap of match.captures) {
    console.log(cap.name, '→', cap.node.text);
    // e.g. "fn.name" → "greet"
    //      "fn.def"  → "function greet(...) {...}"
  }
}

// --- captures(node, options?) → QueryCapture[] ---
// Flat list in source order. Best for single-pattern queries.
// Each capture = { name: string, node: SyntaxNode }
const captures = query.captures(root);
for (const { name, node } of captures) {
  console.log(name, node.startPosition.row, node.text);
}

// options (both methods accept the same shape):
// { startPosition?: Point, endPosition?: Point,
//   startIndex?: number, endIndex?: number }
// Use to restrict the query to a byte range or position range.

// Check if match limit was hit (see matchLimit below)
if (query.didExceedMatchLimit()) {
  console.warn('Query match limit exceeded — results may be incomplete');
}
```

---

## 5. Query Syntax (S-expressions)

```scheme
; ── Basics ───────────────────────────────────────────────────────────────

; Match any function_declaration
(function_declaration)

; Match with a required child anywhere inside
(function_declaration (identifier))

; Match with field-constrained child (preferred — more precise)
(function_declaration
  name: (identifier) @fn.name)

; Negated field — match only if the node LACKS that field
(class_declaration
  !type_parameters)

; ── Captures ─────────────────────────────────────────────────────────────

; @capture_name tags a node. Dot-notation is convention for namespacing.
; Captures starting with _ are private-by-convention (won't conflict with
; tool-reserved names).

(function_declaration
  name: (identifier) @definition.function)   ; GitHub code nav convention

; Capture both parent and child
(function_declaration
  name: (identifier) @fn.name) @fn.def

; ── Anonymous nodes ───────────────────────────────────────────────────────

; Anonymous nodes (keywords, punctuation) use double quotes
(binary_expression
  operator: "!="
  right: (null))

; ── Wildcards ─────────────────────────────────────────────────────────────

; (_)  matches any NAMED node
; _    matches any node (named or anonymous)
(call_expression
  function: (_) @callee
  arguments: (_) @args)

; ── Alternations ─────────────────────────────────────────────────────────

; [ ] means "any one of these"
[
  (function_declaration)
  (arrow_function)
  (method_definition)
] @any.function

; Mix node patterns and anonymous nodes in one alternation:
["class" "interface" "enum"] @keyword

; Alternation inside a field:
(call_expression
  function: [
    (identifier) @fn.name
    (member_expression
      property: (property_identifier) @method.name)
  ])

; ── Quantifiers ───────────────────────────────────────────────────────────

; ?  zero or one
; *  zero or more
; +  one or more

; Optional return type annotation
(function_declaration
  name: (identifier) @fn.name
  return_type: (type_annotation)? @fn.return_type)

; One or more comments before a class
(comment)+ @doc
. (class_declaration) @class.def   ; . is anchor: must be DIRECTLY adjacent

; ── Predicates ────────────────────────────────────────────────────────────

; #eq?   exact text match (capture vs string, or capture vs capture)
(function_declaration
  name: (identifier) @name
  (#eq? @name "main"))

; (#not-eq? ...) negates
; (#any-eq? ...) matches if ANY node in a quantified capture matches

; #match?  regex match (ECMAScript regex syntax, double-escaped in strings)
((identifier) @constant
  (#match? @constant "^[A-Z][A-Z_0-9]+$"))

; (#not-match? ...) negates

; #any-of?  match against multiple strings
((identifier) @keyword
  (#any-of? @keyword "get" "set" "async" "static"))

; #is? / #is-not?  property assertions (metadata, used by highlight systems)
; #set!  attach metadata to a pattern (e.g. for injection languages)
```

---

## 6. TypeScript / JavaScript Node Types

All fields accessible via `node.childForFieldName('fieldName')`.

### Function declaration
```
function greet(name: string): string { ... }
```
```
node.type === 'function_declaration'
  name:        (identifier)           → node.text = "greet"
  parameters:  (formal_parameters)
  return_type: (type_annotation)?
  body:        (statement_block)
```
Query: `(function_declaration name: (identifier) @fn.name) @fn`

### Generator function declaration
```
function* gen() { ... }
```
```
node.type === 'generator_function_declaration'
  name:        (identifier)
  parameters:  (formal_parameters)
  body:        (statement_block)
```

### Function signature (interface / abstract body only)
```
greet(name: string): string;
```
```
node.type === 'function_signature'
  name:        (identifier)
  parameters:  (formal_parameters)
  return_type: (type_annotation)?
```

### Arrow function
```
const greet = (name: string) => `Hello, ${name}!`;
const add = (a: number, b: number): number => a + b;
```
⚠️ Arrow functions are NOT declarations. They are always values nested inside:
```
(lexical_declaration
  (variable_declarator
    name:  (identifier)         → the variable name
    value: (arrow_function
              parameters: (formal_parameters)
              return_type: (type_annotation)?
              body: (statement_block | expression))))
```
Query to capture both name and the arrow function:
```scheme
(lexical_declaration
  (variable_declarator
    name: (identifier) @fn.name
    value: (arrow_function) @fn.def))
```

### Class declaration
```
class Animal { ... }
export abstract class Shape { ... }
```
```
node.type === 'class_declaration'          ; concrete
node.type === 'abstract_class_declaration' ; abstract

  name:            (type_identifier)  ← NOTE: type_identifier, not identifier!
  type_parameters: (type_parameters)?
  class_heritage:  (class_heritage)?     ; extends / implements
  body:            (class_body)
```
Query: `(class_declaration name: (type_identifier) @class.name) @class.def`

### Method definition
```
class Foo {
  constructor() { }
  async fetchData(): Promise<void> { }
  static create(): Foo { }
  get value(): number { }
}
```
```
node.type === 'method_definition'
  [accessibility_modifier]?  ; "public" | "private" | "protected"
  [static]?
  [async]?
  [readonly]?
  name:        (property_identifier | computed_property_name)
  parameters:  (formal_parameters)
  return_type: (type_annotation)?
  body:        (statement_block)
```
Query: `(method_definition name: (property_identifier) @method.name) @method.def`

### Abstract method definition
```
abstract class Shape {
  abstract area(): number;
}
```
```
node.type === 'abstract_method_definition'
  name:        (property_identifier)
  parameters:  (formal_parameters)
  return_type: (type_annotation)?
```

### Interface declaration
```
interface Animal {
  name: string;
  speak(): void;
}
```
```
node.type === 'interface_declaration'
  name:            (type_identifier)  ← type_identifier, not identifier
  type_parameters: (type_parameters)?
  body:            (interface_body)
    → contains: (property_signature), (method_signature), (index_signature)
```
Query: `(interface_declaration name: (type_identifier) @iface.name) @iface.def`

### Type alias declaration
```
type Result<T> = Success<T> | Failure;
```
```
node.type === 'type_alias_declaration'
  name:            (type_identifier)  ← type_identifier
  type_parameters: (type_parameters)?
  value:           (union_type | intersection_type | object_type | ...)
```
Query: `(type_alias_declaration name: (type_identifier) @type.name) @type.def`

### Enum declaration
```
enum Direction { Up, Down, Left, Right }
const enum Color { Red = 0, Green = 1 }
```
```
node.type === 'enum_declaration'
  name: (identifier)   ← plain identifier, not type_identifier
  body: (enum_body)
    → children: (property_identifier | computed_property_name)
```
Query: `(enum_declaration name: (identifier) @enum.name) @enum.def`

### Export wrappers
Any of the above can be wrapped in an `export_statement`. Always check:
```scheme
; Match function declarations regardless of whether they're exported
[
  (function_declaration
    name: (identifier) @fn.name)
  (export_statement
    declaration: (function_declaration
      name: (identifier) @fn.name))
] @fn.def
```

---

## 7. Practical Pythia Query: All Top-level Symbols

```js
import Parser from 'tree-sitter';  // ESM: use createRequire — see gotchas
const Parser = require('tree-sitter');  // CJS
const { typescript: tsLang } = require('tree-sitter-typescript');

const parser = new Parser();
parser.setLanguage(tsLang);

const source = require('fs').readFileSync('input.ts', 'utf8');
const tree = parser.parse(source);

// All symbol types in one query (multi-pattern)
const symbolQuery = new Parser.Query(tsLang, `
  ; Named functions
  (function_declaration
    name: (identifier) @sym.name) @sym.def

  ; Arrow functions assigned to variables
  (lexical_declaration
    (variable_declarator
      name: (identifier) @sym.name
      value: (arrow_function) @sym.def))

  ; Classes
  [
    (class_declaration name: (type_identifier) @sym.name)
    (abstract_class_declaration name: (type_identifier) @sym.name)
  ] @sym.def

  ; Methods
  (method_definition
    name: (property_identifier) @sym.name) @sym.def

  ; Interfaces
  (interface_declaration
    name: (type_identifier) @sym.name) @sym.def

  ; Type aliases
  (type_alias_declaration
    name: (type_identifier) @sym.name) @sym.def

  ; Enums
  (enum_declaration
    name: (identifier) @sym.name) @sym.def
`);

const matches = symbolQuery.matches(tree.rootNode);
const symbols = matches.map(match => {
  // Each match has multiple captures; extract by name
  const nameCapture = match.captures.find(c => c.name === 'sym.name');
  const defCapture  = match.captures.find(c => c.name === 'sym.def');
  return {
    name:      nameCapture?.node.text,
    type:      defCapture?.node.type,
    startLine: defCapture?.node.startPosition.row + 1,  // 1-indexed
    endLine:   defCapture?.node.endPosition.row + 1,
    startCol:  defCapture?.node.startPosition.column,
  };
});

console.log(symbols);
```

---

## 8. Node.js Binding Gotchas

| Issue | Detail |
|---|---|
| **Two TS grammars** | `require('tree-sitter-typescript')` is an object `{ typescript, tsx }`. Always destructure. Using the bare import will fail silently or throw. |
| **`node.text` availability** | `.text` works in Node bindings because they hold a reference to the original source buffer. Not available in the raw C API or in some Rust patterns — you'd compute it from `startIndex`/`endIndex` manually. |
| **`Parser.Query` not `Query`** | The Query class lives at `Parser.Query`, not as a top-level export. `const { Query } = require('tree-sitter')` won't work. |
| **Predicates ARE handled** | Node bindings implement `#eq?`, `#not-eq?`, `#match?`, `#not-match?`, `#any-of?` natively. The raw C library exposes predicates as structured data and leaves filtering to the host — Node.js does the filtering for you. |
| **0-indexed rows** | `startPosition.row` is 0-indexed. Add 1 when displaying line numbers to humans. |
| **`type` vs `grammarType`** | For aliased nodes, `node.type` is the public alias name; `node.grammarType` is the internal rule name. Usually the same; only differs for aliased grammar rules. |
| **`children` vs `namedChildren`** | `children` includes punctuation, braces, keywords. `namedChildren` skips them. Always prefer `namedChildren` for walking semantic nodes. |
| **`type_identifier` vs `identifier`** | TypeScript class/interface/type names use `type_identifier`; function/variable names use `identifier`. Using the wrong one in a query silently matches nothing. |
| **Arrow functions have no declaration node** | `arrow_function` is always nested inside `lexical_declaration > variable_declarator > value`. There is no standalone `arrow_function_declaration`. |
| **ESM projects** | `tree-sitter` uses CommonJS. In ESM projects use `createRequire`: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);` |
| **Single quotes in queries** | Query source strings must use double quotes for string literals. Single quotes cause a parse error in the query. |
| **Parser not thread-safe** | Don't share a `Parser` instance across worker threads. Create one per thread. Trees and Queries can be shared read-only. |
| **Match limit** | Complex queries on large files can hit the match limit. Check `query.didExceedMatchLimit()` after running. Increase via `query.matchLimit = N` (default is OS-dependent). |
| **Incremental parse** | Pass the old tree as second arg to `parser.parse(newSource, oldTree)` for incremental re-parsing after edits. Requires calling `tree.edit(...)` first to mark the changed range. |

---

## 9. Quick Debug Utilities

```js
// Print the full S-expression tree — indispensable for figuring out node types
console.log(tree.rootNode.toString());

// Walk a specific subtree to see its structure
function printTree(node, indent = 0) {
  const pad = ' '.repeat(indent * 2);
  const label = node.isNamed ? node.type : `"${node.type}"`;
  console.log(`${pad}${label} [${node.startPosition.row}:${node.startPosition.column}]`);
  for (const child of node.children) {
    printTree(child, indent + 1);
  }
}
printTree(tree.rootNode);

// Find all nodes of one or more types anywhere in the tree
const allInterfaces = tree.rootNode.descendantsOfType('interface_declaration');
allInterfaces.forEach(n => console.log(n.text.split('\n')[0]));  // first line only

// Inspect field names on a node (useful when you don't know the field name)
// Tree-sitter doesn't expose fieldNames directly, but you can iterate:
for (let i = 0; i < node.childCount; i++) {
  const child = node.child(i);
  // Field names come from the grammar — check node-types.json for your language
  // or just use toString() and read the S-expression
}
```

---

*Created: 2026-03-11*

*Sources:*
- *[github.com/tree-sitter/node-tree-sitter](https://github.com/tree-sitter/node-tree-sitter)*
- *[tree-sitter.github.io/node-tree-sitter](https://tree-sitter.github.io/node-tree-sitter/)*
- *[tree-sitter.github.io/tree-sitter/using-parsers/queries](https://tree-sitter.github.io/tree-sitter/using-parsers/queries)*
- *[github.com/tree-sitter/tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript)*
- *[npmjs.com/package/tree-sitter-typescript](https://www.npmjs.com/package/tree-sitter-typescript)*
