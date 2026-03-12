import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { PythiaConfig } from "../config.js";
import { chunkFile } from "../indexer/chunker-treesitter.js";
import { scanWorkspace, type FileChange } from "../indexer/cdc.js";
import { embedChunks } from "../indexer/embedder.js";
import { hashFile } from "../indexer/hasher.js";
import type { IndexingSupervisor } from "../indexer/supervisor.js";
import { indexFile } from "../indexer/sync.js";

type ScanWorkspaceFn = typeof scanWorkspace;
type EmbedChunksFn = typeof embedChunks;
type IndexFileFn = typeof indexFile;

export const forceIndexInputSchema = {
  path: z.string().optional().describe(
    "Repo-relative path to file or directory. Omit for full workspace scan."
  )
};

type ForceIndexDependencies = {
  embedChunksImpl?: EmbedChunksFn;
  indexFileImpl?: IndexFileFn;
  scanWorkspaceImpl?: ScanWorkspaceFn;
};

type ForceIndexSummary = {
  chunksIndexed: number;
  filesIndexed: number;
};

type ForceIndexBatch = {
  files: string[];
  reason: "force" | "warm";
};

function invalidPathError(inputPath: string): McpError {
  return new McpError(
    ErrorCode.InvalidParams,
    `Path '${inputPath}' is invalid or resolves outside the workspace`,
    { error_code: "INVALID_PATH" }
  );
}

function isBinaryBuffer(buffer: Buffer): boolean {
  for (const byte of buffer.subarray(0, 4096)) {
    if (byte === 0x00) {
      return true;
    }
  }

  return false;
}

function resolveTargetPath(workspaceRoot: string, targetPath: string): string {
  if (path.isAbsolute(targetPath) || targetPath.includes("../")) {
    throw invalidPathError(targetPath);
  }

  const resolvedPath = path.resolve(workspaceRoot, targetPath);
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);

  if (resolvedPath !== normalizedWorkspaceRoot && !resolvedPath.startsWith(`${normalizedWorkspaceRoot}${path.sep}`)) {
    throw invalidPathError(targetPath);
  }

  if (!existsSync(resolvedPath)) {
    throw invalidPathError(targetPath);
  }

  return resolvedPath;
}

async function indexSingleFile(
  db: Database.Database,
  workspaceRoot: string,
  config: Partial<Pick<PythiaConfig, "indexing">>,
  filePath: string,
  embedChunksImpl: EmbedChunksFn,
  indexFileImpl: IndexFileFn,
  contentHash?: string
): Promise<number> {
  const fileBuffer = readFileSync(filePath);

  if (isBinaryBuffer(fileBuffer)) {
    return 0;
  }

  const content = fileBuffer.toString("utf8");
  const chunks = chunkFile(filePath, content, workspaceRoot, config.indexing);

  if (chunks.length === 0) {
    return 0;
  }

  const embeddings = await embedChunksImpl(chunks.map((chunk) => chunk.content));
  const stats = statSync(filePath, { bigint: true });

  await indexFileImpl(db, filePath, content, {
    chunks,
    contentHash: contentHash ?? await hashFile(fileBuffer),
    embeddings,
    mtimeNs: stats.mtimeNs,
    sizeBytes: stats.size
  });

  return chunks.length;
}

function collectWorkspaceChanges(
  workspaceChanges: FileChange[],
  normalizedPrefix: string
): FileChange[] {
  const prefix = normalizedPrefix === "" ? "" : `${normalizedPrefix}/`;

  return workspaceChanges.filter((change) => (
    change.repoRelativePath === normalizedPrefix || change.repoRelativePath.startsWith(prefix)
  ));
}

async function resolveBatchFiles(
  workspaceRoot: string,
  db: Database.Database,
  targetPath: string | undefined,
  scanWorkspaceImpl: ScanWorkspaceFn
): Promise<ForceIndexBatch> {
  if (targetPath === undefined) {
    const changes = await scanWorkspaceImpl(workspaceRoot, db, false);
    return {
      files: changes.map((change) => change.filePath),
      reason: "warm"
    };
  }

  const resolvedPath = resolveTargetPath(workspaceRoot, targetPath);
  const stats = statSync(resolvedPath);

  if (stats.isDirectory()) {
    const normalizedPrefix = path.relative(workspaceRoot, resolvedPath).split(path.sep).join("/");
    const changes = await scanWorkspaceImpl(workspaceRoot, db, false);

    return {
      files: collectWorkspaceChanges(changes, normalizedPrefix).map((change) => change.filePath),
      reason: "warm"
    };
  }

  return {
    files: [resolvedPath],
    reason: "force"
  };
}

function countIndexedChunks(db: Database.Database, files: string[]): number {
  if (files.length === 0) {
    return 0;
  }

  const placeholders = files.map(() => "?").join(", ");
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM lcs_chunks
    WHERE is_deleted = 0
      AND file_path IN (${placeholders})
  `).get(...files) as { count: number };

  return row.count;
}

export async function forceIndexPath(
  db: Database.Database,
  config: Pick<PythiaConfig, "workspace_path"> & Partial<Pick<PythiaConfig, "indexing">>,
  targetPath?: string,
  dependencies: ForceIndexDependencies = {}
): Promise<ForceIndexSummary> {
  const workspaceRoot = path.resolve(config.workspace_path);
  const embedChunksImpl = dependencies.embedChunksImpl ?? embedChunks;
  const indexFileImpl = dependencies.indexFileImpl ?? indexFile;
  const scanWorkspaceImpl = dependencies.scanWorkspaceImpl ?? scanWorkspace;
  let fileChanges: FileChange[] = [];

  if (targetPath === undefined) {
    fileChanges = await scanWorkspaceImpl(workspaceRoot, db, false);
  } else {
    const resolvedPath = resolveTargetPath(workspaceRoot, targetPath);
    const stats = statSync(resolvedPath);

    if (stats.isDirectory()) {
      const normalizedPrefix = path.relative(workspaceRoot, resolvedPath).split(path.sep).join("/");
      const prefix = normalizedPrefix === "" ? "" : `${normalizedPrefix}/`;
      const workspaceChanges = await scanWorkspaceImpl(workspaceRoot, db, false);
      fileChanges = workspaceChanges.filter((change) => (
        change.repoRelativePath === normalizedPrefix || change.repoRelativePath.startsWith(prefix)
      ));
    } else {
      const chunksIndexed = await indexSingleFile(
        db,
        workspaceRoot,
        config,
        resolvedPath,
        embedChunksImpl,
        indexFileImpl
      );

      return {
        chunksIndexed,
        filesIndexed: chunksIndexed > 0 ? 1 : 0
      };
    }
  }

  let filesIndexed = 0;
  let chunksIndexed = 0;

  for (const change of fileChanges) {
    const indexedChunks = await indexSingleFile(
      db,
      workspaceRoot,
      config,
      change.filePath,
      embedChunksImpl,
      indexFileImpl,
      change.contentHash
    );

    if (indexedChunks === 0) {
      continue;
    }

    filesIndexed += 1;
    chunksIndexed += indexedChunks;
  }

  return { chunksIndexed, filesIndexed };
}

export function createForceIndexHandler(
  db: Database.Database,
  config: PythiaConfig,
  dependencies: ForceIndexDependencies = {},
  supervisor?: Pick<IndexingSupervisor, "sendBatch">
) {
  const scanWorkspaceImpl = dependencies.scanWorkspaceImpl ?? scanWorkspace;

  return async ({ path: targetPath }: { path?: string }) => {
    if (supervisor !== undefined) {
      const batch = await resolveBatchFiles(
        path.resolve(config.workspace_path),
        db,
        targetPath,
        scanWorkspaceImpl
      );

      if (batch.files.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "[STATUS: INDEX_MERGED]\n\nAll files up to date. 0 files re-indexed."
          }]
        };
      }

      await supervisor.sendBatch(batch.files, batch.reason);

      return {
        content: [{
          type: "text" as const,
          text: `[STATUS: INDEX_MERGED]\n\nIndexed ${batch.files.length} files (${countIndexedChunks(db, batch.files)} chunks).`
        }]
      };
    }

    const summary = await forceIndexPath(db, config, targetPath, dependencies);

    if (summary.filesIndexed === 0) {
      return {
        content: [{
          type: "text" as const,
          text: "[STATUS: INDEX_MERGED]\n\nAll files up to date. 0 files re-indexed."
        }]
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: `[STATUS: INDEX_MERGED]\n\nIndexed ${summary.filesIndexed} files (${summary.chunksIndexed} chunks).`
      }]
    };
  };
}
