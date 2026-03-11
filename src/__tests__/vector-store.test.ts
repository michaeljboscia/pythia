import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import {
  createVectorStore,
  QdrantVectorStore,
  SqliteVectorStore
} from "../indexer/vector-store.js";

function createTempDb(): { cleanup: () => void; dbPath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-vector-store-"));

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath: path.join(directory, "lcs.db")
  };
}

test("SqliteVectorStore.upsert inserts a row into vec_lcs_chunks", async () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);
  const store = new SqliteVectorStore(db);

  try {
    runMigrations(db);
    await store.upsert("chunk-a", new Float32Array(256).fill(0.1));

    const row = db.prepare("SELECT id FROM vec_lcs_chunks WHERE id = ?").get("chunk-a") as { id: string };
    assert.equal(row.id, "chunk-a");
  } finally {
    db.close();
    cleanup();
  }
});

test("SqliteVectorStore.query matches the direct SQL neighbors", async () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);
  const store = new SqliteVectorStore(db);

  try {
    runMigrations(db);
    await store.upsert("near", new Float32Array(256).fill(0.1));
    await store.upsert("far", new Float32Array(256).fill(0.9));

    const query = new Float32Array(256).fill(0.1);
    const direct = db.prepare(`
      SELECT id, distance
      FROM vec_lcs_chunks
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT 2
    `).all(query) as Array<{ distance: number; id: string }>;
    const viaStore = await store.query(query, 2);

    assert.deepEqual(viaStore, direct);
  } finally {
    db.close();
    cleanup();
  }
});

test("SqliteVectorStore.delete removes rows from vec_lcs_chunks", async () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);
  const store = new SqliteVectorStore(db);

  try {
    runMigrations(db);
    await store.upsert("chunk-a", new Float32Array(256).fill(0.1));
    await store.delete(["chunk-a"]);

    const row = db.prepare("SELECT COUNT(*) AS count FROM vec_lcs_chunks WHERE id = ?").get("chunk-a") as {
      count: number;
    };
    assert.equal(row.count, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("QdrantVectorStore methods throw NOT_IMPLEMENTED", async () => {
  const store = new QdrantVectorStore();

  await assert.rejects(() => store.query(new Float32Array(256), 1), /NOT_IMPLEMENTED/);
});

test("createVectorStore returns the expected implementation", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    assert.ok(createVectorStore("sqlite", db) instanceof SqliteVectorStore);
    assert.ok(createVectorStore("qdrant", db) instanceof QdrantVectorStore);
  } finally {
    db.close();
    cleanup();
  }
});
