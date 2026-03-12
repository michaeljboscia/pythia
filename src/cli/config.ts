import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { configSchema, type PythiaConfig } from "../config.js";
import { PythiaError } from "../errors.js";

type PartialConfig = Partial<{
  embeddings: Partial<PythiaConfig["embeddings"]>;
  gc: Partial<PythiaConfig["gc"]>;
  graph_store: Partial<PythiaConfig["graph_store"]>;
  indexing: Partial<PythiaConfig["indexing"]>;
  limits: Partial<PythiaConfig["limits"]>;
  obsidian_vault_path: string;
  reasoning: Partial<PythiaConfig["reasoning"]>;
  vector_store: Partial<PythiaConfig["vector_store"]>;
  workspace_path: string;
}>;

export function buildDefaultConfig(workspacePath: string): PythiaConfig {
  return configSchema.parse({
    workspace_path: path.resolve(workspacePath),
    reasoning: { mode: "cli" },
    embeddings: {
      mode: "local",
      dimensions: 256
    },
    vector_store: {
      mode: "sqlite"
    },
    graph_store: {
      mode: "sqlite"
    },
    limits: {
      spawn_chars_max: 180000,
      ask_context_chars_max: 48000,
      session_idle_ttl_minutes: 30
    },
    indexing: {
      scan_on_start: true,
      max_worker_restarts: 3,
      css_rule_chunk_min_chars: 80,
      max_chunk_chars: {
        module: 12000,
        class: 8000,
        function: 6000,
        method: 4000,
        trait: 6000,
        interface: 6000,
        rule: 2000,
        at_rule: 4000,
        element: 4000,
        doc: 12000
      },
      oversize_strategy: "split",
      embedding_concurrency: 1,
      embedding_batch_size: 32,
      retry_max_attempts: 3,
      initial_backoff_ms: 500,
      honor_retry_after: true
    },
    gc: {
      deleted_chunk_retention_days: 30
    }
  });
}

export function getDefaultConfigPath(): string {
  return path.join(homedir(), ".pythia", "config.json");
}

export function resolveCliConfig(workspacePath: string, configPath = getDefaultConfigPath()): PythiaConfig {
  const defaults = buildDefaultConfig(workspacePath);

  if (!existsSync(configPath)) {
    return defaults;
  }

  try {
    const rawConfig = JSON.parse(readFileSync(configPath, "utf8")) as PartialConfig;

    return configSchema.parse({
      ...defaults,
      ...rawConfig,
      workspace_path: path.resolve(workspacePath),
      reasoning: {
        ...defaults.reasoning,
        ...(rawConfig.reasoning ?? {})
      },
      embeddings: {
        ...defaults.embeddings,
        ...(rawConfig.embeddings ?? {})
      },
      vector_store: {
        ...defaults.vector_store,
        ...(rawConfig.vector_store ?? {})
      },
      graph_store: {
        ...defaults.graph_store,
        ...(rawConfig.graph_store ?? {})
      },
      limits: {
        ...defaults.limits,
        ...(rawConfig.limits ?? {})
      },
      indexing: {
        ...defaults.indexing,
        ...(rawConfig.indexing ?? {}),
        max_chunk_chars: {
          ...defaults.indexing.max_chunk_chars,
          ...(rawConfig.indexing?.max_chunk_chars ?? {})
        }
      },
      gc: {
        ...defaults.gc,
        ...(rawConfig.gc ?? {})
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PythiaError("CONFIG_INVALID", detail);
  }
}
