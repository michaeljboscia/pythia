import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { Command } from "commander";

type McpServerConfig = {
  args: string[];
  command: string;
  env?: Record<string, string>;
};

type ClaudeConfig = {
  mcpServers?: Record<string, McpServerConfig>;
};

type InstallDependencies = {
  confirm?: (prompt: string) => Promise<boolean>;
  output?: (text: string) => void;
};

type InstallOptions = {
  yes?: boolean;
};

function getClaudeCodeConfigPath(): string {
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }

  return path.join(homedir(), ".config", "claude", "config.json");
}

function defaultOutput(text: string): void {
  process.stdout.write(text);
}

async function defaultConfirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(prompt);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function readClaudeConfig(configPath: string): ClaudeConfig {
  if (!existsSync(configPath)) {
    return {};
  }

  return JSON.parse(readFileSync(configPath, "utf8")) as ClaudeConfig;
}

function writeJsonAtomically(configPath: string, value: ClaudeConfig): void {
  const directory = path.dirname(configPath);
  const tmpPath = `${configPath}.tmp`;

  mkdirSync(directory, { recursive: true });
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmpPath, configPath);
}

export function buildClaudeCodeEntry(workspaceRoot: string): Record<string, McpServerConfig> {
  return {
    pythia: {
      command: "pythia",
      args: ["start", "--workspace", path.resolve(workspaceRoot)]
    }
  };
}

export async function runMcpInstall(
  target: string,
  workspaceRoot: string,
  configPath = getClaudeCodeConfigPath(),
  options: InstallOptions = {},
  dependencies: InstallDependencies = {}
): Promise<{ applied: boolean; configPath: string; preview: Record<string, McpServerConfig> }> {
  if (target !== "claude-code") {
    throw new Error(`Unknown target: ${target}`);
  }

  const outputImpl = dependencies.output ?? defaultOutput;
  const confirmImpl = dependencies.confirm ?? defaultConfirm;
  const preview = buildClaudeCodeEntry(workspaceRoot);
  const existing = readClaudeConfig(configPath);

  outputImpl(`${JSON.stringify(preview, null, 2)}\n`);

  if (!options.yes) {
    const confirmed = await confirmImpl("Apply? [y/N] ");

    if (!confirmed) {
      return {
        applied: false,
        configPath,
        preview
      };
    }
  }

  const updated: ClaudeConfig = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      ...preview
    }
  };

  writeJsonAtomically(configPath, updated);

  return {
    applied: true,
    configPath,
    preview
  };
}

export const mcpInstallCommand = new Command("install")
  .description("Install Pythia into a supported MCP client config")
  .argument("<target>", "Integration target: claude-code")
  .option("--workspace <path>", "Workspace root to wire into the MCP config")
  .option("--yes", "Apply without prompting")
  .action(async (target: string, options: InstallOptions & { workspace?: string }) => {
    const result = await runMcpInstall(
      target,
      path.resolve(options.workspace ?? process.cwd()),
      getClaudeCodeConfigPath(),
      options
    );

    if (result.applied) {
      console.log(`Registered Pythia in ${result.configPath}.`);
    }
  });
