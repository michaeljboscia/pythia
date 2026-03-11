import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";

import { openDb } from "../dist/src/db/connection.js";
import { runMigrations } from "../dist/src/db/migrate.js";
import { embedQuery } from "../dist/src/indexer/embedder.js";
import { indexFile } from "../dist/src/indexer/sync.js";

type SearchRow = {
  content: string;
  distance: number;
  id: string;
};

function preview(content: string, maxLength = 160): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

async function main(): Promise<void> {
  const rootDirectory = process.cwd();
  const workspaceDirectory = mkdtempSync(path.join(rootDirectory, ".pythia-proof-"));
  const pythiaDirectory = path.join(workspaceDirectory, ".pythia");
  const dbPath = path.join(pythiaDirectory, "lcs.db");
  const sourceFilePath = path.join(rootDirectory, "docs", "CODING_STANDARDS.md");
  const sourceContent = readFileSync(sourceFilePath, "utf8");

  mkdirSync(pythiaDirectory, { recursive: true });

  const db = openDb(dbPath);

  try {
    runMigrations(db);
    await indexFile(db, sourceFilePath, sourceContent);

    const queryEmbedding = await embedQuery("SQLite threading rules for Worker Threads");
    const rows = db.prepare(`
      SELECT
        l.id,
        l.content,
        vec_distance_cosine(v.embedding, ?) AS distance
      FROM vec_lcs_chunks AS v
      JOIN lcs_chunks AS l
        ON l.id = v.id
      WHERE l.is_deleted = 0
      ORDER BY distance
      LIMIT 3
    `).all(queryEmbedding) as SearchRow[];

    console.error("Sprint 1 proof results:");

    rows.forEach((row, index) => {
      console.error(`${index + 1}. distance=${row.distance.toFixed(6)} id=${row.id}`);
      console.error(`   ${preview(row.content)}`);
    });

    const containsThreadingGuidance = rows.some((row) =>
      row.content.includes("cannot be shared between threads")
      || row.content.includes("A `Database` object cannot be shared between threads")
    );

    if (!containsThreadingGuidance) {
      throw new Error("Expected Worker Thread connection-sharing guidance in top-3 results");
    }
  } finally {
    db.close();
    rmSync(workspaceDirectory, { recursive: true, force: true });
  }
}

await main();
