import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openDb } from "../src/db/connection.js";
import { runGc } from "../src/db/gc.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  QdrantVectorStore,
  SqliteVectorStore,
  createVectorStore
} from "../src/indexer/vector-store.js";
import {
  FalkorDbGraphStore,
  SqliteGraphStore,
  createGraphStore
} from "../src/retrieval/graph-store.js";

type Step = {
  name: string;
  run: () => Promise<void> | void;
};

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function cleanup(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

function runCommand(command: string, args: string[], cwd = repoRoot): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  });
}

function insertDeletedChunk(
  db: ReturnType<typeof openDb>,
  id: string,
  deletedAt: string
): void {
  db.prepare(`
    INSERT INTO lcs_chunks(
      id,
      file_path,
      chunk_type,
      content,
      start_line,
      end_line,
      is_deleted,
      deleted_at,
      content_hash
    )
    VALUES (?, ?, 'function', ?, 0, 0, 1, ?, ?)
  `).run(id, "src/proof.ts", `export function ${id.replace(/[^a-z0-9]/gi, "_")}() {}`, deletedAt, `blake3:${id}`);
  db.prepare("INSERT INTO vec_lcs_chunks(id, embedding) VALUES (?, ?)").run(id, new Float32Array(256));
  db.prepare("INSERT INTO fts_lcs_chunks_kw(id, content) VALUES (?, ?)").run(id, id);
  db.prepare("INSERT INTO fts_lcs_chunks_sub(id, content) VALUES (?, ?)").run(id, id);
}

async function main(): Promise<void> {
  const steps: Step[] = [
    {
      name: "STEP 1 — Build package",
      run: () => {
        runCommand("npm", ["run", "build"]);

        const builtCli = path.join(repoRoot, "dist", "cli", "main.js");
        assert.equal(existsSync(builtCli), true);
        assert.ok(statSync(builtCli).size > 0);
      }
    },
    {
      name: "STEP 2 — GC runs at boot (no crash)",
      run: () => {
        const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint5-gc-boot-"));
        const dbPath = path.join(workspaceRoot, "boot.db");
        const db = openDb(dbPath);

        try {
          runMigrations(db);
          const result = runGc(db, 30);

          assert.equal(result.chunksDeleted, 0);
          assert.equal(typeof result.bytesReclaimed, "number");
        } finally {
          db.close();
          cleanup(workspaceRoot);
        }
      }
    },
    {
      name: "STEP 3 — GC deletes tombstones beyond retention",
      run: () => {
        const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint5-gc-retention-"));
        const dbPath = path.join(workspaceRoot, "retention.db");
        const db = openDb(dbPath);

        try {
          runMigrations(db);

          for (let index = 0; index < 5; index += 1) {
            insertDeletedChunk(db, `stale-${index}`, "2025-01-01T00:00:00.000Z");
            insertDeletedChunk(db, `recent-${index}`, "2026-03-10T00:00:00.000Z");
          }

          const result = runGc(db, 30);
          const remaining = db.prepare("SELECT COUNT(*) AS count FROM lcs_chunks WHERE is_deleted = 1").get() as {
            count: number;
          };

          assert.equal(result.chunksDeleted, 5);
          assert.equal(remaining.count, 5);
        } finally {
          db.close();
          cleanup(workspaceRoot);
        }
      }
    },
    {
      name: "STEP 4 — pythia init on fresh directory",
      run: () => {
        const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint5-init-"));
        const srcRoot = path.join(workspaceRoot, "src");

        mkdirSync(srcRoot, { recursive: true });
        writeFileSync(
          path.join(srcRoot, "auth.ts"),
          "export function login(user: string) { return user.length > 0; }\n",
          "utf8"
        );
        writeFileSync(
          path.join(srcRoot, "server.ts"),
          "import { login } from './auth';\nexport function handle() { return login('user'); }\n",
          "utf8"
        );

        try {
          runCommand("node", ["dist/cli/main.js", "init", "--workspace", workspaceRoot]);

          const dbPath = path.join(workspaceRoot, ".pythia", "lcs.db");
          assert.equal(existsSync(dbPath), true);

          const db = openDb(dbPath);

          try {
            const tables = db.prepare(`
              SELECT name
              FROM sqlite_master
              WHERE type IN ('table', 'trigger')
            `).all() as Array<{ name: string }>;
            const names = new Set(tables.map((row) => row.name));

            assert.equal(names.has("lcs_chunks"), true);
            assert.equal(names.has("vec_lcs_chunks"), true);
            assert.equal(names.has("graph_edges"), true);
            assert.equal(names.has("trg_graph_edges_validate_before_insert"), true);
          } finally {
            db.close();
          }
        } finally {
          cleanup(workspaceRoot);
        }
      }
    },
    {
      name: "STEP 5 — pythia start fails fast without init",
      run: () => {
        const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint5-start-"));

        try {
          const result = spawnSync("node", ["dist/cli/main.js", "start", "--workspace", workspaceRoot], {
            cwd: repoRoot,
            encoding: "utf8"
          });
          const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;

          assert.notEqual(result.status, 0);
          assert.match(combinedOutput, /Run 'pythia init' first\./);
        } finally {
          cleanup(workspaceRoot);
        }
      }
    },
    {
      name: "STEP 6 — VectorStore / GraphStore factory",
      run: () => {
        const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-sprint5-stores-"));
        const dbPath = path.join(workspaceRoot, "stores.db");
        const db = openDb(dbPath);

        try {
          runMigrations(db);

          const sqliteVectorStore = createVectorStore("sqlite", db);
          const qdrantVectorStore = createVectorStore("qdrant", db);
          const sqliteGraphStore = createGraphStore("sqlite", db);
          const falkorGraphStore = createGraphStore("falkordb", db);

          assert.equal(sqliteVectorStore instanceof SqliteVectorStore, true);
          assert.equal(qdrantVectorStore instanceof QdrantVectorStore, true);
          assert.equal(sqliteGraphStore instanceof SqliteGraphStore, true);
          assert.equal(falkorGraphStore instanceof FalkorDbGraphStore, true);
        } finally {
          db.close();
          cleanup(workspaceRoot);
        }
      }
    },
    {
      name: "STEP 7 — npm pack sanity",
      run: () => {
        const result = spawnSync("npm", ["pack", "--dry-run"], {
          cwd: repoRoot,
          encoding: "utf8"
        });
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

        assert.equal(result.status, 0);

        assert.match(output, /dist\//);
        assert.match(output, /src\/migrations\//);
      }
    },
    {
      name: "STEP 8 — Full regression: all prior sprint tests still pass",
      run: () => {
        runCommand("npm", ["test"]);
      }
    }
  ];

  for (const [index, step] of steps.entries()) {
    try {
      await step.run();
      console.log(`PASS ${index + 1}/8 — ${step.name}`);
    } catch (error) {
      console.error(`FAIL ${index + 1}/8 — ${step.name}`);
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      console.log(`❌ Sprint 5 proof FAILED at step ${index + 1}`);
      process.exit(1);
    }
  }

  console.log("✅ Sprint 5 proof PASSED (8/8 steps)");
}

await main();
