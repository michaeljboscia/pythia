import assert from "node:assert/strict";
import test from "node:test";

import { splitOversizedChunks } from "../indexer/chunk-splitter.js";

function buildChunk(overrides: Partial<{
  id: string;
  chunk_type: string;
  content: string;
  start_line: number;
  end_line: number;
}> = {}) {
  return {
    id: overrides.id ?? "src/example.ts::function::render",
    file_path: "src/example.ts",
    chunk_type: overrides.chunk_type ?? "function",
    content: overrides.content ?? "const value = true;\n",
    start_line: overrides.start_line ?? 0,
    end_line: overrides.end_line ?? 0,
    language: "typescript"
  };
}

test("oversized function chunk splits into three parts at newline boundaries", () => {
  const chunk = buildChunk({
    content: `${"a".repeat(900)}\n${"b".repeat(900)}\n${"c".repeat(900)}`,
    end_line: 2
  });

  const parts = splitOversizedChunks([chunk], { function: 1000 }, "split");

  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((part) => part.id), [
    "src/example.ts::function::render#part1",
    "src/example.ts::function::render#part2",
    "src/example.ts::function::render#part3"
  ]);
  assert.equal(parts[0].start_line, 0);
  assert.equal(parts[0].end_line, 0);
  assert.equal(parts[1].start_line, 1);
  assert.equal(parts[1].end_line, 1);
  assert.equal(parts[2].start_line, 2);
  assert.equal(parts[2].end_line, 2);
});

test("split chunk ids preserve #L disambiguators before #part suffixes", () => {
  const chunk = buildChunk({
    id: "src/example.ts::function::render#L42",
    content: `${"a".repeat(900)}\n${"b".repeat(900)}`,
    start_line: 42,
    end_line: 43
  });

  const parts = splitOversizedChunks([chunk], { function: 1000 }, "split");

  assert.deepEqual(parts.map((part) => part.id), [
    "src/example.ts::function::render#L42#part1",
    "src/example.ts::function::render#L42#part2"
  ]);
});

test("truncate strategy appends [TRUNCATED] and does not split", () => {
  const chunk = buildChunk({
    content: `${"x".repeat(1200)}\n${"y".repeat(1200)}`,
    end_line: 1
  });

  const [truncated] = splitOversizedChunks([chunk], { function: 1000 }, "truncate");

  assert.equal(truncated.id, "src/example.ts::function::render");
  assert.ok(truncated.content.endsWith("\n...[TRUNCATED]"));
  assert.equal(truncated.content.includes("#part"), false);
});

test("chunks below their limit are unchanged", () => {
  const chunk = buildChunk({ content: "short content\n", end_line: 0 });
  const [result] = splitOversizedChunks([chunk], { function: 1000 }, "split");

  assert.deepEqual(result, chunk);
});

test("missing chunk type limits pass through unchanged", () => {
  const chunk = buildChunk({
    chunk_type: "element",
    id: "src/example.ts::element::node",
    content: "x".repeat(1500)
  });

  const [result] = splitOversizedChunks([chunk], { function: 1000 }, "split");

  assert.deepEqual(result, chunk);
});

test("2500-char function chunks split into three parts at a 1000-char limit", () => {
  const content = `${"a".repeat(999)}\n${"b".repeat(999)}\n${"c".repeat(500)}`;
  const chunk = buildChunk({ content, end_line: 2 });

  const parts = splitOversizedChunks([chunk], { function: 1000 }, "split");

  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((part) => part.id), [
    "src/example.ts::function::render#part1",
    "src/example.ts::function::render#part2",
    "src/example.ts::function::render#part3"
  ]);
});

test("truncate strategy keeps one chunk and appends the truncation marker", () => {
  const content = "x".repeat(2500);
  const chunk = buildChunk({ content });

  const parts = splitOversizedChunks([chunk], { function: 1000 }, "truncate");

  assert.equal(parts.length, 1);
  assert.equal(parts[0].id, "src/example.ts::function::render");
  assert.equal(parts[0].content.startsWith("x".repeat(1000)), true);
  assert.equal(parts[0].content.endsWith("\n...[TRUNCATED]"), true);
});

test("unknown chunk types pass through unchanged even when content exceeds known limits", () => {
  const chunk = buildChunk({
    id: "src/example.ts::custom_unknown::payload",
    chunk_type: "custom_unknown",
    content: "z".repeat(2500)
  });

  const parts = splitOversizedChunks([chunk], { function: 1000 }, "split");

  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0], chunk);
});

test("split chunk ids preserve #L42 before each generated #part suffix", () => {
  const chunk = buildChunk({
    id: "src/example.ts::function::render#L42",
    content: `${"a".repeat(999)}\n${"b".repeat(600)}`,
    start_line: 42,
    end_line: 43
  });

  const parts = splitOversizedChunks([chunk], { function: 1000 }, "split");

  assert.deepEqual(parts.map((part) => part.id), [
    "src/example.ts::function::render#L42#part1",
    "src/example.ts::function::render#L42#part2"
  ]);
});
