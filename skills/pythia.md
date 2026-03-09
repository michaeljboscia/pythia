# /pythia — Pythia Oracle Engine Skill

> **Purpose:** Query and manage the persistent Gemini oracle daemon for the current project.
> Invoked via `/pythia [subcommand] [args]` in Claude Code.

---

## Oracle Name Auto-Detection

Before any subcommand, determine the active oracle:

1. Check for `<project_root>/.pythia-active/` directory. Each file in this directory
   is named `<oracle-name>.json` and contains `{ "oracle_dir": "..." }`.
2. If exactly one oracle found: use it (no `--name` needed).
3. If multiple found: require `--name <oracle>` from the user.
4. Fallback: scan `/Users/mikeboscia/pythia/registry.json` for oracles whose
   `project_root` is a prefix of the current working directory.
5. If still ambiguous or not found: prompt the user to run `spawn_oracle` first.

---

## Subcommands

### `/pythia` (no args) — Status Display (FEAT-031)

Show comprehensive oracle state. Execute:

```
oracle_pressure_check(name: <oracle>)
```

Display:
- Oracle name, version, status
- Pool members: daemon_id, query_count, chars_in, chars_out, idle time
- Pressure: tokens_remaining, total_tokens, headroom_pct, recommendation
- If `recommendation === "checkpoint_now"`: show warning "⚠️ Checkpoint recommended"
- Last checkpoint path (if any), corpus entry count

---

### `/pythia <query>` — Query Oracle (FEAT-025)

Full pipeline:

1. **Pressure check:** `oracle_pressure_check(name: <oracle>)`
   - If `recommendation === "checkpoint_now"`: run `/pythia checkpoint` first, then proceed
2. **Query:** Use `mcp__inter-agent-gemini__ask_daemon(daemon_id: <idle_pool_member_daemon_id>, question: <query>)`
   - Get an idle daemon_id from the pressure check response's pool members
   - If no idle daemon available, inform the user to wait or spawn
3. **Log learning:** `oracle_log_learning(name: <oracle>, interaction: { question: <query>, answer: <response>, source: "claude", commit: false })`
4. Display the oracle's response to the user

**After any Ion (Gemini/Codex sibling) delegation concludes:**
Always call `oracle_sync_corpus(name: <oracle>)` before the next oracle query to
pick up any corpus files the Ion may have modified.

---

### `/pythia sync [source_id]` — Sync Corpus (FEAT-026)

```
oracle_sync_corpus(name: <oracle> [, source_id: <source_id>])
```

Display: files synced count, bytes loaded, pool members updated, files skipped (unchanged).

---

### `/pythia checkpoint` — Force Checkpoint (FEAT-027)

```
oracle_checkpoint(name: <oracle>, commit: true)
```

Display: checkpoint path, size in bytes, sha256, version, query count captured.

---

### `/pythia reconstitute` — Start New Generation (FEAT-028)

```
oracle_reconstitute(name: <oracle>)
```

Display: old version → new version, new daemon info, corpus re-loaded.
Warn user: the old daemon is dismissed; queries will be slightly slower on first use.

---

### `/pythia salvage` — Salvage from Interactions (FEAT-029)

Use when no checkpoint exists but interactions are available:

```
oracle_salvage(name: <oracle>)
```

Display: checkpoint path created from JSONL synthesis, quality note.

---

### `/pythia add <filepath> [role]` — Add File to Corpus (FEAT-030)

```
oracle_add_to_corpus(
  name: <oracle>,
  file_path: <absolute_filepath>,
  role: <role>  // default: "other"
)
```

Valid roles: `specification`, `implementation`, `test`, `documentation`, `reference`, `other`

Display: sha256, file size, entry_id, role assigned.

---

### `/pythia status` — Full Status Report (FEAT-031)

Detailed view:

```
oracle_quality_report(name: <oracle>)
oracle_pressure_check(name: <oracle>)
```

Display all fields:
- Registry entry: name, project_root, corpus_path, created_at, generation
- State: version, status, query_count, chars_in, chars_out, last_checkpoint_at
- Pool members: each with daemon_id, status, query_count, last_query_at, idle seconds
- Quality: length_trend, code_symbol_density, degradation_onset, suggested_headroom
- Pressure: tokens_remaining, headroom_pct, recommendation

---

### `/pythia quality` — Quality Report (FEAT-032)

```
oracle_quality_report(name: <oracle>)
```

Display:
- Answer length trend: early half avg → late half avg (trend direction)
- Code symbol density: early half → late half (degradation signal)
- Degradation onset: interaction number where quality started declining (if detected)
- Suggested headroom: recommended tokens_remaining threshold for checkpointing
- Flags: any degradation flags triggered

---

### `/pythia decommission <oracle>` — Start Decommission

```
oracle_decommission_request(name: <oracle>, reason: <reason>)
```

Display the returned checklist to the user. The checklist contains:
- The decommission token (10-minute TTL)
- Step-by-step instructions including running `pythia-auth show <oracle>`
- The exact confirmation phrase required for `oracle_decommission_execute`

**Do NOT call `oracle_decommission_execute` automatically.** The user must:
1. Run `pythia-auth show <oracle>` in their terminal to get the TOTP code
2. Confirm the phrase manually
3. Execute `oracle_decommission_execute` with the token, TOTP code, and phrase

---

## Conventions

### Pressure Check on Every Query
Always run `oracle_pressure_check` before any oracle query. Never skip this.
The pressure check ensures we checkpoint before the context window fills.

### Ion Delegation Sync Rule
After any work is delegated to a sibling agent (Gemini daemon, Codex):
- If the sibling may have modified files in the oracle's `corpus_path`
- Call `oracle_sync_corpus` before the next oracle query
- This picks up any new or updated files the sibling wrote

### Error Handling
- `ORACLE_NOT_FOUND`: oracle not spawned yet → tell user to run `spawn_oracle`
- `DAEMON_BUSY_LOCK`: another operation in progress → wait 30s, retry once
- `PRESSURE_GATED`: tokens too low for query → run `/pythia checkpoint` first
- `ORACLE_NOT_FOUND` on decommission → oracle already gone, inform user
- All other errors: display the error message and code to the user

### .pythia-active Directory
When Claude spawns an oracle for a project, it should:
1. Create `<project_root>/.pythia-active/<oracle-name>.json`
2. Content: `{ "oracle_name": "<name>", "oracle_dir": "<oracle_dir>", "spawned_at": "<iso>" }`

This allows the `/pythia` skill and the post-tool-use hook to auto-detect active oracles
without scanning the full registry.

---

## Quick Reference

| Command | MCP Tool | Purpose |
|---------|----------|---------|
| `/pythia` | `oracle_pressure_check` | Status + pressure |
| `/pythia <query>` | `ask_daemon` + `oracle_log_learning` | Query oracle |
| `/pythia sync` | `oracle_sync_corpus` | Reload corpus |
| `/pythia checkpoint` | `oracle_checkpoint` | Force checkpoint |
| `/pythia reconstitute` | `oracle_reconstitute` | Start new generation |
| `/pythia salvage` | `oracle_salvage` | Salvage from interactions |
| `/pythia add <file>` | `oracle_add_to_corpus` | Add file to corpus |
| `/pythia status` | `oracle_quality_report` + `oracle_pressure_check` | Full status |
| `/pythia quality` | `oracle_quality_report` | Quality metrics |
| `/pythia decommission` | `oracle_decommission_request` | Start decommission flow |

MCP tools are provided by the `inter-agent` MCP server:
`/Users/mikeboscia/.claude/mcp-servers/inter-agent/`

Oracle registry: `/Users/mikeboscia/pythia/registry.json`
Oracle data: `<project_root>/oracle/<oracle-name>/`
