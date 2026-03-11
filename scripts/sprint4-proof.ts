import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { chunkFile } from "../src/indexer/chunker-treesitter.js";
import { indexFile } from "../src/indexer/sync.js";
import { createAskOracleHandler } from "../src/mcp/ask-oracle.js";
import { createCommitDecisionHandler } from "../src/mcp/commit-decision.js";
import { createDecommissionHandler } from "../src/mcp/decommission.js";
import { createSpawnOracleHandler } from "../src/mcp/spawn-oracle.js";
import { SessionReaper } from "../src/oracle/reaper.js";
import type { ReasoningProvider } from "../src/oracle/provider.js";
import { __resetRerankerForTests, __setRerankerTestHooks } from "../src/retrieval/reranker.js";

type SpawnResponse = {
  created: boolean;
  decommission_secret?: string;
  generation_id: number;
  session_id: string;
  status: string;
};

type ToolTextResponse = {
  content: Array<{
    text: string;
    type: "text";
  }>;
};

function extractText(response: ToolTextResponse): string {
  return response.content[0]?.text ?? "";
}

function extractJson<T>(response: ToolTextResponse): T {
  return JSON.parse(extractText(response)) as T;
}

function cleanup(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint4-proof-"));
  const pythiaRoot = path.join(workspaceRoot, ".pythia");
  const vaultRoot = path.join(workspaceRoot, "vault");
  const dbPath = path.join(pythiaRoot, "lcs.db");
  const sourcePath = path.join(workspaceRoot, "src", "auth.ts");
  const sourceContent = [
    "export function handleUserAuthentication(user: string, password: string): boolean {",
    "  if (user.length === 0 || password.length === 0) {",
    "    return false;",
    "  }",
    "",
    "  return user === \"admin\" && password === \"swordfish\";",
    "}"
  ].join("\n");

  mkdirSync(path.dirname(sourcePath), { recursive: true });
  mkdirSync(pythiaRoot, { recursive: true });
  mkdirSync(vaultRoot, { recursive: true });
  writeFileSync(sourcePath, sourceContent, "utf8");

  const db = openDb(dbPath);

  try {
    runMigrations(db);

    const chunks = chunkFile(sourcePath, sourceContent, workspaceRoot);
    await indexFile(db, sourcePath, sourceContent, { chunks });

    let rerankerCalled = false;
    __setRerankerTestHooks({
      forceReady: true,
      tokenizer: () => ({}),
      model: async () => {
        rerankerCalled = true;
        return {
          logits: {
            data: new Float32Array([3])
          }
        };
      }
    });

    const config = {
      workspace_path: workspaceRoot,
      obsidian_vault_path: vaultRoot,
      limits: {
        ask_context_chars_max: 48_000,
        session_idle_ttl_minutes: 30
      }
    };

    const spawnOracle = createSpawnOracleHandler(db);
    const provider: ReasoningProvider = {
      async query(prompt: string): Promise<string> {
        return `Oracle response: ${prompt}`;
      },
      async healthCheck(): Promise<boolean> {
        return true;
      }
    };
    const askOracle = createAskOracleHandler(
      db,
      config,
      provider,
      new SessionReaper(db, config.limits.session_idle_ttl_minutes)
    );
    const commitDecision = createCommitDecisionHandler(db, config);
    const decommission = createDecommissionHandler(db);

    const spawnResponse = extractJson<SpawnResponse>(
      await spawnOracle({ name: "architecture-oracle" }) as ToolTextResponse
    );

    assert.equal(spawnResponse.created, true);
    assert.match(
      spawnResponse.session_id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.equal(typeof spawnResponse.decommission_secret, "string");
    assert.equal(spawnResponse.decommission_secret?.length, 32);

    const askResponse = await askOracle({
      session_id: spawnResponse.session_id,
      prompt: "function that handles user authentication"
    }) as ToolTextResponse;
    const askText = extractText(askResponse);

    assert.match(askText, /^Oracle response:/);
    assert.equal(rerankerCalled, true);

    const commitResponse = await commitDecision({
      session_id: spawnResponse.session_id,
      title: "Adopt authentication guard",
      problem: "Authentication needs a single entrypoint.",
      drivers: ["Consistency", "Security"],
      options: ["Inline checks", "Dedicated function"],
      decision: "Use handleUserAuthentication as the canonical auth gate.",
      impacts_files: ["src/auth.ts"]
    }) as ToolTextResponse;
    const commitText = extractText(commitResponse);
    assert.match(commitText, /MADR-001/);

    const madrRow = db.prepare(`
      SELECT seq, id, generation_id, timestamp, status, title, context_and_problem,
             decision_drivers, considered_options, decision_outcome, supersedes_madr
      FROM pythia_memories
      WHERE seq = 1
    `).get() as Record<string, unknown> | undefined;

    assert.ok(madrRow !== undefined);
    assert.equal(madrRow.id, "MADR-001");

    const implementsEdge = db.prepare(`
      SELECT source_id, target_id, edge_type
      FROM graph_edges
      WHERE source_id = 'MADR-001'
        AND target_id = 'src/auth.ts::module::default'
        AND edge_type = 'IMPLEMENTS'
    `).get() as Record<string, unknown> | undefined;

    assert.ok(implementsEdge !== undefined);

    await decommission({
      session_id: spawnResponse.session_id,
      decommission_secret: spawnResponse.decommission_secret ?? ""
    });

    const transcriptCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM pythia_transcripts
      WHERE session_id = ?
    `).get(spawnResponse.session_id) as { count: number };
    const sessionStatus = db.prepare(`
      SELECT status
      FROM pythia_sessions
      WHERE id = ?
    `).get(spawnResponse.session_id) as { status: string };

    assert.equal(transcriptCount.count, 0);
    assert.equal(sessionStatus.status, "decommissioned");

    const respawnResponse = extractJson<SpawnResponse>(
      await spawnOracle({ name: "architecture-oracle" }) as ToolTextResponse
    );

    assert.equal(respawnResponse.generation_id, 2);

    console.log(JSON.stringify(madrRow, null, 2));
    console.log(`generation_id=${respawnResponse.generation_id}`);
  } finally {
    __resetRerankerForTests();
    db.close();
    cleanup(workspaceRoot);
  }
}

await main();
