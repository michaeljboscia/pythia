import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runGc, shouldRunGc } from "../db/gc.js";
import { runMigrations } from "../db/migrate.js";

function createTempDb(): { cleanup: () => void; dbPath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-gc-"));

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath: path.join(directory, "lcs.db")
  };
}

function insertChunk(
  db: ReturnType<typeof openDb>,
  id: string,
  options: {
    deletedAt?: string | null;
    isDeleted?: number;
  } = {}
): void {
  db.prepare(`
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
  `).run(
    id,
    "src/auth.ts",
    "function",
    `export function ${id.replace(/[^a-z0-9_]/gi, "_")}() {}`,
    0,
    1,
    options.isDeleted ?? 0,
    options.deletedAt ?? null,
    "blake3:test"
  );
}

function insertDerivedRows(db: ReturnType<typeof openDb>, id: string): void {
  db.prepare("INSERT INTO vec_lcs_chunks(id, embedding) VALUES (?, ?)").run(
    id,
    new Float32Array(256).fill(0.5)
  );
  db.prepare("INSERT INTO fts_lcs_chunks_kw(id, content) VALUES (?, ?)").run(id, `kw ${id}`);
  db.prepare("INSERT INTO fts_lcs_chunks_sub(id, content) VALUES (?, ?)").run(id, `sub ${id}`);
}

test("chunks older than retention are hard-deleted from all indexed tables", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    insertChunk(db, "stale-a", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });
    insertChunk(db, "stale-b", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });
    insertDerivedRows(db, "stale-a");
    insertDerivedRows(db, "stale-b");

    const result = runGc(db, 30);

    const chunkCount = db.prepare("SELECT COUNT(*) AS count FROM lcs_chunks WHERE id IN (?, ?)").get(
      "stale-a",
      "stale-b"
    ) as { count: number };
    const vecCount = db.prepare("SELECT COUNT(*) AS count FROM vec_lcs_chunks WHERE id IN (?, ?)").get(
      "stale-a",
      "stale-b"
    ) as { count: number };
    const kwCount = db.prepare("SELECT COUNT(*) AS count FROM fts_lcs_chunks_kw WHERE id IN (?, ?)").get(
      "stale-a",
      "stale-b"
    ) as { count: number };
    const subCount = db.prepare("SELECT COUNT(*) AS count FROM fts_lcs_chunks_sub WHERE id IN (?, ?)").get(
      "stale-a",
      "stale-b"
    ) as { count: number };

    assert.equal(result.chunksDeleted, 2);
    assert.equal(chunkCount.count, 0);
    assert.equal(vecCount.count, 0);
    assert.equal(kwCount.count, 0);
    assert.equal(subCount.count, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("chunks within retention are left untouched", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    insertChunk(db, "recent", { isDeleted: 1, deletedAt: new Date().toISOString() });
    insertDerivedRows(db, "recent");

    const result = runGc(db, 30);

    const chunkCount = db.prepare("SELECT COUNT(*) AS count FROM lcs_chunks WHERE id = ?").get("recent") as {
      count: number;
    };
    const vecCount = db.prepare("SELECT COUNT(*) AS count FROM vec_lcs_chunks WHERE id = ?").get("recent") as {
      count: number;
    };

    assert.equal(result.chunksDeleted, 0);
    assert.equal(chunkCount.count, 1);
    assert.equal(vecCount.count, 1);
  } finally {
    db.close();
    cleanup();
  }
});

test("active chunks are never deleted regardless of age", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    insertChunk(db, "active-old", { isDeleted: 0, deletedAt: "2020-01-01T00:00:00.000Z" });
    insertDerivedRows(db, "active-old");

    const result = runGc(db, 30);

    const chunk = db.prepare("SELECT is_deleted FROM lcs_chunks WHERE id = ?").get("active-old") as {
      is_deleted: number;
    };

    assert.equal(result.chunksDeleted, 0);
    assert.equal(chunk.is_deleted, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("shouldRunGc returns true when tombstones exceed 10,000", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    const insert = db.prepare(`
      INSERT INTO lcs_chunks(
        id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash
      ) VALUES (?, 'src/auth.ts', 'function', 'x', 0, 0, 1, '2020-01-01T00:00:00.000Z', 'blake3:test')
    `);

    db.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < 10001; index += 1) {
      insert.run(`dead-${index}`);
    }
    db.exec("COMMIT");

    assert.equal(shouldRunGc(db), true);
  } finally {
    db.close();
    cleanup();
  }
});

test("shouldRunGc returns true when tombstone ratio exceeds 20%", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    insertChunk(db, "dead-1", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });
    insertChunk(db, "dead-2", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });
    for (let index = 0; index < 6; index += 1) {
      insertChunk(db, `live-${index}`);
    }

    assert.equal(shouldRunGc(db), true);
  } finally {
    db.close();
    cleanup();
  }
});

test("shouldRunGc returns false when below thresholds", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    insertChunk(db, "dead-1", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });
    for (let index = 0; index < 9; index += 1) {
      insertChunk(db, `live-${index}`);
    }

    assert.equal(shouldRunGc(db), false);
  } finally {
    db.close();
    cleanup();
  }
});

test("GC returns a deletion count matching actual stale chunk deletions", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    insertChunk(db, "dead-1", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });
    insertChunk(db, "dead-2", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });
    insertChunk(db, "recent", { isDeleted: 1, deletedAt: new Date().toISOString() });

    const result = runGc(db, 30);

    const remaining = db.prepare("SELECT COUNT(*) AS count FROM lcs_chunks").get() as { count: number };
    assert.equal(result.chunksDeleted, 2);
    assert.equal(remaining.count, 1);
    assert.equal(typeof result.bytesReclaimed, "number");
  } finally {
    db.close();
    cleanup();
  }
});

test("incremental_vacuum runs after the transaction commits", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);
  const events: string[] = [];
  const originalExec = db.exec.bind(db);

  try {
    runMigrations(db);
    insertChunk(db, "dead-1", { isDeleted: 1, deletedAt: "2020-01-01T00:00:00.000Z" });

    db.exec = ((sql: string) => {
      events.push(sql.trim());
      return originalExec(sql);
    }) as typeof db.exec;

    runGc(db, 30, {
      runIncrementalVacuum: () => {
        events.push("PRAGMA incremental_vacuum");
      }
    });

    const commitIndex = events.indexOf("COMMIT");
    const pragmaIndex = events.indexOf("PRAGMA incremental_vacuum");

    assert.notEqual(commitIndex, -1);
    assert.notEqual(pragmaIndex, -1);
    assert.ok(pragmaIndex > commitIndex);
  } finally {
    db.exec = originalExec;
    db.close();
    cleanup();
  }
});
