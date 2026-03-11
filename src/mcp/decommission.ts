import type Database from "better-sqlite3";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { argon2Verify } from "hash-wasm";
import { z } from "zod";

import { PythiaError } from "../errors.js";

export const decommissionInputSchema = {
  session_id: z.string(),
  decommission_secret: z.string().length(32)
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

async function verifyDecommissionSecret(
  providedSecret: string,
  storedHash: string
): Promise<boolean> {
  try {
    return await argon2Verify({
      password: providedSecret,
      hash: storedHash
    });
  } catch {
    return false;
  }
}

function toMcpError(error: unknown): McpError {
  if (error instanceof PythiaError) {
    return new McpError(
      ErrorCode.InvalidRequest,
      error.message,
      { error_code: error.code }
    );
  }

  return error instanceof McpError
    ? error
    : new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : String(error));
}

export function createDecommissionHandler(db: Database.Database) {
  return async ({
    session_id,
    decommission_secret
  }: {
    decommission_secret: string;
    session_id: string;
  }) => {
    try {
      const session = db.prepare(`
        SELECT name, secret_hash
        FROM pythia_sessions
        WHERE id = ?
          AND status != 'decommissioned'
      `).get(session_id) as { name: string; secret_hash: string | null } | undefined;

      if (session === undefined || session.secret_hash === null) {
        throw new PythiaError("SESSION_NOT_FOUND", session_id);
      }

      const valid = await verifyDecommissionSecret(decommission_secret, session.secret_hash);

      if (!valid) {
        throw new PythiaError("DECOMMISSION_DENIED", session_id);
      }

      let transactionActive = false;
      beginImmediate(db);
      transactionActive = true;

      try {
        db.prepare("DELETE FROM pythia_transcripts WHERE session_id = ?").run(session_id);
        db.prepare(`
          UPDATE pythia_sessions
          SET status = 'decommissioned',
              secret_hash = NULL,
              session_secret = NULL
          WHERE id = ?
        `).run(session_id);
        commit(db);
        transactionActive = false;
      } catch (error) {
        if (transactionActive) {
          rollback(db);
        }
        throw error;
      }

      return {
        content: [{
          type: "text" as const,
          text: `Decommissioned session ${session_id}.`
        }]
      };
    } catch (error) {
      throw toMcpError(error);
    }
  };
}
