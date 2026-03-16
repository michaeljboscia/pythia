import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type Database from "better-sqlite3";
import type { Ignore } from "ignore";

import { hashFile } from "./hasher.js";

const require = createRequire(import.meta.url);
const createIgnore = require("ignore") as () => Ignore;

type CacheRow = {
  content_hash: string;
  mtime_ns: bigint;
};

type IgnoreMatcher = {
  baseDir: string;
  matcher: Ignore;
};

const indexedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".php",
  ".phtml",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".xml",
  ".sql",
  ".css",
  ".scss",
  ".rb",
  ".cs",
  ".yaml",
  ".yml",
  ".swift",
  ".kt",
  ".kts",
  ".ex",
  ".exs",
  ".md",
  ".mdx"
]);

function normalizeRelativePath(filePath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/").replace(/^\.\//, "");
}

function loadIgnoreMatcher(directoryPath: string, fileName: string): IgnoreMatcher | null {
  const ignorePath = path.join(directoryPath, fileName);

  try {
    const raw = readFileSync(ignorePath, "utf8");
    const patterns = raw
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "");

    if (patterns.length === 0) {
      return null;
    }

      return {
      baseDir: directoryPath,
      matcher: createIgnore().add(patterns)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function isIgnored(
  filePath: string,
  isDirectory: boolean,
  matchers: IgnoreMatcher[]
): boolean {
  for (const entry of matchers) {
    const relativePath = normalizeRelativePath(filePath, entry.baseDir);

    if (relativePath === "" || relativePath.startsWith("../")) {
      continue;
    }

    const candidatePath = isDirectory ? `${relativePath}/` : relativePath;

    if (entry.matcher.ignores(candidatePath)) {
      return true;
    }
  }

  return false;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte === 0x00) {
      return true;
    }
  }

  return false;
}

function collectFiles(
  directoryPath: string,
  workspaceRoot: string,
  inheritedMatchers: IgnoreMatcher[],
  results: string[]
): void {
  const matchers = [...inheritedMatchers];
  const gitignoreMatcher = loadIgnoreMatcher(directoryPath, ".gitignore");
  const pythiaignoreMatcher = loadIgnoreMatcher(directoryPath, ".pythiaignore");

  if (gitignoreMatcher !== null) {
    matchers.push(gitignoreMatcher);
  }

  if (pythiaignoreMatcher !== null) {
    matchers.push(pythiaignoreMatcher);
  }

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (isIgnored(absolutePath, true, matchers)) {
        continue;
      }

      collectFiles(absolutePath, workspaceRoot, matchers, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (isIgnored(absolutePath, false, matchers)) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (!indexedExtensions.has(extension)) {
      continue;
    }

    results.push(path.resolve(absolutePath));
  }
}

export interface FileChange {
  filePath: string;
  repoRelativePath: string;
  contentHash: string;
  mtimeNs: bigint;
  forceReindex: boolean;
}

export async function scanWorkspace(
  workspaceRoot: string,
  db: Database.Database,
  forceReindex: boolean = false,
  options?: { maxFiles?: number }
): Promise<FileChange[]> {
  const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
  const filePaths: string[] = [];
  const fileChanges: FileChange[] = [];
  const selectCache = db.prepare(`
    SELECT mtime_ns, content_hash
    FROM file_scan_cache
    WHERE file_path = ?
  `).safeIntegers(true);

  collectFiles(absoluteWorkspaceRoot, absoluteWorkspaceRoot, [], filePaths);
  if (options?.maxFiles !== undefined && filePaths.length > options.maxFiles) {
    const discoveredCount = filePaths.length;
    console.warn(
      `[Pythia] File cap reached: ${options.maxFiles.toLocaleString()} of ${discoveredCount.toLocaleString()} discovered files. ` +
      "Set indexing.max_files higher or add more rules to .pythiaignore."
    );
    filePaths.length = options.maxFiles;
  }

  for (const filePath of filePaths) {
    const binaryProbe = readFileSync(filePath, { encoding: null, flag: "r" }).subarray(0, 4096);

    if (isBinaryBuffer(binaryProbe)) {
      continue;
    }

    const stats = statSync(filePath, { bigint: true });
    const repoRelativePath = normalizeRelativePath(filePath, absoluteWorkspaceRoot);

    if (forceReindex) {
      const content = readFileSync(filePath, { encoding: null, flag: "r" });

      fileChanges.push({
        filePath,
        repoRelativePath,
        contentHash: await hashFile(content),
        mtimeNs: stats.mtimeNs,
        forceReindex: true
      });
      continue;
    }

    const cachedRow = selectCache.get(filePath) as CacheRow | undefined;

    if (cachedRow !== undefined && stats.mtimeNs === cachedRow.mtime_ns) {
      continue;
    }

    const content = readFileSync(filePath, { encoding: null, flag: "r" });
    const contentHash = await hashFile(content);

    if (cachedRow !== undefined && contentHash === cachedRow.content_hash) {
      continue;
    }

    fileChanges.push({
      filePath,
      repoRelativePath,
      contentHash,
      mtimeNs: stats.mtimeNs,
      forceReindex: false
    });
  }

  return fileChanges;
}
