import { existsSync, readFileSync, statSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

import { chunkFile } from "./chunker-treesitter.js";
import { embedChunks } from "./embedder.js";
import { hashFile } from "./hasher.js";
import { indexFile } from "./sync.js";
import type { MainToWorker, WorkerToMain } from "./worker-protocol.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";

type WorkerInitData = {
  dbPath: string;
  workspaceRoot: string;
};

if (parentPort === null) {
  throw new Error("Worker thread missing parentPort");
}

const port = parentPort;
const data = workerData as WorkerInitData;
const db = openDb(data.dbPath);
runMigrations(db);

let paused = false;
let dying = false;
let inFlight = false;
let closed = false;

function send(message: WorkerToMain): void {
  port.postMessage(message);
}

function shutdownWorker(): void {
  if (closed) {
    return;
  }

  closed = true;
  db.close();
  port.close();
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function createEmbeddings(texts: string[]): Promise<Float32Array[]> {
  if (process.env.PYTHIA_TEST_EMBED_STUB === "1") {
    return texts.map(() => new Float32Array(256));
  }

  return embedChunks(texts);
}

async function indexOneFile(filePath: string): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`ENOENT: ${filePath}`);
  }

  const fileBuffer = readFileSync(filePath);
  const content = fileBuffer.toString("utf8");
  const chunks = chunkFile(filePath, content, data.workspaceRoot);
  const stats = statSync(filePath, { bigint: true });

  if (chunks.length === 0) {
    return;
  }

  const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));

  await indexFile(db, filePath, content, {
    chunks,
    contentHash: await hashFile(fileBuffer),
    embeddings,
    mtimeNs: stats.mtimeNs,
    sizeBytes: stats.size
  });
}

function toErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    return String((error as Error & { code?: string }).code ?? "INDEXER_FILE_FAILED");
  }

  return "INDEXER_FILE_FAILED";
}

async function handleBatch(
  batchId: string,
  files: string[],
  _reason: "boot" | "warm" | "force"
): Promise<void> {
  send({ type: "BATCH_STARTED", batch_id: batchId, total_files: files.length } satisfies WorkerToMain);

  let succeeded = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];

    while (paused && !dying) {
      await sleep(100);
    }

    if (dying) {
      break;
    }

    inFlight = true;

    try {
      await indexOneFile(file);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      send({
        type: "FILE_FAILED",
        batch_id: batchId,
        file,
        error_code: toErrorCode(error),
        detail: error instanceof Error ? error.message : String(error)
      } satisfies WorkerToMain);
    } finally {
      inFlight = false;
    }

    if ((index + 1) % 5 === 0) {
      send({
        type: "HEARTBEAT",
        batch_id: batchId,
        timestamp: new Date().toISOString(),
        in_flight_file: file
      } satisfies WorkerToMain);
    }

    if (dying) {
      break;
    }
  }

  send({
    type: "BATCH_COMPLETE",
    batch_id: batchId,
    succeeded,
    failed,
    duration_ms: Date.now() - startedAt
  } satisfies WorkerToMain);

  if (dying && !inFlight) {
    send({ type: "ACK", ack: "DIE" } satisfies WorkerToMain);
    shutdownWorker();
  }
}

port.on("message", async (message: MainToWorker) => {
  try {
    switch (message.type) {
      case "PING":
        send({ type: "ACK", ack: "PING" } satisfies WorkerToMain);
        break;
      case "INDEX_BATCH":
        send({ type: "ACK", ack: "INDEX_BATCH", batch_id: message.batch_id } satisfies WorkerToMain);
        await handleBatch(message.batch_id, message.files, message.reason);
        break;
      case "PAUSE":
        paused = true;
        send({ type: "PAUSED", batch_id: message.batch_id } satisfies WorkerToMain);
        break;
      case "RESUME":
        paused = false;
        send({ type: "ACK", ack: "RESUME" } satisfies WorkerToMain);
        break;
      case "DIE":
        dying = true;
        if (!inFlight) {
          send({ type: "ACK", ack: "DIE" } satisfies WorkerToMain);
          shutdownWorker();
        }
        break;
      default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unsupported worker message: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  } catch (error) {
    send({
      type: "FATAL",
      error_code: "INDEX_BATCH_FAILED",
      detail: error instanceof Error ? error.message : String(error)
    } satisfies WorkerToMain);
  }
});
