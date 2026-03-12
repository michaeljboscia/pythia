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
const backends = ["local", "ollama", "vertex_ai", "voyage"];
const dimensions = [128, 256, 512, 768];
const corpora = ["pythia", "hyva", "luma"];

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

function writeGlobalConfig(backend, dimension) {
  const existing = readJsonIfExists(globalConfigPath) ?? {};
  const configDirectory = path.dirname(globalConfigPath);
  mkdirSync(configDirectory, { recursive: true });

  const embeddings = buildEmbeddingsConfig(backend, dimension);
  writeFileSync(globalConfigPath, `${JSON.stringify({ ...existing, embeddings }, null, 2)}\n`, "utf8");
}

function buildEmbeddingsConfig(backend, dimension) {
  switch (backend) {
    case "local":
      return {
        mode: "local",
        dimensions: dimension,
      };
    case "ollama":
      return {
        mode: "openai_compatible",
        dimensions: dimension,
        base_url: process.env.PYTHIA_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
        api_key: process.env.PYTHIA_OLLAMA_API_KEY ?? "ollama",
        model: process.env.PYTHIA_OLLAMA_MODEL ?? "nomic-embed-text",
      };
    case "vertex_ai":
      return {
        mode: "vertex_ai",
        dimensions: dimension,
        project: requiredEnv("PYTHIA_VERTEX_PROJECT"),
        location: process.env.PYTHIA_VERTEX_LOCATION ?? "us-central1",
        model: process.env.PYTHIA_VERTEX_MODEL ?? "text-embedding-005",
      };
    case "voyage":
      return {
        mode: "openai_compatible",
        dimensions: dimension,
        base_url: process.env.PYTHIA_VOYAGE_BASE_URL ?? "https://api.voyageai.com/v1",
        api_key: requiredEnv("PYTHIA_VOYAGE_API_KEY"),
        model: process.env.PYTHIA_VOYAGE_MODEL ?? "voyage-code-2",
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
  const defaultQueries = path.join(repoRoot, "benchmarks", "queries", `${corpus}.yaml`);

  switch (corpus) {
    case "pythia":
      return {
        workspace: process.env.PYTHIA_MATRIX_PYTHIA_WORKSPACE ?? repoRoot,
        queries: process.env.PYTHIA_MATRIX_PYTHIA_QUERIES ?? defaultQueries,
      };
    case "hyva":
      return {
        workspace: process.env.PYTHIA_MATRIX_HYVA_WORKSPACE ?? requiredEnv("PYTHIA_MATRIX_HYVA_WORKSPACE"),
        queries: process.env.PYTHIA_MATRIX_HYVA_QUERIES ?? defaultQueries,
      };
    case "luma":
      return {
        workspace: process.env.PYTHIA_MATRIX_LUMA_WORKSPACE ?? requiredEnv("PYTHIA_MATRIX_LUMA_WORKSPACE"),
        queries: process.env.PYTHIA_MATRIX_LUMA_QUERIES ?? defaultQueries,
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
  const originalGlobalConfig = existsSync(globalConfigPath)
    ? readFileSync(globalConfigPath, "utf8")
    : null;

  if (combos.length === 0) {
    throw new Error("No backend/dimension/corpus combinations matched the current filters.");
  }

  ensureBuilt();

  try {
    for (const combo of combos) {
      const id = comboId(combo);
      const comboDir = comboDirectory(combo);
      const summaryPath = comboSummaryPath(combo);
      const corpus = corpusConfig(combo.corpus);

      if (options.resume && existsSync(summaryPath)) {
        console.log(`SKIP ${id} (summary.json already exists)`);
        continue;
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

      console.log(`RUN ${id}`);
      writeGlobalConfig(combo.backend, combo.dimension);

      runPythia(["init", "--force", "--workspace", corpus.workspace, "--config", globalConfigPath]);
      runPythia([
        "benchmark",
        "--workspace",
        corpus.workspace,
        "--queries",
        corpus.queries,
        "--output",
        comboDir,
        "--config",
        globalConfigPath,
      ]);

      flattenLatestRunArtifacts(comboDir);
    }
  } finally {
    if (originalGlobalConfig === null) {
      rmSync(globalConfigPath, { force: true });
    } else {
      mkdirSync(path.dirname(globalConfigPath), { recursive: true });
      writeFileSync(globalConfigPath, originalGlobalConfig, "utf8");
    }
  }
}

await main();
