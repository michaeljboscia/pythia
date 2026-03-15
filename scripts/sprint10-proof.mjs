#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "pythia-proof-"));

try {
  writeFileSync(path.join(workspaceRoot, "package.json"), JSON.stringify({
    name: "pythia-proof",
    version: "1.0.0"
  }, null, 2), "utf8");

  const initResult = spawnSync(
    "npx",
    ["tsx", path.join(repoRoot, "src", "cli", "main.ts"), "init", "--workspace", workspaceRoot],
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

  const ignorePath = path.join(workspaceRoot, ".pythiaignore");
  assert.equal(existsSync(ignorePath), true);
  assert.match(readFileSync(ignorePath, "utf8"), /node_modules\//u);
  assert.match(initResult.stdout, /\[Pythia\] Detected: Node\.js/u);
  assert.match(initResult.stdout, /=== Pythia Corpus Health ===/u);

  console.log("PASS 1/2 — CLI init created .pythiaignore and printed corpus health");

  // --- PHASE 2: corpus-health MCP verification ---

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", path.join(repoRoot, "src", "cli", "main.ts"), "start", "--workspace", workspaceRoot],
    stderr: "inherit"
  });
  const client = new Client(
    { name: "pythia-sprint10-proof", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    const result = await client.callTool(
      { name: "pythia_corpus_health", arguments: {} },
      undefined,
      { timeout: 60_000 }
    );

    assert.ok(result.content && result.content.length > 0, "expected text content from pythia_corpus_health");
    assert.equal(result.content[0].type, "text");

    const payload = JSON.parse(result.content[0].text);

    assert.equal(payload.verdict, "WARN");
    assert.equal(payload.verdict_reason, "No files were indexed. Check your .pythiaignore and workspace path.");
  } finally {
    await client.close();
  }

  console.log("PASS 2/2 — MCP corpus health reports the expected WARN-empty payload");
} finally {
  rmSync(workspaceRoot, { recursive: true, force: true });
}
