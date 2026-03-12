import type { SearchResponse } from "../retrieval/hybrid.js";

export type BenchmarkDifficulty = "easy" | "medium" | "hard";
export type BenchmarkQueryType = "definitional" | "implementation" | "semantic";

export type BenchmarkQuery = {
  difficulty: BenchmarkDifficulty;
  id: string;
  query: string;
  relevant_chunks: string[];
  type: BenchmarkQueryType;
};

export type BenchmarkQueryMetrics = {
  ndcg_at_10: number;
  precision_at_1: number;
  precision_at_3: number;
  precision_at_5: number;
  rr: number | null;
};

export type BenchmarkQueryFlags = {
  missing_labels_in_index: boolean;
  zero_results: boolean;
};

export type BenchmarkQueryResult = BenchmarkQuery & {
  flags: BenchmarkQueryFlags;
  metrics: BenchmarkQueryMetrics;
  returned_chunks: string[];
};

export type BenchmarkAggregateMetrics = {
  mrr: number;
  ndcg_at_10: number;
  precision_at_1: number;
  precision_at_3: number;
  precision_at_5: number;
  zero_result_queries: number;
  missing_label_queries: number;
};

export type BenchmarkDifficultySummary = {
  mrr: number;
  ndcg_at_10: number;
  precision_at_1: number;
  precision_at_3: number;
  precision_at_5: number;
};

export type BenchmarkRunConfig = {
  backend: string;
  dimensions: number;
  embedding_batch_size: number;
  embedding_concurrency: number;
};

export type BenchmarkRun = {
  baseline_diff?: Partial<Record<"mrr" | "ndcg_at_10" | "precision_at_1" | "precision_at_3" | "precision_at_5", number>>;
  by_difficulty: Record<BenchmarkDifficulty, BenchmarkDifficultySummary>;
  config: BenchmarkRunConfig;
  queries: BenchmarkQueryResult[];
  run_id: string;
  summary: BenchmarkAggregateMetrics;
};

type RunBenchmarkDependencies = {
  chunkExists: (chunkId: string) => boolean | Promise<boolean>;
  runId?: string;
  search: (query: string) => Promise<SearchResponse>;
};

const SUMMARY_KEYS = ["precision_at_1", "precision_at_3", "precision_at_5", "mrr", "ndcg_at_10"] as const;

function createRunId(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replace(/:/gu, "-");
}

function precisionAtK(returnedChunks: string[], relevantChunks: Set<string>, k: number): number {
  const window = returnedChunks.slice(0, k);

  if (window.length === 0) {
    return 0;
  }

  const relevantCount = window.filter((chunkId) => relevantChunks.has(chunkId)).length;
  return relevantCount / k;
}

function reciprocalRank(returnedChunks: string[], relevantChunks: Set<string>): number {
  const rank = returnedChunks.findIndex((chunkId) => relevantChunks.has(chunkId));
  return rank === -1 ? 0 : 1 / (rank + 1);
}

function dcgAtK(returnedChunks: string[], relevantChunks: Set<string>, k: number): number {
  return returnedChunks
    .slice(0, k)
    .reduce((score, chunkId, index) => {
      if (!relevantChunks.has(chunkId)) {
        return score;
      }

      return score + (1 / Math.log2(index + 2));
    }, 0);
}

function ndcgAtK(returnedChunks: string[], relevantChunks: Set<string>, k: number): number {
  const idealCount = Math.min(relevantChunks.size, k);

  if (idealCount === 0) {
    return 0;
  }

  const idealChunks = Array.from({ length: idealCount }, (_, index) => `ideal-${index}`);
  const idealScore = dcgAtK(idealChunks, new Set(idealChunks), k);

  if (idealScore === 0) {
    return 0;
  }

  return dcgAtK(returnedChunks, relevantChunks, k) / idealScore;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildSummary(results: BenchmarkQueryResult[]): BenchmarkAggregateMetrics {
  const rrValues = results
    .filter((result) => !result.flags.zero_results)
    .map((result) => result.metrics.rr ?? 0);

  return {
    precision_at_1: average(results.map((result) => result.metrics.precision_at_1)),
    precision_at_3: average(results.map((result) => result.metrics.precision_at_3)),
    precision_at_5: average(results.map((result) => result.metrics.precision_at_5)),
    mrr: average(rrValues),
    ndcg_at_10: average(results.map((result) => result.metrics.ndcg_at_10)),
    zero_result_queries: results.filter((result) => result.flags.zero_results).length,
    missing_label_queries: results.filter((result) => result.flags.missing_labels_in_index).length
  };
}

function buildDifficultySummary(results: BenchmarkQueryResult[]): Record<BenchmarkDifficulty, BenchmarkDifficultySummary> {
  const difficulties: BenchmarkDifficulty[] = ["easy", "medium", "hard"];
  const entries = difficulties.map((difficulty) => {
    const subset = results.filter((result) => result.difficulty === difficulty);
    const summary = buildSummary(subset);

    return [difficulty, {
      precision_at_1: summary.precision_at_1,
      precision_at_3: summary.precision_at_3,
      precision_at_5: summary.precision_at_5,
      mrr: summary.mrr,
      ndcg_at_10: summary.ndcg_at_10
    }] as const;
  });

  return Object.fromEntries(entries) as Record<BenchmarkDifficulty, BenchmarkDifficultySummary>;
}

export function computeBaselineDiff(
  current: BenchmarkAggregateMetrics,
  baseline: BenchmarkAggregateMetrics | null
): Partial<Record<"mrr" | "ndcg_at_10" | "precision_at_1" | "precision_at_3" | "precision_at_5", number>> | undefined {
  if (baseline === null) {
    return undefined;
  }

  return Object.fromEntries(SUMMARY_KEYS.map((key) => [key, current[key] - baseline[key]])) as Partial<
    Record<"mrr" | "ndcg_at_10" | "precision_at_1" | "precision_at_3" | "precision_at_5", number>
  >;
}

export async function runBenchmark(
  queries: BenchmarkQuery[],
  config: BenchmarkRunConfig,
  dependencies: RunBenchmarkDependencies
): Promise<BenchmarkRun> {
  const results: BenchmarkQueryResult[] = [];

  for (const query of queries) {
    const searchResponse = await dependencies.search(query.query);
    const returnedChunks = searchResponse.results.map((result) => result.id);
    const relevantSet = new Set(query.relevant_chunks);
    const missingLabels = await Promise.all(
      query.relevant_chunks.map(async (chunkId) => !(await dependencies.chunkExists(chunkId)))
    );
    const zeroResults = returnedChunks.length === 0;

    results.push({
      ...query,
      returned_chunks: returnedChunks,
      metrics: {
        precision_at_1: precisionAtK(returnedChunks, relevantSet, 1),
        precision_at_3: precisionAtK(returnedChunks, relevantSet, 3),
        precision_at_5: precisionAtK(returnedChunks, relevantSet, 5),
        rr: zeroResults ? null : reciprocalRank(returnedChunks, relevantSet),
        ndcg_at_10: ndcgAtK(returnedChunks, relevantSet, 10)
      },
      flags: {
        zero_results: zeroResults,
        missing_labels_in_index: missingLabels.some(Boolean)
      }
    });
  }

  return {
    run_id: dependencies.runId ?? createRunId(),
    config,
    summary: buildSummary(results),
    by_difficulty: buildDifficultySummary(results),
    queries: results
  };
}
