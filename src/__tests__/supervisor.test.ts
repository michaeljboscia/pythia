import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { IndexingSupervisor, resolveWorkerEntryPoint } from "../indexer/supervisor.js";
import type { MainToWorker, WorkerToMain } from "../indexer/worker-protocol.js";

class FakeWorker extends EventEmitter {
  postMessage(_message: MainToWorker): void {
    // no-op by default; tests drive worker events directly
  }
}

function createSupervisorTestRig() {
  let now = 0;
  const workers: FakeWorker[] = [];

  const supervisor = new IndexingSupervisor("/tmp/test.db", "/tmp/workspace", {
    now: () => now,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });

  return {
    advance: (ms: number) => {
      now += ms;
    },
    currentWorker: () => workers.at(-1) as FakeWorker,
    supervisor,
    workerCount: () => workers.length
  };
}

function emitMessage(worker: FakeWorker, message: WorkerToMain): void {
  worker.emit("message", message);
}

function emitExit(worker: FakeWorker, code: number): void {
  worker.emit("exit", code);
}

test("3 crashes within 10 minutes stops auto-restart and emits fatal", async () => {
  const rig = createSupervisorTestRig();
  let fatalCount = 0;

  rig.supervisor.on("fatal", () => {
    fatalCount += 1;
  });

  const first = rig.currentWorker();
  emitExit(first, 1);
  assert.equal(rig.workerCount(), 2);

  const second = rig.currentWorker();
  emitExit(second, 1);
  assert.equal(rig.workerCount(), 3);

  const third = rig.currentWorker();
  emitExit(third, 1);

  assert.equal(rig.workerCount(), 3);
  assert.equal(fatalCount, 1);
});

test("4th crash after circuit breaker opens does not trigger another restart", async () => {
  const rig = createSupervisorTestRig();

  emitExit(rig.currentWorker(), 1);
  emitExit(rig.currentWorker(), 1);
  emitExit(rig.currentWorker(), 1);

  const workerCountAfterTrip = rig.workerCount();
  emitExit(rig.currentWorker(), 1);

  assert.equal(rig.workerCount(), workerCountAfterTrip);
});

test("successful batch after crashes prunes old crash log and allows restart again", async () => {
  const rig = createSupervisorTestRig();

  emitExit(rig.currentWorker(), 1);
  emitExit(rig.currentWorker(), 1);
  assert.equal(rig.workerCount(), 3);

  rig.advance(600_001);
  emitMessage(rig.currentWorker(), {
    type: "BATCH_COMPLETE",
    batch_id: "batch-1",
    succeeded: 1,
    failed: 0,
    duration_ms: 10
  });

  emitExit(rig.currentWorker(), 1);
  assert.equal(rig.workerCount(), 4);
});

test("die() sends DIE and resolves when ACK: DIE arrives", async () => {
  const rig = createSupervisorTestRig();
  const worker = rig.currentWorker();
  let postedDie = false;

  worker.postMessage = (message: MainToWorker) => {
    if (message.type === "DIE") {
      postedDie = true;
      queueMicrotask(() => {
        emitMessage(worker, { type: "ACK", ack: "DIE" });
      });
    }
  };

  await rig.supervisor.die();

  assert.equal(postedDie, true);
});

test("resolveWorkerEntryPoint prefers worker.ts when running from source", () => {
  const workerPath = resolveWorkerEntryPoint(
    "file:///tmp/pythia/src/indexer/supervisor.ts",
    (candidatePath) => candidatePath === "/tmp/pythia/src/indexer/worker.ts"
  );

  assert.equal(workerPath, "/tmp/pythia/src/indexer/worker.ts");
});

test("resolveWorkerEntryPoint falls back to worker.js for built output", () => {
  const workerPath = resolveWorkerEntryPoint(
    "file:///tmp/pythia/dist/indexer/supervisor.js",
    (candidatePath) => candidatePath === "/tmp/pythia/dist/indexer/worker.js"
  );

  assert.equal(workerPath, "/tmp/pythia/dist/indexer/worker.js");
});
