/**
 * Smoke Tests — IT-T-016 to IT-T-025
 * Fast (<5 s total), no Gemini CLI required.
 * Validates basic wiring across all 5 sprints.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import test, { type TestContext } from "node:test";

import { openDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrate.js";
import { runGc, shouldRunGc } from "../../db/gc.js";
import { loadConfig } from "../../config.js";
import { chunkFile } from "../../indexer/chunker-treesitter.js";
import { scanWorkspace } from "../../indexer/cdc.js";
import { indexFile, setEmbedChunksForTesting } from "../../indexer/sync.js";
import { createLcsInvestigateHandler } from "../../mcp/lcs-investigate.js";
import { spawnOracleSession } from "../../oracle/session.js";
import type { WorkerToMain } from "../../indexer/worker-protocol.js";

import { insertChunk, insertDerivedRows, makeTempDb, makeTempFile, minimalConfig } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Setup ─────────────────────────────────────────────────────────────────────

// Use zero embeddings so no ONNX model is required
setEmbedChunksForTesting(() => Promise.resolve([new Float32Array(256)]));

// ── IT-T-016: Config loads from minimal valid file ────────────────────────────

test("IT-T-016: loadConfig succeeds with a minimal valid config file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pythia-cfg-"));

  try {
    const configPath = path.join(dir, "config.json");
    const cfg = minimalConfig(dir);
    writeFileSync(configPath, JSON.stringify(cfg), "utf8");

    const loaded = loadConfig(configPath);

    assert.equal(loaded.workspace_path, dir);
    assert.equal(loaded.reasoning.mode, "cli");
    assert.equal(loaded.gc.deleted_chunk_retention_days, 30);
    assert.equal(loaded.indexing.scan_on_start, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── IT-T-017: DB opens with WAL + sqlite-vec ──────────────────────────────────

test("IT-T-017: openDb enables WAL, foreign keys, and loads sqlite-vec extension", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pythia-db-"));

  try {
    const db = openDb(path.join(dir, "lcs.db"));

    try {
      const journalMode = db.pragma("journal_mode", { simple: true });
      const foreignKeys = db.pragma("foreign_keys", { simple: true });
      // sqlite-vec must be loaded — vec_version() is a proof
      const vecVersion = db.prepare("SELECT vec_version() AS v").get() as { v: string };

      assert.equal(journalMode, "wal");
      assert.equal(foreignKeys, 1);
      assert.ok(typeof vecVersion.v === "string" && vecVersion.v.length > 0, "sqlite-vec loaded");
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── IT-T-018: Migrations are idempotent ───────────────────────────────────────

test("IT-T-018: running runMigrations twice produces no error and leaves schema at latest version", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pythia-mig-"));

  try {
    const db = openDb(path.join(dir, "lcs.db"));

    try {
      runMigrations(db);
      // Second call must be a no-op (forward-only guard prevents re-applying)
      assert.doesNotThrow(() => runMigrations(db));

      const version = db.prepare(
        "SELECT MAX(version) AS v FROM schema_migrations"
      ).get() as { v: number };
      assert.ok(version.v >= 1, "schema_migrations has at least one entry");
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── IT-T-019: Tree-sitter emits CNI-format chunks on a TS file ────────────────

test("IT-T-019: chunkFile emits chunks with CNI-format ids for a TypeScript file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pythia-ts-"));

  try {
    const filePath = path.join(dir, "auth.ts");
    const content = `
export function login(user: string): boolean {
  return user.length > 0;
}

export function logout(): void {
  // no-op
}
`.trim();
    writeFileSync(filePath, content, "utf8");

    const chunks = chunkFile(filePath, content, dir);

    assert.ok(chunks.length > 0, "at least one chunk produced");
    for (const chunk of chunks) {
      // CNI format: <file_path>::<chunk_type>::<identifier>
      assert.ok(
        chunk.id.includes("::"),
        `chunk id "${chunk.id}" must use CNI format (contains "::")`
      );
      assert.ok(
        chunk.id.startsWith(filePath),
        `chunk id "${chunk.id}" must start with the file path`
      );
      assert.ok(chunk.start_line >= 0, "start_line must be non-negative");
      assert.ok(chunk.end_line >= chunk.start_line, "end_line >= start_line");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── IT-T-020: CDC reports one changed file ────────────────────────────────────

test("IT-T-020: scanWorkspace detects a new file as a FileChange with algo:digest format", async () => {
  const { cleanup, db, dir } = makeTempDb();

  try {
    // A new file with no cache row must appear as a change
    const filePath = makeTempFile(path.join(dir, "src"), "app.ts", "export const x = 1;\n");
    const changes = await scanWorkspace(dir, db);

    assert.ok(changes.length > 0, "at least one change detected");

    const change = changes.find((c) => c.filePath === filePath);
    assert.ok(change !== undefined, "app.ts must be in changes");

    // Content hash must use algo:digest format
    assert.match(change.contentHash, /^blake3:[0-9a-f]+$/, "contentHash must be blake3:<digest>");
  } finally {
    cleanup();
  }
});

// ── IT-T-021: One-file index populates all core tables ────────────────────────

test("IT-T-021: indexFile populates lcs_chunks, vec_lcs_chunks, both FTS tables, and file_scan_cache", async () => {
  const { cleanup, db, dir } = makeTempDb();

  try {
    setEmbedChunksForTesting((texts) => Promise.resolve(texts.map(() => new Float32Array(256))));

    const filePath = makeTempFile(path.join(dir, "src"), "app.ts", `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`.trim());

    await indexFile(db, filePath, `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`.trim());

    const chunkCount = db.prepare(
      "SELECT COUNT(*) AS n FROM lcs_chunks WHERE is_deleted = 0"
    ).get() as { n: number };
    const vecCount = db.prepare("SELECT COUNT(*) AS n FROM vec_lcs_chunks").get() as { n: number };
    const kwCount = db.prepare("SELECT COUNT(*) AS n FROM fts_lcs_chunks_kw").get() as { n: number };
    const subCount = db.prepare("SELECT COUNT(*) AS n FROM fts_lcs_chunks_sub").get() as { n: number };
    const cacheRow = db.prepare(
      "SELECT * FROM file_scan_cache WHERE file_path = ?"
    ).get(filePath) as { content_hash: string } | undefined;

    assert.ok(chunkCount.n > 0, "lcs_chunks populated");
    assert.equal(vecCount.n, chunkCount.n, "vec count matches chunk count");
    assert.equal(kwCount.n, chunkCount.n, "kw FTS count matches chunk count");
    assert.equal(subCount.n, chunkCount.n, "sub FTS count matches chunk count");
    assert.ok(cacheRow !== undefined, "file_scan_cache row must exist");
    assert.match(cacheRow.content_hash, /^blake3:/, "cache hash uses blake3 prefix");
  } finally {
    cleanup();
  }
});

// ── IT-T-022: lcs_investigate returns INDEX_EMPTY on empty corpus ─────────────

test("IT-T-022: lcs_investigate returns INDEX_EMPTY metadata when no live chunks exist", async () => {
  const { cleanup, db } = makeTempDb();

  try {
    const handler = createLcsInvestigateHandler(db, {
      searchImpl: () => Promise.resolve({ results: [], rerankerUsed: false })
    });
    const result = await handler({ query: "auth login", intent: "semantic", limit: 8 });
    const text = result.content[0].text;

    assert.ok(text.includes("INDEX_EMPTY"), `expected INDEX_EMPTY in response, got: "${text}"`);
  } finally {
    cleanup();
  }
});

// ── IT-T-023: Real Worker responds to PING ────────────────────────────────────

test("IT-T-023: real Worker thread responds to PING with ACK: PING", { timeout: 15_000 }, (_t: TestContext, done: (err?: unknown) => void) => {
  const dir = mkdtempSync(path.join(tmpdir(), "pythia-wk-"));
  const dbPath = path.join(dir, "lcs.db");

  // Open + migrate so worker doesn't fail on startup
  const db = openDb(dbPath);
  runMigrations(db);
  db.close();

  // The worker is compiled alongside test files into dist-test/
  // __dirname = dist-test/src/__tests__/integration/
  // worker.js = dist-test/src/indexer/worker.js
  const workerPath = path.resolve(__dirname, "../../indexer/worker.js");

  const worker = new Worker(workerPath, {
    workerData: { dbPath, workspaceRoot: dir },
    env: { ...process.env, PYTHIA_TEST_EMBED_STUB: "1" }
  });

  let pinged = false;

  worker.on("message", (msg: WorkerToMain) => {
    if (msg.type === "ACK" && msg.ack === "PING") {
      pinged = true;
      worker.postMessage({ type: "DIE" });
    }
  });

  worker.on("exit", () => {
    rmSync(dir, { recursive: true, force: true });
    assert.ok(pinged, "must have received ACK: PING before worker exited");
    done();
  });

  worker.on("error", (err) => {
    rmSync(dir, { recursive: true, force: true });
    done(err);
  });

  // Small delay to let worker initialize before sending PING
  setTimeout(() => {
    worker.postMessage({ type: "PING" });
  }, 200);
});

// ── IT-T-024: Oracle session spawns and writes transcript rows ────────────────

test("IT-T-024: spawnOracleSession creates session row and appendTranscriptTurn writes ahead of provider", async () => {
  const { cleanup, db } = makeTempDb();

  try {
    const { appendTranscriptTurn } = await import("../../oracle/session.js");

    const result = await spawnOracleSession("smoke-test", db, {
      generateSecret: () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      generateSessionId: () => "00000000-0000-0000-0000-000000000001",
      hashSecret: async (s) => `$argon2id$v=19$m=65536,t=3,p=1$fakesalt$${s}`,
      now: () => "2026-03-11T00:00:00.000Z",
      reconstituteMadrs: async () => undefined
    });

    assert.ok(result.created === true);
    assert.equal(result.session_id, "00000000-0000-0000-0000-000000000001");
    assert.equal(result.generation_id, 1);
    assert.ok(typeof result.decommission_secret === "string");

    // Write-ahead: user transcript row committed before any provider call
    const turnIndex = appendTranscriptTurn(
      result.session_id,
      "user",
      "What does the auth module do?",
      db,
      "2026-03-11T00:00:01.000Z"
    );
    assert.equal(turnIndex, 0);

    const row = db.prepare(
      "SELECT role, content FROM pythia_transcripts WHERE session_id = ? AND turn_index = 0"
    ).get(result.session_id) as { role: string; content: string } | undefined;

    assert.ok(row !== undefined, "transcript row must exist");
    assert.equal(row.role, "user");
    assert.ok(row.content.includes("auth module"));
  } finally {
    cleanup();
  }
});

// ── IT-T-025: Clean corpus does not trigger GC ────────────────────────────────

test("IT-T-025: shouldRunGc returns false and runGc deletes nothing when corpus has no tombstones", () => {
  const { cleanup, db } = makeTempDb();

  try {
    // Seed 10 live chunks — no tombstones
    insertChunk(db, "live-1");
    insertChunk(db, "live-2");
    insertDerivedRows(db, "live-1");
    insertDerivedRows(db, "live-2");

    assert.equal(shouldRunGc(db), false, "shouldRunGc must be false on clean corpus");

    const result = runGc(db, 30);
    assert.equal(result.chunksDeleted, 0, "runGc must delete zero chunks");
  } finally {
    cleanup();
  }
});
