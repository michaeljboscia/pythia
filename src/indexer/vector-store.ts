import type Database from "better-sqlite3";

export type VectorResult = {
  distance: number;
  id: string;
};

export interface VectorStore {
  delete(ids: string[]): Promise<void>;
  query(embedding: Float32Array, limit: number): Promise<VectorResult[]>;
  upsert(id: string, embedding: Float32Array): Promise<void>;
}

export class SqliteVectorStore implements VectorStore {
  constructor(private readonly db: Database.Database) {}

  async upsert(id: string, embedding: Float32Array): Promise<void> {
    this.db.prepare("DELETE FROM vec_lcs_chunks WHERE id = ?").run(id);
    this.db.prepare(`
      INSERT INTO vec_lcs_chunks(id, embedding)
      VALUES (?, ?)
    `).run(id, embedding);
  }

  async query(embedding: Float32Array, limit: number): Promise<VectorResult[]> {
    return this.db.prepare(`
      SELECT id, distance
      FROM vec_lcs_chunks
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `).all(embedding, limit) as VectorResult[];
  }

  async delete(ids: string[]): Promise<void> {
    const deleteStatement = this.db.prepare("DELETE FROM vec_lcs_chunks WHERE id = ?");

    for (const id of ids) {
      deleteStatement.run(id);
    }
  }
}

export class QdrantVectorStore implements VectorStore {
  async upsert(_id: string, _embedding: Float32Array): Promise<void> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async query(_embedding: Float32Array, _limit: number): Promise<never[]> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async delete(_ids: string[]): Promise<void> {
    throw new Error("NOT_IMPLEMENTED");
  }
}

export function createVectorStore(
  backend: "qdrant" | "sqlite",
  db: Database.Database
): VectorStore {
  if (backend === "qdrant") {
    return new QdrantVectorStore();
  }

  return new SqliteVectorStore(db);
}
