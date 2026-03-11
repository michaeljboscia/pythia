import assert from "node:assert/strict";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { forceIndexPath } from "../mcp/force-index.js";

function createWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-force-index-"));
  const db = openDb(path.join(workspaceRoot, "lcs.db"));
  runMigrations(db);

  return {
    workspaceRoot,
    db,
    cleanup: () => {
      db.close();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  };
}

function baseConfig(workspaceRoot: string) {
  return { workspace_path: workspaceRoot };
}

function isInvalidPathError(error: unknown): boolean {
  const candidate = error as McpError & { data?: { error_code?: string } };
  return candidate instanceof McpError && candidate.data?.error_code === "INVALID_PATH";
}

test("path='../outside' throws INVALID_PATH", async () => {
  const { workspaceRoot, db, cleanup } = createWorkspace();

  try {
    await assert.rejects(
      () => forceIndexPath(db, baseConfig(workspaceRoot), "../outside"),
      isInvalidPathError
    );
  } finally {
    cleanup();
  }
});

test("absolute path throws INVALID_PATH", async () => {
  const { workspaceRoot, db, cleanup } = createWorkspace();

  try {
    await assert.rejects(
      () => forceIndexPath(db, baseConfig(workspaceRoot), "/absolute/path"),
      isInvalidPathError
    );
  } finally {
    cleanup();
  }
});

test("nonexistent file throws INVALID_PATH", async () => {
  const { workspaceRoot, db, cleanup } = createWorkspace();

  try {
    await assert.rejects(
      () => forceIndexPath(db, baseConfig(workspaceRoot), "nonexistent.ts"),
      isInvalidPathError
    );
  } finally {
    cleanup();
  }
});

test("specific file triggers unconditional re-embed", async () => {
  const { workspaceRoot, db, cleanup } = createWorkspace();
  const filePath = path.join(workspaceRoot, "src", "auth.ts");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "export function login() { return true; }\n", "utf8");
  let indexCalls = 0;

  try {
    const stats = statSync(filePath, { bigint: true });
    db.prepare(`
      INSERT INTO file_scan_cache(file_path, mtime_ns, size_bytes, content_hash, last_scanned_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(filePath, stats.mtimeNs.toString(), Number(stats.size), "blake3:cached", new Date().toISOString());

    const summary = await forceIndexPath(db, baseConfig(workspaceRoot), "src/auth.ts", {
      embedChunksImpl: async (texts) => texts.map(() => new Float32Array(256)),
      indexFileImpl: async () => {
        indexCalls += 1;
      }
    });

    assert.equal(indexCalls, 1);
    assert.equal(summary.filesIndexed, 1);
  } finally {
    cleanup();
  }
});

test("directory path scans only that subtree", async () => {
  const { workspaceRoot, db, cleanup } = createWorkspace();
  const srcFile = path.join(workspaceRoot, "src", "auth.ts");
  const docsFile = path.join(workspaceRoot, "docs", "guide.md");
  mkdirSync(path.dirname(srcFile), { recursive: true });
  mkdirSync(path.dirname(docsFile), { recursive: true });
  writeFileSync(srcFile, "export function login() { return true; }\n", "utf8");
  writeFileSync(docsFile, "# Guide\n\nHello\n", "utf8");
  const indexedFiles: string[] = [];

  try {
    const summary = await forceIndexPath(db, baseConfig(workspaceRoot), "src", {
      scanWorkspaceImpl: async () => [
        {
          filePath: srcFile,
          repoRelativePath: "src/auth.ts",
          contentHash: "blake3:src",
          mtimeNs: 1n,
          forceReindex: false
        },
        {
          filePath: docsFile,
          repoRelativePath: "docs/guide.md",
          contentHash: "blake3:docs",
          mtimeNs: 1n,
          forceReindex: false
        }
      ],
      embedChunksImpl: async (texts) => texts.map(() => new Float32Array(256)),
      indexFileImpl: async (_db, filePath) => {
        indexedFiles.push(filePath);
      }
    });

    assert.equal(summary.filesIndexed, 1);
    assert.deepEqual(indexedFiles, [srcFile]);
  } finally {
    cleanup();
  }
});

test("omitted path scans the full workspace", async () => {
  const { workspaceRoot, db, cleanup } = createWorkspace();
  const srcFile = path.join(workspaceRoot, "src", "auth.ts");
  const docsFile = path.join(workspaceRoot, "docs", "guide.md");
  mkdirSync(path.dirname(srcFile), { recursive: true });
  mkdirSync(path.dirname(docsFile), { recursive: true });
  writeFileSync(srcFile, "export function login() { return true; }\n", "utf8");
  writeFileSync(docsFile, "# Guide\n\nHello\n", "utf8");
  const indexedFiles: string[] = [];

  try {
    const summary = await forceIndexPath(db, baseConfig(workspaceRoot), undefined, {
      scanWorkspaceImpl: async () => [
        {
          filePath: srcFile,
          repoRelativePath: "src/auth.ts",
          contentHash: "blake3:src",
          mtimeNs: 1n,
          forceReindex: false
        },
        {
          filePath: docsFile,
          repoRelativePath: "docs/guide.md",
          contentHash: "blake3:docs",
          mtimeNs: 1n,
          forceReindex: false
        }
      ],
      embedChunksImpl: async (texts) => texts.map(() => new Float32Array(256)),
      indexFileImpl: async (_db, filePath) => {
        indexedFiles.push(filePath);
      }
    });

    assert.equal(summary.filesIndexed, 2);
    assert.deepEqual(indexedFiles.sort(), [docsFile, srcFile].sort());
  } finally {
    cleanup();
  }
});
