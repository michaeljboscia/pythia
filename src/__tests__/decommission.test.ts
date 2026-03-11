import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createDecommissionHandler } from "../mcp/decommission.js";
import { hashDecommissionSecret, spawnOracleSession } from "../oracle/session.js";

function createHarness() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-decommission-"));
  const db = openDb(path.join(workspaceRoot, "lcs.db"));
  runMigrations(db);

  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  };
}

async function seedSession(
  db: ReturnType<typeof createHarness>["db"],
  secret: string
): Promise<void> {
  db.prepare(`
    INSERT INTO pythia_sessions(
      id, name, status, generation_id, secret_hash, session_secret, created_at, updated_at
    )
    VALUES (?, ?, 'active', 1, ?, NULL, '2026-03-11T00:00:00.000Z', '2026-03-11T00:00:00.000Z')
  `).run("session-1", "auth", await hashDecommissionSecret(secret));

  db.prepare(`
    INSERT INTO pythia_transcripts(session_id, turn_index, role, content, timestamp)
    VALUES ('session-1', 0, 'user', '{"text":"hello"}', '2026-03-11T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO pythia_memories(
      generation_id, timestamp, status, title, context_and_problem,
      decision_drivers, considered_options, decision_outcome, supersedes_madr
    )
    VALUES (1, '2026-03-11T00:00:00.000Z', 'accepted', 'Decision', 'Problem', '[]', '[]', 'Outcome', NULL)
  `).run();
}

test("correct secret deletes transcripts and decommissions the session", async () => {
  const { db, cleanup } = createHarness();
  const handler = createDecommissionHandler(db);

  try {
    await seedSession(db, "0123456789abcdef0123456789abcdef");

    await handler({
      session_id: "session-1",
      decommission_secret: "0123456789abcdef0123456789abcdef"
    });

    const transcriptCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM pythia_transcripts
      WHERE session_id = 'session-1'
    `).get() as { count: number };
    const sessionRow = db.prepare(`
      SELECT status, secret_hash, session_secret
      FROM pythia_sessions
      WHERE id = 'session-1'
    `).get() as { secret_hash: string | null; session_secret: string | null; status: string };

    assert.equal(transcriptCount.count, 0);
    assert.equal(sessionRow.status, "decommissioned");
    assert.equal(sessionRow.secret_hash, null);
    assert.equal(sessionRow.session_secret, null);
  } finally {
    cleanup();
  }
});

test("wrong secret raises DECOMMISSION_DENIED with zero side effects", async () => {
  const { db, cleanup } = createHarness();
  const handler = createDecommissionHandler(db);

  try {
    await seedSession(db, "0123456789abcdef0123456789abcdef");

    await assert.rejects(
      handler({
        session_id: "session-1",
        decommission_secret: "fedcba9876543210fedcba9876543210"
      }),
      (error: unknown) => {
        const candidate = error as McpError & { data?: { error_code?: string } };
        return candidate instanceof McpError
          && candidate.data?.error_code === "DECOMMISSION_DENIED";
      }
    );

    const transcriptCount = db.prepare("SELECT COUNT(*) AS count FROM pythia_transcripts WHERE session_id = 'session-1'").get() as { count: number };
    const sessionRow = db.prepare("SELECT status FROM pythia_sessions WHERE id = 'session-1'").get() as { status: string };

    assert.equal(transcriptCount.count, 1);
    assert.equal(sessionRow.status, "active");
  } finally {
    cleanup();
  }
});

test("pythia_memories survive decommission", async () => {
  const { db, cleanup } = createHarness();
  const handler = createDecommissionHandler(db);

  try {
    await seedSession(db, "0123456789abcdef0123456789abcdef");

    await handler({
      session_id: "session-1",
      decommission_secret: "0123456789abcdef0123456789abcdef"
    });

    const memoryCount = db.prepare("SELECT COUNT(*) AS count FROM pythia_memories").get() as { count: number };

    assert.equal(memoryCount.count, 1);
  } finally {
    cleanup();
  }
});

test("reusing the same session name after decommission yields generation_id=2", async () => {
  const { db, cleanup } = createHarness();
  const handler = createDecommissionHandler(db);

  try {
    await seedSession(db, "0123456789abcdef0123456789abcdef");

    await handler({
      session_id: "session-1",
      decommission_secret: "0123456789abcdef0123456789abcdef"
    });

    const next = await spawnOracleSession("auth", db, {
      generateSessionId: () => "session-2",
      generateSecret: () => "fedcba9876543210fedcba9876543210",
      hashSecret: async () => "hash-2",
      now: () => "2026-03-11T00:10:00.000Z"
    });

    assert.equal(next.created, true);
    assert.equal(next.generation_id, 2);
  } finally {
    cleanup();
  }
});
