import type Database from "better-sqlite3";

export type CorpusHealthReport = {
  verdict: "UNINITIALIZED" | "WARN" | "DEGRADED" | "HEALTHY";
  verdict_reason: string;
  total_chunks: number;
  total_files: number;
  chunk_type_distribution: Array<{ chunk_type: string; count: number }>;
  short_chunk_count: number;
  avg_chunk_length_chars: number | null;
  top_path_prefixes: Array<{ prefix: string; count: number }>;
};

const SUSPICIOUS_PREFIXES = [
  "node_modules",
  "dist",
  "build",
  "vendor",
  ".git",
  "target",
  "bin",
  "obj",
  "__pycache__",
  ".next",
  "coverage"
];

function uninitializedReport(): CorpusHealthReport {
  return {
    verdict: "UNINITIALIZED",
    verdict_reason: "Run pythia init first.",
    total_chunks: 0,
    total_files: 0,
    chunk_type_distribution: [],
    short_chunk_count: 0,
    avg_chunk_length_chars: null,
    top_path_prefixes: []
  };
}

export function computeCorpusHealth(db: Database.Database): CorpusHealthReport {
  try {
    const totalChunksRow = db.prepare("SELECT count(*) AS count FROM lcs_chunks WHERE is_deleted = 0").get() as {
      count: number;
    };
    const totalFilesRow = db.prepare("SELECT count(distinct file_path) AS count FROM lcs_chunks WHERE is_deleted = 0").get() as {
      count: number;
    };
    const chunkTypeDistribution = db.prepare(`
      SELECT chunk_type, count(*) AS count
      FROM lcs_chunks
      WHERE is_deleted = 0
      GROUP BY chunk_type
    `).all() as Array<{ chunk_type: string; count: number }>;
    const shortChunkRow = db.prepare("SELECT count(*) AS count FROM lcs_chunks WHERE length(content) < 100 AND is_deleted = 0").get() as {
      count: number;
    };
    const avgChunkLengthRow = db.prepare(`
      SELECT CAST(AVG(length(content)) AS INTEGER) AS avg_chunk_length_chars
      FROM lcs_chunks
      WHERE is_deleted = 0
    `).get() as { avg_chunk_length_chars: number | null };
    const prefixCounts = new Map<string, number>();
    const filePathStatement = db.prepare("SELECT file_path FROM lcs_chunks WHERE is_deleted = 0");

    for (const { file_path } of filePathStatement.iterate() as Iterable<{ file_path: string }>) {
      const prefix = file_path.split("/")[0] ?? file_path;
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }

    const total_chunks = totalChunksRow.count;
    const total_files = totalFilesRow.count;
    const short_chunk_count = shortChunkRow.count;
    const avg_chunk_length_chars = avgChunkLengthRow.avg_chunk_length_chars;
    const chunk_type_distribution = chunkTypeDistribution.map((row) => ({
      chunk_type: row.chunk_type,
      count: row.count
    }));
    const top_path_prefixes = [...prefixCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([prefix, count]) => ({ prefix, count }));
    const baseReport = {
      total_chunks,
      total_files,
      chunk_type_distribution,
      short_chunk_count,
      avg_chunk_length_chars,
      top_path_prefixes
    };

    if (total_chunks === 0) {
      return {
        verdict: "WARN",
        verdict_reason: "No files were indexed. Check your .pythiaignore and workspace path.",
        ...baseReport
      };
    }

    const moduleChunkCount = chunk_type_distribution.find((row) => row.chunk_type === "module")?.count ?? 0;
    const modulePercent = (moduleChunkCount / total_chunks) * 100;
    const shortPercent = (short_chunk_count / total_chunks) * 100;
    const hasSuspicious = top_path_prefixes.some((entry) => SUSPICIOUS_PREFIXES.includes(entry.prefix));

    if (modulePercent > 60 || shortPercent > 30 || hasSuspicious) {
      return {
        verdict: "DEGRADED",
        verdict_reason: "Corpus contains noise or low-quality chunks. Review .pythiaignore and re-run pythia init.",
        ...baseReport
      };
    }

    if (
      (modulePercent >= 40 && modulePercent <= 60)
      || (shortPercent >= 15 && shortPercent <= 30)
    ) {
      return {
        verdict: "WARN",
        verdict_reason: "Corpus quality is marginal. Consider reviewing .pythiaignore.",
        ...baseReport
      };
    }

    return {
      verdict: "HEALTHY",
      verdict_reason: "Corpus looks good.",
      ...baseReport
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) {
      return uninitializedReport();
    }

    throw error;
  }
}
