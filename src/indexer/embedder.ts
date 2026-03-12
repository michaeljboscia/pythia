import { homedir } from "node:os";
import path from "node:path";

import { env, pipeline } from "@huggingface/transformers";

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

let pipelinePromise: Promise<unknown> | null = null;

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

function truncateAndNormalize(flatEmbeddings: Float32Array, dimensionsPerEmbedding: number): Float32Array[] {
  const truncatedDimensions = 256;
  const embeddingCount = flatEmbeddings.length / dimensionsPerEmbedding;
  const embeddings: Float32Array[] = [];

  for (let index = 0; index < embeddingCount; index += 1) {
    const start = index * dimensionsPerEmbedding;
    const truncated = flatEmbeddings.slice(start, start + truncatedDimensions);
    embeddings.push(normalizeVector(truncated));
  }

  return embeddings;
}

async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const embedder = await getEmbedder();
  const output = await embedder(texts, {
    normalize: true,
    pooling: "mean"
  });

  const dimensionsPerEmbedding = output.dims[1];

  if (dimensionsPerEmbedding < 256) {
    throw new Error(`Embedding dimension ${dimensionsPerEmbedding} is smaller than 256`);
  }

  return truncateAndNormalize(output.data, dimensionsPerEmbedding);
}

export async function warmEmbedder(): Promise<void> {
  await getEmbedder();
}

export async function embedChunks(texts: string[]): Promise<Float32Array[]> {
  return embedTexts(texts.map((text) => `search_document: ${text}`));
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const [embedding] = await embedTexts([`search_query: ${text}`]);
  return embedding;
}

// ─── Factory API ──────────────────────────────────────────────────────────────

export type EmbeddingsBackendConfig =
  | { mode: "local" }
  | { mode: "openai_compatible"; base_url: string; api_key: string; model: string }
  | { mode: "vertex_ai"; project: string; location: string; model: string };

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

async function httpEmbedTexts(
  config: { base_url: string; api_key: string; model: string },
  texts: string[]
): Promise<Float32Array[]> {
  const response = await fetch(`${config.base_url}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.api_key}`
    },
    body: JSON.stringify({ model: config.model, input: texts })
  });

  if (!response.ok) {
    throw new Error(`HTTP embeddings request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as OpenAiEmbeddingsResponse;

  // Sort by index — the API does not guarantee response order matches input order
  const sorted = [...json.data].sort((a, b) => a.index - b.index);

  return sorted.map(({ embedding }) => {
    const full = new Float32Array(embedding);

    if (full.length < 256) {
      throw new Error(`HTTP embedding dimension ${full.length} is smaller than 256`);
    }

    // Apply same 256d Matryoshka truncation + L2 normalize as local backend
    return normalizeVector(full.slice(0, 256));
  });
}

async function getVertexToken(): Promise<string> {
  // Test escape hatch — set this env var in tests to bypass real ADC
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

async function vertexEmbedTexts(
  config: { project: string; location: string; model: string },
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  endpointOverride?: string
): Promise<Float32Array[]> {
  const token = await getVertexToken();

  const endpoint = endpointOverride ??
    `https://${config.location}-aiplatform.googleapis.com/v1` +
    `/projects/${config.project}/locations/${config.location}` +
    `/publishers/google/models/${config.model}:predict`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      instances: texts.map((text) => ({ content: text, task_type: taskType })),
      parameters: { outputDimensionality: 256 }
    })
  });

  if (!response.ok) {
    throw new Error(`Vertex AI embeddings request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as VertexAiEmbeddingsResponse;

  // Vertex AI returns embeddings in the same order as instances — no sorting needed
  return json.predictions.map(({ embeddings }) => {
    const vec = new Float32Array(embeddings.values);

    if (vec.length < 256) {
      throw new Error(`Vertex AI embedding dimension ${vec.length} is smaller than 256`);
    }

    // Normalize even though Vertex AI claims to return unit vectors — floating point safety
    return normalizeVector(vec.length === 256 ? vec : vec.slice(0, 256));
  });
}

type CreateEmbedderOptions = {
  vertexEndpointOverride?: string;
};

export function createEmbedder(config: EmbeddingsBackendConfig, options: CreateEmbedderOptions = {}): Embedder {
  if (config.mode === "local") {
    return {
      embedChunks,
      embedQuery,
      warm: warmEmbedder
    };
  }

  if (config.mode === "openai_compatible") {
    const httpConfig = config;

    return {
      embedChunks: (texts) =>
        httpEmbedTexts(httpConfig, texts.map((t) => `search_document: ${t}`)),

      embedQuery: async (text) => {
        const [embedding] = await httpEmbedTexts(httpConfig, [`search_query: ${text}`]);
        return embedding;
      },

      warm: async () => {
        await httpEmbedTexts(httpConfig, ["warm"]);
      }
    };
  }

  // vertex_ai
  const vertexConfig = config;
  const { vertexEndpointOverride } = options;

  return {
    embedChunks: (texts) =>
      vertexEmbedTexts(vertexConfig, texts, "RETRIEVAL_DOCUMENT", vertexEndpointOverride),

    embedQuery: async (text) => {
      const [embedding] = await vertexEmbedTexts(vertexConfig, [text], "RETRIEVAL_QUERY", vertexEndpointOverride);
      return embedding;
    },

    warm: async () => {
      await vertexEmbedTexts(vertexConfig, ["warm"], "RETRIEVAL_DOCUMENT", vertexEndpointOverride);
    }
  };
}
