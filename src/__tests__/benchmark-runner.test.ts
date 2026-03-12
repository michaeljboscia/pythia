import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type Database from "better-sqlite3";
import { stringify as stringifyYaml } from "yaml";
import type { SearchResponse } from "../retrieval/hybrid.js";

import { runBenchmark, type BenchmarkQuery } from "../benchmark/runner.js";
import { runBenchmarkCommand } from "../cli/benchmark.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";

type BenchmarkWorkspace = {
  cleanup: () => void;
  configPath: string;
  dbPath: string;
  workspaceRoot: string;
};

function createBenchmarkWorkspace(): BenchmarkWorkspace {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-benchmark-"));
  const dbDir = path.join(workspaceRoot, ".pythia");
  const configPath = path.join(workspaceRoot, "benchmark-config.json");
  const dbPath = path.join(dbDir, "lcs.db");

  mkdirSync(dbDir, { recursive: true });
  mkdirSync(path.join(workspaceRoot, "benchmarks"), { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    embeddings: {
      mode: "local",
      dimensions: 256
    }
  }, null, 2), "utf8");

  const db = openDb(dbPath);

  try {
    runMigrations(db);
  } finally {
    db.close();
  }

  return {
    workspaceRoot,
    dbPath,
    configPath,
    cleanup: () => {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  };
}

function insertChunk(db: Database.Database, chunkId: string): void {
  db.prepare(`
    INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
  `).run(
    chunkId,
    path.join("src", `${chunkId.replaceAll("::", "_")}.ts`),
    "function",
    `content for ${chunkId}`,
    1,
    1,
    `hash:${chunkId}`
  );
}

function writeQueries(workspaceRoot: string, fileName: string, queries: BenchmarkQuery[]): string {
  const queriesPath = path.join(workspaceRoot, "benchmarks", fileName);
  writeFileSync(queriesPath, stringifyYaml(queries), "utf8");
  return queriesPath;
}

function makeSearchResult(id: string, score = 1): SearchResponse["results"][number] {
  return {
    id,
    file_path: path.join("src", `${id.replaceAll("::", "_")}.ts`),
    chunk_type: "function",
    content: `content for ${id}`,
    start_line: 1,
    end_line: 1,
    language: "typescript",
    score
  };
}

function createStubSearch(resultsByQuery: Record<string, string[]>) {
  return async (query: string): Promise<SearchResponse> => ({
    results: (resultsByQuery[query] ?? []).map((id, index) => makeSearchResult(id, 1 - (index * 0.1))),
    rerankerUsed: false
  });
}

function createStubEmbedder() {
  return {
    embedChunks: async () => [],
    embedQuery: async () => new Float32Array(256),
    warm: async () => undefined
  };
}

const DEFAULT_CONFIG = {
  backend: "local",
  dimensions: 256,
  embedding_batch_size: 32,
  embedding_concurrency: 1
} as const;

test("runBenchmark computes precision@1 when the first result is relevant", async () => {
  const queries: BenchmarkQuery[] = [{
    id: "q-001",
    query: "where is foo",
    type: "definitional",
    difficulty: "easy",
    relevant_chunks: ["chunk-a"]
  }];

  const run = await runBenchmark(queries, DEFAULT_CONFIG, {
    chunkExists: () => true,
    runId: "run-001",
    search: createStubSearch({
      "where is foo": ["chunk-a", "chunk-b"]
    })
  });

  assert.equal(run.summary.precision_at_1, 1);
  assert.equal(run.queries[0].metrics.precision_at_1, 1);
});

test("runBenchmark computes MRR of 0.5 when the first relevant result is at rank 2", async () => {
  const queries: BenchmarkQuery[] = [{
    id: "q-002",
    query: "where is bar",
    type: "implementation",
    difficulty: "medium",
    relevant_chunks: ["chunk-b"]
  }];

  const run = await runBenchmark(queries, DEFAULT_CONFIG, {
    chunkExists: () => true,
    search: createStubSearch({
      "where is bar": ["chunk-a", "chunk-b", "chunk-c"]
    })
  });

  assert.equal(run.queries[0].metrics.rr, 0.5);
  assert.equal(run.summary.mrr, 0.5);
});

test("runBenchmark computes NDCG@10 for a simple graded-position case", async () => {
  const queries: BenchmarkQuery[] = [{
    id: "q-003",
    query: "find both",
    type: "semantic",
    difficulty: "hard",
    relevant_chunks: ["chunk-a", "chunk-b"]
  }];

  const run = await runBenchmark(queries, DEFAULT_CONFIG, {
    chunkExists: () => true,
    search: createStubSearch({
      "find both": ["chunk-b", "chunk-x", "chunk-a"]
    })
  });

  const expected = (1 + (1 / Math.log2(4))) / (1 + (1 / Math.log2(3)));
  assert.ok(Math.abs(run.queries[0].metrics.ndcg_at_10 - expected) < 1e-9);
});

test("runBenchmark flags zero-result queries and excludes them from aggregate MRR", async () => {
  const queries: BenchmarkQuery[] = [
    {
      id: "q-004",
      query: "missing",
      type: "semantic",
      difficulty: "easy",
      relevant_chunks: ["chunk-a"]
    },
    {
      id: "q-005",
      query: "found second",
      type: "semantic",
      difficulty: "medium",
      relevant_chunks: ["chunk-b"]
    }
  ];

  const run = await runBenchmark(queries, DEFAULT_CONFIG, {
    chunkExists: () => true,
    search: createStubSearch({
      missing: [],
      "found second": ["chunk-x", "chunk-b"]
    })
  });

  assert.equal(run.queries[0].flags.zero_results, true);
  assert.equal(run.queries[0].metrics.rr, null);
  assert.equal(run.summary.zero_result_queries, 1);
  assert.equal(run.summary.mrr, 0.5);
});

test("runBenchmarkCommand validates the query YAML schema", async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-benchmark-invalid-"));
  const queriesPath = path.join(workspaceRoot, "invalid-queries.yaml");
  const configPath = path.join(workspaceRoot, "config.json");

  writeFileSync(configPath, JSON.stringify({ embeddings: { mode: "local", dimensions: 256 } }, null, 2), "utf8");
  writeFileSync(queriesPath, stringifyYaml([{
    id: "q-invalid",
    query: "missing relevant chunks",
    type: "semantic",
    difficulty: "easy"
  }]), "utf8");

  try {
    await assert.rejects(
      () => runBenchmarkCommand({ workspace: workspaceRoot, queries: queriesPath, config: configPath }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.match(String(error), /relevant_chunks/i);
        return true;
      }
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("runBenchmarkCommand writes benchmarks/baseline.json when --set-baseline passes health checks", async () => {
  const { cleanup, workspaceRoot, configPath, dbPath } = createBenchmarkWorkspace();
  const queries: BenchmarkQuery[] = [
    {
      id: "q-006",
      query: "foo",
      type: "definitional",
      difficulty: "easy",
      relevant_chunks: ["chunk-a"]
    },
    {
      id: "q-007",
      query: "bar",
      type: "implementation",
      difficulty: "medium",
      relevant_chunks: ["chunk-b"]
    }
  ];
  const queriesPath = writeQueries(workspaceRoot, "baseline-queries.yaml", queries);
  const db = openDb(dbPath);

  try {
    insertChunk(db, "chunk-a");
    insertChunk(db, "chunk-b");
  } finally {
    db.close();
  }

  try {
    const run = await runBenchmarkCommand({
      workspace: workspaceRoot,
      queries: queriesPath,
      config: configPath,
      setBaseline: true
    }, {
      createEmbedderImpl: () => createStubEmbedder(),
      searchImpl: async (query) => createStubSearch({
        foo: ["chunk-a"],
        bar: ["chunk-b"]
      })(query)
    });

    const baselinePath = path.join(workspaceRoot, "benchmarks", "baseline.json");
    const summaryPath = path.join(workspaceRoot, "benchmarks", "results", run.run_id, "summary.json");

    assert.equal(existsSync(baselinePath), true);
    assert.equal(existsSync(summaryPath), true);
    assert.equal(JSON.parse(readFileSync(baselinePath, "utf8")).run_id, run.run_id);
  } finally {
    cleanup();
  }
});

test("runBenchmarkCommand refuses --set-baseline when zero-result queries are 20% or more", async () => {
  const { cleanup, workspaceRoot, configPath, dbPath } = createBenchmarkWorkspace();
  const queries: BenchmarkQuery[] = [
    { id: "q-008", query: "a", type: "semantic", difficulty: "easy", relevant_chunks: ["chunk-a"] },
    { id: "q-009", query: "b", type: "semantic", difficulty: "easy", relevant_chunks: ["chunk-b"] },
    { id: "q-010", query: "c", type: "semantic", difficulty: "medium", relevant_chunks: ["chunk-c"] },
    { id: "q-011", query: "d", type: "semantic", difficulty: "medium", relevant_chunks: ["chunk-d"] },
    { id: "q-012", query: "e", type: "semantic", difficulty: "hard", relevant_chunks: ["chunk-e"] }
  ];
  const queriesPath = writeQueries(workspaceRoot, "zero-result-queries.yaml", queries);
  const db = openDb(dbPath);

  try {
    for (const query of queries) {
      insertChunk(db, query.relevant_chunks[0]);
    }
  } finally {
    db.close();
  }

  try {
    await assert.rejects(
      () => runBenchmarkCommand({
        workspace: workspaceRoot,
        queries: queriesPath,
        config: configPath,
        setBaseline: true
      }, {
        createEmbedderImpl: () => createStubEmbedder(),
        searchImpl: async (query) => createStubSearch({
          a: ["chunk-a"],
          b: ["chunk-b"],
          c: ["chunk-c"],
          d: ["chunk-d"],
          e: []
        })(query)
      }),
      /Cannot set baseline: 1 queries returned zero results/
    );

    assert.equal(existsSync(path.join(workspaceRoot, "benchmarks", "baseline.json")), false);
  } finally {
    cleanup();
  }
});

test("runBenchmarkCommand computes baseline diff and writes it to summary.json when baseline.json exists", async () => {
  const { cleanup, workspaceRoot, configPath, dbPath } = createBenchmarkWorkspace();
  const queries: BenchmarkQuery[] = [{
    id: "q-013",
    query: "diff me",
    type: "semantic",
    difficulty: "easy",
    relevant_chunks: ["chunk-a"]
  }];
  const queriesPath = writeQueries(workspaceRoot, "diff-queries.yaml", queries);
  const baselinePath = path.join(workspaceRoot, "benchmarks", "baseline.json");
  const db = openDb(dbPath);

  try {
    insertChunk(db, "chunk-a");
  } finally {
    db.close();
  }

  writeFileSync(baselinePath, JSON.stringify({
    run_id: "baseline-run",
    config: DEFAULT_CONFIG,
    summary: {
      precision_at_1: 0.5,
      precision_at_3: 0.5,
      precision_at_5: 0.5,
      mrr: 0.5,
      ndcg_at_10: 0.5,
      zero_result_queries: 0,
      missing_label_queries: 0
    },
    by_difficulty: {
      easy: { precision_at_1: 0.5, precision_at_3: 0.5, precision_at_5: 0.5, mrr: 0.5, ndcg_at_10: 0.5 },
      medium: { precision_at_1: 0, precision_at_3: 0, precision_at_5: 0, mrr: 0, ndcg_at_10: 0 },
      hard: { precision_at_1: 0, precision_at_3: 0, precision_at_5: 0, mrr: 0, ndcg_at_10: 0 }
    },
    queries: []
  }, null, 2), "utf8");

  try {
    const run = await runBenchmarkCommand({
      workspace: workspaceRoot,
      queries: queriesPath,
      config: configPath
    }, {
      createEmbedderImpl: () => createStubEmbedder(),
      searchImpl: async (query) => createStubSearch({
        "diff me": ["chunk-a"]
      })(query)
    });

    const summaryPath = path.join(workspaceRoot, "benchmarks", "results", run.run_id, "summary.json");
    const persisted = JSON.parse(readFileSync(summaryPath, "utf8"));

    assert.equal(run.baseline_diff?.precision_at_1, 0.5);
    assert.ok(Math.abs((run.baseline_diff?.precision_at_3 ?? 0) - (-1 / 6)) < 1e-12);
    assert.equal(run.baseline_diff?.precision_at_5, -0.3);
    assert.equal(run.baseline_diff?.mrr, 0.5);
    assert.equal(run.baseline_diff?.ndcg_at_10, 0.5);
    assert.deepEqual(persisted.baseline_diff, run.baseline_diff);
  } finally {
    cleanup();
  }
});

test("runBenchmarkCommand discovers the workspace by walking up from cwd", { concurrency: false }, async () => {
  const { cleanup, workspaceRoot, configPath, dbPath } = createBenchmarkWorkspace();
  const queries: BenchmarkQuery[] = [{
    id: "q-014",
    query: "walk up",
    type: "definitional",
    difficulty: "easy",
    relevant_chunks: ["chunk-a"]
  }];
  const queriesPath = writeQueries(workspaceRoot, "queries.yaml", queries);
  const db = openDb(dbPath);
  const nestedDir = path.join(workspaceRoot, "apps", "web");
  const previousCwd = process.cwd();

  try {
    insertChunk(db, "chunk-a");
  } finally {
    db.close();
  }

  mkdirSync(nestedDir, { recursive: true });

  try {
    process.chdir(nestedDir);

    const run = await runBenchmarkCommand({
      config: configPath,
      queries: queriesPath
    }, {
      createEmbedderImpl: () => createStubEmbedder(),
      searchImpl: async (query) => createStubSearch({
        "walk up": ["chunk-a"]
      })(query)
    });

    assert.equal(existsSync(path.join(workspaceRoot, "benchmarks", "results", run.run_id, "summary.md")), true);
  } finally {
    process.chdir(previousCwd);
    cleanup();
  }
});
