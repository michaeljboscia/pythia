/**
 * Performance Floor Tests — IT-T-026 to IT-T-029
 *
 * IT-T-026: warm embedQuery < 500ms (PYTHIA_SKIP_PERF=1 to skip in CI)
 * IT-T-027: keyword FTS query < 10ms on 5k+ chunks
 * IT-T-028: reranker 12-candidate window < 250ms (PYTHIA_SKIP_PERF=1 to skip)
 * IT-T-029: GC over 10k tombstones < 1s (uses realistic content lengths)
 *
 * Set PYTHIA_SKIP_PERF=1 to skip model-dependent tests in CI environments
 * that lack the ONNX weights.
 * Set PYTHIA_TEST_RERANKER_PERF_FLOOR_MS=<N> to override the 250ms threshold.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { openDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrate.js";
import { runGc, shouldRunGc } from "../../db/gc.js";

import { makeTempDb, seedTombstones } from "../integration/helpers.js";

const SKIP_PERF = process.env.PYTHIA_SKIP_PERF === "1";
const RERANKER_FLOOR_MS = Number(process.env.PYTHIA_TEST_RERANKER_PERF_FLOOR_MS ?? 250);

// ── IT-T-026: Warm embedQuery < 500ms ────────────────────────────────────────

test("IT-T-026: warm embedQuery completes in under 500ms", { skip: SKIP_PERF }, async () => {
  const { embedQuery, warmEmbedder } = await import("../../indexer/embedder.js");

  // Warm the model — first call loads ONNX weights
  await warmEmbedder();

  const t0 = performance.now();
  await embedQuery("search_query: authentication middleware token validation");
  const elapsed = performance.now() - t0;

  assert.ok(
    elapsed < 500,
    `embedQuery took ${elapsed.toFixed(1)}ms — must be under 500ms after warm-up`
  );
});

// ── IT-T-027: Keyword FTS query < 10ms on 5k+ chunks ─────────────────────────

test("IT-T-027: keyword FTS query over 5,000 live chunks completes in under 10ms", () => {
  const { cleanup, db } = makeTempDb("pythia-fts-perf-");

  try {
    // Seed 5,000 chunks into the FTS table
    const insert = db.prepare(
      "INSERT INTO fts_lcs_chunks_kw(id, content) VALUES (?, ?)"
    );
    db.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < 5_000; index += 1) {
      insert.run(
        `src/module_${index}.ts::function::handler_${index}`,
        `export function handler_${index}(req: Request): Response { return processRequest_${index}(req); }`
      );
    }
    db.exec("COMMIT");

    // Warm the FTS index (first query may load the btree into cache).
    // Note: tokenchars '._:/#<>?!-' means underscores are part of tokens —
    // search for a standalone word like "return" that appears in every row.
    db.prepare("SELECT id FROM fts_lcs_chunks_kw WHERE fts_lcs_chunks_kw MATCH ? LIMIT 1").get("return");

    // Measure
    const t0 = performance.now();
    const rows = db.prepare(
      "SELECT id FROM fts_lcs_chunks_kw WHERE fts_lcs_chunks_kw MATCH ? ORDER BY rank LIMIT 30"
    ).all("return");
    const elapsed = performance.now() - t0;

    assert.ok(rows.length > 0, "FTS query must return results");
    assert.ok(
      elapsed < 10,
      `FTS query took ${elapsed.toFixed(2)}ms — must be under 10ms`
    );
  } finally {
    cleanup();
  }
});

// ── IT-T-028: Reranker 12-candidate window < RERANKER_FLOOR_MS ───────────────

test(
  `IT-T-028: reranker over 12 candidates completes in under ${RERANKER_FLOOR_MS}ms`,
  { skip: SKIP_PERF },
  async () => {
    const { rerank, initReranker } = await import("../../retrieval/reranker.js");

    // Warm the reranker model
    const cacheDir = path.join(mkdtempSync(path.join(tmpdir(), "pythia-rnk-cache-")));
    try {
      await initReranker(cacheDir);

      const candidates = Array.from({ length: 12 }, (_, index) => ({
        id: `chunk-${index}`,
        file_path: `src/module_${index}.ts`,
        chunk_type: "function" as const,
        content: `export function handler_${index}(token: string): boolean { return validateJWT_${index}(token); }`,
        start_line: index * 10,
        end_line: index * 10 + 5,
        language: "typescript",
        score: 0.5
      }));

      const t0 = performance.now();
      const result = await rerank("authentication token validation middleware", candidates);
      const elapsed = performance.now() - t0;

      assert.equal(result.chunks.length, 12, "reranker must return all 12 candidates");
      assert.ok(
        elapsed < RERANKER_FLOOR_MS,
        `Reranker took ${elapsed.toFixed(1)}ms — must be under ${RERANKER_FLOOR_MS}ms. ` +
        `Set PYTHIA_TEST_RERANKER_PERF_FLOOR_MS to override threshold in CI.`
      );
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }
);

// ── IT-T-029: GC over 10k tombstones < 1,000ms ───────────────────────────────

test("IT-T-029: GC over 10,000 tombstoned chunks with realistic content completes in under 1,000ms", { timeout: 30_000 }, () => {
  const { cleanup, db } = makeTempDb("pythia-gc-perf-");

  try {
    // Seed 10,001 tombstones with realistic content lengths (~400–600 chars)
    // to approximate production page utilisation
    seedTombstones(db, 10_001, 31);

    assert.ok(shouldRunGc(db), "shouldRunGc must trigger on 10k+ tombstones");

    const t0 = performance.now();
    const result = runGc(db, 30);
    const elapsed = performance.now() - t0;

    assert.ok(result.chunksDeleted >= 10_001, `must delete at least 10,001 chunks (got ${result.chunksDeleted})`);
    assert.ok(
      elapsed < 1_000,
      `GC took ${elapsed.toFixed(0)}ms — must be under 1,000ms for 10k tombstones`
    );
  } finally {
    cleanup();
  }
});
