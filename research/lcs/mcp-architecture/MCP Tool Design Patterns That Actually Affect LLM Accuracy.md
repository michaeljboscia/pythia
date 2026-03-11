# MCP Tool Design Patterns That Actually Affect LLM Accuracy

**The single most impactful decision when building MCP servers is not what your tools do — it's how many you expose, how you describe them, and what format their outputs take.** Research across Anthropic, OpenAI, and academic benchmarks converges on a clear finding: LLM tool-calling accuracy degrades measurably — between 7% and 85% — as tool catalogs grow, and both input schema design and output formatting choices create compounding effects on downstream reasoning quality. This document synthesizes primary-source evidence into actionable patterns for developers building production MCP servers.

The Model Context Protocol defines tools as server-exposed operations that LLMs can discover and invoke. Every tool definition — its name, description, and input schema — gets injected into the model's context window on every turn. This means tool design is prompt engineering, whether developers recognize it or not. The patterns that follow are grounded in measured outcomes, not opinion.

## Fewer tools win: the evidence on granularity thresholds

The relationship between tool count and LLM performance is not linear — it is a cliff. The LongFuncEval benchmark (2025) measured tool-calling accuracy across catalog sizes ranging from 8K to 120K tokens and found **performance drops of 7% to 85%** as the number of tools increased, with most models showing significant degradation. Multi-turn conversations compounded the problem, adding another **13% to 40% degradation** as conversations lengthened.

Anthropic's internal data tells a similar story. A typical five-server MCP configuration — GitHub (35 tools, ~26K tokens), Slack (11 tools, ~21K tokens), Sentry (5 tools, ~3K tokens), Grafana (5 tools, ~3K tokens), and Splunk (2 tools, ~2K tokens) — consumes approximately **55,000 tokens before the conversation even starts**. At Anthropic, the worst-case observed was tool definitions consuming **134K tokens** before any optimization. The most common failure mode in these large catalogs is wrong tool selection and incorrect parameters, "especially when tools have similar names like `notification-send-user` vs. `notification-send-channel`."

OpenAI's function calling documentation sets an explicit soft recommendation: **aim for fewer than 20 functions available at the start of any turn**. Their reasoning-model guide (o3/o4-mini) adds that tool list size directly affects latency and reasoning depth, and that "tool hallucinations can increase with complexity, especially when the toolset is large and under-defined." Empirical testing by Paragon across 50 test cases showed that reducing available tools from ~20 to ~5 via routing improved Claude 3.5 Sonnet's tool correctness by **8.2 percentage points** (67.6% → 75.8%).

The "Less is More" paper (IEEE, 2024) formalized this insight: selectively reducing available tools significantly improves decision-making ability. By presenting models with fewer, more relevant tools using hierarchical selection, tool accuracy improved to **89%** while execution time dropped by **80%**. Phil Schmid's widely-cited MCP best practices guide recommends **5–15 tools per server** and urges developers to "curate ruthlessly."

For servers that genuinely need large tool surfaces, both Anthropic and OpenAI now offer tool search mechanisms. Anthropic's Tool Search Tool improved Opus 4 accuracy from **49% to 74%** and Opus 4.5 from **79.5% to 88.1%** on large catalogs, while reducing token usage by approximately 85%. The guidance is clear: use tool search when definitions exceed ~10K tokens or when more than 10 tools are available.

### Outcome-oriented design replaces REST-style granularity

The consensus across all major sources is that MCP tools should not mirror REST API endpoints. Docker's MCP best practices blog calls this the "Tool Budget" concept — every tool competes for cognitive bandwidth, so "the better strategy is to design your toolset around clear use cases and avoid mapping every API endpoint to a separate tool." Anthropic recommends building tools that "consolidate functionality, handling potentially multiple discrete operations (or API calls) under the hood." Phil Schmid gives the canonical example: instead of exposing `get_user_by_email()`, `list_orders(user_id)`, and `get_order_status(order_id)` as three separate tools, expose a single `track_order(email)` tool that calls all three internally.

OpenAI similarly advises combining functions that are always called in sequence: "if you always call `mark_location()` after `query_location()`, just move the marking logic into the query function call." Arcade.dev, which has built 8,000+ tools across 100+ integrations, recommends starting with atomic operations and graduating to composite tools based on observed usage — "high retry rates mean your tool needs better descriptions" and frequently-chained operations should be consolidated.

The design heuristic is: **one user outcome = one tool**, regardless of how many API calls happen underneath. Combine when operations serve a single workflow. Split when operations serve genuinely different intents or need different permission levels.

## Input schema design determines whether tools get called correctly

Anthropic's tool use documentation is unambiguous: **detailed descriptions are "by far the most important factor in tool performance."** The recommendation is at least 3–4 sentences per tool description, explaining what the tool does, when it should be used, when it should *not* be used, what each parameter means, and any important caveats. This applies equally to tool-level descriptions (which drive selection) and parameter-level descriptions (which drive correct invocation).

The separation between these two layers matters. A GitHub proposal for MCP documentation standards (SEP-1382) formalizes this: tool descriptions should provide "a concise, high-level explanation of what the tool accomplishes" for selection purposes, while `inputSchema` property descriptions should provide "parameter-specific documentation" for proper usage. Both Anthropic and OpenAI recommend meaningful namespacing in tool names (e.g., `github_list_prs`, `slack_send_message`) to help models disambiguate across servers. Anthropic notes that "selecting between prefix- and suffix-based namespacing has non-trivial effects on tool-use evaluations" — this is worth A/B testing.

### Flat schemas outperform nested ones

The MCP specification site advises keeping tool schemas "as flat as possible," noting that "deeply nested structures increase the token count and cognitive load for the LLM, which can lead to higher latency or parsing errors." OpenAI's o3/o4-mini guide sets a practical boundary: **fewer than ~20 arguments per tool** is considered "in-distribution" for reliable behavior. Nesting is appropriate for naturally structured inputs like configuration payloads or rich search filters, but requires "clear field descriptions, `anyOf` logic, or strict schemas to guard against invalid argument combinations."

OpenMCP highlights a concrete scaling problem: Stripe's single payment creation endpoint has a schema consuming ~10,000 tokens. Their solution — lazy loading input schemas by providing only top-level properties initially and letting clients request deeper levels on demand — points toward a practical pattern for API-wrapper MCP servers.

For constrained values, **enums are essential**. A well-designed schema uses `z.enum(['EUR', 'USD', 'GBP']).default('EUR')` rather than a bare string type. Sensible defaults reduce the parameter surface the model must reason about. Validation constraints like `.min()`, `.max()`, and `.positive()` in Zod translate to JSON Schema constraints that guide the model toward valid values. FastMCP automatically dereferences `$ref` entries in schemas because many MCP clients — including VS Code Copilot and Claude Desktop — don't fully support JSON Schema references, so complex Pydantic models must be inlined.

### Input examples bridge the gap schemas cannot

Anthropic's advanced tool use documentation identifies a critical limitation: "JSON schemas define what's structurally valid, but can't express usage patterns: when to include optional parameters, which combinations make sense, or what conventions your API expects." The `input_examples` field solves this by showing the model concrete invocation patterns. For a `create_ticket` tool, three examples can demonstrate that critical bugs include full contact info plus escalation with tight SLAs, feature requests include a reporter but no escalation, and internal tasks need only a title. This pattern is particularly valuable for tools with optional parameters whose relevance depends on context.

OpenAI's strict mode offers a complementary approach: all fields are marked `required`, but optional parameters use a null union type (`"type": ["string", "null"]`), ensuring the model always explicitly decides on every parameter. Anthropic's strict tool use similarly guarantees schema conformance, eliminating type mismatches or missing fields. Both providers recommend enabling strict mode in production.

When using Zod with the Vercel AI SDK, a practical gotcha: `.meta()` or `.describe()` must be called **at the end of the schema chain** because most Zod methods (`.min()`, `.optional()`, `.extend()`) return new schema instances that don't inherit metadata from previous ones.

## Output format choices create measurable reasoning trade-offs

The MCP specification (v2025-11-25) defines two output categories: **unstructured content** returned in a `content` array (supporting text, images, audio, and resource links) and **structured content** returned as JSON in a `structuredContent` field. The spec recommends providing both for backward compatibility: structured content for programmatic consumers and a serialized text block for LLM consumption. Tools can declare an `outputSchema` to enable client-side validation and provide type information for better integration.

The critical question — whether to return plain text, structured JSON, or markdown — has a research-backed answer that depends on what happens next with the output.

### Format restrictions degrade reasoning performance

A 2024 study by Tam et al. from Appier AI Research and National Taiwan University found a **"significant decline in LLMs' reasoning abilities under format restrictions,"** with stricter constraints producing greater degradation. Constrained JSON-mode decoding caused the most degradation, format-restricting instructions caused moderate degradation, and a two-step approach (reason in natural language first, then convert to structured format) caused the least. On reasoning benchmarks like GSM8K, "more relaxed prompts typically yield better results."

Aider's empirical testing confirmed this for code specifically: "LLMs produce lower quality code if they're asked to return it as part of a structured JSON response." Even Sonnet, which avoided JSON syntax errors, showed lower benchmark scores with JSON wrapping — suggesting that **JSON-wrapping distracts models in ways that reduce reasoning ability**, not just introduces syntax challenges.

PromptLayer's analysis adds a cognitive framing dimension: "Models 'think' differently when outputting JSON versus natural text. The model switches into technical mode when it sees JSON syntax." Dataiku's structured generation guide recommends that when JSON is necessary, key ordering matters — place reasoning/explanation fields before conclusion/answer fields to preserve chain-of-thought patterns.

### Practical output format decision framework

Token cost compounds the reasoning trade-off. JSON uses approximately **twice as many tokens as tabular formats** for equivalent data, and routinely takes four times as long to generate. For MCP tools returning large datasets, more compact representations are meaningfully cheaper.

The MCP spec's `audience` annotation provides a clean mechanism for dual-purpose outputs. Content annotated with `["assistant"]` is optimized for LLM consumption (concise, high-signal), while `["user"]` content can be richer and more formatted. Anthropic's guidance on tool responses recommends exposing a `response_format` enum parameter (with values like `"detailed"` and `"concise"`) so agents can control verbosity based on their current task.

Error handling follows a clear pattern: tool execution errors should be returned as actionable text with `isError: true`, enabling the LLM to "self-correct and retry with adjusted parameters." These are not system errors — they are feedback the model can learn from within a single conversation turn.

The practical decision matrix: use **plain text** for results feeding into reasoning chains, explanations, and code; use **structured JSON** (`structuredContent` with `outputSchema`) for data that will be rendered in UIs, passed to downstream systems, or validated programmatically; and **always provide both** via the dual-output pattern for maximum compatibility.

## Conclusion

Three principles emerge from the evidence. First, tool count is a first-order performance variable — not a convenience concern — and the threshold for degradation is lower than most developers assume (**10–20 tools**, not hundreds). Second, tool descriptions matter more than schema sophistication; investing in prompt-engineered descriptions and `input_examples` yields larger accuracy improvements than complex schema validation. Third, output format is not a stylistic choice but a reasoning-quality lever: structured JSON is appropriate for machine consumers, but plain text preserves LLM reasoning capacity when outputs feed back into inference chains. The overarching pattern is that MCP tool design is fundamentally prompt engineering applied to a programmatic interface — and should receive the same iterative, eval-driven attention.

## Bibliography

1. **"Introducing advanced tool use on the Claude Developer Platform"** — Anthropic Engineering, November 24, 2025.  
   URL: https://www.anthropic.com/engineering/advanced-tool-use  
   Key contribution: Quantifies token overhead of MCP tool definitions (55K–134K tokens), introduces Tool Search Tool with measured accuracy improvements (49%→74% for Opus 4), and provides input_examples pattern for complex schemas.

2. **"Writing effective tools for agents — with agents"** — Anthropic Engineering, September 11, 2025.  
   URL: https://www.anthropic.com/engineering/writing-tools-for-agents  
   Key contribution: Establishes outcome-oriented tool design principles, namespacing guidance, and the recommendation to consolidate operations into fewer tools with clear purposes.

3. **"How to implement tool use"** — Claude API Documentation.  
   URL: https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use  
   Key contribution: States that detailed descriptions are "by far the most important factor in tool performance," recommends 3–4 sentences minimum, and introduces strict tool use for guaranteed schema conformance.

4. **"Function calling"** — OpenAI API Documentation.  
   URL: https://developers.openai.com/api/docs/guides/function-calling/  
   Key contribution: Sets the <20 tools per turn recommendation, introduces strict mode with null union types for optional parameters, and provides function definition best practices.

5. **"o3/o4-mini Function Calling Guide"** — OpenAI Cookbook.  
   URL: https://developers.openai.com/cookbook/examples/o-series/o3o4-mini_prompting_guide/  
   Key contribution: Establishes <100 tools / <20 arguments per tool as "in-distribution" bounds, documents tool hallucination risks with large/under-defined toolsets, and provides nesting vs. flat schema guidance.

6. **"LongFuncEval: Measuring the effectiveness of long context models for function calling"** — arXiv, 2025.  
   URL: https://arxiv.org/html/2505.10570v1  
   Key contribution: Quantifies 7–85% performance degradation as tool catalog size increases from 8K to 120K tokens, and 7–91% degradation as tool response lengths increase.

7. **"Less is More: Optimizing Function Calling for LLM Execution on Edge Devices"** — arXiv/IEEE, 2024.  
   URL: https://arxiv.org/html/2411.15399v1  
   Key contribution: Demonstrates that selectively reducing available tools via hierarchical search improves tool accuracy to 89% and reduces execution time by 80%.

8. **"RAG Best Practices: Optimizing Tool Calling"** — Paragon.  
   URL: https://www.useparagon.com/learn/rag-best-practices-optimizing-tool-calling/  
   Key contribution: Empirical evaluation showing tool routing (20→5 tools) improved Claude 3.5 Sonnet tool correctness by 8.2 percentage points across 50 test cases.

9. **"Top 5 MCP Server Best Practices"** — Docker Blog.  
   URL: https://www.docker.com/blog/mcp-server-best-practices/  
   Key contribution: Introduces "Tool Budget" concept, warns against 1:1 API-to-tool mapping, and recommends designing for the agent rather than the end user.

10. **"MCP is Not the Problem, It's your Server"** — Phil Schmid.  
    URL: https://www.philschmid.de/mcp-best-practices  
    Key contribution: Recommends 5–15 tools per server, provides the `track_order(email)` consolidation pattern, and emphasizes that MCP ≠ REST API wrapper.

11. **"54 Patterns for Building Better MCP Tools"** — Arcade.dev Blog.  
    URL: https://blog.arcade.dev/mcp-tool-patterns  
    Key contribution: Maturity model from atomic to composite tools, Unix-pipe composition principles, and lessons from building 8,000+ tools across 100+ integrations.

12. **"Tools — Model Context Protocol Specification (2025-11-25)"** — MCP Official Specification.  
    URL: https://modelcontextprotocol.io/specification/2025-11-25/server/tools  
    Key contribution: Defines structured vs. unstructured content types, `outputSchema` for validation, audience annotations, and the dual-output backward compatibility pattern.

13. **"Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large Language Models"** — Tam et al., Appier AI Research / National Taiwan University, 2024.  
    URL: https://arxiv.org/html/2408.02442v1  
    Key contribution: Demonstrates significant reasoning performance decline under format restrictions, with stricter JSON constraints causing greater degradation than natural language output.

14. **"LLMs are bad at returning code in JSON"** — Aider.  
    URL: https://aider.chat/2024/08/14/code-in-json.html  
    Key contribution: Empirical evidence that JSON-wrapping code reduces code quality even when syntax errors are avoided, suggesting cognitive interference from structured formatting.

15. **"Lazy loading input schemas"** — OpenMCP Blog.  
    URL: https://www.open-mcp.org/blog/lazy-loading-input-schemas  
    Key contribution: Documents the schema bloat problem (Stripe's single endpoint = ~10K tokens) and proposes progressive schema disclosure as a solution for large API wrappers.

16. **"Tools — FastMCP Documentation"** — FastMCP.  
    URL: https://gofastmcp.com/servers/tools  
    Key contribution: Documents automatic schema generation from Python type annotations, `$ref` dereferencing for client compatibility, and Pydantic Field metadata patterns.

17. **"AI SDK Core: zodSchema"** — Vercel AI SDK Documentation.  
    URL: https://ai-sdk.dev/docs/reference/ai-sdk-core/zod-schema  
    Key contribution: Documents that `.describe()` and `.meta()` must be called at the end of Zod schema chains due to instance immutability, preventing a common metadata loss bug.

18. **"SEP-1382: Documentation Best Practices for MCP Tools"** — MCP GitHub.  
    URL: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1382  
    Key contribution: Proposes formal separation between tool-level descriptions (for selection) and parameter-level descriptions (for usage), with concrete examples.

19. **"LLM Output Formats: Why JSON Costs More Than TSV"** — David Gilbertson, Medium.  
    URL: https://david-gilbertson.medium.com/llm-output-formats-why-json-costs-more-than-tsv-ebaf590bd541  
    Key contribution: Quantifies JSON as using ~2x more tokens than tabular formats, with ~4x generation time, relevant for MCP tools returning large datasets.