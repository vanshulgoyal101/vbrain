# CONVENTIONS — how the brain stays consistent

> **TL;DR** — [MAP.md](MAP.md) is the source of truth; link to files not headings;
> give every file a `> TL;DR`; never store secrets; date stale facts; run the
> validator. These rules keep the brain fast to read and safe to refactor.

## 1. The MAP is the source of truth

- [MAP.md](MAP.md) lists every note, its topic key, and a one-line summary.
- **Every new file must be registered in MAP.md.** Navigation is hub-and-spoke.

## 2. Refactor-safe linking

- Internal links are **relative** and point at a **file**, not a heading. Heading
  edits then never break a link.
- When you move or rename a file: update its MAP row, then run the validator.

## 3. Every file has the same shape

```markdown
# Title

> One-line TL;DR of what this file holds.

<short bullets; newest / most important first>
```

- Lead with the **`> TL;DR` blockquote** so a reader gets the gist in one line.
- Prefer **bullets over prose**. This is a reference, not an essay.

## 4. Content rules

- **Accuracy over hype.** No invented metrics. Record dead ends honestly.
- **Record unknowns**, not just knowns — log them in [gaps.md](gaps.md).
- **Never store secrets** — reference where they live, never the value.
- **Date anything that can go stale** with `(YYYY-MM-DD)`.
- **Cross-link instead of duplicating.** One fact has one home.

## 5. Validate

Run from the repo root:

```bash
node scripts/validate.mjs          # structure, links, MAP coverage, secrets
node scripts/validate.mjs --strict # warnings (thin content) also fail
```

Zero errors + `RESULT: PASS` = healthy. See [scripts/README.md](scripts/README.md).
