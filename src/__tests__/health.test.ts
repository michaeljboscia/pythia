import assert from "node:assert/strict";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { computeCorpusHealth } from "../indexer/health.js";

type ChunkFixture = {
  chunkType: string;
  content: string;
  filePath: string;
  id: string;
  isDeleted?: number;
};

function createDb(runSchema: boolean): ReturnType<typeof openDb> {
  const db = openDb(":memory:");

  if (runSchema) {
    runMigrations(db);
  }

  return db;
}

function insertChunk(db: ReturnType<typeof openDb>, chunk: ChunkFixture): void {
  db.prepare(`
    INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    chunk.id,
    chunk.filePath,
    chunk.chunkType,
    chunk.content,
    1,
    1,
    chunk.isDeleted ?? 0,
    `hash:${chunk.id}`
  );
}

function repeated(char: string, length: number): string {
  return char.repeat(length);
}

test("computeCorpusHealth returns UNINITIALIZED when lcs_chunks is missing", () => {
  const db = createDb(false);

  try {
    assert.deepEqual(computeCorpusHealth(db), {
      verdict: "UNINITIALIZED",
      verdict_reason: "Run pythia init first.",
      total_chunks: 0,
      total_files: 0,
      chunk_type_distribution: [],
      short_chunk_count: 0,
      avg_chunk_length_chars: null,
      top_path_prefixes: []
    });
  } finally {
    db.close();
  }
});

test("computeCorpusHealth returns WARN when the corpus is empty", () => {
  const db = createDb(true);

  try {
    const report = computeCorpusHealth(db);

    assert.equal(report.verdict, "WARN");
    assert.equal(report.verdict_reason, "No files were indexed. Check your .pythiaignore and workspace path.");
    assert.equal(report.total_chunks, 0);
    assert.equal(report.total_files, 0);
    assert.equal(report.avg_chunk_length_chars, null);
    assert.deepEqual(report.top_path_prefixes, []);
  } finally {
    db.close();
  }
});

test("computeCorpusHealth returns WARN when module chunks are exactly 60 percent", () => {
  const db = createDb(true);

  try {
    insertChunk(db, { id: "c1", filePath: "src/app.ts", chunkType: "module", content: repeated("a", 150) });
    insertChunk(db, { id: "c2", filePath: "src/router.ts", chunkType: "module", content: repeated("b", 150) });
    insertChunk(db, { id: "c3", filePath: "src/store.ts", chunkType: "module", content: repeated("c", 150) });
    insertChunk(db, { id: "c4", filePath: "src/auth.ts", chunkType: "function", content: repeated("d", 150) });
    insertChunk(db, { id: "c5", filePath: "src/user.ts", chunkType: "function", content: repeated("e", 150) });

    const report = computeCorpusHealth(db);

    assert.equal(report.verdict, "WARN");
    assert.equal(report.verdict_reason, "Corpus quality is marginal. Consider reviewing .pythiaignore.");
    assert.equal(report.total_chunks, 5);
    assert.equal(report.chunk_type_distribution.find((row) => row.chunk_type === "module")?.count, 3);
  } finally {
    db.close();
  }
});

test("computeCorpusHealth returns WARN when short chunks are between 15 and 30 percent", () => {
  const db = createDb(true);

  try {
    insertChunk(db, { id: "c1", filePath: "src/app.ts", chunkType: "function", content: repeated("a", 80) });
    insertChunk(db, { id: "c2", filePath: "src/router.ts", chunkType: "function", content: repeated("b", 150) });
    insertChunk(db, { id: "c3", filePath: "src/store.ts", chunkType: "function", content: repeated("c", 150) });
    insertChunk(db, { id: "c4", filePath: "src/auth.ts", chunkType: "function", content: repeated("d", 150) });
    insertChunk(db, { id: "c5", filePath: "src/user.ts", chunkType: "function", content: repeated("e", 150) });

    const report = computeCorpusHealth(db);

    assert.equal(report.verdict, "WARN");
    assert.equal(report.short_chunk_count, 1);
    assert.equal(report.verdict_reason, "Corpus quality is marginal. Consider reviewing .pythiaignore.");
  } finally {
    db.close();
  }
});

test("computeCorpusHealth returns DEGRADED when module chunks exceed 60 percent", () => {
  const db = createDb(true);

  try {
    insertChunk(db, { id: "c1", filePath: "src/app.ts", chunkType: "module", content: repeated("a", 150) });
    insertChunk(db, { id: "c2", filePath: "src/router.ts", chunkType: "module", content: repeated("b", 150) });
    insertChunk(db, { id: "c3", filePath: "src/auth.ts", chunkType: "function", content: repeated("c", 150) });

    const report = computeCorpusHealth(db);

    assert.equal(report.verdict, "DEGRADED");
    assert.equal(report.verdict_reason, "Corpus contains noise or low-quality chunks. Review .pythiaignore and re-run pythia init.");
  } finally {
    db.close();
  }
});

test("computeCorpusHealth returns DEGRADED when short chunks exceed 30 percent", () => {
  const db = createDb(true);

  try {
    insertChunk(db, { id: "c1", filePath: "src/app.ts", chunkType: "function", content: repeated("a", 80) });
    insertChunk(db, { id: "c2", filePath: "src/router.ts", chunkType: "function", content: repeated("b", 80) });
    insertChunk(db, { id: "c3", filePath: "src/store.ts", chunkType: "function", content: repeated("c", 150) });
    insertChunk(db, { id: "c4", filePath: "src/auth.ts", chunkType: "function", content: repeated("d", 150) });

    const report = computeCorpusHealth(db);

    assert.equal(report.verdict, "DEGRADED");
    assert.equal(report.short_chunk_count, 2);
    assert.equal(report.verdict_reason, "Corpus contains noise or low-quality chunks. Review .pythiaignore and re-run pythia init.");
  } finally {
    db.close();
  }
});

test("computeCorpusHealth returns DEGRADED when suspicious prefixes are present", () => {
  const db = createDb(true);

  try {
    insertChunk(db, { id: "c1", filePath: "node_modules/react/index.js", chunkType: "function", content: repeated("a", 150) });
    insertChunk(db, { id: "c2", filePath: "src/app.ts", chunkType: "function", content: repeated("b", 150) });

    const report = computeCorpusHealth(db);

    assert.equal(report.verdict, "DEGRADED");
    assert.equal(report.top_path_prefixes[0]?.prefix, "node_modules");
  } finally {
    db.close();
  }
});

test("computeCorpusHealth returns HEALTHY for a non-empty corpus without noise signals", () => {
  const db = createDb(true);

  try {
    insertChunk(db, { id: "c1", filePath: "src/app.ts", chunkType: "module", content: repeated("a", 200) });
    insertChunk(db, { id: "c2", filePath: "src/router.ts", chunkType: "function", content: repeated("b", 220) });
    insertChunk(db, { id: "c3", filePath: "tests/app.test.ts", chunkType: "function", content: repeated("c", 240) });
    insertChunk(db, { id: "c4", filePath: "docs/readme.md", chunkType: "doc", content: repeated("d", 260) });
    insertChunk(db, { id: "c5", filePath: "src/store.ts", chunkType: "function", content: repeated("e", 280) });

    const report = computeCorpusHealth(db);

    assert.equal(report.verdict, "HEALTHY");
    assert.equal(report.verdict_reason, "Corpus looks good.");
    assert.equal(report.total_chunks, 5);
    assert.equal(report.total_files, 5);
    assert.equal(report.avg_chunk_length_chars, 240);
    assert.deepEqual(report.top_path_prefixes[0], { prefix: "src", count: 3 });
  } finally {
    db.close();
  }
});
