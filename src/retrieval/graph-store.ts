import type Database from "better-sqlite3";

import { traverseGraph } from "./graph.js";

export interface GraphStore {
  deleteEdgesForChunk(chunkId: string): Promise<void>;
  insertEdge(source: string, target: string, type: string): Promise<void>;
  traverse(startNode: string, maxDepth: number, maxNodes: number): Promise<string>;
}

export class SqliteGraphStore implements GraphStore {
  constructor(private readonly db: Database.Database) {}

  async insertEdge(source: string, target: string, type: string): Promise<void> {
    this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges(source_id, target_id, edge_type)
      VALUES (?, ?, ?)
    `).run(source, target, type);
  }

  async traverse(startNode: string, maxDepth: number, maxNodes: number): Promise<string> {
    return traverseGraph(startNode, this.db, maxDepth, maxNodes);
  }

  async deleteEdgesForChunk(chunkId: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM graph_edges
      WHERE source_id = ? OR target_id = ?
    `).run(chunkId, chunkId);
  }
}

export class FalkorDbGraphStore implements GraphStore {
  async insertEdge(_source: string, _target: string, _type: string): Promise<void> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async traverse(_startNode: string, _maxDepth: number, _maxNodes: number): Promise<string> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async deleteEdgesForChunk(_chunkId: string): Promise<void> {
    throw new Error("NOT_IMPLEMENTED");
  }
}

export function createGraphStore(
  backend: "falkordb" | "sqlite",
  db: Database.Database
): GraphStore {
  if (backend === "falkordb") {
    return new FalkorDbGraphStore();
  }

  return new SqliteGraphStore(db);
}
