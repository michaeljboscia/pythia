# Research Prompt: KG-06 Community Detection Algorithms (Louvain, Leiden, GraphRAG Usage)

## Research Objective
Determine which community detection algorithm and parameterization should be used in LCS graph indexing workflows to support high-quality cluster-level retrieval and summarization. This research must move beyond theory and quantify how Louvain and Leiden behave on LCS-like heterogeneous graphs (documents, code entities, ADR nodes, and relationships). The output should directly inform ADR-001 graph architecture choices for clustering, traversal entry points, and query-time global context retrieval.

## Research Questions
1. What are the core algorithmic differences between Louvain and Leiden (optimization target, refinement phase, guarantees on connectedness), and when do those differences matter in practice?
2. How sensitive are Louvain and Leiden to resolution parameters on small-to-medium graphs (5k-50k nodes), and how stable are community assignments across repeated runs?
3. How do weighted, typed edges (for example, `implements`, `depends_on`, `supersedes`, `mentions`) change community structure quality versus untyped/unweighted baselines?
4. Which clustering outputs are most useful for retrieval: large coarse communities, fine-grained communities, or hierarchical multi-level partitions?
5. How did Microsoft GraphRAG operationalize community detection, and which design assumptions transfer to LCS versus fail under mixed code+doc corpora?
6. What are the computational costs (time, memory) and incremental update implications of rerunning community detection during corpus updates?
7. What failure modes matter most for LCS (over-merged themes, fragmented modules, unstable clusters) and how should they be detected automatically?

## Starting Sources
- Louvain method paper: Fast unfolding of communities in large networks — https://arxiv.org/abs/0803.0476
- Leiden algorithm paper: From Louvain to Leiden: guaranteeing well-connected communities — https://www.nature.com/articles/s41598-019-41695-z
- `leidenalg` reference implementation — https://github.com/vtraag/leidenalg
- NetworkX community algorithm documentation — https://networkx.org/documentation/stable/reference/algorithms/community.html
- Microsoft GraphRAG repository (community indexing pipeline) — https://github.com/microsoft/graphrag
- GraphRAG paper (community-centric retrieval framing) — https://arxiv.org/abs/2404.16130

## What to Measure, Compare, or Evaluate
- Partition quality metrics: modularity, conductance, and community-size distribution entropy.
- Stability metrics: normalized mutual information (NMI) across runs and across incremental graph changes.
- Retrieval utility: effect of community partitions on global-query answer quality and multi-hop recall.
- Operational cost: runtime and peak memory for full recompute and partial recompute scenarios.
- Drift behavior: how much cluster assignments change after controlled graph mutations.
- Practical interpretability: manual rating of whether top communities correspond to meaningful architectural/business themes.

## Definition of Done
- A head-to-head Louvain vs Leiden comparison exists on at least one synthetic and one real LCS-derived graph.
- Parameter recommendations are explicit (resolution ranges, edge weighting strategy, rerun cadence).
- A policy is defined for handling instability and oversized/undersized communities.
- The report states a clear default algorithm for LCS v1 and fallback conditions.
- Implementation implications are concrete enough to write ADR-001 clustering sections without additional research.

## How Findings Feed LCS Architecture Decisions
This research sets ADR-001 decisions for whether community detection is mandatory, optional, or deferred in LCS v1; which algorithm to standardize on; and what metadata must be persisted on community nodes. It also shapes retrieval orchestration by deciding when to route a query through community-level global retrieval versus local neighborhood traversal.
