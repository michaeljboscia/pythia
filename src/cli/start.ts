import { existsSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";
import type Database from "better-sqlite3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { PythiaConfig } from "../config.js";
import { IndexingSupervisor } from "../indexer/supervisor.js";
import { resolveCliConfig } from "./config.js";
import { startServerWithConfig } from "../index.js";

type StartDependencies = {
  createTransport?: () => Transport;
  startServerImpl?: (
    config: PythiaConfig,
    transport: Transport,
    configPath?: string
  ) => Promise<StartResult>;
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
  const createTransport = dependencies.createTransport ?? (() => new StdioServerTransport());
  const startServerImpl = dependencies.startServerImpl ?? startServerWithConfig;

  return startServerImpl(config, createTransport(), options.config);
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
