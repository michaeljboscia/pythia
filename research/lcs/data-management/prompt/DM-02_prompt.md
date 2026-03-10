# Research Prompt: DM-02 Document Versioning and Provenance Tracking

## Research Objective
Investigate data modeling strategies for tracking the history and provenance of artifacts (code files, ADRs, PR descriptions) within the vector and graph databases. The goal is to determine if LCS should adopt an immutable append-only model (keeping old versions of documents) or a mutable overwrite model, ensuring the LLM can reason about *how* a system evolved over time without hallucinating.

## Research Questions
1. **Immutable vs Mutable:** When `file.ts` changes, should we `UPDATE` its vector and graph node (destroying the old state), or `INSERT` a new `file.ts_v2` node and link it via a `SUPERSEDES` edge? What are the storage costs (*GD-01*, *VD-01*) of append-only architectures?
2. **Temporal Databases Conceptual:** How do specialized temporal databases (like XTDB or Datomic) model "valid time" vs "transaction time"? Can we emulate this bitemporal modeling using property graphs (e.g., adding `valid_from` and `valid_to` properties to every node and edge)?
3. **Retrieving History:** If a user asks, "How did the auth system work before the migration in PR #45?", how must the graph schema and vector metadata be structured to retrieve the specific past states of multiple files?
4. **Vector DB Metadata Filtering:** If using an append-only model, how do we prevent the vector database from returning 5 slightly different historical versions of the same file in the top 10 results? Detail the exact metadata filtering (e.g., `is_latest == true`) required in Qdrant/LanceDB.
5. **Provenance Tracking:** When an ADR explicitly references a block of code, and that code is later changed, how do we track that the ADR's provenance is now tied to a historical state?
6. **Git as the Source of Truth:** Should LCS avoid storing historical text/vectors entirely, relying purely on executing local `git log -p` commands when historical context is required? What is the latency tradeoff of querying git vs querying a temporal graph?
7. **Edge Decay:** In an overwrite model, if `Function A` calls `Function B`, and `Function B` is deleted, how does the ingestion pipeline deterministically find and delete the `CALLS` edge originating from `A`? (*KG-09*)
8. **Log and Session Artifacts:** Unlike code, terminal logs and Pythia session transcripts are inherently immutable point-in-time records. Should they be modeled differently in the graph than source code?
9. **Granularity of Versioning:** Do we version the entire File node, or do we version the individual Chunk nodes (*RF-09*)? Versioning at the chunk level saves space but vastly complicates edge mapping.
10. **Storage Bloat:** If a developer makes 50 local commits a day, an append-only index will explode in size. How do we implement compaction or snapshotting to collapse intermediate versions?

## Sub-Topics to Explore
- Event Sourcing architectures applied to Knowledge Graphs.
- The Datomic database model (Entity-Attribute-Value-Time).
- Qdrant payload filtering performance.
- Bi-temporal modeling in SQL (for *GD-02* comparison).

## Starting Sources
- **Datomic Architecture:** https://docs.datomic.com/pro/architecture.html (To understand immutable databases).
- **XTDB (Temporal Graph):** https://xtdb.com/
- **Qdrant Filtering Docs:** https://qdrant.tech/documentation/concepts/filtering/
- **Event Sourcing Pattern:** https://martinfowler.com/eaaDev/EventSourcing.html
- **Paper:** "Temporal Graph Networks for Deep Learning on Dynamic Graphs" (for theoretical background on dynamic edges).

## What to Measure & Compare
- Calculate the database storage explosion if an append-only chunking model is used on a 1,000 file repo that receives 10 commits per day over 1 year.
- Design the Cypher query required to retrieve "the active subgraph representing the `src/auth` directory as it existed on March 1st." Compare its complexity to a simple `MATCH` query on a mutable graph.

## Definition of Done
A 3000-5000 word architecture document defining the exact versioning semantics of LCS. It must definitively choose between mutable-overwrite and immutable-append, specifying how `valid_from`/`valid_to` timestamps will be managed on graph edges and vector payloads.

## Architectural Implication
Feeds **ADR-006 (Live State Ingestion)** and **ADR-001 (Graph DB Selection)**. Choosing an immutable temporal model massively increases storage requirements and query complexity, likely ruling out SQLite in favor of a dedicated graph engine.