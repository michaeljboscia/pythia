#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli", "main.js");
const globalConfigPath = path.join(os.homedir(), ".pythia", "config.json");
const defaultQueriesPath = path.join(repoRoot, "scripts", "sprint-6-proof-queries.yaml");
const pocMatrixDirectory = path.join(repoRoot, "benchmarks", "poc-matrix");
const backends = ["local", "openai_compatible"];
const dimensions = [128, 256, 512];
const corpora = ["src_only", "src_plus_docs"];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    only: undefined,
    resume: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--resume") {
      options.resume = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--only") {
      options.only = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function selectorMatches(selector, comboId, combo) {
  if (!selector) {
    return true;
  }

  return comboId.includes(selector)
    || combo.backend === selector
    || combo.corpus === selector
    || String(combo.dimension) === selector;
}

function ensureBuilt() {
  if (!existsSync(cliPath)) {
    execFileSync("npm", ["run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeConfigFile(configPath, backend, dimension) {
  const existing = readJsonIfExists(globalConfigPath) ?? {};
  const embeddings = buildEmbeddingsConfig(backend, dimension);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({ ...existing, embeddings }, null, 2)}\n`, "utf8");
}

function buildEmbeddingsConfig(backend, dimension) {
  switch (backend) {
    case "local":
      return {
        mode: "local",
        dimensions: dimension,
      };
    case "openai_compatible":
      return {
        mode: "openai_compatible",
        dimensions: dimension,
        base_url: process.env.PYTHIA_MATRIX_OPENAI_BASE_URL ?? "http://127.0.0.1:11434/v1",
        api_key: process.env.PYTHIA_MATRIX_OPENAI_API_KEY ?? "ollama",
        model: process.env.PYTHIA_MATRIX_OPENAI_MODEL ?? "nomic-embed-text",
      };
    default:
      throw new Error(`Unsupported backend: ${backend}`);
  }
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function corpusConfig(corpus) {
  const defaultWorkspace = process.env.PYTHIA_MATRIX_WORKSPACE ?? repoRoot;
  const defaultQueries = process.env.PYTHIA_MATRIX_QUERIES ?? defaultQueriesPath;

  switch (corpus) {
    case "src_only":
      return {
        workspace: process.env.PYTHIA_MATRIX_SRC_ONLY_WORKSPACE ?? defaultWorkspace,
        queries: process.env.PYTHIA_MATRIX_SRC_ONLY_QUERIES ?? defaultQueries,
      };
    case "src_plus_docs":
      return {
        workspace: process.env.PYTHIA_MATRIX_SRC_PLUS_DOCS_WORKSPACE ?? defaultWorkspace,
        queries: process.env.PYTHIA_MATRIX_SRC_PLUS_DOCS_QUERIES ?? defaultQueries,
      };
    default:
      throw new Error(`Unsupported corpus: ${corpus}`);
  }
}

function comboId(combo) {
  return `${combo.backend}_${combo.dimension}_${combo.corpus}`;
}

function comboDirectory(combo) {
  return path.join(repoRoot, "benchmarks", "results", comboId(combo));
}

function comboSummaryPath(combo) {
  return path.join(comboDirectory(combo), "summary.json");
}

function comboResultPath(combo) {
  return path.join(pocMatrixDirectory, `${comboId(combo)}.json`);
}

function runPythia(args) {
  execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function latestRunDirectory(parentDir) {
  const children = readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      mtimeMs: statSync(path.join(parentDir, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (children.length === 0) {
    throw new Error(`No benchmark run directory found in ${parentDir}`);
  }

  return path.join(parentDir, children[0].name);
}

function flattenLatestRunArtifacts(comboDir) {
  const latestRunDir = latestRunDirectory(comboDir);

  for (const fileName of ["config.json", "summary.json", "queries.jsonl", "summary.md"]) {
    copyFileSync(path.join(latestRunDir, fileName), path.join(comboDir, fileName));
  }
}

function listCombos(selector) {
  const combinations = [];

  for (const backend of backends) {
    for (const dimension of dimensions) {
      for (const corpus of corpora) {
        const combo = { backend, dimension, corpus };
        const id = comboId(combo);

        if (!selectorMatches(selector, id, combo)) {
          continue;
        }

        combinations.push(combo);
      }
    }
  }

  return combinations;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const combos = listCombos(options.only);

  if (combos.length === 0) {
    throw new Error("No backend/dimension/corpus combinations matched the current filters.");
  }

  if (!options.dryRun) {
    ensureBuilt();
  }

  for (const combo of combos) {
    const id = comboId(combo);
    const comboDir = comboDirectory(combo);
    const summaryPath = comboSummaryPath(combo);
    const resultPath = comboResultPath(combo);
    const tempConfigPath = path.join(os.tmpdir(), `pythia-poc-matrix-${id}.json`);
    const corpus = corpusConfig(combo.corpus);

    if (options.resume && existsSync(resultPath)) {
      try {
        const priorResult = JSON.parse(readFileSync(resultPath, "utf8"));

        if (priorResult && typeof priorResult.status === "string") {
          console.log(`SKIP ${id} (valid result already exists)`);
          continue;
        }
      } catch {
        // Corrupted or incomplete result file — rerun this combination.
      }
    }

    if (options.dryRun) {
      console.log(`${id} :: workspace=${corpus.workspace} :: queries=${corpus.queries}`);
      continue;
    }

    if (!existsSync(corpus.workspace)) {
      throw new Error(`Workspace does not exist for ${id}: ${corpus.workspace}`);
    }

    if (!existsSync(corpus.queries)) {
      throw new Error(`Query set does not exist for ${id}: ${corpus.queries}`);
    }

    rmSync(comboDir, { recursive: true, force: true });
    mkdirSync(comboDir, { recursive: true });
    mkdirSync(pocMatrixDirectory, { recursive: true });

    console.log(`RUN ${id}`);
    writeConfigFile(tempConfigPath, combo.backend, combo.dimension);

    try {
      const initStart = Date.now();
      runPythia(["init", "--force", "--workspace", corpus.workspace, "--config", tempConfigPath]);
      const initWallClockMs = Date.now() - initStart;

      runPythia([
        "benchmark",
        "--workspace",
        corpus.workspace,
        "--queries",
        corpus.queries,
        "--output",
        comboDir,
        "--config",
        tempConfigPath,
      ]);

      flattenLatestRunArtifacts(comboDir);

      writeFileSync(resultPath, `${JSON.stringify({
        status: "success",
        combo_id: id,
        backend: combo.backend,
        dimension: combo.dimension,
        corpus: combo.corpus,
        workspace: corpus.workspace,
        queries: corpus.queries,
        benchmark_output_dir: comboDir,
        summary_path: summaryPath,
        init_wall_clock_ms: initWallClockMs,
        completed_at: new Date().toISOString(),
      }, null, 2)}\n`, "utf8");
    } finally {
      rmSync(tempConfigPath, { force: true });
    }
  }
}

await main();
