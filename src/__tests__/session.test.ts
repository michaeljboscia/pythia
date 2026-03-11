import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { PythiaError } from "../errors.js";
import { getSessionById, spawnOracleSession } from "../oracle/session.js";

function createDbHarness() {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-session-"));
  const dbPath = path.join(directory, "lcs.db");
  const db = openDb(dbPath);
  runMigrations(db);

  return {
    db,
    dbPath,
    cleanup: () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

test("idempotent attach returns existing session id and omits the secret", async () => {
  const { db, cleanup } = createDbHarness();

  try {
    const first = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-1",
      generateSecret: () => "0123456789abcdef0123456789abcdef",
      hashSecret: async () => "hash-1",
      now: () => "2026-03-11T00:00:00.000Z"
    });
    const second = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-2",
      generateSecret: () => "fedcba9876543210fedcba9876543210",
      hashSecret: async () => "hash-2",
      now: () => "2026-03-11T00:00:01.000Z"
    });

    assert.equal(first.created, true);
    assert.equal(first.decommission_secret, "0123456789abcdef0123456789abcdef");
    assert.equal(second.created, false);
    assert.equal(second.session_id, "session-1");
    assert.equal(second.generation_id, 1);
    assert.equal("decommission_secret" in second, false);
  } finally {
    cleanup();
  }
});

test("idle attach reconstitutes MADRs and marks the session active again", async () => {
  const { db, cleanup } = createDbHarness();
  const reconstituted: string[] = [];

  try {
    const created = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-1",
      generateSecret: () => "0123456789abcdef0123456789abcdef",
      hashSecret: async () => "hash-1",
      now: () => "2026-03-11T00:00:00.000Z"
    });

    db.prepare(`
      UPDATE pythia_sessions
      SET status = 'idle'
      WHERE id = ?
    `).run(created.session_id);

    const attached = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-2",
      generateSecret: () => "fedcba9876543210fedcba9876543210",
      hashSecret: async () => "hash-2",
      now: () => "2026-03-11T00:10:00.000Z",
      reconstituteMadrs: async (session) => {
        reconstituted.push(session.id);
      }
    });

    const row = getSessionById(attached.session_id, db);

    assert.equal(attached.created, false);
    assert.deepEqual(reconstituted, ["session-1"]);
    assert.equal(row?.status, "active");
  } finally {
    cleanup();
  }
});

test("different active session name raises SESSION_ALREADY_ACTIVE", async () => {
  const { db, cleanup } = createDbHarness();

  try {
    await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-1",
      generateSecret: () => "0123456789abcdef0123456789abcdef",
      hashSecret: async () => "hash-1",
      now: () => "2026-03-11T00:00:00.000Z"
    });

    await assert.rejects(
      spawnOracleSession("billing", db, {
        generateSessionId: () => "session-2",
        generateSecret: () => "fedcba9876543210fedcba9876543210",
        hashSecret: async () => "hash-2",
        now: () => "2026-03-11T00:00:01.000Z"
      }),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "SESSION_ALREADY_ACTIVE");
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

test("concurrent same-name spawns converge on one created row", async () => {
  const { dbPath, cleanup } = createDbHarness();
  const db1 = openDb(dbPath);
  const db2 = openDb(dbPath);
  runMigrations(db1);
  runMigrations(db2);

  try {
    const [first, second] = await Promise.all([
      spawnOracleSession("auth", db1, {
        generateSessionId: () => "session-1",
        generateSecret: () => "0123456789abcdef0123456789abcdef",
        hashSecret: async () => "hash-1",
        now: () => "2026-03-11T00:00:00.000Z"
      }),
      spawnOracleSession("auth", db2, {
        generateSessionId: () => "session-2",
        generateSecret: () => "fedcba9876543210fedcba9876543210",
        hashSecret: async () => "hash-2",
        now: () => "2026-03-11T00:00:01.000Z"
      })
    ]);
    const created = [first, second].filter((result) => result.created);
    const attached = [first, second].filter((result) => !result.created);

    assert.equal(created.length, 1);
    assert.equal(attached.length, 1);
    assert.equal(created[0]?.session_id, attached[0]?.session_id);
  } finally {
    db1.close();
    db2.close();
    cleanup();
  }
});

test("generation_id increments only on genuine new generation", async () => {
  const { db, cleanup } = createDbHarness();

  try {
    const first = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-1",
      generateSecret: () => "0123456789abcdef0123456789abcdef",
      hashSecret: async () => "hash-1",
      now: () => "2026-03-11T00:00:00.000Z"
    });
    const attached = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-2",
      generateSecret: () => "fedcba9876543210fedcba9876543210",
      hashSecret: async () => "hash-2",
      now: () => "2026-03-11T00:00:01.000Z"
    });

    db.prepare(`
      UPDATE pythia_sessions
      SET status = 'decommissioned'
      WHERE id = ?
    `).run(first.session_id);

    const secondGeneration = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-3",
      generateSecret: () => "00112233445566778899aabbccddeeff",
      hashSecret: async () => "hash-3",
      now: () => "2026-03-11T00:10:00.000Z"
    });

    assert.equal(first.generation_id, 1);
    assert.equal(attached.generation_id, 1);
    assert.equal(secondGeneration.generation_id, 2);
  } finally {
    cleanup();
  }
});
