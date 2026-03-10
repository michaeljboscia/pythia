# Research Prompt: KG-08 Schema Design for Polymorphic Nodes (P1)

## Research Objective
Design a robust polymorphic graph schema for LCS that supports diverse node types (papers, functions, ADRs, logs, sessions, tests) while preserving query performance, schema clarity, and evolution safety. The study must produce concrete schema conventions and migration rules. Findings feed ADR-001 and cross-reference KG-03 and GD-01.

## Research Questions
1. Which polymorphism strategy best fits LCS: multi-label nodes, supertype+subtype properties, or explicit type nodes?
2. What base properties should every node/edge carry for provenance and lifecycle operations?
3. How should relation typing be constrained to avoid semantic drift and edge ambiguity?
4. What indexing strategy is required for performant mixed-type queries?
5. How should schema evolution add/remove node types without breaking existing queries?
6. What validation rules should run at write time versus periodic consistency checks?
7. How should temporal/version attributes be modeled to support freshness and supersession?
8. What query patterns become overly complex under certain polymorphism choices?
9. How should confidence and extraction-source metadata be normalized across entity types?
10. What anti-patterns cause type explosion and maintenance burden?
11. How should schema design anticipate future v2 features (contradiction edges, causal links)?
12. What minimal schema should be locked for v1 versus flexible extension points?

## Starting Sources
- Neo4j data modeling — https://neo4j.com/docs/getting-started/data-modeling/
- Memgraph data modeling — https://memgraph.com/docs/data-modeling
- TigerGraph schema docs — https://docs.tigergraph.com/gsql-ref/current/ddl-and-loading/defining-a-graph-schema
- LlamaIndex property graph guide — https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/
- openCypher portal — https://opencypher.org/
- GraphRAG repository (schema artifacts) — https://github.com/microsoft/graphrag
- Kuzu docs — https://kuzudb.github.io/docs/
- RDF 1.1 concepts (comparison context) — https://www.w3.org/TR/rdf11-concepts/
- OWL 2 primer (comparison context) — https://www.w3.org/TR/owl2-primer/

## What to Measure, Compare, or Evaluate
- Query complexity and maintainability under candidate schemas.
- Performance for representative mixed-type traversal queries.
- Schema evolution simulation: adding/removing node and edge types.
- Validation error rates and recovery effort for invalid graph writes.
- Provenance query completeness across node classes.
- Long-term migration risk under expected roadmap expansions.

## Definition of Done
- A canonical polymorphic schema spec is produced with naming conventions.
- Required base properties and constraints are formalized.
- Evolution and migration policy is documented for ADR-001.
- Validation and linting requirements are defined.
- Tradeoffs versus KG-03 alternatives are explicitly resolved.

## How Findings Feed LCS Architecture Decisions
This research operationalizes ADR-001 by defining the durable graph schema contract. It ensures LCS can scale artifact diversity without sacrificing performance, queryability, or data quality.
