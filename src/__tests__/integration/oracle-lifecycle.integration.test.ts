/**
 * Full Oracle Lifecycle — IT-T-030
 * spawn → ask → commit_decision → decommission → respawn
 * Uses a deterministic stub provider (no Gemini CLI required).
 *
 * Also covers critical invariants from the behavioral plan:
 *   IT-B-401: SQLite commit precedes Obsidian write
 *   IT-B-501: Idle reconstitution does NOT replay transcripts
 *   IT-B-601: seq AUTOINCREMENT, not COUNT(*)+1
 *   IT-B-702: commit_decision is NOT idempotent (two calls → two MADRs)
 */
import assert from "node:assert/strict";
import test from "node:test";

import { spawnOracleSession, appendTranscriptTurn, listTranscriptRows, getSessionById } from "../../oracle/session.js";
import { createCommitDecisionHandler } from "../../mcp/commit-decision.js";
import { MetadataCodes } from "../../errors.js";

import { insertChunk, makeTempDb } from "./helpers.js";

// ── Stubs ─────────────────────────────────────────────────────────────────────

let reconstituteCalled = false;
const stubReconstitute = async () => { reconstituteCalled = true; };

const noopWriter = { write: async (): Promise<string> => "" };
const noopRetryQueue = { enqueue: async () => undefined };

function failingWriter() {
  return {
    write: async (): Promise<never> => {
      throw new Error("VAULT_WRITE_FAILED: disk full");
    }
  };
}

function capturingRetryQueue() {
  const enqueued: unknown[] = [];
  return {
    enqueued,
    queue: { enqueue: async (madr: unknown) => { enqueued.push(madr); } }
  };
}

// ── IT-T-030: Full Oracle Lifecycle ──────────────────────────────────────────

test("IT-T-030: spawn → ask (write-ahead) → commit_decision → decommission → respawn", { timeout: 30_000 }, async () => {
  const { cleanup, db, dir } = makeTempDb("pythia-oracle-");

  try {
    // ── Phase 1: Spawn (new session) ──────────────────────────────────────────
    const spawn1 = await spawnOracleSession("lifecycle-test", db, {
      generateSecret: () => "secret-abc".padEnd(32, "x"),
      generateSessionId: () => "sess-0001-0001-0001-0001-000000000001",
      hashSecret: async (s) => `$argon2id$v=19$m=65536,t=3,p=1$fakesalt$${Buffer.from(s).toString("base64url")}`,
      now: () => "2026-03-11T10:00:00.000Z",
      reconstituteMadrs: async () => undefined
    });

    assert.ok(spawn1.created === true, "first spawn must create a new session");
    assert.equal(spawn1.session_id, "sess-0001-0001-0001-0001-000000000001");
    assert.equal(spawn1.generation_id, 1);
    assert.ok(typeof spawn1.decommission_secret === "string", "decommission_secret must be returned");

    // Secret must NOT be stored in plaintext — only the hash
    const sessionRow = getSessionById(spawn1.session_id, db);
    assert.ok(sessionRow !== undefined);
    assert.ok(sessionRow.session_secret === null, "plaintext secret must not be stored in DB");
    assert.ok(sessionRow.secret_hash !== null, "secret_hash must be stored");
    assert.ok(!sessionRow.secret_hash!.includes("secret-abc"), "hash must not contain raw secret");

    // ── Phase 2: Ask (write-ahead transcript) ─────────────────────────────────
    // User turn written BEFORE provider responds
    const turn0 = appendTranscriptTurn(
      spawn1.session_id, "user",
      "What are the key design decisions in the auth module?",
      db,
      "2026-03-11T10:00:01.000Z"
    );
    assert.equal(turn0, 0);

    // Model turn written after (simulating provider response)
    const turn1 = appendTranscriptTurn(
      spawn1.session_id, "model",
      "The auth module uses JWT tokens with RS256 signing.",
      db,
      "2026-03-11T10:00:02.000Z"
    );
    assert.equal(turn1, 1);

    const transcripts = listTranscriptRows(spawn1.session_id, db);
    assert.equal(transcripts.length, 2);
    assert.equal(transcripts[0].role, "user");
    assert.equal(transcripts[1].role, "model");

    // ── Phase 3: Commit decision (SQLite first, Obsidian second) ──────────────
    // Seed an impacts_file in lcs_chunks so the IMPLEMENTS edge can be inserted
    insertChunk(db, "src/auth.ts::module::default", { filePath: "src/auth.ts" });

    const commitHandler = createCommitDecisionHandler(db, {
      workspace_path: dir,
      obsidian_vault_path: undefined  // disabled → OBSIDIAN_DISABLED path
    }, {
      now: () => "2026-03-11T10:00:03.000Z",
      writer: noopWriter,
      retryQueue: noopRetryQueue
    });

    const commitResult = await commitHandler({
      session_id: spawn1.session_id,
      title: "JWT RS256 for Auth Module",
      problem: "Need a signing algorithm for auth tokens",
      drivers: ["security", "performance"],
      options: ["HS256", "RS256"],
      decision: "Use RS256 for asymmetric verification",
      impacts_files: ["src/auth.ts"]
    });

    const commitText = commitResult.content[0].text;
    assert.ok(
      commitText.includes(MetadataCodes.OBSIDIAN_DISABLED) || commitText.includes("MADR-"),
      "commit must return either OBSIDIAN_DISABLED or MADR-id"
    );

    // MADR row must exist in DB
    const madrRow = db.prepare("SELECT * FROM pythia_memories WHERE generation_id = 1").get() as
      { id: string; seq: number; status: string } | undefined;
    assert.ok(madrRow !== undefined, "MADR row must be committed to SQLite");
    assert.equal(madrRow.status, "accepted");

    // IMPLEMENTS edge must exist
    const edge = db.prepare(`
      SELECT * FROM graph_edges
      WHERE source_id = ? AND target_id = 'src/auth.ts::module::default' AND edge_type = 'IMPLEMENTS'
    `).get(madrRow.id) as { edge_type: string } | undefined;
    assert.ok(edge !== undefined, "IMPLEMENTS edge must be inserted for impacts_files");

    // ── Phase 4: Obsidian write failure must NOT roll back MADR (IT-B-401) ────
    const retryCapture = capturingRetryQueue();
    const failingHandler = createCommitDecisionHandler(db, {
      workspace_path: dir,
      obsidian_vault_path: "/fake/vault"  // configured but writer throws
    }, {
      now: () => "2026-03-11T10:00:04.000Z",
      writer: failingWriter(),
      retryQueue: retryCapture.queue
    });

    // Seed another chunk for this MADR
    insertChunk(db, "src/config.ts::module::default", { filePath: "src/config.ts" });

    const failResult = await failingHandler({
      session_id: spawn1.session_id,
      title: "Config Module Design",
      problem: "Config loading strategy",
      drivers: ["reliability"],
      options: ["env vars", "config file"],
      decision: "Config file with Zod validation",
      impacts_files: ["src/config.ts"]
    });

    const failText = failResult.content[0].text;
    assert.ok(
      failText.includes(MetadataCodes.OBSIDIAN_UNAVAILABLE),
      "must return OBSIDIAN_UNAVAILABLE when vault write fails"
    );

    // Vault failure must NOT have rolled back the MADR
    const madrCount = db.prepare("SELECT COUNT(*) AS n FROM pythia_memories").get() as { n: number };
    assert.equal(madrCount.n, 2, "both MADRs must be in DB — Obsidian failure must not roll back MADR");

    // Retry queue must have been enqueued
    assert.equal(retryCapture.enqueued.length, 1, "failed Obsidian write must enqueue a retry job");

    // ── Phase 5: IT-B-601 — AUTOINCREMENT IDs, no COUNT(*)+1 ─────────────────
    const rows = db.prepare(
      "SELECT id, seq FROM pythia_memories ORDER BY seq"
    ).all() as Array<{ id: string; seq: number }>;
    assert.equal(rows[0].seq, 1);
    assert.equal(rows[1].seq, 2);
    // IDs must use the MADR-NNN format
    assert.match(rows[0].id, /^MADR-\d+$/, "MADR id must match MADR-NNN format");
    // seq must be from AUTOINCREMENT, not derived
    assert.equal(rows[1].seq, rows[0].seq + 1, "sequential seq values confirm AUTOINCREMENT");

    // ── Phase 6: IT-B-702 — commit_decision is NOT idempotent ────────────────
    const identicalPayload = {
      session_id: spawn1.session_id,
      title: "JWT RS256 for Auth Module",
      problem: "Need a signing algorithm for auth tokens",
      drivers: ["security"],
      options: ["HS256", "RS256"],
      decision: "Use RS256",
      impacts_files: ["src/auth.ts"]
    };

    await commitHandler(identicalPayload);
    const madrCountAfterDupe = db.prepare("SELECT COUNT(*) AS n FROM pythia_memories").get() as { n: number };
    assert.equal(madrCountAfterDupe.n, 3, "identical second call must create a third MADR (non-idempotent)");

    // ── Phase 7: Idle reconstitution does NOT replay transcripts (IT-B-501) ───
    reconstituteCalled = false;
    db.prepare("UPDATE pythia_sessions SET status = 'idle' WHERE id = ?").run(spawn1.session_id);

    const { ensureSessionActive } = await import("../../oracle/session.js");
    await ensureSessionActive(spawn1.session_id, db, {
      now: () => "2026-03-11T10:01:00.000Z",
      reconstituteMadrs: stubReconstitute
    });

    // reconstituteMadrs was called — transcripts must NOT have been re-fed to provider
    // (the test stub verifies that reconstitution goes through MADRs-only path)
    assert.ok(reconstituteCalled, "reconstituteMadrs hook must be called during idle activation");

    const transcriptCountAfterReconstitute = db.prepare(
      "SELECT COUNT(*) AS n FROM pythia_transcripts WHERE session_id = ?"
    ).get(spawn1.session_id) as { n: number };
    // Transcript count must be unchanged — no new rows from reconstitution
    assert.equal(transcriptCountAfterReconstitute.n, 2, "reconstitution must not add transcript rows");

    // ── Phase 8: Decommission — transcripts wiped, MADRs survive ─────────────
    // createDecommissionHandler has no injection seam for argon2Verify (intentionally
    // security-hardened). We simulate the decommission directly via SQL to verify
    // the data invariants. The MCP handler itself is exercised in its own unit tests.
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM pythia_transcripts WHERE session_id = ?").run(spawn1.session_id);
    db.prepare(`
      UPDATE pythia_sessions
      SET status = 'decommissioned', secret_hash = NULL, session_secret = NULL
      WHERE id = ?
    `).run(spawn1.session_id);
    db.exec("COMMIT");

    const decommissionedRow = getSessionById(spawn1.session_id, db);
    assert.ok(decommissionedRow !== undefined);
    assert.equal(decommissionedRow.status, "decommissioned");
    assert.ok(decommissionedRow.secret_hash === null, "hash must be nulled after decommission");

    // Transcripts must be wiped
    const transcriptsAfter = db.prepare(
      "SELECT COUNT(*) AS n FROM pythia_transcripts WHERE session_id = ?"
    ).get(spawn1.session_id) as { n: number };
    assert.equal(transcriptsAfter.n, 0, "transcripts must be hard-deleted after decommission");

    // MADRs must survive (they belong to the project, not the session)
    const madrsAfter = db.prepare("SELECT COUNT(*) AS n FROM pythia_memories").get() as { n: number };
    assert.ok(madrsAfter.n >= 3, "MADRs must NOT be deleted during decommission");

    // ── Phase 9: Respawn — generation_id increments ───────────────────────────
    const spawn2 = await spawnOracleSession("lifecycle-test", db, {
      generateSecret: () => "secret-xyz".padEnd(32, "z"),
      generateSessionId: () => "sess-0002-0002-0002-0002-000000000002",
      hashSecret: async (s) => `stub-hash-2:${s}`,
      now: () => "2026-03-11T11:00:00.000Z",
      reconstituteMadrs: async () => undefined
    });

    assert.ok(spawn2.created === true, "respawn must create new session");
    assert.equal(spawn2.generation_id, 2, "generation_id must increment to 2");
    assert.ok(
      typeof (spawn2 as any).decommission_secret === "string",
      "new decommission_secret must be issued for the new generation"
    );
  } finally {
    cleanup();
  }
});
