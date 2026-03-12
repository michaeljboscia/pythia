# Canonical Docs Consistency Review

Scope reviewed:
- `/Users/mikeboscia/pythia/docs/PRD.md`
- `/Users/mikeboscia/pythia/docs/APP_FLOW.md`
- `/Users/mikeboscia/pythia/docs/TECH_STACK.md`
- `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE.md`
- `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md`
- `/Users/mikeboscia/pythia/CLAUDE.md`
- `/Users/mikeboscia/pythia/progress.txt`
- `/Users/mikeboscia/pythia/LESSONS.md`
- `/Users/mikeboscia/pythia/tasks/todo.md`
- design baseline: `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md`

---

## Findings

### [CRITICAL] Reconstitute checkpoint-failure behavior is contradictory across canonical docs
- `PRD.md` says checkpoint failure during `oracle_reconstitute(checkpoint_first: true)` is a hard abort.
  - Evidence: `/Users/mikeboscia/pythia/docs/PRD.md:274`
- `IMPLEMENTATION_PLAN.md` says checkpoint failure logs warning and continues best-effort.
  - Evidence: `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md:606`
- `APP_FLOW.md` error table implies failure path (`CHECKPOINT_FAILED`) and retry/salvage flow.
  - Evidence: `/Users/mikeboscia/pythia/docs/APP_FLOW.md:614`
- Why this is critical: Implementers will build incompatible control flow for the same operation.
- Required fix: Choose one policy and align all three docs. Recommended: hard-fail when `checkpoint_first: true` (more conservative, matches PRD).

### [CRITICAL] Reconstitute drain-timeout semantics conflict
- `APP_FLOW.md` says drain has bounded timeout and then force-proceeds with full cutover.
  - Evidence: `/Users/mikeboscia/pythia/docs/APP_FLOW.md:546`
- `IMPLEMENTATION_PLAN.md` says drain timeout returns `RECONSTITUTE_FAILED` and exits.
  - Evidence: `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md:602`
- Why this is critical: This changes safety guarantees and user-visible failure behavior under contention.
- Required fix: Define one deterministic rule for timeout: fail-fast or force-cutover. Then update both docs.

### [CRITICAL] Checkpoint tag extraction behavior conflict (`<checkpoint>` missing)
- `APP_FLOW.md` says missing tags => `CHECKPOINT_FAILED`.
  - Evidence: `/Users/mikeboscia/pythia/docs/APP_FLOW.md:487`, `/Users/mikeboscia/pythia/docs/APP_FLOW.md:525`
- `IMPLEMENTATION_PLAN.md` says fallback to full response with warning.
  - Evidence: `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md:569`
- Why this is critical: Produces incompatible parser contracts and downstream checkpoint quality expectations.
- Required fix: Pick one extraction contract and enforce it everywhere (strict XML-tag contract is safer for deterministic parsing).

### [WARNING] MCP entrypoint target mismatched with design baseline
- Design spec says modify `src/index.ts` for tool registration.
  - Evidence: `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md:1453`
- `IMPLEMENTATION_PLAN.md` targets `src/gemini/server.ts` repeatedly.
  - Evidence: `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md:21`, `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md:281`, `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md:1253`
- `TECH_STACK.md` is ambiguous (`server.ts or index.ts`).
  - Evidence: `/Users/mikeboscia/pythia/docs/TECH_STACK.md:129`
- Impact: High chance of wiring tools in the wrong process entrypoint.
- Required fix: Resolve actual current MCP bootstrap path and make all docs point to one file.

### [WARNING] Legacy `oracle_decommission` naming still appears where split tools are intended
- Split tools are documented (`request/execute/cancel`), but umbrella name remains in normative guidance/comments.
  - Evidence:
    - `/Users/mikeboscia/pythia/docs/PRD.md:88`, `/Users/mikeboscia/pythia/docs/PRD.md:615`
    - `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE.md:616`, `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE.md:764`, `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE.md:1483`
    - `/Users/mikeboscia/pythia/docs/IMPLEMENTATION_PLAN.md:300`
- Impact: Medium ambiguity in tool-call guidance and code comments.
- Required fix: Replace umbrella references with explicit tool names (or clearly mark `oracle_decommission` as conceptual umbrella only).

### [WARNING] FEAT-ID traceability is incomplete in `BACKEND_STRUCTURE.md`
- `PRD.md`, `APP_FLOW.md`, and `IMPLEMENTATION_PLAN.md` include FEAT-001..FEAT-035.
- `BACKEND_STRUCTURE.md` only uses FEAT-001..FEAT-013 tags (no FEAT-014..FEAT-035 tags).
- Impact: Reduces bidirectional traceability for slash commands/hooks/decommission-hardening features in backend schema/contract docs.
- Required fix: Either:
  - add explicit FEAT tags for relevant 014..035 behaviors already present, or
  - document that `BACKEND_STRUCTURE.md` intentionally scope-limits FEAT tagging to core MCP tool surface.

### [WARNING] Design baseline itself contains dual OracleErrorCode definitions (stale + current)
- Older shorter error union exists earlier in design doc.
  - Evidence: `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md:756`
- Current 25-code union exists later and matches canonical docs.
  - Evidence: `/Users/mikeboscia/pythia/design/pythia-persistent-oracle-design.md:1385`, `/Users/mikeboscia/pythia/docs/BACKEND_STRUCTURE.md:694`
- Impact: Readers may bind to stale list and implement wrong error surface.
- Required fix: Remove or mark earlier legacy block as superseded.

### [MINOR] Progress trackers are stale relative to current repo state
- `progress.txt` still says docs generation in progress and reports old design line count.
  - Evidence: `/Users/mikeboscia/pythia/progress.txt:11`, `/Users/mikeboscia/pythia/progress.txt:16`
- `tasks/todo.md` still keeps canonical-doc generation checklist as in-progress/unchecked.
  - Evidence: `/Users/mikeboscia/pythia/tasks/todo.md` (canonical docs checklist section)
- Impact: Low technical risk, but creates status confusion.
- Required fix: Reconcile tracker files with completed canonical suite.

---

## Targeted Checks Summary

### FEAT-ID Consistency (001-035)
- Full FEAT-001..FEAT-035 coverage present in:
  - `PRD.md`
  - `APP_FLOW.md`
  - `IMPLEMENTATION_PLAN.md`
- `BACKEND_STRUCTURE.md` FEAT tags stop at FEAT-013.
- No direct FEAT number re-assignment conflicts found (same FEAT numbers map to same feature names where present).

### Design Doc Fidelity
- Good alignment on new Round-3 architectural updates in canonical docs:
  - Spawn-on-demand pool semantics
  - MAX pressure aggregation + SUM observability (`estimated_cluster_tokens`)
  - `DaemonPoolMember` extended fields (`last_query_at`, `idle_timeout_ms`, `last_corpus_sync_hash`, `pending_syncs`, status includes `dead`)
  - `.pythia-active/` directory model
  - `hash_gated_delta` naming
- But critical behavioral conflicts remain (reconstitute/checkpoint semantics above).

### Cross-Reference Integrity
- Most path references resolve.
- Main issues are semantic drift/ambiguity, not broken file links.

### Completeness vs Design
- Core types, 25-error-code surface, and major spawn-on-demand/cutover constructs are represented.
- Primary completeness risk is behavior-spec inconsistency, not missing primitives.
