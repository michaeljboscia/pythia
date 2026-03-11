# How Cursor Indexes Codebases and Assembles LLM Context

**Cursor's AI code editor runs a full RAG pipeline — custom embeddings, AST-aware chunking, Merkle-tree syncing, and hybrid retrieval — to feed codebase context into every LLM prompt it builds.** This architecture has measurable impact: Cursor's own A/B tests show semantic search delivers **12.5% higher accuracy** in agent responses and **2.6% better code retention** on large codebases. Understanding how these pieces fit together is essential for anyone building a competing code intelligence system. This report reconstructs the indexing pipeline, context budgeting strategy, and portable design patterns from Cursor's official blog posts, documentation, reverse-engineering analyses, and community findings.

---

## 1. The indexing pipeline: embeddings, AST chunking, and hybrid retrieval

Cursor's indexing architecture is a server-side RAG system with three distinct stages: **syntactic chunking**, **embedding generation**, and **vector storage** — overlaid with a Merkle-tree synchronization layer that makes incremental updates efficient.

### Merkle trees for change detection

When a project opens, Cursor scans every file in the workspace and computes a [Merkle tree of SHA-256 hashes](https://cursor.com/blog/secure-codebase-indexing). Each leaf node holds the hash of a file's content; parent nodes derive their hashes from children, up to a single root. On sync — roughly every five minutes — Cursor compares client and server trees, walking only the branches where hashes diverge. In a workspace of 50,000 files, the raw filename-plus-hash data totals approximately **3.2 MB**, but the tree structure means only changed branches transfer on each update. The sync process never modifies files on the client side. Files already listed in `.gitignore` or [`.cursorignore`](https://docs.cursor.com/context/ignore-files) are excluded from indexing entirely.

### AST-based syntactic chunking

When a file changes, Cursor splits it into **syntactic chunks at semantically meaningful boundaries** — functions, classes, logical blocks — rather than using fixed-size windows. Third-party analyses report that [tree-sitter (or a comparable AST parser)](https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast) drives this process, traversing the syntax tree depth-first and merging sibling nodes into larger chunks as long as they stay within a token limit. Chunks are typically a few hundred tokens each, though Cursor has not disclosed the exact size. For files in unsupported languages, rule-based text splitters using regex and indentation serve as fallback. This chunking strategy ensures each embedding represents a **complete, coherent code unit** rather than an arbitrary slice of text.

### A custom embedding model trained on agent traces

Cursor has [trained its own embedding model](https://cursor.com/blog/semsearch), confirmed in a November 2025 research blog post. The training methodology is distinctive: Cursor uses **agent sessions as training data**. When an agent works through a coding task, it performs multiple searches and opens files before finding the right code. An LLM then ranks, in retrospect, what content would have been most helpful at each step. The embedding model is trained to align its similarity scores with these LLM-generated rankings. This creates a feedback loop where the model learns from actual agent behavior rather than relying on generic code similarity metrics. Third-party speculation about OpenAI's `text-embedding-3-small` or Voyage AI's `voyage-code-2` has circulated, but Cursor's [product page](https://cursor.com/product) explicitly states: "A custom embedding model gives agents best-in-class recall across large codebases."

Embedding generation is the most expensive step and runs **asynchronously in the background**. Crucially, Cursor [caches embeddings by chunk content hash](https://cursor.com/blog/secure-codebase-indexing) — unchanged chunks hit the cache on re-indexing, so only modified chunks incur compute cost.

### Turbopuffer as the vector database

Multiple corroborating sources identify [Turbopuffer](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/) as Cursor's vector database — a serverless search engine combining vector and full-text search, backed by AWS S3 object storage. Stored alongside each embedding are **obfuscated file paths and start/end line numbers** for the corresponding chunk. No plaintext source code persists on the server. File path components are split by `/` and `.`, then encrypted client-side using a [secret key derived from hashes of recent commit contents](https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast), preserving directory hierarchy for filtering while hiding actual names. Indexed codebases are [deleted after six weeks of inactivity](https://docs.cursor.com/context/codebase-indexing).

### What the @-symbol directives reveal about retrieval

The `@`-symbol system is Cursor's user-facing interface to multiple retrieval strategies, each following a different code path:

**`@Codebase`** triggers the full semantic search pipeline. The user's query is embedded, sent to Turbopuffer for nearest-neighbor search, and results (obfuscated paths + line ranges) are returned to the client. The client decrypts paths, reads corresponding chunks locally, and [sends them as context to the LLM](https://docs.cursor.com/chat/codebase). The official docs note `@Codebase` goes through a "more detailed search" than `Ctrl+Enter`, which performs a lighter scan.

**`@File`** bypasses embedding search entirely. The client fetches the referenced file's full content and injects it into the prompt. If the file is [too long for the context window](https://docs.cursor.com/context/@-symbols/@-files), Cursor chunks it and **reranks chunks by relevance to the query** — a local reranking step, not a vector search.

**`@Code`** references a [specific code selection](https://docs.cursor.com/context/@-symbols/@-code) — more granular than `@File`, allowing precise snippet injection.

**`@Docs`** accesses a [parallel indexing system for documentation](https://docs.cursor.com/context/@-symbols/@-docs). Cursor pre-crawls popular third-party docs and lets users add custom documentation URLs for indexing.

Behind the scenes, the agent also has access to purpose-built [search tools](https://docs.cursor.com/chat/tools): `codebase_search` (semantic), `grep_search` (exact pattern matching via ripgrep), and `file_search` (fuzzy filename matching). Cursor's [research blog confirms](https://cursor.com/blog/semsearch) that "our agent makes heavy use of grep as well as semantic search, and the combination of these two leads to the best outcomes." This **hybrid retrieval** — embeddings for conceptual queries, grep for exact references — is a deliberate architectural choice, not a fallback.

---

## 2. Context window budgeting and large-repository strategies

Managing the tension between "include enough context for accurate responses" and "don't overflow the window" is where Cursor's engineering gets most intricate. The system uses a layered approach: smart defaults, automatic condensation, dynamic discovery, and conversation-level summarization.

### Default budget and Max Mode

Cursor's [standard context window is 200,000 tokens](https://docs.cursor.com/models), approximately 15,000–16,000 lines of code. This accommodates most workflows without manual tuning. For tasks requiring deeper context, **Max Mode** extends the window to each model's maximum — up to **1 million tokens** for Gemini 2.5 Pro and GPT 4.1. Max Mode costs more ($0.05 per request + $0.05 per tool call) and runs slower, but enables substantially more codebase context per prompt. Historical documentation references smaller defaults — 40k tokens for Chat, 10k for Cmd-K, 60–120k for Agent — suggesting these limits have expanded significantly as model capabilities grew.

### Automatic condensation and file handling

When files or folders exceed available context space, Cursor [automatically condenses them](https://docs.cursor.com/context/management). Condensation shows the model **key structural elements** — function signatures, class declarations, method headers — while omitting implementation details. The model can then choose to expand specific sections if needed. Files too large even for condensed form show only the filename. A warning icon appears when an item cannot fit at all. This tiered degradation — full content → condensed signatures → filename only → excluded — ensures the model always gets some signal about what exists, even when it can't see everything.

For `@File` references specifically, large files are [chunked and reranked by relevance](https://docs.cursor.com/context/@-symbols/@-files) rather than truncated at a fixed offset. This means the model sees the most query-relevant portions of a file, not just the top N lines. In Agent mode, the `read_file` tool reads the [first 250 lines by default](https://blog.sshh.io/p/how-cursor-ai-ide-works), extending by another 250 on demand, while search results return a maximum of 100 lines.

### Dynamic context discovery: files as the universal interface

Cursor's January 2026 research post on [dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery) describes a paradigm shift from static context (everything stuffed into the prompt upfront) to lazy, agent-driven retrieval. The core insight: "as models have become better as agents, we've found success by providing fewer details up front, making it easier for the agent to pull relevant context on its own." Five techniques implement this pattern:

- **Long tool responses become files.** Instead of truncating shell command or MCP tool output (risking data loss), Cursor writes the output to a file and gives the agent `tail` access. The agent reads what it needs.
- **Chat history persists as files.** After summarization, a reference to the full history file lets the agent search for forgotten details, recovering information that lossy compression might have dropped.
- **MCP tool descriptions are synced to folders.** Rather than injecting all tool descriptions statically, the agent receives only tool names and looks up full descriptions on demand. In A/B testing, this [reduced total agent tokens by 46.9%](https://cursor.com/blog/dynamic-context-discovery) in MCP-using runs.
- **Terminal sessions are treated as files.** The agent can grep long terminal output for relevant portions rather than having everything injected.
- **Agent Skills use file-based discovery.** Skill definitions include names and descriptions for static inclusion, but the agent discovers and reads full skill content dynamically.

This file-as-interface abstraction is deliberately low-tech. Cursor acknowledges it may not be the final form, but files give the agent a universal primitive — `read`, `grep`, `tail` — that works across all context types.

### Conversation summarization

When a context window fills, Cursor [triggers automatic summarization](https://docs.cursor.com/context/management) using smaller, faster models (`cursor-small`, `gpt-4o-mini`). The summarization preserves key information but is inherently lossy. The dynamic context discovery pattern mitigates this: post-summarization, the agent retains a file reference to the full history and can search it to recover specifics. For extended conversations, Cursor [suggests starting a new conversation](https://docs.cursor.com/context/management) with a reference to the previous one, keeping context fresh and focused.

### Handling monorepos and repositories with 10K+ files

Cursor's auto-indexing engages for projects with [fewer than 50,000 files](https://bitpeak.com/how-cursor-works-deep-dive-into-vibe-coding/). Semantic search is not available until at least [80% of indexing completes](https://cursor.com/blog/secure-codebase-indexing). For naive initial indexing, large repos with tens of thousands of files can take hours — but Cursor's **team index reuse** system dramatically shortens this.

The reuse mechanism works through [simhash matching](https://cursor.com/blog/secure-codebase-indexing): when a new user opens a codebase, the client derives a similarity hash from the Merkle tree and uploads it to the server, which searches existing indexes within the same team. Since clones average **92% similarity** within organizations, the server can typically copy an existing index immediately. Performance improvements are dramatic: **time-to-first-query drops from 7.87 seconds to 525 milliseconds** at the median, from 2.82 minutes to 1.87 seconds at P90, and from **4.03 hours to 21 seconds** at P99. The system uses Merkle-tree content proofs to ensure the client never sees results for files it doesn't possess locally.

For active management of large codebases, Cursor provides two ignore mechanisms. [`.cursorignore`](https://docs.cursor.com/context/ignore-files) completely excludes files from both indexing and AI access — essential for sensitive files, vendored dependencies, or unrelated monorepo modules. [`.cursorindexingignore`](https://docs.cursor.com/context/ignore-files) excludes files from indexing only; they remain accessible to AI features when explicitly referenced but won't appear in semantic search results. Community reports indicate that proper ignore configuration can [cut indexing time substantially](https://forum.cursor.com/t/context-and-large-codebases/50750) — one report noted a 500K-LOC monorepo dropping from 12 minutes to 3 minutes. Multiple community users, however, [report that Cursor's context finding can feel shallow](https://forum.cursor.com/t/context-and-large-codebases/50750) on very large enterprise codebases, with the agent doing only a few lookups rather than deep traversal.

### Prompt structure and caching

Each turn triggers a [full prompt rebuild](https://blog.sshh.io/p/how-cursor-ai-ide-works) server-side using Cursor's custom engine, **Priompt**. The prompt includes system instructions (~1k tokens), model-specific adjustments, user input, chat history, tool definitions (limited to the first 40 tools), and retrieved code snippets. Static elements — system prompt, tool schemas — are **aggressively cached** to reduce latency and cost. Cursor's system prompt is [identical across all users](https://blog.sshh.io/p/how-cursor-ai-ide-works) (no per-codebase personalization), maximizing cache hit rates. The agent harness is then [optimized individually per frontier model](https://cursor.com/blog/dynamic-context-discovery), meaning Claude, GPT, and Gemini each receive slightly different tool definitions and behavioral instructions.

---

## 3. Portable patterns for an MCP-based code intelligence system

Several architectural patterns from Cursor transfer directly to an MCP-based system, while others require adaptation. Here is a practical assessment of what to reuse, what to modify, and what to avoid.

### The @-symbol directive pattern: explicit context injection

Cursor's `@` directives translate naturally to MCP resource URIs or tool invocations. The key insight is **typed context references** with distinct retrieval strategies:

- `@File` → An MCP resource that returns the full content of a file, with built-in chunking and reranking when the file exceeds a size threshold. In MCP terms, this maps to a `resources/read` call with an optional `relevance_query` parameter.
- `@Codebase` → An MCP tool that performs semantic search against the codebase index and returns ranked snippets. The tool should accept a natural-language query and return code chunks with file paths and line ranges.
- `@Code` → A parameterized resource reference (file + line range) that returns a specific snippet. This is more precise than `@File` and maps directly to a resource URI with fragment identifiers.
- `@Docs` → A separate MCP tool or resource pointing to a documentation index, distinct from the code index. Cursor's approach of pre-crawling and indexing docs into a parallel system is directly replicable.

The critical design choice is making these **user-invocable** (explicit `@` references) while also making them **agent-invocable** (the agent can call `codebase_search` or `read_file` autonomously). An MCP-based system should expose both paths.

### Rules files with typed activation

Cursor's [rules system](https://docs.cursor.com/context/rules) offers a highly portable pattern. The four activation types — **Always** (always injected), **Auto Attached** (injected when matching files are referenced), **Agent Requested** (agent decides based on description), and **Manual** (user must explicitly invoke) — represent a spectrum from fully static to fully dynamic context inclusion. The [MDC format](https://forum.cursor.com/t/a-deep-dive-into-cursor-rules-0-45/60721) with YAML frontmatter (`description`, `globs`, `alwaysApply`) is simple and version-controllable.

For an MCP system, rules map to **prompt templates or system-prompt fragments** stored as files in the project. The activation logic is straightforward to implement: glob matching against referenced files for Auto Attached rules, and including rule descriptions in the system prompt for Agent Requested rules so the model can use a `fetch_rules` tool. The [precedence hierarchy](https://docs.cursor.com/context/rules) — Team → Project → User — provides a clean override model for enterprise settings.

One caveat from community experience: rules are treated as [suggestions, not mandates](https://forum.cursor.com/t/definitive-rules/45282). The system prompt frames them with "use them if they seem useful." A competing system could enforce rules more strictly by placing them in the system prompt rather than in a separate `cursor_rules_context` section.

### Hybrid search: semantic + lexical as first-class tools

Cursor's research data makes the case definitively: **semantic search alone is insufficient, and grep alone is insufficient**. The [combination of both produces the best outcomes](https://cursor.com/blog/semsearch). An MCP-based system should expose at minimum three search tools: semantic search (embeddings), exact pattern search (grep/ripgrep), and fuzzy file-name search. These should be presented as peer tools the agent can use interchangeably, not as a single search API with mode flags.

The embedding model choice matters less than the training methodology. Cursor's approach of training on agent session traces — using retrospective LLM rankings to generate supervision signal — is a pattern any team with agent usage data can replicate. Start with an off-the-shelf code embedding model (OpenAI `text-embedding-3-large`, Voyage `voyage-code-3`) and fine-tune on your own agent traces once you have volume.

### Dynamic context discovery via the filesystem

The [file-as-interface pattern](https://cursor.com/blog/dynamic-context-discovery) is perhaps the most directly portable insight. For MCP specifically, Cursor's approach to MCP tool description management — syncing descriptions to a folder, loading only tool names statically, and letting the agent look up details on demand — achieved a **46.9% token reduction**. Any MCP client managing multiple servers with many tools should implement this pattern. The implementation is straightforward: maintain a local directory structure mirroring MCP server tool catalogs, expose it via `read_file` and `grep`, and include only tool names in the system prompt.

The broader principle applies to all long-lived context: **write it to a file, give the agent read access, let it decide what to pull in**. This inverts the traditional prompt-stuffing approach and scales far better as context sources multiply.

### Condensation strategies for context budgeting

Cursor's tiered condensation — full content → structural signatures → filename → excluded — is a directly replicable strategy. Implementing it requires an AST parser (tree-sitter covers most languages) that can extract function signatures, class definitions, and type declarations. The condensed view serves as a "table of contents" that lets the model decide what to expand. For an MCP resource server, this maps to offering multiple **detail levels** per resource: `outline` (signatures only), `relevant` (chunks reranked by query), and `full` (complete content).

### What doesn't transfer directly

Some Cursor patterns are tightly coupled to their specific architecture. The **Merkle-tree syncing and simhash team index reuse** depend on a centralized server managing indexes across users — an MCP system running locally would need a different change-detection strategy (file watchers, git hooks). The **Priompt prompt engine** handles server-side prompt assembly with model-specific optimizations; an MCP system would need its own prompt construction layer. And Cursor's **custom apply model** (`cursor-small` for converting semantic diffs to file edits) is a proprietary model that would need to be replicated or replaced with a different edit-application strategy.

---

## Conclusion

Cursor's architecture reveals a system that has evolved through measured experimentation rather than theoretical design. Three findings stand out for anyone building a competing system. First, **the embedding model training loop matters more than the model itself** — Cursor's approach of using retrospective agent traces to generate training signal means their embeddings improve automatically as agent usage grows, creating a compounding advantage. Second, **dynamic context discovery is the future of context engineering** — the 46.9% token reduction for MCP tools demonstrates that lazy loading beats prompt stuffing, and this pattern generalizes beyond MCP to all context types. Third, **hybrid search is non-negotiable** — every evaluation Cursor has published shows semantic search and grep together outperform either alone, across all frontier models tested.

The most underappreciated element may be the rules system's typed activation model. By distinguishing between always-on, glob-matched, agent-discovered, and manually-invoked rules, Cursor gives teams a gradient of control that scales from solo projects to enterprise monorepos. This same pattern — tiered activation with machine-readable metadata — maps cleanly onto MCP prompt templates and deserves direct adoption in any competing system.

---

## Version and timestamp

This analysis reflects publicly available information as of **March 11, 2026**. Key Cursor blog posts referenced were published between November 2025 and January 2026. Documentation was accessed from docs.cursor.com in its current state. Community discussions span 2023–2026. Cursor's internal architecture continues to evolve rapidly; specific implementation details may change.

---

## Bibliography

1. **"Securely indexing large codebases"** — Cursor official blog, Jan 27, 2026. https://cursor.com/blog/secure-codebase-indexing — Primary source for Merkle tree architecture, team index reuse via simhash, embedding caching, and time-to-first-query performance numbers.

2. **"Improving agent with semantic search"** — Cursor official blog, Nov 6, 2025. https://cursor.com/blog/semsearch — Primary source confirming custom embedding model, agent-trace training methodology, 12.5% accuracy improvement, and hybrid search (semantic + grep) strategy.

3. **"Dynamic context discovery"** — Cursor official blog, Jan 6, 2026. https://cursor.com/blog/dynamic-context-discovery — Primary source for file-as-interface pattern, MCP tool description management (46.9% token reduction), chat history file references, Agent Skills standard, and terminal session integration.

4. **Cursor Docs: Codebase Indexing** — https://docs.cursor.com/context/codebase-indexing — Official documentation on indexing behavior, embedding storage, privacy model, multi-root workspaces, PR search indexing, and 6-week inactivity deletion.

5. **Cursor Docs: @-Symbols Overview** — https://docs.cursor.com/context/@-symbols — Official documentation on all @ directives including @File, @Code, @Codebase, @Docs, @Git, @Web, @Cursor Rules, with behavioral details.

6. **Cursor Docs: @Files and Folders** — https://docs.cursor.com/context/@-symbols/@-files — Documentation on file chunking, reranking by relevance for large files, drag-and-drop context, and condensation behavior.

7. **Cursor Docs: Context Management** — https://docs.cursor.com/context/management — Documentation on automatic condensation, conversation summarization, and context window overflow handling.

8. **Cursor Docs: Rules** — https://docs.cursor.com/context/rules — Official documentation on the four rule types (Always, Auto Attached, Agent Requested, Manual), MDC format, precedence hierarchy, and nested rules.

9. **Cursor Docs: Ignore Files** — https://docs.cursor.com/context/ignore-files — Documentation on .cursorignore (full exclusion) and .cursorindexingignore (indexing-only exclusion) with gitignore-style pattern syntax.

10. **Cursor Docs: Models** — https://docs.cursor.com/models — Documentation on 200k token default context window, Max Mode extending to 1M tokens, and model-specific context limits.

11. **Cursor Docs: Agent Tools** — https://docs.cursor.com/chat/tools — Documentation on codebase_search (semantic), grep_search (exact), file_search (fuzzy), and other agent-available tools.

12. **Cursor Docs: Working with Context** — https://docs.cursor.com/guides/working-with-context — Guide covering intent vs. state context, automatic context inclusion, and explicit context methods.

13. **"How Cursor indexes codebases fast"** — Engineer's Codex (Ryan Peterman), 2026. https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast — Third-party analysis of AST-based chunking via tree-sitter, path obfuscation, and sync architecture.

14. **"How Cursor actually indexes your codebase"** — Towards Data Science, 2025. https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/ — Third-party deep dive identifying Turbopuffer as vector database, analyzing retrieval pipeline, and documenting path encryption scheme.

15. **"How Cursor works deep dive into vibe coding"** — BitPeak, 2025. https://bitpeak.com/how-cursor-works-deep-dive-into-vibe-coding/ — Analysis reporting 50,000-file auto-index limit, monorepo testing with large-monorepo benchmarks, and claim of Cursor's own embedding model.

16. **"How Cursor AI IDE works"** — Shrivu Shankar (sshh.io), March 2025. https://blog.sshh.io/p/how-cursor-ai-ide-works — Reverse engineering of system prompt, tool definitions, 250-line read_file limit, apply model architecture, and ReAct agent loop.

17. **"A deep dive into Cursor rules (0.45)"** — haojixing, Cursor Community Forum. https://forum.cursor.com/t/a-deep-dive-into-cursor-rules-0-45/60721 — Community analysis of rules injection into prompts, two-stage activation, and how descriptions are used by the LLM.

18. **"Context and large codebases"** — Cursor Community Forum. https://forum.cursor.com/t/context-and-large-codebases/50750 — User reports on shallow context finding in large enterprise codebases and Cursor team recommendations for memory.md files.

19. **"Codebase indexing"** — Cursor Community Forum (Michael Truell, co-founder), August 2023. https://forum.cursor.com/t/codebase-indexing/36 — Early explanation of indexing pipeline from Cursor co-founder, confirming server-side embedding and remote vector DB storage.

20. **"Dynamic context discovery for production coding agents"** — ZenML LLMOps Database. https://www.zenml.io/llmops-database/dynamic-context-discovery-for-production-coding-agents — Independent analysis of Cursor's dynamic context discovery approach, token efficiency implications, and operational considerations.