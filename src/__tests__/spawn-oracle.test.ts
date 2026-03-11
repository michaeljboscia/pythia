import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { PythiaError } from "../errors.js";
import { createSpawnOracleHandler } from "../mcp/spawn-oracle.js";

function createDb() {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-spawn-oracle-"));
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

test("new session includes decommission_secret on create", async () => {
  const { db, cleanup } = createDb();
  const handler = createSpawnOracleHandler(db, {
    spawnOracleSessionImpl: async () => ({
      session_id: "f6b80cce-6f39-42e8-bf99-3678d9ef9d9d",
      status: "active",
      created: true,
      generation_id: 1,
      decommission_secret: "0123456789abcdef0123456789abcdef"
    })
  });

  try {
    const result = await handler({ name: "auth" });
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;

    assert.equal(payload.created, true);
    assert.equal(payload.decommission_secret, "0123456789abcdef0123456789abcdef");
  } finally {
    cleanup();
  }
});

test("attach omits decommission_secret entirely", async () => {
  const { db, cleanup } = createDb();
  const handler = createSpawnOracleHandler(db, {
    spawnOracleSessionImpl: async () => ({
      session_id: "f6b80cce-6f39-42e8-bf99-3678d9ef9d9d",
      status: "active",
      created: false,
      generation_id: 1
    })
  });

  try {
    const result = await handler({ name: "auth" });
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;

    assert.equal(payload.created, false);
    assert.equal("decommission_secret" in payload, false);
  } finally {
    cleanup();
  }
});

test("created sessions use UUID v4 session ids", async () => {
  const { db, cleanup } = createDb();
  const handler = createSpawnOracleHandler(db, {
    spawnOracleSessionImpl: async () => ({
      session_id: "f6b80cce-6f39-42e8-bf99-3678d9ef9d9d",
      status: "active",
      created: true,
      generation_id: 1,
      decommission_secret: "0123456789abcdef0123456789abcdef"
    })
  });

  try {
    const result = await handler({ name: "auth" });
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;

    assert.match(
      String(payload.session_id),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  } finally {
    cleanup();
  }
});

test("SESSION_ALREADY_ACTIVE becomes an MCP error with the exact error_code", async () => {
  const { db, cleanup } = createDb();
  const handler = createSpawnOracleHandler(db, {
    spawnOracleSessionImpl: async () => {
      throw new PythiaError("SESSION_ALREADY_ACTIVE", "session-1");
    }
  });

  try {
    await assert.rejects(
      handler({ name: "billing" }),
      (error: unknown) => {
        const candidate = error as McpError & { data?: { error_code?: string } };
        return candidate instanceof McpError
          && candidate.data?.error_code === "SESSION_ALREADY_ACTIVE";
      }
    );
  } finally {
    cleanup();
  }
});
