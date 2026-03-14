#!/usr/bin/env node
/**
 * Pythia Embedding Performance Benchmark
 *
 * Measures indexing throughput and peak memory usage across embedding backends.
 * Run against the Pythia repo itself (or any workspace) to get real-world numbers.
 *
 * Usage:
 *   node scripts/perf-benchmark.mjs [options]
 *
 * Options:
 *   --workspace <path>    Workspace to index (default: current repo)
 *   --config <path>       Config file path (default: ~/.pythia/config.json)
 *   --samples <N>         Number of synthetic chunks to embed (default: 200)
 *   --batch-size <N>      Batch size override (default: from config)
 *   --mode <local|openai_compatible|vertex_ai>  Embedding mode label (for report)
 *   --label <string>      Human label for this run (e.g. "MacBook fp32 b4")
 *
 * Outputs a JSON report to benchmarks/results/perf-<label>-<ts>.json
 *
 * Memory notes:
 *   process.memoryUsage().rss = total process resident set (includes ONNX native allocations)
 *   This is the right metric — V8 heap alone misses ONNX Runtime native memory.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
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
const { createEmbedder } = await import("../src/indexer/embedder.js");
const { loadConfig } = await import("../src/config.js");

// --- Parse args ---
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : def;
};

const configPath = opt("--config", path.join(homedir(), ".pythia", "config.json"));
const samples = parseInt(opt("--samples", "200"), 10);
const batchSizeOverride = opt("--batch-size", null);
const modeLabel = opt("--mode", "local");
const runLabel = opt("--label", `${modeLabel}-b${batchSizeOverride ?? "default"}`);

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/gu, "-")
  .replace("T", "_")
  .slice(0, 19);

const outputDir = path.join(repoRoot, "benchmarks", "results");
mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `perf-${runLabel}-${timestamp}.json`);

console.log("\n⚡ Pythia Embedding Performance Benchmark");
console.log(`   Label    : ${runLabel}`);
console.log(`   Samples  : ${samples}`);
console.log(`   Config   : ${configPath}\n`);

// --- Load config ---
let config;
try {
  config = loadConfig(configPath);
} catch (err) {
  console.error(`❌ Failed to load config from ${configPath}: ${err.message}`);
  console.error("   Create ~/.pythia/config.json first (see pythia init --help)");
  process.exit(1);
}

const batchSize = batchSizeOverride
  ? parseInt(batchSizeOverride, 10)
  : (config.indexing?.embedding_batch_size ?? 32);

const indexingConfig = {
  ...config.indexing,
  embedding_batch_size: batchSize,
};

// --- Generate synthetic chunks of varying sizes ---
// Simulates real-world distribution: mostly small functions, some large modules
function generateChunks(n) {
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const type = i % 10 === 0 ? "module" : i % 5 === 0 ? "class" : "function";
    const charCount = type === "module" ? 8000 : type === "class" ? 3000 : 800;
    chunks.push(
      `// Chunk ${i} type=${type}\n` +
      "x".repeat(charCount)
    );
  }
  return chunks;
}

const chunks = generateChunks(samples);

console.log(`🔧 Creating ${config.embeddings.mode} embedder (batch_size=${batchSize})...`);
const memBefore = process.memoryUsage();

const embedder = createEmbedder(config.embeddings, { indexingConfig });

// --- Warm up (loads model into memory) ---
console.log("🔥 Warming embedder (model load)...");
const warmStart = Date.now();
await embedder.warm();
const warmMs = Date.now() - warmStart;
const memAfterWarm = process.memoryUsage();

console.log(`   Warm complete in ${(warmMs / 1000).toFixed(1)}s`);
console.log(`   RSS after load: ${(memAfterWarm.rss / 1024 / 1024).toFixed(0)} MB\n`);

// --- Embed in batches, track timing + memory ---
console.log(`📦 Embedding ${samples} chunks in batches of ${batchSize}...`);
const embedStart = Date.now();
let peakRss = memAfterWarm.rss;
let batchCount = 0;

// Process in manual batches so we can sample memory between each
for (let i = 0; i < chunks.length; i += batchSize) {
  const batch = chunks.slice(i, i + batchSize);
  await embedder.embedChunks(batch);
  batchCount++;

  const mem = process.memoryUsage();
  if (mem.rss > peakRss) {
    peakRss = mem.rss;
  }

  process.stdout.write(
    `\r   Batch ${batchCount} / ${Math.ceil(chunks.length / batchSize)} | ` +
    `RSS: ${(mem.rss / 1024 / 1024).toFixed(0)} MB`
  );
}

const embedMs = Date.now() - embedStart;
const memAfterEmbed = process.memoryUsage();

console.log("\n");

// --- Compute throughput ---
const chunksPerSec = (samples / (embedMs / 1000)).toFixed(1);
const msPerChunk = (embedMs / samples).toFixed(1);

// --- Print summary ---
const pad = (v) => String(v).padEnd(32);
console.log("┌────────────────────────────────────────────────────┐");
console.log("│          Embedding Performance Results             │");
console.log("├────────────────────────────────────────────────────┤");
console.log(`│  Label         : ${pad(runLabel)} │`);
console.log(`│  Mode          : ${pad(config.embeddings.mode)} │`);
console.log(`│  Batch size    : ${pad(batchSize)} │`);
console.log(`│  Chunks        : ${pad(samples)} │`);
console.log("├────────────────────────────────────────────────────┤");
console.log(`│  Warm time     : ${pad(warmMs + "ms")} │`);
console.log(`│  Embed time    : ${pad(embedMs + "ms")} │`);
console.log(`│  Chunks/sec    : ${pad(chunksPerSec)} │`);
console.log(`│  ms/chunk      : ${pad(msPerChunk)} │`);
console.log("├────────────────────────────────────────────────────┤");
console.log(`│  RSS before    : ${pad((memBefore.rss / 1024 / 1024).toFixed(0) + " MB")} │`);
console.log(`│  RSS after load: ${pad((memAfterWarm.rss / 1024 / 1024).toFixed(0) + " MB")} │`);
console.log(`│  RSS peak      : ${pad((peakRss / 1024 / 1024).toFixed(0) + " MB")} │`);
console.log(`│  RSS final     : ${pad((memAfterEmbed.rss / 1024 / 1024).toFixed(0) + " MB")} │`);
console.log("└────────────────────────────────────────────────────┘");

// --- Write JSON report ---
const report = {
  label: runLabel,
  timestamp: new Date().toISOString(),
  config: {
    embedding_mode: config.embeddings.mode,
    batch_size: batchSize,
    samples,
  },
  timing: {
    warm_ms: warmMs,
    embed_ms: embedMs,
    chunks_per_sec: parseFloat(chunksPerSec),
    ms_per_chunk: parseFloat(msPerChunk),
  },
  memory_mb: {
    rss_before: parseFloat((memBefore.rss / 1024 / 1024).toFixed(1)),
    rss_after_warm: parseFloat((memAfterWarm.rss / 1024 / 1024).toFixed(1)),
    rss_peak: parseFloat((peakRss / 1024 / 1024).toFixed(1)),
    rss_final: parseFloat((memAfterEmbed.rss / 1024 / 1024).toFixed(1)),
    heap_used_final: parseFloat((memAfterEmbed.heapUsed / 1024 / 1024).toFixed(1)),
  },
};

writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\nReport written to: ${outputPath}\n`);
