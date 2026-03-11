import type Database from "better-sqlite3";

import { z } from "zod";

import { MetadataCodes } from "../errors.js";
import { traverseGraph } from "../retrieval/graph.js";
import { search, type SearchResponse, type SearchResult } from "../retrieval/hybrid.js";

type SearchFn = typeof search;
type TraverseGraphFn = typeof traverseGraph;

export const lcsInvestigateInputSchema = {
  query: z.string().describe("Natural language query or CNI for structural lookup"),
  intent: z.enum(["semantic", "structural"]).default("semantic"),
  limit: z.number().int().min(1).max(20).optional().default(8)
};

export function formatSearchResults(results: SearchResult[]): string {
  return results.map((result, index) => (
    `--- CHUNK ${index + 1} score=${result.score.toFixed(4)}\n` +
    `PATH: ${result.file_path}\n` +
    `CNI: ${result.id}\n` +
    `TYPE: ${result.chunk_type}\n` +
    `LINES: ${result.start_line}-${result.end_line}\n` +
    `\`\`\`${result.language}\n` +
    `${result.content}\n` +
    "```"
  )).join("\n\n");
}

export function createLcsInvestigateHandler(
  db: Database.Database,
  dependencies: { searchImpl?: SearchFn; traverseGraphImpl?: TraverseGraphFn } = {}
) {
  const searchImpl = dependencies.searchImpl ?? search;
  const traverseGraphImpl = dependencies.traverseGraphImpl ?? traverseGraph;
  const countLiveChunks = db.prepare(`
    SELECT COUNT(*) AS count
    FROM lcs_chunks
    WHERE is_deleted = 0
  `);

  return async ({
    query,
    intent,
    limit
  }: {
    query: string;
    intent: "semantic" | "structural";
    limit: number;
  }) => {
    if (intent === "structural") {
      return {
        content: [{
          type: "text" as const,
          text: traverseGraphImpl(query, db)
        }]
      };
    }

    const corpus = countLiveChunks.get() as { count: number };

    if (corpus.count === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `${MetadataCodes.INDEX_EMPTY}\n\nNo files have been indexed yet. Run pythia_force_index to index your workspace.`
        }]
      };
    }

    const searchResult = await searchImpl(query, intent, db, limit) as SearchResponse;
    const results = searchResult.results;

    if (results.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `${MetadataCodes.NO_MATCH}\n\nNo chunks matched the query. Try different search terms.`
        }]
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: searchResult.rerankerUsed
          ? formatSearchResults(results)
          : `${formatSearchResults(results)}\n[METADATA: RERANKER_UNAVAILABLE]`
      }]
    };
  };
}
