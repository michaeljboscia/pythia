import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { PythiaConfig } from "../config.js";
import { createLcsInvestigateHandler, lcsInvestigateInputSchema } from "./lcs-investigate.js";

function notImplementedResult() {
  return {
    content: [{ type: "text" as const, text: "[NOT IMPLEMENTED — Sprint 4]" }]
  };
}

export function registerTools(
  server: McpServer,
  db: Database.Database,
  config: PythiaConfig
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
      inputSchema: {
        path: z.string().optional()
      }
    },
    async () => notImplementedResult()
  );

  server.registerTool(
    "spawn_oracle",
    {
      description: "Spawn a new oracle session for architectural reasoning.",
      inputSchema: {
        name: z.string()
      }
    },
    async () => notImplementedResult()
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
