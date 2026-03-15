import type Database from "better-sqlite3";

import { computeCorpusHealth } from "../indexer/health.js";

export function createCorpusHealthHandler(db: Database.Database) {
  return async () => {
    const report = computeCorpusHealth(db);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }]
    };
  };
}
