# Plan first, then generate: how Copilot Workspace reshaped multi-file code editing

*Created: March 11, 2026*

GitHub Copilot Workspace introduced a structured **plan-then-implement pipeline** — Task → Specification → Plan → Implementation → Validation — that decomposes code generation into human-reviewable natural-language stages before a single line of code is written. This architecture, active as a technical preview from April 2024 to May 2025, demonstrated that inserting an explicit planning step between intent and code yields measurably better multi-file edits, and that the patterns it pioneered are directly portable to MCP-based retrieval systems. The approach has since been absorbed into GitHub's Copilot Coding Agent, but its architectural lessons remain the clearest public blueprint for building plan-aware code generation. This analysis grounds every claim in sources actually read, examines why planning reduces hallucinations, and extracts concrete design patterns for retrieval systems that must serve both planning and editing workloads.

## The five-stage pipeline that separates intent from implementation

Copilot Workspace's core insight was treating code generation as a compiler for natural language. The project originated from a GitHub Next research effort called SpecLang, which conceptualized "specs as permanent and code as ephemeral" — an inversion of how most developers think about their artifacts. The [user manual](https://github.com/githubnext/copilot-workspace-user-manual/blob/main/origins.md) describes this as the **Extract, Edit, Apply (EEA)** paradigm: use AI to extract a specification from existing code, let the human edit the specification, and have AI apply that change back to code.

The production system implemented five discrete stages. **Stage one** is the Task — a natural language description of intent always grounded in a GitHub repository. Tasks could originate from GitHub issues (where the task derives from "the title and body of the issue, plus the issue's comment thread"), pull requests, template repositories, or ad-hoc descriptions entered via URL. Crucially, the system also reads a `.github/copilot-workspace/CONTRIBUTING.md` file if present, providing repository-wide instructions that persist across sessions.

**Stage two** is the Specification, which the [GitHub Next project page](https://github.blog/news-insights/product-news/github-copilot-workspace/) describes as "two bullet-point lists: one for the current state of the codebase, and one for the desired state." The current specification builds developer confidence that the system understands the existing codebase. The proposed specification defines **success criteria**, deliberately avoiding implementation details — that responsibility belongs to the plan. Both lists are fully editable and regeneratable. Before generating the specification, the system distills the task into a **topic** — a single-sentence question posed against the codebase that anchors all subsequent reasoning.

**Stage three** is the Plan — a list of every file to create, modify, delete, move, or rename, with bullet-point steps describing exact changes per file. The [user manual overview](https://github.com/githubnext/copilot-workspace-user-manual/blob/main/overview.md) notes that plans are "fully editable" and update incrementally when users make natural-language revisions rather than regenerating from scratch. This incremental update behavior is architecturally significant: it means the system maintains a dependency graph between plan items rather than treating the plan as a monolithic text block.

**Stage four** is Implementation, where clicking "Implement" queues file updates that generate sequentially. The system uses **whole-file rewriting** — each modified file's entire content is regenerated, with diff views rendered automatically. Files can be selectively reimplemented by editing their plan steps and clicking "Update selected files," enabling surgical iteration without regenerating the entire changeset.

**Stage five** is Validation, backed by an integrated terminal running in a [Codespace sandbox](https://github.blog/changelog/2025-01-31-copilot-workspace-auto-validation-go-to-definition-and-more/) that supports build, lint, and test commands. A **repair agent** can automatically fix code based on terminal error output, and auto-validation was added in January 2025. For deeper debugging, sessions can escalate to a full Codespace with bidirectional sync.

The entire system ran on **GPT-4o**, selected after experimentation with "many different models from various providers, considering factors like power and latency." Three specialized agents powered different phases: a Plan agent for the spec-plan-implement pipeline, a Brainstorm agent for exploratory Q&A about the codebase, and a Repair agent for error-driven code fixes.

## How context selection works under the hood

The most architecturally consequential mechanism in Copilot Workspace is **content selection** — the process of identifying which repository files matter for a given task. The user manual states this explicitly: "Copilot Workspace needs to identify which files in the codebase are relevant to understanding and completing the task. It does this by **a combination of LLM techniques and traditional code search**. The contents of the highest-ranked files are then used as context for nearly all steps in the workflow."

This hybrid approach reflects the broader Copilot ecosystem's retrieval architecture. The [VS Code workspace context documentation](https://code.visualstudio.com/docs/copilot/reference/workspace-context) describes three complementary retrieval layers: GitHub's code search for "fast, comprehensive search across your repository," local semantic search using vector embeddings for meaning-based matching, and VS Code's language intelligence (IntelliSense, LSP) for resolving "symbols, function signatures, type hierarchies, and cross-file references." GitHub Next's research on [Copilot for Your Codebase](https://githubnext.com/projects/copilot-view/) confirms that RAG with vector databases underpins Copilot Chat on github.com, combined with "GitHub's sophisticated non-neural code search capabilities."

Users can inspect content selection via a "View references" button in the Specification panel, and steer it by editing the task with natural language like "focus on files in the authentication module." This transparency distinguishes Workspace from opaque retrieval systems — it surfaces the retrieval decisions as a reviewable artifact, making the human-in-the-loop paradigm extend to context assembly itself.

What GitHub did not publicly disclose includes the exact chunking strategies for large files, the specific ranking algorithms within content selection, token budgets per pipeline phase, and whether GPT-4o was fine-tuned for the Workspace workflow. These gaps matter for anyone attempting to replicate the architecture.

## Why planning before generation reduces hallucinations

The empirical evidence for plan-then-implement superiority is substantial and converging from multiple research threads. The foundational study is [Jiang et al.'s Self-Planning Code Generation](https://arxiv.org/abs/2303.06689) (2023), which introduced a two-phase framework where the LLM first "outlines concise and formatted planning steps from the intent" before generating code step-by-step. Their results are stark: **up to 25.4% relative improvement in Pass@1** over direct generation and **11.9% over Chain-of-Thought** prompting. When ground-truth human-written plans replaced model-generated ones, improvements reached **over 50% on HumanEval** — demonstrating that the ceiling for planning gains is far above what current models achieve autonomously.

[Structured Chain-of-Thought (SCoT) prompting](https://arxiv.org/abs/2305.06599) (Li et al., 2025) builds on this by using programming structures — sequences, branches, loops — as intermediate reasoning scaffolds, achieving **13.79% improvement over CoT on HumanEval**. The Multi-Stage Guided (MSG) framework blends Self-Planning with SCoT into three phases (planning → pseudo-code design → implementation), observing that these phases "progressively narrow the transformation distance between the problem description and the correct code." Most recently, Microsoft tested a Planning feature in Visual Studio against SWE-bench and found that both GPT-5 and Claude Sonnet 4 achieved [approximately 15% higher success rates and 20% more tasks resolved](https://devops.com/visual-studio-copilot-gets-planning-mode-for-complex-tasks/) with planning enabled, with gains concentrated on "larger, multistep problems where structure matters most."

The hallucination reduction mechanism operates through three channels. First, planning **decomposes the generation space**. A [2025 survey on hallucination mitigation](https://arxiv.org/html/2510.24476v1) states explicitly: "By adopting step-by-step generation instead of one-shot generation, they achieve more stable and controllable code synthesis. This reasoning-driven paradigm significantly reduces programming logic hallucinations and enhances traceability, editability, and composability." Second, planning creates **checkpoints for human correction**. As the GitHub Next FAQ explains: "When you can steer the system at each of these steps, you are supplying crucial information that helps the model to generate code, and the resulting code is more likely to be correct." Third, planning enables **expectation-setting for review**: "you go into the review process with a clear expectation of which changes should happen where," reducing the cognitive load of verifying multi-file changes.

[Zhang et al.'s hallucination taxonomy](https://arxiv.org/pdf/2409.20550) (2025) identifies three categories — Task Requirement Conflicts, Factual Knowledge Conflicts, and Project Context Conflicts — with the last being especially prevalent in multi-file scenarios where the model references undefined attributes or misunderstands cross-file relationships. Planning addresses Project Context Conflicts directly by forcing the model to articulate its understanding of the codebase (the "current specification") before proposing changes, creating an auditable checkpoint where factual errors about the repository can be caught.

Practitioner evidence aligns with the academic findings. Developer experience reports note that without planning, LLM-generated code in large projects looks like it was written by ["10 devs who worked on it without talking to each other"](https://addyosmani.com/blog/ai-coding-workflow/). Addy Osmani's widely-cited workflow recommends feeding specifications into reasoning models to generate plans, iterating until coherent, and only then proceeding to code — calling the upfront investment slow but reporting it "pays off enormously." Self-reflection with planning reduced hallucination rates from **47.5% to approximately 14.5%** in his experience.

## How competing tools handle planning and multi-file context

The plan-then-implement pattern appears across the ecosystem with varying degrees of explicitness. **Aider** implements the most comparable architecture through its [Architect mode](https://aider.chat/docs/usage/modes.html), where an architect model proposes changes that an editor model translates into file edits. Aider's distinctive contribution is its **repository map** — a [tree-sitter-based](https://aider.chat/2023/10/22/repomap.html) index of function signatures and class hierarchies across the entire codebase, ranked by a **PageRank algorithm** that identifies symbols "most often referenced by other portions of the code." This achieves a **98% reduction in token usage** versus naive full-codebase context, with reported ~85% success rates on multi-file coordinated changes versus ~40% for single-file approaches. An [exploratory study of code retrieval in coding agents](https://www.preprints.org/manuscript/202510.0924/v1/download) found Aider achieves the highest context efficiency at **4.3–6.5% utilization**, compared to Cline at 17.5% and Claude Code at 54–58.5%.

**Devin 2.0** introduced [Interactive Planning](https://cognition.ai/blog/devin-2) where "each time you start a session, Devin responds in seconds with relevant files, findings, and a preliminary plan" that users can modify before autonomous execution. Devin's self-review mechanism catches approximately **30% more issues** than PRs submitted without review. **Cursor** takes a different approach: its [Composer model](https://www.codecademy.com/article/cursor-2-0-new-ai-model-explained) (trained via reinforcement learning inside real codebases) runs up to eight agents simultaneously using Git worktree isolation, but planning is implicit within agent reasoning rather than surfaced as an editable artifact. [Augment Code's analysis](https://www.augmentcode.com/tools/cursor-ai-limitations-why-multi-file-refactors-fail-in-enterprise) identifies Cursor's key limitation: "When a refactor spans 50 files totaling 200,000 tokens, but Cursor's context window holds 100,000 tokens, the tool can't maintain consistent state across all affected files" — a problem that explicit planning architectures mitigate by compressing cross-file relationships into plan-level abstractions.

**LangChain's Open SWE** makes the strongest explicit case for the pattern: ["Many agents jump straight to code, often leading to mistakes that break your CI pipeline. Open SWE uses a multi-agent architecture with dedicated Planner and Reviewer components."](https://blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/) Its human-in-the-loop planning interrupts execution to let users accept, edit, or reject the plan before code generation proceeds.

The emerging consensus across tools is clear: **the architect/planner + editor/implementer separation** is a recurring architectural pattern. Copilot Workspace's spec/plan/implement pipeline, Aider's architect mode, Open SWE's Planner/Programmer split, and SWE-AF's architecture-first review all embody this separation, with the key differentiator being how much of the planning artifact is exposed to and editable by the human.

## What retrieval must look like for planning versus editing

The most portable insight from Copilot Workspace is that **context assembly must be task-type-aware** — the information needed to plan multi-file changes is structurally different from the information needed to edit a single file. This distinction maps directly onto different retrieval strategies for MCP-based systems.

For **multi-file planning**, retrieval should prioritize structural and architectural context. Aider's repository map demonstrates the pattern: tree-sitter extracts symbol definitions from every source file, a dependency graph connects files that share references, and PageRank ranks symbols by how central they are to the codebase. The resulting map shows "classes, methods and function signatures from everywhere in the repo" — enough for the LLM to "figure out how to use the API exported from a module just based on the details shown in the map" without consuming tokens on implementation details. [RepoMaster](https://arxiv.org/html/2505.21577v2) extends this by constructing "function-call graphs, module-dependency graphs, and hierarchical code trees to identify essential components, providing only identified core elements to the LLMs rather than the entire repository." [CodexGraph](https://arxiv.org/html/2408.03910v1) goes further, building a Neo4j code property graph where "all symbols and their interrelations (CONTAINS, HAS_METHOD, INHERITS, USES, CALLS) are available as traversable nodes and edges," enabling the LLM to write Cypher queries for complex multi-hop context retrieval.

For **single-file editing**, retrieval should prioritize implementation-level context with high locality. GitHub Copilot's inline completion system exemplifies this: it scans "all open editor tabs, recently edited files, files in the same directory, and your import graph," then [breaks each file into 60-line sliding windows scored by Jaccard similarity](https://dzone.com/articles/github-copilot-multi-file-context-internal-architecture) to the code surrounding the cursor. Only the highest-scoring window per file survives. Context recalculates "on nearly every keystroke." The [ContextModule production system](https://arxiv.org/html/2412.08063v1) retrieves three types for editing: "user behavior-based code, similar code snippets, and critical symbol definitions" via a Code Knowledge Graph.

The table below summarizes the retrieval divergence:

| Dimension | Multi-file planning | Single-file editing |
|-----------|-------------------|-------------------|
| Granularity | Module boundaries, API surfaces, dependency graphs | Function bodies, local types, imports |
| Retrieval strategy | Graph-based (PageRank, dependency traversal) | Similarity-based (Jaccard, embeddings) + recency |
| Key signals | Cross-file references, import graphs, inheritance chains | Cursor proximity, open tabs, recent edits |
| Token budget | Larger, to show architectural breadth | Smaller, focused precision around the edit point |
| Update frequency | Per-task or per-session | Per-keystroke for real-time responsiveness |

[Augment Code's research](https://www.augmentcode.com/tools/context-window-wars-200k-vs-1m-token-strategies) provides a counterintuitive finding that reinforces the importance of retrieval quality over quantity: a tool with **200K tokens of optimized context** outperforms tools with **1M+ token context dumps** on accuracy, latency, and cost. Smart retrieval beats brute-force context loading. [Sourcegraph's Cody](https://sourcegraph.com/blog/how-cody-understands-your-codebase) moved away from embeddings entirely for enterprise scale, finding that "as the size of a codebase increases, so does the respective vector database, and searching vector databases for codebases with >100,000 repositories is complex and resource-intensive."

## Designing an MCP-based retrieval system informed by these patterns

The [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2025-11-25) defines three server primitives directly applicable to plan-aware code retrieval: **Tools** (executable functions the LLM can call), **Resources** (structured data included in prompt context), and **Prompts** (reusable interaction templates). MCP takes explicit inspiration from the Language Server Protocol, which "standardizes how to add support for programming languages across a whole ecosystem of development tools" — the same LSP that provides the go-to-definition and find-references capabilities critical for code-aware retrieval.

A plan-aware MCP retrieval system should implement **progressive disclosure** — a pattern visible in Copilot Workspace's own architecture. The system starts with a lightweight structural overview (analogous to Aider's repo map) exposed as an MCP Resource, then provides Tools for the LLM to request specific file contents, symbol definitions, or dependency subgraphs on demand. This mirrors the [Anthropic engineering blog's Code Mode pattern](https://www.anthropic.com/engineering/code-execution-with-mcp), where instead of loading all tool definitions into context, agents write code to call tools dynamically — reducing token usage "from 150,000 tokens to 2,000 tokens, a saving of 98.7%." Cloudflare applied the same pattern to their [2,500-endpoint API](https://blog.cloudflare.com/code-mode/), collapsing it into two tools and roughly 1,000 tokens of context.

Several existing MCP servers demonstrate pieces of this architecture. [RepoMapper MCP](https://mcpservers.org/servers/pdavis68/RepoMapper) implements Aider's tree-sitter + PageRank approach as an MCP server with token-aware output. [Claude Context MCP by Zilliz](https://github.com/zilliztech/claude-context) provides hybrid BM25 + dense vector search with claimed ~40% token reduction. The [code-context-provider-mcp](https://github.com/AB498/code-context-provider-mcp) extracts directory structures and code symbols using WebAssembly tree-sitter parsers. The [official GitHub MCP Server](https://github.com/github/github-mcp-server) provides repository management, code search, and dependency analysis capabilities.

A concrete architecture for an MCP-based plan-aware retrieval system would implement four MCP Tools and two MCP Resources:

**Tools** (on-demand, LLM-invoked):
- `get_repo_map(token_budget)` — returns a PageRank-ordered symbol map fitting within the specified token budget, optimized for planning tasks
- `get_file_context(path, mode)` — returns either architectural context (signatures, exports, dependency edges) for `mode=planning` or full implementation context (function bodies, local types, test patterns) for `mode=editing`
- `search_symbols(query, scope)` — hybrid BM25 + semantic search over the code graph, scoped to either the full repository or a specific module
- `get_dependency_subgraph(entry_points)` — returns the transitive dependency graph rooted at specified files or symbols

**Resources** (passive, always available):
- `repo_structure` — directory tree with file sizes and language detection
- `active_context` — currently open files, recent edits, and cursor position (for editing tasks)

This design separates the planning retrieval path (graph-based, architectural, broad) from the editing retrieval path (similarity-based, implementation-level, focused) at the tool interface level, letting the LLM choose the appropriate retrieval strategy based on whether it is generating a plan or implementing one.

The [three-tier context infrastructure](https://arxiv.org/html/2602.20478v1) proposed for large AI-assisted projects provides additional structure: hot-memory conventions always loaded (analogous to MCP Resources), specialized domain-expert agents loaded on demand (analogous to MCP Tools with specific retrieval strategies), and cold-memory knowledge bases retrieved as needed (analogous to deeper code graph queries). This tiered approach addresses the finding from the RACG survey that "[vector-based retrieval offers efficiency but limited structural insight](https://arxiv.org/html/2510.04905v1)" — by combining embedding-based retrieval at the editing tier with graph-based retrieval at the planning tier.

## What Copilot Workspace got right, what remains unsolved

Copilot Workspace's most important architectural contribution was proving that **natural-language intermediate representations** (specifications and plans) between intent and code serve simultaneously as reasoning scaffolds for the LLM, steerability surfaces for the human, and documentation artifacts for the team. The GitHub Next team articulated this as a "co-agent" design principle: "If the AI is going to take steps towards a solution, it must take the human with it, and allow review, steering and control at every step of the way."

The [Epiverse-TRACE evaluation](https://epiverse-trace.github.io/posts/copilot-workspace/) provides a useful corrective: when tested on domain-specific R package development, Workspace took "~10x longer than what our RSEs would take" and "AI models don't seem to understand how different parts of a codebase link together, so they provide solutions that are inconsistent with the requirements of the codebase." This failure mode — Project Context Conflicts in Zhang et al.'s taxonomy — is precisely the problem that better retrieval addresses. The content selection mechanism's reliance on "a combination of LLM techniques and traditional code search" may be insufficient for codebases with unusual conventions or domain-specific structural patterns that don't match the training distribution.

Three open problems remain for plan-aware code generation systems. First, **plan granularity calibration**: Copilot Workspace plans describe file-level changes with bullet-point steps, but the optimal granularity likely varies by task complexity — simple bug fixes need coarser plans than architectural refactors. The [CGO framework's](https://drops.dagstuhl.de/storage/00lipics/lipics-vol333-ecoop2025/LIPIcs.ECOOP.2025.35/) finding that it achieves comparable results to Self-Planning while using "far fewer tokens" suggests that plan verbosity has diminishing returns. Second, **plan-context co-evolution**: when a user edits the plan, the relevant context may shift — new files may become relevant and previously-selected files may become irrelevant. Copilot Workspace's incremental plan update mechanism hints at this, but the content selection documentation does not describe dynamic re-ranking triggered by plan edits. Third, **cross-repository planning**: modern development increasingly spans multiple repositories (monorepos, microservices, shared libraries), and Copilot Workspace's task model was scoped to a single repository — a constraint inherited by most current tools.

The plan-then-implement pattern has proven its value across academic benchmarks, production tools, and practitioner experience. The remaining frontier is not whether to plan — the evidence is unambiguous that planning improves multi-file code generation — but how to build retrieval systems that provide the right context at the right granularity for each phase of the planning-implementation lifecycle. MCP provides the protocol-level abstraction for this; the architectural patterns from Copilot Workspace, Aider, and the research literature provide the design blueprints.

---

## Bibliography

1. **GitHub Blog — "GitHub Copilot Workspace"** — https://github.blog/news-insights/product-news/github-copilot-workspace/ — Original announcement post (April 29, 2024) describing the task-oriented development environment and its plan-then-implement workflow.

2. **GitHub Next — Copilot Workspace Project Page** — https://githubnext.com/projects/copilot-workspace — Technical FAQ including model selection (GPT-4o), specification/plan editing mechanics, and the "steerability" design rationale.

3. **Copilot Workspace User Manual — Overview** — https://github.com/githubnext/copilot-workspace-user-manual/blob/main/overview.md — Canonical documentation of the task→specification→plan→implementation pipeline, content selection mechanism, and glossary of architectural terms.

4. **Copilot Workspace User Manual — Origins** — https://github.com/githubnext/copilot-workspace-user-manual/blob/main/origins.md — Design history including the SpecLang project, Extract-Edit-Apply paradigm, and "co-agent" design principle.

5. **GitHub Blog — "5 Tips and Tricks for Copilot Workspace"** — https://github.blog/ai-and-ml/github-copilot/5-tips-and-tricks-when-using-github-copilot-workspace/ — Practical guidance on steering content selection and editing plans (October 2024).

6. **GitHub Changelog — Auto-validation, Go to Definition** — https://github.blog/changelog/2025-01-31-copilot-workspace-auto-validation-go-to-definition-and-more/ — January 2025 updates adding auto-validation and real-time plan item reflection.

7. **VS Code Documentation — Workspace Context** — https://code.visualstudio.com/docs/copilot/reference/workspace-context — Description of the three-layer retrieval architecture: code search, semantic search, and language intelligence (LSP/IntelliSense).

8. **Jiang et al. — "Self-Planning Code Generation with Large Language Models"** — https://arxiv.org/abs/2303.06689 — Foundational paper showing 25.4% Pass@1 improvement with self-planning and 50%+ with ground-truth plans.

9. **Li et al. — "Structured Chain-of-Thought Prompting for Code Generation"** — https://arxiv.org/abs/2305.06599 — SCoT framework achieving 13.79% improvement over CoT on HumanEval using programming structure scaffolds.

10. **DevOps.com — "Visual Studio Copilot Gets Planning Mode"** — https://devops.com/visual-studio-copilot-gets-planning-mode-for-complex-tasks/ — Reports Microsoft's SWE-bench results: ~15% higher success rates and ~20% more tasks resolved with planning enabled.

11. **Zhang et al. — "Hallucination Taxonomy for Code Generation"** — https://arxiv.org/pdf/2409.20550 — Taxonomy identifying Task Requirement Conflicts, Factual Knowledge Conflicts, and Project Context Conflicts as primary hallucination categories.

12. **Survey on Hallucination Mitigation in Code Generation (2025)** — https://arxiv.org/html/2510.24476v1 — States that step-by-step generation "significantly reduces programming logic hallucinations and enhances traceability, editability, and composability."

13. **Addy Osmani — "AI Coding Workflow"** — https://addyosmani.com/blog/ai-coding-workflow/ — Practitioner evidence on planning-first workflows reducing hallucination rates from 47.5% to ~14.5%.

14. **Aider Documentation — Repository Map** — https://aider.chat/2023/10/22/repomap.html — Technical description of tree-sitter + PageRank-based symbol mapping achieving 98% token reduction.

15. **Aider Documentation — Usage Modes** — https://aider.chat/docs/usage/modes.html — Description of Ask/Architect/Code modes implementing explicit plan-then-implement separation.

16. **Cognition AI — "Devin 2.0"** — https://cognition.ai/blog/devin-2 — Interactive Planning feature and self-review mechanism catching ~30% more issues.

17. **Augment Code — "Cursor AI Limitations"** — https://www.augmentcode.com/tools/cursor-ai-limitations-why-multi-file-refactors-fail-in-enterprise — Analysis of context window limitations in multi-file refactoring scenarios.

18. **Augment Code — "Context Window Wars"** — https://www.augmentcode.com/tools/context-window-wars-200k-vs-1m-token-strategies — Evidence that 200K optimized context outperforms 1M+ token dumps.

19. **LangChain — "Introducing Open SWE"** — https://blog.langchain.com/introducing-open-swe-an-open-source-asynchronous-coding-agent/ — Multi-agent architecture with dedicated Planner and Reviewer components and human-in-the-loop plan editing.

20. **MCP Specification** — https://modelcontextprotocol.io/specification/2025-11-25 — Protocol definition including Tools, Resources, Prompts primitives and LSP-inspired design rationale.

21. **Anthropic Engineering — "Code Execution with MCP"** — https://www.anthropic.com/engineering/code-execution-with-mcp — Code Mode pattern reducing token usage by 98.7% through dynamic tool invocation.

22. **Cloudflare Blog — "Code Mode"** — https://blog.cloudflare.com/code-mode/ — Collapsing 2,500 API endpoints into two MCP tools and ~1,000 tokens of context.

23. **Tao et al. — "Retrieval-Augmented Code Generation Survey"** — https://arxiv.org/html/2510.04905v1 — Comprehensive taxonomy of similarity-based, tool-based, and graph-based code retrieval paradigms.

24. **Qodo Blog — "RAG for Large Scale Code Repos"** — https://www.qodo.ai/blog/rag-for-large-scale-code-repos/ — Production RAG pipeline with intelligent chunking, two-stage retrieval, and natural language code descriptions.

25. **CodexGraph** — https://arxiv.org/html/2408.03910v1 — Code property graph approach enabling Cypher queries over symbol relationships (CONTAINS, INHERITS, USES, CALLS).

26. **RepoMaster** — https://arxiv.org/html/2505.21577v2 — Function-call graphs and module-dependency graphs for identifying essential repository components.

27. **DZone — "GitHub Copilot Multi-File Context Architecture"** — https://dzone.com/articles/github-copilot-multi-file-context-internal-architecture — Details on 60-line sliding windows and Jaccard similarity scoring for inline completions.

28. **ContextModule** — https://arxiv.org/html/2412.08063v1 — Production system retrieving user behavior-based code, similar snippets, and symbol definitions via Code Knowledge Graphs.

29. **Sourcegraph Blog — "How Cody Understands Your Codebase"** — https://sourcegraph.com/blog/how-cody-understands-your-codebase — Decision to move away from embeddings at enterprise scale due to vector database complexity.

30. **Jain — "Exploratory Study of Code Retrieval in Coding Agents"** — https://www.preprints.org/manuscript/202510.0924/v1/download — Comparative analysis finding Aider achieves 4.3–6.5% context utilization versus Claude Code at 54–58.5%.

31. **Three-Tier Context Infrastructure** — https://arxiv.org/html/2602.20478v1 — Hot-memory, specialist agent, and cold-memory knowledge tiers for AI-assisted development at scale.

32. **Epiverse-TRACE — Copilot Workspace Evaluation** — https://epiverse-trace.github.io/posts/copilot-workspace/ — Critical evaluation finding ~10x slower performance than human RSEs and inconsistent cross-file understanding.

33. **CGO (Chain of Grounded Objectives)** — https://drops.dagstuhl.de/storage/00lipics/lipics-vol333-ecoop2025/LIPIcs.ECOOP.2025.35/ — ECOOP 2025 paper showing comparable results to self-planning with fewer tokens.

34. **Fizzy Logic — "Brainstorming with Copilot Workspace"** — https://fizzylogic.nl/2024/11/02/brainstorming-with-copilot-workspace — Developer deep-dive on the brainstorm agent's role in specification refinement.

35. **Zilliz — Claude Context MCP** — https://github.com/zilliztech/claude-context — Hybrid BM25 + dense vector MCP server with ~40% token reduction claims.

36. **RepoMapper MCP** — https://mcpservers.org/servers/pdavis68/RepoMapper — MCP server implementing Aider's tree-sitter + PageRank approach with token-aware output.