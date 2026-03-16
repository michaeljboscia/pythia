import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  type Dirent
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import type Database from "better-sqlite3";

import { openDb } from "../db/connection.js";
import { runGc } from "../db/gc.js";
import { runMigrations } from "../db/migrate.js";
import { scanWorkspace } from "../indexer/cdc.js";
import { computeCorpusHealth, type CorpusHealthReport } from "../indexer/health.js";
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
  force?: boolean;
  workspace?: string;
};

export type InitResult = {
  dbPath: string;
  filesIndexed: number;
  initialized: boolean;
};

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");
const UNIVERSAL_IGNORE_RULES = [".git/", "*.lock", "*.log", "coverage/"];

type ProjectMarker = {
  detect: (entries: Dirent[]) => boolean;
  name: string;
  rules: string[];
};

const PROJECT_MARKERS: ProjectMarker[] = [
  {
    name: "Node.js",
    detect: (entries) => entries.some((entry) => entry.isFile() && entry.name === "package.json"),
    rules: ["node_modules/", "dist/", "dist-test/", ".next/", ".nuxt/", ".turbo/"]
  },
  {
    name: "Python",
    detect: (entries) => entries.some((entry) => entry.isFile() && (
      entry.name === "requirements.txt" || entry.name === "pyproject.toml"
    )),
    rules: ["__pycache__/", ".venv/", "venv/", "site-packages/", "*.pyc", ".pytest_cache/", "dist/", "build/"]
  },
  {
    name: "Go",
    detect: (entries) => entries.some((entry) => entry.isFile() && entry.name === "go.mod"),
    rules: ["vendor/", "bin/"]
  },
  {
    name: "Rust",
    detect: (entries) => entries.some((entry) => entry.isFile() && entry.name === "Cargo.toml"),
    rules: ["target/"]
  },
  {
    name: "Ruby",
    detect: (entries) => entries.some((entry) => entry.isFile() && entry.name === "Gemfile"),
    rules: ["vendor/bundle/", ".bundle/"]
  },
  {
    name: "C#",
    detect: (entries) => entries.some((entry) => entry.isFile() && entry.name.endsWith(".csproj")),
    rules: ["bin/", "obj/", "packages/"]
  }
];

function ensurePythiaIgnore(workspaceRoot: string): void {
  let entries: Dirent[];

  try {
    entries = readdirSync(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[WARNING] Could not read workspace root: ${message}. Skipping .pythiaignore generation.\n`);
    return;
  }

  const detectedMarkers = PROJECT_MARKERS.filter((marker) => marker.detect(entries));
  const recommendedRules = new Set<string>(UNIVERSAL_IGNORE_RULES);

  for (const marker of detectedMarkers) {
    for (const rule of marker.rules) {
      recommendedRules.add(rule);
    }
  }

  const ignorePath = path.join(workspaceRoot, ".pythiaignore");
  const rules = [...recommendedRules];
  const detectedNames = detectedMarkers.map((marker) => marker.name);
  const ignoreExists = existsSync(ignorePath);
  const isZeroByte = ignoreExists && statSync(ignorePath).size === 0;

  if (!ignoreExists || isZeroByte) {
    writeFileSync(ignorePath, `${rules.join("\n")}\n`, "utf8");

    if (detectedNames.length === 0) {
      console.log("[Pythia] No project markers detected. Created .pythiaignore with universal rules only.");
      return;
    }

    console.log(`[Pythia] Detected: ${detectedNames.join(", ")}`);
    console.log(`[Pythia] Created .pythiaignore with ${rules.length} ignore rules.`);
    return;
  }

  const existingContent = readFileSync(ignorePath, "utf8");
  const existingLines = new Set(existingContent.split(/\r?\n/u));
  const missingRules = rules.filter((rule) => !existingLines.has(rule));

  if (detectedNames.length > 0) {
    console.log(`[Pythia] Detected: ${detectedNames.join(", ")}`);
  }

  if (missingRules.length === 0) {
    console.log("[Pythia] .pythiaignore is up to date.");
    return;
  }

  const additionHeader = existingContent.endsWith("\n")
    ? "\n# Pythia recommended additions\n"
    : "\n\n# Pythia recommended additions\n";

  writeFileSync(ignorePath, `${existingContent}${additionHeader}${missingRules.join("\n")}\n`, "utf8");
  console.log(`[Pythia] Appended ${missingRules.length} recommended rules to existing .pythiaignore.`);
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

function printCorpusHealthSummary(report: CorpusHealthReport): void {
  const avgLength = report.avg_chunk_length_chars === null
    ? "N/A"
    : `${formatNumber(report.avg_chunk_length_chars)} chars`;
  const topPaths = report.top_path_prefixes.length === 0
    ? "(none)"
    : report.top_path_prefixes
      .map((entry) => `${entry.prefix} (${formatNumber(entry.count)})`)
      .join(", ");

  console.log("=== Pythia Corpus Health ===");
  console.log(`Verdict:    ${report.verdict}`);
  console.log(`Reason:     ${report.verdict_reason}`);
  console.log(`Chunks:     ${formatNumber(report.total_chunks)}`);
  console.log(`Files:      ${formatNumber(report.total_files)}`);
  console.log(`Avg length: ${avgLength}`);
  console.log(`Top paths:  ${topPaths}`);
  console.log("============================");
}

function reportCorpusHealth(dbPath: string, openDbImpl: typeof openDb): CorpusHealthReport {
  const healthDb = openDbImpl(dbPath);
  let report: CorpusHealthReport;

  try {
    report = computeCorpusHealth(healthDb);
  } finally {
    healthDb.close();
  }

  printCorpusHealthSummary(report);
  return report;
}

function recreateVectorTable(db: Database.Database, dimensions: number, resetDerivedData: boolean): void {
  db.exec("BEGIN IMMEDIATE");

  try {
    db.exec("DROP TABLE IF EXISTS vec_lcs_chunks");

    if (resetDerivedData) {
      db.exec("DELETE FROM embedding_meta WHERE id = 1");
      db.exec("DELETE FROM file_scan_cache");
      db.exec("DELETE FROM lcs_chunks");
      db.exec("DELETE FROM fts_lcs_chunks_kw");
      db.exec("DELETE FROM fts_lcs_chunks_sub");
      db.exec("DELETE FROM graph_edges WHERE edge_type IN ('CALLS','IMPORTS','CONTAINS','DEFINES')");
    }

    db.exec(`
      CREATE VIRTUAL TABLE vec_lcs_chunks USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[${dimensions}]
      )
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

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
    new IndexingSupervisor(resolvedDbPath, resolvedWorkspaceRoot, {
      embeddingsConfig: config.embeddings,
      indexingConfig: config.indexing,
      retentionDays: config.gc.deleted_chunk_retention_days
    })
  ));
  const alreadyInitialized = existsSync(dbPath);
  const targetDimensions = config.embeddings.dimensions ?? 256;

  mkdirSync(dataDirectory, { recursive: true });
  ensurePythiaIgnore(workspaceRoot);

  const db = openDbImpl(dbPath);

  try {
    runMigrationsImpl(db);
    runGcImpl(db, config.gc.deleted_chunk_retention_days);

    if (options.force) {
      recreateVectorTable(db, targetDimensions, true);
    } else if (!alreadyInitialized && targetDimensions !== 256) {
      recreateVectorTable(db, targetDimensions, false);
    }

    if (alreadyInitialized && !options.force) {
      const report = reportCorpusHealth(dbPath, openDbImpl);

      if (report.verdict === "WARN" || report.verdict === "DEGRADED") {
        console.log("[Pythia] Tip: run `pythia init --force` to reindex with the updated .pythiaignore.");
      }

      return {
        dbPath,
        filesIndexed: 0,
        initialized: false
      };
    }

    const fileChanges = await scanWorkspaceImpl(
      workspaceRoot,
      db,
      options.force === true,
      { maxFiles: config.indexing.max_files }
    );

    db.close();

    if (fileChanges.length === 0) {
      reportCorpusHealth(dbPath, openDbImpl);
      return {
        dbPath,
        filesIndexed: 0,
        initialized: true
      };
    }

    const filePaths = fileChanges.map((change) => change.filePath);
    const BATCH_SIZE = 50;

    if (config.embeddings.mode === "local" && config.embeddings.dtype === "fp32") {
      const totalMemGB = os.totalmem() / (1024 ** 3);

      if (totalMemGB < 16) {
        process.stderr.write(`\n[WARNING] Machine has ${Math.round(totalMemGB)}GB RAM. Using dtype="fp32" may cause high memory pressure. Consider setting dtype="q8" in ~/.pythia/config.json.\n\n`);
      }
    }

    // Warn on large workspaces with local CPU embedder
    if (filePaths.length > 100) {
      const cpuCount = os.cpus().length;
      process.stderr.write(
        `\nWarning: ${filePaths.length} files to index using local CPU embedder (${cpuCount} cores).\n` +
        `This may take several minutes. To speed this up:\n` +
        `  • Add a .pythiaignore to exclude large directories (docs/, research/)\n` +
        `  • Set embeddings.mode = "openai_compatible" in ~/.pythia/config.json\n\n`
      );
    }

    const supervisor = supervisorFactory(dbPath, workspaceRoot);

    try {
      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const chunk = filePaths.slice(i, i + BATCH_SIZE);
        process.stderr.write(`Indexing files ${i + 1}–${Math.min(i + BATCH_SIZE, filePaths.length)} of ${filePaths.length}...\n`);
        await supervisor.sendBatch(chunk, "boot");
      }
    } finally {
      await supervisor.die();
    }

    reportCorpusHealth(dbPath, openDbImpl);

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
  .option("--force", "Drop and rebuild derived embedding/index tables before reindexing")
  .action(async (options: InitOptions) => {
    const result = await runInit(options);

    if (result.initialized) {
      console.log(`Pythia initialized. Indexed ${result.filesIndexed} files.`);
    }
  });
