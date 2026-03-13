# Sprint 9 — Worker A: LocalReasoningProvider + describe() Interface

You are implementing FEAT-037 for Pythia v1, a TypeScript MCP server for RAG code indexing.
Working directory: `/Users/mikeboscia/pythia`
Tech stack: TypeScript 5.x, Node.js 22 LTS, ESM (`"module": "NodeNext"`), `verbatimModuleSyntax: true`, `node:test` framework (NOT Jest).
Run tests with: `npm test`
All tests must pass before you are done. Current baseline: **328 tests passing**.
Your gate: **`npm test` shows ≥ 338 passing** (328 + ≥10 new).

---

## What You Are Building

Add `LocalReasoningProvider` — a third `ReasoningProvider` implementation that hits any OpenAI-compatible HTTP endpoint (Ollama, LM Studio) instead of calling Gemini. This makes Pythia fully sovereign: zero external network calls when configured.

You are also adding `describe()` to the `ReasoningProvider` interface so oracle transcripts correctly record which provider and model answered, instead of the hardcoded `"gemini-2.5-flash"` currently in `ask-oracle.ts`.

---

## Files You Own

**Create:**
- `src/oracle/local-provider.ts`
- `src/__tests__/local-provider.test.ts`

**Modify:**
- `src/config.ts`
- `src/oracle/provider.ts`
- `src/oracle/cli-provider.ts`
- `src/oracle/sdk-provider.ts`
- `src/mcp/ask-oracle.ts`
- `src/__tests__/ask-oracle.test.ts`

**Do not touch:** Any MCP tool registration files, any chunker files, `package.json`.

---

## Step 1 — Add `local` mode to config schema (`src/config.ts`)

Read `src/config.ts` first. Find the `reasoning` discriminated union (it has `"cli"` and `"sdk"` branches). Add a third branch:

```typescript
z.object({
  mode: z.literal("local"),
  ollama_base_url: z.string().url().default("http://localhost:11434"),
  ollama_model: z.string().min(1)   // required — no default
})
```

No other changes to `src/config.ts` in this step.

---

## Step 2 — Add `describe()` to the interface (`src/oracle/provider.ts`)

Read `src/oracle/provider.ts`. The interface currently has two methods. Add a third:

```typescript
export interface ReasoningProvider {
  query(prompt: string, context: string[]): Promise<string>;
  healthCheck(): Promise<boolean>;
  describe(): { provider: string; model: string };
}
```

Also add the third factory branch at the end of `createReasoningProvider()` (before the final `return new CliReasoningProvider()`):

```typescript
if (config.reasoning.mode === "local") {
  return new LocalReasoningProvider(
    config.reasoning.ollama_base_url,
    config.reasoning.ollama_model
  );
}
```

Add the import at the top of the file:
```typescript
import { LocalReasoningProvider } from "./local-provider.js";
```

---

## Step 3 — Add `describe()` to existing providers

**`src/oracle/cli-provider.ts`** — read the file, find the `CliReasoningProvider` class, add at the end of the class body:
```typescript
describe(): { provider: string; model: string } {
  return { provider: "gemini-cli", model: "gemini" };
}
```

**`src/oracle/sdk-provider.ts`** — read the file, find the `SdkReasoningProvider` class, add at the end of the class body:
```typescript
describe(): { provider: string; model: string } {
  return { provider: "gemini-sdk", model: "gemini-2.5-flash" };
}
```

---

## Step 4 — Fix hardcoded model in `src/mcp/ask-oracle.ts`

Read `src/mcp/ask-oracle.ts`. Find the `appendTranscriptTurn` call that currently has `model: "gemini-2.5-flash"` hardcoded (around line 211). Replace that property with a spread of `provider.describe()`:

```typescript
// BEFORE (the exact line to replace):
            model: "gemini-2.5-flash",
// AFTER:
            ...provider.describe(),
```

The surrounding object should now look like:
```typescript
JSON.stringify({
  text: providerResponse,
  provider: provider.constructor.name,   // this line already exists, keep it
  ...provider.describe(),                // replaces the hardcoded model line
  finish_reason: "stop"
})
```

---

## Step 5 — Update mocks in `src/__tests__/ask-oracle.test.ts`

Read `src/__tests__/ask-oracle.test.ts`. Find every object literal that implements `ReasoningProvider` (there are four of them — search for `query:` or `healthCheck:` in the test file). Add `describe` to each one:

```typescript
describe: () => ({ provider: "test", model: "test-model" }),
```

Without this, TypeScript will refuse to compile the test file because the interface now requires three methods.

---

## Step 6 — Create `src/oracle/local-provider.ts`

```typescript
import type { ReasoningProvider } from "./provider.js";

export class LocalReasoningProvider implements ReasoningProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  async query(prompt: string, context: string[]): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      messages: [{ role: "user", content: [prompt, ...context].join("\n\n") }],
      stream: false
    });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
    } catch (err) {
      throw new Error(`PROVIDER_UNAVAILABLE: local provider unreachable at ${this.baseUrl}: ${String(err)}`);
    }

    if (!response.ok) {
      throw new Error(`PROVIDER_UNAVAILABLE: /v1/chat/completions returned HTTP ${response.status}`);
    }

    const json = await response.json() as { choices: Array<{ message: { content: string } }> };
    return json.choices[0].message.content;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/models`);
      if (!response.ok) { return false; }
      const json = await response.json() as { data: Array<{ id: string }> };
      return json.data.some((m) => m.id === this.model);
    } catch {
      return false;
    }
  }

  describe(): { provider: string; model: string } {
    return { provider: "local", model: this.model };
  }
}
```

---

## Step 7 — Write `src/__tests__/local-provider.test.ts`

Use `node:test` and `node:assert`. Do NOT use Jest. Import pattern: `import { describe, it } from "node:test"; import assert from "node:assert/strict";`

Write ≥10 tests covering:

1. **`query()` sends correct payload** — stub fetchImpl, assert the POST body contains `model`, `messages[0].role === "user"`, and that prompt + context are joined with `\n\n`.
2. **`query()` returns content string** — stub returns valid completions JSON, assert returned value equals `choices[0].message.content`.
3. **`query()` throws PROVIDER_UNAVAILABLE on network error** — stub throws `new TypeError("fetch failed")`, assert caught error message contains `PROVIDER_UNAVAILABLE`.
4. **`query()` throws PROVIDER_UNAVAILABLE on non-ok HTTP** — stub returns `new Response("", { status: 503 })`, assert error message contains `PROVIDER_UNAVAILABLE`.
5. **`healthCheck()` returns true when model present** — stub returns models list containing the model name, assert `true`.
6. **`healthCheck()` returns false when model absent** — stub returns models list without the model, assert `false`.
7. **`healthCheck()` returns false on network error** — stub throws, assert `false` (no throw).
8. **`healthCheck()` returns false on non-ok response** — stub returns `{ status: 404 }`, assert `false`.
9. **`describe()` returns correct shape** — assert `{ provider: "local", model: "test-llama" }`.
10. **`createReasoningProvider` factory** — import `createReasoningProvider` from `src/oracle/provider.ts`, create a config with `mode: "local"`, `ollama_model: "llama3"`, assert returned instance is `LocalReasoningProvider`.

Stub pattern for fetchImpl:
```typescript
const makeFetch = (overrides: Partial<{ status: number; body: unknown; throws: boolean }> = {}) =>
  async (_url: string, _init?: RequestInit): Promise<Response> => {
    if (overrides.throws) { throw new TypeError("fetch failed"); }
    return new Response(JSON.stringify(overrides.body ?? {}), { status: overrides.status ?? 200 });
  };
```

---

## Verification

Run `npm test`. All 328 existing tests must still pass. You should have ≥338 total.

If TypeScript compilation fails, the most likely cause is a `ReasoningProvider` mock in `ask-oracle.test.ts` that is missing `describe()`. Search for all object literals implementing the interface and add it.
