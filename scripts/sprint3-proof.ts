import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { chunkFile } from "../src/indexer/chunker-treesitter.js";
import { extractEdges, initLanguageService } from "../src/indexer/slow-path.js";
import { indexFile } from "../src/indexer/sync.js";
import { traverseGraph } from "../src/retrieval/graph.js";

type ChunkRow = {
  chunk_type: string;
};

function insertSlowPathEdges(
  db: ReturnType<typeof openDb>,
  edges: Array<{ source_id: string; target_id: string; edge_type: string }>
): void {
  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO graph_edges(source_id, target_id, edge_type)
    VALUES (?, ?, ?)
  `);

  for (const edge of edges) {
    insertEdge.run(edge.source_id, edge.target_id, edge.edge_type);
  }
}

async function main(): Promise<void> {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint3-proof-"));
  const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");
  const authPath = path.join(workspaceRoot, "src", "auth.ts");
  const serverPath = path.join(workspaceRoot, "src", "server.ts");

  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(path.dirname(authPath), { recursive: true });

  const authContent = [
    "export function login(user: string): boolean {",
    "  return user.length > 0;",
    "}",
    ""
  ].join("\n");
  const serverContent = [
    "import { login } from './auth';",
    "",
    "export function handleRequest(): boolean {",
    "  return login('user');",
    "}",
    ""
  ].join("\n");

  writeFileSync(authPath, authContent, "utf8");
  writeFileSync(serverPath, serverContent, "utf8");

  const db = openDb(dbPath);

  try {
    runMigrations(db);
    initLanguageService(workspaceRoot);

    for (const filePath of [authPath, serverPath]) {
      const content = filePath === authPath ? authContent : serverContent;
      const chunks = chunkFile(filePath, content, workspaceRoot);
      const stats = statSync(filePath, { bigint: true });

      await indexFile(db, filePath, content, {
        chunks,
        embeddings: chunks.map(() => new Float32Array(256)),
        mtimeNs: stats.mtimeNs,
        sizeBytes: stats.size
      });
    }

    const slowEdges = extractEdges(serverPath, serverContent);
    assert.ok(slowEdges.some((edge) => (
      edge.edge_type === "IMPORTS"
      && edge.source_id === "src/server.ts::module::default"
      && edge.target_id === "src/auth.ts::module::default"
    )), "expected LanguageService IMPORTS edge");
    assert.ok(slowEdges.some((edge) => (
      edge.edge_type === "CALLS"
      && edge.source_id === "src/server.ts::function::handleRequest"
      && edge.target_id === "src/auth.ts::function::login"
    )), "expected LanguageService CALLS edge");

    insertSlowPathEdges(db, slowEdges);

    const chunkCount = db.prepare("SELECT COUNT(*) AS count FROM lcs_chunks WHERE is_deleted = 0").get() as { count: number };
    assert.ok(chunkCount.count >= 4, "expected fast-path chunks to be indexed");

    const authChunk = db.prepare(`
      SELECT chunk_type
      FROM lcs_chunks
      WHERE id = ?
    `).get("src/auth.ts::function::login") as ChunkRow | undefined;
    assert.equal(authChunk?.chunk_type, "function");

    const result = traverseGraph("src/auth.ts::function::login", db);

    process.stdout.write(`${result}\n`);

    assert.match(result, /\[DEPTH:1 via CALLS\]/, "expected CALLS traversal depth");
    assert.match(result, /src\/server\.ts::function::handleRequest/, "expected handleRequest in traversal");
    assert.match(result, /TYPE: function/, "expected function chunk in traversal");
    assert.match(result, /```typescript\nexport function handleRequest\(\): boolean \{[\s\S]*```/, "expected AST-bounded function content");
  } finally {
    db.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
