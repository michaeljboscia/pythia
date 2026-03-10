# Research Prompt: EM-09 Embedding Model Versioning and Migration (Blue-Green Vector Spaces)

## Research Objective
Define a safe, low-downtime migration architecture for changing embedding models or dimensions in LCS, including re-indexing, dual-read validation, and atomic cutover. This research should produce an operational playbook that prevents silent retrieval regressions and enables rollback under live traffic. Findings are required for ADR-003 and must integrate with retrieval/indexing architecture assumptions from ADR-002 and ADR-006.

## Research Questions
1. What migration patterns are viable for vector systems: big-bang rebuild, dual-write dual-read, shadow index, blue-green alias cutover, or rolling partial swaps?
2. How should LCS manage cross-space incompatibility when dimensions and semantic geometry change between model versions?
3. What validation protocol should gate cutover: offline metrics only, shadow traffic replay, online canary with guardrails, or staged percent rollout?
4. How should index aliases/indirection be used to make cutovers atomic and reversible across vector stores?
5. What consistency guarantees are required when background re-embedding runs while corpus updates continue (cross-reference DM-05 incremental indexing)?
6. How should stale vectors, mixed-version vectors, and partially migrated partitions be detected and prevented from serving?
7. What rollback strategy is fastest and safest when online quality regresses after migration?
8. How should LCS version embedding metadata at chunk level (model ID, dimension, training hash, timestamp, pipeline version)?
9. What are the storage and cost implications of keeping N-1 and N indexes live during migration windows?
10. How should evaluation thresholds differ by query class so critical workflows block cutover even if aggregate metrics improve?
11. What failure modes are most likely during migration (bad tokenizer mismatch, broken chunk IDs, score calibration drift, alias misrouting)?
12. How can migration tooling be made deterministic and auditable for post-incident forensics?

## Starting Sources
- Qdrant collections and aliasing concepts — https://qdrant.tech/documentation/concepts/collections/
- Qdrant collections aliases section — https://qdrant.tech/documentation/concepts/collections/#aliases
- Qdrant snapshots/backups concepts — https://qdrant.tech/documentation/concepts/snapshots/
- FAISS wiki (index build/rebuild tradeoffs) — https://github.com/facebookresearch/faiss/wiki
- OpenAI embeddings guide (model evolution context) — https://platform.openai.com/docs/guides/embeddings
- OpenAI new embedding models announcement — https://openai.com/index/new-embedding-models-and-api-updates/
- Weaviate vector search concepts — https://weaviate.io/developers/weaviate/concepts/search/vector-search
- Milvus docs repository (operational migration patterns and index lifecycle references) — https://github.com/milvus-io/milvus-docs
- ANN-Benchmarks (quality/latency regression harness concepts) — https://ann-benchmarks.com/
- BEIR benchmark repository (offline regression suite seed) — https://github.com/beir-cellar/beir

## What to Measure, Compare, or Evaluate
- Migration downtime and user-visible error rate across candidate cutover patterns.
- Offline quality delta: old vs new model on fixed benchmark and LCS golden set.
- Online quality delta: shadow/canary disagreement rates, citation fidelity, and “critical query” pass rate.
- Operational cost: temporary storage multiplier, compute hours for re-embedding, and rollout duration.
- Consistency integrity: rate of mixed-version retrieval results and stale-vector serving incidents.
- Rollback performance: time-to-recover and quality restoration success after forced rollback drills.
- Observability completeness: ability to trace any answer to vector version, index version, and migration wave.

## Definition of Done
- A complete migration runbook exists from preflight checks to rollback, with automation checkpoints.
- At least one blue-green or dual-index cutover strategy is selected as LCS default.
- Mandatory metadata/versioning fields are defined for every embedded chunk.
- Cutover acceptance thresholds and blocking conditions are explicitly documented.
- A chaos-style migration test plan exists for failure injection and rollback rehearsal.
- ADR-003 includes operational migration architecture, not just model-selection logic.

## How Findings Feed LCS Architecture Decisions
This research closes ADR-003’s operational risk gap by defining how model upgrades happen safely. It also constrains ADR-002 storage/index planning and ADR-006 update pipeline behavior because migration and incremental indexing must coexist without serving inconsistent retrieval states.
