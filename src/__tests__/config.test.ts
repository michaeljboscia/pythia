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
      mode: "local",
      model: "nomic-embed-text-v1.5",
      revision: "main"
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

test("unknown fields strip without error", () => {
  const configWithUnknownFields = createValidConfig();
  configWithUnknownFields.extra = "ignore-me";
  configWithUnknownFields.reasoning = {
    mode: "sdk",
    gemini_api_key: "test-key",
    nested_extra: "ignore-me-too"
  };

  const { cleanup, configPath } = writeConfigFile(configWithUnknownFields);

  try {
    const config = loadConfig(configPath);
    assert.equal("extra" in config, false);
    assert.equal(config.reasoning.mode, "sdk");
    assert.equal("nested_extra" in config.reasoning, false);
    assert.equal(config.reasoning.gemini_api_key, "test-key");
  } finally {
    cleanup();
  }
});
