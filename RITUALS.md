# RITUALS — repeatable brain workflows

> **TL;DR** — Named, repeatable operations for working the brain: capture, ingest,
> weekly-review, gap-check, and drain-inbox. Tell an agent "run the &lt;name&gt;
> ritual" and it follows the recipe. Each keeps the brain fresh, woven, and honest.

## capture — file a new fact correctly

1. Decide where it goes (the right `projects/`, `learnings/`, or `ideas/` note).
   If nothing fits, scaffold one with `node scripts/new-note.mjs <path> "Title" "TL;DR"`.
2. Add it as a short bullet; cross-link at least one related note.
3. `node scripts/validate.mjs` → must PASS. Register it in [MAP.md](MAP.md).

## weekly-review — keep it current

1. Refresh [now.md](now.md) (focus, next moves, what's live).
2. `node scripts/graph.mjs` → weave in **orphans** and under-connected notes.
3. `node scripts/validate.mjs --strict` → fix errors and thin-content warnings.
4. Re-check dates on time-sensitive facts.

## gap-check — what the brain is missing

1. `node scripts/graph.mjs` for structural gaps (orphans, weak links, hubs).
2. Record real unknowns in [gaps.md](gaps.md) — contradictions, missing data,
   things to verify.

## trace — how did my thinking about X evolve?

Before rewriting a stance, check what you already believed and why.

1. `node scripts/lineage.mjs "<term>"` → first wording, the commits that reworked
   it, and every note it lives in today.
2. If the current notes disagree with the earlier wording, that's a **reversal** —
   record it (what changed and why) rather than silently overwriting history.
3. If it appears in history but in no current note, decide: revive it or let it go.

## drain-inbox — file the quick-capture backlog

Captures (from the web box or an agent) land in an inbox, not the brain. Drain it:

1. `node scripts/drain-inbox.mjs` → lists unfiled captures with suggested target notes.
2. File each into the right note, then mark it filed.
3. `node scripts/drain-inbox.mjs --filed` reads back anything already marked filed.

## brainstorm — screen a new idea

Run it through the frame in [ideas/backlog.md](ideas/backlog.md) and record the
verdict in [ideas/README.md](ideas/README.md). A clear **"no" is a win**.
