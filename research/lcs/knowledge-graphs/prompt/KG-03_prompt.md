# Research Prompt: KG-03 Property Graphs vs RDF/OWL

## Research Objective
Evaluate the fundamental data modeling differences between Labeled Property Graphs (LPG) and RDF/OWL (Semantic Web) graphs. The goal is to determine the most appropriate schema flexibility and query language semantics for LCS's heterogeneous artifact types (code, markdown, logs, architecture decisions).

## Research Questions
1. What is the structural difference between a Labeled Property Graph (LPG) and an RDF Triple Store? How are properties on edges handled in both paradigms?
2. Why did industry standard graph databases (Neo4j, Kuzu) heavily adopt the LPG model over the W3C standard RDF model?
3. How does Cypher (or OpenCypher) querying against an LPG compare to SPARQL querying against an RDF store in terms of developer ergonomics and expressiveness for variable-length paths?
4. For modeling a codebase (e.g., `Function -> CALLS -> Function` vs `File -> CONTAINS -> Function`), how does schema enforcement work in an LPG compared to OWL ontologies?
5. What is the serialization format for moving graph data between systems in LPG (e.g., CSV, JSON) vs RDF (e.g., Turtle, JSON-LD), and how does that impact the MCP server interface?
6. Does the strict triplet nature of RDF (Subject-Predicate-Object) make it harder or easier to model multi-modal artifacts (e.g., a PR that links a Jira ticket, 5 code files, and 2 authors)?

## Starting Sources
- **Neo4j: RDF vs Property Graphs:** https://neo4j.com/blog/rdf-triple-store-vs-labeled-property-graph-difference/
- **W3C RDF Primer:** https://www.w3.org/TR/rdf11-primer/
- **AWS Graph Database comparisons (Neptune supports both):** https://aws.amazon.com/nosql/graph/

## What to Measure & Compare
- Write a sample query to find "all functions that call a function modified in PR #123" in both Cypher (LPG) and SPARQL (RDF). Compare readability and verbosity.
- Compare the storage footprint of adding 5 metadata attributes to an edge in LPG versus the reification required in RDF.

## Definition of Done
A definitive data modeling recommendation. The report must clearly state whether LCS will adopt the Labeled Property Graph paradigm or the RDF paradigm, backed by specific examples of how LCS entities (Files, Functions, ADRs) will be modeled.

## Architectural Implication
Feeds directly into **ADR-001 (Graph DB Selection)**. Choosing LPG heavily biases the selection towards Neo4j, Kuzu, or Memgraph, whereas choosing RDF biases towards GraphDB or Blazegraph.