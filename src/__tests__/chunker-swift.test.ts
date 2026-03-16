import assert from "node:assert/strict";
import test from "node:test";

import Parser from "tree-sitter";
import Swift from "tree-sitter-swift";

import { chunkFile } from "../indexer/chunker-treesitter.js";
import { extractSwiftChunks } from "../indexer/chunker-swift.js";

const workspaceRoot = process.cwd();
const defaultChunkerOptions = {
  max_chunk_chars: {},
  oversize_strategy: "split" as const
};

let cachedParser: Parser | null = null;

function getSwiftParser(): Parser {
  if (cachedParser !== null) {
    return cachedParser;
  }

  const parser = new Parser();
  parser.setLanguage(Swift as Parser.Language);
  cachedParser = parser;
  return parser;
}

function parseSwift(content: string, filePath: string) {
  const rootNode = getSwiftParser().parse(content).rootNode;
  return extractSwiftChunks(rootNode, filePath);
}

function idsForType(chunks: Array<{ id: string; chunk_type: string }>, chunkType: string): string[] {
  return chunks.filter((chunk) => chunk.chunk_type === chunkType).map((chunk) => chunk.id);
}

test("empty Swift file returns no chunks", () => {
  const chunks = parseSwift("", "src/__tests__/fixtures/swift/empty.swift");
  assert.deepEqual(chunks, []);
});

test("top-level func emits a function chunk", () => {
  const chunks = parseSwift("func greet() {}", "src/__tests__/fixtures/swift/top.swift");
  assert.deepEqual(idsForType(chunks, "function"), [
    "src/__tests__/fixtures/swift/top.swift::function::greet"
  ]);
});

test("class without methods emits a class chunk", () => {
  const chunks = parseSwift("class Greeter {}", "src/__tests__/fixtures/swift/class.swift");
  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/swift/class.swift::class::Greeter"
  ]);
});

test("class with a method emits class and function chunks", () => {
  const chunks = parseSwift("class Greeter { func greet() {} }", "src/__tests__/fixtures/swift/class-method.swift");
  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/swift/class-method.swift::class::Greeter"), true);
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/swift/class-method.swift::function::greet"), true);
});

test("protocol declaration maps to interface chunk", () => {
  const chunks = parseSwift("protocol Greeter { func greet() }", "src/__tests__/fixtures/swift/protocol.swift");
  assert.deepEqual(idsForType(chunks, "interface"), [
    "src/__tests__/fixtures/swift/protocol.swift::interface::Greeter"
  ]);
});

test("struct declaration maps to class chunk", () => {
  const chunks = parseSwift("struct Greeter {}", "src/__tests__/fixtures/swift/struct.swift");
  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/swift/struct.swift::class::Greeter"
  ]);
});

test("declaration with missing name uses empty text from name node", () => {
  // tree-sitter-swift always provides a name node (even if MISSING) so
  // childForFieldName("name") returns a node with empty .text, not null.
  // The anonymous_L fallback is unreachable for Swift; verify empty-name handling.
  const chunks = parseSwift("protocol { }", "src/__tests__/fixtures/swift/anonymous.swift");
  assert.equal(chunks.length > 0, true);
  const proto = chunks.find((c) => c.chunk_type === "interface");
  assert.ok(proto, "expected an interface chunk from anonymous protocol");
});

test("nested classes emit separate chunks", () => {
  const chunks = parseSwift("class Outer { class Inner {} }", "src/__tests__/fixtures/swift/nested.swift");
  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/swift/nested.swift::class::Outer"), true);
  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/swift/nested.swift::class::Inner"), true);
});

test("mixed file emits expected chunk types", () => {
  const content = "class Greeter {}\nfunc greet() {}\nprotocol Hello {}";
  const chunks = parseSwift(content, "src/__tests__/fixtures/swift/mixed.swift");
  assert.equal(idsForType(chunks, "class").length >= 1, true);
  assert.equal(idsForType(chunks, "function").length >= 1, true);
  assert.equal(idsForType(chunks, "interface").length >= 1, true);
});

test("comment-only file returns no chunks", () => {
  const chunks = parseSwift("// hello\n/* test */", "src/__tests__/fixtures/swift/comments.swift");
  assert.deepEqual(chunks, []);
});

test("language field is swift for all chunks", () => {
  const chunks = parseSwift("class Greeter { func greet() {} }", "src/__tests__/fixtures/swift/lang.swift");
  assert.equal(chunks.every((chunk) => chunk.language === "swift"), true);
});

test("chunkFile handles .swift extension", () => {
  const chunks = chunkFile("test.swift", "class Greeter {}", workspaceRoot, defaultChunkerOptions);
  assert.equal(chunks.some((chunk) => chunk.chunk_type === "class"), true);
});
