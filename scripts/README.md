# Scripts — validating the brain

> **TL;DR** — Zero-dependency Node scripts that keep vbrain healthy: `validate.mjs`
> checks structure, links, MAP coverage, completeness, and secret/PII leakage;
> `new-note.mjs` scaffolds a correctly-shaped note. No installs needed.

## validate.mjs — the health check

```bash
node scripts/validate.mjs           # report; exits 1 on any ERROR
node scripts/validate.mjs --strict  # warnings also fail (use in CI)
node scripts/validate.mjs --quiet   # only show failures + summary
```

**ERROR (always fails):**

- Missing H1 title on the first line.
- Missing `> TL;DR` blockquote in the first 6 lines.
- File not registered in [MAP.md](../MAP.md) (and no dangling MAP rows).
- Broken internal link (a `.md` or folder target that doesn't exist).
- Duplicate consecutive lines.
- A stale/missing `llms.txt` or `llms-full.txt` (run `gen-llms.mjs` — see below).
- A possible **secret or PII** (API keys, tokens, private keys, PAN, Aadhaar-like
  numbers) — the brain must never store these.

**WARN (fails only with `--strict`):**

- **Thin content** — fewer than 8 non-blank lines or 50 words ("a lot of
  information" check).
- No `##` section headings.
- **AI-slop vocabulary** — filler words banned by [STYLE.md](../STYLE.md)
  (delve, seamless, comprehensive, plethora, ...); prose only, code is skipped.

It also prints a summary: file count, total words, average words/file, and MAP
coverage.

## gen-llms.mjs — the machine-readable indexes

```bash
node scripts/gen-llms.mjs          # write llms.txt + llms-full.txt at the repo root
node scripts/gen-llms.mjs --check  # exit 1 if either file is stale (CI)
```

Generates two committed files from [MAP.md](../MAP.md), the single source of truth
(so they can't drift), mirroring gbrain's `build:llms`:

- **`llms.txt`** — a compact, sectioned index (llmstxt.org style) plus operational
  tips; hand an agent the whole topology in one fetch.
- **`llms-full.txt`** — the same index with every note inlined, for single-fetch
  context ingestion.

The validator fails if either is stale, so **run this after adding, moving, or
splitting a note** (right after updating MAP.md). Set `LLMS_REPO_BASE` to emit
absolute raw URLs instead of relative paths.

## new-note.mjs — scaffold a note

```bash
node scripts/new-note.mjs projects/foo.md "Foo" "What Foo is, in one line."
```

Creates a file with the correct header shape and prints the exact MAP.md row to
add (registering in the MAP is required — see [CONVENTIONS.md](../CONVENTIONS.md)).

```bash
node scripts/new-note.mjs projects/foo.md "Foo" "What Foo is, in one line."
```

Creates a file with the correct header shape and prints the exact MAP.md row to
add (registering in the MAP is required — see [CONVENTIONS.md](../CONVENTIONS.md)).

## graph.mjs — knowledge graph + gap analysis

```bash
node scripts/graph.mjs                    # hubs, orphans, under-connected notes
node scripts/graph.mjs --backlinks career/profile.md   # who links to a note
node scripts/graph.mjs --json             # the raw link graph
```

Inspired by gbrain's self-wiring graph: keeps notes woven together instead of a
pile of disconnected files. **Orphans** (only reachable via MAP) and
**under-connected** notes are the things to weave in.

## pack.mjs — export the brain for an LLM

```bash
node scripts/pack.mjs                      # index: file -> TL;DR (llms.txt style)
node scripts/pack.mjs --full --out brain.txt   # whole brain in one file
```

Inspired by gbrain's `llms-full.txt` and ctx's `pack_repo` — hand the entire brain
to any chat in one paste.

## doctor.mjs — health score + one-shot report

```bash
node scripts/doctor.mjs          # 0–100 score + metric breakdown, orphans,
                                 # under-connected, thin, staleness, verify-me
node scripts/doctor.mjs --json   # machine-readable snapshot (track the trend)
```

Inspired by gbrain's `doctor` + gstack's `health`. The score is a weighted blend of
MAP **coverage**, **linkage** (few orphans), **connectivity**, **freshness**
(now.md age), **staleness**, and **depth** (not thin), and it lists **Verify-me**
(oldest-touched notes = best re-check candidates). Advisory (exit 1 = needs
attention); the hard gate is `validate.mjs`. Append `--json` to a log to watch the
score over time.

## drain-inbox.mjs — file the capture backlog

```bash
node scripts/drain-inbox.mjs            # unfiled captures + suggested target notes
node scripts/drain-inbox.mjs --json     # machine-readable plan
node scripts/drain-inbox.mjs --limit 50 # cap how many to pull
```

Reads the unfiled rows from the Supabase capture inbox and ranks the best note to
file each into (same ranker as the web `#/inbox`). Read-only — it suggests; you
file via the UI's **File into note** button or by editing the note. Creds: env
`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`, or a `SUPABASE_TOKEN` PAT (env or
`../arcade/.env`) to reveal the service key. See the **drain-inbox** ritual in
[../RITUALS.md](../RITUALS.md).

## When to run

- **After adding or editing** any note (catches broken links / missing TL;DR / thin content).
- **After a refactor / file move** (catches broken links + unmapped/dangling MAP rows).
- Before considering the brain "done" for a session.

## Requirements

Node (any recent version). In the sandbox, prefix with the nvm path if `node`
isn't resolved:
`export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`.
