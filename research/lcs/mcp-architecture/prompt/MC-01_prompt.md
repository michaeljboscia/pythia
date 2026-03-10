# Research Prompt: MC-01 MCP Protocol Specification — Full Deep Read

## Research Objective
Execute an exhaustive reading of the official Model Context Protocol (MCP) specification from Anthropic. The objective is to establish the absolute authoritative boundaries of what LCS can and cannot do over the protocol, specifically regarding the differences between Resources, Prompts, and Tools, the nuances of the transport layers, and the lifecycle of client-server interactions.

## Research Questions
1. **Core Primitives:** What are the exact structural and philosophical differences between an MCP `Resource`, `Tool`, and `Prompt`? In the context of LCS, should an extracted architectural document be exposed as a `Resource` (read-only) or queried via a `Tool` (dynamic execution)?
2. **Transport Mechanisms:** Compare the stdio, SSE (Server-Sent Events), and HTTP streaming transport layers. Given LCS will run locally alongside the Pythia oracle (which already uses an MCP server at `~/.claude/mcp-servers/inter-agent/`), which transport provides the lowest latency for large payload transfers (e.g., passing a 50k-token graph subgraph to the client)?
3. **Sampling Implementation:** How does the MCP "Sampling" mechanism actually work under the hood? Can LCS use Sampling to recursively call LLM operations *during* a tool's execution (e.g., for relation extraction, *KG-04*) without leaving the server context?
4. **Pagination and Chunking:** Does the MCP specification provide a native mechanism for pagination or streaming partial results from a massive tool call (e.g., returning 1,000 search results)? If not, how must this be implemented at the schema level?
5. **Schema Constraints:** How strict is the JSON Schema validation for tool parameters? Can we pass complex, nested, or polymorphic JSON objects (like an abstract syntax tree) as tool arguments, or are there practical limits enforced by Claude/Cursor?
6. **Error Protocol:** What are the official JSON-RPC error codes defined by MCP? How should LCS distinguish between a "retrieval failed" error, a "database timeout" error (*PE-05*), and an "invalid parameter" error over the wire?
7. **Lifecycle and State:** Is the MCP protocol inherently stateless between JSON-RPC requests? If an LCS tool requires a multi-step negotiation (e.g., "Find this file", then "Chunk this file"), how is session state maintained across multiple tool calls?
8. **Client Compatibility:** While Anthropic created MCP, how do other clients (Cursor, Zed, etc.) interpret the spec? Are there known deviations where Cursor ignores specific `Resource` templates or handles `Tool` errors differently than Claude Desktop?
9. **Security Model:** Does the spec define authentication or authorization mechanisms for SSE/HTTP transports? If LCS exposes sensitive codebase intelligence, how is the socket protected locally?
10. **The `inter-agent` Context:** We currently run Pythia oracle tools via an MCP server at `~/.claude/mcp-servers/inter-agent/`. Does the spec allow a single Node.js process to instantiate multiple MCP servers on different stdio streams, or must LCS be a completely separate OS process?

## Sub-Topics to Explore
- JSON-RPC 2.0 underlying mechanics.
- The `roots` capability and filesystem access scope.
- Resource templates and URI design for dynamic graph node lookups.
- Progress notifications and cancellation tokens via MCP.

## Starting Sources
- **Official MCP Specification:** https://spec.modelcontextprotocol.io/
- **Anthropic MCP Introduction Blog:** https://www.anthropic.com/news/model-context-protocol
- **MCP TypeScript SDK Source Code:** https://github.com/modelcontextprotocol/typescript-sdk
- **JSON-RPC 2.0 Specification:** https://www.jsonrpc.org/specification
- **Cursor MCP Documentation:** https://docs.cursor.com/context/model-context-protocol
- **Zed Editor MCP implementation PRs/Issues:** Check the Zed github for `mcp`.
- **Smithery.ai (MCP Server Registry):** https://smithery.ai/ (To see how others define their `smithery.yaml`).

## What to Measure & Compare
- Map out the exact JSON-RPC payload bytes sent and received for a standard `tools/call` request.
- Evaluate the overhead of JSON serialization when returning a 5MB text payload over the stdio transport layer vs writing it to disk and returning a file URI.

## Definition of Done
A 3000-5000 word specification dissection that acts as the developer bible for LCS. It must definitively state whether LCS will be implemented entirely using `Tools`, or if it will leverage `Resources` and `Prompts`, and declare the chosen transport mechanism.

## Architectural Implication
This is a **P0 BLOCKER** for **ADR-007 (MCP Tool Schema)**. It defines the API boundary of the entire system. Misunderstanding the spec here will lead to tools that the LLM client cannot parse or execute.