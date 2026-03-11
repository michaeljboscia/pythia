export type MainToWorker =
  | { type: "INDEX_BATCH"; batch_id: string; files: string[]; reason: "boot" | "warm" | "force" }
  | { type: "PAUSE"; batch_id?: string }
  | { type: "RESUME" }
  | { type: "DIE" }
  | { type: "PING" };

export type WorkerToMain =
  | { type: "ACK"; ack: "INDEX_BATCH" | "PAUSE" | "RESUME" | "DIE" | "PING"; batch_id?: string }
  | { type: "BATCH_STARTED"; batch_id: string; total_files: number }
  | { type: "BATCH_COMPLETE"; batch_id: string; succeeded: number; failed: number; duration_ms: number }
  | { type: "FILE_FAILED"; batch_id: string; file: string; error_code: string; detail: string }
  | { type: "PAUSED"; batch_id?: string }
  | { type: "HEARTBEAT"; batch_id?: string; timestamp: string; in_flight_file?: string }
  | { type: "FATAL"; batch_id?: string; error_code: string; detail: string };
