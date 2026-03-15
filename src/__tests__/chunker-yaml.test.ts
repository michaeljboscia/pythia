import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { extractYamlChunks } from "../indexer/chunker-yaml.js";

const fixturesRoot = path.resolve(process.cwd(), "src", "__tests__", "fixtures", "yaml");

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesRoot, name), "utf8");
}

function fixturePath(name: string): string {
  return `src/__tests__/fixtures/yaml/${name}`;
}

function parseYamlFixture(name: string) {
  const content = readFixture(name);

  return {
    chunks: extractYamlChunks(content, fixturePath(name))
  };
}

test("simple-config.yaml produces three block chunks", () => {
  const { chunks } = parseYamlFixture("simple-config.yaml");

  assert.equal(chunks.length, 3);
});

test("simple-config.yaml database chunk uses chunk_type block", () => {
  const { chunks } = parseYamlFixture("simple-config.yaml");
  const databaseChunk = chunks.find((chunk) => chunk.id === "src/__tests__/fixtures/yaml/simple-config.yaml::block::database");

  assert.equal(databaseChunk?.chunk_type, "block");
});

test("simple-config.yaml database chunk contains host and localhost", () => {
  const { chunks } = parseYamlFixture("simple-config.yaml");
  const databaseChunk = chunks.find((chunk) => chunk.id === "src/__tests__/fixtures/yaml/simple-config.yaml::block::database");

  assert.match(databaseChunk?.content ?? "", /host/);
  assert.match(databaseChunk?.content ?? "", /localhost/);
});

test("nested-map.yaml produces two block chunks", () => {
  const { chunks } = parseYamlFixture("nested-map.yaml");

  assert.equal(chunks.length, 2);
});

test("nested-map.yaml services chunk contains nested api content", () => {
  const { chunks } = parseYamlFixture("nested-map.yaml");
  const servicesChunk = chunks.find((chunk) => chunk.id === "src/__tests__/fixtures/yaml/nested-map.yaml::block::services");

  assert.match(servicesChunk?.content ?? "", /api:/);
  assert.match(servicesChunk?.content ?? "", /myapp\/api:latest/);
});

test("all yaml chunks use language yaml", () => {
  const { chunks } = parseYamlFixture("nested-map.yaml");

  assert.equal(chunks.every((chunk) => chunk.language === "yaml"), true);
});
