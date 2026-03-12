import { homedir } from "node:os";
import path from "node:path";

import { env, pipeline } from "@huggingface/transformers";
import pLimit from "p-limit";

import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_CONCURRENCY,
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  type PythiaIndexingConfig
} from "../config.js";
import { PythiaError } from "../errors.js";

env.cacheDir = path.join(homedir(), ".pythia", "models");

type EmbeddingTensor = {
  data: Float32Array;
  dims: number[];
};

type FeatureExtractionPipeline = (
  texts: string[],
  options: {
    normalize: true;
    pooling: "mean";
  }
) => Promise<EmbeddingTensor>;

type RetrySettings = Pick<
  PythiaIndexingConfig,
  "embedding_batch_size" | "embedding_concurrency" | "retry_max_attempts" | "initial_backoff_ms" | "honor_retry_after"
>;

type HttpConfig = {
  base_url: string;
  api_key: string;
  model: string;
};

type VertexConfig = {
  project: string;
  location: string;
  model: string;
};

let pipelinePromise: Promise<unknown> | null = null;
let localConcurrencyWarningEmitted = false;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise === null) {
    pipelinePromise = pipeline("feature-extraction", "nomic-ai/nomic-embed-text-v1.5", {
      dtype: "fp32"
    });
  }

  return await pipelinePromise as FeatureExtractionPipeline;
}

function normalizeVector(vector: Float32Array): Float32Array {
  let sumOfSquares = 0;

  for (const value of vector) {
    sumOfSquares += value * value;
  }

  const magnitude = Math.sqrt(sumOfSquares);

  if (magnitude === 0) {
    return vector;
  }

  const normalized = new Float32Array(vector.length);

  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / magnitude;
  }

  return normalized;
}

function dimensionMismatchError(actualDimensions: number, targetDimensions: number): PythiaError {
  return new PythiaError(
    "DIMENSION_MISMATCH",
    `Model returned ${actualDimensions}d but dimensions: ${targetDimensions}d is configured. ` +
    "Lower dimensions or use a higher-dimensional model."
  );
}

function resolveDimensions(config: EmbeddingsBackendConfig): number {
  return config.dimensions ?? 256;
}

function validateLocalDimensions(config: EmbeddingsBackendConfig): void {
  if (config.mode !== "local") {
    return;
  }

  if (resolveDimensions(config) > 768) {
    throw new Error(
      "nomic-embed-text-v1.5 max output is 768d. Set dimensions <= 768 or switch " +
      "to openai_compatible/vertex_ai mode."
    );
  }
}

function truncateAndNormalize(
  flatEmbeddings: Float32Array,
  dimensionsPerEmbedding: number,
  targetDimensions: number
): Float32Array[] {
  if (dimensionsPerEmbedding < targetDimensions) {
    throw dimensionMismatchError(dimensionsPerEmbedding, targetDimensions);
  }

  const embeddingCount = flatEmbeddings.length / dimensionsPerEmbedding;
  const embeddings: Float32Array[] = [];

  for (let index = 0; index < embeddingCount; index += 1) {
    const start = index * dimensionsPerEmbedding;
    const truncated = flatEmbeddings.slice(start, start + targetDimensions);
    embeddings.push(normalizeVector(truncated));
  }

  return embeddings;
}

async function localEmbedTexts(texts: string[], targetDimensions: number): Promise<Float32Array[]> {
  const embedder = await getEmbedder();
  const output = await embedder(texts, {
    normalize: true,
    pooling: "mean"
  });

  return truncateAndNormalize(output.data, output.dims[1], targetDimensions);
}

function resolveRetrySettings(indexingConfig?: Partial<RetrySettings>): RetrySettings {
  return {
    embedding_batch_size: indexingConfig?.embedding_batch_size ?? DEFAULT_EMBEDDING_BATCH_SIZE,
    embedding_concurrency: indexingConfig?.embedding_concurrency ?? DEFAULT_EMBEDDING_CONCURRENCY,
    retry_max_attempts: indexingConfig?.retry_max_attempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
    initial_backoff_ms: indexingConfig?.initial_backoff_ms ?? DEFAULT_INITIAL_BACKOFF_MS,
    honor_retry_after: indexingConfig?.honor_retry_after ?? true
  };
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function splitIntoBatches<T>(values: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }

  return batches;
}

function retryDelayMs(
  attempt: number,
  settings: RetrySettings,
  retryAfterHeader?: string | null
): number {
  if (settings.honor_retry_after) {
    const retryAfter = parseRetryAfter(retryAfterHeader ?? null);

    if (retryAfter !== null) {
      return retryAfter;
    }
  }

  return Math.min(settings.initial_backoff_ms * (2 ** attempt), 30_000);
}

export function parseRetryAfter(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }

  const trimmed = raw.trim();

  if (/^\d+$/u.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  const parsedDate = Date.parse(trimmed);

  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return Math.max(parsedDate - Date.now(), 0);
}

async function requestWithRetries(
  requestFactory: () => Promise<Response>,
  settings: RetrySettings
): Promise<Response> {
  for (let attempt = 0; attempt < settings.retry_max_attempts; attempt += 1) {
    try {
      const response = await requestFactory();

      if (response.status === 429) {
        if (attempt === settings.retry_max_attempts - 1) {
          throw new Error(`HTTP embeddings request failed: ${response.status} ${response.statusText}`);
        }

        await sleep(retryDelayMs(attempt, settings, response.headers.get("Retry-After")));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP embeddings request failed: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (attempt === settings.retry_max_attempts - 1) {
        throw error;
      }

      await sleep(retryDelayMs(attempt, settings));
    }
  }

  throw new Error("Embeddings request exhausted retries");
}

function normalizeHttpVector(values: number[], targetDimensions: number): Float32Array {
  const full = new Float32Array(values);

  if (full.length < targetDimensions) {
    throw dimensionMismatchError(full.length, targetDimensions);
  }

  return normalizeVector(full.slice(0, targetDimensions));
}

async function httpEmbedBatch(
  config: HttpConfig,
  texts: string[],
  targetDimensions: number,
  settings: RetrySettings,
  fetchImpl: typeof fetch
): Promise<Float32Array[]> {
  const response = await requestWithRetries(
    () => fetchImpl(`${config.base_url}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.api_key}`
      },
      body: JSON.stringify({ model: config.model, input: texts })
    }),
    settings
  );

  const json = await response.json() as OpenAiEmbeddingsResponse;
  const sorted = [...json.data].sort((a, b) => a.index - b.index);

  return sorted.map(({ embedding }) => normalizeHttpVector(embedding, targetDimensions));
}

async function getVertexToken(): Promise<string> {
  if (process.env.PYTHIA_TEST_VERTEX_TOKEN !== undefined) {
    return process.env.PYTHIA_TEST_VERTEX_TOKEN;
  }

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();

  if (token == null) {
    throw new Error(
      "Failed to obtain Google auth token. Run `gcloud auth application-default login` " +
      "or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file."
    );
  }

  return token;
}

async function vertexEmbedBatch(
  config: VertexConfig,
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  targetDimensions: number,
  settings: RetrySettings,
  fetchImpl: typeof fetch,
  endpointOverride?: string
): Promise<Float32Array[]> {
  const token = await getVertexToken();
  const endpoint = endpointOverride ??
    `https://${config.location}-aiplatform.googleapis.com/v1` +
    `/projects/${config.project}/locations/${config.location}` +
    `/publishers/google/models/${config.model}:predict`;

  const response = await requestWithRetries(
    () => fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        instances: texts.map((text) => ({ content: text, task_type: taskType })),
        parameters: { outputDimensionality: targetDimensions }
      })
    }),
    settings
  );

  const json = await response.json() as VertexAiEmbeddingsResponse;

  return json.predictions.map(({ embeddings }) => normalizeHttpVector(embeddings.values, targetDimensions));
}

async function embedInParallel(
  texts: string[],
  settings: RetrySettings,
  batcher: (batch: string[]) => Promise<Float32Array[]>
): Promise<Float32Array[]> {
  if (texts.length === 0) {
    return [];
  }

  const batches = splitIntoBatches(texts, settings.embedding_batch_size);
  const limiter = pLimit(settings.embedding_concurrency);
  const cache = new Map<number, Float32Array[]>();

  await Promise.all(batches.map((batch, index) => limiter(async () => {
    if (!cache.has(index)) {
      cache.set(index, await batcher(batch));
    }
  })));

  return batches.flatMap((_, index) => cache.get(index) ?? []);
}

async function warmLocalEmbedder(targetDimensions: number): Promise<void> {
  await localEmbedTexts(["warm"], targetDimensions);
}

export async function warmEmbedder(): Promise<void> {
  await warmLocalEmbedder(256);
}

export async function embedChunks(texts: string[]): Promise<Float32Array[]> {
  return localEmbedTexts(texts.map((text) => `search_document: ${text}`), 256);
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const [embedding] = await localEmbedTexts([`search_query: ${text}`], 256);
  return embedding;
}

export type EmbeddingsBackendConfig =
  | { mode: "local"; dimensions?: 128 | 256 | 512 | 768 | 1024 | 1536 }
  | { mode: "openai_compatible"; dimensions?: 128 | 256 | 512 | 768 | 1024 | 1536; base_url: string; api_key: string; model: string }
  | { mode: "vertex_ai"; dimensions?: 128 | 256 | 512 | 768 | 1024 | 1536; project: string; location: string; model: string };

export type Embedder = {
  embedChunks: (texts: string[]) => Promise<Float32Array[]>;
  embedQuery: (text: string) => Promise<Float32Array>;
  warm: () => Promise<void>;
};

type OpenAiEmbeddingsResponse = {
  data: { index: number; embedding: number[] }[];
};

type VertexAiEmbeddingsResponse = {
  predictions: { embeddings: { values: number[] } }[];
};

type CreateEmbedderOptions = {
  fetchImpl?: typeof fetch;
  indexingConfig?: Partial<RetrySettings>;
  vertexEndpointOverride?: string;
  warnImpl?: (message: string) => void;
};

export function createEmbedder(config: EmbeddingsBackendConfig, options: CreateEmbedderOptions = {}): Embedder {
  validateLocalDimensions(config);

  const fetchImpl = options.fetchImpl ?? fetch;
  const settings = resolveRetrySettings(options.indexingConfig);
  const targetDimensions = resolveDimensions(config);
  const warnImpl = options.warnImpl ?? ((message: string) => {
    console.warn(message);
  });

  if (config.mode === "local") {
    if (settings.embedding_concurrency > 1 && !localConcurrencyWarningEmitted) {
      localConcurrencyWarningEmitted = true;
      warnImpl("Local embeddings backend ignores embedding_concurrency > 1; clamping to 1.");
    }

    return {
      embedChunks: (texts) => localEmbedTexts(texts.map((text) => `search_document: ${text}`), targetDimensions),
      embedQuery: async (text) => {
        const [embedding] = await localEmbedTexts([`search_query: ${text}`], targetDimensions);
        return embedding;
      },
      warm: async () => {
        await warmLocalEmbedder(targetDimensions);
      }
    };
  }

  if (config.mode === "openai_compatible") {
    const httpConfig = config;

    return {
      embedChunks: (texts) => embedInParallel(
        texts.map((text) => `search_document: ${text}`),
        settings,
        (batch) => httpEmbedBatch(httpConfig, batch, targetDimensions, settings, fetchImpl)
      ),
      embedQuery: async (text) => {
        const [embedding] = await httpEmbedBatch(
          httpConfig,
          [`search_query: ${text}`],
          targetDimensions,
          settings,
          fetchImpl
        );
        return embedding;
      },
      warm: async () => {
        await httpEmbedBatch(httpConfig, ["warm"], targetDimensions, settings, fetchImpl);
      }
    };
  }

  const vertexConfig = config;
  const { vertexEndpointOverride } = options;

  return {
    embedChunks: (texts) => embedInParallel(
      texts,
      settings,
      (batch) => vertexEmbedBatch(
        vertexConfig,
        batch,
        "RETRIEVAL_DOCUMENT",
        targetDimensions,
        settings,
        fetchImpl,
        vertexEndpointOverride
      )
    ),
    embedQuery: async (text) => {
      const [embedding] = await vertexEmbedBatch(
        vertexConfig,
        [text],
        "RETRIEVAL_QUERY",
        targetDimensions,
        settings,
        fetchImpl,
        vertexEndpointOverride
      );
      return embedding;
    },
    warm: async () => {
      await vertexEmbedBatch(
        vertexConfig,
        ["warm"],
        "RETRIEVAL_DOCUMENT",
        targetDimensions,
        settings,
        fetchImpl,
        vertexEndpointOverride
      );
    }
  };
}
