# Research Prompt: PE-03 Index Rebuild and Migration Strategies (Blue-Green, Atomic Cutover)

## Research Objective
Define robust index rebuild and migration patterns for LCS so embedding/model/index changes can be rolled out without downtime or silent quality regressions. The study should cover blue-green indexing, alias-based atomic swaps, shadow reads, and rollback protocols for vector and graph-adjacent indexes. Findings feed ADR-002 and ADR-003, with direct cross-reference to EM-09.

## Research Questions
1. What migration strategies are viable for LCS: full rebuild, rolling rebuild, shadow index, dual-read, blue-green cutover?
2. How should atomic cutover be implemented for vector collections/indexes across candidate stores?
3. What validation gates are required before cutover (offline metrics, shadow replay, canary pass thresholds)?
4. How should incremental corpus updates be reconciled while a rebuild is in progress?
5. What metadata/versioning schema is needed to trace index provenance and ensure reproducibility?
6. How should rollback be triggered and executed when post-cutover quality degrades?
7. What storage and compute overhead is acceptable for dual-index windows?
8. How do embedding dimension/model changes complicate migration and compatibility (cross-reference EM-06/EM-09)?
9. What failure modes occur most often (partial build success, alias misrouting, stale shard references)?
10. How should index migrations be tested safely in staging before production execution?
11. What automation is needed to reduce human error in migration workflows?
12. Which parts of migration policy belong in ADRs vs operational runbooks?

## Starting Sources
- Martin Fowler blue-green deployment note — https://martinfowler.com/bliki/BlueGreenDeployment.html
- Qdrant collections/aliases docs — https://qdrant.tech/documentation/concepts/collections/
- Qdrant snapshots docs — https://qdrant.tech/documentation/concepts/snapshots/
- pgvector repository (reindex/migration context) — https://github.com/pgvector/pgvector
- FAISS wiki (index rebuild behavior) — https://github.com/facebookresearch/faiss/wiki
- OpenAI embeddings docs (model evolution context) — https://platform.openai.com/docs/guides/embeddings
- Weaviate docs (schema/index evolution context) — https://weaviate.io/developers/weaviate
- Google SRE book (rollouts and rollbacks context) — https://sre.google/sre-book/monitoring-distributed-systems/
- EM-09 migration inputs (internal cross-reference source) — /Users/mikeboscia/pythia/research/lcs/embedding-models/prompt/EM-09_prompt.md

## What to Measure, Compare, or Evaluate
- Cutover downtime and error budget consumption by migration strategy.
- Quality deltas pre/post cutover with confidence intervals.
- Storage/compute overhead for dual-index windows.
- Rollback time-to-recovery and success rate in drills.
- Mixed-version serving incidence and detection reliability.
- Operational complexity and automation coverage.

## Definition of Done
- A migration strategy decision tree is documented for common change types.
- Atomic cutover and rollback runbooks are produced and validated.
- Preflight and post-cutover validation checklists are defined.
- Monitoring/alert thresholds for migration health are specified.
- ADR-002/003 receive actionable migration architecture guidance.

## How Findings Feed LCS Architecture Decisions
This research operationalizes ADR-002/003 by defining safe rollout mechanics for index/model changes. It closes the reliability gap between experimentation and production by making migration quality measurable, auditable, and reversible.
