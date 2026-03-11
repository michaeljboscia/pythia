import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";

function createTempDbPath(): { cleanup: () => void; dbPath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-migrate-"));

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath: path.join(directory, "lcs.db")
  };
}

test("running migrations twice is idempotent", () => {
  const { cleanup, dbPath } = createTempDbPath();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    runMigrations(db);

    const rows = db
      .prepare("SELECT name FROM _migrations ORDER BY name")
      .all() as Array<{ name: string }>;

    assert.deepEqual(rows.map((row) => row.name), [
      "001-initial-schema.sql",
      "002-graph-trigger.sql"
    ]);
  } finally {
    db.close();
    cleanup();
  }
});

test("all expected tables exist after migration", () => {
  const { cleanup, dbPath } = createTempDbPath();
  const db = openDb(dbPath);

  try {
    runMigrations(db);

    const rows = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type IN ('table', 'virtual table')
        AND name IN (
          '_migrations',
          'lcs_chunks',
          'vec_lcs_chunks',
          'fts_lcs_chunks_kw',
          'fts_lcs_chunks_sub',
          'file_scan_cache',
          'pythia_memories',
          'pythia_sessions',
          'pythia_transcripts',
          'graph_edges',
          'embedding_meta'
        )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    assert.deepEqual(rows.map((row) => row.name), [
      "_migrations",
      "embedding_meta",
      "file_scan_cache",
      "fts_lcs_chunks_kw",
      "fts_lcs_chunks_sub",
      "graph_edges",
      "lcs_chunks",
      "pythia_memories",
      "pythia_sessions",
      "pythia_transcripts",
      "vec_lcs_chunks"
    ]);
  } finally {
    db.close();
    cleanup();
  }
});

test("graph_edges trigger aborts invalid inserts with INVALID_GRAPH_ENDPOINT", () => {
  const { cleanup, dbPath } = createTempDbPath();
  const db = openDb(dbPath);

  try {
    runMigrations(db);

    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO graph_edges(source_id, target_id, edge_type)
          VALUES (?, ?, ?)
        `).run("missing-source", "missing-target", "CALLS");
      },
      /INVALID_GRAPH_ENDPOINT/
    );
  } finally {
    db.close();
    cleanup();
  }
});

test("vec_lcs_chunks accepts float[256] inserts", () => {
  const { cleanup, dbPath } = createTempDbPath();
  const db = openDb(dbPath);

  try {
    runMigrations(db);

    db.prepare(`
      INSERT INTO vec_lcs_chunks(id, embedding)
      VALUES (?, ?)
    `).run("chunk-1", new Float32Array(256).fill(0.125));

    const row = db.prepare("SELECT id FROM vec_lcs_chunks WHERE id = ?").get("chunk-1") as { id: string };
    assert.equal(row.id, "chunk-1");
  } finally {
    db.close();
    cleanup();
  }
});
