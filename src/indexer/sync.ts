import { statSync } from "node:fs";

import { blake3 } from "hash-wasm";
import type Database from "better-sqlite3";

import { embedChunks } from "./embedder.js";
import { chunkFile, type BasicChunk } from "./chunker-basic.js";

type EmbedChunksFn = typeof embedChunks;

type ExistingChunkRow = {
  id: string;
};

let embedChunksImpl: EmbedChunksFn = embedChunks;

function buildChunkId(filePath: string, fileHash: string, chunk: BasicChunk): string {
  const hashSuffix = fileHash.slice(0, 12);
  return `${filePath}::chunk::${chunk.startLine}-${chunk.endLine}::${hashSuffix}`;
}

export function setEmbedChunksForTesting(override: EmbedChunksFn | null): void {
  embedChunksImpl = override ?? embedChunks;
}

export async function indexFile(db: Database.Database, filePath: string, content: string): Promise<void> {
  const fileStats = statSync(filePath, { bigint: true });
  const rawHash = await blake3(content);
  const contentHash = `blake3:${rawHash}`;
  const now = new Date().toISOString();
  const chunks = chunkFile(content);

  const selectExistingChunks = db.prepare(`
    SELECT id
    FROM lcs_chunks
    WHERE file_path = ?
      AND is_deleted = 0
  `);
  const softDeleteChunks = db.prepare(`
    UPDATE lcs_chunks
    SET is_deleted = 1, deleted_at = ?
    WHERE file_path = ?
      AND is_deleted = 0
  `);
  const deleteVecChunk = db.prepare("DELETE FROM vec_lcs_chunks WHERE id = ?");
  const deleteKeywordChunk = db.prepare("DELETE FROM fts_lcs_chunks_kw WHERE id = ?");
  const deleteSubstringChunk = db.prepare("DELETE FROM fts_lcs_chunks_sub WHERE id = ?");
  const insertChunk = db.prepare(`
    INSERT INTO lcs_chunks(
      id,
      file_path,
      chunk_type,
      content,
      start_line,
      end_line,
      is_deleted,
      deleted_at,
      content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVecChunk = db.prepare(`
    INSERT INTO vec_lcs_chunks(id, embedding)
    VALUES (?, ?)
  `);
  const insertKeywordChunk = db.prepare(`
    INSERT INTO fts_lcs_chunks_kw(id, content)
    VALUES (?, ?)
  `);
  const insertSubstringChunk = db.prepare(`
    INSERT INTO fts_lcs_chunks_sub(id, content)
    VALUES (?, ?)
  `);
  const upsertFileScanCache = db.prepare(`
    INSERT INTO file_scan_cache(
      file_path,
      mtime_ns,
      size_bytes,
      content_hash,
      last_scanned_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      mtime_ns = excluded.mtime_ns,
      size_bytes = excluded.size_bytes,
      content_hash = excluded.content_hash,
      last_scanned_at = excluded.last_scanned_at
  `);

  db.exec("BEGIN IMMEDIATE");

  try {
    const existingChunks = selectExistingChunks.all(filePath) as ExistingChunkRow[];
    softDeleteChunks.run(now, filePath);

    for (const existingChunk of existingChunks) {
      deleteVecChunk.run(existingChunk.id);
      deleteKeywordChunk.run(existingChunk.id);
      deleteSubstringChunk.run(existingChunk.id);
    }

    const chunkIds = chunks.map((chunk) => buildChunkId(filePath, rawHash, chunk));
    const embeddings = await embedChunksImpl(chunks.map((chunk) => chunk.content));

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const chunkId = chunkIds[index];
      const embedding = embeddings[index];

      insertChunk.run(
        chunkId,
        filePath,
        "doc",
        chunk.content,
        chunk.startLine,
        chunk.endLine,
        0,
        null,
        contentHash
      );
      insertVecChunk.run(chunkId, embedding);
      deleteKeywordChunk.run(chunkId);
      insertKeywordChunk.run(chunkId, chunk.content);
      deleteSubstringChunk.run(chunkId);
      insertSubstringChunk.run(chunkId, chunk.content);
    }

    upsertFileScanCache.run(
      filePath,
      Number(fileStats.mtimeNs),
      Number(fileStats.size),
      contentHash,
      now
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
