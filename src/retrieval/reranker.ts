import path from "node:path";
import { homedir } from "node:os";

import {
  AutoModelForSequenceClassification,
  AutoTokenizer
} from "@huggingface/transformers";
import type {
  PreTrainedModel,
  PreTrainedTokenizer
} from "@huggingface/transformers";

const RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";
const RERANKER_TIMEOUT_MS = 250;
const MAX_TOKEN_LENGTH = 512;

type TokenizerFn = (
  queries: string[],
  options: {
    text_pair: string[];
    padding: boolean;
    truncation: "only_second";
    max_length: number;
  }
) => unknown;

type ModelFn = (inputs: unknown) => Promise<{ logits: { data: Float32Array } }>;

type RerankerTestHooks = {
  forceReady?: boolean;
  tokenizer?: TokenizerFn;
  model?: ModelFn;
};

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let initPromise: Promise<void> | null = null;
let testHooks: RerankerTestHooks | null = null;
let testStubReady = false;

export type RerankerResult<T extends { content: string; score: number }> = {
  chunks: T[];
  rerankerUsed: boolean;
};

function getCacheDir(): string {
  return path.join(homedir(), ".pythia", "models");
}

function getTokenizer(): TokenizerFn | null {
  if (testHooks?.tokenizer !== undefined) {
    return testHooks.tokenizer;
  }

  return tokenizer as unknown as TokenizerFn | null;
}

function getModel(): ModelFn | null {
  if (testHooks?.model !== undefined) {
    return testHooks.model;
  }

  return model as unknown as ModelFn | null;
}

export async function initReranker(cacheDir: string = getCacheDir()): Promise<void> {
  if (process.env.PYTHIA_TEST_RERANKER_STUB === "1") {
    testStubReady = true;
    return;
  }

  if ((tokenizer !== null && model !== null) || (testHooks?.forceReady ?? false)) {
    return;
  }

  if (initPromise !== null) {
    return initPromise;
  }

  initPromise = Promise.all([
    AutoTokenizer.from_pretrained(RERANKER_MODEL, { cache_dir: cacheDir }),
    AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
      cache_dir: cacheDir,
      quantized: true
    } as Record<string, unknown>)
  ]).then(([resolvedTokenizer, resolvedModel]) => {
    tokenizer = resolvedTokenizer;
    model = resolvedModel;
  }).finally(() => {
    initPromise = null;
  });

  return initPromise;
}

export function isRerankerReady(): boolean {
  if (testHooks?.forceReady !== undefined) {
    return testHooks.forceReady;
  }

  if (testStubReady) {
    return true;
  }

  return tokenizer !== null && model !== null;
}

async function scorePassages(query: string, passages: string[]): Promise<number[]> {
  const tokenizerImpl = getTokenizer();
  const modelImpl = getModel();

  if (tokenizerImpl === null || modelImpl === null) {
    throw new Error("Reranker is not initialized");
  }

  const queries = new Array(passages.length).fill(query) as string[];
  const inputs = tokenizerImpl(queries, {
    text_pair: passages,
    padding: true,
    truncation: "only_second",
    max_length: MAX_TOKEN_LENGTH
  });
  const output = await modelImpl(inputs);
  const logitsData = output.logits.data as Float32Array;
  const scores: number[] = [];

  for (let index = 0; index < passages.length; index += 1) {
    scores.push(sigmoid(logitsData[index]));
  }

  return scores;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export async function rerank<T extends { content: string; score: number }>(
  query: string,
  candidates: T[]
): Promise<RerankerResult<T>> {
  if (!isRerankerReady() || candidates.length === 0) {
    return {
      chunks: candidates,
      rerankerUsed: false
    };
  }

  const scoringPromise = scorePassages(query, candidates.map((candidate) => candidate.content));
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), RERANKER_TIMEOUT_MS);
  });
  const result = await Promise.race([scoringPromise, timeoutPromise]);

  if (result === null) {
    return {
      chunks: candidates,
      rerankerUsed: false
    };
  }

  return {
    chunks: candidates
      .map((candidate, index) => ({
        ...candidate,
        score: result[index]
      }))
      .sort((left, right) => right.score - left.score),
    rerankerUsed: true
  };
}

export function __setRerankerTestHooks(hooks: RerankerTestHooks | null): void {
  testHooks = hooks;
}

export function __resetRerankerForTests(): void {
  tokenizer = null;
  model = null;
  initPromise = null;
  testHooks = null;
  testStubReady = false;
}
