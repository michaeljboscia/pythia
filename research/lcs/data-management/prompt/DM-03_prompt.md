# Research Prompt: DM-03 Staleness Detection and Freshness Scoring

## Research Objective
Investigate heuristic models, temporal RAG techniques, and signal-based scoring to solve the "code changed but doc didn't" problem. The objective is to design a mathematical Freshness Score that the LCS MCP server can append to retrieved documents, allowing the LLM to understand when architectural documentation or Pythia session logs are likely outdated relative to the current source code.

## Research Questions
1. **The Staleness Problem:** Detail the specific failure mode where an LLM is fed a high-scoring vector match from a 6-month-old ADR that perfectly describes an architecture that was refactored yesterday. How does naive RAG fail here?
2. **Temporal RAG:** How do modern "Temporal RAG" architectures inject time-awareness into the retrieval pipeline? Do they modify the vector embedding itself, or simply re-rank based on timestamp metadata?
3. **Signal-Based Decay Models:** How can we model "document decay"? Evaluate formulas for half-life decay (e.g., $Score = OriginalScore \times e^{-\lambda t}$). What should the half-life ($\lambda$) be for an ADR versus a pythia session log?
4. **Graph-Inferred Staleness:** If a Document node has an `EXPLAINS` edge pointing to a Code node (*KG-08*), and the Code node's `last_modified` timestamp is newer than the Document node's `last_modified` timestamp, can we systematically flag the document as stale?
5. **Git Blame Integration:** How can we use `git blame` or commit frequency data to determine the volatility of a specific code directory, and dynamically adjust the expected freshness of associated documentation?
6. **Contradiction Detection:** Can we utilize Natural Language Inference (NLI) models (*NL-01*) or lightweight LLM-as-a-judge passes to detect direct contradictions between a retrieved doc and retrieved code before returning them via MCP?
7. **Metadata Schema:** What specific timestamp fields must be added to every node in the graph and every payload in the vector database to support robust freshness scoring? (e.g., `created_at`, `last_verified_at`, `git_sha`).
8. **Prompt Injection:** When the MCP server returns a stale document, what is the exact string formatting used to warn the LLM? (e.g., `<warning>This document was written 8 months ago, verify against code.</warning>`).
9. **User Verification Loops:** Should LCS implement a mechanism (via MCP tools) allowing the LLM or user to manually "touch" a document, updating its `last_verified_at` timestamp without changing its text?
10. **The "Orphaned Artifact" Problem:** How do we detect and score markdown files or logs that no longer link to any existing code in the graph (because the code was deleted or heavily refactored)?

## Sub-Topics to Explore
- Time-aware re-ranking algorithms.
- TF-IDF variations that incorporate time (Time-Biased TF-IDF).
- Heuristics for detecting "stale comments" within source code files.
- The concept of "Time-to-Live (TTL)" for LLM context artifacts.

## Starting Sources
- **Paper:** "Temporal Knowledge Graph RAG" (Search for recent papers combining temporal graphs with LLMs).
- **Paper:** "Time-Aware Language Models as Temporal Knowledge Bases" - https://arxiv.org/abs/2202.05346
- **Elasticsearch Function Score / Decay Functions:** https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-function-score-query.html#function-decay (Great practical examples of decay math).
- **Confluence/Notion Engineering Blogs:** How they calculate page staleness or recommend page archiving.

## What to Measure & Compare
- Write a Python script to calculate the modified retrieval score of 5 hypothetical documents using a Gaussian decay function versus an Exponential decay function over a 365-day timeline.
- Design a Cypher query (*GD-01*) that scans the graph and returns all Document nodes where the attached Code nodes have mutated since the Document was last updated. Assess the computational cost of this query.

## Definition of Done
A 3000-5000 word technical framework for staleness detection. The output must define the exact mathematical decay functions to be used, the graph queries required to detect code-doc desynchronization, and the exact metadata schema required in the databases.

## Architectural Implication
Feeds **ADR-008 (Staleness Scoring)** and **ADR-001 (Graph DB Selection)**. It relies heavily on graph traversal to calculate relative staleness, making a robust graph database more critical.