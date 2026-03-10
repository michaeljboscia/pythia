# Research Prompt: MC-02 Existing MCP Servers for Code and Knowledge

## Research Objective
Survey and reverse-engineer existing, high-profile MCP servers specifically focused on filesystem access, database querying, and code intelligence. The goal is to identify proven design patterns, expose critical limitations in how current servers handle large context, and extract lessons to inform the design of the LCS MCP interface, avoiding the mistakes of first-generation implementations.

## Research Questions
1. **GitHub MCP Server:** How does the official GitHub MCP server expose repository intelligence? Does it use a few massive, polymorphic tools (e.g., `github_query`) or dozens of highly specific tools (e.g., `get_issue`, `list_commits`)? What is the impact on the LLM's tool-selection accuracy?
2. **Filesystem MCP Server:** Analyze the standard `mcp-server-filesystem`. How does it handle returning massive files (e.g., a 20,000 line log file)? Does it implement automatic truncation, or does it crash the client's context window?
3. **Database MCPs (Postgres/SQLite):** Look at the official Postgres MCP server. Does it allow the LLM to execute raw SQL, or does it enforce parameterized queries? How does it handle massive result sets (e.g., `SELECT * FROM logs`)?
4. **Memory/Knowledge MCPs:** Examine the official `mcp-server-memory`. How does it structure its graph? Does it use a formal property graph database, or a simple JSON file? How does the LLM interact with this memory over time?
5. **Tool Descriptions & Prompts:** Extract the exact tool `description` strings from the top 3 most downloaded code/knowledge MCP servers. What phrasing conventions (e.g., "Use this tool to...", "WARNING: Do not...") are proven to manipulate LLM behavior reliably?
6. **Error Handling Patterns:** When the GitHub MCP hits a rate limit, or the Filesystem MCP hits a permissions error, what exact JSON payload is returned to the client? Do they return `isError: true` or do they inject the error into the text output?
7. **Resource Utilization:** Do any existing codebase MCP servers successfully utilize the `Resource` primitive (e.g., `file://...`) instead of `Tools` to expose file contents? If so, how does the LLM client "know" what resources are available?
8. **The Pythia Baseline:** Review our existing Pythia oracle tools at `~/.claude/mcp-servers/inter-agent/`. What are the current friction points with these tools (e.g., timeout failures, formatting issues) that the LCS implementation must solve?
9. **Monorepo / Multi-Server Architecture:** Do power users run one monolithic MCP server for all code tasks, or do they run an ecosystem of micro-servers (one for Git, one for Files, one for Search)? Which is more stable in Claude Desktop?
10. **Context Bloat:** Which existing MCP servers are notorious for consuming too much context window, and what specific architectural choice causes this?

## Sub-Topics to Explore
- "Tool chaining" — how LLMs naturally sequence calls from different servers (e.g., using `filesystem` to read a file, then `git` to check its history).
- The `smithery.yaml` configuration standard for distributing servers.
- Differences in tool execution latency across different Node.js vs Python MCP implementations.
- "Prompt Injection" via MCP tool descriptions (using the description to fundamentally alter the agent's persona).

## Starting Sources
- **Official MCP Servers Repo:** https://github.com/modelcontextprotocol/servers
- **GitHub MCP Source:** https://github.com/modelcontextprotocol/servers/tree/main/src/github
- **Filesystem MCP Source:** https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
- **Memory MCP Source:** https://github.com/modelcontextprotocol/servers/tree/main/src/memory
- **Postgres MCP Source:** https://github.com/modelcontextprotocol/servers/tree/main/src/postgres
- **Smithery.ai Registry:** https://smithery.ai/
- **Pythia Oracle local source:** `~/.claude/mcp-servers/inter-agent/` (Review the actual code we use today).
- **Reddit/Discord discussions:** "Best MCP servers for coding" to see user complaints about existing implementations.

## What to Measure & Compare
- Diff the parameter schemas of the `mcp-server-sqlite` and `mcp-server-postgres` to identify standard conventions for database interaction over MCP.
- Measure the token length of the `description` fields for the top 10 most used tools in the Anthropic official repo. Is there an optimal length for LLM comprehension?

## Definition of Done
A 3000+ word comparative analysis of the current MCP ecosystem. The document must highlight 5 specific anti-patterns found in existing servers that LCS must avoid, and propose a draft list of high-level tools LCS should expose based on proven paradigms.

## Architectural Implication
Feeds **ADR-007 (MCP Tool Schema)**. It prevents us from reinventing the wheel or repeating the mistakes of early MCP adopters, specifically regarding how to expose the graph traversal and vector search primitives.