import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { initializeRuntime, startServer } from "../index.js";

function createConfigFile(): { cleanup: () => void; configPath: string } {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-mcp-"));
  const configPath = path.join(workspaceRoot, "config.json");
  const obsidianPath = path.join(workspaceRoot, "vault");

  mkdirSync(obsidianPath, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    workspace_path: workspaceRoot,
    obsidian_vault_path: obsidianPath,
    reasoning: { mode: "cli" },
    embeddings: {
      mode: "local",
      model: "nomic-ai/nomic-embed-text-v1.5",
      revision: "main"
    },
    vector_store: { mode: "sqlite" },
    graph_store: { mode: "sqlite" },
    limits: {
      spawn_chars_max: 16000,
      ask_context_chars_max: 24000,
      session_idle_ttl_minutes: 30
    },
    indexing: {
      scan_on_start: false,
      max_worker_restarts: 3
    },
    gc: {
      deleted_chunk_retention_days: 30
    }
  }), "utf8");

  return {
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
    configPath
  };
}

test("server starts without error and does not call process.exit", async () => {
  const { cleanup, configPath } = createConfigFile();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pythia-test-client", version: "1.0.0" });
  let runtime: Awaited<ReturnType<typeof startServer>> | null = null;

  try {
    runtime = await startServer(serverTransport, configPath);
    await client.connect(clientTransport);

    assert.ok(runtime.server);
    assert.ok(runtime.db.open);
  } finally {
    await client.close();
    await runtime?.server.close();
    runtime?.db.close();
    cleanup();
  }
});

test("all 6 tool names are registered", async () => {
  const { cleanup, configPath } = createConfigFile();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pythia-test-client", version: "1.0.0" });
  let runtime: ReturnType<typeof initializeRuntime> | null = null;

  try {
    runtime = initializeRuntime(configPath);
    await runtime.server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    const toolNames = result.tools.map((tool) => tool.name).sort();

    assert.deepEqual(toolNames, [
      "ask_oracle",
      "lcs_investigate",
      "oracle_commit_decision",
      "oracle_decommission",
      "pythia_force_index",
      "spawn_oracle"
    ]);
  } finally {
    await client.close();
    await runtime?.server.close();
    runtime?.db.close();
    cleanup();
  }
});
