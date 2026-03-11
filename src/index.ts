import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { loadConfig, type PythiaConfig } from "./config.js";
import { openDb } from "./db/connection.js";
import { runGc } from "./db/gc.js";
import { runMigrations } from "./db/migrate.js";
import { scanWorkspace } from "./indexer/cdc.js";
import { IndexingSupervisor } from "./indexer/supervisor.js";
import { registerTools } from "./mcp/tools.js";
import { runInit } from "./cli/init.js";

export type PythiaRuntime = {
  config: PythiaConfig;
  db: Database.Database;
  server: McpServer;
  supervisor: IndexingSupervisor;
};

async function startWarmScan(
  config: PythiaConfig,
  db: Database.Database,
  supervisor: IndexingSupervisor
): Promise<void> {
  if (!config.indexing.scan_on_start) {
    return;
  }

  const fileChanges = await scanWorkspace(config.workspace_path, db, false);

  if (fileChanges.length === 0) {
    return;
  }

  void supervisor.sendBatch(fileChanges.map((change) => change.filePath), "warm").catch((error) => {
    console.error("[pythia] Warm scan failed:", error);
  });
}

export async function initializeRuntimeWithConfig(
  config: PythiaConfig,
  configPath?: string
): Promise<PythiaRuntime> {
  const dataDirectory = path.join(config.workspace_path, ".pythia");
  const dbPath = path.join(dataDirectory, "lcs.db");

  if (!existsSync(dbPath)) {
    await runInit({
      config: configPath,
      workspace: config.workspace_path
    });
  }

  const db = openDb(dbPath);
  runMigrations(db);
  runGc(db, config.gc.deleted_chunk_retention_days);
  const supervisor = new IndexingSupervisor(dbPath, config.workspace_path, {
    retentionDays: config.gc.deleted_chunk_retention_days
  });
  const server = new McpServer({ name: "pythia", version: "1.0.0" });

  registerTools(server, db, config, supervisor);
  await startWarmScan(config, db, supervisor);

  return { config, db, server, supervisor };
}

export async function initializeRuntime(configPath?: string): Promise<PythiaRuntime> {
  const config = loadConfig(configPath);
  return initializeRuntimeWithConfig(config, configPath);
}

export async function startServerWithConfig(
  config: PythiaConfig,
  transport: Transport = new StdioServerTransport(),
  configPath?: string
): Promise<PythiaRuntime> {
  const runtime = await initializeRuntimeWithConfig(config, configPath);

  await runtime.server.connect(transport);
  console.error("[pythia] MCP server started on stdio");

  return runtime;
}

export async function startServer(
  transport: Transport = new StdioServerTransport(),
  configPath?: string
): Promise<PythiaRuntime> {
  const config = loadConfig(configPath);
  return startServerWithConfig(config, transport, configPath);
}

async function main(): Promise<void> {
  await startServer();
}

const invokedPath = process.argv[1];
const isDirectExecution = invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error("[pythia] Fatal startup error:", error);
    process.exit(1);
  });
}
