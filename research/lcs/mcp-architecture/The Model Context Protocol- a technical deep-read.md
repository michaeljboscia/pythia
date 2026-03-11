# The Model Context Protocol: a technical deep-read

*Created: 2026-03-11*

---

The Model Context Protocol (MCP) is a JSON-RPC 2.0–based session protocol that standardizes how AI applications exchange context with external tool and data providers. **MCP's core innovation is a capability-negotiated architecture built on three distinct primitive types — Tools, Resources, and Prompts — each governed by a different control actor.** The protocol defines two transport mechanisms (stdio and Streamable HTTP), a structured initialization handshake for capability discovery, and a lifecycle model that enables progressive feature adoption. This document traces the exact message formats, framing protocols, and negotiation mechanics as specified in the [2025-03-26 protocol revision](https://modelcontextprotocol.io/specification/2025-03-26/architecture).

## A client-host-server architecture with strict isolation

MCP follows a three-tier architecture. The **host** is the AI application itself — Claude Desktop, VS Code, Cursor — which creates and manages one or more **MCP clients**. Each client maintains a **1:1 stateful session** with exactly one **MCP server**. This design enforces a critical security property: servers cannot see the full conversation history, and they cannot observe other servers connected to the same host. The host orchestrates all cross-server coordination and enforces user consent policies.

The [architecture specification](https://modelcontextprotocol.io/specification/2025-03-26/architecture) codifies four design principles that shape every protocol decision. Servers should be extremely easy to build, with the host absorbing orchestration complexity. Servers should be highly composable, each providing focused functionality in isolation. Servers must not read the whole conversation or see into other servers. And features should be addable progressively through capability negotiation rather than upfront commitment. These principles explain why MCP chose JSON-RPC 2.0 — it provides standardized request-response and fire-and-forget notification patterns with minimal overhead, and its `id`-based correlation allows concurrent in-flight messages over a single transport channel.

## Tools, Resources, and Prompts: three primitives, three control models

The three capability primitives differ not just in function but in **who controls their invocation**. [Tools](https://modelcontextprotocol.io/specification/2025-03-26/server/tools/) are **model-controlled** — the LLM autonomously decides when to call them. [Resources](https://modelcontextprotocol.io/specification/2025-03-26/server/resources/) are **application-controlled** — the host application determines when to fetch and incorporate contextual data. [Prompts](https://modelcontextprotocol.io/specification/2025-03-26/server/prompts/) are **user-controlled** — they surface through UI affordances like slash commands for explicit human selection.

### Tools and the `tools/call` lifecycle

Tools represent the protocol's most complex primitive because they involve arbitrary code execution. A server advertises tools via `tools/list`, and clients invoke them via `tools/call`. The complete request-response lifecycle for a tool call proceeds as follows.

First, the client discovers available tools:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": { "cursor": "optional-cursor-value" }
}
```

The server responds with an array of `Tool` objects, each containing a `name` (unique identifier, 1–128 characters, case-sensitive, restricted to `[A-Za-z0-9_\-\.]`), a `description` for the LLM, and critically an `inputSchema` — a full [JSON Schema](https://json-schema.org/) object (defaulting to the 2020-12 draft) that defines the tool's parameter structure. The response supports cursor-based pagination via `nextCursor`.

When the LLM selects a tool, the client sends:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "New York" }
  }
}
```

The `id` field is a `string | number` that uniquely identifies this request for correlation. The server returns a `CallToolResult`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "Temperature: 72°F, Partly cloudy" }
    ],
    "isError": false
  }
}
```

The `content` array is a union type (`TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource`), allowing tools to return rich multimodal results. The `isError` flag distinguishes tool-level execution failures from protocol-level errors — a JSON-RPC `error` response (e.g., code `-32602` for an unknown tool name) means the call never reached execution, while `isError: true` means the tool ran but failed.

The 2025-03-26 revision introduced **tool annotations** — metadata hints like `readOnlyHint`, `destructiveHint`, and `idempotentHint` — that clients can use for UI decisions (e.g., requiring confirmation for destructive operations). These annotations are explicitly marked **untrusted** unless the server is verified. Later revisions added `outputSchema` for structured content validation, where servers return both a `content` array and a `structuredContent` JSON object conforming to the declared schema.

### Resources: URI-addressed, read-only context

Resources model data that provides context without side effects — analogous to HTTP GET requests. Each resource is identified by a **URI** following [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986), with common schemes including `file://`, `https://`, `git://`, and custom schemes. Discovery uses `resources/list`, while retrieval uses `resources/read` with a `uri` parameter. The read response returns `contents` as either `TextResourceContents` (with a `text` field) or `BlobResourceContents` (with a base64-encoded `blob` field).

Resources also support **templates** via `resources/templates/list`, which returns [RFC 6570 URI templates](https://www.rfc-editor.org/rfc/rfc6570) like `file:///{path}`. The `completion/complete` method provides autocompletion for template arguments. Unlike tools, resources have an additional sub-capability: **`subscribe`**, allowing clients to register for `notifications/resources/updated` events when a specific resource's content changes.

### Prompts: parameterized message templates

Prompts are the simplest primitive. `prompts/list` returns an array of `Prompt` objects, each with a `name`, optional `description`, and an `arguments` array defining named parameters (with `required` flags). `prompts/get` accepts a prompt name and argument values, returning an array of `PromptMessage` objects — each with a `role` (`"user"` or `"assistant"`) and a content block. This allows servers to provide multi-turn conversation templates that the client injects into the LLM context, with argument interpolation handled server-side.

## Stdio transport: newline-delimited JSON over process pipes

The [stdio transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports/) is the simplest and recommended default. The client spawns the MCP server as a **child process**. The server reads JSON-RPC messages from **stdin** and writes responses to **stdout**. The framing protocol is **newline-delimited JSON** — each message is a complete JSON object terminated by a newline character, and **messages must not contain embedded newlines**. This is notably different from the Language Server Protocol's `Content-Length`-prefixed framing.

**stderr** is reserved for logging — servers may write UTF-8 diagnostic strings to it, but clients may capture, forward, or ignore this output. The critical constraint is that **nothing other than valid MCP messages may appear on stdout**, and nothing other than valid MCP messages may be written to the server's stdin.

Concurrent requests work naturally through JSON-RPC's `id`-based correlation. Multiple requests can be in flight simultaneously over the single bidirectional pipe, with responses matched to requests by their `id` values. The 2025-03-26 revision added support for JSON-RPC batching (arrays of requests/notifications), though implementations must support *receiving* batches even if they choose not to send them. Notably, batching was later removed in the 2025-06-18 revision as overcomplex relative to its benefits.

For long-running operations, the protocol provides two mechanisms. **Progress notifications** use a `progressToken` (included in the request's `_meta` object) that the server references in `notifications/progress` messages containing `progress`, `total`, and `message` fields. **Cancellation** uses `notifications/cancelled` with the `requestId` of the in-flight request. In the stdio context, transport-level shutdown follows a graceful sequence: the client closes stdin, waits for the server to exit, sends `SIGTERM` if necessary, and escalates to `SIGKILL` as a last resort.

## Streamable HTTP: a single-endpoint evolution

The 2025-03-26 revision replaced the original HTTP+SSE transport (which required two separate endpoints — an SSE endpoint for server-to-client streaming and a POST endpoint for client-to-server messages) with **Streamable HTTP**. This transport uses a **single HTTP endpoint** that accepts both POST and GET requests.

Clients send JSON-RPC messages via **HTTP POST** to the MCP endpoint, with an `Accept` header that **must include both `application/json` and `text/event-stream`**. The server may respond with either content type. For simple request-response patterns, `application/json` suffices. For streaming — where the server needs to send progress notifications, intermediate requests, or multiple messages before the final response — it opens a `text/event-stream` (SSE) channel within the POST response. If the POST body contains only notifications or responses (no requests), the server returns **HTTP 202 Accepted** with no body.

Clients may also issue **HTTP GET** requests to open a standalone SSE stream for receiving server-initiated messages (requests and notifications unrelated to any active client request). Servers that don't support this pattern return **405 Method Not Allowed**.

**Session management** is handled via the `Mcp-Session-Id` header. The server may assign a session ID in its `InitializeResult` response, after which the client must include it in all subsequent requests. Session IDs must be cryptographically secure (UUIDs or JWTs recommended) and contain only visible ASCII characters. Server-side session termination produces a **404 Not Found** response, signaling the client to re-initialize. Clients terminate sessions with an **HTTP DELETE** to the MCP endpoint.

The Streamable HTTP transport also introduces **resumability**: servers may attach SSE event `id` fields, and clients can reconnect with a `Last-Event-ID` header to replay missed messages. This addresses a significant reliability gap in the original SSE transport, where a dropped connection meant lost messages. Security is enforced through mandatory `Origin` header validation (preventing DNS rebinding), localhost binding for local servers, and an **OAuth 2.1** authorization framework for remote servers.

## Capability negotiation during the initialize handshake

The [initialization lifecycle](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle) is a strict three-step sequence that **must be the first interaction** between client and server. The client sends an `initialize` request containing its `protocolVersion`, `capabilities`, and `clientInfo`:

```json
{
  "jsonrpc": "2.0", "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "roots": { "listChanged": true },
      "sampling": {}
    },
    "clientInfo": { "name": "ExampleClient", "version": "1.0.0" }
  }
}
```

The server responds with its own `protocolVersion`, `capabilities`, `serverInfo`, and an optional `instructions` string (natural-language guidance for how the model should use the server). If the server doesn't support the client's requested protocol version, it responds with the latest version it does support; the client must then decide whether to proceed or disconnect.

```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": {
      "logging": {},
      "prompts": { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true },
      "tools": { "listChanged": true }
    },
    "serverInfo": { "name": "ExampleServer", "version": "1.0.0" },
    "instructions": "Optional instructions for the client"
  }
}
```

The client then sends a `notifications/initialized` notification (no `id`, no response expected) to signal readiness. **The initialize request must not be part of a JSON-RPC batch**, and before initialization completes, only `ping` requests are permitted in either direction.

The **`ClientCapabilities`** object declares what the client supports: `roots` (filesystem boundary management, with optional `listChanged` notification support), `sampling` (allowing the server to request LLM completions from the client), and `experimental` (non-standard features). The **`ServerCapabilities`** object declares `tools`, `resources`, `prompts`, `logging`, and `completions`, each with sub-capability flags. The `listChanged` boolean indicates whether the server will emit change notifications (e.g., `notifications/tools/list_changed`) when its available primitives change at runtime. The `subscribe` flag on `resources` indicates support for per-resource update subscriptions.

## Runtime discovery through list methods and change notifications

After initialization, clients discover available capabilities through the list methods — `tools/list`, `resources/list`, `resources/templates/list`, and `prompts/list`. All support **cursor-based pagination**: clients pass an opaque `cursor` string, and servers return a `nextCursor` when more results exist. This enables servers with large capability sets to avoid overwhelming clients.

The protocol's dynamism comes from **change notifications**. When a server's tool set changes (e.g., a plugin is loaded), it sends `notifications/tools/list_changed`. The client then re-issues `tools/list` to get the updated set. The same pattern applies to resources (`notifications/resources/list_changed`) and prompts (`notifications/prompts/list_changed`). For individual resource content changes, subscribed clients receive `notifications/resources/updated` with the specific URI, then call `resources/read` to fetch the new content.

This notification-driven discovery model means **clients never need to poll**. Combined with the capability negotiation at initialization (which tells the client *whether* to expect these notifications via `listChanged: true`), the protocol achieves a clean separation between static configuration and dynamic runtime behavior. Servers that never change their capability sets simply omit `listChanged`, and clients know not to listen for updates.

The `completion/complete` method rounds out the discovery surface by providing **argument autocompletion**. Clients reference either a `PromptReference` (`type: "ref/prompt"`) or `ResourceTemplateReference` (`type: "ref/resource"`) along with a partial argument value, and the server returns matching completions with optional `total` count and `hasMore` flag. This powers IDE-like autocomplete experiences in host applications.

## Conclusion

MCP's technical design reflects a careful balance between simplicity and extensibility. The three-primitive model (Tools, Resources, Prompts) maps cleanly to control boundaries — model, application, and user — preventing the conflation of read-only context retrieval with side-effecting tool execution. The transport abstraction ensures the same JSON-RPC messages work whether piped over stdin/stdout to a local process or streamed over HTTP to a remote service, with the Streamable HTTP transport solving the original SSE transport's reliability and session management gaps. And the capability negotiation system means a minimal server implementing only `tools` can coexist on the same protocol as a feature-rich server supporting resources, prompts, subscriptions, completions, and structured output — each advertising only what it provides, with clients adapting accordingly.

---

## Bibliography

| Source | URL | Key contribution |
|---|---|---|
| MCP Specification — Architecture (2025-03-26) | https://modelcontextprotocol.io/specification/2025-03-26/architecture | Client-host-server architecture definition, design principles, component roles and isolation model |
| MCP Specification — Lifecycle (2025-03-26) | https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle | Initialize handshake flow, capability negotiation mechanics, version negotiation, shutdown procedures, timeout and error handling |
| MCP Specification — Transports (2025-03-26) | https://modelcontextprotocol.io/specification/2025-03-26/basic/transports | Stdio framing protocol, Streamable HTTP transport design, session management, resumability, backwards compatibility |
| MCP Specification — Tools | https://modelcontextprotocol.io/specification/2025-03-26/server/tools/ | `tools/list` and `tools/call` message formats, Tool type definition, inputSchema, outputSchema, tool annotations, error handling |
| MCP Specification — Resources | https://modelcontextprotocol.io/specification/2025-03-26/server/resources/ | `resources/list`, `resources/read`, `resources/subscribe` message formats, URI schemes, resource templates, subscription notifications |
| MCP Specification — Prompts | https://modelcontextprotocol.io/specification/2025-03-26/server/prompts/ | `prompts/list` and `prompts/get` message formats, PromptMessage structure, argument definitions |
| MCP Documentation — Concepts | https://modelcontextprotocol.io/docs/concepts/architecture | High-level architecture overview, design philosophy, transport comparison, SDK layer architecture |
| Anthropic — Model Context Protocol Announcement | https://www.anthropic.com/news/model-context-protocol | Design motivation, N×M integration problem, initial ecosystem (pre-built servers, early adopters) |
| MCP TypeScript SDK | https://github.com/modelcontextprotocol/typescript-sdk | SDK architecture (Client/Server → Session → Transport layers), implementation patterns, Zod schema validation |
| MCP Schema Reference (Draft) | https://modelcontextprotocol.io/specification/draft/schema | Authoritative type definitions for all JSON-RPC methods, capability interfaces, content types, error codes |