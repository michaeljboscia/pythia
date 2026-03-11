# Artifact Lifecycle State Management for Knowledge Bases

**DM-06 · Technical Analysis**

**Every technical artifact—an ADR, a design doc, a code snippet—has a lifespan.** Managing that lifespan explicitly, from the moment of creation through active use, supersession, deprecation, and eventual archival, is what separates a living knowledge base from a graveyard of stale documents. This analysis defines a six-state lifecycle model for technical artifacts, examines how production systems handle retrieval of deprecated content, and proposes a multi-signal architecture for automatically inferring lifecycle state. The recommendations draw on established standards (ISO 15489, Dublin Core, DITA), real-world ADR tooling (MADR, adr-tools, log4brains), and the retrieval behaviors of Confluence, SharePoint, and MediaWiki.

---

## The six canonical lifecycle states and their transition rules

A robust artifact lifecycle requires exactly six states: **Draft**, **Active**, **Superseded**, **Deprecated**, **Archived**, and **Tombstoned**. This model synthesizes the narrower vocabularies found across existing tools and standards into a unified state machine suitable for a knowledge base managing both documents and code artifacts.

The ADR ecosystem provides the strongest precedent for lifecycle state design. [MADR 4.0](https://adr.github.io/madr/) (Markdown Any Decision Records, released September 2024) defines its status field as a YAML frontmatter value accepting `proposed`, `rejected`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`. The ellipsis in MADR's template (`{proposed | rejected | accepted | deprecated | … | superseded by ADR-0123}`) signals intentional extensibility—teams are expected to adapt. [Log4brains](https://github.com/thomvaill/log4brains), the TypeScript ADR management tool that uses MADR as its default template, adds a **`draft`** status to enable collaborative writing before a decision is reached. The [log4brains fork of MADR](https://github.com/thomvaill/log4brains/blob/master/docs/adr/20200924-use-markdown-architectural-decision-records.md) also changes filename format from sequential numbering (`NNNN-title.md`) to datestamp-based (`YYYYMMDD-title.md`) to avoid merge conflicts—a practical insight for any knowledge base.

The [AWS Prescriptive Guidance on ADRs](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html) provides the closest thing to a formal process definition in the ecosystem, documenting a flowchart where **Proposed → Accepted** (via team review), **Proposed → Rejected** (with documented reason), and **Accepted → Superseded** (when a new ADR replaces it). AWS emphasizes immutability: "When the team accepts an ADR, it becomes immutable. If new insights require a different decision, the team proposes a new ADR."

Beyond ADRs, formal standards define similar but domain-specific lifecycle stages. [ISO 15489-1:2016](https://www.iso.org/standard/62542.html), the primary international standard for records management, defines five stages: **Creation, Use, Maintenance, Retention, and Disposition**. [OASIS DITA](https://www.oxygenxml.com/dita/styleguide/Metadata_Conditional/c_The_status_attribute.html) takes a narrower approach, with its `@status` attribute limited to `new`, `changed`, `deleted`, and `unchanged`—tracking content deltas rather than document-level lifecycle. The GoF [State design pattern](https://refactoring.guru/design-patterns/state) literature consistently recommends **Draft → Under Review → Published → Archived → Deleted** as the canonical document workflow, with a recommended limit of 7–9 states per machine.

Synthesizing these sources, the recommended state machine is:

```
Draft ──→ Active ──→ Superseded ──→ Archived ──→ Tombstoned
              │                          ↑
              └──→ Deprecated ───────────┘
```

**Draft** represents work-in-progress content not yet ready for consumption. **Active** is the primary operational state—content is current, indexed, and authoritative. **Superseded** indicates replacement by a newer artifact, with a mandatory forward pointer. **Deprecated** indicates the artifact is no longer recommended but has no direct replacement. **Archived** removes content from active retrieval while preserving it for reference. **Tombstoned** is the terminal state: the artifact's content is removed, but a stub record remains to prevent dangling references—directly analogous to [HTTP 410 Gone](https://datatracker.ietf.org/doc/html/rfc9110), which per RFC 9110 §15.5.11 "indicates that access to the target resource is no longer available at the origin server and that this condition is likely to be permanent."

Forbidden transitions enforce lifecycle integrity. Active content cannot jump directly to Tombstoned without passing through Archived. Tombstoned content cannot be restored (create a new artifact instead). Superseded content cannot revert to Active—if the superseding artifact is itself deprecated, the original remains Superseded with an updated note. These constraints prevent the "zombie document" problem where supposedly-dead content silently returns to active circulation.

---

## How SUPERSEDED_BY edges form a directed acyclic graph

Supersession is the most structurally complex lifecycle transition because it creates relationships between artifacts. The critical design question is whether `SUPERSEDED_BY` pointers form a simple linked list (each artifact has at most one successor) or a more complex graph.

**In practice, supersession forms a DAG (Directed Acyclic Graph), not a linked list.** The evidence comes directly from tooling behavior. [adr-tools](https://github.com/npryce/adr-tools) (5,200+ GitHub stars), the original ADR management tool by Nat Pryce, supports superseding multiple ADRs simultaneously via repeated `-s` flags: `adr new -s 3 -s 4 "Use Riak CRDTs to cope with scale"`. The tool's [`adr generate graph`](https://github.com/npryce/adr-tools/blob/master/tests/generate-graph.expected) command produces a Graphviz digraph that visualizes both chronological ordering (dotted edges) and supersession relationships (labeled "Supercedes" edges), demonstrating fan-in where a single new ADR supersedes multiple predecessors.

When adr-tools processes the `-s` flag, it performs three atomic operations on the filesystem. On the **old ADR**: it appends `Superseded by [N. Title](NNNN-slug.md)` to the Status section and removes the "Accepted" status line via [`_adr_remove_status`](https://github.com/npryce/adr-tools/blob/master/src/adr-new). On the **new ADR**: it appends `Supersedes [N. Title](NNNN-slug.md)` to its Status section. The new ADR's status defaults to "Accepted." This creates bidirectional Markdown links—the forward edge (`Supersedes`) on the new ADR and the backward edge (`Superseded by`) on the old one—forming a navigable graph.

MADR takes a simpler approach. Its status field is a single string (`superseded by ADR-0005`), which constrains each artifact to reference **one** successor. However, because multiple old ADRs can each point to the same new ADR, fan-in still occurs naturally. In [MADR 4.0](https://github.com/adr/madr/releases), the format was simplified to use just identifiers (`superseded by ADR-0123`) rather than full Markdown links, reducing coupling between the status field and the file system path.

The practical recommendation for a knowledge base is to model supersession as a DAG with the following properties: each artifact stores a `superseded_by` field (nullable, single reference for simplicity—matching MADR convention), and the superseding artifact stores a `supersedes` array (supporting fan-in, matching adr-tools capability). Dublin Core's [`dcterms:isReplacedBy`](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/) and `dcterms:replaces` predicates provide the formal vocabulary for these edges, with the semantic that `isReplacedBy` is the forward pointer and `replaces` is the backward pointer.

Traversal of supersession chains should follow forward pointers to find the current authoritative version: given ADR-001 → superseded by ADR-005 → superseded by ADR-012, a query for ADR-001 should resolve to ADR-012 as the active head. This requires cycle detection (enforcing acyclicity) and a maximum chain depth to prevent pathological traversals.

---

## Retrieval semantics across lifecycle states

The most consequential design decision in lifecycle management is how state affects retrieval. Should deprecated documents appear in search results? Should archived content be discoverable at all? Production systems take strikingly different approaches, and the variance reveals genuine design tradeoffs rather than arbitrary choices.

**Confluence** implements the most aggressive exclusion model. When a page is [archived in Confluence Cloud](https://support.atlassian.com/confluence-cloud/docs/archive-pages/), it is removed from the content tree, **excluded from both quick search and advanced search**, and rendered read-only with a banner identifying it as archived. Smart links to archived pages display an ["Archived" lozenge](https://www.atlassian.com/blog/confluence/introducing-page-and-bulk-archiving-in-confluence-cloud) next to the link text. Critically, there is currently **no built-in way to search archived pages** in Confluence Cloud—users can only browse an archived content list or use browser find. This is a hard archive: content exists but is effectively invisible to discovery. [Space-level archiving in Confluence Data Center](https://confluence.atlassian.com/doc/archive-a-space-284368719.html) is slightly more permissive, offering a "Search archived spaces" checkbox—but page-level archiving has no equivalent toggle.

**SharePoint** takes a graduated approach through [Microsoft 365 Archive](https://learn.microsoft.com/en-us/microsoft-365/archive/archive-overview). Archived sites move to cold storage and become inaccessible to end users until an admin reactivates them. However, SharePoint's [search integration](https://learn.microsoft.com/en-us/microsoft-365/archive/search/m365-archive-search-overview) provides an **"Archived" pill filter** that lets users explicitly opt in to searching archived content. Compliance tools (eDiscovery, retention labels) continue to index archived content regardless. A particularly telling detail: **Microsoft Copilot is explicitly excluded from training on archived content**, treating archive state as a signal that content should not inform AI responses.

**MediaWiki** represents the opposite extreme. Wikipedia's lifecycle management relies entirely on [template-based warning banners](https://en.wikipedia.org/wiki/Template:Historical)—`{{Historical}}`, `{{Superseded}}`, `{{Deprecated template}}`, `{{Outdated}}`—that categorize pages and display visual warnings but have **zero impact on search ranking**. MediaWiki's CirrusSearch does not demote pages based on template presence. A page marked `{{Historical}}` ranks identically to an active page. The rationale is editorial: even outdated content has historical and contextual value. The [categorization system](https://en.wikipedia.org/wiki/Category:Deprecated_templates) provides structured discovery of deprecated content, but only for editors who know to look.

**Notion** lacks a formal archive feature entirely. [Deleting a page](https://www.notion.com/help/duplicate-delete-and-restore-content) moves it to Trash, where it remains for 30 days. The [Notion API](https://developers.notion.com/reference/archive-a-page) treats `archived: true` and `in_trash: true` as equivalent operations. Common workarounds include creating a dedicated "Archive" page as a container (content remains fully searchable) or using database properties with filtered views to hide archived items from default views while preserving them in an "All Items" view.

These production behaviors map onto a graduated model that the knowledge base should implement:

- **Active**: fully indexed, appears in all search results, no banners
- **Deprecated/Superseded**: fully indexed but displayed with a **warning banner** and a forward pointer to the replacement (if superseded). Search results include a visual indicator (badge, lozenge) distinguishing these from active results. This mirrors the MediaWiki approach of preserving discoverability while signaling caution.
- **Archived (soft)**: **excluded from default search** but discoverable via an explicit "include archived" toggle, following the SharePoint model. Direct URLs still resolve. A prominent banner explains the archived status and links to any replacement.
- **Tombstoned (hard)**: content is removed. The URL returns a stub page with metadata (title, dates, reason for removal, forward pointer if applicable), analogous to HTTP 410 Gone. Excluded from all search indexes. This mirrors the [tombstone pattern in distributed databases](https://en.wikipedia.org/wiki/Tombstone_(data_store)) where "a tombstone is a deleted record... instead of deleting the information, the distributed data store creates a (usually temporary) tombstone record, which is not returned in response to requests."

The warning banner pattern deserves specific attention. [Confluence uses an amber banner](https://support.atlassian.com/confluence-cloud/docs/archive-pages/) at the top of archived pages with a restore option. Wikipedia uses [template-generated message boxes](https://en.wikipedia.org/wiki/Template:Historical) (ambox style) with distinct icons—red X for Historical/Superseded, warning triangle for Outdated. The recommended pattern for a knowledge base combines both: a persistent, non-dismissible banner at the top of deprecated/superseded content that includes the artifact's current state, the date of the state transition, the reason (if documented), and a link to the replacement artifact (if superseded).

---

## Inferring lifecycle state automatically through multi-signal analysis

Manual lifecycle management does not scale. Engineers forget to mark documents as deprecated, and status fields drift from reality. A production knowledge base needs automated staleness detection that combines multiple signals into a composite freshness assessment.

**Git commit frequency is the strongest automated signal.** The command `git log -1 --format="%ct" -- <filepath>` retrieves the Unix timestamp of the last commit touching any file, enabling straightforward age calculations. This can be wrapped in a CI job that scans all documentation files and flags those exceeding a threshold. Common thresholds from the tooling ecosystem: [GitHub's `actions/stale`](https://github.com/actions/stale) defaults to **60 days** for issue/PR staleness, the [`crs-k/stale-branches`](https://github.com/marketplace/actions/stale-branches) GitHub Action supports configurable `days-before-stale` thresholds, and the [`aws-actions/stale-issue-cleanup`](https://github.com/aws-actions/stale-issue-cleanup) action defines **365 days** as the "ancient" threshold. For documentation specifically, a reasonable graduated scale is: **≤90 days** (current), **91–180 days** (needs review), **181–365 days** (stale), **>365 days** (candidate for deprecation or archival).

**YAML frontmatter provides the explicit declaration channel.** Static site generators already standardize on frontmatter for lifecycle metadata. [Hugo](https://gohugo.io/content-management/front-matter/) natively supports `draft: true/false`, `expiryDate` (content automatically stops rendering after this date), and `publishDate`. [Backstage](https://backstage.io/docs/features/software-catalog/descriptor-format/) (Spotify's developer portal) defines the most mature lifecycle taxonomy: its `catalog-info.yaml` files accept `spec.lifecycle` values of **`experimental`**, **`production`**, or **`deprecated`** for every software entity. This vocabulary maps directly onto the early, middle, and late lifecycle states and should serve as the baseline for frontmatter status fields in a knowledge base.

A recommended frontmatter schema:

```yaml
---
status: active          # draft | active | deprecated | archived
last_reviewed: 2025-09-15
review_cycle_days: 180
owner: platform-team
superseded_by: null     # ADR identifier if superseded
expires: null           # optional hard expiry date
---
```

**CI/CD linting catches staleness signals that neither git age nor frontmatter capture.** [Vale](https://vale.sh/docs), the leading open-source prose linter used by [GitLab](https://docs.gitlab.com/development/documentation/testing/vale/), [Datadog](https://www.datadoghq.com/blog/engineering/how-we-use-vale-to-improve-our-documentation-editing-process/), and [Grafana](https://grafana.com/docs/writers-toolkit/review/lint-prose/), can be configured with custom YAML rules to flag **temporal language** ("recently," "currently," "soon," "as of Q3") that indicates content destined to become stale. [Doc Detective](https://www.docsastests.com/), an open-source documentation testing framework, goes further by parsing procedures described in Markdown and automatically executing them against the actual product to detect functional drift—Kong's documentation team reported their AI chatbot accuracy improved from **84% to 91%** after adopting testable documentation.

**Link rot provides a reliable proxy signal for document decay.** [Linkinator](https://github.com/JustinBeckwith/linkinator), a Node.js link checker available as a [GitHub Action](https://github.com/JustinBeckwith/linkinator-action), validates both internal and external links in Markdown files with fragment checking, retry logic, and JSON output for programmatic use. A [2023 study in Empirical Software Engineering](https://link.springer.com/article/10.1007/s10664-023-10397-6) analyzing 3,000+ GitHub projects found most contain at least one outdated code element reference in documentation, recommending automated detection via CI pipelines.

**The MCP (Model Context Protocol) provides a protocol-native annotation layer for AI-assisted lifecycle management.** The [MCP specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) defines resource annotations including `lastModified` (ISO 8601 timestamp) and `priority` (0.0–1.0 float), enabling an MCP server to expose knowledge base documents with machine-readable freshness metadata. An MCP tool could query git history, parse frontmatter, run link checks, and synthesize all signals into a lifecycle state recommendation—bridging the gap between automated detection and explicit annotation.

The recommended composite freshness scoring weights these signals:

- **Git last-modified age**: 40% weight (strongest automated signal)
- **Broken outbound link ratio**: 25% weight (strong decay proxy)
- **Frontmatter status and review date**: 20% weight (explicit declaration)
- **Code reference validity**: 15% weight (functional accuracy)

A score below a configurable threshold triggers automated state transitions: generating a PR that updates the frontmatter status from `active` to `stale`, notifying the document owner, and—if no action is taken within a grace period—transitioning to `deprecated`.

---

## Soft-delete patterns that underpin the Tombstoned state

The Tombstoned state requires a storage-level implementation, and database soft-delete patterns provide the design vocabulary. Three primary approaches exist, each with distinct tradeoffs.

The **`deleted_at` timestamp** pattern is the dominant ORM approach. [Laravel's `SoftDeletes` trait](https://laravel.com/docs/5.0/eloquent) adds a nullable `deleted_at` column and automatically applies a global scope `WHERE deleted_at IS NULL` to all queries. It provides `withTrashed()` and `onlyTrashed()` query scopes for explicit access to soft-deleted records, plus a `Prunable` trait for automatic hard-deletion after a configurable retention period. Ruby on Rails' [Paranoia gem](https://github.com/rubysherpas/paranoia) follows the same pattern with `acts_as_paranoid`, though its successor [Discard](https://entrision.com/blog/comparing-paranoia-vs-discard/) deliberately avoids default scopes to prevent the hidden-query-filter problem.

The **status enum** pattern offers the most expressiveness for document lifecycle specifically. A `status` column with values like `active`, `archived`, `deprecated`, `tombstoned` maps directly onto the lifecycle states defined above, supporting queries by state (`WHERE status = 'active'`) without the semantic ambiguity of null-checking. This approach naturally extends to the full lifecycle state machine rather than the binary alive/dead distinction of `deleted_at`.

The key architectural criticism of all soft-delete approaches, [articulated by Cultured Systems](https://www.cultured.systems/2024/04/24/Soft-delete/), is that "you're systematically misleading the database"—foreign keys, uniqueness constraints, and NOT NULL constraints all assume rows represent live entities, and soft-deletion silently violates these assumptions. For a knowledge base, the mitigation is to use the status enum at the application layer (where lifecycle semantics are understood) rather than leaking lifecycle state into database-level constraints.

In distributed systems, [Apache Cassandra's tombstone mechanism](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/tombstones.html) provides a more principled approach: deletion writes a tombstone marker with a `gc_grace_seconds` TTL (default **864,000 seconds / 10 days**), after which compaction permanently removes the data. This TTL-based approach—write a tombstone, retain it for a grace period, then hard-delete—maps well onto the Archived → Tombstoned → purged lifecycle for knowledge base artifacts.

---

## Putting the model together

The lifecycle state machine defined here draws on MADR's extensible status vocabulary, adr-tools' bidirectional supersession links, Confluence's aggressive search exclusion for archived content, MediaWiki's warning-banner approach for deprecated content, and Backstage's three-value lifecycle taxonomy. The automated inference layer combines git-based age detection, frontmatter parsing, CI/CD linting, and link rot analysis into a composite freshness score that drives state transitions.

The critical insight is that **lifecycle state is not merely metadata—it is a retrieval directive**. Each state defines not just what the artifact *is* but how the system should *behave* when someone encounters it. Active content is served normally. Deprecated content is served with warnings. Archived content requires explicit intent to discover. Tombstoned content returns a stub. This behavior-centric framing, grounded in the precedent of HTTP status codes (200 OK → 301 Moved → 410 Gone), transforms lifecycle management from a documentation hygiene exercise into a core retrieval system feature.

---

## Version history

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-03-11 | DM-06 Analysis | Initial draft: lifecycle states, retrieval semantics, inference |

---

## Bibliography

| # | Source | URL | Key contribution |
|---|--------|-----|-----------------|
| 1 | MADR Official Documentation (v4.0) | https://adr.github.io/madr/ | Status field specification: proposed, rejected, accepted, deprecated, superseded by |
| 2 | adr-tools (Nat Pryce) | https://github.com/npryce/adr-tools | Supersession mechanics, `-s` flag, bidirectional Markdown links, Graphviz DAG generation |
| 3 | log4brains | https://github.com/thomvaill/log4brains | Draft status addition to MADR, datestamp-based filenames, ADR immutability principle |
| 4 | AWS Prescriptive Guidance: ADRs | https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html | Formal ADR process flowchart: Proposed → Accepted → Superseded |
| 5 | Confluence Cloud: Archive Pages | https://support.atlassian.com/confluence-cloud/docs/archive-pages/ | Archival behavior: search exclusion, banner display, read-only state |
| 6 | Atlassian Blog: Page and Bulk Archiving | https://www.atlassian.com/blog/confluence/introducing-page-and-bulk-archiving-in-confluence-cloud | Archived lozenge on smart links, disabled actions list |
| 7 | Confluence Data Center: Archive a Space | https://confluence.atlassian.com/doc/archive-a-space-284368719.html | Space-level archiving with optional search inclusion |
| 8 | Microsoft 365 Archive Overview | https://learn.microsoft.com/en-us/microsoft-365/archive/archive-overview | Cold storage archival, Copilot exclusion, compliance continuity |
| 9 | SharePoint: Searching Archived Content | https://learn.microsoft.com/en-us/microsoft-365/archive/search/m365-archive-search-overview | "Archived" pill filter for opt-in search of archived content |
| 10 | Wikipedia: Template:Historical | https://en.wikipedia.org/wiki/Template:Historical | Warning banner pattern for deprecated wiki pages, no search ranking impact |
| 11 | Wikipedia: Template:Superseded | https://en.wikipedia.org/wiki/Template:Superseded | Supersession banner with forward link to replacement page |
| 12 | Notion Help: Delete & Restore Content | https://www.notion.com/help/duplicate-delete-and-restore-content | 30-day trash retention, no formal archive feature |
| 13 | Notion API: Archive/Trash a Page | https://developers.notion.com/reference/archive-a-page | `archived` and `in_trash` boolean equivalence |
| 14 | Dublin Core Metadata Terms | https://www.dublincore.org/specifications/dublin-core/dcmi-terms/ | `dcterms:isReplacedBy` and `dcterms:replaces` for supersession vocabulary |
| 15 | OASIS DITA: Status Attribute | https://www.oxygenxml.com/dita/styleguide/Metadata_Conditional/c_The_status_attribute.html | `@status` values: new, changed, deleted, unchanged |
| 16 | ISO 15489-1:2016 | https://www.iso.org/standard/62542.html | Records lifecycle: Creation, Use, Maintenance, Retention, Disposition |
| 17 | RFC 9110: HTTP Semantics | https://datatracker.ietf.org/doc/html/rfc9110 | 410 Gone: permanent intentional resource removal semantics |
| 18 | Wikipedia: Tombstone (data store) | https://en.wikipedia.org/wiki/Tombstone_(data_store) | Distributed systems tombstone definition and purpose |
| 19 | Cassandra Tombstones Documentation | https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/tombstones.html | `gc_grace_seconds` TTL for tombstone retention |
| 20 | Laravel SoftDeletes Documentation | https://laravel.com/docs/5.0/eloquent | `deleted_at` pattern, `withTrashed()`, `Prunable` trait |
| 21 | Paranoia Gem (Ruby on Rails) | https://github.com/rubysherpas/paranoia | `acts_as_paranoid`, recursive soft-delete, `really_destroy!` |
| 22 | Cultured Systems: Soft Delete Anti-Pattern | https://www.cultured.systems/2024/04/24/Soft-delete/ | Critique: soft deletion misleads database constraint systems |
| 23 | Refactoring.Guru: State Pattern | https://refactoring.guru/design-patterns/state | GoF State pattern applied to document workflow FSMs |
| 24 | GitHub Actions: actions/stale | https://github.com/actions/stale | 60-day default staleness threshold for issues/PRs |
| 25 | Hugo: Front Matter Documentation | https://gohugo.io/content-management/front-matter/ | `expiryDate` for automatic content lifecycle expiration |
| 26 | Backstage: Descriptor Format | https://backstage.io/docs/features/software-catalog/descriptor-format/ | `spec.lifecycle`: experimental, production, deprecated |
| 27 | Vale Linter | https://vale.sh/docs | Custom prose linting rules for temporal language detection |
| 28 | Datadog: Vale for Documentation | https://www.datadoghq.com/blog/engineering/how-we-use-vale-to-improve-our-documentation-editing-process/ | Flagging temporal words that indicate future staleness |
| 29 | Doc Detective | https://www.docsastests.com/ | Functional documentation testing, 84%→91% chatbot accuracy improvement |
| 30 | Linkinator GitHub Action | https://github.com/JustinBeckwith/linkinator-action | Broken link detection in Markdown with fragment checking |
| 31 | Empirical Software Engineering (2023) | https://link.springer.com/article/10.1007/s10664-023-10397-6 | 3,000+ project study: outdated code references persist in documentation |
| 32 | MCP Specification: Tool Annotations | https://modelcontextprotocol.io/specification/2025-06-18/server/tools | Resource annotations: `lastModified`, `priority` for freshness metadata |
| 33 | MADR GitHub Releases | https://github.com/adr/madr/releases | v4.0 change: identifier-only supersession references |
| 34 | Ozimmer MADR Primer | https://www.ozimmer.ch/practices/2022/11/22/MADRTemplatePrimer.html | MADR metadata elements confirmation and design rationale |
| 35 | SharePoint Retention Policies | https://learn.microsoft.com/en-us/purview/retention-policies-sharepoint | Preservation Hold Library, auto-applied retention labels |
| 36 | Brandur: Soft Deletion | https://brandur.org/soft-deletion | `deleted_at` as dominant ORM pattern, tradeoff analysis |
| 37 | James Tharpe: Tombstone Pattern | https://www.jamestharpe.com/tombstone-pattern/ | Separate tombstone table pattern for immutable deletion records |