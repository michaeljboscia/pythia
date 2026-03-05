# Pythia — Persistent Knowledge Oracle

> *"The corpus is the Oracle. The daemon is the vessel. The vessel is replaceable. The corpus is eternal."*

Pythia is a generational oracle engine for long-running AI-assisted projects.
It manages persistent Gemini daemon sessions that hold a project's full research
corpus, checkpoint their learnings before context exhaustion, and reconstitute
across generations — each version inheriting everything the last one knew.

**This is the engine.** Oracle data (manifest, interactions log, checkpoints)
lives inside each project repo under `oracle/`. Pythia manages it from outside.

---

## The Core Idea: Version Control for Latent Space

Every VCS captures **what was made** (artifacts). Pythia captures **why it was made** —
the reasoning, discarded alternatives, and architectural intent that normally lives
only in someone's head or a transient chat session.

Each consultation is a structured, addressable event in `oracle/learnings/vN-interactions.jsonl`,
committed alongside the code it influenced. The oracle's evolution and the codebase's
evolution are interleaved in the same git history.

---

## Architecture

```
~/pythia/                          ← this repo (the engine)
├── src/
│   ├── oracle-types.ts            ← shared types (OracleManifest, OracleState, InteractionEntry...)
│   ├── oracle-tools.ts            ← MCP tools (spawn_oracle, oracle_checkpoint, oracle_reconstitute...)
│   └── gemini/runtime.ts          ← singleton bridge to Gemini daemon infrastructure
├── design/
│   └── pythia-persistent-oracle-design.md
├── registry.json                  ← maps oracle names to project oracle_dirs
└── skills/
    └── pythia.md                  ← /pythia slash command definition

~/my-project/oracle/               ← oracle DATA (lives in the project repo)
├── manifest.json                  ← corpus definition (static + live sources)
├── state.json                     ← current generation, pressure metrics
├── learnings/
│   ├── v1-interactions.jsonl      ← every consultation, addressable by id
│   └── v2-interactions.jsonl
└── checkpoints/
    ├── v1-checkpoint.md           ← Pythia v1's self-written synthesis
    └── v2-checkpoint.md
```

## Dependencies

- **inter-agent MCP server** (`~/.claude/mcp-servers/inter-agent/`) — provides
  `spawn_daemon`, `ask_daemon`, `dismiss_daemon` primitives. Pythia builds on top.
- **Gemini CLI** — the underlying model running the oracle sessions.

## Design Document

Full architecture, schemas, and implementation plan:
[design/pythia-persistent-oracle-design.md](design/pythia-persistent-oracle-design.md)

## Quick Context (For AI)

This repo contains the Pythia oracle engine. When working here:
- The engine code goes in `src/`
- Oracle DATA (manifest, interactions, checkpoints) lives in each PROJECT's `oracle/` dir
- `registry.json` maps oracle names to their project `oracle_dir` paths
- The design doc is the authoritative spec — read it before touching src/
- Dependencies: inter-agent MCP at `~/.claude/mcp-servers/inter-agent/src/`
