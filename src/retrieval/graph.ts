import path from "node:path";

import type Database from "better-sqlite3";

type BfsRow = {
  edge_type: string;
  min_depth: number;
  node_id: string;
};

type ChunkRow = {
  content: string;
  end_line: number;
  file_path: string;
  id: string;
  start_line: number;
  chunk_type: string;
};

const BFS_QUERY = `
  WITH RECURSIVE traversal(node_id, depth, path, edge_type) AS (
    SELECT ?, 0, ','||?||',', ''
    UNION ALL
    SELECT ge.target_id, t.depth + 1, t.path || ge.target_id || ',', ge.edge_type
    FROM graph_edges ge JOIN traversal t ON ge.source_id = t.node_id
    WHERE t.depth < 6 AND INSTR(t.path, ','||ge.target_id||',') = 0
    UNION ALL
    SELECT ge.source_id, t.depth + 1, t.path || ge.source_id || ',', ge.edge_type
    FROM graph_edges ge JOIN traversal t ON ge.target_id = t.node_id
    WHERE t.depth < 6 AND INSTR(t.path, ','||ge.source_id||',') = 0
  )
  SELECT node_id, MIN(depth) AS min_depth, edge_type
  FROM traversal WHERE node_id != ?
  GROUP BY node_id ORDER BY min_depth LIMIT 50
`;

const GET_CHUNK_QUERY = `
  SELECT id, file_path, chunk_type, content, start_line, end_line
  FROM lcs_chunks
  WHERE id = ? AND is_deleted = 0
`;

export type GraphTraversalRow = BfsRow;

function detectLanguage(filePath: string): string {
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

export function getGraphTraversalRows(
  startCni: string,
  db: Database.Database,
  maxDepth = 6,
  maxNodes = 50
): GraphTraversalRow[] {
  void maxDepth;
  void maxNodes;
  return db.prepare(BFS_QUERY).all(startCni, startCni, startCni) as GraphTraversalRow[];
}

export function traverseGraph(
  startCni: string,
  db: Database.Database,
  maxDepth = 6,
  maxNodes = 50
): string {
  const rows = getGraphTraversalRows(startCni, db, maxDepth, maxNodes);

  if (rows.length === 0) {
    return `[METADATA: NO_GRAPH_EDGES]\n\nNo graph edges found for: ${startCni}`;
  }

  const selectChunk = db.prepare(GET_CHUNK_QUERY);
  const blocks: string[] = [];
  let rank = 1;

  for (const row of rows) {
    const chunk = selectChunk.get(row.node_id) as ChunkRow | undefined;

    if (chunk === undefined) {
      continue;
    }

    blocks.push(
      `[DEPTH:${row.min_depth} via ${row.edge_type}]\n`
      + `--- CHUNK ${rank} score=1.0000\n`
      + `PATH: ${chunk.file_path}\n`
      + `CNI: ${chunk.id}\n`
      + `TYPE: ${chunk.chunk_type}\n`
      + `LINES: ${chunk.start_line}-${chunk.end_line}\n`
      + `\`\`\`${detectLanguage(chunk.file_path)}\n`
      + `${chunk.content}\n`
      + "```"
    );
    rank += 1;
  }

  return blocks.join("\n\n");
}
