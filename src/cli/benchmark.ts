import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { writeBenchmarkArtifacts, writeBaselineFile, baselineEligible } from "../benchmark/report.js";
import { computeBaselineDiff, runBenchmark, type BenchmarkQuery, type BenchmarkRun } from "../benchmark/runner.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createEmbedder } from "../indexer/embedder.js";
import { search } from "../retrieval/hybrid.js";
import { resolveCliConfig } from "./config.js";

const benchmarkQuerySchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  type: z.enum(["definitional", "semantic", "implementation"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  relevant_chunks: z.array(z.string().min(1)).min(1)
});

const benchmarkQuerySetSchema = z.array(benchmarkQuerySchema).min(1);

type BenchmarkOptions = {
  baseline?: string;
  config?: string;
  output?: string;
  queries?: string;
  setBaseline?: boolean;
  workspace?: string;
};

type BenchmarkCommandDependencies = {
  createEmbedderImpl?: typeof createEmbedder;
  openDbImpl?: typeof openDb;
  runMigrationsImpl?: typeof runMigrations;
  searchImpl?: typeof search;
  writeBaselineFileImpl?: typeof writeBaselineFile;
  writeBenchmarkArtifactsImpl?: typeof writeBenchmarkArtifacts;
};

function discoverWorkspaceRoot(startPath: string): string {
  let current = path.resolve(startPath);

  while (true) {
    if (existsSync(path.join(current, ".pythia", "lcs.db"))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new Error("Unable to find .pythia/lcs.db by walking up from the current directory.");
    }

    current = parent;
  }
}

function loadBenchmarkQueries(queriesPath: string): BenchmarkQuery[] {
  const raw = parseYaml(readFileSync(queriesPath, "utf8")) as unknown;
  return benchmarkQuerySetSchema.parse(raw);
}

function loadBaselineRun(
  workspaceRoot: string,
  resultsRoot: string,
  baselineOverride?: string
): BenchmarkRun | null {
  if (baselineOverride !== undefined) {
    const runPath = path.join(resultsRoot, baselineOverride, "summary.json");

    if (!existsSync(runPath)) {
      throw new Error(`Baseline run "${baselineOverride}" not found at ${runPath}`);
    }

    return JSON.parse(readFileSync(runPath, "utf8")) as BenchmarkRun;
  }

  const baselinePath = path.join(workspaceRoot, "benchmarks", "baseline.json");

  if (!existsSync(baselinePath)) {
    return null;
  }

  return JSON.parse(readFileSync(baselinePath, "utf8")) as BenchmarkRun;
}

function benchmarkMetadata(
  workspaceRoot: string,
  queriesPath: string,
  run: BenchmarkRun
): Record<string, unknown> {
  return {
    workspace_root: workspaceRoot,
    queries_path: queriesPath,
    run_id: run.run_id,
    ...run.config
  };
}

export async function runBenchmarkCommand(
  options: BenchmarkOptions = {},
  dependencies: BenchmarkCommandDependencies = {}
): Promise<BenchmarkRun> {
  const workspaceRoot = options.workspace !== undefined
    ? path.resolve(options.workspace)
    : discoverWorkspaceRoot(process.cwd());
  const queriesPath = path.resolve(options.queries ?? path.join(workspaceRoot, "benchmarks", "queries.yaml"));
  const resultsRoot = path.resolve(options.output ?? path.join(workspaceRoot, "benchmarks", "results"));
  const config = resolveCliConfig(workspaceRoot, options.config);
  const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");
  const queries = loadBenchmarkQueries(queriesPath);
  const openDbImpl = dependencies.openDbImpl ?? openDb;
  const runMigrationsImpl = dependencies.runMigrationsImpl ?? runMigrations;
  const createEmbedderImpl = dependencies.createEmbedderImpl ?? createEmbedder;
  const searchImpl = dependencies.searchImpl ?? search;
  const writeBenchmarkArtifactsImpl = dependencies.writeBenchmarkArtifactsImpl ?? writeBenchmarkArtifacts;
  const writeBaselineFileImpl = dependencies.writeBaselineFileImpl ?? writeBaselineFile;
  const db = openDbImpl(dbPath);
  const embedder = createEmbedderImpl(config.embeddings, { indexingConfig: config.indexing });

  try {
    runMigrationsImpl(db);

    const run = await runBenchmark(queries, {
      backend: config.embeddings.mode,
      dimensions: config.embeddings.dimensions ?? 256,
      embedding_batch_size: config.indexing.embedding_batch_size,
      embedding_concurrency: config.indexing.embedding_concurrency
    }, {
      chunkExists: (chunkId) => {
        const row = db.prepare(`
          SELECT id
          FROM lcs_chunks
          WHERE id = ?
            AND is_deleted = 0
        `).get(chunkId) as { id: string } | undefined;

        return row !== undefined;
      },
      search: (query) => searchImpl(query, "semantic", db, 10, {
        embedQueryImpl: embedder.embedQuery
      })
    });

    const baseline = loadBaselineRun(workspaceRoot, resultsRoot, options.baseline);
    run.baseline_diff = computeBaselineDiff(run.summary, baseline?.summary ?? null);

    const outputDir = path.join(resultsRoot, run.run_id);
    writeBenchmarkArtifactsImpl(outputDir, run, benchmarkMetadata(workspaceRoot, queriesPath, run));

    if (options.setBaseline) {
      if (!baselineEligible(run.summary, queries.length)) {
        if (run.summary.missing_label_queries > 0) {
          throw new Error(
            `Cannot set baseline: ${run.summary.missing_label_queries} queries reference missing labeled chunks. Fix the query set or reindex first.`
          );
        }

        throw new Error(
          `Cannot set baseline: ${run.summary.zero_result_queries} queries returned zero results. Fix the index first.`
        );
      }

      writeBaselineFileImpl(path.join(workspaceRoot, "benchmarks", "baseline.json"), run);
    }

    return run;
  } finally {
    db.close();
  }
}

export const benchmarkCommand = new Command("benchmark")
  .description("Run labeled retrieval benchmarks against the local index")
  .option("--workspace <path>", "Workspace root to benchmark")
  .option("--queries <yaml>", "Path to a benchmark query YAML file")
  .option("--set-baseline", "Promote this run to the workspace baseline if health checks pass")
  .option("--baseline <run_id>", "Compare against a specific prior run ID")
  .option("--output <dir>", "Override the benchmark results directory")
  .option("--config <path>", "Path to a Pythia config file")
  .action(async (options: BenchmarkOptions) => {
    const run = await runBenchmarkCommand(options);
    console.log(
      `Benchmark ${run.run_id}: P@1=${run.summary.precision_at_1.toFixed(4)} ` +
      `MRR=${run.summary.mrr.toFixed(4)} NDCG@10=${run.summary.ndcg_at_10.toFixed(4)}`
    );
  });
