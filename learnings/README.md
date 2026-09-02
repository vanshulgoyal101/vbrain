# Learnings — index

> **TL;DR** — Reusable, hard-won lessons distilled from the projects. Check here
> before building to avoid re-hitting a known trap. (Demo content for vbrain.)

The real gold in a second brain: lessons that outlive the project that taught
them. Organized by domain so each lesson has one home.

| File | Covers |
|------|--------|
| [engineering.md](engineering.md) | Frontend/JS/state bug classes + testing patterns. |

## The meta-lessons

- **Pure logic, separate from view.** Split `game.ts` (pure, tested) from
  `render.ts` (DOM/Canvas). Testing gets trivial.
- **Guard state transitions synchronously** at the top of a handler — the root of
  most double-fire and stale-state bugs.
- **Verify live before fixing.** Many "bugs" are stale caches or a service worker,
  not real defects. Reproduce first. See [projects/pixelpaws.md](../projects/pixelpaws.md).
