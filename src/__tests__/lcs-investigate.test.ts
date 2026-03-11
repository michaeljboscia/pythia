import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createLcsInvestigateHandler } from "../mcp/lcs-investigate.js";

function createDb() {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-investigate-"));
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

test("returns §14.13 formatted blocks", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    searchImpl: async () => ({
      results: [{
        id: "src/auth.ts::function::login",
        file_path: "src/auth.ts",
        chunk_type: "function",
        content: "export function login() {\n  return true;\n}",
        start_line: 10,
        end_line: 12,
        language: "typescript",
        score: 0.84321
      }],
      rerankerUsed: true
    })
  });

  try {
    db.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).run("seed", "src/auth.ts", "function", "seed", 0, 0, "blake3:seed");

    const result = await handler({
      query: "login function",
      intent: "semantic",
      limit: 8
    });
    const text = result.content[0].text;

    assert.match(text, /^--- CHUNK 1 score=0\.8432/m);
    assert.match(text, /^PATH: src\/auth\.ts$/m);
    assert.match(text, /^CNI: src\/auth\.ts::function::login$/m);
    assert.match(text, /^TYPE: function$/m);
    assert.match(text, /^LINES: 10-12$/m);
    assert.match(text, /```typescript[\s\S]*export function login\(\)/m);
  } finally {
    cleanup();
  }
});

test("returns [METADATA: INDEX_EMPTY] when corpus is empty", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    searchImpl: async () => ({
      results: [],
      rerankerUsed: false
    })
  });

  try {
    const result = await handler({
      query: "anything",
      intent: "semantic",
      limit: 8
    });

    assert.equal(
      result.content[0].text,
      "[METADATA: INDEX_EMPTY]\n\nNo files have been indexed yet. Run pythia_force_index to index your workspace."
    );
  } finally {
    cleanup();
  }
});

test("returns [METADATA: NO_MATCH] when query matches nothing in populated corpus", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    searchImpl: async () => ({
      results: [],
      rerankerUsed: false
    })
  });

  try {
    db.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).run("seed", "src/auth.ts", "function", "export function login() {}", 0, 0, "blake3:seed");

    const result = await handler({
      query: "nothing relevant",
      intent: "semantic",
      limit: 8
    });

    assert.equal(
      result.content[0].text,
      "[METADATA: NO_MATCH]\n\nNo chunks matched the query. Try different search terms."
    );
  } finally {
    cleanup();
  }
});

test("score values are between 0.0 and 1.0", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    searchImpl: async () => ({
      results: [{
        id: "src/auth.ts::function::login",
        file_path: "src/auth.ts",
        chunk_type: "function",
        content: "export function login() {}",
        start_line: 0,
        end_line: 0,
        language: "typescript",
        score: 0.5
      }],
      rerankerUsed: true
    })
  });

  try {
    db.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).run("seed", "src/auth.ts", "function", "seed", 0, 0, "blake3:seed");

    const result = await handler({
      query: "anything",
      intent: "semantic",
      limit: 8
    });
    const score = Number(result.content[0].text.match(/score=([0-9.]+)/)?.[1]);

    assert.ok(score >= 0);
    assert.ok(score <= 1);
  } finally {
    cleanup();
  }
});

test("blocks include PATH, CNI, TYPE, LINES and fenced content", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    searchImpl: async () => ({
      results: [{
        id: "src/auth.ts::function::login",
        file_path: "src/auth.ts",
        chunk_type: "function",
        content: "export function login() {}",
        start_line: 1,
        end_line: 1,
        language: "typescript",
        score: 0.9
      }],
      rerankerUsed: true
    })
  });

  try {
    db.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).run("seed", "src/auth.ts", "function", "seed", 0, 0, "blake3:seed");

    const result = await handler({
      query: "login",
      intent: "semantic",
      limit: 8
    });
    const text = result.content[0].text;

    assert.ok(text.includes("PATH: src/auth.ts"));
    assert.ok(text.includes("CNI: src/auth.ts::function::login"));
    assert.ok(text.includes("TYPE: function"));
    assert.ok(text.includes("LINES: 1-1"));
    assert.ok(text.includes("```typescript"));
    assert.ok(text.includes("```"));
  } finally {
    cleanup();
  }
});

test("intent='structural' returns depth-prefixed graph blocks", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    traverseGraphImpl: () => (
      "[DEPTH:1 via CALLS]\n"
      + "--- CHUNK 1 score=1.0000\n"
      + "PATH: src/server.ts\n"
      + "CNI: src/server.ts::function::handleRequest\n"
      + "TYPE: function\n"
      + "LINES: 4-8\n"
      + "```typescript\n"
      + "export function handleRequest() {\n  return login();\n}\n"
      + "```"
    )
  });

  try {
    const result = await handler({
      query: "src/auth.ts::function::login",
      intent: "structural",
      limit: 8
    });

    assert.match(result.content[0].text, /^\[DEPTH:1 via CALLS\]/m);
    assert.match(result.content[0].text, /^--- CHUNK 1 score=1\.0000/m);
  } finally {
    cleanup();
  }
});

test("intent='structural' with no graph edges returns metadata", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    traverseGraphImpl: () => "[METADATA: NO_GRAPH_EDGES]\n\nNo graph edges found for: src/auth.ts::function::login"
  });

  try {
    const result = await handler({
      query: "src/auth.ts::function::login",
      intent: "structural",
      limit: 8
    });

    assert.equal(
      result.content[0].text,
      "[METADATA: NO_GRAPH_EDGES]\n\nNo graph edges found for: src/auth.ts::function::login"
    );
  } finally {
    cleanup();
  }
});

test("intent='semantic' still uses search path", async () => {
  const { db, cleanup } = createDb();
  let searchCalls = 0;
  const handler = createLcsInvestigateHandler(db, {
    searchImpl: async () => {
      searchCalls += 1;
      return {
        results: [{
          id: "src/auth.ts::function::login",
          file_path: "src/auth.ts",
          chunk_type: "function",
          content: "export function login() {}",
          start_line: 0,
          end_line: 0,
          language: "typescript",
          score: 0.9
        }],
        rerankerUsed: true
      };
    }
  });

  try {
    db.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).run("seed", "src/auth.ts", "function", "seed", 0, 0, "blake3:seed");

    await handler({
      query: "login",
      intent: "semantic",
      limit: 8
    });

    assert.equal(searchCalls, 1);
  } finally {
    cleanup();
  }
});

test("reranker fallback metadata is appended when candidates exist but reranker is unavailable", async () => {
  const { db, cleanup } = createDb();
  const handler = createLcsInvestigateHandler(db, {
    searchImpl: async () => ({
      results: [{
        id: "src/auth.ts::function::login",
        file_path: "src/auth.ts",
        chunk_type: "function",
        content: "export function login() {}",
        start_line: 0,
        end_line: 0,
        language: "typescript",
        score: 0.9
      }],
      rerankerUsed: false
    })
  });

  try {
    db.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
    `).run("seed", "src/auth.ts", "function", "seed", 0, 0, "blake3:seed");

    const result = await handler({
      query: "login",
      intent: "semantic",
      limit: 8
    });

    assert.match(result.content[0].text, /\n\[METADATA: RERANKER_UNAVAILABLE\]$/);
  } finally {
    cleanup();
  }
});
