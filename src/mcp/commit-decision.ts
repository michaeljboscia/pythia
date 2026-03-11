import type Database from "better-sqlite3";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { PythiaConfig } from "../config.js";
import { MetadataCodes, PythiaError } from "../errors.js";
import { ObsidianRetryQueue } from "../obsidian/retry.js";
import { ObsidianWriter, type StoredMadr } from "../obsidian/writer.js";
import { getSessionById } from "../oracle/session.js";

type WriterLike = Pick<ObsidianWriter, "write">;
type RetryQueueLike = Pick<ObsidianRetryQueue, "enqueue">;

type CommitDecisionDependencies = {
  now?: () => string;
  retryQueue?: RetryQueueLike;
  writer?: WriterLike;
};

export const commitDecisionInputSchema = {
  session_id: z.string(),
  title: z.string().min(1),
  problem: z.string().min(1),
  drivers: z.array(z.string()),
  options: z.array(z.string()),
  decision: z.string().min(1),
  impacts_files: z.array(z.string()),
  supersedes_madr: z.string().optional()
};

type InsertInfo = {
  lastInsertRowid: number | bigint;
};

function beginImmediate(db: Database.Database): void {
  db.prepare("BEGIN IMMEDIATE").run();
}

function commit(db: Database.Database): void {
  db.prepare("COMMIT").run();
}

function rollback(db: Database.Database): void {
  db.prepare("ROLLBACK").run();
}

function toModuleCni(filePath: string): string {
  return `${filePath.replace(/\\/g, "/")}::module::default`;
}

function toMcpError(error: unknown): McpError {
  if (error instanceof PythiaError) {
    return new McpError(
      ErrorCode.InvalidRequest,
      error.message,
      { error_code: error.code }
    );
  }

  if (error instanceof McpError) {
    return error;
  }

  return new McpError(
    ErrorCode.InternalError,
    error instanceof Error ? error.message : String(error)
  );
}

function loadCommittedMadr(db: Database.Database, lastInsertRowid: number | bigint): StoredMadr {
  const row = db.prepare(`
    SELECT seq, id, generation_id, timestamp, status, title, context_and_problem,
           decision_drivers, considered_options, decision_outcome, supersedes_madr
    FROM pythia_memories
    WHERE seq = ?
  `).get(lastInsertRowid) as StoredMadr | undefined;

  if (row === undefined) {
    throw new Error(`Committed MADR ${String(lastInsertRowid)} could not be reloaded`);
  }

  return row;
}

export function createCommitDecisionHandler(
  db: Database.Database,
  config: Pick<PythiaConfig, "obsidian_vault_path" | "workspace_path">,
  dependencies: CommitDecisionDependencies = {}
) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const writer = dependencies.writer ?? new ObsidianWriter();
  const retryQueue = dependencies.retryQueue ?? new ObsidianRetryQueue(config.workspace_path);

  return async ({
    session_id,
    title,
    problem,
    drivers,
    options,
    decision,
    impacts_files,
    supersedes_madr
  }: {
    decision: string;
    drivers: string[];
    impacts_files: string[];
    options: string[];
    problem: string;
    session_id: string;
    supersedes_madr?: string;
    title: string;
  }) => {
    try {
      const session = getSessionById(session_id, db);

      if (session === undefined) {
        throw new PythiaError("SESSION_NOT_FOUND", session_id);
      }

      let transactionActive = false;
      let madr: StoredMadr;

      beginImmediate(db);
      transactionActive = true;

      try {
        if (supersedes_madr !== undefined) {
          db.prepare(`
            UPDATE pythia_memories
            SET status = 'superseded'
            WHERE id = ?
          `).run(supersedes_madr);
        }

        const insertInfo = db.prepare(`
          INSERT INTO pythia_memories(
            generation_id,
            timestamp,
            status,
            title,
            context_and_problem,
            decision_drivers,
            considered_options,
            decision_outcome,
            supersedes_madr
          )
          VALUES (?, ?, 'accepted', ?, ?, ?, ?, ?, ?)
        `).run(
          session.generation_id,
          now(),
          title,
          problem,
          JSON.stringify(drivers),
          JSON.stringify(options),
          decision,
          supersedes_madr ?? null
        ) as InsertInfo;

        madr = loadCommittedMadr(db, insertInfo.lastInsertRowid);

        for (const impactedFile of impacts_files) {
          db.prepare(`
            INSERT INTO graph_edges(source_id, target_id, edge_type)
            VALUES (?, ?, 'IMPLEMENTS')
          `).run(madr.id, toModuleCni(impactedFile));
        }

        commit(db);
        transactionActive = false;
      } catch (error) {
        if (transactionActive) {
          rollback(db);
        }
        throw error;
      }

      if (config.obsidian_vault_path === undefined) {
        return {
          content: [{
            type: "text" as const,
            text: `${MetadataCodes.OBSIDIAN_DISABLED}\n\n${madr.id}`
          }]
        };
      }

      try {
        await writer.write(madr, config.obsidian_vault_path, impacts_files);
      } catch {
        await retryQueue.enqueue(madr, impacts_files);

        return {
          content: [{
            type: "text" as const,
            text: `${MetadataCodes.OBSIDIAN_UNAVAILABLE}\n\n${madr.id}`
          }]
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: madr.id
        }]
      };
    } catch (error) {
      throw toMcpError(error);
    }
  };
}
