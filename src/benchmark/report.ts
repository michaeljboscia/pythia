import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { BenchmarkAggregateMetrics, BenchmarkRun } from "./runner.js";

function formatMetric(value: number): string {
  return value.toFixed(4);
}

export function writeBenchmarkArtifacts(
  outputDir: string,
  run: BenchmarkRun,
  metadata: Record<string, unknown>
): void {
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(
    path.join(outputDir, "config.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify(run, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(outputDir, "queries.jsonl"),
    `${run.queries.map((query) => JSON.stringify(query)).join("\n")}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(outputDir, "summary.md"),
    renderBenchmarkMarkdown(run),
    "utf8"
  );
}

export function writeBaselineFile(baselinePath: string, run: BenchmarkRun): void {
  mkdirSync(path.dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export function renderBenchmarkMarkdown(run: BenchmarkRun): string {
  const lines = [
    "# Benchmark Summary",
    "",
    `- Run ID: ${run.run_id}`,
    `- Backend: ${run.config.backend}`,
    `- Dimensions: ${run.config.dimensions}`,
    `- Embedding batch size: ${run.config.embedding_batch_size}`,
    `- Embedding concurrency: ${run.config.embedding_concurrency}`,
    "",
    "## Aggregate Metrics",
    "",
    `- Precision@1: ${formatMetric(run.summary.precision_at_1)}`,
    `- Precision@3: ${formatMetric(run.summary.precision_at_3)}`,
    `- Precision@5: ${formatMetric(run.summary.precision_at_5)}`,
    `- MRR: ${formatMetric(run.summary.mrr)}`,
    `- NDCG@10: ${formatMetric(run.summary.ndcg_at_10)}`,
    `- Zero-result queries: ${run.summary.zero_result_queries}`,
    `- Missing-label queries: ${run.summary.missing_label_queries}`,
    "",
    "## By Difficulty",
    ""
  ];

  for (const [difficulty, summary] of Object.entries(run.by_difficulty)) {
    lines.push(`### ${difficulty}`);
    lines.push("");
    lines.push(`- Precision@5: ${formatMetric(summary.precision_at_5)}`);
    lines.push(`- MRR: ${formatMetric(summary.mrr)}`);
    lines.push(`- NDCG@10: ${formatMetric(summary.ndcg_at_10)}`);
    lines.push("");
  }

  if (run.baseline_diff !== undefined) {
    lines.push("## Baseline Diff");
    lines.push("");

    for (const [key, value] of Object.entries(run.baseline_diff)) {
      lines.push(`- ${key}: ${value >= 0 ? "+" : ""}${formatMetric(value)}`);
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function baselineEligible(summary: BenchmarkAggregateMetrics, totalQueries: number): boolean {
  if (totalQueries === 0) {
    return false;
  }

  return summary.missing_label_queries === 0
    && (summary.zero_result_queries / totalQueries) < 0.2;
}
