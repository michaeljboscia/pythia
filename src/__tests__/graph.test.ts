import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { traverseGraph } from "../retrieval/graph.js";

function createDb() {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-graph-"));
  const db = openDb(path.join(directory, "lcs.db"));
  runMigrations(db);

  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function insertChunk(
  db: ReturnType<typeof openDb>,
  id: string,
  filePath: string,
  chunkType: string,
  content: string = `content for ${id}`
): void {
  db.prepare(`
    INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
    VALUES (?, ?, ?, ?, 0, 0, 0, NULL, ?)
  `).run(id, filePath, chunkType, content, `blake3:${id}`);
}

function insertEdge(db: ReturnType<typeof openDb>, sourceId: string, targetId: string, edgeType: string): void {
  db.prepare(`
    INSERT INTO graph_edges(source_id, target_id, edge_type)
    VALUES (?, ?, ?)
  `).run(sourceId, targetId, edgeType);
}

test("traversal reaches downstream node via CALLS chain", () => {
  const { db, cleanup } = createDb();

  try {
    insertChunk(db, "src/a.ts::function::a", "src/a.ts", "function", "export function a() {}");
    insertChunk(db, "src/b.ts::function::b", "src/b.ts", "function", "export function b() {}");
    insertChunk(db, "src/c.ts::function::c", "src/c.ts", "function", "export function c() {}");
    insertEdge(db, "src/a.ts::function::a", "src/b.ts::function::b", "CALLS");
    insertEdge(db, "src/b.ts::function::b", "src/c.ts::function::c", "CALLS");

    const result = traverseGraph("src/a.ts::function::a", db);

    assert.match(result, /\[DEPTH:1 via CALLS\][\s\S]*src\/b\.ts::function::b/);
    assert.match(result, /\[DEPTH:2 via CALLS\][\s\S]*src\/c\.ts::function::c/);
  } finally {
    cleanup();
  }
});

test("cycle detection terminates without infinite loop", () => {
  const { db, cleanup } = createDb();

  try {
    insertChunk(db, "src/a.ts::function::a", "src/a.ts", "function");
    insertChunk(db, "src/b.ts::function::b", "src/b.ts", "function");
    insertEdge(db, "src/a.ts::function::a", "src/b.ts::function::b", "CALLS");
    insertEdge(db, "src/b.ts::function::b", "src/a.ts::function::a", "CALLS");

    const result = traverseGraph("src/a.ts::function::a", db);
    const matches = result.match(/--- CHUNK/g) ?? [];

    assert.equal(matches.length, 1);
    assert.match(result, /src\/b\.ts::function::b/);
  } finally {
    cleanup();
  }
});

test("depth limit stops traversal at 6 hops", () => {
  const { db, cleanup } = createDb();

  try {
    const nodeIds = Array.from({ length: 8 }, (_, index) => `src/${index}.ts::function::n${index}`);

    for (const [index, nodeId] of nodeIds.entries()) {
      insertChunk(db, nodeId, `src/${index}.ts`, "function");
    }

    for (let index = 0; index < nodeIds.length - 1; index += 1) {
      insertEdge(db, nodeIds[index], nodeIds[index + 1], "CALLS");
    }

    const result = traverseGraph(nodeIds[0], db);

    assert.match(result, /src\/6\.ts::function::n6/);
    assert.doesNotMatch(result, /src\/7\.ts::function::n7/);
  } finally {
    cleanup();
  }
});

test("50-node cap is enforced", () => {
  const { db, cleanup } = createDb();

  try {
    insertChunk(db, "src/root.ts::function::root", "src/root.ts", "function");

    for (let index = 0; index < 60; index += 1) {
      const nodeId = `src/${index}.ts::function::n${index}`;
      insertChunk(db, nodeId, `src/${index}.ts`, "function");
      insertEdge(db, "src/root.ts::function::root", nodeId, "CALLS");
    }

    const result = traverseGraph("src/root.ts::function::root", db);
    const matches = result.match(/--- CHUNK/g) ?? [];

    assert.equal(matches.length, 50);
  } finally {
    cleanup();
  }
});

test("zero edges returns [METADATA: NO_GRAPH_EDGES]", () => {
  const { db, cleanup } = createDb();

  try {
    const result = traverseGraph("src/auth.ts::function::login", db);

    assert.equal(
      result,
      "[METADATA: NO_GRAPH_EDGES]\n\nNo graph edges found for: src/auth.ts::function::login"
    );
  } finally {
    cleanup();
  }
});
