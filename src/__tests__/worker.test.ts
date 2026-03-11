import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

import type { MainToWorker, WorkerToMain } from "../indexer/worker-protocol.js";

type WorkerHarness = {
  cleanup: () => void;
  dbPath: string;
  workspaceRoot: string;
  spawn: () => Worker;
};

function createHarness(): WorkerHarness {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "pythia-worker-"));
  const dbPath = path.join(workspaceRoot, "lcs.db");
  const workerPath = new URL("../indexer/worker.js", import.meta.url);

  return {
    dbPath,
    workspaceRoot,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
    spawn: () => {
      process.env.PYTHIA_TEST_EMBED_STUB = "1";
      process.env.PYTHIA_TEST_RERANKER_STUB = "1";

      return new Worker(workerPath, {
        workerData: { dbPath, workspaceRoot }
      });
    }
  };
}

function waitForMessage(
  worker: Worker,
  predicate: (message: WorkerToMain) => boolean,
  timeoutMs: number = 10_000
): Promise<WorkerToMain> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off("message", onMessage);
      reject(new Error("Timed out waiting for worker message"));
    }, timeoutMs);

    function onMessage(message: WorkerToMain): void {
      if (!predicate(message)) {
        return;
      }

      clearTimeout(timeout);
      worker.off("message", onMessage);
      resolve(message);
    }

    worker.on("message", onMessage);
  });
}

async function terminateWorker(worker: Worker): Promise<void> {
  if (worker.threadId === -1) {
    return;
  }

  worker.postMessage({ type: "DIE" } satisfies MainToWorker);
  await waitForMessage(worker, (message) => message.type === "ACK" && message.ack === "DIE");
  await new Promise<void>((resolve) => {
    worker.once("exit", () => resolve());
  });
}

test("PING receives ACK: PING response", async () => {
  const harness = createHarness();
  const worker = harness.spawn();

  try {
    worker.postMessage({ type: "PING" } satisfies MainToWorker);
    const response = await waitForMessage(worker, (message) => message.type === "ACK" && message.ack === "PING");

    assert.deepEqual(response, { type: "ACK", ack: "PING" });
  } finally {
    await terminateWorker(worker);
    harness.cleanup();
    delete process.env.PYTHIA_TEST_EMBED_STUB;
    delete process.env.PYTHIA_TEST_RERANKER_STUB;
  }
});

test("INDEX_BATCH with 2 files emits BATCH_STARTED then BATCH_COMPLETE", async () => {
  const harness = createHarness();
  const worker = harness.spawn();
  const authPath = path.join(harness.workspaceRoot, "src", "auth.ts");
  const serverPath = path.join(harness.workspaceRoot, "src", "server.ts");
  mkdirSync(path.dirname(authPath), { recursive: true });
  writeFileSync(authPath, "export function login() { return true; }\n", "utf8");
  writeFileSync(serverPath, "export function handleRequest() { return login(); }\n", "utf8");

  try {
    worker.postMessage({
      type: "INDEX_BATCH",
      batch_id: "batch-1",
      files: [authPath, serverPath],
      reason: "boot"
    } satisfies MainToWorker);

    const ack = await waitForMessage(worker, (message) => (
      message.type === "ACK" && message.ack === "INDEX_BATCH" && message.batch_id === "batch-1"
    ));
    const started = await waitForMessage(worker, (message) => (
      message.type === "BATCH_STARTED" && message.batch_id === "batch-1"
    ));
    const completed = await waitForMessage(worker, (message) => (
      message.type === "BATCH_COMPLETE" && message.batch_id === "batch-1"
    ));

    assert.deepEqual(ack, { type: "ACK", ack: "INDEX_BATCH", batch_id: "batch-1" });
    assert.deepEqual(started, { type: "BATCH_STARTED", batch_id: "batch-1", total_files: 2 });
    assert.equal(completed.type, "BATCH_COMPLETE");
    assert.equal(completed.succeeded, 2);
    assert.equal(completed.failed, 0);
  } finally {
    await terminateWorker(worker);
    harness.cleanup();
    delete process.env.PYTHIA_TEST_EMBED_STUB;
    delete process.env.PYTHIA_TEST_RERANKER_STUB;
  }
});

test("INDEX_BATCH with one failing file emits FILE_FAILED and still completes the batch", async () => {
  const harness = createHarness();
  const worker = harness.spawn();
  const goodPath = path.join(harness.workspaceRoot, "src", "auth.ts");
  const missingPath = path.join(harness.workspaceRoot, "src", "missing.ts");
  mkdirSync(path.dirname(goodPath), { recursive: true });
  writeFileSync(goodPath, "export function login() { return true; }\n", "utf8");

  try {
    worker.postMessage({
      type: "INDEX_BATCH",
      batch_id: "batch-2",
      files: [goodPath, missingPath],
      reason: "warm"
    } satisfies MainToWorker);

    await waitForMessage(worker, (message) => (
      message.type === "ACK" && message.ack === "INDEX_BATCH" && message.batch_id === "batch-2"
    ));
    await waitForMessage(worker, (message) => (
      message.type === "BATCH_STARTED" && message.batch_id === "batch-2"
    ));
    const fileFailed = await waitForMessage(worker, (message) => (
      message.type === "FILE_FAILED" && message.batch_id === "batch-2" && message.file === missingPath
    ));
    const completed = await waitForMessage(worker, (message) => (
      message.type === "BATCH_COMPLETE" && message.batch_id === "batch-2"
    ));

    assert.equal(fileFailed.type, "FILE_FAILED");
    assert.equal(fileFailed.error_code, "INDEXER_FILE_FAILED");
    assert.equal(completed.type, "BATCH_COMPLETE");
    assert.equal(completed.succeeded, 1);
    assert.equal(completed.failed, 1);
  } finally {
    await terminateWorker(worker);
    harness.cleanup();
    delete process.env.PYTHIA_TEST_EMBED_STUB;
    delete process.env.PYTHIA_TEST_RERANKER_STUB;
  }
});

test("DIE during a batch receives ACK: DIE and worker exits cleanly", async () => {
  const harness = createHarness();
  const worker = harness.spawn();
  const filePath = path.join(harness.workspaceRoot, "src", "auth.ts");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "export function login() { return true; }\n", "utf8");

  try {
    worker.postMessage({
      type: "INDEX_BATCH",
      batch_id: "batch-3",
      files: [filePath],
      reason: "force"
    } satisfies MainToWorker);

    await waitForMessage(worker, (message) => (
      message.type === "ACK" && message.ack === "INDEX_BATCH" && message.batch_id === "batch-3"
    ));
    await waitForMessage(worker, (message) => (
      message.type === "BATCH_STARTED" && message.batch_id === "batch-3"
    ));

    worker.postMessage({ type: "DIE" } satisfies MainToWorker);

    const ack = await waitForMessage(worker, (message) => message.type === "ACK" && message.ack === "DIE");
    const exitCode = await new Promise<number>((resolve) => {
      worker.once("exit", (code) => resolve(code));
    });

    assert.deepEqual(ack, { type: "ACK", ack: "DIE" });
    assert.equal(exitCode, 0);
  } finally {
    harness.cleanup();
    delete process.env.PYTHIA_TEST_EMBED_STUB;
    delete process.env.PYTHIA_TEST_RERANKER_STUB;
  }
});
