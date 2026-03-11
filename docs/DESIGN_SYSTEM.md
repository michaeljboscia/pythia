# DESIGN SYSTEM — Pythia v1 (Vault / Obsidian Layer)
**Version:** 1.0
**Spec Reference:** `/Users/mikeboscia/pythia/design/pythia-lcs-spec.md` §8, §14, §17
**Date:** 2026-03-11

---

## Scope

Pythia has no browser UI. The "UI" is Obsidian — a passive glass layer that reads MADR markdown files written by the MCP server. This document defines every convention that controls how those files look in Obsidian: frontmatter schema, folder hierarchy, file naming, tag taxonomy, link syntax, and Dataview dashboard structure.

**Design invariant:** Pythia writes to Obsidian. Pythia never reads Obsidian's proprietary structures. `.obsidian/` is a detection marker only — never a write target.

---

## Vault Structure

```
<repo>/Pythia/           ← Written by Pythia
├── MADR-001-initial-architecture-decision.md
├── MADR-002-database-schema-selection.md
├── MADR-003-embedding-model-rationale.md
└── ...
```

**Vault root detection:** Directory containing `.obsidian/`. Configurable via `obsidian_vault_path` in `~/.pythia/config.json`.
**Write target:** `<vault_root>/Pythia/` subdirectory.
**Never written to:** `.obsidian/`, vault root (direct), any other vault directory.

---

## File Naming Convention

**Pattern:** `MADR-{seq}-{slug}.md`

| Component | Rules |
|---|---|
| `{seq}` | Zero-padded 3-digit integer from `seq` column (e.g., `001`, `012`, `100`) |
| `{slug}` | Lowercase ASCII, Unicode-normalized, non-alphanumeric runs collapsed to `-`, max 64 chars |
| Empty title | `untitled` slug |

**Examples:**
```
MADR-001-initial-architecture-decision.md
MADR-012-auth-middleware-strategy.md
MADR-100-replace-ollama-with-gemini-sdk.md
MADR-045-untitled.md   ← empty title edge case
```

**Collision:** Impossible. MADR sequence number is the uniqueness key (AUTOINCREMENT).

---

## YAML Frontmatter Schema

All frontmatter fields map 1:1 to `pythia_memories` table columns. Required for Dataview plugin compatibility.

```yaml
---
madr_id: MADR-012
title: Authentication Middleware Strategy
status: accepted
timestamp: 2026-03-11T02:15:00Z
generation_id: 1
context_and_problem: |
  We needed a stateless authentication mechanism that scales across
  multiple server instances without shared session storage.
decision_drivers:
  - Must support horizontal scaling
  - Must not require Redis or external session store
  - Must work with existing OAuth2 identity provider
considered_options:
  - JWT with short TTL + refresh token rotation
  - Server-side sessions (PostgreSQL-backed)
  - Cookie-based sessions with sticky routing
decision_outcome: |
  JWT with short TTL (15 minutes) + refresh token rotation.
  Refresh tokens stored in httpOnly cookies, rotated on every use.
supersedes_madr:         # null or MADR-xxx string
---
```

**Field definitions:**
| Field | Type | Required | Maps to |
|---|---|---|---|
| `madr_id` | string | yes | `pythia_memories.id` |
| `title` | string | yes | `pythia_memories.title` |
| `status` | `accepted` \| `superseded` | yes | `pythia_memories.status` |
| `timestamp` | ISO8601 string | yes | `pythia_memories.timestamp` |
| `generation_id` | integer | yes | `pythia_memories.generation_id` |
| `context_and_problem` | multiline string | yes | `pythia_memories.context_and_problem` |
| `decision_drivers` | list of strings | yes | `pythia_memories.decision_drivers` (JSON array) |
| `considered_options` | list of strings | yes | `pythia_memories.considered_options` (JSON array) |
| `decision_outcome` | multiline string | yes | `pythia_memories.decision_outcome` |
| `supersedes_madr` | string or null | no | `pythia_memories.supersedes_madr` |

---

## Document Body Structure

After YAML frontmatter, every MADR follows this exact structure:

```markdown
---
[frontmatter]
---

# MADR-012 — Authentication Middleware Strategy

## Context and Problem

[context_and_problem text — verbatim from input]

## Decision Drivers

- [driver 1]
- [driver 2]
- [driver 3]

## Considered Options

- [option 1]
- [option 2]
- [option 3]

## Decision Outcome

[decision_outcome text — verbatim from input]

---

*Committed by Pythia oracle session. Generation: 1*
*Files affected: [[src/auth.ts]], [[src/middleware/jwt.ts]]*
```

**`[[wikilinks]]` for affected files:** Each file in `impacts_files` is rendered as an Obsidian wikilink using the repo-relative path. This enables Obsidian's graph view to show connections between MADRs and source files.

**Supersedes notice (when applicable):**
```markdown
> ⚠️ This decision supersedes [[MADR-007-session-cookie-strategy]]
```

---

## Tag Taxonomy

Tags applied in frontmatter (optional, but recommended for Dataview filtering):

```yaml
tags:
  - pythia/madr
  - pythia/generation-1
  - pythia/accepted         # or pythia/superseded
```

**Tag namespace:** All Pythia tags prefixed with `pythia/` to avoid collision with user tags.
**Generation tag:** `pythia/generation-{N}` for filtering MADRs by oracle generation.

---

## Wikilink Conventions

**MADR-to-MADR links (supersedes chain):**
```
[[MADR-007-session-cookie-strategy]]
```

**MADR-to-file links (IMPLEMENTS edges):**
```
[[src/auth.ts]]
[[src/middleware/jwt.ts]]
```

**File resolution:** Obsidian resolves wikilinks by filename match within the vault. The file wikilinks use repo-relative paths (not full absolute paths) to match how Obsidian resolves vault-relative links.

---

## Obsidian Graph View Expectations

When the vault is properly configured, Obsidian's graph view shows:
- Each MADR as a node
- MADR-to-MADR connections via `supersedes_madr` wikilinks
- MADR-to-file connections via `impacts_files` wikilinks
- Generation clusters (color-coded by `generation_id` if Obsidian themes support it)

This graph is read-only. Pythia never reads the graph state — it only writes to it.

---

## Dataview Dashboard (Recommended Setup)

Users can create a Dataview dashboard in their vault with:

```dataview
TABLE
  madr_id,
  title,
  status,
  timestamp,
  generation_id
FROM "Pythia"
WHERE status = "accepted"
SORT timestamp DESC
```

**Superseded decisions:**
```dataview
TABLE
  madr_id,
  title,
  supersedes_madr,
  timestamp
FROM "Pythia"
WHERE status = "superseded"
SORT timestamp DESC
```

Pythia does not create or manage the Dataview queries — the user sets these up once. Pythia only ensures the frontmatter is correct for Dataview to consume.

---

## Retry Queue File Format

`<repo>/.pythia/obsidian-retry-queue.json`

```json
{
  "jobs": [
    {
      "madr_id": "MADR-012",
      "filename": "MADR-012-auth-middleware-strategy.md",
      "content": "---\n[full markdown content]\n---\n...",
      "queued_at": "2026-03-11T02:15:00Z",
      "attempt_count": 2,
      "next_attempt_at": "2026-03-11T02:35:00Z"
    }
  ]
}
```

**Write safety:** Atomic replace: serialize → write to `.tmp` → `fsync` → rename over queue file.
**On corrupt JSON at startup:** Rename to `.corrupt`, initialize fresh empty queue.
**Max attempts:** 5. Backoff: 1m, 5m, 15m, 30m, 1h. Drop after 5th failure.

---

## Obsidian Availability States

| State | Trigger | MCP Response | Retry Queue |
|---|---|---|---|
| Not configured | No `obsidian_vault_path` + no `.obsidian/` found | `[METADATA: OBSIDIAN_DISABLED]` | No |
| Configured, accessible | Vault path resolves to writable directory | Write succeeds, no metadata | No |
| Configured, inaccessible | Path configured but directory missing/unwritable | `[METADATA: OBSIDIAN_UNAVAILABLE]` | Yes |

**Key distinction:** "Not configured" = silent disable. "Configured but unavailable" = retry queue. A configured vault path is a user commitment — transient failure routes to retry.
