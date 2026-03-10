# Research Prompt: KG-08 Knowledge Graph Schema Design for Polymorphic Nodes

## Research Objective
Design a robust graph schema for LCS that can represent fundamentally different entity types (papers, ADRs, code symbols, repos, logs, test cases, sessions) without collapsing into either over-generalized nodes or brittle type-specific silos. Evaluate schema patterns used in production property-graph systems and identify the minimal schema contract that supports retrieval, traversal, and evolution. This research is a primary input to ADR-001.

## Research Questions
1. What schema pattern best supports polymorphism in property graphs: single-label supertype with subtype properties, multi-label inheritance, or explicit type nodes with `INSTANCE_OF` relationships?
2. Which shared base properties should every node and edge have for provenance and lifecycle (`source_id`, `version`, `created_at`, `updated_at`, `confidence`, `ingest_run_id`)?
3. How should typed relationships be modeled to support both strict semantics and future extensibility across artifact classes?
4. What indexing strategy is needed to preserve traversal/query performance as node type diversity increases?
5. How should schema evolution be handled when new artifact types appear (for example, adding telemetry nodes later) without destructive migrations?
6. Should LCS enforce schema constraints at write time, or allow soft schema with validation jobs and repair routines?
7. What failure patterns emerge in polymorphic graph designs (type explosion, ambiguous edges, query complexity drift), and what guardrails prevent them?

## Starting Sources
- Neo4j data modeling guide — https://neo4j.com/docs/getting-started/data-modeling/
- Memgraph data modeling documentation — https://memgraph.com/docs/data-modeling
- TigerGraph schema design references — https://docs.tigergraph.com/gsql-ref/current/ddl-and-loading/defining-a-graph-schema
- LlamaIndex Property Graph index guide — https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/
- OpenCypher resources and specification hub — https://opencypher.org/
- Microsoft GraphRAG implementation (entity/relation modeling choices) — https://github.com/microsoft/graphrag

## What to Measure, Compare, or Evaluate
- Query complexity: number of joins/hops and query readability for top LCS use cases under each schema pattern.
- Performance: traversal latency and index hit rate for mixed-type query workloads.
- Evolution cost: number of migrations and backward-compatibility breaks when introducing a new node type.
- Data quality: rate of invalid edge types, orphan nodes, and schema-rule violations.
- Retrieval effectiveness: improvement in answer grounding/citation due to richer typed relationships.
- Operability: schema introspection clarity and ease of debugging data/model drift.

## Definition of Done
- Two to three candidate schemas are evaluated with concrete sample data and representative queries.
- A recommended polymorphic schema for LCS v1 is selected with explicit naming conventions and constraints.
- Required base properties and edge semantics are defined in a machine-checkable spec.
- A schema evolution policy is documented (how to add/retire types safely).
- ADR-001 receives a complete schema decision package, not just principles.

## How Findings Feed LCS Architecture Decisions
This research defines ADR-001’s canonical graph model and directly constrains ingestion and extraction pipelines that must emit schema-compliant nodes/edges. It also impacts downstream retrieval because schema clarity determines whether LCS can reliably traverse across heterogeneous evidence chains during query resolution.
