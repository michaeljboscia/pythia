import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

const MIGRATION_FILE_PATTERN = /^\d+.*\.sql$/;

type MigrationRecord = {
  name: string;
};

function getMigrationsDirectory(migrationsDirectory = path.join(process.cwd(), "src", "migrations")): string {
  return migrationsDirectory;
}

function ensureMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function getAppliedMigrationNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM _migrations ORDER BY id")
    .all() as MigrationRecord[];

  return new Set(rows.map((row) => row.name));
}

export function runMigrations(
  db: Database.Database,
  migrationsDirectory = getMigrationsDirectory()
): void {
  ensureMigrationTable(db);

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  const appliedMigrationNames = getAppliedMigrationNames(db);
  const insertMigration = db.prepare(
    "INSERT INTO _migrations(name, applied_at) VALUES (?, ?)"
  );

  for (const migrationFile of migrationFiles) {
    if (appliedMigrationNames.has(migrationFile)) {
      continue;
    }

    const migrationPath = path.join(migrationsDirectory, migrationFile);
    const sql = readFileSync(migrationPath, "utf8");

    db.exec("BEGIN");

    try {
      db.exec(sql);
      insertMigration.run(migrationFile, new Date().toISOString());
      db.exec("COMMIT");
      appliedMigrationNames.add(migrationFile);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
