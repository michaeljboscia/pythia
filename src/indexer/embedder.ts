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
