import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { indexFile, setEmbedChunksForTesting } from "../indexer/sync.js";

function createWorkspace(): { cleanup: () => void; dbPath: string; filePath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-sync-"));

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath: path.join(directory, "lcs.db"),
    filePath: path.join(directory, "example.ts")
  };
}

test("indexing a file creates rows in lcs_chunks and vec_lcs_chunks", async () => {
  const { cleanup, dbPath, filePath } = createWorkspace();
  const db = openDb(dbPath);
  const content = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");
  writeFileSync(filePath, content, "utf8");

  try {
    runMigrations(db);
    await indexFile(db, filePath, content);

    const chunkCount = db.prepare("SELECT COUNT(*) AS count FROM lcs_chunks").get() as { count: number };
    const vecCount = db.prepare("SELECT COUNT(*) AS count FROM vec_lcs_chunks").get() as { count: number };

    assert.ok(chunkCount.count > 0);
    assert.equal(vecCount.count, chunkCount.count);
  } finally {
    db.close();
    cleanup();
  }
});

test("re-indexing the same file marks old chunks is_deleted=1", async () => {
  const { cleanup, dbPath, filePath } = createWorkspace();
  const db = openDb(dbPath);
  const firstContent = Array.from({ length: 60 }, (_, index) => `alpha ${index + 1}`).join("\n");
  const secondContent = Array.from({ length: 60 }, (_, index) => `beta ${index + 1}`).join("\n");
  writeFileSync(filePath, firstContent, "utf8");

  try {
    runMigrations(db);
    await indexFile(db, filePath, firstContent);

    writeFileSync(filePath, secondContent, "utf8");
    await indexFile(db, filePath, secondContent);

    const deletedCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM lcs_chunks
      WHERE file_path = ?
        AND is_deleted = 1
    `).get(filePath) as { count: number };
    const liveCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM lcs_chunks
      WHERE file_path = ?
        AND is_deleted = 0
    `).get(filePath) as { count: number };

    assert.ok(deletedCount.count > 0);
    assert.ok(liveCount.count > 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("file_scan_cache updated with correct content_hash", async () => {
  const { cleanup, dbPath, filePath } = createWorkspace();
  const db = openDb(dbPath);
  const content = "export const value = 42;\n";
  writeFileSync(filePath, content, "utf8");

  try {
    runMigrations(db);
    await indexFile(db, filePath, content);

    const row = db.prepare(`
      SELECT content_hash
      FROM file_scan_cache
      WHERE file_path = ?
    `).get(filePath) as { content_hash: string };

    assert.match(row.content_hash, /^blake3:[a-f0-9]+$/);
  } finally {
    db.close();
    cleanup();
  }
});

test("transaction rollback on embed failure leaves DB unchanged", async () => {
  const { cleanup, dbPath, filePath } = createWorkspace();
  const db = openDb(dbPath);
  const initialContent = "const alpha = 1;\nconst beta = 2;\n";
  const failingContent = "const gamma = 3;\nconst delta = 4;\n";
  writeFileSync(filePath, initialContent, "utf8");

  try {
    runMigrations(db);
    await indexFile(db, filePath, initialContent);

    const beforeFailure = db.prepare(`
      SELECT COUNT(*) AS count
      FROM lcs_chunks
      WHERE file_path = ?
        AND is_deleted = 0
    `).get(filePath) as { count: number };

    setEmbedChunksForTesting(async () => {
      throw new Error("EMBED_FAIL");
    });

    writeFileSync(filePath, failingContent, "utf8");

    await assert.rejects(
      () => indexFile(db, filePath, failingContent),
      /EMBED_FAIL/
    );

    const afterFailure = db.prepare(`
      SELECT COUNT(*) AS count
      FROM lcs_chunks
      WHERE file_path = ?
        AND is_deleted = 0
    `).get(filePath) as { count: number };
    const cacheRow = db.prepare(`
      SELECT COUNT(*) AS count
      FROM file_scan_cache
      WHERE file_path = ?
        AND content_hash NOT LIKE 'blake3:%'
    `).get(filePath) as { count: number };

    assert.equal(afterFailure.count, beforeFailure.count);
    assert.equal(cacheRow.count, 0);
  } finally {
    setEmbedChunksForTesting(null);
    db.close();
    cleanup();
  }
});
