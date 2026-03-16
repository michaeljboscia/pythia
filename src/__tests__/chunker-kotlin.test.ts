import assert from "node:assert/strict";
import test from "node:test";

import Parser from "tree-sitter";
import Kotlin from "tree-sitter-kotlin";

import { chunkFile } from "../indexer/chunker-treesitter.js";
import { extractKotlinChunks } from "../indexer/chunker-kotlin.js";

const workspaceRoot = process.cwd();
const defaultChunkerOptions = {
  max_chunk_chars: {},
  oversize_strategy: "split" as const
};

let cachedParser: Parser | null = null;

function getKotlinParser(): Parser {
  if (cachedParser !== null) {
    return cachedParser;
  }

  const parser = new Parser();
  parser.setLanguage(Kotlin as Parser.Language);
  cachedParser = parser;
  return parser;
}

function parseKotlin(content: string, filePath: string) {
  const rootNode = getKotlinParser().parse(content).rootNode;
  return extractKotlinChunks(rootNode, filePath);
}

function idsForType(chunks: Array<{ id: string; chunk_type: string }>, chunkType: string): string[] {
  return chunks.filter((chunk) => chunk.chunk_type === chunkType).map((chunk) => chunk.id);
}

test("empty Kotlin file returns no chunks", () => {
  const chunks = parseKotlin("", "src/__tests__/fixtures/kotlin/empty.kt");
  assert.deepEqual(chunks, []);
});

test("top-level fun emits a function chunk", () => {
  const chunks = parseKotlin("fun greet() {}", "src/__tests__/fixtures/kotlin/top.kt");
  assert.deepEqual(idsForType(chunks, "function"), [
    "src/__tests__/fixtures/kotlin/top.kt::function::greet"
  ]);
});

test("class without methods emits a class chunk", () => {
  const chunks = parseKotlin("class Greeter {}", "src/__tests__/fixtures/kotlin/class.kt");
  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/kotlin/class.kt::class::Greeter"
  ]);
});

test("class with a method emits class and function chunks", () => {
  const chunks = parseKotlin("class Greeter { fun greet() {} }", "src/__tests__/fixtures/kotlin/class-method.kt");
  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/kotlin/class-method.kt::class::Greeter"), true);
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/kotlin/class-method.kt::function::greet"), true);
});

test("object declaration maps to class chunk", () => {
  const chunks = parseKotlin("object Greeter {}", "src/__tests__/fixtures/kotlin/object.kt");
  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/kotlin/object.kt::class::Greeter"
  ]);
});

test("interface declaration emits a class chunk", () => {
  const chunks = parseKotlin("interface Greeter { fun greet() }", "src/__tests__/fixtures/kotlin/interface.kt");
  assert.equal(idsForType(chunks, "class").length >= 1, true);
});

test("anonymous declaration falls back to row-based name", () => {
  const chunks = parseKotlin("class {}", "src/__tests__/fixtures/kotlin/anonymous.kt");
  assert.equal(chunks.some((chunk) => chunk.id.includes("anonymous_L")), true);
});

test("nested classes emit separate chunks", () => {
  const chunks = parseKotlin("class Outer { class Inner {} }", "src/__tests__/fixtures/kotlin/nested.kt");
  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/kotlin/nested.kt::class::Outer"), true);
  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/kotlin/nested.kt::class::Inner"), true);
});

test("mixed file emits expected chunk types", () => {
  const content = "class Greeter {}\nobject Hello {}\nfun greet() {}";
  const chunks = parseKotlin(content, "src/__tests__/fixtures/kotlin/mixed.kt");
  assert.equal(idsForType(chunks, "class").length >= 2, true);
  assert.equal(idsForType(chunks, "function").length >= 1, true);
});

test(".kts script files are recognized", () => {
  const chunks = chunkFile("test.kts", "fun greet() {}", workspaceRoot, defaultChunkerOptions);
  assert.equal(chunks.some((chunk) => chunk.chunk_type === "function"), true);
});

test("language field is kotlin for all chunks", () => {
  const chunks = parseKotlin("class Greeter { fun greet() {} }", "src/__tests__/fixtures/kotlin/lang.kt");
  assert.equal(chunks.every((chunk) => chunk.language === "kotlin"), true);
});

test("chunkFile handles .kt extension", () => {
  const chunks = chunkFile("test.kt", "class Greeter {}", workspaceRoot, defaultChunkerOptions);
  assert.equal(chunks.some((chunk) => chunk.chunk_type === "class"), true);
});
