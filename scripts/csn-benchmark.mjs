#!/usr/bin/env node
/**
 * CodeSearchNet Benchmark
 *
 * Downloads CodeSearchNet eval split from HuggingFace, indexes it via Pythia,
 * and measures retrieval quality using the Sprint 6 benchmark engine.
 *
 * Usage:
 *   node scripts/csn-benchmark.mjs [options]
 *
 * Options:
 *   --lang <js|php>      Language subset (default: javascript)
 *   --samples <N>        Number of examples to evaluate (default: 500)
 *   --keep-tmp           Preserve temp workspace after run
 *   --output <dir>       Output dir (default: benchmarks/results/csn-<lang>-<ts>/)
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runningUnderTsx = process.execArgv.some(
  (v) => v.includes("tsx/dist/loader.mjs") || v.includes("tsx/dist/preflight.cjs")
);

if (!runningUnderTsx) {
  execFileSync("npx", ["tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  process.exit(0);
}

// --- Dynamic imports (resolved under tsx) ---
const { openDb } = await import("../src/db/connection.js");
const { search } = await import("../src/retrieval/hybrid.js");
const { runBenchmark } = await import("../src/benchmark/runner.js");
const { writeBenchmarkArtifacts } = await import("../src/benchmark/report.js");

// --- Parse args ---
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);

const lang = opt("--lang", "javascript");
const samples = parseInt(opt("--samples", "500"), 10);
const keepTmp = flag("--keep-tmp");
const hfConfig = lang === "php" ? "php" : "javascript";
const fileExt = lang === "php" ? ".php" : ".js";

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/gu, "-")
  .replace("T", "_")
  .slice(0, 19);
const outputDir = opt(
  "--output",
  path.join(repoRoot, "benchmarks", "results", `csn-${lang}-${timestamp}`)
);

console.log("\n📊 CodeSearchNet Benchmark");
console.log(`   Language : ${lang}`);
console.log(`   Samples  : ${samples}`);
console.log(`   Output   : ${outputDir}\n`);

// --- Step 1: Fetch CodeSearchNet test split from HuggingFace ---
console.log("⬇️  Fetching from HuggingFace Datasets Server...");

async function fetchCSN(config, split, needed) {
  const rows = [];
  const batchSize = 100;
  let offset = 0;

  while (rows.length < needed) {
    const url =
      `https://datasets-server.huggingface.co/rows` +
      `?dataset=code_search_net&config=${config}&split=${split}` +
      `&offset=${offset}&limit=${batchSize}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HF API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const batch = data.rows.map((r) => r.row);
    rows.push(...batch);
    process.stdout.write(`\r   Fetched ${Math.min(rows.length, needed)} / ${needed}`);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  console.log();
  return rows.slice(0, needed);
}

const rawExamples = await fetchCSN(hfConfig, "test", samples);
console.log(`   Got ${rawExamples.length} examples\n`);

// --- Step 2: Filter and write temp workspace ---
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pythia-csn-"));
console.log(`📁 Temp workspace: ${tmpDir}`);

// Keep examples with usable func_name + documentation + code
const usable = rawExamples.filter(
  (ex) =>
    ex.func_name &&
    ex.func_name.length > 0 &&
    ex.func_documentation_string &&
    ex.func_documentation_string.trim().length >= 10 &&
    ex.func_code &&
    ex.func_code.length > 0
);

console.log(`   Usable after filter: ${usable.length} / ${rawExamples.length}\n`);

// Write one function per file — one function per file = predictable CNI
for (let i = 0; i < usable.length; i++) {
  const ex = usable[i];
  // Safe filename: index prefix ensures uniqueness even with duplicate func names
  const safeName = ex.func_name.replace(/[^a-zA-Z0-9_$]/gu, "_").slice(0, 64);
  const filename = `${String(i).padStart(5, "0")}_${safeName}${fileExt}`;
  writeFileSync(path.join(tmpDir, filename), ex.func_code, "utf8");
  ex._filename = filename;
}

// Empty .pythiaignore — index everything in the workspace
writeFileSync(path.join(tmpDir, ".pythiaignore"), "", "utf8");

// Minimal Pythia config for this run (local ONNX, 256d)
const configPath = path.join(tmpDir, "pythia-config.json");
writeFileSync(
  configPath,
  JSON.stringify(
    {
      workspace_path: tmpDir,
      reasoning: { mode: "cli" },
      embeddings: {
        mode: "local",
        dimensions: 256,
      },
      indexing: {
        scan_on_start: false,
        max_worker_restarts: 3,
        embedding_concurrency: 1,
        embedding_batch_size: 32,
        css_rule_chunk_min_chars: 80,
        max_chunk_chars: {
          function: 8000,
          class: 10000,
          method: 8000,
          module: 12000,
        },
        oversize_strategy: "split",
      },
      gc: { deleted_chunk_retention_days: 7 },
    },
    null,
    2
  ),
  "utf8"
);

// --- Step 3: pythia init ---
console.log("🔧 Running pythia init (indexing functions)...");
const initStart = Date.now();
execFileSync(
  "npx",
  ["tsx", "src/cli/main.ts", "init", "--workspace", tmpDir, "--config", configPath],
  { cwd: repoRoot, stdio: "inherit" }
);
console.log(`\n   Init complete in ${((Date.now() - initStart) / 1000).toFixed(1)}s\n`);

// --- Step 4: Open DB and resolve actual CNIs ---
// Look up what CNI was actually assigned to each file by tree-sitter.
// Priority: function > method > module (prefer named chunk over whole-file fallback)
const dbPath = path.join(tmpDir, ".pythia", "lcs.db");
const db = openDb(dbPath);

const CHUNK_PRIORITY = { function: 0, method: 1, module: 2 };

const allChunks = db
  .prepare(
    `SELECT file_path, id, chunk_type FROM lcs_chunks
     WHERE is_deleted = 0 AND chunk_type IN ('function', 'method', 'module')
     ORDER BY start_line ASC`
  )
  .all();

// Best CNI per file: prefer function/method over module
const cniByFile = new Map();
for (const row of allChunks) {
  const existing = cniByFile.get(row.file_path);
  if (!existing) {
    cniByFile.set(row.file_path, row);
  } else {
    const existingPrio = CHUNK_PRIORITY[existing.chunk_type] ?? 99;
    const newPrio = CHUNK_PRIORITY[row.chunk_type] ?? 99;
    if (newPrio < existingPrio) {
      cniByFile.set(row.file_path, row);
    }
  }
}

console.log(
  `   Index: ${cniByFile.size} files with chunks (from ${usable.length} input files)\n`
);

// --- Step 5: Build BenchmarkQuery[] ---
const queries = [];
for (const ex of usable) {
  if (!ex._filename) continue;
  const chunk = cniByFile.get(ex._filename);
  if (!chunk) continue; // file wasn't indexed (binary check, empty, etc.)

  // Use only the first line of the docstring — avoids dumping entire docs as queries
  const doc = ex.func_documentation_string
    .trim()
    .split("\n")
    .find((line) => line.trim().length >= 10)
    ?.trim();

  if (!doc) continue;

  queries.push({
    id: `csn-${ex._filename}`,
    query: doc,
    relevant_chunks: [chunk.id],
    difficulty: "medium", // CodeSearchNet has no difficulty labels — all medium
    type: "semantic",
  });
}

console.log(`🔍 Running ${queries.length} queries through hybrid search...\n`);

// --- Step 6: Run benchmark ---
const queryStart = Date.now();
const run = await runBenchmark(
  queries,
  {
    backend: "local_onnx",
    dimensions: 256,
    embedding_batch_size: 32,
    embedding_concurrency: 1,
  },
  {
    chunkExists: (id) => {
      const row = db
        .prepare("SELECT 1 FROM lcs_chunks WHERE id = ? AND is_deleted = 0")
        .get(id);
      return row != null;
    },
    search: (query) => search(query, "semantic", db),
  }
);

const elapsed = ((Date.now() - queryStart) / 1000).toFixed(1);
console.log(`   Done in ${elapsed}s\n`);

// --- Step 7: Write results ---
writeBenchmarkArtifacts(outputDir, run, {
  source: "codesearchnet",
  language: lang,
  hf_split: "test",
  total_samples_fetched: rawExamples.length,
  usable_after_filter: usable.length,
  queries_evaluated: queries.length,
  timestamp: new Date().toISOString(),
});

// --- Print summary ---
const s = run.summary;
const pad = (v) => String(v).padEnd(34);
console.log("┌─────────────────────────────────────────────────┐");
console.log("│       CodeSearchNet Benchmark Results           │");
console.log("├─────────────────────────────────────────────────┤");
console.log(`│  Language  : ${pad(lang)} │`);
console.log(`│  Queries   : ${pad(queries.length)} │`);
console.log("├─────────────────────────────────────────────────┤");
console.log(`│  MRR@10    : ${pad(s.mrr.toFixed(4))} │`);
console.log(`│  NDCG@10   : ${pad(s.ndcg_at_10.toFixed(4))} │`);
console.log(`│  P@1       : ${pad(s.precision_at_1.toFixed(4))} │`);
console.log(`│  P@3       : ${pad(s.precision_at_3.toFixed(4))} │`);
console.log(`│  P@5       : ${pad(s.precision_at_5.toFixed(4))} │`);
console.log("├─────────────────────────────────────────────────┤");
console.log(`│  Zero-result queries  : ${pad(s.zero_result_queries)} │`);
console.log(`│  Missing-label queries: ${pad(s.missing_label_queries)} │`);
console.log("└─────────────────────────────────────────────────┘");
console.log(`\nResults written to: ${outputDir}\n`);

// --- Cleanup ---
db.close();
if (keepTmp) {
  console.log(`📁 Temp workspace preserved at: ${tmpDir}`);
} else {
  rmSync(tmpDir, { recursive: true, force: true });
  console.log("🧹 Temp workspace cleaned up.");
}
