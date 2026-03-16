import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

import { PythiaError } from "./errors.js";

function absolutePath(fieldName: string) {
  return z.string().refine((value) => path.isAbsolute(value), {
    message: `${fieldName} must be an absolute path`
  });
}

const allowedEmbeddingDimensions = [128, 256, 512, 768, 1024, 1536] as const;
const embeddingDimensionsSchema = z.union(
  allowedEmbeddingDimensions.map((dimension) => z.literal(dimension)) as [
    z.ZodLiteral<128>,
    z.ZodLiteral<256>,
    z.ZodLiteral<512>,
    z.ZodLiteral<768>,
    z.ZodLiteral<1024>,
    z.ZodLiteral<1536>
  ]
);

export const DEFAULT_MAX_CHUNK_CHARS = {
  module: 12_000,
  class: 8_000,
  function: 6_000,
  method: 4_000,
  trait: 6_000,
  interface: 6_000,
  enum: 6_000,
  block: 4_000,
  rule: 2_000,
  at_rule: 4_000,
  element: 4_000,
  doc: 12_000
} as const satisfies Record<string, number>;

export const DEFAULT_CSS_RULE_CHUNK_MIN_CHARS = 80;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
export const DEFAULT_EMBEDDING_CONCURRENCY = 1;
export const DEFAULT_INITIAL_BACKOFF_MS = 500;
export const DEFAULT_OVERSIZE_STRATEGY = "split" as const;
export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;

const reasoningSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("cli")
  }),
  z.object({
    mode: z.literal("sdk"),
    gemini_api_key: z.string().min(1).optional()
  }),
  z.object({
    mode: z.literal("local"),
    ollama_base_url: z.string().url().default("http://localhost:11434"),
    ollama_model: z.string().min(1)
  })
]);

const vectorStoreSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("sqlite")
  }),
  z.object({
    mode: z.literal("qdrant"),
    qdrant_url: z.string().url()
  })
]);

const embeddingsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("local"),
    dimensions: embeddingDimensionsSchema.default(256),
    dtype: z.enum(["fp32", "q8"]).default("fp32")
  }),
  z.object({
    mode: z.literal("openai_compatible"),
    dimensions: embeddingDimensionsSchema.default(256),
    base_url: z.string().url(),
    api_key: z.string().min(1),
    model: z.string().min(1)
  }),
  z.object({
    mode: z.literal("vertex_ai"),
    dimensions: embeddingDimensionsSchema.default(256),
    project: z.string().min(1),
    location: z.string().min(1),
    model: z.string().min(1)
  })
]);

const indexingSchema = z.object({
  scan_on_start: z.boolean(),
  max_worker_restarts: z.number(),
  css_rule_chunk_min_chars: z.number().int().min(0).default(DEFAULT_CSS_RULE_CHUNK_MIN_CHARS),
  max_chunk_chars: z.record(z.string(), z.number().int().min(200).max(100_000))
    .default(DEFAULT_MAX_CHUNK_CHARS),
  oversize_strategy: z.enum(["split", "truncate"]).default(DEFAULT_OVERSIZE_STRATEGY),
  embedding_concurrency: z.number().int().min(1).max(16).default(DEFAULT_EMBEDDING_CONCURRENCY),
  embedding_batch_size: z.number().int().min(1).max(256).default(DEFAULT_EMBEDDING_BATCH_SIZE),
  retry_max_attempts: z.number().int().min(1).max(10).default(DEFAULT_RETRY_MAX_ATTEMPTS),
  initial_backoff_ms: z.number().int().min(100).max(30_000).default(DEFAULT_INITIAL_BACKOFF_MS),
  honor_retry_after: z.boolean().default(true),
  max_files: z.number().int().min(1).optional()
});

export const configSchema = z.object({
  workspace_path: absolutePath("workspace_path"),
  obsidian_vault_path: absolutePath("obsidian_vault_path").optional(),
  reasoning: reasoningSchema,
  embeddings: embeddingsSchema,
  vector_store: vectorStoreSchema,
  graph_store: z.object({
    mode: z.enum(["sqlite", "falkor"])
  }),
  limits: z.object({
    spawn_chars_max: z.number(),
    ask_context_chars_max: z.number(),
    session_idle_ttl_minutes: z.number()
  }),
  indexing: indexingSchema,
  gc: z.object({
    deleted_chunk_retention_days: z.number()
  })
});

export type PythiaConfig = z.infer<typeof configSchema>;
export type PythiaIndexingConfig = PythiaConfig["indexing"];
export type PythiaEmbeddingsConfig = PythiaConfig["embeddings"];

export function loadConfig(configPath = path.join(homedir(), ".pythia", "config.json")): PythiaConfig {
  try {
    const rawConfig = readFileSync(configPath, "utf8");
    const parsedConfig = JSON.parse(rawConfig) as unknown;
    return configSchema.parse(parsedConfig);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PythiaError("CONFIG_INVALID", detail);
  }
}
