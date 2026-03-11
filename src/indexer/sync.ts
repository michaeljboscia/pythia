import { statSync } from "node:fs";

import { blake3 } from "hash-wasm";
import type Database from "better-sqlite3";

import { embedChunks } from "./embedder.js";
import { chunkFile, type BasicChunk } from "./chunker-basic.js";
import type { Chunk } from "./chunker-treesitter.js";

type EmbedChunksFn = typeof embedChunks;

type ExistingChunkRow = {
  id: string;
};

type SyncChunk = Pick<Chunk, "id" | "file_path" | "chunk_type" | "content" | "start_line" | "end_line">;

type IndexFileOptions = {
  chunks?: SyncChunk[];
  contentHash?: string;
  embeddings?: Float32Array[];
  mtimeNs?: bigint;
  sizeBytes?: bigint;
};

let embedChunksImpl: EmbedChunksFn = embedChunks;

function buildChunkId(filePath: string, fileHash: string, chunk: BasicChunk): string {
  const hashSuffix = fileHash.slice(0, 12);
  return `${filePath}::chunk::${chunk.startLine}-${chunk.endLine}::${hashSuffix}`;
}

export function setEmbedChunksForTesting(override: EmbedChunksFn | null): void {
  embedChunksImpl = override ?? embedChunks;
}

function buildBasicChunks(filePath: string, rawHash: string, content: string): SyncChunk[] {
  return chunkFile(content).map((chunk) => ({
    id: buildChunkId(filePath, rawHash, chunk),
    file_path: filePath,
    chunk_type: "doc",
    content: chunk.content,
    start_line: chunk.startLine,
    end_line: chunk.endLine
  }));
}

export async function indexFile(
  db: Database.Database,
  filePath: string,
  content: string,
  options: IndexFileOptions = {}
): Promise<void> {
  const fileStats = statSync(filePath, { bigint: true });
  const rawHash = await blake3(content);
  const contentHash = options.contentHash ?? `blake3:${rawHash}`;
  const now = new Date().toISOString();
  const chunks = options.chunks ?? buildBasicChunks(filePath, rawHash, content);
  const embeddings = options.embeddings ?? await embedChunksImpl(chunks.map((chunk) => chunk.content));
  const storedFilePath = chunks[0]?.file_path ?? filePath;

  if (embeddings.length !== chunks.length) {
    throw new Error("Embedding count does not match chunk count");
  }

  const selectExistingChunks = db.prepare(`
    SELECT id
    FROM lcs_chunks
    WHERE file_path = ?
      AND is_deleted = 0
  `);
  const softDeleteChunks = db.prepare(`
    UPDATE lcs_chunks
    SET is_deleted = 1, deleted_at = ?
    WHERE id = ?
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
  const updateChunk = db.prepare(`
    UPDATE lcs_chunks
    SET
      file_path = ?,
      chunk_type = ?,
      content = ?,
      start_line = ?,
      end_line = ?,
      is_deleted = 0,
      deleted_at = NULL,
      content_hash = ?
    WHERE id = ?
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
    const existingChunks = selectExistingChunks.all(storedFilePath) as ExistingChunkRow[];
    const existingChunkById = new Map(existingChunks.map((chunk) => [chunk.id, chunk]));
    const nextChunkIds = new Set(chunks.map((chunk) => chunk.id));

    for (const existingChunk of existingChunks) {
      if (!nextChunkIds.has(existingChunk.id)) {
        softDeleteChunks.run(now, existingChunk.id);
        deleteVecChunk.run(existingChunk.id);
        deleteKeywordChunk.run(existingChunk.id);
        deleteSubstringChunk.run(existingChunk.id);
      }
    }

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const embedding = embeddings[index];
      const existingChunk = existingChunkById.get(chunk.id);

      if (existingChunk === undefined) {
        insertChunk.run(
          chunk.id,
          chunk.file_path,
          chunk.chunk_type,
          chunk.content,
          chunk.start_line,
          chunk.end_line,
          0,
          null,
          contentHash
        );
      } else {
        updateChunk.run(
          chunk.file_path,
          chunk.chunk_type,
          chunk.content,
          chunk.start_line,
          chunk.end_line,
          contentHash,
          chunk.id
        );
      }

      deleteVecChunk.run(chunk.id);
      insertVecChunk.run(chunk.id, embedding);
      deleteKeywordChunk.run(chunk.id);
      insertKeywordChunk.run(chunk.id, chunk.content);
      deleteSubstringChunk.run(chunk.id);
      insertSubstringChunk.run(chunk.id, chunk.content);
    }

    upsertFileScanCache.run(
      filePath,
      Number(options.mtimeNs ?? fileStats.mtimeNs),
      Number(options.sizeBytes ?? fileStats.size),
      contentHash,
      now
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
