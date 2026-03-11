# MCP TypeScript SDK — Tool Registration Reference

The `@modelcontextprotocol/sdk` package is the official TypeScript SDK for building MCP servers.
Tools are the primary way LLMs call into your server. This doc covers `McpServer` + `registerTool()`
+ `StdioServerTransport` — the pattern for local stdio-based servers (Claude Desktop, CLI tools).

Sources: [typescript-sdk README](https://github.com/modelcontextprotocol/typescript-sdk) ·
[docs/server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) ·
[McpError/ErrorCode reference](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/types.ts)

---

## Install

```bash
npm install @modelcontextprotocol/sdk zod
```

The SDK has a required peer dependency on `zod`. It internally uses Zod v4 but maintains
backwards compatibility with Zod v3.25+. Use whichever you have.

---

## Complete Minimal Working Server

```ts
#!/usr/bin/env node
// src/index.ts

// McpServer — the high-level server class. Import path MUST include `.js` extension (ESM).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// StdioServerTransport — wires McpServer to process.stdin / process.stdout.
// Used for local servers spawned as subprocesses (Claude Desktop, CLI tools).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// McpError and ErrorCode — for throwing protocol-level errors from tool handlers.
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Zod — used for input schema validation. The SDK converts Zod schemas to JSON Schema
// internally; you never write raw JSON Schema for tool inputs.
import { z } from "zod";

// --- Create the server ---
const server = new McpServer({
  name: "pythia-mcp-server",  // human-readable name, shown in Claude Desktop
  version: "1.0.0",
});

// --- Register a tool ---
// server.registerTool() is the canonical method (replaces the older server.tool() shorthand).
// Signature: registerTool(name, metadata, handler)
server.registerTool(
  // 1. Tool name — must be unique, snake_case by convention
  "lookup_merchant",

  // 2. Metadata object
  {
    title: "Lookup Merchant",                    // display name (optional but recommended)
    description: "Look up a merchant by domain and return their PSI score and tech stack.", // shown to the LLM
    inputSchema: {
      // inputSchema is a PLAIN OBJECT of Zod field schemas — NOT z.object({...})
      // Each key becomes a parameter. The SDK wraps this in z.object() automatically.
      domain: z.string().describe("The merchant domain, e.g. 'example.com'"),
      include_stack: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to include tech stack in the response"),
    },
    // outputSchema is optional — only needed for structured machine-readable output
    // outputSchema: { score: z.number(), stack: z.array(z.string()) },
  },

  // 3. Handler — always async, destructure the validated params directly
  async ({ domain, include_stack }) => {
    // Tool handlers CAN and SHOULD use await — they are fully async.
    // The SDK awaits the returned Promise before sending the response.

    // ⚠️  CRITICAL: NEVER use console.log() in a stdio server.
    // stdout is reserved for JSON-RPC protocol messages. Any non-JSON written to stdout
    // will corrupt the protocol stream. Always log to stderr:
    console.error(`[lookup_merchant] Looking up ${domain}`);

    // --- Validation / guard example ---
    if (!domain.includes(".")) {
      // Throw McpError for protocol-level errors the client can handle.
      // ErrorCode.InvalidParams = JSON-RPC -32602 — bad input from the caller.
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid domain: "${domain}" — must include a TLD (e.g. "example.com")`
      );
    }

    // --- Do your actual work (database query, API call, etc.) ---
    const result = await fetchMerchantData(domain, include_stack);

    if (!result) {
      throw new McpError(
        ErrorCode.InternalError,  // JSON-RPC -32603 — unexpected server-side failure
        `No data found for domain: ${domain}`
      );
    }

    // --- Return a text response ---
    // content is an array of content blocks. For text, use type: 'text'.
    // This is what the LLM sees as the tool result.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
);

// --- Wire stdio transport ---
async function main() {
  const transport = new StdioServerTransport();
  // server.connect() is async — await it before any other work.
  // After this returns, the server is live and reading from process.stdin.
  await server.connect(transport);
  // Don't console.log here — stdout is now the protocol channel.
  console.error("[pythia-mcp-server] Running on stdio");
}

main().catch((err) => {
  console.error("[pythia-mcp-server] Fatal:", err);
  process.exit(1);
});

// --- Stub for example ---
async function fetchMerchantData(domain: string, includeStack: boolean) {
  return { domain, psi_score: 72, stack: includeStack ? ["Magento", "Fastly"] : undefined };
}
```

---

## McpError — When and How to Throw

`McpError` sends a JSON-RPC error response to the client. The client receives a structured
error with a numeric code. Use it for conditions the caller should handle programmatically.

```ts
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Signature: new McpError(code: ErrorCode, message: string, data?: unknown)

// --- Common ErrorCodes ---

// InvalidParams (-32602): caller sent bad input (wrong type, out of range, missing field)
throw new McpError(ErrorCode.InvalidParams, "domain is required");

// InternalError (-32603): unexpected server-side failure
throw new McpError(ErrorCode.InternalError, "Database query failed");

// InvalidRequest (-32600): the request itself is malformed or violates a constraint
throw new McpError(ErrorCode.InvalidRequest, "Cannot query archived merchants");

// MethodNotFound (-32601): rarely needed from tool handlers; used at the transport level
// RequestTimeout (-32001): used by the SDK internally; rarely thrown by user code

// --- Third argument: optional structured error data ---
throw new McpError(
  ErrorCode.InvalidParams,
  "Invalid domain format",
  { received: domain, expected: "example.com" }  // passed back to client in error.data
);

// --- In a real handler: re-throw McpError, wrap everything else ---
async ({ domain }) => {
  try {
    const result = await riskyOperation(domain);
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    // Don't rewrap an already-correct McpError
    if (err instanceof McpError) throw err;
    // Wrap unexpected errors so the client gets a clean protocol response
    throw new McpError(
      ErrorCode.InternalError,
      `Operation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
```

---

## Tool Return Shape

```ts
// Minimal text response — this is all you need in most cases
return {
  content: [{ type: "text", text: "your result here" }],
};

// Multiple content blocks (text + image, multiple sections, etc.)
return {
  content: [
    { type: "text", text: "## Summary\n\nHere are the results:" },
    { type: "text", text: JSON.stringify(data) },
  ],
};

// Soft error — tool completed but the operation failed.
// isError: true signals the LLM that this is an error result, not success.
// Use this when you want the LLM to see the error message and reason about it.
// Use throw McpError when the entire tool call was invalid (bad input, unrecoverable).
return {
  content: [{ type: "text", text: "Merchant not found in database." }],
  isError: true,
};

// Structured output — for machine-readable results alongside text
// Requires a matching outputSchema in the tool metadata.
const output = { score: 72, stack: ["Magento"] };
return {
  content: [{ type: "text", text: JSON.stringify(output) }],
  structuredContent: output,  // typed to match your outputSchema
};
```

---

## `registerTool()` Full Signature

```ts
server.registerTool(
  name: string,
  {
    title?: string,                          // display name for UIs
    description?: string,                    // shown to the LLM — be specific
    inputSchema?: Record<string, ZodType>,  // plain object of Zod types, NOT z.object()
    outputSchema?: Record<string, ZodType>, // optional structured output schema
    annotations?: {
      readOnlyHint?: boolean,    // tool doesn't modify state
      destructiveHint?: boolean, // tool may delete/overwrite data
      idempotentHint?: boolean,  // safe to call multiple times with same args
      openWorldHint?: boolean,   // tool interacts with external systems
    },
  },
  handler: async (params, ctx) => CallToolResult
);

// handler params:
// - params: object with keys matching your inputSchema, Zod-validated and typed
// - ctx: ServerContext — access to ctx.mcpReq.log(), ctx.mcpReq.requestSampling(), etc.
```

---

## package.json and tsconfig Minimum Requirements

```json
// package.json
{
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.0",
    "zod": "^3.25.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true
  }
}
```

---

## Gotchas

| Issue | Detail | Fix |
|---|---|---|
| `console.log` in stdio server | Writes to stdout, corrupting the JSON-RPC stream | Always use `console.error()` for logging |
| Import missing `.js` extension | ESM with Node16 resolution requires `.js` on all SDK imports | `from "@modelcontextprotocol/sdk/server/mcp.js"` |
| `inputSchema: z.object({...})` | Wrong — `inputSchema` takes a plain object of Zod field schemas | `inputSchema: { key: z.string() }` (no `z.object` wrapper) |
| Zod version mismatch | SDK uses Zod v4 internally; using mismatched Zod versions causes `keyValidator._parse is not a function` | Pin `zod >= 3.25.0` or use `zod/v4` |
| `server.tool()` vs `server.registerTool()` | `server.tool()` is an older shorthand that still works but accepts a slightly different signature | Use `server.registerTool()` — it's the canonical current API |
| Forgetting `await server.connect()` | Without await, the server doesn't start processing before `main()` returns | Always `await server.connect(transport)` |
| Throwing plain `Error` | Gets converted to InternalError by the SDK, but message may be swallowed in some versions | Throw `McpError` explicitly for predictable client behavior |
| `McpError` import path | Older examples import from `"@modelcontextprotocol/sdk"` (root) | Canonical path is `"@modelcontextprotocol/sdk/types.js"` |

---

## Claude Desktop Registration

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "pythia": {
      "command": "node",
      "args": ["/Users/mikeboscia/pythia/dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

---

*Created: 2026-03-11*
*Sources: [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) ·
[docs/server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) ·
[npmjs.com/@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)*
