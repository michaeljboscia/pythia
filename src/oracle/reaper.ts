import type Database from "better-sqlite3";

import { appendTranscriptTurn, touchSession } from "./session.js";

type TimerHandle = ReturnType<typeof setTimeout>;

type DismissFn = (sessionId: string) => Promise<void>;

async function defaultDismissFactory(
  db: Database.Database,
  now: () => string
): Promise<DismissFn> {
  return async (sessionId: string) => {
    const timestamp = now();
    touchSession(sessionId, db, timestamp, "idle");
    appendTranscriptTurn(
      sessionId,
      "system",
      JSON.stringify({
        kind: "reaper_notice",
        text: "Session moved to idle after inactivity."
      }),
      db,
      timestamp
    );
  };
}

export class SessionReaper {
  private readonly dismissImpl: DismissFn;
  private readonly timers = new Map<string, TimerHandle>();
  private readonly ttlMs: number;

  constructor(
    db: Database.Database,
    ttlMinutes: number,
    options: {
      dismissImpl?: DismissFn;
      now?: () => string;
    } = {}
  ) {
    this.ttlMs = ttlMinutes * 60_000;
    const now = options.now ?? (() => new Date().toISOString());
    this.dismissImpl = options.dismissImpl ?? ((sessionId) => defaultDismissFactory(db, now).then((dismiss) => dismiss(sessionId)));
  }

  touch(sessionId: string): void {
    this.cancel(sessionId);

    const timer = setTimeout(() => {
      void this.dismissImpl(sessionId).catch((error) => {
        console.error("[reaper] failed to dismiss idle session:", error);
      });
    }, this.ttlMs);

    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  close(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }
}
