import path from "node:path";

import type Database from "better-sqlite3";

import { embedQuery } from "../indexer/embedder.js";

export interface SearchResult {
  id: string;
  file_path: string;
  chunk_type: string;
  content: string;
  start_line: number;
  end_line: number;
  language: string;
  score: number;
}

type VectorRow = {
  distance: number;
  id: string;
};

type ChunkRow = Omit<SearchResult, "language" | "score">;

function languageFromFilePath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".md":
    case ".mdx":
      return "markdown";
    default:
      return "text";
  }
}

export async function search(
  query: string,
  _intent: "semantic" | "structural",
  db: Database.Database,
  limit: number = 8
): Promise<SearchResult[]> {
  const queryEmbedding = await embedQuery(query);
  const vectorRows = db.prepare(`
    SELECT id, distance
    FROM vec_lcs_chunks
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT 30
  `).all(queryEmbedding) as VectorRow[];
  const selectChunk = db.prepare(`
    SELECT id, file_path, chunk_type, content, start_line, end_line
    FROM lcs_chunks
    WHERE id = ?
      AND is_deleted = 0
  `);
  const results: SearchResult[] = [];

  for (const row of vectorRows) {
    const chunk = selectChunk.get(row.id) as ChunkRow | undefined;

    if (chunk === undefined) {
      continue;
    }

    results.push({
      ...chunk,
      language: languageFromFilePath(chunk.file_path),
      score: 1 / (1 + row.distance)
    });
  }

  return results
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
