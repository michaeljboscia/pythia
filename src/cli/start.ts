import { existsSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";
import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { PythiaConfig } from "../config.js";
import { openDb } from "../db/connection.js";
import { runGc } from "../db/gc.js";
import { runMigrations } from "../db/migrate.js";
import { scanWorkspace } from "../indexer/cdc.js";
import { IndexingSupervisor } from "../indexer/supervisor.js";
import { registerTools } from "../mcp/tools.js";
import { resolveCliConfig } from "./config.js";

type StartDependencies = {
  createServer?: () => McpServer;
  createTransport?: () => Transport;
  openDbImpl?: typeof openDb;
  runGcImpl?: typeof runGc;
  runMigrationsImpl?: typeof runMigrations;
  scanWorkspaceImpl?: typeof scanWorkspace;
  supervisorFactory?: (dbPath: string, workspaceRoot: string) => IndexingSupervisor;
};

type StartOptions = {
  config?: string;
  workspace?: string;
};

export type StartResult = {
  config: PythiaConfig;
  db: Database.Database;
  server: McpServer;
  supervisor: IndexingSupervisor;
};

export async function runStart(
  options: StartOptions = {},
  dependencies: StartDependencies = {}
): Promise<StartResult> {
  const workspaceRoot = path.resolve(options.workspace ?? process.cwd());
  const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");

  if (!existsSync(dbPath)) {
    throw new Error("Run 'pythia init' first.");
  }

  const config = resolveCliConfig(workspaceRoot, options.config);
  const openDbImpl = dependencies.openDbImpl ?? openDb;
  const runMigrationsImpl = dependencies.runMigrationsImpl ?? runMigrations;
  const runGcImpl = dependencies.runGcImpl ?? runGc;
  const scanWorkspaceImpl = dependencies.scanWorkspaceImpl ?? scanWorkspace;
  const supervisorFactory = dependencies.supervisorFactory ?? ((resolvedDbPath, resolvedWorkspaceRoot) => (
    new IndexingSupervisor(resolvedDbPath, resolvedWorkspaceRoot)
  ));
  const createServer = dependencies.createServer ?? (() => new McpServer({ name: "pythia", version: "1.0.0" }));
  const createTransport = dependencies.createTransport ?? (() => new StdioServerTransport());
  const db = openDbImpl(dbPath);
  const supervisor = supervisorFactory(dbPath, workspaceRoot);
  const server = createServer();

  runMigrationsImpl(db);
  runGcImpl(db, config.gc.deleted_chunk_retention_days);
  registerTools(server, db, config, supervisor);

  if (config.indexing.scan_on_start) {
    const fileChanges = await scanWorkspaceImpl(workspaceRoot, db, false);

    if (fileChanges.length > 0) {
      void supervisor.sendBatch(fileChanges.map((change) => change.filePath), "warm").catch((error) => {
        console.error("[pythia] Warm scan failed:", error);
      });
    }
  }

  await server.connect(createTransport());
  console.error("[pythia] MCP server started on stdio");

  return {
    config,
    db,
    server,
    supervisor
  };
}

export const startCommand = new Command("start")
  .description("Launch the MCP server (requires prior `pythia init`)")
  .option("--workspace <path>", "Workspace root to serve")
  .option("--config <path>", "Path to a Pythia config file")
  .action(async (options: StartOptions) => {
    try {
      await runStart(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
