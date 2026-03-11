import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { scanWorkspace } from "../indexer/cdc.js";
import { hashFile } from "../indexer/hasher.js";

function createWorkspace(): {
  cleanup: () => void;
  dbPath: string;
  workspaceRoot: string;
} {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-cdc-"));

  return {
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
    dbPath: path.join(workspaceRoot, "lcs.db"),
    workspaceRoot
  };
}

function insertCacheRow(
  db: ReturnType<typeof openDb>,
  filePath: string,
  mtimeNs: bigint,
  contentHash: string
): void {
  db.prepare(`
    INSERT INTO file_scan_cache(file_path, mtime_ns, size_bytes, content_hash, last_scanned_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(filePath, mtimeNs.toString(), 0, contentHash, new Date().toISOString());
}

test("file with unchanged mtime is not returned", async () => {
  const { cleanup, dbPath, workspaceRoot } = createWorkspace();
  const db = openDb(dbPath);
  const filePath = path.join(workspaceRoot, "src", "auth.ts");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "export function login() {}\n", "utf8");

  try {
    runMigrations(db);
    const contentHash = await hashFile("export function login() {}\n");
    const stats = statSync(filePath, { bigint: true });
    insertCacheRow(db, filePath, stats.mtimeNs, contentHash);

    const changes = await scanWorkspace(workspaceRoot, db);

    assert.equal(changes.length, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("file with changed mtime but same hash is not returned", async () => {
  const { cleanup, dbPath, workspaceRoot } = createWorkspace();
  const db = openDb(dbPath);
  const filePath = path.join(workspaceRoot, "src", "auth.ts");
  const content = "export function login() {}\n";
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");

  try {
    runMigrations(db);
    const stats = statSync(filePath, { bigint: true });
    const contentHash = await hashFile(content);
    insertCacheRow(db, filePath, stats.mtimeNs - 1n, contentHash);

    const changes = await scanWorkspace(workspaceRoot, db);

    assert.equal(changes.length, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("file with changed mtime and changed hash is returned", async () => {
  const { cleanup, dbPath, workspaceRoot } = createWorkspace();
  const db = openDb(dbPath);
  const filePath = path.join(workspaceRoot, "src", "auth.ts");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "export function login() {}\n", "utf8");

  try {
    runMigrations(db);
    const stats = statSync(filePath, { bigint: true });
    const initialHash = await hashFile("export function login() {}\n");
    insertCacheRow(db, filePath, stats.mtimeNs, initialHash);

    writeFileSync(filePath, "export function logout() {}\n", "utf8");
    const nextDate = new Date(Date.now() + 1000);
    utimesSync(filePath, nextDate, nextDate);

    const changes = await scanWorkspace(workspaceRoot, db);

    assert.equal(changes.length, 1);
    assert.equal(changes[0].filePath, filePath);
    assert.equal(changes[0].repoRelativePath, "src/auth.ts");
  } finally {
    db.close();
    cleanup();
  }
});

test("binary file is skipped", async () => {
  const { cleanup, dbPath, workspaceRoot } = createWorkspace();
  const db = openDb(dbPath);
  const filePath = path.join(workspaceRoot, "src", "binary.ts");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.from([0x00, 0x61, 0x62, 0x63]));

  try {
    runMigrations(db);

    const changes = await scanWorkspace(workspaceRoot, db);

    assert.equal(changes.length, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("file matching .gitignore pattern is skipped", async () => {
  const { cleanup, dbPath, workspaceRoot } = createWorkspace();
  const db = openDb(dbPath);
  const ignoredFilePath = path.join(workspaceRoot, "src", "ignored.ts");
  mkdirSync(path.dirname(ignoredFilePath), { recursive: true });
  writeFileSync(path.join(workspaceRoot, ".gitignore"), "ignored.ts\n", "utf8");
  writeFileSync(ignoredFilePath, "export const ignored = true;\n", "utf8");

  try {
    runMigrations(db);

    const changes = await scanWorkspace(workspaceRoot, db);

    assert.equal(changes.length, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("file matching .pythiaignore pattern is skipped", async () => {
  const { cleanup, dbPath, workspaceRoot } = createWorkspace();
  const db = openDb(dbPath);
  const ignoredFilePath = path.join(workspaceRoot, "src", "hidden.ts");
  mkdirSync(path.dirname(ignoredFilePath), { recursive: true });
  writeFileSync(path.join(workspaceRoot, ".pythiaignore"), "hidden.ts\n", "utf8");
  writeFileSync(ignoredFilePath, "export const hidden = true;\n", "utf8");

  try {
    runMigrations(db);

    const changes = await scanWorkspace(workspaceRoot, db);

    assert.equal(changes.length, 0);
  } finally {
    db.close();
    cleanup();
  }
});

test("content_hash uses the expected algo:digest format", async () => {
  const { cleanup, dbPath, workspaceRoot } = createWorkspace();
  const db = openDb(dbPath);
  const filePath = path.join(workspaceRoot, "src", "auth.ts");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "export function login() {}\n", "utf8");

  try {
    runMigrations(db);

    const changes = await scanWorkspace(workspaceRoot, db);

    assert.equal(changes.length, 1);
    assert.match(changes[0].contentHash, /^(blake3|sha256):[a-f0-9]+$/);
  } finally {
    db.close();
    cleanup();
  }
});
