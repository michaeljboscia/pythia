import type Database from "better-sqlite3";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { PythiaError } from "../errors.js";
import { spawnOracleSession } from "../oracle/session.js";

type SpawnOracleSessionFn = typeof spawnOracleSession;

export const spawnOracleInputSchema = {
  name: z.string().min(1)
};

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

export function createSpawnOracleHandler(
  db: Database.Database,
  dependencies: { spawnOracleSessionImpl?: SpawnOracleSessionFn } = {}
) {
  const spawnOracleSessionImpl = dependencies.spawnOracleSessionImpl ?? spawnOracleSession;

  return async ({ name }: { name: string }) => {
    try {
      const result = await spawnOracleSessionImpl(name, db);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result)
        }]
      };
    } catch (error) {
      throw toMcpError(error);
    }
  };
}
