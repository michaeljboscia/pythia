import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { traverseGraph } from "../retrieval/graph.js";
import {
  createGraphStore,
  FalkorDbGraphStore,
  SqliteGraphStore
} from "../retrieval/graph-store.js";

function createTempDb(): { cleanup: () => void; dbPath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-graph-store-"));

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath: path.join(directory, "lcs.db")
  };
}

function insertChunk(db: ReturnType<typeof openDb>, id: string, filePath = "src/auth.ts"): void {
  db.prepare(`
    INSERT INTO lcs_chunks(
      id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash
    ) VALUES (?, ?, 'function', 'export function x() {}', 0, 1, 0, NULL, 'blake3:test')
  `).run(id, filePath);
}

test("SqliteGraphStore.insertEdge inserts a row into graph_edges", async () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);
  const store = new SqliteGraphStore(db);

  try {
    runMigrations(db);
    insertChunk(db, "src/auth.ts::function::login");
    insertChunk(db, "src/server.ts::function::handle", "src/server.ts");

    await store.insertEdge("src/auth.ts::function::login", "src/server.ts::function::handle", "CALLS");

    const row = db.prepare(`
      SELECT edge_type
      FROM graph_edges
      WHERE source_id = ? AND target_id = ?
    `).get("src/auth.ts::function::login", "src/server.ts::function::handle") as { edge_type: string };

    assert.equal(row.edge_type, "CALLS");
  } finally {
    db.close();
    cleanup();
  }
});

test("SqliteGraphStore.traverse matches traverseGraph directly", async () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);
  const store = new SqliteGraphStore(db);

  try {
    runMigrations(db);
    insertChunk(db, "src/auth.ts::function::login");
    insertChunk(db, "src/server.ts::function::handle", "src/server.ts");
    await store.insertEdge("src/auth.ts::function::login", "src/server.ts::function::handle", "CALLS");

    const viaStore = await store.traverse("src/auth.ts::function::login", 6, 50);
    const direct = traverseGraph("src/auth.ts::function::login", db, 6, 50);

    assert.equal(viaStore, direct);
  } finally {
    db.close();
    cleanup();
  }
});

test("SqliteGraphStore.deleteEdgesForChunk removes all edges for the chunk", async () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);
  const store = new SqliteGraphStore(db);

  try {
    runMigrations(db);
    insertChunk(db, "src/auth.ts::function::login");
    insertChunk(db, "src/server.ts::function::handle", "src/server.ts");
    await store.insertEdge("src/auth.ts::function::login", "src/server.ts::function::handle", "CALLS");
    await store.deleteEdgesForChunk("src/auth.ts::function::login");

    const row = db.prepare("SELECT COUNT(*) AS count FROM graph_edges").get() as { count: number };
    assert.equal(row.count, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("FalkorDbGraphStore methods throw NOT_IMPLEMENTED", async () => {
  const store = new FalkorDbGraphStore();

  await assert.rejects(() => store.traverse("start", 6, 50), /NOT_IMPLEMENTED/);
});

test("createGraphStore returns the expected implementation", () => {
  const { cleanup, dbPath } = createTempDb();
  const db = openDb(dbPath);

  try {
    runMigrations(db);
    assert.ok(createGraphStore("sqlite", db) instanceof SqliteGraphStore);
    assert.ok(createGraphStore("falkordb", db) instanceof FalkorDbGraphStore);
  } finally {
    db.close();
    cleanup();
  }
});
