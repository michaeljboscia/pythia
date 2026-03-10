# Research Prompt: KG-04 Knowledge Graph Construction from Unstructured Text

## Research Objective
Investigate the pipelines, tools, and accuracy tradeoffs for automatically extracting entities and relationships from unstructured text (like Markdown docs or PR descriptions) to construct a knowledge graph. This research will define the ingestion pipeline for non-code artifacts in LCS.

## Research Questions
1. How do zero-shot LLM prompts perform for Relation Extraction (RE) and Named Entity Recognition (NER) compared to fine-tuned SLMs (Small Language Models) like REBEL (Relation Extraction By End-to-end Language generation)?
2. What are the common error modes of LLM-based extraction (e.g., hallucinated relationships, failure to deduplicate entities, inconsistent edge labels)?
3. How can schema constraints be enforced during LLM-based extraction (e.g., using Instructor/Pydantic to force the LLM to only output `[Entity, Predicate, Entity]` tuples)?
4. What is the role of coreference resolution in building a cohesive graph from multiple independent documents? How is it implemented reliably?
5. How do tools like Cognee or LlamaIndex's `KnowledgeGraphIndex` orchestrate the extraction pipeline out-of-the-box?
6. When a document is updated, how do you deterministically identify which edges to drop and which to add without rebuilding the entire graph?

## Starting Sources
- **REBEL Paper/Model:** https://huggingface.co/Babelscape/rebel-large
- **LlamaIndex Property Graph Construction Docs:** https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg/
- **OpenIE (Open Information Extraction) fundamentals.**
- **Instuct/Pydantic structured output documentation.**

## What to Measure & Compare
- Compare the processing time and token cost of extracting relationships from a 2,000-word architecture document using GPT-4o versus a local REBEL model.
- Measure the precision/recall of the extracted triplets against a human-annotated baseline of that same document.

## Definition of Done
A practical pipeline design for text-to-graph ingestion. It must identify the specific tools/models to be used, define the JSON schema for the extraction output, and propose a concrete strategy for entity deduplication across the corpus.

## Architectural Implication
Feeds **ADR-005 (Relationship Extraction)**. Determines whether we rely on expensive LLM calls during indexing or local, specialized NLP models, fundamentally impacting the compute requirements of the background ingestion daemon.