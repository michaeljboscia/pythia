export const ErrorCodes = {
  AUTH_INVALID: { code: -32010, message: "Authentication failed" },
  CONFIG_INVALID: { code: -32011, message: "Configuration invalid" },
  SESSION_ALREADY_ACTIVE: { code: -32020, message: "A session is already active" },
  SESSION_BUSY: { code: -32021, message: "Session queue full" },
  SESSION_NOT_FOUND: { code: -32022, message: "Session not found" },
  PROVIDER_UNAVAILABLE: { code: -32040, message: "Reasoning provider unavailable" },
  CONTEXT_BUDGET_EXCEEDED: { code: -32041, message: "Context budget exceeded" },
  INVALID_GRAPH_ENDPOINT: { code: -32060, message: "Invalid graph endpoint" },
  INDEX_BATCH_FAILED: { code: -32061, message: "Index batch failed" },
  FULL_REINDEX_REQUIRED: { code: -32062, message: "Full reindex required" },
  INVALID_PATH: { code: -32063, message: "Path is invalid or outside workspace" }
} as const;

export const MetadataCodes = {
  OBSIDIAN_DISABLED: "[METADATA: OBSIDIAN_DISABLED]",
  OBSIDIAN_UNAVAILABLE: "[METADATA: OBSIDIAN_UNAVAILABLE]",
  INDEX_ALREADY_RUNNING: "[STATUS: INDEX_MERGED]",
  RERANKER_UNAVAILABLE: "[METADATA: RERANKER_UNAVAILABLE]",
  VECTOR_INDEX_STALE: "[METADATA: VECTOR_INDEX_STALE]",
  SLOW_PATH_DEGRADED: "[METADATA: SLOW_PATH_DEGRADED]",
  INDEX_EMPTY: "[METADATA: INDEX_EMPTY]",
  NO_MATCH: "[METADATA: NO_MATCH]"
} as const;

export type ErrorCodeKey = keyof typeof ErrorCodes;

export class PythiaError extends Error {
  readonly code: ErrorCodeKey;
  readonly rpcCode: number;

  constructor(code: ErrorCodeKey, detail?: string) {
    const registryEntry = ErrorCodes[code];
    super(detail === undefined ? registryEntry.message : `${registryEntry.message}: ${detail}`);
    this.name = "PythiaError";
    this.code = code;
    this.rpcCode = registryEntry.code;
  }
}
