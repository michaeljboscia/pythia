#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repoRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const buildResult = spawnSync("npm", ["run", "build:test", "--silent"], {
  cwd: repoRoot,
  encoding: "utf8"
});
assert.equal(
  buildResult.status,
  0,
  `npm run build:test failed\nSTDOUT:\n${buildResult.stdout}\nSTDERR:\n${buildResult.stderr}`
);

const chunkerModulePath = path.join(repoRoot, "dist-test", "src", "indexer", "chunker-treesitter.js");
const { chunkFile } = await import(pathToFileURL(chunkerModulePath).href);
const distCliPath = path.join(repoRoot, "dist-test", "src", "cli", "main.js");

const phase1Root = mkdtempSync(path.join(os.tmpdir(), "pythia-proof-phase1-"));
const phase2Root = mkdtempSync(path.join(os.tmpdir(), "pythia-proof-phase2-"));

try {
  // Phase 1 — Swift/Kotlin/Elixir chunking
  const swiftContent = "class MyClass { func greet() -> String { return \"hello\" } }";
  const swiftPath = path.join(phase1Root, "test.swift");
  writeFileSync(swiftPath, swiftContent, "utf8");

  const swiftChunks = chunkFile(swiftPath, swiftContent, phase1Root);
  assert.ok(swiftChunks.length > 0, "expected Swift chunks");
  assert.ok(
    swiftChunks.some((chunk) => chunk.language === "swift" && (chunk.chunk_type === "function" || chunk.chunk_type === "class")),
    "expected Swift function or class chunk"
  );

  const kotlinContent = "class Greeter { fun greet(): String = \"hello\" }";
  const kotlinPath = path.join(phase1Root, "test.kt");
  writeFileSync(kotlinPath, kotlinContent, "utf8");

  const kotlinChunks = chunkFile(kotlinPath, kotlinContent, phase1Root);
  assert.ok(
    kotlinChunks.some((chunk) => chunk.language === "kotlin" && chunk.chunk_type === "class"),
    "expected Kotlin class chunk"
  );

  const elixirContent = "defmodule Greeter do\n  def hello(), do: \"world\"\nend";
  const elixirPath = path.join(phase1Root, "test.ex");
  writeFileSync(elixirPath, elixirContent, "utf8");

  const elixirChunks = chunkFile(elixirPath, elixirContent, phase1Root);
  assert.ok(
    elixirChunks.some((chunk) => chunk.language === "elixir" && chunk.chunk_type === "module"),
    "expected Elixir module chunk"
  );
  assert.ok(
    elixirChunks.some((chunk) => chunk.language === "elixir" && chunk.chunk_type === "function"),
    "expected Elixir function chunk"
  );

  console.log("PASS 1/4 — Swift/Kotlin/Elixir chunking works");

  // Phase 2 — max_files cap
  writeFileSync(path.join(phase2Root, "one.ts"), "export const one = 1;\n", "utf8");
  writeFileSync(path.join(phase2Root, "two.ts"), "export const two = 2;\n", "utf8");
  writeFileSync(path.join(phase2Root, "three.swift"), "class Three {}\n", "utf8");
  writeFileSync(path.join(phase2Root, "four.kt"), "class Four {}\n", "utf8");
  writeFileSync(path.join(phase2Root, "five.ex"), "defmodule Five do\nend\n", "utf8");

  const configPath = path.join(phase2Root, "pythia-config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      indexing: {
        max_files: 3
      }
    }, null, 2),
    "utf8"
  );

  const initResult = spawnSync(
    "node",
    [distCliPath, "init", "--workspace", phase2Root, "--config", configPath],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(
    initResult.status,
    0,
    `pythia init failed\nSTDOUT:\n${initResult.stdout}\nSTDERR:\n${initResult.stderr}`
  );
  const initOutput = `${initResult.stdout}${initResult.stderr}`;
  assert.ok(initOutput.includes("File cap reached"), "expected File cap reached warning");

  const dbPath = path.join(phase2Root, ".pythia", "lcs.db");
  const db = new Database(dbPath);
  const row = db.prepare("SELECT COUNT(*) AS count FROM file_scan_cache").get();
  db.close();
  assert.ok(row.count <= 3, `expected <= 3 indexed files, got ${row.count}`);

  console.log("PASS 2/4 — max_files cap enforces 3 files");

  // Phase 3 — --perf flag on already-initialized workspace
  const perfResult = spawnSync(
    "node",
    [distCliPath, "init", "--workspace", phase2Root, "--config", configPath, "--perf"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(
    perfResult.status,
    0,
    `pythia init --perf failed\nSTDOUT:\n${perfResult.stdout}\nSTDERR:\n${perfResult.stderr}`
  );
  const perfOutput = `${perfResult.stdout}${perfResult.stderr}`;
  assert.ok(perfOutput.includes("[Pythia] Peak RSS:"), "expected Peak RSS output");

  console.log("PASS 3/4 — --perf prints Peak RSS on re-init");

  // Phase 4 — csn-benchmark --help includes embedding-config
  const helpResult = spawnSync(
    "node",
    [path.join(repoRoot, "scripts", "csn-benchmark.mjs"), "--help"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(
    helpResult.status,
    0,
    `csn-benchmark --help failed\nSTDOUT:\n${helpResult.stdout}\nSTDERR:\n${helpResult.stderr}`
  );
  const helpOutput = `${helpResult.stdout}${helpResult.stderr}`;
  assert.ok(helpOutput.includes("--embedding-config"), "expected --embedding-config in help output");

  console.log("PASS 4/4 — csn-benchmark --help lists --embedding-config");
} finally {
  rmSync(phase1Root, { recursive: true, force: true });
  rmSync(phase2Root, { recursive: true, force: true });
}
