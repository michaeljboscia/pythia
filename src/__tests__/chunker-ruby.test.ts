import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import Parser from "tree-sitter";
import Ruby from "tree-sitter-ruby";

import { chunkFile } from "../indexer/chunker-treesitter.js";
import { extractRubyChunks } from "../indexer/chunker-ruby.js";

const fixturesRoot = path.resolve(process.cwd(), "src", "__tests__", "fixtures", "ruby");
const workspaceRoot = process.cwd();
const defaultChunkerOptions = {
  max_chunk_chars: {},
  oversize_strategy: "split" as const
};

let cachedParser: Parser | null = null;

function getRubyParser(): Parser {
  if (cachedParser !== null) {
    return cachedParser;
  }

  const parser = new Parser();
  parser.setLanguage(Ruby as Parser.Language);
  cachedParser = parser;
  return parser;
}

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesRoot, name), "utf8");
}

function fixturePath(name: string): string {
  return `src/__tests__/fixtures/ruby/${name}`;
}

function parseRubyFixture(name: string) {
  const content = readFixture(name);
  const rootNode = getRubyParser().parse(content).rootNode;

  return {
    content,
    filePath: fixturePath(name),
    chunks: extractRubyChunks(rootNode, fixturePath(name))
  };
}

function idsForType(
  chunks: Array<{ id: string; chunk_type: string }>,
  chunkType: string
): string[] {
  return chunks.filter((chunk) => chunk.chunk_type === chunkType).map((chunk) => chunk.id);
}

test("basic-class.rb produces a class chunk for User", () => {
  const { chunks } = parseRubyFixture("basic-class.rb");

  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/ruby/basic-class.rb::class::User"
  ]);
});

test("basic-class.rb produces an initialize method chunk", () => {
  const { chunks } = parseRubyFixture("basic-class.rb");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/ruby/basic-class.rb::method::initialize"), true);
});

test("basic-class.rb produces a greet method chunk", () => {
  const { chunks } = parseRubyFixture("basic-class.rb");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/ruby/basic-class.rb::method::greet"), true);
});

test("basic-class.rb produces an email method chunk", () => {
  const { chunks } = parseRubyFixture("basic-class.rb");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/ruby/basic-class.rb::method::email"), true);
});

test("all basic-class.rb chunks have language ruby", () => {
  const { chunks } = parseRubyFixture("basic-class.rb");

  assert.equal(chunks.every((chunk) => chunk.language === "ruby"), true);
});

test("all basic-class.rb chunks keep the fixture file path", () => {
  const { chunks } = parseRubyFixture("basic-class.rb");

  assert.equal(chunks.every((chunk) => chunk.file_path === "src/__tests__/fixtures/ruby/basic-class.rb"), true);
});

test("module-with-methods.rb produces a Greeter module chunk", () => {
  const { chunks } = parseRubyFixture("module-with-methods.rb");

  assert.deepEqual(idsForType(chunks, "module"), [
    "src/__tests__/fixtures/ruby/module-with-methods.rb::module::Greeter"
  ]);
});

test("module-with-methods.rb produces a say_hello method chunk", () => {
  const { chunks } = parseRubyFixture("module-with-methods.rb");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/ruby/module-with-methods.rb::method::say_hello"), true);
});

test("module-with-methods.rb produces a say_goodbye method chunk", () => {
  const { chunks } = parseRubyFixture("module-with-methods.rb");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/ruby/module-with-methods.rb::method::say_goodbye"), true);
});

test("singleton-methods.rb produces a Config class chunk", () => {
  const { chunks } = parseRubyFixture("singleton-methods.rb");

  assert.deepEqual(idsForType(chunks, "class"), [
    "src/__tests__/fixtures/ruby/singleton-methods.rb::class::Config"
  ]);
});

test("singleton-methods.rb produces a load method chunk", () => {
  const { chunks } = parseRubyFixture("singleton-methods.rb");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/ruby/singleton-methods.rb::method::load"), true);
});

test("singleton-methods.rb produces a defaults method chunk", () => {
  const { chunks } = parseRubyFixture("singleton-methods.rb");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/ruby/singleton-methods.rb::method::defaults"), true);
});

test("chunkFile adds a module chunk for ruby fixtures", () => {
  const filePath = path.join(fixturesRoot, "basic-class.rb");
  const content = readFixture("basic-class.rb");
  const chunks = chunkFile(filePath, content, workspaceRoot, defaultChunkerOptions);

  assert.equal(chunks.some((chunk) => chunk.chunk_type === "module"), true);
});
