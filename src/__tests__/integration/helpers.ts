/**
 * Shared utilities for integration tests.
 * All tests use real SQLite on disk (not :memory:) to exercise WAL behaviour.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import { openDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrate.js";

// ── Temp database ────────────────────────────────────────────────────────────

export type TempDb = {
  cleanup: () => void;
  db: Database.Database;
  dbPath: string;
  dir: string;
};

export function makeTempDb(prefix = "pythia-it-"): TempDb {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const dbPath = path.join(dir, "lcs.db");
  const db = openDb(dbPath);
  runMigrations(db);

  return {
    cleanup: () => {
      try { db.close(); } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true });
    },
    db,
    dbPath,
    dir
  };
}

// ── File helpers ─────────────────────────────────────────────────────────────

export function makeTempFile(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ── Row seeding ──────────────────────────────────────────────────────────────

export function insertChunk(
  db: Database.Database,
  id: string,
  options: {
    content?: string;
    deletedAt?: string | null;
    filePath?: string;
    isDeleted?: number;
  } = {}
): void {
  const safeId = id.replace(/[^a-z0-9_]/gi, "_");
  db.prepare(`
    INSERT INTO lcs_chunks(
      id, file_path, chunk_type, content, start_line, end_line,
      is_deleted, deleted_at, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    options.filePath ?? "src/test.ts",
    "function",
    options.content ?? `export function fn_${safeId}() { return 1; }`,
    0,
    1,
    options.isDeleted ?? 0,
    options.deletedAt ?? null,
    "blake3:test"
  );
}

export function insertDerivedRows(db: Database.Database, id: string, content?: string): void {
  db.prepare("INSERT INTO vec_lcs_chunks(id, embedding) VALUES (?, ?)").run(
    id,
    new Float32Array(256).fill(0)
  );
  db.prepare("INSERT INTO fts_lcs_chunks_kw(id, content) VALUES (?, ?)").run(
    id,
    content ?? `function ${id}`
  );
  db.prepare("INSERT INTO fts_lcs_chunks_sub(id, content) VALUES (?, ?)").run(
    id,
    content ?? `function ${id}`
  );
}

/** Seed N live chunks with vec + FTS rows. Returns the chunk ids. */
export function seedLiveChunks(
  db: Database.Database,
  count: number,
  filePath = "src/test.ts"
): string[] {
  const ids: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const id = `${filePath}::function::fn_${index}`;
    const content = `// line ${index}\nexport function fn_${index}() { return ${index}; }`;
    insertChunk(db, id, { filePath, content });
    insertDerivedRows(db, id, content);
    ids.push(id);
  }

  return ids;
}

/** Seed N tombstoned chunks with derived rows. Returns the chunk ids. */
export function seedTombstones(
  db: Database.Database,
  count: number,
  daysAgo = 31
): string[] {
  const deletedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const ids: string[] = [];

  db.exec("BEGIN IMMEDIATE");

  for (let index = 0; index < count; index += 1) {
    const id = `tomb-${randomUUID()}`;
    // Use realistic content lengths (~400 chars) to stress real page layout
    const content = `export function dead_${index}() {\n  ${"// dead code\n".repeat(15)}  return null;\n}`;
    db.prepare(`
      INSERT INTO lcs_chunks(
        id, file_path, chunk_type, content, start_line, end_line,
        is_deleted, deleted_at, content_hash
      ) VALUES (?, 'src/dead.ts', 'function', ?, 0, 18, 1, ?, 'blake3:dead')
    `).run(id, content, deletedAt);
    db.prepare("INSERT INTO vec_lcs_chunks(id, embedding) VALUES (?, ?)").run(
      id,
      new Float32Array(256).fill(0)
    );
    db.prepare("INSERT INTO fts_lcs_chunks_kw(id, content) VALUES (?, ?)").run(id, content);
    db.prepare("INSERT INTO fts_lcs_chunks_sub(id, content) VALUES (?, ?)").run(id, content);
    ids.push(id);
  }

  db.exec("COMMIT");

  return ids;
}

// ── Stub injectable dependencies ─────────────────────────────────────────────

export function zeroEmbedQuery(_query: string): Promise<Float32Array> {
  return Promise.resolve(new Float32Array(256));
}

export function passthroughReranker<T>(
  _query: string,
  candidates: T[]
): Promise<{ chunks: T[]; rerankerUsed: boolean }> {
  return Promise.resolve({ chunks: candidates, rerankerUsed: false });
}

// ── Minimal valid PythiaConfig ────────────────────────────────────────────────

export function minimalConfig(workspacePath: string) {
  return {
    workspace_path: workspacePath,
    reasoning: { mode: "cli" as const },
    embeddings: {
      mode: "local" as const,
      model: "nomic-embed-text-v1.5",
      revision: "main"
    },
    vector_store: { mode: "sqlite" as const },
    graph_store: { mode: "sqlite" as const },
    limits: {
      spawn_chars_max: 180_000,
      ask_context_chars_max: 40_000,
      session_idle_ttl_minutes: 30
    },
    indexing: {
      scan_on_start: false,
      max_worker_restarts: 3
    },
    gc: {
      deleted_chunk_retention_days: 30
    }
  };
}
