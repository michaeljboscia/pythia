import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { PythiaError } from "../errors.js";
import { __resetAskOracleQueuesForTests, createAskOracleHandler } from "../mcp/ask-oracle.js";
import type { ReasoningProvider } from "../oracle/provider.js";
import { SessionReaper } from "../oracle/reaper.js";

function createDb() {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-ask-oracle-"));
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

function insertSession(
  db: ReturnType<typeof createDb>["db"],
  options: {
    id?: string;
    name?: string;
    status?: "active" | "idle";
  } = {}
): string {
  const id = options.id ?? "session-1";

  db.prepare(`
    INSERT INTO pythia_sessions(
      id, name, status, generation_id, secret_hash, session_secret, created_at, updated_at
    )
    VALUES (?, ?, ?, 1, 'hash', NULL, '2026-03-11T00:00:00.000Z', '2026-03-11T00:00:00.000Z')
  `).run(id, options.name ?? "auth", options.status ?? "active");

  return id;
}

function createConfig(limit: number) {
  return {
    limits: {
      ask_context_chars_max: limit,
      spawn_chars_max: 16000,
      session_idle_ttl_minutes: 30
    }
  };
}

async function waitForRelease(releases: Array<() => void>): Promise<() => void> {
  while (releases.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return releases.shift() as () => void;
}

test("write-ahead user turn persists even when provider throws", async () => {
  const { db, cleanup } = createDb();
  const sessionId = insertSession(db);
  const reaper = new SessionReaper(db, 30, {
    dismissImpl: async () => undefined
  });
  const provider: ReasoningProvider = {
    query: async () => {
      throw new PythiaError("PROVIDER_UNAVAILABLE", "upstream");
    },
    healthCheck: async () => true,
    describe: () => ({ provider: "test", model: "test-model" })
  };
  const handler = createAskOracleHandler(db, createConfig(1000), provider, reaper, {
    searchImpl: async () => ({
      results: [],
      rerankerUsed: true
    })
  });

  try {
    await assert.rejects(handler({
      session_id: sessionId,
      prompt: "What changed?"
    }));

    const rows = db.prepare(`
      SELECT role, content
      FROM pythia_transcripts
      WHERE session_id = ?
      ORDER BY turn_index
    `).all(sessionId) as Array<{ content: string; role: string }>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.role, "user");
    assert.match(rows[0]?.content ?? "", /What changed\?/);
  } finally {
    reaper.close();
    __resetAskOracleQueuesForTests();
    cleanup();
  }
});

test("queue depth 5 rejects the 6th concurrent call with SESSION_BUSY", async () => {
  const { db, cleanup } = createDb();
  const sessionId = insertSession(db);
  const reaper = new SessionReaper(db, 30, {
    dismissImpl: async () => undefined
  });
  const releases: Array<() => void> = [];
  const provider: ReasoningProvider = {
    query: async () => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      return "ok";
    },
    healthCheck: async () => true,
    describe: () => ({ provider: "test", model: "test-model" })
  };
  const handler = createAskOracleHandler(db, createConfig(1000), provider, reaper, {
    searchImpl: async () => ({
      results: [],
      rerankerUsed: true
    })
  });

  try {
    const inflight = Array.from({ length: 5 }, (_, index) => handler({
      session_id: sessionId,
      prompt: `prompt-${index}`
    }));

    await assert.rejects(
      handler({ session_id: sessionId, prompt: "overflow" }),
      (error: unknown) => {
        const candidate = error as McpError & { data?: { error_code?: string } };
        return candidate instanceof McpError
          && candidate.data?.error_code === "SESSION_BUSY";
      }
    );

    for (let index = 0; index < 5; index += 1) {
      const release = await waitForRelease(releases);
      release();
    }

    await Promise.all(inflight);
  } finally {
    reaper.close();
    __resetAskOracleQueuesForTests();
    cleanup();
  }
});

test("idle session is auto-reconstituted before provider call", async () => {
  const { db, cleanup } = createDb();
  const sessionId = insertSession(db, { status: "idle" });
  const reaper = new SessionReaper(db, 30, {
    dismissImpl: async () => undefined
  });
  let reconstituted = false;
  const provider: ReasoningProvider = {
    query: async () => "answer",
    healthCheck: async () => true,
    describe: () => ({ provider: "test", model: "test-model" })
  };
  const handler = createAskOracleHandler(db, createConfig(1000), provider, reaper, {
    ensureSessionActiveImpl: async () => {
      reconstituted = true;
      db.prepare(`
        UPDATE pythia_sessions
        SET status = 'active'
        WHERE id = ?
      `).run(sessionId);

      return db.prepare(`
        SELECT id, name, status, generation_id, secret_hash, session_secret, created_at, updated_at
        FROM pythia_sessions
        WHERE id = ?
      `).get(sessionId) as {
        created_at: string;
        generation_id: number;
        id: string;
        name: string;
        secret_hash: string | null;
        session_secret: string | null;
        status: "active";
        updated_at: string;
      };
    },
    searchImpl: async () => ({
      results: [],
      rerankerUsed: true
    })
  });

  try {
    const result = await handler({
      session_id: sessionId,
      prompt: "Explain the architecture"
    });

    assert.equal(result.content[0].text, "answer");
    assert.equal(reconstituted, true);
    const row = db.prepare("SELECT status FROM pythia_sessions WHERE id = ?").get(sessionId) as { status: string } | undefined;

    assert.equal(row?.status, "active");
  } finally {
    reaper.close();
    __resetAskOracleQueuesForTests();
    cleanup();
  }
});

test("model transcript row records provider.describe metadata", async () => {
  const { db, cleanup } = createDb();
  const sessionId = insertSession(db);
  const reaper = new SessionReaper(db, 30, {
    dismissImpl: async () => undefined
  });
  const provider: ReasoningProvider = {
    query: async () => "answer",
    healthCheck: async () => true,
    describe: () => ({ provider: "local", model: "llama3.2" })
  };
  const handler = createAskOracleHandler(db, createConfig(1000), provider, reaper, {
    searchImpl: async () => ({
      results: [],
      rerankerUsed: true
    })
  });

  try {
    await handler({
      session_id: sessionId,
      prompt: "What model answered?"
    });

    const row = db.prepare(`
      SELECT content
      FROM pythia_transcripts
      WHERE session_id = ?
        AND role = 'model'
      ORDER BY turn_index DESC
      LIMIT 1
    `).get(sessionId) as { content: string } | undefined;
    const parsed = JSON.parse(row?.content ?? "{}") as {
      finish_reason?: string;
      model?: string;
      provider?: string;
      text?: string;
    };

    assert.equal(parsed.text, "answer");
    assert.equal(parsed.provider, "local");
    assert.equal(parsed.model, "llama3.2");
    assert.equal(parsed.finish_reason, "stop");
  } finally {
    reaper.close();
    __resetAskOracleQueuesForTests();
    cleanup();
  }
});

test("context budget overrun throws CONTEXT_BUDGET_EXCEEDED", async () => {
  const { db, cleanup } = createDb();
  const sessionId = insertSession(db);
  const reaper = new SessionReaper(db, 30, {
    dismissImpl: async () => undefined
  });
  const provider: ReasoningProvider = {
    query: async () => "should not run",
    healthCheck: async () => true,
    describe: () => ({ provider: "test", model: "test-model" })
  };
  const handler = createAskOracleHandler(db, createConfig(10), provider, reaper, {
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
      rerankerUsed: true
    })
  });

  try {
    await assert.rejects(
      handler({
        session_id: sessionId,
        prompt: "Explain the architecture"
      }),
      (error: unknown) => {
        const candidate = error as McpError & { data?: { error_code?: string } };
        return candidate instanceof McpError
          && candidate.data?.error_code === "CONTEXT_BUDGET_EXCEEDED";
      }
    );
  } finally {
    reaper.close();
    __resetAskOracleQueuesForTests();
    cleanup();
  }
});
