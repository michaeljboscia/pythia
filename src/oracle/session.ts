import { randomBytes, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import { argon2id } from "hash-wasm";

import { PythiaError } from "../errors.js";

export type SessionStatus = "active" | "idle" | "dead" | "decommissioned";

export type SessionRow = {
  created_at: string;
  generation_id: number;
  id: string;
  name: string;
  secret_hash: string | null;
  session_secret: string | null;
  status: SessionStatus;
  updated_at: string;
};

export type TranscriptRole = "model" | "system" | "tool" | "user";

export type TranscriptRow = {
  content: string;
  role: TranscriptRole;
  session_id: string;
  timestamp: string;
  turn_index: number;
};

export type SpawnOracleSessionResult =
  | {
    created: true;
    decommission_secret: string;
    generation_id: number;
    session_id: string;
    status: "active";
  }
  | {
    created: false;
    generation_id: number;
    session_id: string;
    status: "active";
  };

type SessionDependencies = {
  generateSecret?: () => string;
  generateSessionId?: () => string;
  hashSecret?: (secret: string) => Promise<string>;
  now?: () => string;
  reconstituteMadrs?: (session: SessionRow, db: Database.Database) => Promise<void>;
};

type SessionActivationDependencies = {
  now?: () => string;
  reconstituteMadrs?: (session: SessionRow, db: Database.Database) => Promise<void>;
};

type ExistingNameRow = {
  generation_id: number;
  id: string;
  status: SessionStatus;
};

type ActiveSessionRow = {
  id: string;
};

type GenerationRow = {
  generation_id: number | null;
};

const DEFAULT_RECONSTITUTE = async () => undefined;

export function generateSecret(): string {
  return randomBytes(16).toString("hex");
}

export async function hashDecommissionSecret(secret: string): Promise<string> {
  return await argon2id({
    password: secret,
    salt: randomBytes(16),
    iterations: 3,
    memorySize: 65536,
    parallelism: 1,
    hashLength: 32,
    outputType: "encoded"
  });
}

function beginImmediate(db: Database.Database): void {
  db.prepare("BEGIN IMMEDIATE").run();
}

function commit(db: Database.Database): void {
  db.prepare("COMMIT").run();
}

function rollback(db: Database.Database): void {
  db.prepare("ROLLBACK").run();
}

export function getSessionById(
  sessionId: string,
  db: Database.Database
): SessionRow | undefined {
  return db.prepare(`
    SELECT id, name, status, generation_id, secret_hash, session_secret, created_at, updated_at
    FROM pythia_sessions
    WHERE id = ?
  `).get(sessionId) as SessionRow | undefined;
}

export function getNextTurnIndex(sessionId: string, db: Database.Database): number {
  const row = db.prepare(`
    SELECT MAX(turn_index) AS turn_index
    FROM pythia_transcripts
    WHERE session_id = ?
  `).get(sessionId) as { turn_index: number | null };

  return (row.turn_index ?? -1) + 1;
}

export function appendTranscriptTurn(
  sessionId: string,
  role: TranscriptRole,
  content: string,
  db: Database.Database,
  timestamp: string,
  turnIndex = getNextTurnIndex(sessionId, db)
): number {
  db.prepare(`
    INSERT INTO pythia_transcripts(session_id, turn_index, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, turnIndex, role, content, timestamp);

  return turnIndex;
}

export function listTranscriptRows(sessionId: string, db: Database.Database): TranscriptRow[] {
  return db.prepare(`
    SELECT session_id, turn_index, role, content, timestamp
    FROM pythia_transcripts
    WHERE session_id = ?
    ORDER BY turn_index
  `).all(sessionId) as TranscriptRow[];
}

export function touchSession(
  sessionId: string,
  db: Database.Database,
  now: string,
  status: SessionStatus = "active"
): void {
  db.prepare(`
    UPDATE pythia_sessions
    SET status = ?,
        updated_at = ?
    WHERE id = ?
  `).run(status, now, sessionId);
}

async function activateIdleSession(
  session: SessionRow,
  db: Database.Database,
  now: string,
  reconstituteMadrs: (session: SessionRow, db: Database.Database) => Promise<void>
): Promise<void> {
  await reconstituteMadrs(session, db);

  beginImmediate(db);

  try {
    db.prepare(`
      UPDATE pythia_sessions
      SET status = 'active',
          updated_at = ?
      WHERE id = ?
        AND status = 'idle'
    `).run(now, session.id);
    commit(db);
  } catch (error) {
    rollback(db);
    throw error;
  }
}

export async function ensureSessionActive(
  sessionId: string,
  db: Database.Database,
  dependencies: SessionActivationDependencies = {}
): Promise<SessionRow> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const reconstituteMadrs = dependencies.reconstituteMadrs ?? DEFAULT_RECONSTITUTE;
  const session = getSessionById(sessionId, db);

  if (session === undefined || session.status === "decommissioned" || session.status === "dead") {
    throw new PythiaError("SESSION_NOT_FOUND", sessionId);
  }

  if (session.status === "idle") {
    await activateIdleSession(session, db, now(), reconstituteMadrs);
  } else {
    touchSession(sessionId, db, now(), "active");
  }

  const updatedSession = getSessionById(sessionId, db);

  if (updatedSession === undefined) {
    throw new PythiaError("SESSION_NOT_FOUND", sessionId);
  }

  return updatedSession;
}

export async function spawnOracleSession(
  name: string,
  db: Database.Database,
  dependencies: SessionDependencies = {}
): Promise<SpawnOracleSessionResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const generateSessionId = dependencies.generateSessionId ?? (() => randomUUID());
  const generateSecretImpl = dependencies.generateSecret ?? generateSecret;
  const hashSecret = dependencies.hashSecret ?? hashDecommissionSecret;
  const reconstituteMadrs = dependencies.reconstituteMadrs ?? DEFAULT_RECONSTITUTE;
  const createdAt = now();
  const secret = generateSecretImpl();
  const secretHash = await hashSecret(secret);
  let transactionActive = false;

  beginImmediate(db);
  transactionActive = true;

  try {
    const existingByName = db.prepare(`
      SELECT id, status, generation_id
      FROM pythia_sessions
      WHERE name = ?
        AND status IN ('active', 'idle')
      LIMIT 1
    `).get(name) as ExistingNameRow | undefined;

    if (existingByName !== undefined) {
      commit(db);
      transactionActive = false;

      if (existingByName.status === "idle") {
        const session = getSessionById(existingByName.id, db);

        if (session === undefined) {
          throw new PythiaError("SESSION_NOT_FOUND", existingByName.id);
        }

        await activateIdleSession(session, db, now(), reconstituteMadrs);
      }

      return {
        session_id: existingByName.id,
        status: "active",
        created: false,
        generation_id: existingByName.generation_id
      };
    }

    const activeSession = db.prepare(`
      SELECT id
      FROM pythia_sessions
      WHERE status = 'active'
      LIMIT 1
    `).get() as ActiveSessionRow | undefined;

    if (activeSession !== undefined) {
      throw new PythiaError("SESSION_ALREADY_ACTIVE", activeSession.id);
    }

    const nextGeneration = db.prepare(`
      SELECT MAX(generation_id) AS generation_id
      FROM pythia_sessions
      WHERE name = ?
    `).get(name) as GenerationRow;
    const generationId = (nextGeneration.generation_id ?? 0) + 1;
    const sessionId = generateSessionId();

    db.prepare(`
      INSERT INTO pythia_sessions(
        id,
        name,
        status,
        generation_id,
        secret_hash,
        session_secret,
        created_at,
        updated_at
      )
      VALUES (?, ?, 'active', ?, ?, NULL, ?, ?)
    `).run(
      sessionId,
      name,
      generationId,
      secretHash,
      createdAt,
      createdAt
    );
    commit(db);
    transactionActive = false;

    return {
      session_id: sessionId,
      status: "active",
      created: true,
      generation_id: generationId,
      decommission_secret: secret
    };
  } catch (error) {
    if (transactionActive) {
      rollback(db);
    }
    throw error;
  }
}
