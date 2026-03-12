import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../config.js";
import { PythiaError } from "../errors.js";

function writeConfigFile(config: object): { cleanup: () => void; configPath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "pythia-config-"));
  const configPath = path.join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    configPath
  };
}

function createValidConfig(): Record<string, unknown> {
  return {
    workspace_path: "/Users/mikeboscia/pythia",
    reasoning: {
      mode: "cli"
    },
    embeddings: {
      mode: "local"
    },
    vector_store: {
      mode: "sqlite"
    },
    graph_store: {
      mode: "sqlite"
    },
    limits: {
      spawn_chars_max: 180000,
      ask_context_chars_max: 48000,
      session_idle_ttl_minutes: 30
    },
    indexing: {
      scan_on_start: true,
      max_worker_restarts: 3
    },
    gc: {
      deleted_chunk_retention_days: 30
    }
  };
}

test("valid config parses cleanly", () => {
  const { cleanup, configPath } = writeConfigFile(createValidConfig());

  try {
    const config = loadConfig(configPath);
    assert.equal(config.workspace_path, "/Users/mikeboscia/pythia");
    assert.equal(config.reasoning.mode, "cli");
    assert.equal(config.vector_store.mode, "sqlite");
  } finally {
    cleanup();
  }
});

test("indexing defaults include embedding batch and concurrency settings", () => {
  const { cleanup, configPath } = writeConfigFile(createValidConfig());

  try {
    const config = loadConfig(configPath);
    assert.equal(config.indexing.embedding_batch_size, 32);
    assert.equal(config.indexing.embedding_concurrency, 1);
  } finally {
    cleanup();
  }
});

test("missing required field throws with CONFIG_INVALID", () => {
  const invalidConfig = createValidConfig();
  delete invalidConfig.workspace_path;

  const { cleanup, configPath } = writeConfigFile(invalidConfig);

  try {
    assert.throws(
      () => loadConfig(configPath),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "CONFIG_INVALID");
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

test("openai_compatible embeddings mode parses with required subfields", () => {
  const config = createValidConfig();
  config.embeddings = {
    mode: "openai_compatible",
    base_url: "http://192.168.2.110:11434/v1",
    api_key: "ollama",
    model: "nomic-embed-text"
  };

  const { cleanup, configPath } = writeConfigFile(config);

  try {
    const result = loadConfig(configPath);
    assert.equal(result.embeddings.mode, "openai_compatible");
    if (result.embeddings.mode === "openai_compatible") {
      assert.equal(result.embeddings.base_url, "http://192.168.2.110:11434/v1");
      assert.equal(result.embeddings.model, "nomic-embed-text");
    }
  } finally {
    cleanup();
  }
});

test("openai_compatible embeddings missing base_url throws CONFIG_INVALID", () => {
  const config = createValidConfig();
  config.embeddings = {
    mode: "openai_compatible",
    api_key: "ollama",
    model: "nomic-embed-text"
    // base_url intentionally omitted
  };

  const { cleanup, configPath } = writeConfigFile(config);

  try {
    assert.throws(
      () => loadConfig(configPath),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "CONFIG_INVALID");
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

test("voyage embeddings mode is rejected as CONFIG_INVALID", () => {
  const config = createValidConfig();
  config.embeddings = {
    mode: "voyage",
    model: "voyage-code-2"
  };

  const { cleanup, configPath } = writeConfigFile(config);

  try {
    assert.throws(
      () => loadConfig(configPath),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "CONFIG_INVALID");
        return true;
      }
    );
  } finally {
    cleanup();
  }
});

test("unknown fields strip without error", () => {
  const configWithUnknownFields = createValidConfig();
  configWithUnknownFields.extra = "ignore-me";
  configWithUnknownFields.reasoning = {
    mode: "sdk",
    nested_extra: "ignore-me-too"
  };

  const { cleanup, configPath } = writeConfigFile(configWithUnknownFields);

  try {
    const config = loadConfig(configPath);
    assert.equal("extra" in config, false);
    assert.equal(config.reasoning.mode, "sdk");
    assert.equal("nested_extra" in config.reasoning, false);
    assert.equal("gemini_api_key" in config.reasoning, false);
  } finally {
    cleanup();
  }
});

test("embedding dimensions outside the allowed set throw CONFIG_INVALID", () => {
  const config = createValidConfig();
  config.embeddings = {
    mode: "openai_compatible",
    dimensions: 900,
    base_url: "http://192.168.2.110:11434/v1",
    api_key: "ollama",
    model: "nomic-embed-text"
  };

  const { cleanup, configPath } = writeConfigFile(config);

  try {
    assert.throws(
      () => loadConfig(configPath),
      (error: unknown) => {
        assert.ok(error instanceof PythiaError);
        assert.equal(error.code, "CONFIG_INVALID");
        return true;
      }
    );
  } finally {
    cleanup();
  }
});
