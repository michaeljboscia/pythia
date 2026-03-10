# Multi-Agent Orchestration Patterns and Model Context Protocol (MCP) Server Architecture

**Source:** Gemini Deep Research
**Research ID:** `v1_ChdwTEN2YWUya05LNkl6N0lQeXVyQ3dBWRIXcExDdmFlMmtOSzZJejdJUHl1ckN3QVk`
**Duration:** 26m 48s
**Date:** 2026-03-10
**Full JSON:** `/Users/mikeboscia/.config/gemini-mcp/output/70b111f4e884af1f/deep-research-2026-03-10T06-15-11-673Z.json`

---

## Key Points

- **MCP decouples LLM intelligence from tool execution** via standardized JSON-RPC client-server architecture — any MCP-compliant client can instantly use any MCP-compliant server's tools, eliminating vendor-specific function-calling syntax
- **Two transport mechanisms:** `stdio` (local sidecar, zero network config, low latency) vs SSE+HTTP POST (distributed, network-transparent, load-balancer compatible)
- **Three communication topologies:** Hub-and-spoke (centralized orchestrator, observable but context-bottlenecked), peer-to-peer mesh (scalable but routing-loop-prone), blackboard (shared-state, asynchronous, decoupled in time/space)
- **Google A2A protocol** handles cross-vendor agent "diplomacy" (intent sharing, capability advertising, trust negotiation) while MCP handles "mechanics" (actual tool execution)
- **Meta-tool pattern** reduces context window pollution — expose one high-level tool that internally delegates to a sub-agent with access to 50 granular tools
- **Conflict resolution in shared state:** CRDTs for syntactic merging, pessimistic locks with timeouts for exclusive resources, LLM-as-critic for semantic conflicts

---

## 1. Introduction to MCP

MCP is an open standard decoupling foundation model intelligence from tool execution. Architecture:
- **MCP Client:** Resides alongside agent/LLM, maintains conversation context, decides when to invoke tools
- **MCP Server:** Independent process exposing standardized schema of capabilities via JSON-RPC
- **Recursive composability:** An agent wrapped in an MCP server becomes a "tool" for other agents

Three primitives:
- **Resources:** Read-only data injection (URI templates)
- **Tools:** Action execution (mutate state, compute)
- **Prompts:** Reusable interaction templates

---

## 2. MCP Server Design Patterns

### 2.1 Transport: stdio vs SSE

| Aspect | stdio | SSE + HTTP POST |
|--------|-------|-----------------|
| **Deployment** | Local sidecar (child process) | Distributed web service |
| **Communication** | stdin/stdout pipes | HTTP SSE (server→client) + POST (client→server) |
| **Latency** | Extremely low | Network latency in reasoning loop |
| **Security** | Inherent (same machine/user space) | Requires TLS, auth tokens |
| **Scalability** | Poor (bound to host) | Excellent (load balancers, K8s ingress) |

### 2.2 Tool Registration and Lifecycle
- **Discovery:** `tools/list` request returns JSON Schema definitions (static or dynamic based on system state)
- **Schema:** Highly descriptive `description` fields — LLM uses these as semantic routing instructions
- **Async pattern:** For long-running tasks, return `task_id` immediately; use notifications or polling for completion

### 2.3 Resource Exposure
- **URI Templates:** Parameterized data spaces (e.g., `file:///{path}`, `github://{repo}/issues/{id}`)
- **Subscriptions:** Server proactively pushes `resource/updated` events via SSE when resources change

---

## 3. MCP vs Alternatives

| Feature | MCP | Native Function Calling | Direct API Integration |
|---------|-----|------------------------|----------------------|
| **Coupling** | Decoupled, vendor-agnostic | Vendor-locked syntax | Tightly coupled per-API |
| **Client Support** | Universal (any MCP client) | Vendor-specific | Custom HTTP clients |
| **Agentic Role** | Actions + Context unified | Actions only | Segmented by endpoint |
| **Multi-Agent Composability** | Extremely high (recursive) | Low | Low |
| **State Push** | SSE subscriptions | Polling required | WebSocket needed |

---

## 4. Multi-Agent Communication Topologies

### 4.1 Hub-and-Spoke
- Central orchestrator connects to specialized sub-agent MCP servers
- **Pro:** Centralized trace, simplified conflict resolution
- **Con:** Context window exhaustion — O(N) routing through orchestrator

### 4.2 Peer-to-Peer Mesh
- Every agent exposes MCP server AND acts as MCP client
- Requires service discovery registry
- **Pro:** No orchestrator bottleneck, swarm-scalable
- **Con:** Routing loops (need TTL counters + distributed tracing)

### 4.3 Blackboard (Shared State)
- Central MCP server manages shared memory; agents read/write asynchronously
- **Pro:** Decoupled in time and space, emergent problem solving
- **Con:** Requires consensus algorithms for concurrent updates

---

## 5. Google A2A Protocol

- Addresses cross-vendor agent interoperability (different from MCP's vertical client-server model)
- Agents share *Intents* and *Capabilities*, not just functions
- Handles authentication, trust boundaries, schema negotiation across corporate domains
- **Integration:** A2A for "diplomacy" (discovery, trust) → MCP for "mechanics" (execution)

---

## 6. Tool Composition and Capability Delegation

### Meta-Tool Pattern
- Instead of exposing 50 granular tools (context pollution), expose single `execute_research_workflow`
- MCP server internally instantiates sub-agent loop with access to granular tools
- Creates fractal architecture: intelligence abstracted behind simple interfaces

### Capability Delegation via Tokens
- Orchestrator passes authorization tokens in tool payload
- Daemon agent uses token for temporary elevated access via its own MCP connections

---

## 7. Security Boundaries and Trust Models

### 7.1 Threat Landscape
- **Prompt Injection:** Malicious resource content tricks agent into executing destructive tools
- **Confused Deputy:** Untrusted Agent A coerces trusted Agent B to bypass authorization

### 7.2 Security Patterns
1. **RBAC on MCP:** Authenticate SSE connection (JWT), restrict `tools/list` and `resources/list` per agent identity
2. **Human-in-the-Loop:** Destructive tools → `pending_approval` state → human notification before execution
3. **Sandbox Execution:** LLM-generated scripts run in Docker/WASM with zero network access beyond required resources
4. **mTLS for Mesh:** Mutual TLS for peer-to-peer agent authentication (beyond simple API keys)

---

## 8. Consensus and Conflict Resolution

### 8.1 CRDTs (Deterministic)
- Conflict-free Replicated Data Types guarantee eventual consistency without central locks
- Effective for text generation and structured data compilation (e.g., Yjs documents)

### 8.2 Lock Management (Pessimistic)
- `acquire_lock(resource_id)` / `release_lock(resource_id)`
- Strict lease timeouts prevent deadlocks from agent failures

### 8.3 Semantic Resolution (LLM-Driven)
- When conflict is semantic (not syntactic), invoke Critic Agent to evaluate context and generate coherent resolution
- LLM itself serves as consensus mechanism

---

## 9. Exposing AI Daemon Pools as MCP Tools

### Architectural Flow
1. **Interface:** Orchestrator sees pool as MCP server with `submit_daemon_task`, `check_daemon_status`, `retrieve_daemon_result`
2. **Submission:** Orchestrator invokes tool with goal + parameters
3. **Queue:** MCP server pushes to message broker (Redis/RabbitMQ), returns `task_id` immediately
4. **Execution:** Pool worker picks up task (may itself be an agentic loop)
5. **Notification:** SSE push or polling for completion

---

## 10. TypeScript Implementation

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuidv4 } from 'uuid';

type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface DaemonTask {
    id: string; description: string; payload: any;
    status: TaskStatus; result?: string; error?: string; createdAt: number;
}

const taskDatabase = new Map<string, DaemonTask>();

async function processDaemonTask(taskId: string) {
    const task = taskDatabase.get(taskId);
    if (!task) return;
    task.status = 'processing';
    try {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5000 + 2000));
        task.result = `Processed: ${JSON.stringify(task.payload)}. Confidence: 0.98.`;
        task.status = 'completed';
    } catch (error: any) {
        task.error = error.message;
        task.status = 'failed';
    }
}

const server = new Server(
    { name: "ai-daemon-pool-server", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "submit_daemon_task",
            description: "Submit complex task to AI daemon pool. Returns task_id immediately.",
            inputSchema: {
                type: "object",
                properties: {
                    description: { type: "string" },
                    payload: { type: "object", additionalProperties: true }
                },
                required: ["description", "payload"]
            }
        },
        {
            name: "check_daemon_status",
            description: "Check status of a submitted daemon task.",
            inputSchema: {
                type: "object",
                properties: { task_id: { type: "string" } },
                required: ["task_id"]
            }
        },
        {
            name: "get_daemon_result",
            description: "Retrieve result of completed daemon task.",
            inputSchema: {
                type: "object",
                properties: { task_id: { type: "string" } },
                required: ["task_id"]
            }
        }
    ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case "submit_daemon_task": {
            const taskId = uuidv4();
            taskDatabase.set(taskId, {
                id: taskId, description: args.description, payload: args.payload,
                status: 'pending', createdAt: Date.now()
            });
            processDaemonTask(taskId).catch(console.error);
            return { content: [{ type: "text", text: JSON.stringify({ task_id: taskId, status: "pending" }) }] };
        }
        case "check_daemon_status": {
            const task = taskDatabase.get(args.task_id);
            if (!task) throw new McpError(ErrorCode.InvalidRequest, `Task ${args.task_id} not found.`);
            return { content: [{ type: "text", text: JSON.stringify({ task_id: task.id, status: task.status }) }] };
        }
        case "get_daemon_result": {
            const task = taskDatabase.get(args.task_id);
            if (!task) throw new McpError(ErrorCode.InvalidRequest, `Task ${args.task_id} not found.`);
            if (task.status !== 'completed') return { content: [{ type: "text", text: `Task ${task.status}. Poll later.` }], isError: true };
            return { content: [{ type: "text", text: JSON.stringify({ task_id: task.id, result: task.result }) }] };
        }
        default: throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }
});

const transport = new StdioServerTransport();
server.connect(transport);
```

---

## Recommendations for Pythia

1. **Use SSE transport for Pythia's MCP server** — oracle queries are inherently slow; stdio forces co-location with orchestrator. SSE over HTTPS allows multiple distributed agents to connect to Pythia's daemon pool simultaneously.

2. **Implement async polling/notification pattern** — `submit_oracle_query` returns `query_id` immediately; leverage SSE `resource/updated` events to push completion notifications rather than forcing orchestrator polling loops.

3. **Adopt the meta-tool pattern** — instead of exposing all 13 Pythia tools directly, expose a simplified facade (`query_oracle`, `manage_oracle`) that internally delegates to the full tool suite. Reduces context window pollution in orchestrator agents.

4. **Use blackboard topology for multi-oracle collaboration** — when multiple pool members need to synthesize a response, create a shared CRDT document (Yjs) as internal blackboard. Daemons post findings asynchronously; consensus algorithm verifies completeness before formulating final MCP result.

5. **Implement RBAC on tool/resource exposure** — authenticate connecting agents via JWT on SSE connection. Restrict `tools/list` based on agent identity (e.g., read-only agents see only `query_oracle`, admin agents see `decommission_oracle`). Enforce least privilege.

6. **Return summaries via tools, full data via resources** — oracle responses can be massive. Return concise summaries in `tool_call` results; expose full datasets as MCP Resources via URI template (`pythia://query/{query_id}/raw_data`). Agents read granular chunks only if needed, preserving context window.
