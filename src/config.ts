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

const reasoningSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("cli")
  }),
  z.object({
    mode: z.literal("sdk"),
    gemini_api_key: z.string().min(1).optional()
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
    mode: z.literal("local")
  }),
  z.object({
    mode: z.literal("openai_compatible"),
    base_url: z.string().url(),
    api_key: z.string().min(1),
    model: z.string().min(1)
  }),
  z.object({
    mode: z.literal("vertex_ai"),
    project: z.string().min(1),
    location: z.string().min(1),
    model: z.string().min(1)
  })
]);

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
  indexing: z.object({
    scan_on_start: z.boolean(),
    max_worker_restarts: z.number()
  }),
  gc: z.object({
    deleted_chunk_retention_days: z.number()
  })
});

export type PythiaConfig = z.infer<typeof configSchema>;

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
