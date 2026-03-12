import type Database from "better-sqlite3";

import type { EmbeddingsBackendConfig } from "../indexer/embedder.js";
import { PythiaError } from "../errors.js";

type EmbeddingMetaRow = {
  provider: string;
  model_name: string;
  model_revision: string;
  dimensions: number;
  normalization: string;
  indexed_at: string;
};

function configToFingerprint(config: EmbeddingsBackendConfig): Omit<EmbeddingMetaRow, "indexed_at"> {
  if (config.mode === "local") {
    return {
      provider: "local",
      model_name: "nomic-ai/nomic-embed-text-v1.5",
      model_revision: "fp32",
      dimensions: 256,
      normalization: "l2"
    };
  }

  if (config.mode === "openai_compatible") {
    return {
      provider: "openai_compatible",
      model_name: config.model,
      model_revision: config.base_url,
      dimensions: 256,
      normalization: "l2"
    };
  }

  // vertex_ai — fingerprint includes project+location+model to uniquely identify the endpoint
  return {
    provider: "vertex_ai",
    model_name: `${config.project}/${config.location}/${config.model}`,
    model_revision: "",
    dimensions: 256,
    normalization: "l2"
  };
}

export function readEmbeddingMeta(db: Database.Database): EmbeddingMetaRow | null {
  return (db.prepare("SELECT * FROM embedding_meta WHERE id = 1").get() as EmbeddingMetaRow | undefined) ?? null;
}

export function writeEmbeddingMetaOnce(db: Database.Database, config: EmbeddingsBackendConfig): void {
  const fp = configToFingerprint(config);

  db.prepare(`
    INSERT OR IGNORE INTO embedding_meta(id, provider, model_name, model_revision, dimensions, normalization, indexed_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(fp.provider, fp.model_name, fp.model_revision, fp.dimensions, fp.normalization, new Date().toISOString());
}

export function assertEmbeddingMetaCompatible(db: Database.Database, config: EmbeddingsBackendConfig): void {
  const meta = readEmbeddingMeta(db);

  if (meta === null) {
    return;
  }

  const fp = configToFingerprint(config);

  if (meta.provider !== fp.provider || meta.model_name !== fp.model_name) {
    throw new PythiaError(
      "FULL_REINDEX_REQUIRED",
      `Stored embeddings used provider="${meta.provider}" model="${meta.model_name}" ` +
      `but current config specifies provider="${fp.provider}" model="${fp.model_name}". ` +
      `Delete <workspace>/.pythia/lcs.db and run 'pythia init' to re-index with the new backend.`
    );
  }
}
