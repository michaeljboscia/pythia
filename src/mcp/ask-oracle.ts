import type Database from "better-sqlite3";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { PythiaConfig } from "../config.js";
import { PythiaError } from "../errors.js";
import { search } from "../retrieval/hybrid.js";
import type { SearchResult } from "../retrieval/hybrid.js";
import type { ReasoningProvider } from "../oracle/provider.js";
import { SessionReaper } from "../oracle/reaper.js";
import {
  appendTranscriptTurn,
  ensureSessionActive,
  listTranscriptRows,
  type SessionRow,
  touchSession
} from "../oracle/session.js";

type EnsureSessionActiveFn = typeof ensureSessionActive;
type SearchFn = typeof search;

type AskOracleDependencies = {
  ensureSessionActiveImpl?: EnsureSessionActiveFn;
  now?: () => string;
  searchImpl?: SearchFn;
};

type SessionQueueState = {
  depth: number;
  tail: Promise<void>;
};

const MAX_SESSION_QUEUE_DEPTH = 5;
const ORACLE_PREAMBLE = [
  "You are Pythia, the architectural oracle for this repository.",
  "Use the provided repository context and prior transcript when answering.",
  "Be concise, concrete, and decision-oriented."
].join("\n");
const sessionQueues = new Map<string, SessionQueueState>();

export const askOracleInputSchema = {
  session_id: z.string(),
  prompt: z.string()
};

function formatContextBlocks(results: SearchResult[], rerankerUsed: boolean): string {
  const blocks = results.map((result, index) => (
    `--- CHUNK ${index + 1} score=${result.score.toFixed(4)}\n`
    + `PATH: ${result.file_path}\n`
    + `CNI: ${result.id}\n`
    + `TYPE: ${result.chunk_type}\n`
    + `LINES: ${result.start_line}-${result.end_line}\n`
    + `\`\`\`${result.language}\n`
    + `${result.content}\n`
    + "```"
  ));

  if (!rerankerUsed && results.length > 0) {
    blocks.push("[METADATA: RERANKER_UNAVAILABLE]");
  }

  return blocks.join("\n\n");
}

function renderTranscriptRow(row: { role: string; content: string }): string {
  try {
    const parsed = JSON.parse(row.content) as { text?: string; kind?: string };

    if (typeof parsed.text === "string") {
      return `${row.role}: ${parsed.text}`;
    }

    if (typeof parsed.kind === "string") {
      return `${row.role}: ${parsed.kind}`;
    }
  } catch {
    return `${row.role}: ${row.content}`;
  }

  return `${row.role}: ${row.content}`;
}

async function buildContext(
  sessionId: string,
  prompt: string,
  db: Database.Database,
  config: Pick<PythiaConfig, "limits">,
  searchImpl: SearchFn
): Promise<string[]> {
  const transcriptRows = listTranscriptRows(sessionId, db);
  const retrieval = await searchImpl(prompt, "semantic", db, 8);
  const retrievalContext = retrieval.results.length === 0
    ? []
    : [formatContextBlocks(retrieval.results, retrieval.rerankerUsed)];
  const transcriptContext = transcriptRows.map(renderTranscriptRow);
  const contextBudget = config.limits.ask_context_chars_max;
  let trimmedTranscript = [...transcriptContext];

  while (trimmedTranscript.length > 0) {
    const totalChars = [ORACLE_PREAMBLE, ...retrievalContext, ...trimmedTranscript]
      .reduce((sum, part) => sum + part.length, 0);

    if (totalChars <= contextBudget) {
      return [ORACLE_PREAMBLE, ...retrievalContext, ...trimmedTranscript];
    }

    trimmedTranscript = trimmedTranscript.slice(1);
  }

  const finalChars = [ORACLE_PREAMBLE, ...retrievalContext]
    .reduce((sum, part) => sum + part.length, 0);

  if (finalChars > contextBudget) {
    throw new PythiaError("CONTEXT_BUDGET_EXCEEDED", String(contextBudget));
  }

  return [ORACLE_PREAMBLE, ...retrievalContext];
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

async function withSessionQueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const state = sessionQueues.get(sessionId) ?? {
    depth: 0,
    tail: Promise.resolve()
  };

  if (state.depth >= MAX_SESSION_QUEUE_DEPTH) {
    throw new PythiaError("SESSION_BUSY", sessionId);
  }

  state.depth += 1;
  const run = state.tail
    .catch(() => undefined)
    .then(task);
  state.tail = run
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      const current = sessionQueues.get(sessionId);

      if (current === undefined) {
        return;
      }

      current.depth -= 1;

      if (current.depth === 0) {
        sessionQueues.delete(sessionId);
      }
    });
  sessionQueues.set(sessionId, state);

  return await run;
}

export function createAskOracleHandler(
  db: Database.Database,
  config: Pick<PythiaConfig, "limits">,
  provider: ReasoningProvider,
  reaper: SessionReaper,
  dependencies: AskOracleDependencies = {}
) {
  const ensureSessionActiveImpl = dependencies.ensureSessionActiveImpl ?? ensureSessionActive;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const searchImpl = dependencies.searchImpl ?? search;

  return async ({
    session_id,
    prompt
  }: {
    prompt: string;
    session_id: string;
  }) => {
    try {
      return await withSessionQueue(session_id, async () => {
        const session = await ensureSessionActiveImpl(session_id, db);
        const userTimestamp = now();

        appendTranscriptTurn(
          session.id,
          "user",
          JSON.stringify({ text: prompt }),
          db,
          userTimestamp
        );
        touchSession(session.id, db, userTimestamp, "active");

        const context = await buildContext(session.id, prompt, db, config, searchImpl);
        const providerResponse = await provider.query(prompt, context);
        const modelTimestamp = now();

        appendTranscriptTurn(
          session.id,
          "model",
          JSON.stringify({
            text: providerResponse,
            provider: provider.constructor.name,
            model: "gemini-2.5-flash",
            finish_reason: "stop"
          }),
          db,
          modelTimestamp
        );
        touchSession(session.id, db, modelTimestamp, "active");
        reaper.touch(session.id);

        return {
          content: [{
            type: "text" as const,
            text: providerResponse
          }]
        };
      });
    } catch (error) {
      throw toMcpError(error);
    }
  };
}

export function __resetAskOracleQueuesForTests(): void {
  sessionQueues.clear();
}
