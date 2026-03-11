import assert from "node:assert/strict";
import test from "node:test";

import { embedQuery } from "../indexer/embedder.js";

function magnitude(vector: Float32Array): number {
  let sumOfSquares = 0;

  for (const value of vector) {
    sumOfSquares += value * value;
  }

  return Math.sqrt(sumOfSquares);
}

test("embedQuery returns a Float32Array of length 256", async () => {
  const embedding = await embedQuery("hello");

  assert.ok(embedding instanceof Float32Array);
  assert.equal(embedding.length, 256);
});

test("same input produces identical output", async () => {
  const first = await embedQuery("hello");
  const second = await embedQuery("hello");

  assert.deepEqual(Array.from(first), Array.from(second));
});

test("output is L2-normalized", async () => {
  const embedding = await embedQuery("hello");
  const length = magnitude(embedding);

  assert.ok(Math.abs(length - 1) <= 0.001, `Expected magnitude close to 1, received ${length}`);
});
