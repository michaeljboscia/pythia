# Research Prompt: MC-04 MCP Context Window Management

## Research Objective
Investigate strategies for enforcing context budgets, mitigating the "Lost in the Middle" problem, and handling overflow when returning dense retrieval data via the MCP protocol. The goal is to define how LCS compresses, truncates, or formats the raw output from the vector (*VD-01*) and graph (*GD-01*) databases before it hits the LLM client, ensuring maximum fidelity without token exhaustion.

## Research Questions
1. **The Context Budget:** Claude 3.5 Sonnet has a 200k context window, but performance degrades heavily before that. What is the mathematically optimal "budget" (in tokens) that an LCS tool call should return to ensure high-fidelity reasoning (*RF-07*)?
2. **Truncation Strategies:** When a GraphRAG query returns 50 related documents that total 80k tokens, how should the MCP server truncate the payload? Should it drop entire documents, truncate the middle of each document, or only return the "summaries"?
3. **Information Density formatting:** Does returning retrieved code chunks surrounded by XML tags (e.g., `<file path="x">...` ) perform better in attention tests than returning them in standard Markdown code blocks? (*RF-08*)
4. **Graph Context Representation:** How do you serialize a 50-node, 200-edge subgraph into text so that an LLM can reason about the topology? Compare edge-list format (`A -> CALLS -> B`) vs adjacency-list format vs Cypher-like strings.
5. **Context Compression (LLMLingua):** Should the LCS MCP server run a lightweight, local extractive compression model (like LLMLingua) to strip stop-words and boilerplate from code chunks *before* returning them over the wire (*RF-12*)?
6. **Overflow Handling:** If a query specifically asks for "all 150 instances of this variable," and the result exceeds the safe return budget, what is the exact mechanism the tool uses to inform the LLM? (e.g., returning the first 10, plus a `has_more: true` flag and instructions on how to page).
7. **Primacy/Recency Bias Exploitation:** Given that LLMs pay more attention to the beginning and end of a context window, how should the MCP server order a list of 10 search results? Should the highest-scoring vector match be placed first or last in the returned string?
8. **The Pythia Inter-Agent Link:** If Pythia is managing the global context window in `~/.claude`, how does LCS (as a subordinate MCP) communicate its token payload size so Pythia can manage the overall session history?
9. **Handling Binary/Image Data:** Though primarily text, what if LCS indexes an architecture diagram (PNG)? Does the MCP spec allow returning base64 image data inside a tool response, and how does that impact the context budget?
10. **The "Read More" Pattern:** Should LCS tools default to returning only skeletons (function signatures, headers) and force the LLM to use a secondary `read_full_file` tool to drill down, conserving context aggressively?

## Sub-Topics to Explore
- Attention allocation in long-context models (Needle In A Haystack tests).
- XML formatting vs JSON formatting for prompt injection.
- LLMLingua architecture and latency.
- Cursor's context window management (how they decide what files to drop from the prompt).

## Starting Sources
- **Lost in the Middle Paper:** https://arxiv.org/abs/2307.03172
- **LLMLingua Paper/Repo:** https://github.com/microsoft/LLMLingua
- **Anthropic Prompt Engineering - Long Context:** https://docs.anthropic.com/en/docs/long-context-window-tips
- **Cursor Forum/Blog:** Discussions on their "Context" tab and how they rank files.
- **Graph Serialization Paper:** "Can Language Models Understand Graphs?" - https://arxiv.org/abs/2305.10037
- **Needle In A Haystack methodology:** https://github.com/gkamradt/LLMTest_NeedleInAHaystack

## What to Measure & Compare
- Calculate the token savings of stripping all TypeScript type annotations and comments from a 1000-line file before returning it via MCP. Does the loss of semantic info outweigh the context savings?
- Compare the exact token counts of serializing a 10-node graph in JSON, Edge-List (`A->B`), and XML format.

## Definition of Done
A 3000-5000 word framework for context formatting. The output must define the exact string formatting (XML/Markdown) LCS will use to return results, establish a hard token limit per tool call, and define the overflow/pagination strategy.

## Architectural Implication
Feeds **ADR-009 (Context Packing)** and **ADR-007 (MCP Tool Schema)**. This defines the final transformation layer of the retrieval pipeline. Even if Vector and Graph DBs return perfect results, formatting them poorly will result in the LLM ignoring the data.