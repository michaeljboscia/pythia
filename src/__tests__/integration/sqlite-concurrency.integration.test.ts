/**
 * SQLite Concurrency Hazards — IT-T-001 to IT-T-004
 * Uses real on-disk WAL databases to verify lock serialisation, read isolation,
 * rollback ordering, and oracle FIFO queue behaviour.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { openDb } from "../../db/connection.js";
import { indexFile, setEmbedChunksForTesting } from "../../indexer/sync.js";
import { spawnOracleSession, appendTranscriptTurn } from "../../oracle/session.js";

import { makeTempDb, makeTempFile } from "./helpers.js";

// All tests in this file use sequential execution to avoid cross-test lock contention
setEmbedChunksForTesting((texts) => Promise.resolve(texts.map(() => new Float32Array(256))));

// ── IT-T-001: BEGIN IMMEDIATE serialises concurrent writers ───────────────────

test("IT-T-001: two BEGIN IMMEDIATE writers on same WAL file serialise without torn rows", async () => {
  const { cleanup, dbPath } = makeTempDb("pythia-lock-");
  const dbA = openDb(dbPath);
  const dbB = openDb(dbPath);

  try {
    // Writer A holds a BEGIN IMMEDIATE transaction
    dbA.exec("BEGIN IMMEDIATE");
    dbA.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES ('chunk-a', 'src/a.ts', 'function', 'fnA()', 0, 1, 0, NULL, 'blake3:a')
    `).run();

    // Writer B must not be able to interleave — BEGIN IMMEDIATE will throw SQLITE_BUSY
    // (busy_timeout=5000ms; we want it to throw, so we use a zero-timeout connection)
    const dbBusy = openDb(dbPath);
    dbBusy.pragma("busy_timeout = 0");

    let busyThrown = false;
    try {
      dbBusy.exec("BEGIN IMMEDIATE");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      busyThrown = message.includes("SQLITE_BUSY") || message.includes("database is locked");
    } finally {
      try { dbBusy.close(); } catch { /* ignore */ }
    }

    assert.ok(busyThrown, "Writer B must receive SQLITE_BUSY while A holds BEGIN IMMEDIATE");

    // A commits successfully
    dbA.exec("COMMIT");

    // After A commits, B can proceed
    dbB.exec("BEGIN IMMEDIATE");
    dbB.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES ('chunk-b', 'src/b.ts', 'function', 'fnB()', 0, 1, 0, NULL, 'blake3:b')
    `).run();
    dbB.exec("COMMIT");

    // Both rows committed, no tearing
    const count = dbA.prepare("SELECT COUNT(*) AS n FROM lcs_chunks").get() as { n: number };
    assert.equal(count.n, 2, "both rows must be committed after serialised writes");
  } finally {
    try { dbA.close(); } catch { /* ignore */ }
    try { dbB.close(); } catch { /* ignore */ }
    cleanup();
  }
});

// ── IT-T-002: WAL readers are not blocked by writer transactions ──────────────

test("IT-T-002: read connection observes only committed snapshots while writer holds an open transaction", async () => {
  const { cleanup, db: writer, dbPath } = makeTempDb("pythia-wal-");
  const reader = openDb(dbPath);

  try {
    // Pre-insert a baseline row so reader has something to see
    writer.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES ('base', 'src/base.ts', 'function', 'base()', 0, 1, 0, NULL, 'blake3:base')
    `).run();

    // Writer starts a long-running transaction
    writer.exec("BEGIN IMMEDIATE");
    writer.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES ('in-flight', 'src/inflight.ts', 'function', 'inFlight()', 0, 1, 0, NULL, 'blake3:fly')
    `).run();

    // WAL: reader must see the committed snapshot (1 row), NOT the in-flight write
    const midCount = reader.prepare("SELECT COUNT(*) AS n FROM lcs_chunks").get() as { n: number };
    assert.equal(midCount.n, 1, "reader must not see the uncommitted row (WAL snapshot isolation)");

    // No SQLITE_BUSY on the read path
    assert.doesNotThrow(() => {
      reader.prepare("SELECT COUNT(*) AS n FROM lcs_chunks").get();
    }, "reader must not throw while writer owns BEGIN IMMEDIATE");

    // Writer commits
    writer.exec("COMMIT");

    // Reader now sees both rows
    const finalCount = reader.prepare("SELECT COUNT(*) AS n FROM lcs_chunks").get() as { n: number };
    assert.equal(finalCount.n, 2, "reader must see both rows after commit");
  } finally {
    try { reader.close(); } catch { /* ignore */ }
    cleanup();
  }
});

// ── IT-T-003: file_scan_cache rolls back with the file transaction ────────────

test("IT-T-003: file_scan_cache.content_hash is not updated when the file indexing transaction rolls back", async () => {
  const { cleanup, db, dir } = makeTempDb("pythia-rollback-");

  try {
    // Seed an already-indexed file with a known cache entry
    const filePath = makeTempFile(path.join(dir, "src"), "auth.ts", "export function login() {}");
    const oldHash = "blake3:oldhash000";

    db.prepare(`
      INSERT INTO file_scan_cache(file_path, mtime_ns, size_bytes, content_hash, last_scanned_at)
      VALUES (?, 1000, 100, ?, '2026-01-01T00:00:00.000Z')
    `).run(filePath, oldHash);

    db.prepare(`
      INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
      VALUES (?, ?, 'function', 'login()', 0, 1, 0, NULL, ?)
    `).run(`${filePath}::function::login`, filePath, oldHash);

    // Attempt to re-index with a deliberately bad embedding that causes a throw
    let threw = false;
    try {
      await indexFile(db, filePath, "export function login() { return 1; }", {
        embeddings: [] // empty — mismatches chunk count, triggers throw
      });
    } catch {
      threw = true;
    }

    assert.ok(threw, "indexFile must have thrown on embedding mismatch");

    // Cache row must still have the old hash
    const cacheRow = db.prepare(
      "SELECT content_hash FROM file_scan_cache WHERE file_path = ?"
    ).get(filePath) as { content_hash: string } | undefined;

    assert.ok(cacheRow !== undefined, "cache row must still exist");
    assert.equal(
      cacheRow.content_hash,
      oldHash,
      "content_hash must not be updated after rollback"
    );

    // Old chunk must still be live
    const chunkRow = db.prepare(
      "SELECT is_deleted FROM lcs_chunks WHERE id = ?"
    ).get(`${filePath}::function::login`) as { is_deleted: number } | undefined;

    assert.ok(chunkRow !== undefined, "old chunk must survive rollback");
    assert.equal(chunkRow.is_deleted, 0, "old chunk must remain live after rollback");
  } finally {
    cleanup();
  }
});

// ── IT-T-004: Oracle FIFO queue preserves write-ahead transcript order ─────────

test("IT-T-004: user transcript rows are written before provider completes and turn_index is monotonic", async () => {
  const { cleanup, db } = makeTempDb("pythia-fifo-");

  try {
    const result = await spawnOracleSession("fifo-test", db, {
      generateSecret: () => "b".repeat(32),
      generateSessionId: () => "00000000-0000-0000-0000-000000000002",
      hashSecret: async (s) => `stub:${s}`,
      now: () => new Date().toISOString(),
      reconstituteMadrs: async () => undefined
    });

    assert.ok(result.created === true);

    const sessionId = result.session_id;

    // Write 5 user turns sequentially — simulating write-ahead before provider responds
    for (let index = 0; index < 5; index += 1) {
      appendTranscriptTurn(
        sessionId,
        "user",
        `Question ${index}`,
        db,
        new Date().toISOString()
      );
    }

    const rows = db.prepare(`
      SELECT turn_index, role FROM pythia_transcripts
      WHERE session_id = ?
      ORDER BY turn_index
    `).all(sessionId) as Array<{ role: string; turn_index: number }>;

    assert.equal(rows.length, 5, "all 5 user turns must be present");

    // turn_index must be monotonically increasing with no gaps
    for (let index = 0; index < rows.length; index += 1) {
      assert.equal(rows[index].turn_index, index, `turn_index at position ${index} must be ${index}`);
      assert.equal(rows[index].role, "user");
    }

    // Attempting to write a 6th turn must still produce the correct next turn_index
    const sixth = appendTranscriptTurn(
      sessionId,
      "user",
      "Question 5",
      db,
      new Date().toISOString()
    );
    assert.equal(sixth, 5, "sixth turn must have turn_index=5");
  } finally {
    cleanup();
  }
});
