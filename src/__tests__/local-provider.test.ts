import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PythiaConfig } from "../config.js";
import { LocalReasoningProvider } from "../oracle/local-provider.js";
import { createReasoningProvider } from "../oracle/provider.js";

type FetchOverride = Partial<{
  body: unknown;
  status: number;
  throws: boolean;
}>;

const makeFetch = (overrides: FetchOverride = {}) =>
  async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    if (overrides.throws) {
      throw new TypeError("fetch failed");
    }

    return new Response(JSON.stringify(overrides.body ?? {}), {
      status: overrides.status ?? 200
    });
  };

function createLocalConfig(): Pick<PythiaConfig, "reasoning"> {
  return {
    reasoning: {
      mode: "local",
      ollama_base_url: "http://localhost:11434",
      ollama_model: "llama3"
    }
  };
}

describe("LocalReasoningProvider", () => {
  it("query sends the expected POST payload to the chat completions endpoint", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;

      return new Response(JSON.stringify({
        choices: [{ message: { content: "ok" } }]
      }), { status: 200 });
    };
    const provider = new LocalReasoningProvider("http://localhost:11434", "llama3", fetchImpl);

    await provider.query("Prompt", ["Context A", "Context B"]);

    const body = JSON.parse(String(capturedInit?.body)) as {
      messages: Array<{ content: string; role: string }>;
      model: string;
      stream: boolean;
    };

    assert.equal(capturedUrl, "http://localhost:11434/v1/chat/completions");
    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(capturedInit?.headers, { "Content-Type": "application/json" });
    assert.equal(body.model, "llama3");
    assert.equal(body.messages[0]?.role, "user");
    assert.equal(body.messages[0]?.content, "Prompt\n\nContext A\n\nContext B");
    assert.equal(body.stream, false);
  });

  it("query returns the response content string", async () => {
    const provider = new LocalReasoningProvider(
      "http://localhost:11434",
      "llama3",
      makeFetch({
        body: {
          choices: [{ message: { content: "answer from local model" } }]
        }
      })
    );

    const result = await provider.query("Prompt", ["Context"]);

    assert.equal(result, "answer from local model");
  });

  it("query throws PROVIDER_UNAVAILABLE on network errors", async () => {
    const provider = new LocalReasoningProvider(
      "http://localhost:11434",
      "llama3",
      makeFetch({ throws: true })
    );

    await assert.rejects(
      () => provider.query("Prompt", []),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /PROVIDER_UNAVAILABLE/u);
        assert.match(error.message, /http:\/\/localhost:11434/u);
        return true;
      }
    );
  });

  it("query throws PROVIDER_UNAVAILABLE on non-ok HTTP responses", async () => {
    const provider = new LocalReasoningProvider(
      "http://localhost:11434",
      "llama3",
      makeFetch({ status: 503 })
    );

    await assert.rejects(
      () => provider.query("Prompt", []),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /PROVIDER_UNAVAILABLE/u);
        assert.match(error.message, /HTTP 503/u);
        return true;
      }
    );
  });

  it("healthCheck returns true when the configured model is listed", async () => {
    const provider = new LocalReasoningProvider(
      "http://localhost:11434",
      "llama3",
      makeFetch({
        body: {
          data: [{ id: "phi4" }, { id: "llama3" }]
        }
      })
    );

    const healthy = await provider.healthCheck();

    assert.equal(healthy, true);
  });

  it("healthCheck returns false when the configured model is absent", async () => {
    const provider = new LocalReasoningProvider(
      "http://localhost:11434",
      "llama3",
      makeFetch({
        body: {
          data: [{ id: "phi4" }, { id: "qwen2.5" }]
        }
      })
    );

    const healthy = await provider.healthCheck();

    assert.equal(healthy, false);
  });

  it("healthCheck returns false on network errors", async () => {
    const provider = new LocalReasoningProvider(
      "http://localhost:11434",
      "llama3",
      makeFetch({ throws: true })
    );

    const healthy = await provider.healthCheck();

    assert.equal(healthy, false);
  });

  it("healthCheck returns false on non-ok responses", async () => {
    const provider = new LocalReasoningProvider(
      "http://localhost:11434",
      "llama3",
      makeFetch({ status: 404 })
    );

    const healthy = await provider.healthCheck();

    assert.equal(healthy, false);
  });

  it("healthCheck queries the models endpoint", async () => {
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ data: [{ id: "llama3" }] }), { status: 200 });
    };
    const provider = new LocalReasoningProvider("http://localhost:11434", "llama3", fetchImpl);

    await provider.healthCheck();

    assert.equal(capturedUrl, "http://localhost:11434/v1/models");
  });

  it("describe returns the local provider identity", () => {
    const provider = new LocalReasoningProvider("http://localhost:11434", "test-llama");

    assert.deepEqual(provider.describe(), {
      provider: "local",
      model: "test-llama"
    });
  });

  it("createReasoningProvider returns LocalReasoningProvider for local mode", () => {
    const provider = createReasoningProvider(createLocalConfig());

    assert.ok(provider instanceof LocalReasoningProvider);
    assert.deepEqual(provider.describe(), {
      provider: "local",
      model: "llama3"
    });
  });
});
