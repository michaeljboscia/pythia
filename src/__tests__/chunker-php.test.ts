import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { chunkFile } from "../indexer/chunker-treesitter.js";
import { extractPhpChunks, getPhpParser } from "../indexer/chunker-php.js";

const fixturesRoot = path.resolve(process.cwd(), "src", "__tests__", "fixtures", "php");
const workspaceRoot = process.cwd();
const defaultChunkerOptions = {
  max_chunk_chars: {},
  oversize_strategy: "split" as const
};

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesRoot, name), "utf8");
}

function fixturePath(name: string): string {
  return `src/__tests__/fixtures/php/${name}`;
}

function parsePhpFixture(name: string) {
  const content = readFixture(name);
  const rootNode = getPhpParser().parse(content).rootNode;
  return {
    content,
    filePath: fixturePath(name),
    chunks: extractPhpChunks(rootNode, fixturePath(name))
  };
}

function idsForType(
  chunks: Array<{ id: string; chunk_type: string }>,
  chunkType: string
): string[] {
  return chunks.filter((chunk) => chunk.chunk_type === chunkType).map((chunk) => chunk.id);
}

test("basic-class emits a class chunk for User", () => {
  const { chunks } = parsePhpFixture("basic-class.php");

  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/php/basic-class.php::class::User"
  ]);
});

test("basic-class emits method chunks for getName and setName", () => {
  const { chunks } = parsePhpFixture("basic-class.php");

  assert.deepEqual(idsForType(chunks, "method"), [
    "src/__tests__/fixtures/php/basic-class.php::class::User::method::getName",
    "src/__tests__/fixtures/php/basic-class.php::class::User::method::setName"
  ]);
});

test("basic-class has exactly three structural chunks", () => {
  const { chunks } = parsePhpFixture("basic-class.php");

  assert.deepEqual(chunks.map((chunk) => chunk.chunk_type), ["class", "method", "method"]);
});

test("trait-example emits a trait chunk for Timestampable", () => {
  const { chunks } = parsePhpFixture("trait-example.php");

  assert.deepEqual(idsForType(chunks, "trait"), [
    "src/__tests__/fixtures/php/trait-example.php::trait::Timestampable"
  ]);
});

test("trait-example emits trait-scoped method chunks", () => {
  const { chunks } = parsePhpFixture("trait-example.php");

  assert.deepEqual(idsForType(chunks, "method"), [
    "src/__tests__/fixtures/php/trait-example.php::trait::Timestampable::method::getCreatedAt",
    "src/__tests__/fixtures/php/trait-example.php::trait::Timestampable::method::setCreatedAt"
  ]);
});

test("trait-example does not emit class chunks", () => {
  const { chunks } = parsePhpFixture("trait-example.php");

  assert.deepEqual(idsForType(chunks, "class"), []);
});

test("interface-example emits an interface chunk for Repository", () => {
  const { chunks } = parsePhpFixture("interface-example.php");

  assert.deepEqual(idsForType(chunks, "interface"), [
    "src/__tests__/fixtures/php/interface-example.php::interface::Repository"
  ]);
});

test("interface-example does not emit class chunks", () => {
  const { chunks } = parsePhpFixture("interface-example.php");

  assert.deepEqual(idsForType(chunks, "class"), []);
});

test("interface-example stays top-level only with one structural chunk", () => {
  const { chunks } = parsePhpFixture("interface-example.php");

  assert.deepEqual(chunks.map((chunk) => chunk.chunk_type), ["interface"]);
});

test("magic-methods emits the MagicContainer class chunk", () => {
  const { chunks } = parsePhpFixture("magic-methods.php");

  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/php/magic-methods.php::class::MagicContainer"
  ]);
});

test("magic-methods emits __construct, __destruct, and __toString method chunks", () => {
  const { chunks } = parsePhpFixture("magic-methods.php");

  assert.deepEqual(idsForType(chunks, "method"), [
    "src/__tests__/fixtures/php/magic-methods.php::class::MagicContainer::method::__construct",
    "src/__tests__/fixtures/php/magic-methods.php::class::MagicContainer::method::__destruct",
    "src/__tests__/fixtures/php/magic-methods.php::class::MagicContainer::method::__toString"
  ]);
});

test("magic-methods emits no standalone function chunks", () => {
  const { chunks } = parsePhpFixture("magic-methods.php");

  assert.deepEqual(idsForType(chunks, "function"), []);
});

test("namespaced-class emits a class chunk for Product", () => {
  const { chunks } = parsePhpFixture("namespaced-class.php");

  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/php/namespaced-class.php::class::Product"
  ]);
});

test("namespaced-class emits Product method chunks", () => {
  const { chunks } = parsePhpFixture("namespaced-class.php");

  assert.deepEqual(idsForType(chunks, "method"), [
    "src/__tests__/fixtures/php/namespaced-class.php::class::Product::method::__construct",
    "src/__tests__/fixtures/php/namespaced-class.php::class::Product::method::getPrice"
  ]);
});

test("namespaced-class keeps the semicolon namespace path stable", () => {
  const { chunks } = parsePhpFixture("namespaced-class.php");

  assert.deepEqual(chunks.map((chunk) => chunk.chunk_type), ["class", "method", "method"]);
});

test("brace-namespaced-class emits a class chunk for UserController", () => {
  const { chunks } = parsePhpFixture("brace-namespaced-class.php");

  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/php/brace-namespaced-class.php::class::UserController"
  ]);
});

test("brace-namespaced-class emits UserController method chunks", () => {
  const { chunks } = parsePhpFixture("brace-namespaced-class.php");

  assert.deepEqual(idsForType(chunks, "method"), [
    "src/__tests__/fixtures/php/brace-namespaced-class.php::class::UserController::method::index",
    "src/__tests__/fixtures/php/brace-namespaced-class.php::class::UserController::method::show"
  ]);
});

test("brace-namespaced-class no longer drops nested namespace children", () => {
  const { chunks } = parsePhpFixture("brace-namespaced-class.php");

  assert.deepEqual(chunks.map((chunk) => chunk.chunk_type), ["class", "method", "method"]);
});

test("enum-example emits enum chunks for Status and Color", () => {
  const { chunks } = parsePhpFixture("enum-example.php");

  assert.deepEqual(idsForType(chunks, "enum"), [
    "src/__tests__/fixtures/php/enum-example.php::enum::Status",
    "src/__tests__/fixtures/php/enum-example.php::enum::Color"
  ]);
});

test("enum-example emits no class chunks", () => {
  const { chunks } = parsePhpFixture("enum-example.php");

  assert.deepEqual(idsForType(chunks, "class"), []);
});

test("enum-example does not silently drop PHP 8.1 enums", () => {
  const { chunks } = parsePhpFixture("enum-example.php");

  assert.deepEqual(chunks.map((chunk) => chunk.chunk_type), ["enum", "enum"]);
});

test("plain-function emits function chunks for calculateTax and formatCurrency", () => {
  const { chunks } = parsePhpFixture("plain-function.php");

  assert.deepEqual(idsForType(chunks, "function"), [
    "src/__tests__/fixtures/php/plain-function.php::function::calculateTax",
    "src/__tests__/fixtures/php/plain-function.php::function::formatCurrency"
  ]);
});

test("plain-function emits no class chunks", () => {
  const { chunks } = parsePhpFixture("plain-function.php");

  assert.deepEqual(idsForType(chunks, "class"), []);
});

test("plain-function contains only top-level function chunks", () => {
  const { chunks } = parsePhpFixture("plain-function.php");

  assert.deepEqual(chunks.map((chunk) => chunk.chunk_type), ["function", "function"]);
});

test("phtml-template returns exactly one chunk through chunkFile", () => {
  const filePath = path.join(fixturesRoot, "phtml-template.php");
  const content = readFixture("phtml-template.php");
  const chunks = chunkFile(filePath, content, workspaceRoot, defaultChunkerOptions);

  assert.equal(chunks.length, 1);
});

test("phtml-template returns a module chunk through chunkFile", () => {
  const filePath = path.join(fixturesRoot, "phtml-template.php");
  const content = readFixture("phtml-template.php");
  const chunks = chunkFile(filePath, content, workspaceRoot, defaultChunkerOptions);

  assert.deepEqual(chunks.map((chunk) => chunk.chunk_type), ["module"]);
});

test("phtml-template keeps the router's module id contract", () => {
  const filePath = path.join(fixturesRoot, "phtml-template.php");
  const content = readFixture("phtml-template.php");
  const chunks = chunkFile(filePath, content, workspaceRoot, defaultChunkerOptions);

  assert.deepEqual(chunks.map((chunk) => chunk.id), [
    "src/__tests__/fixtures/php/phtml-template.php::module::default"
  ]);
});
