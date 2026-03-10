# Research Prompt: MC-03 MCP Tool Design Patterns

## Research Objective
Define the optimal schema design, granularity, and parameter architecture for the tools exposed by the Living Corpus System (LCS). The goal is to determine the ideal balance between "primitive" tools (e.g., `search_vectors`, `traverse_graph`) and "composite" tools (e.g., `investigate_feature`), ensuring the LLM can navigate the corpus efficiently without falling into infinite loops or context exhaustion.

## Research Questions
1. **Granularity (Primitive vs Composite):** Should LCS expose low-level database primitives (e.g., `execute_cypher_query`, `hybrid_vector_search`) allowing the LLM to construct its own access patterns, or high-level composite tools (e.g., `find_code_and_docs_for_feature`) that abstract the DB logic away? What are the token/turn tradeoffs?
2. **Schema Complexity:** How deeply nested should JSON Schema parameters be for a tool? Does the LLM (specifically Claude 3.5 Sonnet / Gemini 2.0 Pro) struggle to format valid JSON for tools with heavy `$ref` usage or highly polymorphic `anyOf`/`oneOf` parameters?
3. **Parameter Naming and Descriptions:** What is the empirical impact of highly descriptive parameter names (`max_results_to_return`) versus standard names (`limit`)? How much instruction should be placed in the parameter `description` vs the main tool `description`?
4. **Response Formatting (Markdown vs JSON):** When a tool returns a subgraph or a list of vector results, should the MCP server format this as a dense JSON array, or synthesize it into a clean Markdown document before returning it? Which format does the LLM reason over more accurately (*RF-08*)?
5. **Error Conventions:** When a search yields 0 results, should the tool return an error state (`isError: true`), or a success state with a message like "No results found. Try broadening your search"? How do these distinct approaches alter the LLM's subsequent retry logic (*PE-05*)?
6. **Tool Fallbacks:** If a composite tool fails internally (e.g., the graph traversal times out), what is the pattern for returning partial results (e.g., the vector results succeeded) versus a hard failure?
7. **Integrating with Pythia:** The existing Pythia tools at `~/.claude/mcp-servers/inter-agent/` have established patterns. Should LCS tools mimic these exact parameter conventions for consistency, or establish a new standard?
8. **Handling "God Tools":** Is it an anti-pattern to have a single `lcs_query` tool that takes a natural language string and attempts to magically route to vectors/graphs internally, versus forcing the LLM to explicitly choose `lcs_vector_search` or `lcs_graph_neighbors`?
9. **Required vs Optional Parameters:** How does over-using `required` parameters lead to LLM hallucination (where the model invents a parameter just to satisfy the schema)?
10. **Pagination Implementation:** Design the exact parameter schema for pagination (e.g., `cursor`, `offset`, `page_token`). Which pattern is most reliably understood by an LLM without causing off-by-one errors?

## Sub-Topics to Explore
- Function Calling / Tool Use optimization papers (e.g., Gorilla, Toolformer).
- JSON Schema Draft 2020-12 nuances specific to Anthropic's parser.
- The "Tool Call Loop" — how LLMs decide to stop using tools and write the final answer.
- TypeBox or Zod for defining schemas dynamically in the Node.js MCP server.

## Starting Sources
- **Anthropic Tool Use Documentation:** https://docs.anthropic.com/en/docs/tool-use
- **Gemini Function Calling Docs:** https://ai.google.dev/docs/function_calling
- **JSON Schema Specification:** https://json-schema.org/
- **Paper:** "Toolformer: Language Models Can Teach Themselves to Use Tools" - https://arxiv.org/abs/2302.04761
- **Paper:** "Gorilla: Large Language Model Connected with Massive APIs" - https://arxiv.org/abs/2305.15334
- **Zod library docs:** https://zod.dev/ (for runtime schema validation).

## What to Measure & Compare
- Write two distinct schemas for the same action (e.g., a highly nested JSON schema vs a flat, simple schema). Compare the token count of the schema definition that must be injected into the system prompt.
- Evaluate the token cost of returning 10 search results formatted as raw JSON versus formatted as a clean Markdown list.

## Definition of Done
A 3000+ word design manual for LCS tool creation. It must explicitly define the 3-5 core tools LCS will expose, providing the exact JSON Schema for each, and dictate the standard response format (JSON vs Markdown).

## Architectural Implication
Feeds **ADR-007 (MCP Tool Schema)**. This defines the exact UX of the system for its primary user: the LLM. Poorly designed tools will result in the Pythia oracle flailing, entering loops, or failing to retrieve the data stored in the underlying vector/graph databases.