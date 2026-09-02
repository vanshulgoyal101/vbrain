# Gaps & unknowns

> **TL;DR** — The honest negative space: what this brain does *not* yet know —
> open questions, unverified assumptions, and decisions still to make. A second
> brain that only stores what you know is overconfident. (Demo content.)

Prefix a line with `⚠️` for a contradiction, `❓` for missing data, `🔬` for
something to verify. When a gap closes, move the fact to its real home and delete
the line here. Maintained by the **gap-check** ritual ([RITUALS.md](RITUALS.md)).

## Missing data

- ❓ **PixelPaws retention** — no numbers yet on whether players come back day two.
- ❓ **LedgerLite demand** — zero interviews done; the roadmap is guesswork until then.

## To verify

- 🔬 Does the offline save race in [projects/pixelpaws.md](projects/pixelpaws.md)
  actually cause data loss, or just a console warning? Reproduce before fixing.
- 🔬 Is Cloudflare KV fast enough for leaderboards, or is Durable Objects needed?

## Open decisions

- ⚠️ Ship PixelPaws as free-with-cosmetics or a one-time unlock? Unresolved — it
  changes the whole build order. See [projects/README.md](projects/README.md).
