# LlamaIndex's PropertyGraphIndex for hybrid graph+vector RAG

**LlamaIndex's `PropertyGraphIndex` is the framework's primary abstraction for building hybrid retrieval systems that combine knowledge graph traversal with vector similarity search.** Introduced in May 2024 as the successor to the deprecated `KnowledgeGraphIndex`, it models knowledge as a labeled property graph — nodes carry labels, arbitrary metadata properties, and optional embeddings, while typed relationships connect them. The design enables a retrieval pipeline where graph structure captures explicit entity relationships and vector embeddings capture semantic similarity, with both channels fused at query time. This analysis examines the schema, extraction pipeline, retrieval mechanisms, storage backends, and real-world limitations based on official documentation, source code, and community experience.

## The property graph schema: entities, chunks, and relations

The data model centers on three types defined in [`llama_index.core.graph_stores.types`](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/graph_stores/types.py). Understanding these types is essential because every extractor, store, and retriever operates on them.

**`EntityNode`** represents a named concept — a person, organization, technology, or any domain-specific entity. It carries a `name` (which doubles as its default `id`), a `label` (entity type, e.g., `"PERSON"`), a `properties` dictionary for arbitrary metadata, and an optional `embedding` vector. **`ChunkNode`** represents a source text chunk ingested into the graph, with fields for `text`, `label` (defaulting to `"text_chunk"`), and a `properties` dictionary that typically includes `ref_doc_id` linking back to the source document. **`Relation`** connects any two nodes via a typed, directed edge with `label`, `source_id`, `target_id`, and `properties`.

Both `EntityNode` and `ChunkNode` inherit from `LabelledNode`, the abstract base class providing the `label`, `embedding`, and `properties` interface. The metadata constants `KG_NODES_KEY` and `KG_RELATIONS_KEY` serve as the internal mechanism for passing extracted graph data between pipeline stages — extractors write `EntityNode` and `Relation` objects into a LlamaIndex node's metadata under these keys, and the index reads them during graph construction.

A concrete example illustrates the model. Given a document about a software company, the extraction pipeline might produce `EntityNode(name="LlamaIndex", label="ORGANIZATION")`, `EntityNode(name="Jerry Liu", label="PERSON")`, and `Relation(label="FOUNDED_BY", source_id="LlamaIndex", target_id="Jerry Liu")`. The source text chunk becomes a `ChunkNode` linked to both entities via `HAS_SOURCE` relations, creating a subgraph where entity nodes connect to each other through semantic relationships and to their provenance text through structural relationships.

```python
from llama_index.core.graph_stores.types import EntityNode, Relation

entities = [
    EntityNode(name="LlamaIndex", label="ORGANIZATION", properties={"domain": "AI"}),
    EntityNode(name="Jerry Liu", label="PERSON"),
]
relations = [
    Relation(label="FOUNDED_BY", source_id="LlamaIndex", target_id="Jerry Liu"),
]
```

This schema is deliberately flexible. The `properties` dictionaries accept arbitrary key-value pairs, entity labels are unconstrained strings (unless schema enforcement is enabled), and relation types are similarly open. This flexibility is both a strength — it accommodates diverse domains without schema migration — and a weakness, as inconsistent labeling across extraction runs can fragment the graph.

## How the extraction pipeline populates the graph

The construction pipeline follows a clear sequence: documents are parsed into text chunks, each chunk passes through one or more **KG extractors** that inject `EntityNode` and `Relation` objects into the chunk's metadata, and then the index upserts these objects into the graph store and optionally embeds entity nodes into a vector store. The [official module guide](https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/) documents four built-in extractors, with two serving as defaults.

**`SimpleLLMPathExtractor`** is the first default. It sends each text chunk to an LLM with a prompt requesting `(entity, relation, entity)` triples, then parses the response into `Relation` objects with corresponding `EntityNode` endpoints. Configuration includes `max_paths_per_chunk` (default **10**), `num_workers` for parallel LLM calls, and optional `extract_prompt` and `parse_fn` overrides for customizing the prompt template and output parsing respectively. This extractor performs free-form extraction — the LLM decides entity types and relation labels without constraints.

**`ImplicitPathExtractor`** is the second default and requires no LLM. It reads existing structural relationships from LlamaIndex's node parser output — `PREVIOUS`, `NEXT`, and `SOURCE` relationships that link chunks to each other and to their parent documents. These become graph edges, providing navigational structure even without semantic extraction.

**`SchemaLLMPathExtractor`** enforces a predefined ontology using Python `Literal` types and a validation schema. This is the recommended extractor for production systems where entity consistency matters:

```python
from typing import Literal
from llama_index.core.indices.property_graph import SchemaLLMPathExtractor

entities = Literal["PERSON", "ORGANIZATION", "TECHNOLOGY"]
relations = Literal["WORKS_AT", "CREATED", "DEPENDS_ON"]
validation_schema = {
    "PERSON": ["WORKS_AT", "CREATED"],
    "ORGANIZATION": ["CREATED"],
    "TECHNOLOGY": ["DEPENDS_ON"],
}

kg_extractor = SchemaLLMPathExtractor(
    llm=llm,
    possible_entities=entities,
    possible_relations=relations,
    kg_validation_schema=validation_schema,
    strict=True,
    num_workers=4,
    max_triplets_per_chunk=10,
)
```

The `strict=True` parameter uses [Pydantic structured outputs](https://docs.llamaindex.ai/en/stable/examples/property_graph/property_graph_advanced/) to validate every extracted triple against the schema, discarding non-conforming results. Setting `strict=False` treats the schema as guidance rather than enforcement. A custom `kg_schema_cls` Pydantic class can provide even finer-grained validation logic.

**`DynamicLLMPathExtractor`** occupies the middle ground. It accepts optional `allowed_entity_types` and `allowed_relation_types` lists that guide the LLM without strict enforcement. When these lists are `None`, the LLM infers types freely — useful for exploratory analysis of unfamiliar corpora but prone to producing inconsistent labels across chunks.

All four extractors implement the [`TransformComponent`](https://www.llamaindex.ai/blog/introducing-the-property-graph-index-a-powerful-new-way-to-build-knowledge-graphs-with-llms) interface, making them composable with LlamaIndex's ingestion pipeline. Multiple extractors can run sequentially on the same chunks — the default configuration chains `SimpleLLMPathExtractor` + `ImplicitPathExtractor`, and custom extractors can be added to the list. Each extractor reads existing `KG_NODES_KEY`/`KG_RELATIONS_KEY` metadata from previous extractors and appends to it, enabling layered extraction strategies.

## Combining graph retrieval with vector retrieval

The retrieval architecture is where PropertyGraphIndex's hybrid design becomes concrete. When `index.as_retriever()` is called [without explicit sub-retrievers](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/indices/property_graph/base.py), the index instantiates two default retrievers: **`LLMSynonymRetriever`** and **`VectorContextRetriever`** (the latter only if an embedding model and vector-capable store are available). These run in parallel, and their results are merged by the orchestrating `PGRetriever`.

**`LLMSynonymRetriever`** expands the user's query into keywords and synonyms via an LLM prompt, then matches those keywords against entity names in the graph store. For each matched entity, it traverses outward to `path_depth` hops (default **1**), collecting connected entities and relations. The [default prompt template](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/indices/property_graph/sub_retrievers/llm_synonym.py) asks the LLM to generate up to `max_keywords` synonyms separated by `^` characters. Custom `synonym_prompt` and `output_parsing_fn` parameters allow overriding this behavior.

**`VectorContextRetriever`** embeds the query using the configured embedding model, performs vector similarity search against embedded entity nodes (returning `similarity_top_k` results), then traverses the graph from each matched node to `path_depth` hops. This retriever works with either the graph store's native vector capabilities (Neo4j, FalkorDB) or a separate vector store passed via the `vector_store` parameter.

The key parameter **`embed_kg_nodes=True`** (default) on `PropertyGraphIndex` controls whether entity nodes are embedded during construction. When enabled, every `EntityNode` gets an embedding vector computed from its name and label, stored either in the graph database's native vector index or in a separate vector store. This is what enables the vector retrieval channel — without it, only keyword-based synonym retrieval is available.

**`TextToCypherRetriever`** generates Cypher queries from natural language, executes them against the graph store, and returns results. It requires a graph database that supports structured queries (Neo4j, FalkorDB, Kuzu) and cannot work with `SimplePropertyGraphStore`. The retriever calls `graph_store.get_schema_str()` to provide schema context to the LLM, then passes the generated Cypher to `graph_store.structured_query()`. A `cypher_validator` callable can intercept and fix generated queries before execution.

**`CypherTemplateRetriever`** takes a more constrained approach: the developer provides a fixed Cypher template with parameter placeholders, and the LLM fills only the parameters. This uses a Pydantic model to define expected parameter types:

```python
from pydantic import BaseModel, Field

class TemplateParams(BaseModel):
    names: list[str] = Field(description="Entity names for lookup")

cypher_query = """
MATCH (c:Chunk)-[:MENTIONS]->(o)
WHERE o.name IN $names
RETURN c.text, o.name, o.label;
"""
template_retriever = CypherTemplateRetriever(
    index.property_graph_store, TemplateParams, cypher_query
)
```

**`CustomPGRetriever`** provides a subclassing interface for building [custom retrieval strategies](https://docs.llamaindex.ai/en/stable/examples/property_graph/property_graph_custom_retriever/). The `custom_retrieve` method has access to `self.graph_store` and can return strings, `TextNode` objects, or `NodeWithScore` objects. One documented pattern from the [LlamaIndex blog on customization](https://www.llamaindex.ai/blog/customizing-property-graph-index-in-llamaindex) combines vector retrieval, Cypher retrieval, and Cohere reranking in a single custom retriever — extracting entities from the query first, running `VectorContextRetriever` per entity, merging with Cypher results, then reranking the combined set.

The **`include_text`** parameter, available on all retrievers and on `as_retriever()`, controls whether the original source text chunks are returned alongside graph paths. When `True`, the retriever calls `graph_store.get_llama_nodes()` to fetch the `ChunkNode` text associated with retrieved entities, providing the LLM synthesizer with both structured graph context and the unstructured source text for answer generation.

## Storage backends and practical integration patterns

PropertyGraphIndex supports **nine storage backends** through the `PropertyGraphStore` base class, each with distinct capabilities and tradeoffs documented in the [graph stores integration overview](https://docs.llamaindex.ai/en/stable/community/integrations/graph_stores/).

**`SimplePropertyGraphStore`** ships with `llama-index-core` and requires no external database. It stores everything in memory with disk persistence via `storage_context.persist()`. It supports neither structured queries nor native vector search (`supports_structured_queries: False`, `supports_vector_queries: False`), meaning `TextToCypherRetriever` and `CypherTemplateRetriever` are unavailable. It includes a `save_networkx_graph()` method for HTML visualization, making it useful for prototyping and debugging. However, a [known serialization bug](https://github.com/run-llama/llama_index/issues/15822) in the Pydantic v2 migration causes `ChunkNode.text` and `EntityNode.name` fields to be lost on save/reload.

**`Neo4jPropertyGraphStore`** is the most feature-complete backend, with **native vector support**, Cypher queries, and schema introspection. Installation is `pip install llama-index-graph-stores-neo4j`. Connection is straightforward:

```python
from llama_index.graph_stores.neo4j import Neo4jPropertyGraphStore

graph_store = Neo4jPropertyGraphStore(
    username="neo4j",
    password="password",
    url="bolt://localhost:7687",
    database="neo4j",  # optional
)
```

The store wraps the Neo4j Python driver and supports all retriever types. Neo4j's native vector index means **no separate vector store is needed** — entity embeddings are stored directly in Neo4j node properties and queried via Neo4j's vector search. The [Neo4j developer blog](https://neo4j.com/blog/developer/property-graph-index-llamaindex/) documents advanced patterns including custom entity deduplication using vector similarity and word distance, and a `CypherCorrector` utility that fixes relationship direction errors in generated Cypher. An explicit `graph_store.close()` method handles connection cleanup. The class was renamed from `Neo4jPGStore` in earlier versions.

**`NebulaPropertyGraphStore`** connects to NebulaGraph via environment variables and a session pool. It requires [pre-creating a NebulaGraph Space](https://docs.llamaindex.ai/en/stable/examples/property_graph/property_graph_nebula/) with `vid_type=FIXED_STRING(256)` before use. It supports structured queries via nGQL but **does not support native vector queries** — an external vector store must be provided for `VectorContextRetriever` to work. A [compatibility issue](https://github.com/run-llama/llama_index/issues/16274) with NebulaGraph 3.0.0+ property query format changes has been reported.

**`FalkorDBPropertyGraphStore`** connects via a Redis-protocol URL (`falkor://localhost:6379`). It supports native vector queries, Cypher, and includes a `switch_graph(graph_name)` method for managing multiple graphs within a single connection. Docker deployment exposes a web UI on port 3000.

**`KuzuPropertyGraphStore`** wraps the [Kùzu embedded graph database](https://docs.llamaindex.ai/en/latest/api_reference/storage/graph_stores/kuzu/), which runs in-process without a server. It takes a `kuzu.Database` object pointing to a file path and auto-initializes its schema with Entity and Chunk tables. An important gotcha: the legacy `KuzuGraphStore` (for the deprecated `KnowledgeGraphIndex`) has different method signatures than `KuzuPropertyGraphStore`, and mixing them causes `AttributeError`.

**Amazon Neptune** has two variants: `NeptuneDatabasePropertyGraphStore` for the serverless graph database and `NeptuneAnalyticsPropertyGraphStore` for the in-memory analytics engine. Both support openCypher queries. **`MemgraphPropertyGraphStore`** connects via the Bolt protocol (same URL pattern as Neo4j) and supports native vector queries. **TiDB** and **ApertureDB** backends exist but are less documented.

### Three patterns for vector storage

The architecture supports three vector storage configurations. **Pattern 1**: Graph stores with native vector support (Neo4j, FalkorDB, Memgraph) handle both graph and vector storage — no separate vector store needed. **Pattern 2**: Any graph store can be paired with an external vector store (Qdrant, Chroma, etc.) by passing `vector_store=` to the index constructor, which overrides native vector storage even when available. **Pattern 3**: `SimplePropertyGraphStore` with an external vector store — necessary for any vector retrieval with the in-memory backend.

```python
# Pattern 2: Neo4j + Qdrant
from llama_index.vector_stores.qdrant import QdrantVectorStore

graph_store = Neo4jPropertyGraphStore(username="neo4j", password="pw", url="bolt://localhost:7687")
vector_store = QdrantVectorStore("graph_collection", client=QdrantClient(...))

index = PropertyGraphIndex.from_documents(
    documents,
    property_graph_store=graph_store,
    vector_store=vector_store,
    embed_kg_nodes=True,
)
```

Loading from an existing graph store uses `PropertyGraphIndex.from_existing()`, which reconnects to the graph and optionally the vector store without re-extraction. The [TextToCypherRetriever and CypherTemplateRetriever](https://developers.llamaindex.ai/python/framework/module_guides/indexing/lpg_index_guide/) are particularly useful here, as they can query graphs that were populated outside LlamaIndex — other retrievers depend on metadata properties that LlamaIndex inserts during its own extraction.

## Limitations for heterogeneous technical corpora

The PropertyGraphIndex's extraction pipeline has significant limitations when applied to heterogeneous technical content, particularly mixed corpora containing prose documentation, code, configuration files, and API specifications.

**Entity deduplication is absent.** The [Neo4j blog on customization](https://neo4j.com/blog/developer/property-graph-index-llamaindex/) explicitly addresses this gap, demonstrating a custom deduplication approach using vector similarity between entity name embeddings combined with word distance metrics. Without such custom work, extraction produces duplicate entities — "Paul Graham" and "Graham" and "Paul" as three separate nodes — fragmenting the graph and degrading retrieval quality. This problem compounds in technical corpora where the same concept appears in different forms (e.g., `PropertyGraphIndex`, `property graph index`, `PGIndex`).

**LLM extraction quality varies dramatically by model.** A [practitioner benchmarking multiple models](https://medium.com/mitb-for-all/graphrag-for-the-win-c19d580debd7) found that Gemini 1.0 Pro extracted far less information than GPT-4o, Gemini 1.5 Flash hallucinated entities not present in the source documents, and Qwen 2.5 7B produced "many disconnected islands." **Llama 3.3 70B and GPT-4o produced the most coherent graphs.** Extraction cost is non-trivial: processing 250 news articles takes approximately 7 minutes with GPT-4o, and [local models are significantly slower](https://github.com/run-llama/llama_index/discussions/13944) — one user reported ~10 minutes on an M2 Max for a single document.

**Code artifacts are fundamentally unsupported.** All built-in extractors are designed for natural language text. They send chunks to an LLM prompting for entity-relation triples, but code requires understanding syntax trees, import relationships, function signatures, and class hierarchies — none of which the default prompts address. [Academic research on "Reliable Graph-RAG for Codebases"](https://arxiv.org/html/2601.08773) benchmarks LLM-extracted knowledge graphs against deterministic AST-derived graphs built with Tree-sitter. The deterministic approach is dramatically faster (**2.81s vs 200.14s** for the Shopizer codebase) and produces cleaner, more complete graphs without extraction omissions. The [code-graph-rag project](https://github.com/vitali87/code-graph-rag) demonstrates this AST-based approach with typed nodes (Function, Class, Method) and relationships for multi-language codebases.

The workaround is writing a custom extractor that subclasses `TransformComponent`, uses AST parsing for code files, and writes `EntityNode`/`Relation` objects into node metadata via `KG_NODES_KEY` and `KG_RELATIONS_KEY`. LlamaIndex's modular architecture supports this, but it requires significant custom engineering:

```python
from llama_index.core.graph_stores.types import EntityNode, Relation, KG_NODES_KEY, KG_RELATIONS_KEY
from llama_index.core.schema import BaseNode, TransformComponent
import ast

class CodeASTExtractor(TransformComponent):
    def __call__(self, llama_nodes: list[BaseNode], **kwargs) -> list[BaseNode]:
        for node in llama_nodes:
            existing_nodes = node.metadata.pop(KG_NODES_KEY, [])
            existing_relations = node.metadata.pop(KG_RELATIONS_KEY, [])
            # Parse AST, extract functions, classes, imports as EntityNodes
            # Create CALLS, IMPORTS, INHERITS relations
            node.metadata[KG_NODES_KEY] = existing_nodes
            node.metadata[KG_RELATIONS_KEY] = existing_relations
        return llama_nodes
```

**Schema design requires upfront domain knowledge.** The `SchemaLLMPathExtractor` uses Python `Literal` types to define allowed entity and relation types, which means the developer must enumerate the ontology before extraction begins. For heterogeneous corpora with dozens of entity types (functions, classes, APIs, configuration keys, error codes, people, organizations), this becomes unwieldy. [Practitioners recommend](https://medium.com/@claudiubranzan/from-llms-to-knowledge-graphs-building-production-ready-graph-systems-in-2025-2b4aff1ec99a) **3–7 node types and 5–15 relationship types** as a practical ceiling — "too many reduces accuracy; too few loses important distinctions."

## Known bugs and community-reported issues

Several stability issues affect production deployments. The [serialization bug (#15822)](https://github.com/run-llama/llama_index/issues/15822) in `SimplePropertyGraphStore` loses `ChunkNode.text` and `EntityNode.name` fields on save/reload due to Pydantic v2 migration, acknowledged by maintainers as needing a fix. [Async operations fail (#15292)](https://github.com/run-llama/llama_index/issues/15292) with non-OpenAI embedding models like `OllamaEmbedding`, throwing `TypeError: 'coroutine' object is not iterable` — the workaround is setting `use_async=False` at the cost of throughput. The [`from_existing()` method (#16409)](https://github.com/run-llama/llama_index/issues/16409) reportedly returns empty indexes even when data is visible in the Neo4j browser. The [source code notes](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/indices/property_graph/base.py) that "ref doc info not implemented for PropertyGraphIndex," limiting incremental update and deletion workflows. There is also [no built-in evaluator (#17704)](https://github.com/run-llama/llama_index/issues/17704) — `RetrieverEvaluator` is incompatible because the graph store contains both `ChunkNode` and `EntityNode` types.

A [compatibility issue between `DynamicLLMPathExtractor` and `LLMSynonymRetriever` (#14827)](https://github.com/run-llama/llama_index/issues/14827) causes empty retrievals when labels generated during dynamic extraction don't match what the synonym retriever expects. This works correctly with `SimpleLLMPathExtractor`. Additionally, the default parsing function in `LLMSynonymRetriever` capitalizes keywords, so entity names stored in mixed case during extraction may not be found during retrieval.

## PropertyGraphIndex compared to alternatives

**Microsoft GraphRAG** takes a fundamentally different architectural approach. Where PropertyGraphIndex extracts entity-relation triples and retrieves via graph traversal + vector search, GraphRAG applies community detection (Leiden algorithm) to the extracted graph, generates hierarchical community summaries, and routes queries to either local search (entity traversal) or global search (community summaries). This makes GraphRAG better at answering holistic, corpus-wide questions ("What are the main themes in this dataset?") but at substantially higher construction cost. LlamaIndex has built [approximate GraphRAG implementations](https://docs.llamaindex.ai/en/stable/examples/cookbooks/GraphRAG_v2/) as cookbook examples using PropertyGraphIndex abstractions, but these are not first-class features.

**LangChain's `LLMGraphTransformer`** provides similar extraction capabilities but fewer retrieval options. Its primary retrieval mechanism, `GraphCypherQAChain`, generates Cypher queries from natural language — but [practitioners report](https://medium.com/mitb-for-all/graphrag-for-the-win-c19d580debd7) it frequently generates invalid Cypher with non-existent labels and relationships. LlamaIndex's multiple retriever types (synonym, vector, Cypher, template, custom) and their composability via `PGRetriever` provide a more robust retrieval story. LangChain also has more limited property extraction capabilities and primarily supports Neo4j for graph storage.

PropertyGraphIndex's **key differentiator** is its modular architecture: extractors and retrievers are independently swappable components that compose through clean interfaces. A production system can chain a `SchemaLLMPathExtractor` with a custom `CodeASTExtractor`, store in Neo4j with Qdrant for vectors, and retrieve via a custom retriever combining vector search, Cypher templates, and reranking — all within the same framework. The tradeoff is that this flexibility requires understanding the internal data model and API surface in detail, and the framework's abstractions "can be hard to customize" when built-in behavior doesn't match requirements.

## Conclusion

PropertyGraphIndex provides a well-architected foundation for hybrid graph+vector RAG, with its labeled property graph schema, composable extraction pipeline, and multi-strategy retrieval system representing a significant advance over the earlier `KnowledgeGraphIndex`. The dual-channel retrieval default — combining `LLMSynonymRetriever`'s keyword-based graph traversal with `VectorContextRetriever`'s embedding similarity — addresses the fundamental limitation of pure graph or pure vector approaches. Neo4j emerges as the most capable backend, with native vector support eliminating the need for a separate vector store. However, three practical challenges remain significant: the absence of built-in entity deduplication fragments graphs in production, code and structured artifacts require entirely custom extractors, and serialization and async bugs limit reliability with non-OpenAI toolchains and in-memory storage. Teams building production systems should budget substantial engineering effort for custom extractors, entity resolution, and retriever composition beyond the defaults.

## Bibliography

| Title | URL | Key Contribution |
|-------|-----|-----------------|
| PropertyGraphIndex Module Guide | https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/ | Comprehensive official documentation of extractors, retrievers, and configuration options |
| Introducing the Property Graph Index (LlamaIndex Blog) | https://www.llamaindex.ai/blog/introducing-the-property-graph-index-a-powerful-new-way-to-build-knowledge-graphs-with-llms | Announcement post explaining design rationale and core architecture |
| Customizing Property Graph Index in LlamaIndex (LlamaIndex Blog) | https://www.llamaindex.ai/blog/customizing-property-graph-index-in-llamaindex | Advanced patterns including entity deduplication and custom retrievers with Neo4j |
| Property Graph Index — Neo4j Developer Blog | https://neo4j.com/blog/developer/property-graph-index-llamaindex/ | Neo4j integration details, CypherCorrector, entity deduplication approach |
| PropertyGraphIndex source code (base.py) | https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/indices/property_graph/base.py | Implementation details, default retriever instantiation logic, method signatures |
| Graph stores types.py (EntityNode, Relation, ChunkNode) | https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/graph_stores/types.py | Schema class definitions and PropertyGraphStore base class interface |
| Property Graph Basic Usage Notebook | https://docs.llamaindex.ai/en/stable/examples/property_graph/property_graph_basic/ | End-to-end construction and querying examples with SimplePropertyGraphStore |
| Property Graph Advanced Usage (Predefined Schema) | https://docs.llamaindex.ai/en/stable/examples/property_graph/property_graph_advanced/ | SchemaLLMPathExtractor with strict validation, Neo4j and NebulaGraph examples |
| Custom Retriever Example Notebook | https://docs.llamaindex.ai/en/stable/examples/property_graph/property_graph_custom_retriever/ | Vector+Cypher+reranking custom retriever pattern |
| Graph Store Integrations Overview | https://docs.llamaindex.ai/en/stable/community/integrations/graph_stores/ | Supported backends table and integration packages |
| PropertyGraphIndex API Reference | https://docs.llamaindex.ai/en/stable/api_reference/indices/property_graph/ | Full API documentation for index, extractors, and retrievers |
| SimplePropertyGraphStore Serialization Bug (#15822) | https://github.com/run-llama/llama_index/issues/15822 | Pydantic v2 migration causes data loss on persist/reload |
| Async Error with OllamaEmbedding (#15292) | https://github.com/run-llama/llama_index/issues/15292 | TypeError with use_async=True for non-OpenAI embeddings |
| PropertyGraphIndex from_existing Returns Empty (#16409) | https://github.com/run-llama/llama_index/issues/16409 | Neo4j reload reliability issue |
| DynamicLLMPathExtractor + LLMSynonymRetriever Issue (#14827) | https://github.com/run-llama/llama_index/issues/14827 | Label mismatch between extraction and retrieval |
| RetrieverEvaluator Incompatibility (#17704) | https://github.com/run-llama/llama_index/issues/17704 | No built-in evaluation support for PropertyGraphIndex |
| GraphRAG for the Win (Practitioner Benchmark) | https://medium.com/mitb-for-all/graphrag-for-the-win-c19d580debd7 | Multi-model extraction quality comparison, LangChain vs LlamaIndex vs GraphRAG |
| Reliable Graph-RAG for Codebases (arXiv) | https://arxiv.org/html/2601.08773 | AST-based vs LLM-based KG construction for code; demonstrates deterministic approach superiority |
| code-graph-rag (GitHub) | https://github.com/vitali87/code-graph-rag | Tree-sitter based code knowledge graph construction |
| LlamaIndex GraphRAG v2 Cookbook | https://docs.llamaindex.ai/en/stable/examples/cookbooks/GraphRAG_v2/ | Community detection and summarization on PropertyGraphIndex |
| In-memory Graph Store Discussion (#13939) | https://github.com/run-llama/llama_index/discussions/13939 | SimplePropertyGraphStore capabilities and limitations |
| Building Production-Ready Graph Systems in 2025 | https://medium.com/@claudiubranzan/from-llms-to-knowledge-graphs-building-production-ready-graph-systems-in-2025-2b4aff1ec99a | Schema design guidance: 3–7 node types, 5–15 relationship types |