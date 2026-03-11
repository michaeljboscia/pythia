import assert from "node:assert/strict";
import test from "node:test";

import type { PythiaConfig } from "../config.js";
import { CliReasoningProvider } from "../oracle/cli-provider.js";
import { createReasoningProvider } from "../oracle/provider.js";
import { SdkReasoningProvider } from "../oracle/sdk-provider.js";

function createConfig(mode: PythiaConfig["reasoning"]["mode"]): Pick<PythiaConfig, "reasoning"> {
  if (mode === "sdk") {
    return {
      reasoning: {
        mode: "sdk"
      }
    };
  }

  return {
    reasoning: {
      mode: "cli"
    }
  };
}

test("SDK provider selected when sdk mode and GEMINI_API_KEY are present", () => {
  const provider = createReasoningProvider(createConfig("sdk"), {
    GEMINI_API_KEY: "env-key"
  });

  assert.ok(provider instanceof SdkReasoningProvider);
});

test("CLI provider selected when sdk mode but GEMINI_API_KEY is absent", () => {
  const provider = createReasoningProvider(createConfig("sdk"), {});

  assert.ok(provider instanceof CliReasoningProvider);
});

test("all reasoning providers implement the interface contract", async () => {
  const cliProvider = new CliReasoningProvider({
    runner: async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({ response: "cli" })
    })
  });
  const sdkProvider = new SdkReasoningProvider("sdk-key", () => ({
    models: {
      generateContent: async () => ({
        text: "sdk"
      })
    }
  }));

  assert.equal(typeof cliProvider.query, "function");
  assert.equal(typeof cliProvider.healthCheck, "function");
  assert.equal(typeof sdkProvider.query, "function");
  assert.equal(typeof sdkProvider.healthCheck, "function");
  assert.equal(await cliProvider.query("prompt", []), "cli");
  assert.equal(await sdkProvider.query("prompt", ["ctx"]), "sdk");
});
