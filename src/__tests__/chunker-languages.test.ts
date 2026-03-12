import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { chunkFile } from "../indexer/chunker-treesitter.js";

const workspaceRoot = "/repo";
const fixturesRoot = path.resolve(process.cwd(), "tests", "fixtures");
const defaultChunkerOptions = {
  css_rule_chunk_min_chars: 80,
  max_chunk_chars: {
    module: 12000,
    class: 8000,
    function: 6000,
    method: 4000,
    trait: 6000,
    interface: 6000,
    rule: 2000,
    at_rule: 4000,
    element: 4000,
    doc: 12000
  },
  oversize_strategy: "split" as const
};

function readFixture(...parts: string[]): string {
  return readFileSync(path.join(fixturesRoot, ...parts), "utf8");
}

function parseExpected(...parts: string[]) {
  return JSON.parse(readFixture(...parts));
}

test("PHP language is registered for .php and .phtml", () => {
  const phpChunks = chunkFile("/repo/example.php", "<?php\nfunction demo() {}\n", workspaceRoot, defaultChunkerOptions);
  const phtmlChunks = chunkFile("/repo/example.phtml", "<div><?= $value ?></div>\n", workspaceRoot, defaultChunkerOptions);

  assert.equal(phpChunks[0].language, "php");
  assert.equal(phtmlChunks[0].language, "php");
});

test("XML language is registered for .xml", () => {
  const chunks = chunkFile("/repo/app/etc/di.xml", "<config />\n", workspaceRoot, defaultChunkerOptions);
  assert.equal(chunks[0].language, "xml");
});

test("CSS language is registered for .css and .scss", () => {
  const cssChunks = chunkFile("/repo/styles.css", ".a { color: red; }\n", workspaceRoot, defaultChunkerOptions);
  const scssChunks = chunkFile("/repo/styles.scss", ".a { color: red; }\n", workspaceRoot, defaultChunkerOptions);

  assert.equal(cssChunks[0].language, "css");
  assert.equal(scssChunks[0].language, "scss");
});

test("SQL language is registered for .sql", () => {
  const chunks = chunkFile("/repo/query.sql", "SELECT 1;\n", workspaceRoot, defaultChunkerOptions);
  assert.equal(chunks[0].language, "sql");
});

test("PHP fixture matches expected chunks", () => {
  const content = readFixture("php", "input.php");
  const chunks = chunkFile("/repo/tests/fixtures/php/input.php", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("php", "expected-chunks.json"));
  assert.ok(chunks.some((chunk) => chunk.chunk_type === "class"));
  assert.ok(chunks.some((chunk) => chunk.chunk_type === "function"));
  assert.ok(chunks.some((chunk) => chunk.id.endsWith("::method::__construct")));
});

test("PHP trait fixture matches expected chunks", () => {
  const content = readFixture("php", "input-trait.php");
  const chunks = chunkFile("/repo/tests/fixtures/php/input-trait.php", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("php", "expected-trait-chunks.json"));
  assert.ok(chunks.some((chunk) => chunk.chunk_type === "trait"));
  assert.ok(!chunks.some((chunk) => chunk.id.includes("::class::LogsMessages")));
});

test("PHTML fixture emits exactly one module chunk", () => {
  const content = readFixture("php", "input.phtml");
  const chunks = chunkFile("/repo/tests/fixtures/php/input.phtml", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("php", "expected-phtml-chunks.json"));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
});

test("di.xml fixture emits element chunks", () => {
  const content = readFixture("xml", "di.xml");
  const chunks = chunkFile("/repo/tests/fixtures/xml/di.xml", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("xml", "expected-di-chunks.json"));
  assert.ok(chunks.some((chunk) => chunk.id.includes("::element::preference[")));
  assert.ok(chunks.some((chunk) => chunk.id.includes("::element::type[")));
  assert.ok(chunks.some((chunk) => chunk.id.includes("::element::virtualType[")));
});

test("layout XML fixture emits layout element chunks", () => {
  const content = readFixture("xml", "layout.xml");
  const chunks = chunkFile(
    "/repo/app/code/Vendor/Module/view/frontend/layout/default.xml",
    content,
    workspaceRoot,
    defaultChunkerOptions
  );
  assert.deepEqual(chunks, parseExpected("xml", "expected-layout-chunks.json"));
  assert.ok(chunks.some((chunk) => chunk.id.includes("::element::block[")));
  assert.ok(chunks.some((chunk) => chunk.id.includes("::element::referenceBlock[")));
  assert.ok(chunks.some((chunk) => chunk.id.includes("::element::referenceContainer[")));
});

test("generic XML fixture stays module-only", () => {
  const content = readFixture("xml", "generic.xml");
  const chunks = chunkFile("/repo/tests/fixtures/xml/generic.xml", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("xml", "expected-generic-chunks.json"));
  assert.equal(chunks.length, 1);
});

test("malformed XML falls back to a single module chunk", () => {
  const chunks = chunkFile("/repo/tests/fixtures/xml/broken/di.xml", "<config><type></config>", workspaceRoot, defaultChunkerOptions);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
});

test("CSS fixture matches expected chunks", () => {
  const content = readFixture("css", "input.css");
  const chunks = chunkFile("/repo/tests/fixtures/css/input.css", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("css", "expected-chunks.json"));
  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "rule").length, 2);
  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "at_rule").length, 1);
  assert.ok(!chunks.some((chunk) => chunk.id.includes("::rule::.mt-4")));
});

test("SCSS fixture matches expected chunks", () => {
  const content = readFixture("scss", "input.scss");
  const chunks = chunkFile("/repo/tests/fixtures/scss/input.scss", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("scss", "expected-chunks.json"));
  assert.ok(chunks.some((chunk) => chunk.chunk_type === "mixin"));
  assert.ok(chunks.some((chunk) => chunk.chunk_type === "function"));
  assert.ok(chunks.some((chunk) => chunk.id.includes("::rule::.parent .child")));
});

test("SQL fixture emits exactly one module chunk", () => {
  const content = readFixture("sql", "input.sql");
  const chunks = chunkFile("/repo/tests/fixtures/sql/input.sql", content, workspaceRoot, defaultChunkerOptions);
  assert.deepEqual(chunks, parseExpected("sql", "expected-chunks.json"));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
});

test("unknown extensions fall back to a module chunk", () => {
  const chunks = chunkFile("/repo/misc/example.xyz", "opaque data\n", workspaceRoot, defaultChunkerOptions);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
  assert.equal(chunks[0].id, "misc/example.xyz::module::default");
});
