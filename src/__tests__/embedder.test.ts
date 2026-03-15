import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { PythiaError } from "../errors.js";
import {
  createEmbedder,
  embedQuery,
  resetLocalEmbedderStateForTesting,
  setPipelineFactoryForTesting
} from "../indexer/embedder.js";
import { indexFile, setEmbedChunksForTesting } from "../indexer/sync.js";

function magnitude(vector: Float32Array): number {
  let sumOfSquares = 0;

  for (const value of vector) {
    sumOfSquares += value * value;
  }

  return Math.sqrt(sumOfSquares);
}

function buildFakeEmbedding(index: number, dims = 768): number[] {
  const vec = new Array<number>(dims).fill(0);
  vec[index % dims] = 1;
  return vec;
}

function createWorkspace(): { cleanup: () => void; dbPath: string; filePath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-embedder-"));

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath: path.join(directory, "lcs.db"),
    filePath: path.join(directory, "example.ts")
  };
}

function startObservedEmbeddingsServer(options: {
  delayMs?: number;
  dims?: number;
  failStatuses?: number[];
} = {}): Promise<{
  close: () => Promise<void>;
  port: number;
  stats: () => { maxInFlight: number; requestCount: number };
}> {
  const { delayMs = 0, dims = 768, failStatuses = [] } = options;
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
        const statusCode = failStatuses[attempts] ?? 200;
        attempts += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        const finish = () => {
          if (statusCode !== 200) {
            res.writeHead(statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "mock error" }));
            inFlight -= 1;
            return;
          }

          const data = parsed.input.map((_, index) => ({
            index,
            embedding: buildFakeEmbedding(index, dims)
          }));

          res.writeHead(200, { "Content-Type": "application/json" });
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
        stats: () => ({ maxInFlight, requestCount: attempts }),
        close: () => new Promise<void>((closeResolve) => {
          server.close(() => closeResolve());
        })
      });
    });
  });
}

test("embedQuery returns a Float32Array of length 256", async () => {
  const embedding = await embedQuery("hello");

  assert.ok(embedding instanceof Float32Array);
  assert.equal(embedding.length, 256);
});

test("same input produces identical output", async () => {
  const first = await embedQuery("hello");
  const second = await embedQuery("hello");

  assert.deepEqual(Array.from(first), Array.from(second));
});

test("output is L2-normalized", async () => {
  const embedding = await embedQuery("hello");
  const length = magnitude(embedding);

  assert.ok(Math.abs(length - 1) <= 0.001, `Expected magnitude close to 1, received ${length}`);
});

test("local backend dimensions above 768 throw a plain Error", () => {
  assert.throws(
    () => createEmbedder({ mode: "local", dimensions: 900 } as unknown as Parameters<typeof createEmbedder>[0]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof PythiaError, false);
      assert.match(error.message, /max output is 768d/u);
      return true;
    }
  );
});

test("local backend accepts dimensions 512", () => {
  assert.doesNotThrow(() => {
    createEmbedder({ mode: "local", dimensions: 512 });
  });
});

test("openai_compatible backends do not enforce the local 768d dimension guard", () => {
  assert.doesNotThrow(() => {
    createEmbedder({
      mode: "openai_compatible",
      dimensions: 900,
      base_url: "http://127.0.0.1:11434/v1",
      api_key: "ollama",
      model: "nomic-embed-text"
    } as unknown as Parameters<typeof createEmbedder>[0]);
  });
});

test("embedding_concurrency 4 reaches four concurrent HTTP requests", async () => {
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

test("local backend warns that embedding_concurrency is ignored in local mode", () => {
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

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ignores embedding_concurrency > 1/u);
});

test("failed embedding batches leave zero DB writes for the file", async () => {
  const fake = await startObservedEmbeddingsServer({ failStatuses: [200, 500] });
  const { cleanup, dbPath, filePath } = createWorkspace();
  const db = openDb(dbPath);
  const chunks = [
    {
      id: `${filePath}::chunk::0-0::alpha`,
      file_path: filePath,
      chunk_type: "doc",
      content: "alpha chunk",
      start_line: 0,
      end_line: 0
    },
    {
      id: `${filePath}::chunk::1-1::beta`,
      file_path: filePath,
      chunk_type: "doc",
      content: "beta chunk",
      start_line: 1,
      end_line: 1
    },
    {
      id: `${filePath}::chunk::2-2::gamma`,
      file_path: filePath,
      chunk_type: "doc",
      content: "gamma chunk",
      start_line: 2,
      end_line: 2
    }
  ];
  const content = [
    "export function alpha() {",
    "  return 1;",
    "}",
    "export function beta() {",
    "  return 2;",
    "}"
  ].join("\n");
  writeFileSync(filePath, content, "utf8");

  try {
    runMigrations(db);

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
        retry_max_attempts: 1,
        initial_backoff_ms: 100,
        honor_retry_after: true
      }
    });

    setEmbedChunksForTesting((texts) => embedder.embedChunks(texts));

    await assert.rejects(
      () => indexFile(db, filePath, content, { chunks }),
      /500/u
    );

    const chunkCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM lcs_chunks
      WHERE file_path = ?
    `).get(filePath) as { count: number };
    const vectorCount = db.prepare("SELECT COUNT(*) AS count FROM vec_lcs_chunks").get() as { count: number };
    const cacheCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM file_scan_cache
      WHERE file_path = ?
    `).get(filePath) as { count: number };

    assert.equal(chunkCount.count, 0);
    assert.equal(vectorCount.count, 0);
    assert.equal(cacheCount.count, 0);
  } finally {
    setEmbedChunksForTesting(null);
    db.close();
    cleanup();
    await fake.close();
  }
});

test("dtype cache map hit returns cached promise", async () => {
  let factoryCalls = 0;

  resetLocalEmbedderStateForTesting();
  setPipelineFactoryForTesting(async () => {
    factoryCalls += 1;

    return async (texts: string[]) => {
      const data = new Float32Array(texts.length * 768);

      for (let index = 0; index < texts.length; index += 1) {
        data[index * 768] = 1;
      }

      return {
        data,
        dims: [texts.length, 768]
      };
    };
  });

  try {
    const first = createEmbedder({ mode: "local", dimensions: 256, dtype: "q8" });
    const second = createEmbedder({ mode: "local", dimensions: 256, dtype: "q8" });

    await first.warm();
    await second.warm();

    assert.equal(factoryCalls, 1);
  } finally {
    resetLocalEmbedderStateForTesting();
  }
});

test("rejected dtype pipeline promises are cleared from the cache on failure", async () => {
  let factoryCalls = 0;

  resetLocalEmbedderStateForTesting();
  setPipelineFactoryForTesting(async () => {
    factoryCalls += 1;

    if (factoryCalls === 1) {
      throw new Error("q8 pipeline failed");
    }

    return async (texts: string[]) => {
      const data = new Float32Array(texts.length * 768);

      for (let index = 0; index < texts.length; index += 1) {
        data[index * 768] = 1;
      }

      return {
        data,
        dims: [texts.length, 768]
      };
    };
  });

  try {
    const embedder = createEmbedder({ mode: "local", dimensions: 256, dtype: "q8" });

    await assert.rejects(
      () => embedder.warm(),
      /q8 pipeline failed/u
    );

    await assert.doesNotReject(() => embedder.warm());
    assert.equal(factoryCalls, 2);
  } finally {
    resetLocalEmbedderStateForTesting();
  }
});
