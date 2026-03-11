import type Database from "better-sqlite3";

export type GcResult = {
  bytesReclaimed: number | null;
  chunksDeleted: number;
};

type ChunkIdRow = {
  id: string;
};

type TombstoneStatsRow = {
  tombstones: number;
  total: number;
};

type RunGcDependencies = {
  runIncrementalVacuum?: (db: Database.Database) => void;
};

function getPageCount(db: Database.Database): number | null {
  const result = db.pragma("page_count", { simple: true });
  return typeof result === "number" ? result : null;
}

function getPageSize(db: Database.Database): number | null {
  const result = db.pragma("page_size", { simple: true });
  return typeof result === "number" ? result : null;
}

export function shouldRunGc(db: Database.Database): boolean {
  const row = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE is_deleted = 1) AS tombstones,
      COUNT(*) AS total
    FROM lcs_chunks
  `).get() as TombstoneStatsRow;

  return row.tombstones > 10_000 || (row.total > 0 && row.tombstones / row.total > 0.2);
}

export function runGc(
  db: Database.Database,
  retentionDays: number,
  dependencies: RunGcDependencies = {}
): GcResult {
  const runIncrementalVacuum = dependencies.runIncrementalVacuum ?? ((database: Database.Database) => {
    database.pragma("incremental_vacuum");
  });
  const pageCountBefore = getPageCount(db);
  const pageSize = getPageSize(db);
  const staleChunkRows = db.prepare(`
    SELECT id
    FROM lcs_chunks
    WHERE is_deleted = 1
      AND deleted_at IS NOT NULL
      AND datetime(deleted_at) < datetime('now', '-' || ? || ' days')
  `).all(retentionDays) as ChunkIdRow[];
  const staleChunkIds = staleChunkRows.map((row) => row.id);

  db.exec("BEGIN IMMEDIATE");

  try {
    for (const chunkId of staleChunkIds) {
      db.prepare("DELETE FROM vec_lcs_chunks WHERE id = ?").run(chunkId);
      db.prepare("DELETE FROM fts_lcs_chunks_kw WHERE id = ?").run(chunkId);
      db.prepare("DELETE FROM fts_lcs_chunks_sub WHERE id = ?").run(chunkId);
    }

    db.prepare(`
      DELETE FROM lcs_chunks
      WHERE is_deleted = 1
        AND deleted_at IS NOT NULL
        AND datetime(deleted_at) < datetime('now', '-' || ? || ' days')
    `).run(retentionDays);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  runIncrementalVacuum(db);

  const pageCountAfter = getPageCount(db);
  const bytesReclaimed = pageCountBefore === null || pageCountAfter === null || pageSize === null
    ? null
    : Math.max(0, pageCountBefore - pageCountAfter) * pageSize;

  return {
    chunksDeleted: staleChunkIds.length,
    bytesReclaimed
  };
}
