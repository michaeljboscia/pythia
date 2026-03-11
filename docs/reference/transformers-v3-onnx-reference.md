# @huggingface/transformers v3 — ONNX / Node.js Reference

Transformers.js v3 runs ONNX models entirely in Node.js (no Python, no separate process).
The pipeline API handles tokenization, inference, and post-processing.

Sources: [Node.js tutorial](https://huggingface.co/docs/transformers.js/en/tutorials/node) ·
[Pipeline API](https://huggingface.co/docs/transformers.js/en/api/pipelines) ·
[v3 announcement](https://huggingface.co/blog/transformersjs-v3) ·
[Pipeline guide](https://huggingface.co/docs/transformers.js/en/pipelines)

---

## Install

```bash
npm install @huggingface/transformers
```

`package.json` must declare ESM:

```json
{ "type": "module" }
```

---

## Import Syntax (v3 ESM — the only correct form)

```js
import { pipeline, env } from "@huggingface/transformers";
```

**⚠️ v2 WRONG — do not use:**
```js
// WRONG: old package name (v1/v2 only)
import { pipeline } from "@xenova/transformers";

// WRONG: CJS require (doesn't work — package is ESM-only)
const { pipeline } = require("@huggingface/transformers");
```

If you're stuck in a CJS context, dynamic import is the escape hatch:
```js
const { pipeline } = await import("@huggingface/transformers");
```

---

## Singleton Pattern — Load Once, Reuse Forever

Never call `pipeline()` inside a request handler. It downloads and initializes the ONNX
model — that takes seconds. Create it once at startup, return the same instance on every call.

```js
import { pipeline, env } from "@huggingface/transformers";

// Optional: change cache location from default ./node_modules/@huggingface/transformers/.cache/
// env.cacheDir = "./.cache";

class EmbeddingPipeline {
  static task = "feature-extraction";
  static model = "Xenova/all-MiniLM-L6-v2"; // 384-dim, good default
  static instance = null;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      // pipeline() returns a Promise — store the Promise, not the resolved value.
      // This prevents a race condition where two concurrent callers both see null
      // and both kick off initialization simultaneously.
      this.instance = pipeline(this.task, this.model, {
        progress_callback,
        // dtype: "fp32",  // default in Node is quantized (q8); use fp32 for max accuracy
      });
    }
    // Always await here — if already resolved, this is essentially free
    return this.instance;
  }
}

// Pre-warm at startup (optional but recommended — avoids cold-start on first request)
await EmbeddingPipeline.getInstance();
```

---

## Feature-Extraction Pipeline for Embeddings

```js
const extractor = await EmbeddingPipeline.getInstance();

// Single string or array of strings — both work
const output = await extractor(
  ["This is sentence one.", "This is sentence two."],
  {
    pooling: "mean",    // mean-pool token embeddings → one vector per input
    normalize: true,    // L2-normalize — required for cosine similarity comparisons
  }
);
```

---

## Output Shape

The pipeline returns a **`Tensor` object**, not a plain array.

```
Tensor {
  type: 'float32',
  data: Float32Array(768) [ 0.045, 0.073, ... ],   // flat, all embeddings concatenated
  dims: [2, 384],   // [batch_size, embedding_dim]
  size: 768         // total elements = batch_size * embedding_dim
}
```

- `output.data` → `Float32Array` (flat, row-major)
- `output.dims` → `[batch_size, embedding_dim]`
- `output.size` → `batch_size * embedding_dim`

---

## Extracting Float32Array Values

```js
// Option 1: get the whole flat Float32Array
const flat = output.data; // Float32Array — all rows concatenated

// Option 2: .tolist() → nested JS array [[...], [...]] — one inner array per input
const nested = output.tolist();
// [
//   [0.045, 0.073, ...],  // embedding for sentence 0
//   [0.081, 0.107, ...],  // embedding for sentence 1
// ]

// Option 3: slice individual embeddings from the flat buffer
const dim = output.dims[1]; // e.g. 384
const embedding0 = output.data.slice(0, dim);        // Float32Array
const embedding1 = output.data.slice(dim, dim * 2);  // Float32Array
```

---

## Is `mean_pooling` Built-In?

**Yes — pass `pooling: "mean"` as a pipeline option.** You do not need to implement it manually.

```js
// v3 built-in pooling options:
await extractor(texts, { pooling: "mean" });     // mean of token embeddings (most common)
await extractor(texts, { pooling: "cls" });      // CLS token only
await extractor(texts, { pooling: "none" });     // raw token-level embeddings, shape [batch, seq_len, dim]
```

**⚠️ v2 pattern that is now wrong** — old examples called a separate `mean_pooling()` helper:
```js
// WRONG in v3 — do not do this:
import { pipeline, mean_pooling } from "@xenova/transformers";
const { last_hidden_state } = await extractor(text);
const pooled = mean_pooling(last_hidden_state, attention_mask);
```
In v3, the pipeline handles all of this internally when you pass `pooling: "mean"`.

---

## v2 → v3 Breaking Changes

| Area | v2 (`@xenova/transformers`) | v3 (`@huggingface/transformers`) |
|---|---|---|
| **Package name** | `@xenova/transformers` | `@huggingface/transformers` |
| **Quantization option** | `{ quantized: true/false }` | `{ dtype: "q8" / "fp32" / "q4" }` |
| **Default dtype in Node** | quantized (q8) | quantized (q8) — same, but now explicit |
| **mean_pooling** | manual helper import | built-in via `{ pooling: "mean" }` |
| **Output access** | `output[0].data` (extra wrapper layer) | `output.data` directly |
| **Model namespace** | Xenova/ models only | Xenova/ still works; also `onnx-community/` |
| **WebGPU** | not supported | `{ device: "webgpu" }` (browser only) |
| **Per-module dtype** | not supported | `{ dtype: { encoder: "fp32", decoder: "q8" } }` |

**The `quantized` option is gone.** Replace with `dtype`:
```js
// v2 WRONG:
pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: false });

// v3 CORRECT:
pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });
```

**Output shape changed.** In v2, the raw output had an extra dimension wrapper; v3 returns
the Tensor directly from the pipeline call (when pooling is specified).

---

## Complete Working Example

```js
// embedder.js
import { pipeline, env } from "@huggingface/transformers";

// Cache to disk next to your project instead of inside node_modules
env.cacheDir = "./.cache";

class EmbeddingPipeline {
  static task = "feature-extraction";
  static model = "Xenova/all-MiniLM-L6-v2"; // 384-dim
  static instance = null;

  static async getInstance() {
    if (this.instance === null) {
      this.instance = pipeline(this.task, this.model, { dtype: "fp32" });
    }
    return this.instance;
  }
}

export async function embed(texts) {
  // texts: string | string[]
  const extractor = await EmbeddingPipeline.getInstance();

  const output = await extractor(texts, { pooling: "mean", normalize: true });
  // output.dims = [n, 384], output.data = Float32Array(n * 384)

  // Return as nested array — one Float32Array per input
  const dim = output.dims[1];
  const results = [];
  for (let i = 0; i < output.dims[0]; i++) {
    results.push(output.data.slice(i * dim, (i + 1) * dim));
  }
  return results; // Float32Array[]
}

// Usage:
const embeddings = await embed(["Hello world", "Another sentence"]);
console.log(embeddings[0]); // Float32Array(384) [...]
```

---

## Useful `env` Settings

```js
import { env } from "@huggingface/transformers";

env.cacheDir = "./.cache";          // where models are stored on disk
env.localModelPath = "./models";    // load from local path instead of Hub
env.allowRemoteModels = false;      // force local-only (good for prod)
env.allowLocalModels = true;        // default true
```

---

*Created: 2026-03-11*
*Sources: [huggingface.co/docs/transformers.js](https://huggingface.co/docs/transformers.js/en/tutorials/node) ·
[huggingface.co/blog/transformersjs-v3](https://huggingface.co/blog/transformersjs-v3) ·
[Pipeline API reference](https://huggingface.co/docs/transformers.js/en/api/pipelines)*
