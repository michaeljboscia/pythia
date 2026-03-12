import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import {
  chooseFtsRoute,
  fuseSearchResults,
  normalizeKeywordFtsQuery,
  normalizeSubstringFtsQuery,
  search,
  type SearchResult
} from "../retrieval/hybrid.js";
import {
  __resetRerankerForTests,
  __setRerankerTestHooks,
  rerank
} from "../retrieval/reranker.js";

function createDb() {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-hybrid-"));
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

function chunk(id: string, score: number = 0): SearchResult {
  return {
    id,
    file_path: "src/auth.ts",
    chunk_type: "function",
    content: `export function ${id.split("::").at(-1)}() {}`,
    start_line: 0,
    end_line: 0,
    language: "typescript",
    score
  };
}

function seedChunkTables(
  db: ReturnType<typeof createDb>["db"],
  chunks: Array<{ id: string; content: string; filePath?: string }>
): void {
  const insertChunk = db.prepare(`
    INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
    VALUES (?, ?, 'function', ?, 0, 0, 0, NULL, ?)
  `);
  const insertVec = db.prepare(`
    INSERT INTO vec_lcs_chunks(id, embedding)
    VALUES (?, ?)
  `);
  const insertKw = db.prepare(`
    INSERT INTO fts_lcs_chunks_kw(id, content)
    VALUES (?, ?)
  `);
  const insertSub = db.prepare(`
    INSERT INTO fts_lcs_chunks_sub(id, content)
    VALUES (?, ?)
  `);

  chunks.forEach((entry, index) => {
    insertChunk.run(
      entry.id,
      entry.filePath ?? "src/auth.ts",
      entry.content,
      `blake3:chunk-${index}`
    );
    insertVec.run(entry.id, new Float32Array(256));
    insertKw.run(entry.id, entry.content);
    insertSub.run(entry.id, entry.content);
  });
}

test("RRF ranks chunks present in both lists above chunks in only one list", () => {
  const fused = fuseSearchResults(
    [
      chunk("src/auth.ts::function::shared"),
      chunk("src/auth.ts::function::vecOnly")
    ],
    [
      chunk("src/auth.ts::function::shared"),
      chunk("src/auth.ts::function::ftsOnly")
    ],
    "semantic"
  );

  assert.equal(fused[0]?.id, "src/auth.ts::function::shared");
  assert.ok(fused.find((entry) => entry.id === "src/auth.ts::function::vecOnly"));
  assert.ok(fused.find((entry) => entry.id === "src/auth.ts::function::ftsOnly"));
});

test("semantic intent applies vector-heavy weights", () => {
  const semantic = fuseSearchResults(
    [chunk("src/auth.ts::function::onlyVector")],
    [chunk("src/auth.ts::function::onlyFts")],
    "semantic"
  );

  assert.equal(semantic[0]?.id, "src/auth.ts::function::onlyVector");
  assert.equal(semantic[0]?.score, 0.7 / 61);
});

test("structural intent applies FTS-heavy weights", () => {
  const structural = fuseSearchResults(
    [chunk("src/auth.ts::function::onlyVector")],
    [chunk("src/auth.ts::function::onlyFts")],
    "structural"
  );

  assert.equal(structural[0]?.id, "src/auth.ts::function::onlyFts");
  assert.equal(structural[0]?.score, 0.7 / 61);
});

test("FTS routing falls back to trigram when keyword hits are zero and query looks structural", () => {
  assert.equal(chooseFtsRoute("src/auth.ts::function::login", 0), "sub");
});

test("FTS routing stays on keyword FTS when keyword hits exist even if query looks structural", () => {
  assert.equal(chooseFtsRoute("src/auth.ts::function::login", 1), "kw");
});

test("keyword FTS query normalization strips parser-breaking punctuation", () => {
  assert.equal(
    normalizeKeywordFtsQuery("A `CancelToken` is an object that can be used to request cancellation."),
    "\"A\" \"CancelToken\" \"is\" \"an\" \"object\" \"that\" \"can\" \"be\" \"used\" \"to\" \"request\" \"cancellation.\""
  );
});

test("substring FTS query normalization quotes the full structural query safely", () => {
  assert.equal(
    normalizeSubstringFtsQuery("\"src/auth.ts::function::login\""),
    "\"src/auth.ts::function::login\""
  );
});

test("cross-encoder timeout leaves RRF order unchanged and marks reranker unavailable", async () => {
  const { db, cleanup } = createDb();

  seedChunkTables(db, [{
    id: "src/auth.ts::function::login",
    content: "src/auth.ts::function::login"
  }]);

  __setRerankerTestHooks({
    forceReady: true,
    tokenizer: () => ({}),
    model: async () => new Promise(() => undefined)
  });

  try {
    const result = await search(
      "login",
      "semantic",
      db,
      8,
      {
        embedQueryImpl: async () => new Float32Array(256)
      }
    );

    assert.equal(result.rerankerUsed, false);
    assert.equal(result.results[0]?.id, "src/auth.ts::function::login");
  } finally {
    __resetRerankerForTests();
    cleanup();
  }
});

test("search tolerates natural-language queries containing backticks", async () => {
  const { db, cleanup } = createDb();

  seedChunkTables(db, [{
    id: "src/auth.ts::function::cancelToken",
    content: "CancelToken object used to request cancellation of an operation"
  }]);

  try {
    const result = await search(
      "A `CancelToken` is an object that can be used to request cancellation of an operation.",
      "semantic",
      db,
      8,
      {
        embedQueryImpl: async () => new Float32Array(256),
        rerankImpl: async (_query, candidates) => ({
          chunks: candidates,
          rerankerUsed: false
        })
      }
    );

    assert.equal(result.results[0]?.id, "src/auth.ts::function::cancelToken");
  } finally {
    cleanup();
  }
});

test("cross-encoder reranker scores stay in the 0.0 to 1.0 range", async () => {
  __setRerankerTestHooks({
    forceReady: true,
    tokenizer: () => ({}),
    model: async () => ({
      logits: {
        data: new Float32Array([0, 2])
      }
    })
  });

  try {
    const result = await rerank("login", [
      chunk("src/auth.ts::function::login"),
      chunk("src/auth.ts::function::logout")
    ]);

    assert.equal(result.rerankerUsed, true);
    assert.ok(result.chunks.every((entry) => entry.score > 0 && entry.score < 1));
  } finally {
    __resetRerankerForTests();
  }
});
