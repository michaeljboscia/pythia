import path from "node:path";

import type Database from "better-sqlite3";

import { embedQuery } from "../indexer/embedder.js";
import { createVectorStore } from "../indexer/vector-store.js";
import { rerank, type RerankerResult } from "./reranker.js";

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

export interface SearchResponse {
  results: SearchResult[];
  rerankerUsed: boolean;
}

export type RetrievalIntent = "semantic" | "structural";
export type FtsRoute = "kw" | "sub" | "none";

type FtsRow = {
  id: string;
};

type ChunkRow = Omit<SearchResult, "language" | "score">;

type SearchDependencies = {
  embedQueryImpl?: typeof embedQuery;
  rerankImpl?: (query: string, candidates: SearchResult[]) => Promise<RerankerResult<SearchResult>>;
};

type RankedChunk = {
  chunk: SearchResult;
  score: number;
};

const VEC_LIMIT = 30;
const FTS_LIMIT = 30;
const RRF_K = 60;
const RRF_TOP_K = 12;

export const INTENT_WEIGHTS: Record<RetrievalIntent, { wv: number; wf: number }> = {
  semantic: { wv: 0.7, wf: 0.3 },
  structural: { wv: 0.3, wf: 0.7 }
};

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

function isTrigramCandidate(query: string): boolean {
  return /^".*"$/.test(query)
    || query.includes("::")
    || query.includes("/")
    || query.includes(".");
}

export function normalizeKeywordFtsQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}._:/#<>?!-]+/gu) ?? [];
  const normalized = tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (normalized.length === 0) {
    return null;
  }

  return normalized.map((token) => `"${token}"`).join(" ");
}

export function normalizeSubstringFtsQuery(query: string): string | null {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const phrase = trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2
    ? trimmed.slice(1, -1)
    : trimmed;

  return `"${phrase.replaceAll("\"", "\"\"")}"`;
}

export function chooseFtsRoute(query: string, keywordHitCount: number): FtsRoute {
  if (keywordHitCount > 0) {
    return "kw";
  }

  return isTrigramCandidate(query) ? "sub" : "none";
}

function getChunkRows(db: Database.Database, ids: string[]): SearchResult[] {
  if (ids.length === 0) {
    return [];
  }

  const selectChunk = db.prepare(`
    SELECT id, file_path, chunk_type, content, start_line, end_line
    FROM lcs_chunks
    WHERE id = ?
      AND is_deleted = 0
  `);

  return ids.flatMap((id) => {
    const chunk = selectChunk.get(id) as ChunkRow | undefined;

    if (chunk === undefined) {
      return [];
    }

    return [{
      ...chunk,
      language: languageFromFilePath(chunk.file_path),
      score: 0
    }];
  });
}

function runVectorSearch(
  db: Database.Database,
  queryEmbedding: Float32Array
): Promise<SearchResult[]> {
  const vectorStore = createVectorStore("sqlite", db);

  return vectorStore.query(queryEmbedding, VEC_LIMIT).then((vectorRows) => {
    const chunkMap = new Map(
      getChunkRows(db, vectorRows.map((row) => row.id)).map((chunk) => [chunk.id, chunk])
    );

    return vectorRows.flatMap((row) => {
      const chunk = chunkMap.get(row.id);

      if (chunk === undefined) {
        return [];
      }

      return [{
        ...chunk,
        score: 1 / (1 + row.distance)
      }];
    }).slice(0, VEC_LIMIT);
  });
}

function runKeywordFts(db: Database.Database, query: string): SearchResult[] {
  const normalizedQuery = normalizeKeywordFtsQuery(query);

  if (normalizedQuery === null) {
    return [];
  }

  const rows = db.prepare(`
    SELECT id
    FROM fts_lcs_chunks_kw
    WHERE fts_lcs_chunks_kw MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(normalizedQuery, FTS_LIMIT) as FtsRow[];

  return getChunkRows(db, rows.map((row) => row.id));
}

function runSubstringFts(db: Database.Database, query: string): SearchResult[] {
  const normalizedQuery = normalizeSubstringFtsQuery(query);

  if (normalizedQuery === null) {
    return [];
  }

  const rows = db.prepare(`
    SELECT id
    FROM fts_lcs_chunks_sub
    WHERE fts_lcs_chunks_sub MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(normalizedQuery, FTS_LIMIT) as FtsRow[];

  return getChunkRows(db, rows.map((row) => row.id));
}

export function fuseSearchResults(
  vectorResults: SearchResult[],
  ftsResults: SearchResult[],
  intent: RetrievalIntent
): SearchResult[] {
  const { wv, wf } = INTENT_WEIGHTS[intent];
  const vectorRank = new Map<string, number>();
  const ftsRank = new Map<string, number>();

  vectorResults.forEach((chunk, index) => {
    vectorRank.set(chunk.id, index + 1);
  });
  ftsResults.forEach((chunk, index) => {
    ftsRank.set(chunk.id, index + 1);
  });

  const allIds = new Set<string>([
    ...vectorResults.map((chunk) => chunk.id),
    ...ftsResults.map((chunk) => chunk.id)
  ]);
  const chunkMap = new Map<string, SearchResult>();

  [...vectorResults, ...ftsResults].forEach((chunk) => {
    if (!chunkMap.has(chunk.id)) {
      chunkMap.set(chunk.id, chunk);
    }
  });

  const scored: RankedChunk[] = [];

  for (const id of allIds) {
    const chunk = chunkMap.get(id);

    if (chunk === undefined) {
      continue;
    }

    const rankVec = vectorRank.get(id);
    const rankFts = ftsRank.get(id);
    const score = (rankVec === undefined ? 0 : wv / (RRF_K + rankVec))
      + (rankFts === undefined ? 0 : wf / (RRF_K + rankFts));

    scored.push({
      chunk,
      score
    });
  }

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, RRF_TOP_K)
    .map(({ chunk, score }) => ({
      ...chunk,
      score
    }));
}

export async function search(
  query: string,
  intent: RetrievalIntent,
  db: Database.Database,
  limit: number = 8,
  dependencies: SearchDependencies = {}
): Promise<SearchResponse> {
  const embedQueryImpl = dependencies.embedQueryImpl ?? embedQuery;
  const rerankImpl = dependencies.rerankImpl ?? rerank;

  const queryEmbedding = await embedQueryImpl(query);
  const vectorResults = await runVectorSearch(db, queryEmbedding);
  const keywordResults = runKeywordFts(db, query);
  const ftsRoute = chooseFtsRoute(query, keywordResults.length);
  const ftsResults = ftsRoute === "kw"
    ? keywordResults
    : ftsRoute === "sub"
      ? runSubstringFts(db, query)
      : [];
  const fusedResults = fuseSearchResults(vectorResults, ftsResults, intent);

  if (fusedResults.length === 0) {
    return {
      results: [],
      rerankerUsed: false
    };
  }

  const reranked = await rerankImpl(query, fusedResults);

  return {
    results: reranked.chunks.slice(0, limit),
    rerankerUsed: reranked.rerankerUsed
  };
}
