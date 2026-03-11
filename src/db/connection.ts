import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -32000");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");

  sqliteVec.load(db);

  return db;
}
