import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { extractApiSurface } from "../indexer/api-surface-extractor.js";
import { createApiSurfaceHandler } from "../mcp/api-surface.js";

function createTempFixtureDir(): { cleanup: () => void; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "pythia-api-surface-"));

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

describe("extractApiSurface", () => {
  it("returns ts-morph strategy for a TypeScript file", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "math.ts");
      writeFileSync(filePath, "export function add(a: number, b: number): number { return a + b; }\n", "utf8");

      const [result] = await extractApiSurface(filePath);

      assert.equal(result?.strategy, "ts-morph");
      assert.ok((result?.surface.length ?? 0) > 0);
    } finally {
      cleanup();
    }
  });

  it("includes a TypeScript function signature in the emitted surface", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "math.ts");
      writeFileSync(filePath, "export function add(a: number, b: number): number { return a + b; }\n", "utf8");

      const [result] = await extractApiSurface(filePath);

      assert.match(result?.surface ?? "", /add/);
      assert.match(result?.surface ?? "", /number/);
    } finally {
      cleanup();
    }
  });

  it("returns tree-sitter strategy for a Python file", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "math.py");
      writeFileSync(filePath, "def add(value):\n    return value + 1\n", "utf8");

      const [result] = await extractApiSurface(filePath);

      assert.equal(result?.strategy, "tree-sitter");
    } finally {
      cleanup();
    }
  });

  it("strips Python function bodies from the skeleton output", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "math.py");
      writeFileSync(filePath, "def add(value):\n    return value + 1\n", "utf8");

      const [result] = await extractApiSurface(filePath);

      assert.match(result?.surface ?? "", /def add/);
      assert.doesNotMatch(result?.surface ?? "", /return value \+ 1/);
      assert.match(result?.surface ?? "", /\{ \.\.\. \}/);
    } finally {
      cleanup();
    }
  });

  it("returns unsupported for an unknown extension", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "notes.xyz");
      const [result] = await extractApiSurface(filePath);

      assert.deepEqual(result, {
        path: filePath,
        surface: "",
        strategy: "unsupported"
      });
    } finally {
      cleanup();
    }
  });

  it("expands globs and returns multiple results", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n", "utf8");
      writeFileSync(path.join(dir, "b.ts"), "export const b = 2;\n", "utf8");

      const results = await extractApiSurface(path.join(dir, "*.ts"));

      assert.ok(results.length >= 2);
      assert.ok(results.every((result) => result.strategy === "ts-morph"));
    } finally {
      cleanup();
    }
  });

  it("returns a single result for a literal file path", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "single.ts");
      writeFileSync(filePath, "export const value = 42;\n", "utf8");

      const results = await extractApiSurface(filePath);

      assert.equal(results.length, 1);
      assert.equal(results[0]?.path, filePath);
    } finally {
      cleanup();
    }
  });

  it("handles an empty TypeScript file without throwing", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "empty.ts");
      writeFileSync(filePath, "", "utf8");

      const [result] = await extractApiSurface(filePath);

      assert.equal(result?.strategy, "ts-morph");
      assert.equal(typeof result?.surface, "string");
    } finally {
      cleanup();
    }
  });

  it("returns content array with text payload from the MCP handler", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const filePath = path.join(dir, "handler.ts");
      writeFileSync(filePath, "export function ping(): string { return 'pong'; }\n", "utf8");

      const handler = createApiSurfaceHandler();
      const result = await handler({ path: filePath });

      assert.equal(result.content[0]?.type, "text");
      const parsed = JSON.parse(result.content[0]?.text ?? "[]") as Array<{ strategy: string }>;
      assert.equal(parsed[0]?.strategy, "ts-morph");
    } finally {
      cleanup();
    }
  });

  it("throws a meaningful error for a missing supported file", async () => {
    const missingPath = path.join(tmpdir(), "pythia-api-surface-does-not-exist.ts");

    await assert.rejects(
      extractApiSurface(missingPath),
      /API_SURFACE_PATH_NOT_FOUND/
    );
  });

  it("returns an empty array when a glob pattern matches nothing", async () => {
    const { dir, cleanup } = createTempFixtureDir();

    try {
      const results = await extractApiSurface(path.join(dir, "*.rb"));

      assert.deepEqual(results, []);
    } finally {
      cleanup();
    }
  });
});
