import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { PythiaConfig } from "../config.js";
import { createEmbedder } from "../indexer/embedder.js";
import type { IndexingSupervisor } from "../indexer/supervisor.js";
import { createReasoningProvider } from "../oracle/provider.js";
import { SessionReaper } from "../oracle/reaper.js";
import { apiSurfaceInputSchema, createApiSurfaceHandler } from "./api-surface.js";
import { createAskOracleHandler, askOracleInputSchema } from "./ask-oracle.js";
import { commitDecisionInputSchema, createCommitDecisionHandler } from "./commit-decision.js";
import { createCorpusHealthHandler } from "./corpus-health.js";
import { createDecommissionHandler, decommissionInputSchema } from "./decommission.js";
import { createForceIndexHandler, forceIndexInputSchema } from "./force-index.js";
import { createLcsInvestigateHandler, lcsInvestigateInputSchema } from "./lcs-investigate.js";
import { createSpawnOracleHandler, spawnOracleInputSchema } from "./spawn-oracle.js";
import { search } from "../retrieval/hybrid.js";

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
  const embedder = createEmbedder(config.embeddings, { indexingConfig: config.indexing });

  server.registerTool(
    "lcs_investigate",
    {
      description: "PURPOSE: Investigate the local code search index for semantic or structural matches.\nWHEN TO CALL: Use this first to locate relevant code before opening files or asking the oracle about implementation details.\nWHAT TO LOOK FOR IN OUTPUT: Review file paths, chunk types, and graph metadata that shows how components connect.\nCOMMON MISTAKES TO AVOID: Do not use vague one-word queries when a natural-language question or exact symbol name is available.",
      inputSchema: lcsInvestigateInputSchema
    },
    createLcsInvestigateHandler(db, {
      searchImpl: (query, intent, searchDb, limit) => search(query, intent, searchDb, limit, {
        embedQueryImpl: embedder.embedQuery
      })
    })
  );

  server.registerTool(
    "pythia_force_index",
    {
      description: "PURPOSE: Force a file, directory, or full workspace scan into the local code search index.\nWHEN TO CALL: Use this after code changes, ignore-file updates, or a stale corpus health report that requires reindexing.\nWHAT TO LOOK FOR IN OUTPUT: Confirm the target scope was accepted and watch for any indexing failures or follow-up warnings.\nCOMMON MISTAKES TO AVOID: Do not assume this fixes ignore-file changes retroactively unless you reindex the affected files.",
      inputSchema: forceIndexInputSchema
    },
    createForceIndexHandler(db, config, {
      embedChunksImpl: embedder.embedChunks
    }, supervisor)
  );

  server.registerTool(
    "spawn_oracle",
    {
      description: "PURPOSE: Spawn a new oracle session for architectural reasoning and durable decision support.\nWHEN TO CALL: Use this when a task needs multi-turn architecture memory instead of a single code-search response.\nWHAT TO LOOK FOR IN OUTPUT: Capture the returned session identifiers and session status so follow-up oracle calls target the right session.\nCOMMON MISTAKES TO AVOID: Do not call this repeatedly for the same session name without checking whether an active session already exists.",
      inputSchema: spawnOracleInputSchema
    },
    createSpawnOracleHandler(db)
  );

  server.registerTool(
    "ask_oracle",
    {
      description: "PURPOSE: Send a question to an active oracle session.\nWHEN TO CALL: Use this after spawning or attaching to an oracle when you need synthesis, tradeoff analysis, or durable architectural context.\nWHAT TO LOOK FOR IN OUTPUT: Read the answer and any returned metadata that indicates session state, context limits, or reconstitution behavior.\nCOMMON MISTAKES TO AVOID: Do not call this without a valid active session id or with raw code-search questions better handled by lcs_investigate.",
      inputSchema: askOracleInputSchema
    },
    createAskOracleHandler(db, config, reasoningProvider, sessionReaper)
  );

  server.registerTool(
    "oracle_commit_decision",
    {
      description: "PURPOSE: Commit an oracle decision to durable architectural memory.\nWHEN TO CALL: Use this only after a decision is settled and should be preserved as a MADR-style record.\nWHAT TO LOOK FOR IN OUTPUT: Confirm the decision was persisted and note the created memory identifier for future references.\nCOMMON MISTAKES TO AVOID: Do not call this twice for the same decision unless you explicitly want duplicate memory records.",
      inputSchema: commitDecisionInputSchema
    },
    createCommitDecisionHandler(db, config)
  );

  server.registerTool(
    "oracle_decommission",
    {
      description: "PURPOSE: Decommission an oracle session and persist its final state.\nWHEN TO CALL: Use this when a session should be permanently closed instead of left idle for later reuse.\nWHAT TO LOOK FOR IN OUTPUT: Confirm the session transitioned to a decommissioned state and that cleanup completed without transcript loss.\nCOMMON MISTAKES TO AVOID: Do not run this on a session you still need for follow-up questions because the action is destructive to its active lifecycle.",
      inputSchema: decommissionInputSchema
    },
    createDecommissionHandler(db)
  );

  server.registerTool(
    "pythia_api_surface",
    {
      description: "PURPOSE: Extract the public API surface from source files.\nWHEN TO CALL: Use this when you need signatures, exports, or declaration skeletons without reading full file bodies.\nWHAT TO LOOK FOR IN OUTPUT: Review the emitted signature text and note which extraction strategy was used for each file.\nCOMMON MISTAKES TO AVOID: Do not treat the result as executable source because non-TypeScript languages return a reduced signature skeleton.",
      inputSchema: apiSurfaceInputSchema
    },
    createApiSurfaceHandler()
  );

  server.registerTool(
    "pythia_corpus_health",
    {
      description: "PURPOSE: Report corpus health statistics for the current workspace index.\nWHEN TO CALL: Use this after initialization, reindexing, or retrieval-quality issues to check whether the corpus is empty, noisy, or healthy.\nWHAT TO LOOK FOR IN OUTPUT: Review the verdict, reason, chunk counts, and top path prefixes to spot missing ignores or low-quality indexing.\nCOMMON MISTAKES TO AVOID: Do not assume a newly updated .pythiaignore changes the report until the workspace has been reindexed.",
      inputSchema: {}
    },
    createCorpusHealthHandler(db)
  );
}
