# PixelPaws

> **TL;DR** — A cozy browser pet game: adopt a pixel creature, feed it, play
> mini-games, keep a daily streak. Vanilla TS + Canvas, zero backend to play.
> Beta at pixelpaws.example.com. (Demo content.)

The current focus project. A small, self-contained web game — no install, no
account required to play.

## Stack

- **Vanilla TypeScript + Canvas** — no framework, hand-written render loop.
- **Vite** build; ships as static files to Cloudflare Pages.
- **localStorage** for saves; optional cloud sync via a tiny Worker + KV.
- **Vitest** for the pure game logic (`game.ts` split from `render.ts`).

## What shipped

- Adopt/name flow, hunger + happiness loops, three mini-games.
- Daily streak with a shareable result card (generated 1080×1080 PNG).
- Offline-first: the whole game works with no network.

## Gotchas worth remembering

- **Save race on sign-out** — clearing local state on logout wiped the daily
  streak because the cloud copy only stored a high score, not the streak. Fix:
  never clear local data on sign-out. Full write-up:
  [learnings/engineering.md](../learnings/engineering.md).
- **rAF double-loop** — starting a new render loop without cancelling the old one
  doubled the speed on replay. Cancel at the top of `start()`.

## Open questions

Monetisation model is undecided — see [gaps.md](../gaps.md).
