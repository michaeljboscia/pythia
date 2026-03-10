# Research Prompt: DM-06 Artifact Lifecycle Management

## Research Objective
Research the semantic lifecycle of non-code artifacts (Architecture Decision Records, PR summaries, Pythia session logs, user research docs) within the Knowledge Graph. The goal is to define how these artifacts are created, versioned, superseded, tombstoned, and archived without destroying the historical context they provide to the LLM.

## Research Questions
1. **The Artifact Taxonomy:** Clearly define the distinct lifecycle states required for LCS non-code artifacts (e.g., Draft, Active, Superseded, Deprecated, Archived, Tombstoned). How do these states map to properties on graph nodes (*KG-03*)?
2. **Supersession Mechanics:** When ADR-005 explicitly replaces ADR-002, how is this modeled in the graph? Should ADR-002 be deleted, or retained with a `SUPERSEDED_BY` edge pointing to ADR-005?
3. **Retrieval Exclusion vs Context:** If an artifact is `Deprecated`, should it be hard-filtered out of standard vector retrieval (*VD-01*) to save context window (*MC-04*), or included but heavily penalized in scoring (*DM-03*) so the LLM still knows *why* it was deprecated?
4. **Relationship Cascading:** If a Pythia session log (`Node A`) details the creation of a function (`Node B`), and `Node B` is later deleted, what happens to `Node A`? Does it become an orphaned log, or does the deletion cascade?
5. **Tombstoning:** What is the technical definition of a Tombstone in the context of LCS? If a sensitive file is deleted from the filesystem, must we scrub all its vectors and graph properties, leaving only a Tombstone node to prevent 404s from other linked documents?
6. **Automated Archival:** Can we implement a daemon task that automatically transitions Pythia session logs from `Active` to `Archived` after 30 days, moving them to a cheaper storage tier or stripping their vector representations to save RAM?
7. **The Pythia Log Ecosystem:** We currently generate dense session logs (`~/.gemini/session-logs/`). How will LCS parse, chunk, and assign lifecycle metadata to these specific markdown files automatically?
8. **User Interventions:** How does a user manually change the state of an artifact (e.g., marking a doc as deprecated)? Does this require an MCP tool (`lcs_update_artifact_state`), or is it inferred from frontmatter in the markdown file?
9. **Vector DB Syncing:** When a graph node transitions to `Archived`, how do we efficiently locate and delete/tag its corresponding 50 chunks in the vector database?
10. **Querying by State:** Design the standard graph queries that allow the LLM to ask "What were all the rejected architecture proposals for the Auth system?" without conflating them with active proposals.

## Sub-Topics to Explore
- Document management systems (DMS) state machine patterns.
- YAML Frontmatter parsing for state extraction.
- Soft-delete patterns in relational vs graph databases.
- The concept of "Digital Forgetting" in AI memory systems.

## Starting Sources
- **MADR (Markdown Architecture Decision Records) specification:** https://adr.github.io/madr/ (specifically look at their status fields).
- **Log4Brains architecture:** https://github.com/thomvaill/log4brains
- **Soft Deletion in Graph DBs:** Neo4j community discussions on handling deleted entities.
- **Data Lifecycle Management (DLM) best practices.**

## What to Measure & Compare
- Contrast the implementation complexity of explicitly querying `MATCH (n:ADR {status: 'Active'})` for every single graph traversal versus physically moving deprecated nodes to a separate sub-graph or database.
- Analyze a sample of our existing Pythia session logs to determine what structured metadata can be reliably parsed for lifecycle management.

## Definition of Done
A 3000-5000 word specification detailing the exact state machine for LCS artifacts. It must define the required YAML frontmatter (or inferred properties), the graph edges used to represent state transitions (e.g., `SUPERSEDED_BY`), and the precise impact of each state on vector retrieval.

## Architectural Implication
Feeds **ADR-006 (Live State Ingestion)** and **ADR-008 (Staleness Scoring)**. This dictates how the system maintains a "clean" context window over months of usage, preventing the LLM from drowning in deprecated decisions and obsolete logs.