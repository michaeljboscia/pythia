import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openDb } from "../db/connection.js";
import { assertEmbeddingMetaCompatible, readEmbeddingMeta, writeEmbeddingMetaOnce } from "../db/embedding-meta.js";
import { runMigrations } from "../db/migrate.js";
import { PythiaError } from "../errors.js";

function createTestDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "pythia-embedding-meta-"));
  const dbPath = path.join(dir, "lcs.db");
  const db = openDb(dbPath);
  runMigrations(db);

  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("readEmbeddingMeta returns null on a fresh database", () => {
  const { db, cleanup } = createTestDb();

  try {
    assert.equal(readEmbeddingMeta(db), null);
  } finally {
    cleanup();
  }
});

test("writeEmbeddingMetaOnce writes local fingerprint correctly", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, { mode: "local" });
    const meta = readEmbeddingMeta(db);

    assert.ok(meta !== null);
    assert.equal(meta.provider, "local");
    assert.equal(meta.model_name, "nomic-ai/nomic-embed-text-v1.5");
    assert.equal(meta.model_revision, "fp32");
    assert.equal(meta.dimensions, 256);
    assert.equal(meta.normalization, "l2");
    assert.ok(meta.indexed_at.length > 0);
  } finally {
    cleanup();
  }
});

test("writeEmbeddingMetaOnce writes openai_compatible fingerprint correctly", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, {
      mode: "openai_compatible",
      base_url: "http://192.168.2.110:11434/v1",
      api_key: "ollama",
      model: "nomic-embed-text"
    });
    const meta = readEmbeddingMeta(db);

    assert.ok(meta !== null);
    assert.equal(meta.provider, "openai_compatible");
    assert.equal(meta.model_name, "nomic-embed-text");
    assert.equal(meta.model_revision, "http://192.168.2.110:11434/v1");
    assert.equal(meta.dimensions, 256);
  } finally {
    cleanup();
  }
});

test("writeEmbeddingMetaOnce is idempotent — second call does not overwrite", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, { mode: "local" });
    const firstMeta = readEmbeddingMeta(db);

    // Small delay would change indexed_at if OR REPLACE was used — but OR IGNORE leaves it untouched
    writeEmbeddingMetaOnce(db, { mode: "local" });
    const secondMeta = readEmbeddingMeta(db);

    assert.ok(firstMeta !== null);
    assert.ok(secondMeta !== null);
    assert.equal(firstMeta.indexed_at, secondMeta.indexed_at);
  } finally {
    cleanup();
  }
});

test("assertEmbeddingMetaCompatible passes when no meta row exists", () => {
  const { db, cleanup } = createTestDb();

  try {
    // Should not throw on empty DB
    assert.doesNotThrow(() =>
      assertEmbeddingMetaCompatible(db, { mode: "local" })
    );
  } finally {
    cleanup();
  }
});

test("assertEmbeddingMetaCompatible passes when fingerprint matches", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, { mode: "local" });

    assert.doesNotThrow(() =>
      assertEmbeddingMetaCompatible(db, { mode: "local" })
    );
  } finally {
    cleanup();
  }
});

test("assertEmbeddingMetaCompatible throws FULL_REINDEX_REQUIRED on provider mismatch", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, { mode: "local" });

    assert.throws(
      () =>
        assertEmbeddingMetaCompatible(db, {
          mode: "openai_compatible",
          base_url: "http://192.168.2.110:11434/v1",
          api_key: "ollama",
          model: "nomic-embed-text"
        }),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "FULL_REINDEX_REQUIRED");
        assert.ok(error.message.includes("local"));
        assert.ok(error.message.includes("openai_compatible"));
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

test("writeEmbeddingMetaOnce writes vertex_ai fingerprint correctly", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, {
      mode: "vertex_ai",
      project: "my-project",
      location: "us-central1",
      model: "text-embedding-005"
    });
    const meta = readEmbeddingMeta(db);

    assert.ok(meta !== null);
    assert.equal(meta.provider, "vertex_ai");
    assert.equal(meta.model_name, "my-project/us-central1/text-embedding-005");
    assert.equal(meta.model_revision, "");
    assert.equal(meta.dimensions, 256);
    assert.equal(meta.normalization, "l2");
  } finally {
    cleanup();
  }
});

test("assertEmbeddingMetaCompatible throws FULL_REINDEX_REQUIRED on model name mismatch", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, {
      mode: "openai_compatible",
      base_url: "http://192.168.2.110:11434/v1",
      api_key: "ollama",
      model: "nomic-embed-text"
    });

    assert.throws(
      () =>
        assertEmbeddingMetaCompatible(db, {
          mode: "openai_compatible",
          base_url: "http://192.168.2.110:11434/v1",
          api_key: "ollama",
          model: "mxbai-embed-large"  // different model
        }),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "FULL_REINDEX_REQUIRED");
        assert.ok(error.message.includes("nomic-embed-text"));
        assert.ok(error.message.includes("mxbai-embed-large"));
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

test("writeEmbeddingMetaOnce persists configured dimensions", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, {
      mode: "openai_compatible",
      dimensions: 512,
      base_url: "http://192.168.2.110:11434/v1",
      api_key: "ollama",
      model: "nomic-embed-text"
    });
    const meta = readEmbeddingMeta(db);

    assert.ok(meta !== null);
    assert.equal(meta.dimensions, 512);
  } finally {
    cleanup();
  }
});

test("assertEmbeddingMetaCompatible throws FULL_REINDEX_REQUIRED on dimension mismatch", () => {
  const { db, cleanup } = createTestDb();

  try {
    writeEmbeddingMetaOnce(db, {
      mode: "openai_compatible",
      dimensions: 256,
      base_url: "http://192.168.2.110:11434/v1",
      api_key: "ollama",
      model: "nomic-embed-text"
    });

    assert.throws(
      () =>
        assertEmbeddingMetaCompatible(db, {
          mode: "openai_compatible",
          dimensions: 512,
          base_url: "http://192.168.2.110:11434/v1",
          api_key: "ollama",
          model: "nomic-embed-text"
        }),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "FULL_REINDEX_REQUIRED");
        assert.ok(error.message.includes("dimensions=256"));
        assert.ok(error.message.includes("dimensions=512"));
        return true;
      }
    );
  } finally {
    cleanup();
  }
});
