import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";
import type Database from "better-sqlite3";

import { openDb } from "../db/connection.js";
import { runGc } from "../db/gc.js";
import { runMigrations } from "../db/migrate.js";
import { scanWorkspace } from "../indexer/cdc.js";
import { IndexingSupervisor } from "../indexer/supervisor.js";
import { resolveCliConfig } from "./config.js";

type InitDependencies = {
  openDbImpl?: typeof openDb;
  runGcImpl?: typeof runGc;
  runMigrationsImpl?: typeof runMigrations;
  scanWorkspaceImpl?: typeof scanWorkspace;
  supervisorFactory?: (dbPath: string, workspaceRoot: string) => Pick<IndexingSupervisor, "die" | "sendBatch">;
};

type InitOptions = {
  config?: string;
  workspace?: string;
};

export type InitResult = {
  dbPath: string;
  filesIndexed: number;
  initialized: boolean;
};

export async function runInit(
  options: InitOptions = {},
  dependencies: InitDependencies = {}
): Promise<InitResult> {
  const workspaceRoot = path.resolve(options.workspace ?? process.cwd());
  const config = resolveCliConfig(workspaceRoot, options.config);
  const dataDirectory = path.join(workspaceRoot, ".pythia");
  const dbPath = path.join(dataDirectory, "lcs.db");
  const openDbImpl = dependencies.openDbImpl ?? openDb;
  const runMigrationsImpl = dependencies.runMigrationsImpl ?? runMigrations;
  const runGcImpl = dependencies.runGcImpl ?? runGc;
  const scanWorkspaceImpl = dependencies.scanWorkspaceImpl ?? scanWorkspace;
  const supervisorFactory = dependencies.supervisorFactory ?? ((resolvedDbPath, resolvedWorkspaceRoot) => (
    new IndexingSupervisor(resolvedDbPath, resolvedWorkspaceRoot)
  ));
  const alreadyInitialized = existsSync(dbPath);

  mkdirSync(dataDirectory, { recursive: true });

  const db = openDbImpl(dbPath);

  try {
    runMigrationsImpl(db);
    runGcImpl(db, config.gc.deleted_chunk_retention_days);

    if (alreadyInitialized) {
      return {
        dbPath,
        filesIndexed: 0,
        initialized: false
      };
    }

    const fileChanges = await scanWorkspaceImpl(workspaceRoot, db, true);

    db.close();

    if (fileChanges.length === 0) {
      return {
        dbPath,
        filesIndexed: 0,
        initialized: true
      };
    }

    const supervisor = supervisorFactory(dbPath, workspaceRoot);

    try {
      await supervisor.sendBatch(fileChanges.map((change) => change.filePath), "boot");
    } finally {
      await supervisor.die();
    }

    return {
      dbPath,
      filesIndexed: fileChanges.length,
      initialized: true
    };
  } finally {
    if (db.open) {
      db.close();
    }
  }
}

export const initCommand = new Command("init")
  .description("Bootstrap a workspace: create .pythia/, run migrations, and cold-start index")
  .option("--workspace <path>", "Workspace root to initialize")
  .option("--config <path>", "Path to a Pythia config file")
  .action(async (options: InitOptions) => {
    const result = await runInit(options);

    if (result.initialized) {
      console.log(`Pythia initialized. Indexed ${result.filesIndexed} files.`);
    }
  });
