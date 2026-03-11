#!/usr/bin/env node
import { Command } from "commander";

import { initCommand } from "./init.js";
import { startCommand } from "./start.js";
import { mcpInstallCommand } from "./mcp-install.js";
import { migrateCommand } from "./migrate.js";

export function createProgram(): Command {
  const program = new Command();
  const mcp = new Command("mcp");

  program
    .name("pythia")
    .description("Local code intelligence MCP server")
    .version("1.0.0");

  program.addCommand(initCommand);
  program.addCommand(startCommand);

  mcp.description("MCP integration commands");
  mcp.addCommand(mcpInstallCommand);
  program.addCommand(mcp);

  program.addCommand(migrateCommand);

  return program;
}

const isDirectExecution = import.meta.url === new URL(process.argv[1], "file:").href;

if (isDirectExecution) {
  await createProgram().parseAsync(process.argv);
}
