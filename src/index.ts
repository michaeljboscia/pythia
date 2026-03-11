import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { loadConfig, type PythiaConfig } from "./config.js";
import { openDb } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { registerTools } from "./mcp/tools.js";

export type PythiaRuntime = {
  config: PythiaConfig;
  db: Database.Database;
  server: McpServer;
};

export function initializeRuntime(configPath?: string): PythiaRuntime {
  const config = loadConfig(configPath);
  const dataDirectory = path.join(config.workspace_path, ".pythia");
  const dbPath = path.join(dataDirectory, "lcs.db");

  mkdirSync(dataDirectory, { recursive: true });

  const db = openDb(dbPath);
  runMigrations(db);

  const server = new McpServer({ name: "pythia", version: "1.0.0" });
  registerTools(server, db, config);

  return { config, db, server };
}

export async function startServer(
  transport: Transport = new StdioServerTransport(),
  configPath?: string
): Promise<PythiaRuntime> {
  const runtime = initializeRuntime(configPath);

  await runtime.server.connect(transport);
  console.error("[pythia] MCP server started on stdio");

  return runtime;
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
