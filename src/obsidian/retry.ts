import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

import type { StoredMadr } from "./writer.js";

export type RetryEntry = {
  attempts: number;
  impacts_files: string[];
  madr: StoredMadr;
  queued_at: string;
};

export class ObsidianRetryQueue {
  private readonly queuePath: string;

  constructor(workspacePath: string) {
    this.queuePath = path.join(workspacePath, ".pythia", "obsidian-retry.jsonl");
  }

  async enqueue(madr: StoredMadr, impactsFiles: string[]): Promise<void> {
    await mkdir(path.dirname(this.queuePath), { recursive: true });
    await appendFile(this.queuePath, JSON.stringify({
      madr,
      impacts_files: impactsFiles,
      queued_at: new Date().toISOString(),
      attempts: 0
    } satisfies RetryEntry) + "\n", "utf8");
  }

  get path(): string {
    return this.queuePath;
  }
}
