import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import { createEmbedder } from "../indexer/embedder.js";
import { PythiaError } from "../errors.js";

// Helpers ─────────────────────────────────────────────────────────────────────

function buildFakeEmbedding(index: number, dims = 768): number[] {
  // Build a non-trivial vector so we can verify truncation + normalization
  const vec = new Array<number>(dims).fill(0);
  vec[index % dims] = 1.0;
  return vec;
}

type FakeServerOptions = {
  dims?: number;
  reverseOrder?: boolean;
  statusCode?: number;
};

function startFakeEmbeddingsServer(options: FakeServerOptions = {}): Promise<{ close: () => Promise<void>; port: number }> {
  const { dims = 768, reverseOrder = false, statusCode = 200 } = options;

  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        if (statusCode !== 200) {
          res.writeHead(statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "mock error" }));
          return;
        }

        const parsed = JSON.parse(body) as { input: string[] };
        const embeddings = parsed.input.map((_, i) => ({
          index: i,
          embedding: buildFakeEmbedding(i, dims)
        }));

        if (reverseOrder) {
          embeddings.reverse();
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: embeddings }));
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          })
      });
    });
  });
}

type FakeVertexServerOptions = {
  dims?: number;
  statusCode?: number;
};

function startFakeVertexServer(options: FakeVertexServerOptions = {}): Promise<{ close: () => Promise<void>; port: number; lastRequestBody: () => unknown }> {
  const { dims = 256, statusCode = 200 } = options;
  let lastBody: unknown = null;

  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        lastBody = JSON.parse(body);

        if (statusCode !== 200) {
          res.writeHead(statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "mock vertex error" } }));
          return;
        }

        const parsed = JSON.parse(body) as { instances: { content: string }[] };
        const predictions = parsed.instances.map(() => ({
          embeddings: {
            values: buildFakeEmbedding(0, dims)
          }
        }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ predictions }));
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        port: address.port,
        lastRequestBody: () => lastBody,
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          })
      });
    });
  });
}

// Tests ───────────────────────────────────────────────────────────────────────

test("createEmbedder local returns embedChunks and embedQuery wrappers", () => {
  const embedder = createEmbedder({ mode: "local" });

  assert.equal(typeof embedder.embedChunks, "function");
  assert.equal(typeof embedder.embedQuery, "function");
  assert.equal(typeof embedder.warm, "function");
});

test("openai_compatible embedder returns 256d normalized vectors", async () => {
  const fake = await startFakeEmbeddingsServer({ dims: 768 });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    });

    const results = await embedder.embedChunks(["hello", "world"]);

    assert.equal(results.length, 2);
    assert.ok(results[0] instanceof Float32Array);
    assert.equal(results[0].length, 256, "should truncate to 256d");

    // Check L2 normalization — magnitude must be ~1
    for (const vec of results) {
      let sum = 0;

      for (const v of vec) {
        sum += v * v;
      }

      assert.ok(Math.abs(Math.sqrt(sum) - 1) <= 0.001, `Expected normalized vector, magnitude was ${Math.sqrt(sum)}`);
    }
  } finally {
    await fake.close();
  }
});

test("openai_compatible embedder preserves order when server returns reversed", async () => {
  const fake = await startFakeEmbeddingsServer({ dims: 768, reverseOrder: true });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    });

    // Two texts with different "identity" vectors at different positions
    const results = await embedder.embedChunks(["text-0", "text-1"]);

    // results[0] should map to index=0 and results[1] to index=1
    // Since buildFakeEmbedding(0) has vec[0]=1 and buildFakeEmbedding(1) has vec[1]=1,
    // after truncation the first non-zero dimension reveals which embedding is which
    let firstNonZero0 = -1;
    let firstNonZero1 = -1;

    for (let i = 0; i < 256; i += 1) {
      if (results[0][i] !== 0 && firstNonZero0 === -1) {
        firstNonZero0 = i;
      }

      if (results[1][i] !== 0 && firstNonZero1 === -1) {
        firstNonZero1 = i;
      }
    }

    assert.equal(firstNonZero0, 0, "first result should correspond to index 0");
    assert.equal(firstNonZero1, 1, "second result should correspond to index 1");
  } finally {
    await fake.close();
  }
});

test("openai_compatible embedder rejects on HTTP error status", async () => {
  const fake = await startFakeEmbeddingsServer({ statusCode: 500 });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    });

    await assert.rejects(
      () => embedder.embedChunks(["hello"]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("500"), `Expected 500 in message, got: ${error.message}`);
        return true;
      }
    );
  } finally {
    await fake.close();
  }
});

test("openai_compatible embedQuery adds search_query prefix and returns single vector", async () => {
  let capturedBody = "";
  const fake = await startFakeEmbeddingsServer({ dims: 768 });

  // Replace fake server with one that captures the body
  const captureServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      capturedBody = body;
      const parsed = JSON.parse(body) as { input: string[] };
      const data = parsed.input.map((_, i) => ({
        index: i,
        embedding: buildFakeEmbedding(i, 768)
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data }));
    });
  });

  await fake.close();

  await new Promise<void>((resolve) => captureServer.listen(0, "127.0.0.1", () => resolve()));
  const address = captureServer.address() as { port: number };

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      base_url: `http://127.0.0.1:${address.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    });

    const result = await embedder.embedQuery("my query");

    assert.ok(result instanceof Float32Array);
    assert.equal(result.length, 256);
    assert.ok(capturedBody.includes("search_query:"), `Expected search_query prefix in: ${capturedBody}`);
  } finally {
    await new Promise<void>((resolve) => captureServer.close(() => resolve()));
  }
});

// ─── Vertex AI tests ─────────────────────────────────────────────────────────

test("vertex_ai embedder returns 256d normalized vectors", async () => {
  const fake = await startFakeVertexServer({ dims: 256 });
  const savedToken = process.env.PYTHIA_TEST_VERTEX_TOKEN;
  process.env.PYTHIA_TEST_VERTEX_TOKEN = "fake-vertex-token";

  try {
    const embedder = createEmbedder(
      {
        mode: "vertex_ai",
        project: "my-project",
        location: "us-central1",
        model: "text-embedding-005"
      },
      { vertexEndpointOverride: `http://127.0.0.1:${fake.port}` }
    );

    const results = await embedder.embedChunks(["hello", "world"]);

    assert.equal(results.length, 2);
    assert.ok(results[0] instanceof Float32Array);
    assert.equal(results[0].length, 256, "should be 256d");

    // Check L2 normalization
    for (const vec of results) {
      let sum = 0;

      for (const v of vec) {
        sum += v * v;
      }

      assert.ok(Math.abs(Math.sqrt(sum) - 1) <= 0.001, `Expected normalized vector, magnitude was ${Math.sqrt(sum)}`);
    }
  } finally {
    if (savedToken === undefined) {
      delete process.env.PYTHIA_TEST_VERTEX_TOKEN;
    } else {
      process.env.PYTHIA_TEST_VERTEX_TOKEN = savedToken;
    }
    await fake.close();
  }
});

test("vertex_ai embedder sends RETRIEVAL_DOCUMENT task_type for embedChunks", async () => {
  const fake = await startFakeVertexServer({ dims: 256 });
  const savedToken = process.env.PYTHIA_TEST_VERTEX_TOKEN;
  process.env.PYTHIA_TEST_VERTEX_TOKEN = "fake-vertex-token";

  try {
    const embedder = createEmbedder(
      {
        mode: "vertex_ai",
        project: "my-project",
        location: "us-central1",
        model: "text-embedding-005"
      },
      { vertexEndpointOverride: `http://127.0.0.1:${fake.port}` }
    );

    await embedder.embedChunks(["hello"]);

    const body = fake.lastRequestBody() as { instances: { content: string; task_type: string }[]; parameters: { outputDimensionality: number } };
    assert.equal(body.instances[0].task_type, "RETRIEVAL_DOCUMENT");
    assert.equal(body.instances[0].content, "hello");
    assert.equal(body.parameters.outputDimensionality, 256);
  } finally {
    if (savedToken === undefined) {
      delete process.env.PYTHIA_TEST_VERTEX_TOKEN;
    } else {
      process.env.PYTHIA_TEST_VERTEX_TOKEN = savedToken;
    }
    await fake.close();
  }
});

test("vertex_ai embedder sends RETRIEVAL_QUERY task_type for embedQuery and returns single vector", async () => {
  const fake = await startFakeVertexServer({ dims: 256 });
  const savedToken = process.env.PYTHIA_TEST_VERTEX_TOKEN;
  process.env.PYTHIA_TEST_VERTEX_TOKEN = "fake-vertex-token";

  try {
    const embedder = createEmbedder(
      {
        mode: "vertex_ai",
        project: "my-project",
        location: "us-central1",
        model: "text-embedding-005"
      },
      { vertexEndpointOverride: `http://127.0.0.1:${fake.port}` }
    );

    const result = await embedder.embedQuery("find something");

    assert.ok(result instanceof Float32Array);
    assert.equal(result.length, 256);

    const body = fake.lastRequestBody() as { instances: { content: string; task_type: string }[] };
    assert.equal(body.instances[0].task_type, "RETRIEVAL_QUERY");
    assert.equal(body.instances[0].content, "find something");
  } finally {
    if (savedToken === undefined) {
      delete process.env.PYTHIA_TEST_VERTEX_TOKEN;
    } else {
      process.env.PYTHIA_TEST_VERTEX_TOKEN = savedToken;
    }
    await fake.close();
  }
});

test("vertex_ai embedder rejects on HTTP error status", async () => {
  const fake = await startFakeVertexServer({ statusCode: 403 });
  const savedToken = process.env.PYTHIA_TEST_VERTEX_TOKEN;
  process.env.PYTHIA_TEST_VERTEX_TOKEN = "fake-vertex-token";

  try {
    const embedder = createEmbedder(
      {
        mode: "vertex_ai",
        project: "my-project",
        location: "us-central1",
        model: "text-embedding-005"
      },
      { vertexEndpointOverride: `http://127.0.0.1:${fake.port}` }
    );

    await assert.rejects(
      () => embedder.embedChunks(["hello"]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("403"), `Expected 403 in message, got: ${error.message}`);
        return true;
      }
    );
  } finally {
    if (savedToken === undefined) {
      delete process.env.PYTHIA_TEST_VERTEX_TOKEN;
    } else {
      process.env.PYTHIA_TEST_VERTEX_TOKEN = savedToken;
    }
    await fake.close();
  }
});

function startObservedEmbeddingsServer(options: {
  delayMs?: number;
  dims?: number;
  failStatuses?: number[];
  retryAfter?: string | ((attempt: number) => string);
} = {}): Promise<{
  close: () => Promise<void>;
  port: number;
  stats: () => { bodies: Array<{ input: string[] }>; maxInFlight: number; requestTimes: number[] };
}> {
  const { delayMs = 0, dims = 768, failStatuses = [], retryAfter } = options;
  const bodies: Array<{ input: string[] }> = [];
  const requestTimes: number[] = [];
  let attempts = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        const parsed = JSON.parse(body) as { input: string[] };
        const attempt = attempts;
        attempts += 1;
        bodies.push(parsed);
        requestTimes.push(Date.now());
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        const statusCode = failStatuses[attempt] ?? 200;
        const finish = () => {
          const headers: Record<string, string> = { "Content-Type": "application/json" };

          if (statusCode === 429 && retryAfter !== undefined) {
            headers["Retry-After"] = typeof retryAfter === "function" ? retryAfter(attempt) : retryAfter;
          }

          if (statusCode !== 200) {
            res.writeHead(statusCode, headers);
            res.end(JSON.stringify({ error: "mock error" }));
            inFlight -= 1;
            return;
          }

          const data = parsed.input.map((_, index) => ({
            index,
            embedding: buildFakeEmbedding(index, dims)
          }));

          res.writeHead(200, headers);
          res.end(JSON.stringify({ data }));
          inFlight -= 1;
        };

        setTimeout(finish, delayMs);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        port: address.port,
        stats: () => ({ bodies, maxInFlight, requestTimes }),
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          })
      });
    });
  });
}

test("vertex_ai embedder forwards configured outputDimensionality", async () => {
  const fake = await startFakeVertexServer({ dims: 512 });
  const savedToken = process.env.PYTHIA_TEST_VERTEX_TOKEN;
  process.env.PYTHIA_TEST_VERTEX_TOKEN = "fake-vertex-token";

  try {
    const embedder = createEmbedder(
      {
        mode: "vertex_ai",
        dimensions: 512,
        project: "my-project",
        location: "us-central1",
        model: "text-embedding-005"
      },
      { vertexEndpointOverride: `http://127.0.0.1:${fake.port}` }
    );

    const results = await embedder.embedChunks(["hello"]);
    const body = fake.lastRequestBody() as { parameters: { outputDimensionality: number } };

    assert.equal(results[0].length, 512);
    assert.equal(body.parameters.outputDimensionality, 512);
  } finally {
    if (savedToken === undefined) {
      delete process.env.PYTHIA_TEST_VERTEX_TOKEN;
    } else {
      process.env.PYTHIA_TEST_VERTEX_TOKEN = savedToken;
    }
    await fake.close();
  }
});

test("local backend rejects dimensions above 768 at startup", () => {
  assert.throws(
    () => createEmbedder({ mode: "local", dimensions: 1024 }),
    /max output is 768d/
  );
});

test("warm detects configured dimension mismatches", async () => {
  const fake = await startFakeEmbeddingsServer({ dims: 256 });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      dimensions: 512,
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    });

    await assert.rejects(
      () => embedder.warm(),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "DIMENSION_MISMATCH");
        return true;
      }
    );
  } finally {
    await fake.close();
  }
});

test("embedding_concurrency=4 allows four HTTP requests in flight", async () => {
  const fake = await startObservedEmbeddingsServer({ delayMs: 100 });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      dimensions: 256,
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    }, {
      indexingConfig: {
        embedding_batch_size: 1,
        embedding_concurrency: 4,
        retry_max_attempts: 3,
        initial_backoff_ms: 500,
        honor_retry_after: true
      }
    });

    await embedder.embedChunks(["a", "b", "c", "d"]);

    assert.equal(fake.stats().maxInFlight, 4);
  } finally {
    await fake.close();
  }
});

test("embedding_batch_size=32 caps request payload size", async () => {
  const fake = await startObservedEmbeddingsServer();

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      dimensions: 256,
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    }, {
      indexingConfig: {
        embedding_batch_size: 32,
        embedding_concurrency: 4,
        retry_max_attempts: 3,
        initial_backoff_ms: 500,
        honor_retry_after: true
      }
    });

    await embedder.embedChunks(Array.from({ length: 70 }, (_, index) => `text-${index}`));

    const lengths = fake.stats().bodies.map((body) => body.input.length);
    assert.deepEqual(lengths, [32, 32, 6]);
  } finally {
    await fake.close();
  }
});

test("429 responses back off exponentially before retrying", async () => {
  const fake = await startObservedEmbeddingsServer({ failStatuses: [429, 200] });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      dimensions: 256,
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    }, {
      indexingConfig: {
        embedding_batch_size: 1,
        embedding_concurrency: 1,
        retry_max_attempts: 3,
        initial_backoff_ms: 100,
        honor_retry_after: false
      }
    });

    await embedder.embedChunks(["retry-me"]);

    const [, secondRequest] = fake.stats().requestTimes;
    const [firstRequest] = fake.stats().requestTimes;
    assert.ok(secondRequest - firstRequest >= 100, `Expected >=100ms backoff, got ${secondRequest - firstRequest}`);
  } finally {
    await fake.close();
  }
});

test("Retry-After seconds header is honored when configured", async () => {
  const fake = await startObservedEmbeddingsServer({ failStatuses: [429, 200], retryAfter: "5" });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      dimensions: 256,
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    }, {
      indexingConfig: {
        embedding_batch_size: 1,
        embedding_concurrency: 1,
        retry_max_attempts: 3,
        initial_backoff_ms: 100,
        honor_retry_after: true
      }
    });

    await embedder.embedChunks(["retry-after-seconds"]);

    const [firstRequest, secondRequest] = fake.stats().requestTimes;
    assert.ok(secondRequest - firstRequest >= 4900, `Expected ~5000ms backoff, got ${secondRequest - firstRequest}`);
  } finally {
    await fake.close();
  }
});

test("Retry-After HTTP-date header is parsed correctly", async () => {
  const fake = await startObservedEmbeddingsServer({
    failStatuses: [429, 200],
    retryAfter: () => new Date(Date.now() + 2500).toUTCString()
  });

  try {
    const embedder = createEmbedder({
      mode: "openai_compatible",
      dimensions: 256,
      base_url: `http://127.0.0.1:${fake.port}/v1`,
      api_key: "test",
      model: "nomic-embed-text"
    }, {
      indexingConfig: {
        embedding_batch_size: 1,
        embedding_concurrency: 1,
        retry_max_attempts: 3,
        initial_backoff_ms: 100,
        honor_retry_after: true
      }
    });

    await embedder.embedChunks(["retry-after-date"]);

    const [firstRequest, secondRequest] = fake.stats().requestTimes;
    assert.ok(secondRequest - firstRequest >= 1500, `Expected >=1500ms backoff, got ${secondRequest - firstRequest}`);
  } finally {
    await fake.close();
  }
});

test("local backend clamps concurrency warnings to one startup message", () => {
  const warnings: string[] = [];

  createEmbedder(
    { mode: "local", dimensions: 256 },
    {
      indexingConfig: { embedding_concurrency: 4 },
      warnImpl: (message) => {
        warnings.push(message);
      }
    }
  );

  createEmbedder(
    { mode: "local", dimensions: 256 },
    {
      indexingConfig: { embedding_concurrency: 4 },
      warnImpl: (message) => {
        warnings.push(message);
      }
    }
  );

  assert.equal(warnings.length, 1);
});
