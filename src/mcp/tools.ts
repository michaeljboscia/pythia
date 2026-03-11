import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { PythiaConfig } from "../config.js";
import type { IndexingSupervisor } from "../indexer/supervisor.js";
import { createForceIndexHandler, forceIndexInputSchema } from "./force-index.js";
import { createLcsInvestigateHandler, lcsInvestigateInputSchema } from "./lcs-investigate.js";
import { createSpawnOracleHandler, spawnOracleInputSchema } from "./spawn-oracle.js";

function notImplementedResult() {
  return {
    content: [{ type: "text" as const, text: "[NOT IMPLEMENTED — Sprint 4]" }]
  };
}

export function registerTools(
  server: McpServer,
  db: Database.Database,
  config: PythiaConfig,
  supervisor?: IndexingSupervisor
): void {
  server.registerTool(
    "lcs_investigate",
    {
      description: "Investigate the local code search index for semantic or structural matches.",
      inputSchema: lcsInvestigateInputSchema
    },
    createLcsInvestigateHandler(db)
  );

  server.registerTool(
    "pythia_force_index",
    {
      description: "Force a file, directory, or full workspace scan into the local code search index.",
      inputSchema: forceIndexInputSchema
    },
    createForceIndexHandler(db, config, {}, supervisor)
  );

  server.registerTool(
    "spawn_oracle",
    {
      description: "Spawn a new oracle session for architectural reasoning.",
      inputSchema: spawnOracleInputSchema
    },
    createSpawnOracleHandler(db)
  );

  server.registerTool(
    "ask_oracle",
    {
      description: "Send a question to an active oracle session.",
      inputSchema: {
        session_id: z.string(),
        prompt: z.string()
      }
    },
    async () => notImplementedResult()
  );

  server.registerTool(
    "oracle_commit_decision",
    {
      description: "Commit an oracle decision to durable architectural memory.",
      inputSchema: {
        session_id: z.string(),
        title: z.string()
      }
    },
    async () => notImplementedResult()
  );

  server.registerTool(
    "oracle_decommission",
    {
      description: "Decommission an oracle session and persist its final state.",
      inputSchema: {
        session_id: z.string()
      }
    },
    async () => notImplementedResult()
  );
}
