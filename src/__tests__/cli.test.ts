import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createProgram } from "../cli/main.js";
import { runInit } from "../cli/init.js";
import { runMcpInstall } from "../cli/mcp-install.js";
import { runMigrate } from "../cli/migrate.js";
import { runStart } from "../cli/start.js";

function createWorkspace(): { cleanup: () => void; workspaceRoot: string } {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-cli-"));

  mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, "src", "auth.ts"),
    "export function login(user: string) { return user.length > 0; }\n",
    "utf8"
  );

  return {
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
    workspaceRoot
  };
}

test("pythia init on empty dir creates .pythia/lcs.db", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();

  try {
    const result = await runInit({ workspace: workspaceRoot });
    assert.equal(result.initialized, true);
    assert.equal(existsSync(path.join(workspaceRoot, ".pythia", "lcs.db")), true);
  } finally {
    cleanup();
  }
});

test("pythia init on existing dir runs migrations and preserves data", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();

  try {
    await runInit({ workspace: workspaceRoot });

    const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");
    const { openDb } = await import("../db/connection.js");
    const db = openDb(dbPath);

    try {
      db.prepare(`
        INSERT INTO pythia_sessions(id, name, status, generation_id, secret_hash, session_secret, created_at, updated_at)
        VALUES ('session-1', 'oracle', 'active', 1, 'hash', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      `).run();
    } finally {
      db.close();
    }

    const rerun = await runInit({ workspace: workspaceRoot });
    const reopened = openDb(dbPath);

    try {
      const row = reopened.prepare("SELECT COUNT(*) AS count FROM pythia_sessions WHERE id = 'session-1'").get() as {
        count: number;
      };

      assert.equal(rerun.initialized, false);
      assert.equal(row.count, 1);
    } finally {
      reopened.close();
    }
  } finally {
    cleanup();
  }
});

test("pythia init twice is idempotent", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();

  try {
    await runInit({ workspace: workspaceRoot });
    const second = await runInit({ workspace: workspaceRoot });

    assert.equal(second.initialized, false);
    assert.equal(existsSync(path.join(workspaceRoot, ".pythia", "lcs.db")), true);
  } finally {
    cleanup();
  }
});

test("pythia start without prior init fails fast", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();

  try {
    await assert.rejects(
      () => runStart({ workspace: workspaceRoot }),
      /Run 'pythia init' first/
    );
  } finally {
    cleanup();
  }
});

test("pythia start after init starts the MCP server on stdio-compatible transport", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pythia-cli-test-client", version: "1.0.0" });

  try {
    await runInit({ workspace: workspaceRoot });
    const runtime = await runStart({
      workspace: workspaceRoot
    }, {
      createTransport: () => serverTransport
    });

    await client.connect(clientTransport);
    const result = await client.listTools();

    assert.ok(result.tools.length >= 6);

    await client.close();
    await runtime.server.close();
    await runtime.supervisor.die();
    runtime.db.close();
  } finally {
    cleanup();
  }
});

test("pythia mcp install claude-code with no existing config shows preview", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();
  const configPath = path.join(workspaceRoot, "claude.json");
  let output = "";

  try {
    await runMcpInstall("claude-code", workspaceRoot, configPath, {}, {
      confirm: async () => false,
      output: (text) => {
        output += text;
      }
    });

    assert.match(output, /"pythia"/);
    assert.equal(existsSync(configPath), false);
  } finally {
    cleanup();
  }
});

test("pythia mcp install claude-code with existing entry is idempotent", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();
  const configPath = path.join(workspaceRoot, "claude.json");

  try {
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        pythia: {
          command: "pythia",
          args: ["start", "--workspace", path.resolve(workspaceRoot)]
        }
      }
    }, null, 2), "utf8");

    await runMcpInstall("claude-code", workspaceRoot, configPath, { yes: true });
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers: Record<string, { args: string[]; command: string }>;
    };

    assert.deepEqual(Object.keys(parsed.mcpServers), ["pythia"]);
  } finally {
    cleanup();
  }
});

test("pythia mcp install claude-code dry-run writes nothing on N", async () => {
  const { cleanup, workspaceRoot } = createWorkspace();
  const configPath = path.join(workspaceRoot, "claude.json");

  try {
    const result = await runMcpInstall("claude-code", workspaceRoot, configPath, {}, {
      confirm: async () => false
    });

    assert.equal(result.applied, false);
    assert.equal(existsSync(configPath), false);
  } finally {
    cleanup();
  }
});

test("pythia --version prints the version string", async () => {
  const program = createProgram();
  let output = "";

  program.exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: (text) => {
      output += text;
    }
  });

  try {
    await program.parseAsync(["node", "pythia", "--version"], { from: "user" });
  } catch (error) {
    assert.match(String(error), /1\.0\.0/);
  }

  assert.match(output, /0\.1\.0|1\.0\.0/);
});

test("pythia migrate sqlite is a no-op exit 0", async () => {
  const message = await runMigrate("sqlite");
  assert.match(message, /No migration required/);
});
