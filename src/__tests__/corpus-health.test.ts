import assert from "node:assert/strict";
import test from "node:test";

import type Database from "better-sqlite3";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createCorpusHealthHandler } from "../mcp/corpus-health.js";

function insertChunk(db: ReturnType<typeof openDb>, id: string, filePath: string, chunkType: string, content: string): void {
  db.prepare(`
    INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
  `).run(id, filePath, chunkType, content, 1, 1, `hash:${id}`);
}

test("createCorpusHealthHandler returns stringified JSON content", async () => {
  const db = openDb(":memory:");
  runMigrations(db);
  insertChunk(db, "chunk-1", "src/app.ts", "function", "return value".repeat(20));

  try {
    const handler = createCorpusHealthHandler(db);
    const result = await handler();

    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    const parsed = JSON.parse(result.content[0].text) as { verdict: string; total_chunks: number };

    assert.equal(parsed.verdict, "HEALTHY");
    assert.equal(parsed.total_chunks, 1);
  } finally {
    db.close();
  }
});

test("createCorpusHealthHandler returns UNINITIALIZED when lcs_chunks is absent", async () => {
  const db = openDb(":memory:");

  try {
    const handler = createCorpusHealthHandler(db);
    const result = await handler();
    const parsed = JSON.parse(result.content[0].text) as { verdict: string; verdict_reason: string };

    assert.equal(parsed.verdict, "UNINITIALIZED");
    assert.equal(parsed.verdict_reason, "Run pythia init first.");
  } finally {
    db.close();
  }
});

test("createCorpusHealthHandler returns a HEALTHY round-trip payload", async () => {
  const db = openDb(":memory:");
  runMigrations(db);
  insertChunk(db, "chunk-1", "src/app.ts", "module", "module".repeat(40));
  insertChunk(db, "chunk-2", "src/auth.ts", "function", "function".repeat(40));
  insertChunk(db, "chunk-3", "tests/app.test.ts", "function", "test".repeat(40));

  try {
    const handler = createCorpusHealthHandler(db);
    const result = await handler();
    const parsed = JSON.parse(result.content[0].text) as {
      top_path_prefixes: Array<{ count: number; prefix: string }>;
      total_files: number;
      verdict: string;
    };

    assert.equal(parsed.verdict, "HEALTHY");
    assert.equal(parsed.total_files, 3);
    assert.deepEqual(parsed.top_path_prefixes[0], { prefix: "src", count: 2 });
  } finally {
    db.close();
  }
});

test("createCorpusHealthHandler propagates unexpected database errors", async () => {
  const db = {
    prepare() {
      throw new Error("database disk image is malformed");
    }
  } as unknown as Database.Database;

  const handler = createCorpusHealthHandler(db);

  await assert.rejects(
    () => handler(),
    /database disk image is malformed/u
  );
});
