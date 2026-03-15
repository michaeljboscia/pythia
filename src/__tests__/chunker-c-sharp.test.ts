import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import Parser from "tree-sitter";
import CSharp from "tree-sitter-c-sharp";

import { chunkFile } from "../indexer/chunker-treesitter.js";
import { extractCSharpChunks } from "../indexer/chunker-c-sharp.js";

const fixturesRoot = path.resolve(process.cwd(), "src", "__tests__", "fixtures", "csharp");
const workspaceRoot = process.cwd();
const defaultChunkerOptions = {
  max_chunk_chars: {},
  oversize_strategy: "split" as const
};

let cachedParser: Parser | null = null;

function getCSharpParser(): Parser {
  if (cachedParser !== null) {
    return cachedParser;
  }

  const parser = new Parser();
  parser.setLanguage(CSharp as Parser.Language);
  cachedParser = parser;
  return parser;
}

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesRoot, name), "utf8");
}

function fixturePath(name: string): string {
  return `src/__tests__/fixtures/csharp/${name}`;
}

function parseCSharpFixture(name: string) {
  const content = readFixture(name);
  const rootNode = getCSharpParser().parse(content).rootNode;

  return {
    content,
    filePath: fixturePath(name),
    chunks: extractCSharpChunks(rootNode, fixturePath(name))
  };
}

function idsForType(
  chunks: Array<{ id: string; chunk_type: string }>,
  chunkType: string
): string[] {
  return chunks.filter((chunk) => chunk.chunk_type === chunkType).map((chunk) => chunk.id);
}

test("basic-class.cs produces class::UserService", () => {
  const { chunks } = parseCSharpFixture("basic-class.cs");

  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/csharp/basic-class.cs::class::UserService"), true);
});

test("basic-class.cs produces method::GetUser", () => {
  const { chunks } = parseCSharpFixture("basic-class.cs");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/csharp/basic-class.cs::method::GetUser"), true);
});

test("basic-class.cs produces method::DeleteUser", () => {
  const { chunks } = parseCSharpFixture("basic-class.cs");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/csharp/basic-class.cs::method::DeleteUser"), true);
});

test("basic-class.cs chunks all use language csharp", () => {
  const { chunks } = parseCSharpFixture("basic-class.cs");

  assert.equal(chunks.every((chunk) => chunk.language === "csharp"), true);
});

test("interface-and-enum.cs produces interface::IRepository", () => {
  const { chunks } = parseCSharpFixture("interface-and-enum.cs");

  assert.equal(idsForType(chunks, "interface").includes("src/__tests__/fixtures/csharp/interface-and-enum.cs::interface::IRepository"), true);
});

test("interface-and-enum.cs produces enum::UserStatus", () => {
  const { chunks } = parseCSharpFixture("interface-and-enum.cs");

  assert.deepEqual(idsForType(chunks, "enum"), [
    "src/__tests__/fixtures/csharp/interface-and-enum.cs::enum::UserStatus"
  ]);
});

test("interface-and-enum.cs enum content contains Active", () => {
  const { chunks } = parseCSharpFixture("interface-and-enum.cs");
  const enumChunk = chunks.find((chunk) => chunk.chunk_type === "enum");

  assert.match(enumChunk?.content ?? "", /Active/);
});

test("nested-class.cs produces class::Outer", () => {
  const { chunks } = parseCSharpFixture("nested-class.cs");

  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/csharp/nested-class.cs::class::Outer"), true);
});

test("nested-class.cs produces class::Inner", () => {
  const { chunks } = parseCSharpFixture("nested-class.cs");

  assert.equal(idsForType(chunks, "class").includes("src/__tests__/fixtures/csharp/nested-class.cs::class::Inner"), true);
});

test("nested-class.cs produces method::ProcessInner", () => {
  const { chunks } = parseCSharpFixture("nested-class.cs");

  assert.equal(idsForType(chunks, "method").includes("src/__tests__/fixtures/csharp/nested-class.cs::method::ProcessInner"), true);
});

test("chunkFile keeps csharp file_path values repo-relative", () => {
  const filePath = path.join(fixturesRoot, "basic-class.cs");
  const content = readFixture("basic-class.cs");
  const chunks = chunkFile(filePath, content, workspaceRoot, defaultChunkerOptions)
    .filter((chunk) => chunk.chunk_type !== "module");

  assert.equal(chunks.every((chunk) => !chunk.file_path.startsWith("/")), true);
});

test("csharp ids follow the <file>::<type>::<name> format", () => {
  const { chunks } = parseCSharpFixture("basic-class.cs");
  const classChunk = chunks.find((chunk) => chunk.chunk_type === "class");

  assert.equal(classChunk?.id, "src/__tests__/fixtures/csharp/basic-class.cs::class::UserService");
});

test("chunkFile adds a module chunk for csharp fixtures", () => {
  const filePath = path.join(fixturesRoot, "basic-class.cs");
  const content = readFixture("basic-class.cs");
  const chunks = chunkFile(filePath, content, workspaceRoot, defaultChunkerOptions);

  assert.equal(chunks.some((chunk) => chunk.chunk_type === "module"), true);
});
