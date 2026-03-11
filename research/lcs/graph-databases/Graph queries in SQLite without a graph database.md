# Graph queries in SQLite without a graph database

**SQLite's recursive CTEs and closure tables can implement most graph traversal patterns that developers actually need, but performance degrades exponentially past three hops on large edge sets.** For applications that stay within 2–3 hop queries on edge tables under 100K rows — product hierarchies, org charts, dependency graphs, access-control trees — SQLite delivers sub-second latency with zero operational overhead. The inflection point comes at 4+ hop traversals and algorithmic graph workloads like community detection, where dedicated engines like Kùzu and Neo4j outperform relational approaches by orders of magnitude. The practical question is not "can SQLite do graph queries" but "at what depth and scale does the cost of the workarounds exceed the cost of running a graph database."

This analysis examines the two primary SQL-native strategies for graph workloads in SQLite — recursive common table expressions and closure tables — grounding performance claims in documented benchmarks, official SQLite documentation, and real-world implementations.

## Recursive CTEs turn SQL into a graph traversal language

SQLite has supported recursive CTEs since [version 3.8.3 (2014)](https://sqlite.org/lang_with.html), with the critical ability to use multiple recursive SELECT statements added in [version 3.34.0 (2020)](https://sqlite.org/lang_with.html). The official documentation describes them bluntly: "Recursive common table expressions provide the ability to do hierarchical or recursive queries of trees and graphs, a capability that is not otherwise available in the SQL language."

The core pattern for graph traversal follows a straightforward template. Given an edge table with indexes on both columns, a recursive CTE walks the graph from any starting node:

```sql
CREATE TABLE edge(aa INT, bb INT);
CREATE INDEX edge_aa ON edge(aa);
CREATE INDEX edge_bb ON edge(bb);

WITH RECURSIVE nodes(x) AS (
   SELECT 59
   UNION
   SELECT aa FROM edge JOIN nodes ON bb=x
   UNION
   SELECT bb FROM edge JOIN nodes ON aa=x
)
SELECT x FROM nodes;
```

This query finds every node reachable from node 59 in an undirected graph. The [SQLite documentation](https://sqlite.org/lang_with.html) explains the algorithm: run the initial SELECT and add results to a queue; while the queue is not empty, extract a single row, insert it into the recursive table, then run the recursive SELECT pretending that single row is the only row in the recursive table, adding all new results back to the queue. The use of `UNION` rather than `UNION ALL` is critical here — it provides **built-in cycle prevention** by automatically discarding any row that has already been generated.

For directed graphs where you need to track paths and measure hop distance, the pattern extends with path accumulation and depth counting:

```sql
WITH RECURSIVE paths(start_node, current_node, path, depth) AS (
  SELECT source, target,
         CAST(source AS TEXT) || ',' || CAST(target AS TEXT), 1
  FROM edges
  WHERE source = ?
  UNION ALL
  SELECT p.start_node, e.target,
         p.path || ',' || CAST(e.target AS TEXT), p.depth + 1
  FROM paths p
  JOIN edges e ON p.current_node = e.source
  WHERE p.path NOT LIKE '%,' || e.target || ',%'
    AND p.depth < 5
)
SELECT * FROM paths;
```

This pattern, documented across the [SQLite forum](https://sqlite.org/forum/info/3b309a9765636b79) and [community examples](https://sqlite.org/forum/forumpost/a28c948b65), concatenates visited node IDs into a path string and uses `NOT LIKE` or `instr()` to prevent revisiting nodes within a single path. The `depth < 5` clause serves as a hard recursion bound.

For known-depth queries — the common case in practice — explicit JOINs outperform recursive CTEs. A 2-hop friend-of-friend query is simply:

```sql
SELECT DISTINCT e2.target
FROM edges e1
JOIN edges e2 ON e1.target = e2.source
WHERE e1.source = ?;
```

A 3-hop extension adds one more JOIN. These fixed-depth joins let the [SQLite query planner](https://sqlite.org/optoverview.html) choose optimal index usage and join ordering, avoiding the per-row queue processing overhead of recursive CTEs entirely.

### Cycle detection and recursion limits demand explicit handling

Unlike MySQL (which defaults `cte_max_recursion_depth` to 1,000) and SQL Server (which defaults `MAXRECURSION` to 100), **SQLite imposes no automatic recursion depth limit** on CTEs. A runaway recursive CTE will continue until the WHERE clause drains the queue, a LIMIT clause is hit, UNION eliminates all new rows, or the process runs out of memory. The [official documentation](https://sqlite.org/lang_with.html) recommends defensive programming: "It is good practice to always include a LIMIT clause as a safety if an upper bound on the size of the recursion is known."

SQLite also **does not support** the SQL standard `CYCLE` clause available in PostgreSQL 14+. Developers must choose among four manual strategies. First, using `UNION` instead of `UNION ALL` provides global duplicate elimination — SQLite keeps all previously generated rows in memory to check for duplicates, trading memory for correctness. Second, path-string tracking with `instr(visited, '/' || node_id || '/')` prevents per-path cycles but cannot prevent different paths from visiting the same node. Third, a depth counter (`WHERE depth < N`) provides a hard bound. Fourth, `LIMIT` on the outer query or within the recursive SELECT provides a safety net.

A critical limitation noted in the [SQLite forum](https://sqlite.org/forum/info/3b309a9765636b79) constrains optimization: "the reference to the recursive table in the recursive select is a reference to the singleton row being recursed. You do not have access to other rows in the recursive table." This means a BFS traversal cannot check whether another path has already reached a node — paths `1→2→4` and `1→3→4` are computed independently. The only way to prevent redundant exploration globally is `UNION`, which carries the memory cost of storing all visited states.

### Memory behavior and performance depend on UNION vs UNION ALL

The [SQLite documentation](https://sqlite.org/lang_with.html) explains an important optimization: with `UNION ALL`, when the query optimizer detects that values from the recursive table are used only once, each row is "immediately returned as a result of the main SELECT statement and then discarded. SQLite does not accumulate a temporary table." However, with `UNION`, "SQLite would have had to keep around all previously generated content in order to check for duplicates." For graph traversals on cyclic graphs, `UNION` is usually mandatory, so this memory cost is unavoidable.

A benchmark on the [SQLite forum](https://sqlite.org/forum/info/016a25083a9f8eb5c6532ed5a961eb7c2362f667cbca305f65dccb2e82170df7) tested a perfect 10-ary tree of height 6 with **1,000,001 nodes**. The recursive CTE completed in **7.7 seconds** while the equivalent manual self-join completed in **3.9 seconds** — roughly a **2× penalty** for the recursive approach. The commenter noted: "Why is recursive CTE so slow? Is it because sqlite recurses only one line at a time?" — and indeed, the row-at-a-time queue processing is the fundamental bottleneck.

SQLite also provides control over traversal order. An `ORDER BY` on the recursive SELECT transforms the queue into a priority queue: `ORDER BY distance ASC` produces breadth-first search, while `ORDER BY distance DESC` produces depth-first search. The [documentation](https://sqlite.org/lang_with.html) notes that without `ORDER BY`, "the queue becomes a FIFO" in the current implementation (effectively BFS), but applications "should not depend on that fact since it might change."

One additional performance concern emerged from a [forum report](https://sqlite.org/forum/forumpost/b21c2101a559be0a) where the query planner chose an `AUTOMATIC PARTIAL COVERING INDEX` instead of a user-defined index inside a recursive CTE step, causing a **700× slowdown** (1ms vs. 700ms). The workaround was `PRAGMA automatic_index=OFF`. The SQLite team acknowledged this as a real query planner issue, illustrating that recursive CTE performance can be sensitive to planner heuristics.

## Closure tables materialize the graph for constant-time reads

The closure table pattern, theorized by Vadim Tropashko in *SQL Design Patterns* (2006) and popularized by Bill Karwin in [*SQL Antipatterns*](https://karwin.com/blog/index.php/2010/03/24/rendering-trees-with-closure-tables/) and on the [Percona blog](https://www.percona.com/blog/moving-subtrees-in-closure-table/), pre-computes and stores every ancestor-descendant path in a dedicated table. For a tree `A → B → C → D`, the closure table contains ten rows: `A-A`, `A-B`, `A-C`, `A-D`, `B-B`, `B-C`, `B-D`, `C-C`, `C-D`, and `D-D`, each with a depth value. Karwin explains: "This makes it easy to query for all descendants of A, or all ancestors of D, or many other common queries that are difficult if you store hierarchies according to textbook solutions."

The schema requires two tables. The node table stores entity data; the closure table stores paths:

```sql
CREATE TABLE nodes (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE tree_paths (
  ancestor INTEGER NOT NULL REFERENCES nodes(id),
  descendant INTEGER NOT NULL REFERENCES nodes(id),
  depth INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ancestor, descendant)
);
CREATE INDEX idx_descendant ON tree_paths(descendant);
CREATE INDEX idx_ancestor_depth ON tree_paths(ancestor, depth);
```

The [Red Gate Simple Talk guide](https://www.red-gate.com/simple-talk/databases/sql-server/t-sql-programming-sql-server/sql-server-closure-tables/) notes that "the Closure table has a constraint to prevent duplicate edges and to ensure that all heads and tails reference the IDs of existing staff. We've added a Depth attribute that isn't strictly necessary but it's useful." The [libtree documentation](https://libtree.readthedocs.io/en/latest/db_model.html) warns that "both columns in the ancestor table are indexed separately and together, resulting in index sizes that are twice the size of the actual data."

### Inserting and deleting require careful path maintenance

Inserting a new leaf node under a parent requires copying all paths that terminate at the parent, extending each by one hop, plus adding a self-referencing row. As Karwin describes on [his Percona blog](https://www.percona.com/blog/moving-subtrees-in-closure-table/):

```sql
-- Insert node 'E' as child of 'D'
INSERT INTO tree_paths (ancestor, descendant, depth)
SELECT t.ancestor, 'E', t.depth + 1
FROM tree_paths AS t
WHERE t.descendant = 'D'
UNION ALL
SELECT 'E', 'E', 0;
```

Karwin explains: "Basically you need to copy any path terminating with the parent, and change the endpoint of that path to the new node." The number of rows inserted equals the depth of the parent plus one (for the self-reference).

Deleting a leaf is trivial — `DELETE FROM tree_paths WHERE descendant = node_id`. Deleting an entire subtree requires identifying all descendants first:

```sql
DELETE FROM tree_paths
WHERE descendant IN (
  SELECT descendant FROM tree_paths WHERE ancestor = 4
);
```

Moving a subtree is the most complex operation. Karwin's [Percona article](https://www.percona.com/blog/moving-subtrees-in-closure-table/) details a two-step process: first disconnect the subtree by deleting all paths that cross the old boundary (paths that start outside the subtree and end inside it), then reconnect by inserting new cross-boundary paths as a Cartesian product of the new parent's ancestors and the subtree's descendants. The disconnect step uses a carefully constructed multi-table delete, and the reconnect step uses:

```sql
INSERT INTO tree_paths (ancestor, descendant, depth)
SELECT supertree.ancestor, subtree.descendant,
       supertree.depth + subtree.depth + 1
FROM tree_paths AS supertree
JOIN tree_paths AS subtree
WHERE subtree.ancestor = 'D'
  AND supertree.descendant = 'B';
```

### The read-write trade-off is steep but predictable

Queries against a closure table reduce to simple JOINs. Finding all descendants: `SELECT * FROM nodes JOIN tree_paths ON id = descendant WHERE ancestor = ?`. Finding only direct children: add `AND depth = 1`. Finding all ancestors: `WHERE descendant = ? ORDER BY depth DESC`. No recursion, no CTEs — just indexed lookups.

A [benchmark on the Adimian blog](https://www.adimian.com/blog/cte-and-closure-tables/) tested this trade-off with SQLite on a tree of **5,912 nodes** generating **34,406 closure rows**. Populating the closure table took approximately **8 seconds** versus 0.03 seconds for the adjacency list alone — a **267× write penalty**. Read performance for descendant queries, however, favored the closure table. An [Egnyte engineering study](https://www.egnyte.com/blog/post/12780evaluating-mysql-recursive-cte-at-scale/) on MySQL 8 with **9 million rows** found that recursive CTEs were approximately **1.7–2× slower** than closure table lookups at the application level including network overhead.

The space complexity is O(n × d̄) where d̄ is the average depth. For balanced trees this is manageable; for deep chains (depth 500+), each new node adds 500 rows. Karwin himself [advises](https://karwin.com/blog/index.php/2010/03/24/rendering-trees-with-closure-tables/): "No algorithm or pattern is best for all cases. The answer depends on how frequently you insert versus how frequently you query the tree."

### SQLite's transitive closure extension bridges both approaches

SQLite ships a [transitive closure virtual table extension](https://charlesleifer.com/blog/querying-tree-structures-in-sqlite-using-python-and-the-transitive-closure-extension/) (`ext/misc/closure.c`) that automatically computes closure from a standard adjacency-list table using an in-memory AVL tree. Setup is minimal:

```sql
CREATE VIRTUAL TABLE node_closure USING transitive_closure(
  tablename="nodes",
  idcolumn="id",
  parentcolumn="parent_id"
);
SELECT id FROM node_closure WHERE root = 1 AND depth <= 3;
```

As Charles Leifer notes, "we are not inserting any values into the closure table. The closure table will automatically populate based on the values stored in the source table." This eliminates the maintenance burden entirely, though it requires compiling the extension separately and restricts the source table to integer primary keys. Leifer's benchmarks found the extension "performed better in every case" compared to materialized path models for tree queries.

## Performance falls off a cliff at four hops

The canonical benchmark for relational-vs-graph traversal comes from [*Neo4j in Action*](https://neo4j.com/news/how-much-faster-is-a-graph-database-really/) by Partner and Vukotic, testing a social network of **1 million users with ~50 friends each**. At 2 hops, MySQL completed in 0.016 seconds versus Neo4j's 0.010 seconds — barely different. At 3 hops, the gap exploded: MySQL took **30.3 seconds** versus Neo4j's **0.168 seconds**, a 180× difference. At 4 hops, MySQL needed **1,544 seconds** versus Neo4j's **1.4 seconds** — over **1,100×** slower. At 5 hops, MySQL did not finish within an hour; Neo4j returned in 2.1 seconds.

These numbers warrant caveats. An [independent replication](https://baach.de/Members/jhb/neo4j-performance-compared-to-mysql) using Cypher over REST found dramatically different results, with MySQL actually faster than Neo4j at depth 4 (5.6 seconds vs. 30 seconds), suggesting the original benchmark used Neo4j's native Java API rather than its query language. The lesson is that **interface choice and query optimization matter as much as the engine**. Max De Marzi's [benchmark](https://maxdemarzi.com/2017/02/06/neo4j-is-faster-than-mysql-in-performing-recursive-query/) with 100K nodes and 10M relationships showed a naive Cypher query taking 240 seconds for a depth-4 traversal, dropping to 2.7 seconds with a custom stored procedure — a 90× improvement from optimization alone.

For embedded graph workloads, [Kùzu](https://thedataquarry.com/blog/embedded-db-2/) provides a more direct comparison. On **100K person nodes and ~2.4M edges**, Kùzu outperformed Neo4j by **5–16× across query types**, with the largest speedups on n-hop path-finding queries. Kùzu was also **18× faster than Neo4j** for data ingestion. These gains come from vectorized query processing (2,048-tuple batches), factorized execution that avoids materializing many-to-many join explosions, and CSR-based adjacency indices, as described in the [CIDR 2023 paper](https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf).

DuckDB has taken a different approach. Its [`USING KEY` extension](https://duckdb.org/2025/05/23/using-key) to recursive CTEs, published at [SIGMOD 2025](https://dl.acm.org/doi/10.1145/3722212.3725107), treats the union table as a keyed dictionary with upsert semantics rather than an append-only log. The results are dramatic: on an LDBC social network graph with 424 nodes and 1,446 edges, vanilla recursive CTEs processed nearly **1 billion rows** while the USING KEY variant handled **fewer than 20,000** — a reduction of five orders of magnitude. On larger graphs, the vanilla approach crashed with out-of-memory errors while USING KEY completed successfully. This innovation narrows the gap between SQL and native graph engines for specific algorithms like shortest path and distance-vector routing, though it is DuckDB-specific and not available in SQLite.

Simon Willison [observed on Hacker News](https://news.ycombinator.com/item?id=34584110) a key property of SQLite that partially compensates for its per-row recursion overhead: "An algorithm that traverses a graph by performing hundreds of individual SELECT queries to follow a path should work much better against SQLite than against most other relational databases, due to the lack of network overhead." The [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) Node.js driver exploits this with synchronous in-process calls, achieving **313,899 individual read operations per second** — and its documentation reports "upward of 2,000 queries per second with 5-way joins in a 60 GB database" with real production data.

## Five query patterns that break relational graph emulation

Not all graph workloads are traversals, and the distinction determines when SQLite stops being viable.

**Variable-depth path queries** push recursive CTEs to their limits. When the required traversal depth is unknown ahead of time, you cannot use fixed JOINs and must rely on recursive CTEs with their row-at-a-time processing. On dense graphs, the intermediate result set grows exponentially with depth. The `UNION`-based cycle prevention requires keeping all visited states in memory, and the path-string tracking approach adds string comparison overhead to every iteration.

**Shortest path computation** is feasible but inefficient. SQLite's recursive CTE can find all paths and then select the minimum-depth one, but it cannot prune suboptimal paths mid-traversal the way Dijkstra's algorithm does. The [DuckDB USING KEY approach](https://duckdb.org/2025/05/23/using-key) solves this elegantly with upsert semantics — keeping only the best-known distance for each node — but SQLite lacks this capability.

**PageRank** is surprisingly tractable in SQL. A [University of Victoria study](https://webhome.cs.uvic.ca/~thomo/papers/incos2020-RDBMS.pdf) implemented PageRank using SQL `MERGE` operations with matrix partitioning, testing on graphs up to **1.15 billion edges**. The authors found that their RDBMS implementation "outperformed dedicated graph databases" at billion scale — a counterintuitive result that stemmed from clever partitioning to manage memory. However, SQLite specifically lacks the `MERGE` statement, making this technique inapplicable without significant workarounds using INSERT-OR-REPLACE.

**Community detection algorithms** like Louvain modularity optimization have no practical SQL implementation. These algorithms require iterative reassignment of nodes to communities based on modularity gain calculations that reference the current global partition state — a fundamentally imperative pattern that recursive CTEs cannot express. Even [SQL Server's graph extensions](https://medium.com/swlh/microsoft-sql-servers-graph-an-attempt-that-fell-short-for-now-a4888245c483) explicitly exclude these: "SQL Graph does not provide any such functions in this release."

**Multi-relationship pattern matching** — "find all users who follow someone who bought a product that was reviewed by a user in the same city" — requires expressing variable-length paths across heterogeneous edge types. In Cypher, this is a single `MATCH` clause. In SQL, it becomes a chain of JOINs where the number and type of edges must be known at query-writing time. For applications where the query patterns are fixed and known (recommendation engines with a specific traversal template), SQL works. For exploratory graph analytics where traversal patterns vary, Cypher's expressiveness wins decisively.

The decision framework reduces to three variables. **Traversal depth**: if your maximum hop count is 3 or fewer on tables under 100K edges, SQLite with proper indexing delivers sub-second performance with no operational burden. **Query pattern stability**: if you know your traversal patterns at development time, fixed JOINs and closure tables eliminate the recursive CTE overhead entirely. **Algorithmic requirements**: if you need community detection, centrality measures, or exploratory pattern matching, adopt an embedded graph engine like Kùzu alongside SQLite rather than trying to force these workloads into SQL. The [simple-graph project](https://github.com/dpapathanasiou/simple-graph) on GitHub, with 1,500 stars, demonstrates that the SQLite-as-graph-store approach works well for applications with "several thousand nodes" using CTE-based traversal — a scale that covers a surprisingly large number of real applications.

## Conclusion

The recursive CTE and closure table patterns transform SQLite from a flat relational store into a capable graph query engine for bounded workloads. Recursive CTEs offer flexibility at the cost of row-at-a-time processing and manual cycle management; closure tables offer constant-time reads at the cost of O(n × depth) storage and complex write maintenance; SQLite's transitive closure extension neatly bridges both approaches for tree structures. The performance ceiling is real but well-defined: **2× overhead versus manual JOINs** for recursive CTEs on million-node trees, exponential blowup past 3–4 hops on dense graphs, and no viable path to iterative graph algorithms like community detection. For the vast majority of hierarchical and shallow-graph workloads — org charts, category trees, dependency resolution, permission inheritance, knowledge graphs under 100K edges — SQLite eliminates the operational complexity of running a separate graph database while delivering query times measured in milliseconds. The key engineering insight is not to choose one approach universally, but to match the strategy to the workload: fixed JOINs for known-depth queries, closure tables for read-heavy hierarchies, recursive CTEs for variable-depth exploration, and a dedicated graph engine for deep traversals and algorithmic analytics.

## Bibliography

| Source | URL | Key contribution |
|--------|-----|-----------------|
| SQLite WITH Clause Documentation | https://sqlite.org/lang_with.html | Official recursive CTE syntax, algorithm description, graph query examples, memory behavior, ORDER BY queue semantics |
| SQLite Limits Documentation | https://sqlite.org/limits.html | Documents SQLITE_MAX_TRIGGER_DEPTH (1000) and confirms no built-in CTE recursion limit |
| SQLite Forum: Recursive CTE vs Manual Joins | https://sqlite.org/forum/info/016a25083a9f8eb5c6532ed5a961eb7c2362f667cbca305f65dccb2e82170df7 | Benchmark showing 7.7s (recursive CTE) vs 3.9s (manual join) on 1M-node tree |
| SQLite Forum: BFS Graph Traversal | https://sqlite.org/forum/info/3b309a9765636b79 | Discussion of BFS limitations in recursive CTEs, singleton row constraint, closure.c extension reference |
| SQLite Forum: BFS with Path Tracking | https://sqlite.org/forum/forumpost/a28c948b65 | Concrete BFS traversal examples with visited-path cycle prevention |
| Bill Karwin, "Rendering Trees with Closure Tables" | https://karwin.com/blog/index.php/2010/03/24/rendering-trees-with-closure-tables/ | Original closure table pattern description, self-reference rationale, query examples |
| Bill Karwin, "Moving Subtrees in Closure Table" (Percona Blog) | https://www.percona.com/blog/moving-subtrees-in-closure-table/ | Subtree disconnect/reconnect algorithm, insert/delete SQL patterns |
| Bill Karwin, SlideShare Presentation | https://www.slideshare.net/billkarwin/practical-object-oriented-models-in-sql/68-Naive_Trees_Closure_Tables_depth | Comparison table of adjacency list, path enumeration, nested sets, and closure table trade-offs |
| Red Gate Simple Talk: SQL Server Closure Tables | https://www.red-gate.com/simple-talk/databases/sql-server/t-sql-programming-sql-server/sql-server-closure-tables/ | Closure table implementation guide with depth attribute, schema constraints |
| Charles Leifer: SQLite Transitive Closure Extension | https://charlesleifer.com/blog/querying-tree-structures-in-sqlite-using-python-and-the-transitive-closure-extension/ | Guide to SQLite's closure.c virtual table extension, AVL tree internals, benchmarks vs materialized paths |
| Neo4j: "How Much Faster Is a Graph Database Really?" | https://neo4j.com/news/how-much-faster-is-a-graph-database-really/ | Partner & Vukotic benchmark: 1M users, MySQL vs Neo4j at 2–5 hop depths |
| Independent Neo4j vs MySQL Benchmark | https://baach.de/Members/jhb/neo4j-performance-compared-to-mysql | Replication showing MySQL competitive at 4 hops when Neo4j uses Cypher over REST |
| Max De Marzi: Neo4j Recursive Query Benchmark | https://maxdemarzi.com/2017/02/06/neo4j-is-faster-than-mysql-in-performing-recursive-query/ | 100K nodes/10M edges: naive Cypher 240s, optimized procedure 2.7s |
| Kùzu Embedded DB Benchmark | https://thedataquarry.com/blog/embedded-db-2/ | 100K nodes/2.4M edges: Kùzu 5–16× faster than Neo4j, 18× faster ingestion |
| Kùzu CIDR 2023 Paper | https://www.cidrdb.org/cidr2023/papers/p48-jin.pdf | Vectorized processing, factorized execution, worst-case optimal joins architecture |
| DuckDB USING KEY Blog Post | https://duckdb.org/2025/05/23/using-key | USING KEY recursive CTE extension: 5 orders of magnitude row reduction on LDBC graphs |
| DuckDB USING KEY SIGMOD 2025 Paper | https://dl.acm.org/doi/10.1145/3722212.3725107 | Formal description and evaluation of keyed dictionary semantics for recursive CTEs |
| Ahmed & Thomo: PageRank in RDBMS | https://webhome.cs.uvic.ca/~thomo/papers/incos2020-RDBMS.pdf | SQL MERGE-based PageRank outperforming graph DBs on billion-edge graphs |
| simple-graph (GitHub) | https://github.com/dpapathanasiou/simple-graph | SQLite-as-graph-database project: JSON nodes/edges, CTE traversal, multi-language bindings |
| better-sqlite3 (GitHub) | https://github.com/WiseLibs/better-sqlite3 | 313,899 read ops/sec, synchronous API, benchmark data vs node-sqlite3 |
| Simon Willison (Hacker News) | https://news.ycombinator.com/item?id=34584110 | Insight on SQLite's "many small queries" advantage for graph traversal without network overhead |
| Adimian: CTE and Closure Tables | https://www.adimian.com/blog/cte-and-closure-tables/ | SQLite benchmark: 5,912 nodes, closure table 267× slower writes, faster reads |
| Egnyte: MySQL Recursive CTE at Scale | https://www.egnyte.com/blog/post/12780evaluating-mysql-recursive-cte-at-scale/ | 9M rows: recursive CTEs 1.7–2× slower than closure table lookups |
| SQL Server Graph Limitations (Medium) | https://medium.com/swlh/microsoft-sql-servers-graph-an-attempt-that-fell-short-for-now-a4888245c483 | Documents missing graph analytics functions (PageRank, shortest path) in SQL Server Graph |