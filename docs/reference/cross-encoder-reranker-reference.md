# Cross-Encoder Reranker Reference — @huggingface/transformers v3

Model: `Xenova/ms-marco-MiniLM-L-6-v2`
Task: Passage reranking via relevance scoring (query, passage → float logit → sigmoid score)

This is NOT a text-classification pipeline. It is a SequenceClassification model used for
ranking — use `AutoModelForSequenceClassification` directly, not `pipeline()`.

---

## Install

```bash
npm install @huggingface/transformers
# Already in package.json as a peer dep of the embedder — no separate install needed
```

---

## Architecture

```
Input:  one query + N passages → N tokenized (query, passage) pairs
Model:  BERT-based cross-encoder, num_labels=1
Output: [batch_size, 1] logit tensor → sigmoid → float score ∈ (0.0, 1.0)
```

The model was fine-tuned on MS MARCO passage ranking. Raw logits are unbounded floats;
positive values indicate relevance, negative values indicate irrelevance. Apply sigmoid
to normalize into a 0–1 range for consistent output.

---

## Singleton initialization (Worker Thread safe)

```typescript
import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from '@huggingface/transformers';
import type { PreTrainedTokenizer, PreTrainedModel } from '@huggingface/transformers';

const RERANKER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

let _tokenizer: PreTrainedTokenizer | null = null;
let _model: PreTrainedModel | null = null;

export async function initReranker(cacheDir: string): Promise<void> {
  if (_tokenizer && _model) return; // already initialized

  [_tokenizer, _model] = await Promise.all([
    AutoTokenizer.from_pretrained(RERANKER_MODEL, { cache_dir: cacheDir }),
    AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
      cache_dir: cacheDir,
      // Use quantized weights — faster, nearly identical accuracy
      quantized: true,
    }),
  ]);
}

export function isRerankerReady(): boolean {
  return _tokenizer !== null && _model !== null;
}
```

**Notes:**
- Load once per Worker Thread process. Never reload per request.
- First load takes 200–800ms (WASM JIT + model weights). Subsequent calls return in <5ms.
- The quantized variant has identical ranking quality for passage reranking tasks.

---

## Scoring a batch of (query, passage) pairs

```typescript
import { sigmoid } from '../utils/math.js'; // see below

export async function scorePassages(
  query: string,
  passages: string[],
): Promise<number[]> {
  if (!_tokenizer || !_model) throw new Error('Reranker not initialized');
  if (passages.length === 0) return [];

  // Repeat the query N times to pair with each passage
  const queries = new Array(passages.length).fill(query) as string[];

  // Tokenize as sentence pairs
  const inputs = _tokenizer(queries, {
    text_pair: passages,
    padding: true,
    truncation: 'only_second', // preserve full query; truncate only the passage
    max_length: 512,           // BERT's absolute max
  });

  // Forward pass
  const output = await _model(inputs);

  // output.logits shape: [batch_size, 1]
  // .data is a Float32Array, stride by 1 to extract per-pair score
  const logitsData = output.logits.data as Float32Array;
  const scores: number[] = [];
  for (let i = 0; i < passages.length; i++) {
    scores.push(sigmoid(logitsData[i]));
  }
  return scores;
}

// Utility — not worth importing a library for
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
```

---

## Reranker with 250ms hard timeout (production pattern)

This is the pattern used in `src/retrieval/reranker.ts`:

```typescript
import type { LcsChunk } from '../db/types.js';

export type RerankerResult = {
  chunks: LcsChunk[];
  rerankerUsed: boolean;
};

const RERANKER_TIMEOUT_MS = 250;

export async function rerank(
  query: string,
  candidates: LcsChunk[],
): Promise<RerankerResult> {
  if (!isRerankerReady() || candidates.length === 0) {
    return { chunks: candidates, rerankerUsed: false };
  }

  const passages = candidates.map((c) => c.content);

  const scoringPromise = scorePassages(query, passages);
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), RERANKER_TIMEOUT_MS),
  );

  const result = await Promise.race([scoringPromise, timeoutPromise]);

  if (result === null) {
    // Timeout — return RRF order unchanged, caller emits RERANKER_UNAVAILABLE metadata
    return { chunks: candidates, rerankerUsed: false };
  }

  // Zip scores with chunks, sort descending
  const scored = candidates.map((chunk, i) => ({ chunk, score: result[i] }));
  scored.sort((a, b) => b.score - a.score);

  // Overwrite the score field on each chunk
  const reranked = scored.map(({ chunk, score }) => ({ ...chunk, score }));
  return { chunks: reranked, rerankerUsed: true };
}
```

---

## Truncation: `'only_second'` vs `true`

| Option | Behavior | Use when |
|--------|----------|----------|
| `truncation: true` | Truncates from the end (may cut into query) | Safe default for short queries |
| `truncation: 'only_second'` | Truncates only the passage; query preserved whole | **Use this for reranking** — query tokens are critical for relevance signal |
| `truncation: 'only_first'` | Truncates only the query | Never for reranking |

For reranking, the query must be fully preserved. A truncated query produces incorrect
relevance scores. Always use `'only_second'`.

---

## Output tensor layout

```
output.logits shape: [batch_size, 1]
output.logits.data:  Float32Array of length batch_size

// ❌ WRONG — treating it as a nested array
const scores = output.logits.data.map((row) => row[0]);

// ✅ CORRECT — flat Float32Array, stride is 1 because num_labels=1
const logitsData = output.logits.data as Float32Array;
for (let i = 0; i < batchSize; i++) {
  scores.push(sigmoid(logitsData[i]));
}
```

`num_labels=1` means the tensor is flat. If you used a model with `num_labels=2`,
you would need `logitsData[i * 2]` etc.

---

## Quantized vs unquantized scores

```
quantized:   [ 8.663132667541504, -11.245542526245117 ]  → after sigmoid: [ 0.9998, 0.0000 ]
unquantized: [ 8.845855712890625, -11.245561599731445 ]  → after sigmoid: [ 0.9999, 0.0000 ]
```

Negligible difference for ranking. Quantized is 4× smaller on disk, loads ~3× faster.

---

## First-call latency

WASM/ONNX JIT + model deserialization is slow on first use:

```
Cold start (first call):    ~600–1200ms (WASM JIT + quantized weights load)
Warm subsequent calls:       30–80ms per batch of 12 passages
```

Call `initReranker()` at Worker Thread startup, before any INDEX_BATCH messages arrive.
This primes the ONNX runtime so the first real query doesn't hit the timeout.

---

## Worker Thread lifecycle

```typescript
// In src/indexer/worker.ts entry point — call BEFORE entering message loop
import { initReranker } from '../retrieval/reranker.js';
import { getConfig } from '../config.js';

const cfg = getConfig();
await initReranker(cfg.models.cache_dir).catch(() => {
  // Non-fatal — Worker Thread still starts, reranker just returns
  // rerankerUsed: false on all calls until Main Thread forces re-init
  console.error('Reranker init failed — fallback to RRF order');
});
```

Reranker init failure is non-fatal. The Worker Thread still starts and serves requests.
Every rerank call will return `rerankerUsed: false` until the process restarts.

---

## Gotchas

| # | Issue | Detail |
|---|-------|--------|
| 1 | **Cannot use `pipeline()`** | `pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2')` does NOT work for reranking — use `AutoModelForSequenceClassification` directly |
| 2 | **logits.data is Float32Array** | `output.logits` is a `Tensor`, not an array. Access `.data` for the underlying typed array |
| 3 | **Stride is 1 (not 2)** | `num_labels=1` → logits flat array has exactly 1 value per example |
| 4 | **Apply sigmoid, not softmax** | Softmax requires 2+ outputs; this model has 1. Softmax of a single value is always 1.0 — meaningless |
| 5 | **`truncation: 'only_second'`** | Always use this string, not `true`. `true` may truncate the query when input is long |
| 6 | **Cold start blows the 250ms timeout** | Initialize at Worker Thread startup (`await initReranker()`), not on first query |
| 7 | **`padding: true` is required** | Without padding, batches of different-length pairs will fail or produce wrong shapes |
| 8 | **`quantized: true` is default** | If you want unquantized, pass `{ quantized: false }`. No practical quality difference for ranking |

---

## Bibliography

| Resource | URL |
|----------|-----|
| Xenova/ms-marco-MiniLM-L-6-v2 model page | https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2 |
| Original PyTorch model | https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2 |
| AutoModelForSequenceClassification docs | https://huggingface.co/docs/transformers.js/en/api/models#module_models.AutoModelForSequenceClassification |
| Transformers.js v3 migration guide | https://huggingface.co/docs/transformers.js/en/guides/node-esm |

_Created: 2026-03-11_
