# Research Prompt: KG-06 Community Detection Algorithms (P2)

## Research Objective
Evaluate community detection methods for LCS graph organization, especially Louvain vs Leiden, and determine when community-level retrieval improves answer quality versus adding noise and complexity. The research must produce parameter guidance and stability criteria for operational use. Findings feed ADR-001 and cross-reference KG-01 and PA-02.

## Research Questions
1. What algorithmic differences between Louvain and Leiden materially affect LCS graph outcomes?
2. How stable are community assignments across repeated runs and incremental updates?
3. How does edge weighting and edge typing impact detected communities?
4. What resolution settings best balance coarse thematic clusters and fine-grained utility?
5. When do community summaries improve global retrieval quality versus obscure critical details?
6. How sensitive are results to extraction noise from KG-04/KG-09 pipelines?
7. What computational overhead does community recomputation add at LCS scale?
8. How should oversized or fragmented communities be detected and corrected?
9. What evaluation metrics best reflect retrieval utility of communities (not just modularity)?
10. How does community-based retrieval compare to direct neighborhood traversal for hard queries?
11. What failure modes are common (semantic drift, unstable clusters, bridge-node domination)?
12. Should community detection be always-on, scheduled, or query-conditional in ADR-001?

## Starting Sources
- Louvain paper — https://arxiv.org/abs/0803.0476
- Leiden paper — https://www.nature.com/articles/s41598-019-41695-z
- `leidenalg` implementation — https://github.com/vtraag/leidenalg
- NetworkX community docs — https://networkx.org/documentation/stable/reference/algorithms/community.html
- GraphRAG paper — https://arxiv.org/abs/2404.16130
- GraphRAG repository — https://github.com/microsoft/graphrag
- LightRAG repository — https://github.com/HKUDS/LightRAG
- Neo4j Graph Data Science community algorithms — https://neo4j.com/docs/graph-data-science/current/algorithms/community/
- igraph community detection docs — https://igraph.org/python/doc/igraph.GraphBase.html#community_multilevel

## What to Measure, Compare, or Evaluate
- Partition quality: modularity, conductance, community size distribution.
- Stability: NMI/ARI across reruns and update windows.
- Retrieval impact: answer quality with/without community-level context.
- Runtime/resource overhead for recomputation at different graph sizes.
- Sensitivity to noisy edges and relation weighting schemes.
- Operational triggers for recompute vs incremental adjustments.

## Definition of Done
- Louvain vs Leiden comparison is complete on LCS-like graph datasets.
- Recommended algorithm and parameter ranges are documented.
- Community quality monitoring and repair heuristics are defined.
- ADR-001 decision on community usage mode is explicit.
- Risks and non-goals are clearly listed.

## How Findings Feed LCS Architecture Decisions
This research determines if and how community structure becomes a first-class retrieval primitive in ADR-001, grounded in measurable utility and operational stability rather than algorithm novelty.
