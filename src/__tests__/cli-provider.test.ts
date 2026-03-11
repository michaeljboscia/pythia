import assert from "node:assert/strict";
import test from "node:test";

import { PythiaError } from "../errors.js";
import { CliReasoningProvider } from "../oracle/cli-provider.js";

test("three failures raise PROVIDER_UNAVAILABLE after exponential backoff", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const provider = new CliReasoningProvider({
    runner: async () => {
      attempts += 1;
      return {
        code: 1,
        stdout: "",
        stderr: "temporary failure"
      };
    },
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
    }
  });

  await assert.rejects(
    provider.query("prompt", ["context"]),
    (error: unknown) => {
      assert.ok(error instanceof PythiaError);
      assert.equal(error.code, "PROVIDER_UNAVAILABLE");
      return true;
    }
  );

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1000, 5000]);
});

test("AUTH_INVALID fails immediately without retry", async () => {
  let attempts = 0;
  const provider = new CliReasoningProvider({
    runner: async () => {
      attempts += 1;
      return {
        code: 1,
        stdout: "",
        stderr: "GEMINI_API_KEY missing"
      };
    },
    sleepImpl: async () => {
      throw new Error("sleep should not be called");
    }
  });

  await assert.rejects(
    provider.query("prompt", []),
    (error: unknown) => {
      assert.ok(error instanceof PythiaError);
      assert.equal(error.code, "AUTH_INVALID");
      return true;
    }
  );

  assert.equal(attempts, 1);
});

test("success on attempt two returns parsed response", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const provider = new CliReasoningProvider({
    runner: async () => {
      attempts += 1;

      if (attempts === 1) {
        return {
          code: 1,
          stdout: "",
          stderr: "temporary failure"
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({ response: "done" }),
        stderr: ""
      };
    },
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
    }
  });

  const response = await provider.query("prompt", ["context"]);

  assert.equal(response, "done");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [1000]);
});
