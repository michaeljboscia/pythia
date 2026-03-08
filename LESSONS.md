# LESSONS.md — Pythia Oracle Engine

> **Purpose:** Every correction, every bug, every mistake gets logged here with a prevention rule.
> Reviewed at the start of every session so errors don't repeat.

---

## Format

```
## YYYY-MM-DD — Short Title
What happened: [incident, 1-2 sentences]
Lesson: [actionable takeaway, 1-2 sentences]
Scope: project
```

---

## Design Phase Lessons

## 2026-03-06 — Design Doc Contradictions Survive Multiple Passes
What happened: After 3 interrogation rounds and a twin review, 12 contradictions were still found in the design doc (stale error codes, missing tool contracts, overloaded status values).
Lesson: Every time the design doc is revised, run a full consistency sweep: error codes match their definitions, tool contracts exist for every referenced tool, status values are used consistently. Contradictions compound — catching them early is cheaper than catching them in code.
Scope: project

## 2026-03-06 — Empty Pool Breaks Math.max
What happened: `Math.max(...[])` returns `-Infinity` in JavaScript. After spawn-on-demand idle dismiss, an empty pool would produce nonsense pressure values.
Lesson: Any aggregation over pool members must guard for the empty-pool case. All pressure fields must be `null` when no active members exist, and the tool must return `PRESSURE_UNAVAILABLE`.
Scope: project
