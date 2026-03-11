import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { openDb } from "../db/connection.js";
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
    await runtime?.supervisor.die();
    runtime?.db.close();
    cleanup();
  }
});

test("all 6 tool names are registered", async () => {
  const { cleanup, configPath } = createConfigFile();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pythia-test-client", version: "1.0.0" });
  let runtime: Awaited<ReturnType<typeof initializeRuntime>> | null = null;

  try {
    runtime = await initializeRuntime(configPath);
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
    await runtime?.supervisor.die();
    runtime?.db.close();
    cleanup();
  }
});

test("MCP startup with no lcs.db auto-initializes the workspace", async () => {
  const { cleanup, configPath } = createConfigFile();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pythia-test-client", version: "1.0.0" });
  let runtime: Awaited<ReturnType<typeof startServer>> | null = null;

  try {
    runtime = await startServer(serverTransport, configPath);
    await client.connect(clientTransport);

    assert.equal(runtime.db.open, true);
    assert.equal(existsSync(path.join(runtime.config.workspace_path, ".pythia", "lcs.db")), true);
  } finally {
    await client.close();
    await runtime?.server.close();
    await runtime?.supervisor.die();
    runtime?.db.close();
    cleanup();
  }
});

test("MCP startup with current schema is a migration no-op", async () => {
  const { cleanup, configPath } = createConfigFile();
  let firstRuntime: Awaited<ReturnType<typeof initializeRuntime>> | null = null;
  let secondRuntime: Awaited<ReturnType<typeof initializeRuntime>> | null = null;

  try {
    firstRuntime = await initializeRuntime(configPath);
    const dbPath = path.join(firstRuntime.config.workspace_path, ".pythia", "lcs.db");
    const before = openDb(dbPath);

    let migrationCountBefore = 0;

    try {
      const row = before.prepare("SELECT COUNT(*) AS count FROM _migrations").get() as { count: number };
      migrationCountBefore = row.count;
    } finally {
      before.close();
    }

    await firstRuntime.supervisor.die();
    firstRuntime.db.close();
    firstRuntime = null;

    secondRuntime = await initializeRuntime(configPath);

    const after = openDb(dbPath);

    try {
      const row = after.prepare("SELECT COUNT(*) AS count FROM _migrations").get() as { count: number };
      assert.equal(row.count, migrationCountBefore);
    } finally {
      after.close();
    }
  } finally {
    await firstRuntime?.supervisor.die();
    firstRuntime?.db.close();
    await secondRuntime?.supervisor.die();
    secondRuntime?.db.close();
    cleanup();
  }
});
