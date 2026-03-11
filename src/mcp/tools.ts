import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { PythiaConfig } from "../config.js";
import { createEmbedder } from "../indexer/embedder.js";
import type { IndexingSupervisor } from "../indexer/supervisor.js";
import { createReasoningProvider } from "../oracle/provider.js";
import { SessionReaper } from "../oracle/reaper.js";
import { createAskOracleHandler, askOracleInputSchema } from "./ask-oracle.js";
import { commitDecisionInputSchema, createCommitDecisionHandler } from "./commit-decision.js";
import { createDecommissionHandler, decommissionInputSchema } from "./decommission.js";
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
  const reasoningProvider = createReasoningProvider(config);
  const sessionReaper = new SessionReaper(db, config.limits.session_idle_ttl_minutes);

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
    createForceIndexHandler(db, config, {
      embedChunksImpl: createEmbedder(config.embeddings).embedChunks
    }, supervisor)
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
      inputSchema: askOracleInputSchema
    },
    createAskOracleHandler(db, config, reasoningProvider, sessionReaper)
  );

  server.registerTool(
    "oracle_commit_decision",
    {
      description: "Commit an oracle decision to durable architectural memory.",
      inputSchema: commitDecisionInputSchema
    },
    createCommitDecisionHandler(db, config)
  );

  server.registerTool(
    "oracle_decommission",
    {
      description: "Decommission an oracle session and persist its final state.",
      inputSchema: decommissionInputSchema
    },
    createDecommissionHandler(db)
  );
}
