#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const interAgentRoot = "/Users/mikeboscia/.claude/mcp-servers/inter-agent";
const skipFullTest = process.argv.includes("--skip-full-test");
const runningUnderTsx = process.execArgv.some((value) => value.includes("tsx/dist/loader.mjs") || value.includes("tsx/dist/preflight.cjs"));

if (!runningUnderTsx) {
  execFileSync("npx", ["tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  process.exit(0);
}

function run(command, args, cwd = repoRoot) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function runStreaming(command, args, cwd = repoRoot) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}

function vectorOfLength(length) {
  const vector = new Float32Array(length);
  vector[0] = 1;
  return vector;
}

async function withTempDir(prefix, fn) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));

  try {
    return await fn(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function createProofConfig(filePath, embeddings) {
  writeFileSync(filePath, `${JSON.stringify({ embeddings }, null, 2)}\n`, "utf8");
}

function createStubEmbedder() {
  return {
    embedChunks: async () => [],
    embedQuery: async () => vectorOfLength(256),
    warm: async () => undefined,
  };
}

function createStubSearch(resultsByQuery) {
  return async (query) => ({
    results: (resultsByQuery[query] ?? []).map((id, index) => ({
      id,
      file_path: "src/proof.ts",
      chunk_type: "function",
      content: "export function renderWidget() { return true; }",
      start_line: 1,
      end_line: 1,
      language: "typescript",
      score: 1 - (index * 0.1),
    })),
    rerankerUsed: false,
  });
}

function registryEntry(name, oracleDir) {
  return {
    name,
    oracle_dir: oracleDir,
    project_root: repoRoot,
    created_at: new Date().toISOString(),
  };
}

function manifestFixture(name) {
  return {
    schema_version: 1,
    name,
    project: repoRoot,
    version: 1,
    checkpoint_headroom_tokens: 250_000,
    pool_size: 1,
    static_entries: [],
    live_sources: [],
    load_order: ["core_research"],
    created_at: new Date().toISOString(),
  };
}

function stateFixture(name) {
  return {
    schema_version: 1,
    oracle_name: name,
    version: 1,
    spawned_at: new Date().toISOString(),
    discovered_context_window: 2_000_000,
    daemon_pool: [{
      daemon_id: "gd-proof-batch",
      session_name: "daemon-proof-batch",
      session_dir: "/tmp/daemon-proof-batch",
      status: "idle",
      query_count: 0,
      chars_in: 0,
      chars_out: 0,
      last_synced_interaction_id: null,
      last_query_at: null,
      idle_timeout_ms: 300_000,
      last_corpus_sync_hash: null,
      pending_syncs: [],
    }],
    session_chars_at_spawn: 0,
    chars_per_token_estimate: 4,
    token_count_method: "estimate",
    estimated_total_tokens: null,
    estimated_cluster_tokens: null,
    tokens_remaining: 1_000_000,
    query_count: 0,
    last_checkpoint_path: null,
    status: "healthy",
    lock_held_by: null,
    lock_expires_at: null,
    last_error: null,
    last_bootstrap_ack: null,
    next_seq: 1,
    generation_since_reground: 0,
    state_version: 0,
    updated_at: new Date().toISOString(),
  };
}

runStreaming("npm", ["run", "build"], repoRoot);

const {
  openDb,
} = await import(pathToFileURL(path.join(repoRoot, "src", "db", "connection.ts")).href);
const {
  runMigrations,
} = await import(pathToFileURL(path.join(repoRoot, "src", "db", "migrate.ts")).href);
const {
  readEmbeddingMeta,
  writeEmbeddingMetaOnce,
} = await import(pathToFileURL(path.join(repoRoot, "src", "db", "embedding-meta.ts")).href);
const {
  runInit,
} = await import(pathToFileURL(path.join(repoRoot, "src", "cli", "init.ts")).href);
const {
  runBenchmarkCommand,
} = await import(pathToFileURL(path.join(repoRoot, "src", "cli", "benchmark.ts")).href);
const {
  chunkFile,
} = await import(pathToFileURL(path.join(repoRoot, "src", "indexer", "chunker-treesitter.ts")).href);
const {
  indexFile,
  setEmbedChunksForTesting,
} = await import(pathToFileURL(path.join(repoRoot, "src", "indexer", "sync.ts")).href);

const steps = [
  {
    name: "Proof 1 — PHP trait chunks",
    run: () => withTempDir("pythia-s6-proof-trait-", async (workspaceRoot) => {
      const dbPath = path.join(workspaceRoot, "trait.db");
      const fixturePath = path.join(repoRoot, "tests", "fixtures", "php", "input-trait.php");
      const content = readFileSync(fixturePath, "utf8");
      const db = openDb(dbPath);

      try {
        runMigrations(db);
        const chunks = chunkFile(fixturePath, content, repoRoot);
        await indexFile(db, fixturePath, content, {
          chunks,
          embeddings: chunks.map(() => vectorOfLength(256)),
        });

        const traitCount = db.prepare("SELECT COUNT(*) AS count FROM lcs_chunks WHERE chunk_type = 'trait'").get().count;
        const methodIds = db.prepare(`
          SELECT id
          FROM lcs_chunks
          WHERE chunk_type = 'method'
          ORDER BY id
        `).all().map((row) => row.id);

        assert.equal(traitCount, 1);
        assert(methodIds.includes("tests/fixtures/php/input-trait.php::trait::LogsMessages::method::logInfo"));
        assert(methodIds.includes("tests/fixtures/php/input-trait.php::trait::LogsMessages::method::decorate"));
      } finally {
        db.close();
      }
    }),
  },
  {
    name: "Proof 2 — CSS Tailwind threshold",
    run: () => withTempDir("pythia-s6-proof-css-", async (workspaceRoot) => {
      const dbPath = path.join(workspaceRoot, "css.db");
      const fixturePath = path.join(repoRoot, "tests", "fixtures", "css", "input.css");
      const content = readFileSync(fixturePath, "utf8");
      const db = openDb(dbPath);

      try {
        runMigrations(db);
        const chunks = chunkFile(fixturePath, content, repoRoot, { css_rule_chunk_min_chars: 80 });
        await indexFile(db, fixturePath, content, {
          chunks,
          embeddings: chunks.map(() => vectorOfLength(256)),
        });

        const ruleIds = db.prepare(`
          SELECT id
          FROM lcs_chunks
          WHERE chunk_type = 'rule'
          ORDER BY id
        `).all().map((row) => row.id);

        assert.equal(ruleIds.length, 2);
        assert(!ruleIds.some((id) => id.includes(".mt-4")));
        assert(!ruleIds.some((id) => id.includes(".p-2")));
        assert(ruleIds.some((id) => id.includes(".header-navigation")));
        assert(ruleIds.some((id) => id.includes(".footer-links a")));
      } finally {
        db.close();
      }
    }),
  },
  {
    name: "Proof 3 — XML di.xml element chunks",
    run: () => withTempDir("pythia-s6-proof-xml-", async (workspaceRoot) => {
      const dbPath = path.join(workspaceRoot, "xml.db");
      const fixturePath = path.join(repoRoot, "tests", "fixtures", "xml", "di.xml");
      const content = readFileSync(fixturePath, "utf8");
      const db = openDb(dbPath);

      try {
        runMigrations(db);
        const chunks = chunkFile(fixturePath, content, repoRoot);
        await indexFile(db, fixturePath, content, {
          chunks,
          embeddings: chunks.map(() => vectorOfLength(256)),
        });

        const elementIds = db.prepare(`
          SELECT id
          FROM lcs_chunks
          WHERE chunk_type = 'element'
          ORDER BY id
        `).all().map((row) => row.id);

        assert(elementIds.some((id) => id.includes("::element::preference[")));
        assert(elementIds.some((id) => id.includes("::element::type[")));
        assert(elementIds.some((id) => id.includes("::element::virtualType[")));
      } finally {
        db.close();
      }
    }),
  },
  {
    name: "Proof 4 — 512d vectors",
    run: async () => withTempDir("pythia-s6-proof-vec-", async (workspaceRoot) => {
      const configPath = path.join(workspaceRoot, "vertex-proof.json");
      const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");
      const sourcePath = path.join(workspaceRoot, "src", "proof.ts");
      const sourceContent = "export function renderWidget(): boolean { return true; }\n";

      mkdirSync(path.dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, sourceContent, "utf8");
      createProofConfig(configPath, {
        mode: "vertex_ai",
        dimensions: 512,
        project: "proof-project",
        location: "us-central1",
        model: "text-embedding-005",
      });

      await runInit({ workspace: workspaceRoot, config: configPath, force: true }, {
        scanWorkspaceImpl: async () => [],
      });

      const db = openDb(dbPath);

      try {
        writeEmbeddingMetaOnce(db, {
          mode: "vertex_ai",
          dimensions: 512,
          project: "proof-project",
          location: "us-central1",
          model: "text-embedding-005",
        });

        db.prepare("INSERT INTO vec_lcs_chunks(id, embedding) VALUES (?, ?)").run("proof-512", vectorOfLength(512));

        const vecSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_lcs_chunks'").get().sql;
        const meta = readEmbeddingMeta(db);

        assert.match(vecSql, /float\[512\]/);
        assert.equal(meta?.dimensions, 512);
      } finally {
        db.close();
      }
    }),
  },
  {
    name: "Proof 5 — Benchmark output",
    run: async () => withTempDir("pythia-s6-proof-bench-", async (workspaceRoot) => {
      const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");
      const configPath = path.join(workspaceRoot, "benchmark-proof.json");
      const outputDir = path.join(workspaceRoot, "benchmarks", "results");
      const queriesPath = path.join(repoRoot, "scripts", "sprint-6-proof-queries.yaml");

      mkdirSync(path.dirname(dbPath), { recursive: true });
      createProofConfig(configPath, {
        mode: "local",
        dimensions: 256,
      });

      const db = openDb(dbPath);

      try {
        runMigrations(db);
        db.prepare(`
          INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
        `).run(
          "src/proof.ts::function::renderWidget",
          "src/proof.ts",
          "function",
          "export function renderWidget(): boolean { return true; }",
          1,
          1,
          "hash:proof-render-widget",
        );
      } finally {
        db.close();
      }

      const run = await runBenchmarkCommand({
        workspace: workspaceRoot,
        queries: queriesPath,
        output: outputDir,
        config: configPath,
      }, {
        createEmbedderImpl: () => createStubEmbedder(),
        searchImpl: async (query) => createStubSearch({
          "where is renderWidget defined": ["src/proof.ts::function::renderWidget"],
          "which helper handles widget rendering": ["src/proof.ts::function::renderWidget"],
        })(query),
      });

      const summaryPath = path.join(outputDir, run.run_id, "summary.json");
      const markdownPath = path.join(outputDir, run.run_id, "summary.md");
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));

      assert.equal(existsSync(summaryPath), true);
      assert.equal(existsSync(markdownPath), true);
      assert.equal(typeof summary.summary.precision_at_1, "number");
      assert.equal(typeof summary.summary.mrr, "number");
      assert.equal(typeof summary.summary.ndcg_at_10, "number");
      assert(statSync(markdownPath).size > 0);
    }),
  },
  {
    name: "Proof 6 — oracle_add_to_corpus batch mode",
    run: async () => withTempDir("pythia-s6-proof-oracle-", async (workspaceRoot) => {
      const registryPath = path.join(workspaceRoot, "registry.json");
      const oracleDir = path.join(workspaceRoot, "oracle");
      const files = [
        path.join(workspaceRoot, "a.md"),
        path.join(workspaceRoot, "b.md"),
        path.join(workspaceRoot, "c.md"),
      ];
      const oracleName = "sprint-6-proof";

      process.env.PYTHIA_REGISTRY_PATH = registryPath;
      runStreaming("npm", ["run", "build"], interAgentRoot);

      const oracleToolsUrl = pathToFileURL(path.join(interAgentRoot, "dist", "oracle-tools.js")).href;
      const runtimeUrl = pathToFileURL(path.join(interAgentRoot, "dist", "gemini", "runtime.js")).href;
      const { addToCorpus } = await import(oracleToolsUrl);
      const { getGeminiRuntime } = await import(runtimeUrl);

      mkdirSync(path.join(oracleDir, "learnings"), { recursive: true });
      mkdirSync(path.join(oracleDir, "checkpoints"), { recursive: true });
      writeFileSync(registryPath, `${JSON.stringify({ schema_version: 1, oracles: { [oracleName]: registryEntry(oracleName, oracleDir) } }, null, 2)}\n`, "utf8");
      writeFileSync(path.join(oracleDir, "manifest.json"), `${JSON.stringify(manifestFixture(oracleName), null, 2)}\n`, "utf8");
      writeFileSync(path.join(oracleDir, "state.json"), `${JSON.stringify(stateFixture(oracleName), null, 2)}\n`, "utf8");

      files.forEach((filePath, index) => {
        writeFileSync(filePath, `proof-file-${index}\n`, "utf8");
      });

      const runtime = getGeminiRuntime();
      const originalAskDaemon = runtime.askDaemon.bind(runtime);
      const calls = [];
      runtime.askDaemon = async (input) => {
        calls.push(input);
        return { text: "ok", chars_in: input.question.length, chars_out: 2 };
      };

      try {
        const result = await addToCorpus({
          name: oracleName,
          files,
          role: "core_research",
          load_now: true,
        });
        assert.equal(result.ok, true);
        assert.equal(result.data.added, 3);
        assert.equal(calls.length, 1);

        const manifest = JSON.parse(readFileSync(path.join(oracleDir, "manifest.json"), "utf8"));
        assert.equal(manifest.static_entries.length, 3);
      } finally {
        runtime.askDaemon = originalAskDaemon;
      }
    }),
  },
];

if (!skipFullTest) {
  steps.push({
    name: "Proof 7 — npm test",
    run: () => {
      runStreaming("npm", ["test"], repoRoot);
    },
  });
}

try {
  for (const [index, step] of steps.entries()) {
    await step.run();
    console.log(`PASS ${index + 1}/${steps.length} — ${step.name}`);
  }
} finally {
  setEmbedChunksForTesting(null);
}
