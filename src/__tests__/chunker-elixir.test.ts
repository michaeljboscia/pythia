import assert from "node:assert/strict";
import test from "node:test";

import Parser from "tree-sitter";
import Elixir from "tree-sitter-elixir";

import { chunkFile } from "../indexer/chunker-treesitter.js";
import { extractElixirChunks } from "../indexer/chunker-elixir.js";

const workspaceRoot = process.cwd();
const defaultChunkerOptions = {
  max_chunk_chars: {},
  oversize_strategy: "split" as const
};

let cachedParser: Parser | null = null;

function getElixirParser(): Parser {
  if (cachedParser !== null) {
    return cachedParser;
  }

  const parser = new Parser();
  parser.setLanguage(Elixir as Parser.Language);
  cachedParser = parser;
  return parser;
}

function parseElixir(content: string, filePath: string) {
  const rootNode = getElixirParser().parse(content).rootNode;
  return extractElixirChunks(rootNode, filePath);
}

function idsForType(chunks: Array<{ id: string; chunk_type: string }>, chunkType: string): string[] {
  return chunks.filter((chunk) => chunk.chunk_type === chunkType).map((chunk) => chunk.id);
}

test("empty Elixir file returns no chunks", () => {
  const chunks = parseElixir("", "src/__tests__/fixtures/elixir/empty.ex");
  assert.deepEqual(chunks, []);
});

test("defmodule emits module chunk", () => {
  const chunks = parseElixir("defmodule Greeter do\nend", "src/__tests__/fixtures/elixir/module.ex");
  assert.deepEqual(idsForType(chunks, "module"), [
    "src/__tests__/fixtures/elixir/module.ex::module::Greeter"
  ]);
});

test("def inside defmodule emits module and function chunks", () => {
  const content = "defmodule Greeter do\n  def hello(), do: :ok\nend";
  const chunks = parseElixir(content, "src/__tests__/fixtures/elixir/def.ex");
  assert.equal(idsForType(chunks, "module").length, 1);
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/elixir/def.ex::function::hello"), true);
});

test("defp emits function chunk", () => {
  const content = "defmodule Greeter do\n  defp hidden(), do: :ok\nend";
  const chunks = parseElixir(content, "src/__tests__/fixtures/elixir/defp.ex");
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/elixir/defp.ex::function::hidden"), true);
});

test("defmacro emits function chunk", () => {
  const content = "defmodule Greeter do\n  defmacro hello(), do: :ok\nend";
  const chunks = parseElixir(content, "src/__tests__/fixtures/elixir/defmacro.ex");
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/elixir/defmacro.ex::function::hello"), true);
});

test("defprotocol emits interface chunk", () => {
  const content = "defprotocol Greeter do\nend";
  const chunks = parseElixir(content, "src/__tests__/fixtures/elixir/protocol.ex");
  assert.deepEqual(idsForType(chunks, "interface"), [
    "src/__tests__/fixtures/elixir/protocol.ex::interface::Greeter"
  ]);
});

test("multiple defs emit separate function chunks", () => {
  const content = "defmodule Greeter do\n  def a(), do: :ok\n  def b(), do: :ok\nend";
  const chunks = parseElixir(content, "src/__tests__/fixtures/elixir/multi.ex");
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/elixir/multi.ex::function::a"), true);
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/elixir/multi.ex::function::b"), true);
});

test("nested modules emit chunks for each module", () => {
  const content = "defmodule Outer do\n  defmodule Inner do\n  end\nend";
  const chunks = parseElixir(content, "src/__tests__/fixtures/elixir/nested.ex");
  assert.equal(idsForType(chunks, "module").includes("src/__tests__/fixtures/elixir/nested.ex::module::Outer"), true);
  assert.equal(idsForType(chunks, "module").includes("src/__tests__/fixtures/elixir/nested.ex::module::Inner"), true);
});

test("module name retains dot notation", () => {
  const chunks = parseElixir("defmodule Foo.Bar do\nend", "src/__tests__/fixtures/elixir/dotted.ex");
  assert.deepEqual(idsForType(chunks, "module"), [
    "src/__tests__/fixtures/elixir/dotted.ex::module::Foo.Bar"
  ]);
});

test("function with args extracts name", () => {
  const chunks = parseElixir("defmodule Greeter do\n  def greet(name), do: name\nend", "src/__tests__/fixtures/elixir/args.ex");
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/elixir/args.ex::function::greet"), true);
});

test("no-arg function with keyword syntax is captured", () => {
  const chunks = parseElixir("defmodule Greeter do\n  def hello(), do: :ok\nend", "src/__tests__/fixtures/elixir/no-arg.ex");
  assert.equal(idsForType(chunks, "function").includes("src/__tests__/fixtures/elixir/no-arg.ex::function::hello"), true);
});

test("non-def call is ignored", () => {
  const chunks = parseElixir("IO.puts(\"x\")", "src/__tests__/fixtures/elixir/ignored.ex");
  assert.deepEqual(chunks, []);
});

test("language field is elixir for all chunks", () => {
  const content = "defmodule Greeter do\n  def hello(), do: :ok\nend";
  const chunks = parseElixir(content, "src/__tests__/fixtures/elixir/lang.ex");
  assert.equal(chunks.every((chunk) => chunk.language === "elixir"), true);
});

test("chunkFile handles .exs extension", () => {
  const content = "defmodule Greeter do\n  def hello(), do: :ok\nend";
  const chunks = chunkFile("test.exs", content, workspaceRoot, defaultChunkerOptions);
  assert.equal(chunks.some((chunk) => chunk.chunk_type === "module"), true);
});
