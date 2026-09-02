# LedgerLite

> **TL;DR** — A private, offline-first personal-finance PWA: track spending
> locally, no accounts, no data leaves the device. Live at ledgerlite.example.com.
> (Demo content for vbrain.)

A small money tracker built around one principle: **your data never leaves your
browser** unless you export it yourself.

## Stack

- **TypeScript + IndexedDB** — all data local; no server, no analytics on input.
- **Installable PWA** — service worker caches the app shell for offline use.
- **Pure logic in `lib.ts`**, unit-tested; the UI is a thin DOM layer.

## What shipped

- Add/edit transactions, categories, and a monthly summary.
- CSV import/export (client-side; nothing uploaded).
- Charts drawn with Canvas — no charting dependency.

## Why it matters

It's a proof that a genuinely useful tool can be **privacy-first by construction**
— the thing that ships is the thing that's tested, and there's no backend to leak.

## Next

Waiting on real user feedback before adding features — see [now.md](../now.md)
and the screening frame in [ideas/backlog.md](../ideas/backlog.md).
