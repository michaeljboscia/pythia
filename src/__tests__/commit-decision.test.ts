import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createCommitDecisionHandler } from "../mcp/commit-decision.js";
import type { RetryEntry } from "../obsidian/retry.js";

function createHarness() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-commit-decision-"));
  const db = openDb(path.join(workspaceRoot, "lcs.db"));
  runMigrations(db);
  db.prepare(`
    INSERT INTO pythia_sessions(
      id, name, status, generation_id, secret_hash, session_secret, created_at, updated_at
    )
    VALUES ('session-1', 'auth', 'active', 1, 'hash', NULL, '2026-03-11T00:00:00.000Z', '2026-03-11T00:00:00.000Z')
  `).run();

  return {
    db,
    workspaceRoot,
    cleanup: () => {
      db.close();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  };
}

function seedModuleChunk(db: ReturnType<typeof createHarness>["db"], filePath: string): void {
  db.prepare(`
    INSERT INTO lcs_chunks(id, file_path, chunk_type, content, start_line, end_line, is_deleted, deleted_at, content_hash)
    VALUES (?, ?, 'module', ?, 0, 0, 0, NULL, ?)
  `).run(
    `${filePath}::module::default`,
    filePath,
    `// ${filePath}`,
    `blake3:${filePath}`
  );
}

function basePayload() {
  return {
    session_id: "session-1",
    title: "Authentication Strategy",
    problem: "Need a consistent auth decision",
    drivers: ["Consistency", "Speed"],
    options: ["JWT", "Sessions"],
    decision: "Use JWT",
    impacts_files: ["src/auth.ts"]
  };
}

test("MADR ids increment from AUTOINCREMENT-derived sequence", async () => {
  const { db, workspaceRoot, cleanup } = createHarness();
  seedModuleChunk(db, "src/auth.ts");
  const handler = createCommitDecisionHandler(db, {
    workspace_path: workspaceRoot,
    obsidian_vault_path: undefined
  }, {
    now: () => "2026-03-11T00:00:00.000Z"
  });

  try {
    const first = await handler(basePayload());
    const second = await handler({
      ...basePayload(),
      title: "Authorization Strategy"
    });

    assert.equal(first.content[0].text, "[METADATA: OBSIDIAN_DISABLED]\n\nMADR-001");
    assert.equal(second.content[0].text, "[METADATA: OBSIDIAN_DISABLED]\n\nMADR-002");
  } finally {
    cleanup();
  }
});

test("gaps in seq still advance monotonically", async () => {
  const { db, workspaceRoot, cleanup } = createHarness();
  seedModuleChunk(db, "src/auth.ts");
  const handler = createCommitDecisionHandler(db, {
    workspace_path: workspaceRoot,
    obsidian_vault_path: undefined
  });

  try {
    await handler(basePayload());
    db.prepare("DELETE FROM pythia_memories WHERE id = 'MADR-001'").run();

    const second = await handler({
      ...basePayload(),
      title: "Authorization Strategy"
    });

    assert.equal(second.content[0].text, "[METADATA: OBSIDIAN_DISABLED]\n\nMADR-002");
  } finally {
    cleanup();
  }
});

test("IMPLEMENTS edges are created for every impacted file", async () => {
  const { db, workspaceRoot, cleanup } = createHarness();
  seedModuleChunk(db, "src/auth.ts");
  seedModuleChunk(db, "src/server.ts");
  const handler = createCommitDecisionHandler(db, {
    workspace_path: workspaceRoot,
    obsidian_vault_path: undefined
  });

  try {
    await handler({
      ...basePayload(),
      impacts_files: ["src/auth.ts", "src/server.ts"]
    });

    const edges = db.prepare(`
      SELECT target_id
      FROM graph_edges
      WHERE source_id = 'MADR-001'
        AND edge_type = 'IMPLEMENTS'
      ORDER BY target_id
    `).all() as Array<{ target_id: string }>;

    assert.deepEqual(edges.map((row) => row.target_id), [
      "src/auth.ts::module::default",
      "src/server.ts::module::default"
    ]);
  } finally {
    cleanup();
  }
});

test("invalid impacts_files rolls back the MADR transaction", async () => {
  const { db, workspaceRoot, cleanup } = createHarness();
  const handler = createCommitDecisionHandler(db, {
    workspace_path: workspaceRoot,
    obsidian_vault_path: undefined
  });

  try {
    await assert.rejects(
      handler(basePayload()),
      (error: unknown) => error instanceof McpError
    );

    const row = db.prepare("SELECT COUNT(*) AS count FROM pythia_memories").get() as { count: number };

    assert.equal(row.count, 0);
  } finally {
    cleanup();
  }
});

test("Obsidian write failure preserves SQLite commit and enqueues a retry job", async () => {
  const { db, workspaceRoot, cleanup } = createHarness();
  seedModuleChunk(db, "src/auth.ts");
  const handler = createCommitDecisionHandler(db, {
    workspace_path: workspaceRoot,
    obsidian_vault_path: path.join(workspaceRoot, "vault")
  }, {
    writer: {
      write: async () => {
        throw new Error("vault offline");
      }
    }
  });

  try {
    const result = await handler(basePayload());
    const memoryCount = db.prepare("SELECT COUNT(*) AS count FROM pythia_memories").get() as { count: number };
    const queueLines = readFileSync(path.join(workspaceRoot, ".pythia", "obsidian-retry.jsonl"), "utf8")
      .trim()
      .split("\n");
    const retryEntry = JSON.parse(queueLines[0] ?? "{}") as RetryEntry;

    assert.equal(result.content[0].text, "[METADATA: OBSIDIAN_UNAVAILABLE]\n\nMADR-001");
    assert.equal(memoryCount.count, 1);
    assert.equal(retryEntry.madr.id, "MADR-001");
  } finally {
    cleanup();
  }
});

test("duplicate commit requests create two MADR rows", async () => {
  const { db, workspaceRoot, cleanup } = createHarness();
  seedModuleChunk(db, "src/auth.ts");
  const handler = createCommitDecisionHandler(db, {
    workspace_path: workspaceRoot,
    obsidian_vault_path: path.join(workspaceRoot, "vault")
  }, {
    writer: {
      write: async () => "ok"
    }
  });

  try {
    await handler(basePayload());
    await handler(basePayload());

    const row = db.prepare("SELECT COUNT(*) AS count FROM pythia_memories").get() as { count: number };

    assert.equal(row.count, 2);
  } finally {
    cleanup();
  }
});
