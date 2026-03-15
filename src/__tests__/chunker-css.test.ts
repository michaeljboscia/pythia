import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import Parser from "tree-sitter";
import CSS from "tree-sitter-css";

import { extractCssOrScssChunks } from "../indexer/chunker-css.js";
import type { Chunk, ChunkerOptions } from "../indexer/chunker-treesitter.js";
import { chunkFile } from "../indexer/chunker-treesitter.js";

const workspaceRoot = process.cwd();
const fixturesRoot = path.resolve(workspaceRoot, "src", "__tests__", "fixtures", "css");
const parser = new Parser();

parser.setLanguage(CSS as Parser.Language);

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

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesRoot, name), "utf8");
}

function fixtureRelativePath(name: string): string {
  return path.posix.join("src", "__tests__", "fixtures", "css", name);
}

function fixtureAbsolutePath(name: string): string {
  return path.join(fixturesRoot, name);
}

function strategyFor(name: string): "css" | "scss" {
  return path.extname(name) === ".scss" ? "scss" : "css";
}

function extractFixtureChunks(name: string, overrides: Partial<ChunkerOptions> = {}): Chunk[] {
  const content = readFixture(name);
  const tree = parser.parse(content);

  return extractCssOrScssChunks(
    tree.rootNode,
    fixtureRelativePath(name),
    { ...defaultChunkerOptions, ...overrides },
    strategyFor(name)
  );
}

function chunkFixture(name: string, overrides: Partial<ChunkerOptions> = {}): Chunk[] {
  return chunkFile(
    fixtureAbsolutePath(name),
    readFixture(name),
    workspaceRoot,
    { ...defaultChunkerOptions, ...overrides }
  );
}

function ruleChunks(chunks: Chunk[]): Chunk[] {
  return chunks.filter((chunk) => chunk.chunk_type === "rule");
}

function ruleIds(chunks: Chunk[]): string[] {
  return ruleChunks(chunks).map((chunk) => chunk.id);
}

function assertHasRuleId(chunks: Chunk[], selector: string): void {
  assert.ok(
    ruleIds(chunks).some((id) => id.endsWith(`::${selector}`)),
    `expected a rule chunk for ${selector}`
  );
}

test("basic-rules.css emits rule chunks above the default threshold", () => {
  const chunks = extractFixtureChunks("basic-rules.css");

  assert.equal(ruleChunks(chunks).length, 2);
});

test("basic-rules.css includes a module chunk through chunkFile", () => {
  const chunks = chunkFixture("basic-rules.css");

  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "module").length, 1);
});

test("basic-rules.css rule ids preserve selector names", () => {
  const chunks = extractFixtureChunks("basic-rules.css");

  assertHasRuleId(chunks, ".container");
  assertHasRuleId(chunks, ".button");
});

test("short-rules.css emits no rule chunks at the default threshold", () => {
  const chunks = extractFixtureChunks("short-rules.css");

  assert.equal(ruleChunks(chunks).length, 0);
});

test("short-rules.css stays module-only through chunkFile", () => {
  const chunks = chunkFixture("short-rules.css");

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_type, "module");
});

test("short-rules.css emits one rule chunk per selector when the threshold is lowered", () => {
  const chunks = extractFixtureChunks("short-rules.css", { css_rule_chunk_min_chars: 1 });

  assert.deepEqual(ruleIds(chunks), [
    "src/__tests__/fixtures/css/short-rules.css::rule::.a",
    "src/__tests__/fixtures/css/short-rules.css::rule::.b",
    "src/__tests__/fixtures/css/short-rules.css::rule::.c",
    "src/__tests__/fixtures/css/short-rules.css::rule::.d"
  ]);
});

test("media-queries.css emits at-rule chunks for @media and @supports", () => {
  const chunks = extractFixtureChunks("media-queries.css");
  const atRuleIds = chunks.filter((chunk) => chunk.chunk_type === "at_rule").map((chunk) => chunk.id);

  assert.ok(atRuleIds.some((id) => id.endsWith("::@media (max-width: 768px)")));
  assert.ok(atRuleIds.some((id) => id.endsWith("::@supports (display: grid)")));
});

test("media-queries.css emits a nested rule chunk inside @media for plain CSS", () => {
  const chunks = extractFixtureChunks("media-queries.css");

  assertHasRuleId(chunks, ".container");
});

test("media-queries.css emits a nested rule chunk inside @supports for plain CSS", () => {
  const chunks = extractFixtureChunks("media-queries.css");

  assertHasRuleId(chunks, ".grid-layout");
});

test("media-queries.css respects a lower threshold for short nested @media rules", () => {
  const chunks = extractFixtureChunks("media-queries.css", { css_rule_chunk_min_chars: 1 });

  assertHasRuleId(chunks, ".button");
});

test("scss-mixins.scss emits a mixin chunk for flex-center", () => {
  const chunks = extractFixtureChunks("scss-mixins.scss");

  assert.ok(chunks.some((chunk) => chunk.chunk_type === "mixin" && chunk.id.endsWith("::flex-center")));
});

test("scss-mixins.scss emits a mixin chunk for responsive", () => {
  const chunks = extractFixtureChunks("scss-mixins.scss");

  assert.ok(chunks.some((chunk) => chunk.chunk_type === "mixin" && chunk.id.endsWith("::responsive")));
});

test("scss-mixins.scss emits a function chunk for rem", () => {
  const chunks = extractFixtureChunks("scss-mixins.scss");

  assert.ok(chunks.some((chunk) => chunk.chunk_type === "function" && chunk.id.endsWith("::rem")));
});

test("scss-nesting.scss resolves nested selector paths for .card-header", () => {
  const chunks = extractFixtureChunks("scss-nesting.scss", { css_rule_chunk_min_chars: 1 });

  assertHasRuleId(chunks, ".card .card-header");
});

test("scss-nesting.scss resolves nested selector paths for descendants inside .card-body", () => {
  const chunks = extractFixtureChunks("scss-nesting.scss", { css_rule_chunk_min_chars: 1 });

  assertHasRuleId(chunks, ".card .card-body p");
});

test("scss-nesting.scss still includes a module chunk through chunkFile", () => {
  const chunks = chunkFixture("scss-nesting.scss");

  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "module").length, 1);
});

test("scss-ampersand.scss resolves &:hover to .button:hover", () => {
  const chunks = extractFixtureChunks("scss-ampersand.scss", { css_rule_chunk_min_chars: 1 });

  assertHasRuleId(chunks, ".button:hover");
});

test("scss-ampersand.scss resolves &--primary to .button--primary", () => {
  const chunks = extractFixtureChunks("scss-ampersand.scss", { css_rule_chunk_min_chars: 1 });

  assertHasRuleId(chunks, ".button--primary");
});

test("scss-ampersand.scss resolves &:disabled to .button:disabled", () => {
  const chunks = extractFixtureChunks("scss-ampersand.scss", { css_rule_chunk_min_chars: 1 });

  assertHasRuleId(chunks, ".button:disabled");
});

test("tailwind-utilities.css emits no rule chunks at the default threshold", () => {
  const chunks = extractFixtureChunks("tailwind-utilities.css");

  assert.equal(ruleChunks(chunks).length, 0);
});

test("tailwind-utilities.css includes exactly one module chunk through chunkFile", () => {
  const chunks = chunkFixture("tailwind-utilities.css");

  assert.equal(chunks.filter((chunk) => chunk.chunk_type === "module").length, 1);
});

test("tailwind-utilities.css produces only the module chunk", () => {
  const chunks = chunkFixture("tailwind-utilities.css");

  assert.equal(chunks.length, 1);
});

test("basic-rules.css emits rule chunks when the threshold is lowered to 1", () => {
  const chunks = extractFixtureChunks("basic-rules.css", { css_rule_chunk_min_chars: 1 });

  assert.equal(ruleChunks(chunks).length, 2);
});

test("basic-rules.css emits no rule chunks when the threshold is set above the rule size", () => {
  const chunks = extractFixtureChunks("basic-rules.css", { css_rule_chunk_min_chars: 9999 });

  assert.equal(ruleChunks(chunks).length, 0);
});
