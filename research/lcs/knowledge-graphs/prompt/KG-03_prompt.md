# Research Prompt: KG-03 Property Graphs vs RDF/OWL for LCS (P0)

## Research Objective
Determine whether LCS should model its knowledge layer as a property graph, RDF/OWL graph, or hybrid approach, based on schema flexibility, query ergonomics, and operational complexity for heterogeneous artifacts. The study must emphasize practical implementation tradeoffs over theoretical purity. Findings feed ADR-001 and cross-reference GD-01 and KG-08.

## Research Questions
1. How do property graphs and RDF/OWL differ in representing polymorphic entities and rich edge metadata?
2. Which model better fits LCS requirements for code symbols, ADR nodes, logs, and temporal provenance?
3. What are query-language tradeoffs (Cypher/Gremlin vs SPARQL) for LCS use cases?
4. How does schema evolution behave in each model when new artifact types are introduced?
5. What reasoning/inference capabilities from OWL are valuable versus overkill for LCS v1?
6. How do storage/indexing overhead and performance compare at small-to-medium scales?
7. How portable are data models across graph DB engines likely considered by LCS?
8. What interoperability benefits does RDF bring for external integrations?
9. What failure modes arise from over-flexible property schemas or over-rigid ontologies?
10. How should provenance, confidence, and versioning be modeled under each paradigm?
11. Can a hybrid architecture capture benefits of both without operational sprawl?
12. What decision criteria should hard-gate ADR-001 model selection?

## Starting Sources
- W3C RDF 1.1 Concepts — https://www.w3.org/TR/rdf11-concepts/
- OWL 2 Primer — https://www.w3.org/TR/owl2-primer/
- SPARQL 1.1 Query Language — https://www.w3.org/TR/sparql11-query/
- openCypher portal — https://opencypher.org/
- Neo4j data modeling guide — https://neo4j.com/docs/getting-started/data-modeling/
- Memgraph data modeling docs — https://memgraph.com/docs/data-modeling
- TigerGraph schema docs — https://docs.tigergraph.com/gsql-ref/current/ddl-and-loading/defining-a-graph-schema
- LlamaIndex property graph guide — https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/
- Kuzu docs (embedded property graph context) — https://kuzudb.github.io/docs/

## What to Measure, Compare, or Evaluate
- Modeling expressiveness on a common LCS schema testbed.
- Query complexity/readability for core LCS tasks.
- Performance and storage comparison on equivalent datasets.
- Evolution friction under simulated schema changes.
- Tooling maturity and operational burden by model choice.
- Risk analysis of long-term lock-in and migration paths.

## Definition of Done
- A model decision matrix with weighted criteria is completed.
- Representative LCS queries are implemented in candidate query languages.
- Schema evolution and provenance patterns are validated practically.
- A clear ADR-001 recommendation (or hybrid boundary) is produced.
- KG-08 implications are documented for final schema design.

## How Findings Feed LCS Architecture Decisions
This research sets the semantic foundation for ADR-001 and determines how flexible, queryable, and maintainable LCS graph knowledge will be. It directly constrains KG-08 schema rules and database selection in GD studies.
