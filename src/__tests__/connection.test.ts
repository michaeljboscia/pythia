import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";

test("connection opens on :memory: without throwing", () => {
  const db = openDb(":memory:");

  try {
    assert.ok(db);
  } finally {
    db.close();
  }
});

test("PRAGMA journal_mode returns wal", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-db-"));
  const dbPath = path.join(directory, "connection.db");
  const db = openDb(dbPath);

  try {
    const journalMode = db.pragma("journal_mode", { simple: true });
    assert.equal(journalMode, "wal");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PRAGMA foreign_keys returns 1", () => {
  const db = openDb(":memory:");

  try {
    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    assert.equal(foreignKeys, 1);
  } finally {
    db.close();
  }
});

test("sqlite-vec extension loaded so vec_version() succeeds", () => {
  const db = openDb(":memory:");

  try {
    const row = db.prepare("SELECT vec_version() AS vec_version").get() as { vec_version: string };
    assert.match(row.vec_version, /^v/i);
  } finally {
    db.close();
  }
});
