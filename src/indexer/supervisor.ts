import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

import type { MainToWorker, WorkerToMain } from "./worker-protocol.js";

type SupervisorEventMap = {
  batchComplete: (message: Extract<WorkerToMain, { type: "BATCH_COMPLETE" }>) => void;
  fileFailed: (message: Extract<WorkerToMain, { type: "FILE_FAILED" }>) => void;
  fatal: (message: Extract<WorkerToMain, { type: "FATAL" }>) => void;
};

type WorkerLike = {
  off(eventName: string, listener: (...args: any[]) => void): WorkerLike;
  on(eventName: string, listener: (...args: any[]) => void): WorkerLike;
  once(eventName: string, listener: (...args: any[]) => void): WorkerLike;
  postMessage(message: MainToWorker): void;
};

type SupervisorOptions = {
  now?: () => number;
  workerFactory?: (dbPath: string, workspaceRoot: string) => WorkerLike;
};

const CRASH_WINDOW_MS = 600_000;
const MAX_CRASHES = 3;

function createWorker(dbPath: string, workspaceRoot: string): Worker {
  const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));

  return new Worker(workerPath, {
    workerData: { dbPath, workspaceRoot }
  });
}

export class IndexingSupervisor {
  private readonly dbPath: string;
  private readonly workspaceRoot: string;
  private readonly emitter = new EventEmitter();
  private readonly now: () => number;
  private readonly workerFactory: (dbPath: string, workspaceRoot: string) => WorkerLike;
  private readonly pendingBatches = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private crashLog: number[] = [];
  private worker: WorkerLike;
  private diePromise: Promise<void> | null = null;
  private resolveDie: (() => void) | null = null;
  private rejectDie: ((error: Error) => void) | null = null;

  constructor(dbPath: string, workspaceRoot: string, options: SupervisorOptions = {}) {
    this.dbPath = dbPath;
    this.workspaceRoot = workspaceRoot;
    this.now = options.now ?? (() => Date.now());
    this.workerFactory = options.workerFactory ?? createWorker;
    this.worker = this.spawnWorker();
  }

  async sendBatch(files: string[], reason: "boot" | "warm" | "force"): Promise<void> {
    const batchId = randomUUID();

    return new Promise<void>((resolve, reject) => {
      this.pendingBatches.set(batchId, { resolve, reject });
      this.worker.postMessage({
        type: "INDEX_BATCH",
        batch_id: batchId,
        files,
        reason
      } satisfies MainToWorker);
    });
  }

  async die(): Promise<void> {
    if (this.diePromise !== null) {
      return this.diePromise;
    }

    this.diePromise = new Promise<void>((resolve, reject) => {
      this.resolveDie = resolve;
      this.rejectDie = reject;
      this.worker.postMessage({ type: "DIE" } satisfies MainToWorker);
    });

    return this.diePromise;
  }

  on<E extends keyof SupervisorEventMap>(event: E, handler: SupervisorEventMap[E]): void {
    this.emitter.on(event, handler);
  }

  private spawnWorker(): WorkerLike {
    const worker = this.workerFactory(this.dbPath, this.workspaceRoot);

    worker.on("message", this.handleWorkerMessage);
    worker.on("error", this.handleWorkerError);
    worker.on("exit", this.handleWorkerExit);

    return worker;
  }

  private pruneCrashLog(): void {
    const now = this.now();
    this.crashLog = this.crashLog.filter((timestamp) => now - timestamp < CRASH_WINDOW_MS);
  }

  private shouldRestart(): boolean {
    this.pruneCrashLog();
    return this.crashLog.length < MAX_CRASHES;
  }

  private resolveBatch(batchId: string): void {
    const pending = this.pendingBatches.get(batchId);

    if (pending === undefined) {
      return;
    }

    this.pendingBatches.delete(batchId);
    pending.resolve();
  }

  private rejectAllPending(error: Error): void {
    for (const [batchId, pending] of this.pendingBatches) {
      this.pendingBatches.delete(batchId);
      pending.reject(error);
    }
  }

  private readonly handleWorkerMessage = (message: WorkerToMain): void => {
    switch (message.type) {
      case "ACK":
        if (message.ack === "DIE" && this.resolveDie !== null) {
          this.resolveDie();
          this.resolveDie = null;
          this.rejectDie = null;
          this.diePromise = null;
        }
        break;
      case "BATCH_COMPLETE":
        this.pruneCrashLog();
        this.emitter.emit("batchComplete", message);
        this.resolveBatch(message.batch_id);
        break;
      case "FILE_FAILED":
        this.emitter.emit("fileFailed", message);
        break;
      case "FATAL":
        this.emitter.emit("fatal", message);
        break;
      default:
        break;
    }
  };

  private readonly handleWorkerError = (error: Error): void => {
    console.error("[supervisor] worker error:", error);
  };

  private readonly handleWorkerExit = (code: number): void => {
    if (code === 0) {
      return;
    }

    this.crashLog.push(this.now());

    if (this.shouldRestart()) {
      this.worker = this.spawnWorker();
      return;
    }

    console.error("[supervisor] circuit breaker open; worker will not be restarted");

    const fatalMessage = {
      type: "FATAL",
      error_code: "INDEX_BATCH_FAILED",
      detail: "Worker crashed too many times within the restart window"
    } satisfies WorkerToMain;

    this.emitter.emit("fatal", fatalMessage);
    this.rejectAllPending(new Error(fatalMessage.detail));

    if (this.rejectDie !== null) {
      this.rejectDie(new Error(fatalMessage.detail));
      this.resolveDie = null;
      this.rejectDie = null;
      this.diePromise = null;
    }
  };
}
