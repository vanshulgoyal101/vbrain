# Search — how the brain search works

One dependency-free **BM25-lite** engine powers both the web UI search and the MCP
`search_brain` tool. It lives in [`../public/lib.js`](../public/lib.js) and is
re-exported by [`../src/search.js`](../src/search.js) so the two surfaces can never
drift.

## Pipeline

1. **Fold** (`fold`) — lowercase + strip Latin diacritics, **length-preserving**
   (`é→e`), so `resume` matches `résumé` *and* snippet indices stay aligned with the
   source text.
2. **Tokenize** (`tokenize`) — split folded text into `\p{L}\p{N}+` word tokens.
3. **Index** (`buildIndex`, memoized per bundle via a `WeakMap`) — per note: a term-
   frequency map, token length, and token sets for the **title**, **headings**, and
   **path**; plus corpus stats `N` (doc count) and `avgdl` (average length).
4. **Score** (`rankHits`) — for each query term:
   - **IDF** — rare terms weigh more: `ln(1 + (N − df + 0.5)/(df + 0.5))`.
   - **BM25 term frequency** — saturating + length-normalized (`k1 = 1.4`, `b = 0.7`),
     so long notes don't win just by being long.
   - **Field boosts** — title `+3.5`, heading `+1.5`, path `+1` (× IDF).
   - **Coverage bonus** — `× (1 + 0.4·(matched−1))`: notes matching **more** of the
     query terms rank higher.
5. **Present** — `excerpt` returns a window around the earliest matching term (with
   `…` ellipses); `highlight` HTML-escapes it and wraps **every** query term in
   `<mark>`.

### Matching rule

A document token matches a query term on **exact equality** or a **prefix of length
≥ 4** (`deploy`↔`deployment`) — light, safe stemming. Because matching is
**token-based, not substring**, `on` no longer matches inside `traction`/`lion`.
A term with no exact/prefix hit anywhere falls back to **typo tolerance** (bounded
Levenshtein ≤ 1, or ≤ 2 for terms ≥ 8 chars), so `deploment` still finds
`deployment` — and the snippet anchors on and highlights the real word.

## Query operators

Parsed by `parseQuery` and honoured by both the UI and the MCP tool:

| Syntax | Meaning |
|--------|---------|
| `word1 word2` | match either term; notes matching **more** terms rank higher (coverage bonus). |
| `"exact phrase"` | require the phrase verbatim (AND filter). |
| `-word` / `-"phrase"` | exclude notes containing it. |
| `section:career` | restrict to a top-level section (`career/`, `projects/`, `learnings/`, …). |

Example: `"lead form" adbrain -solaride section:projects`.

## What this fixed (former failure modes)

- `resume` → `résumé` (diacritics) — now matches.
- `on`, `cat` matching inside unrelated words — gone (token matching).
- Long notes dominating — fixed (IDF + length normalization).
- Multi-word queries showing the top of the file — fixed (`excerpt` windows on the
  matched term; all terms highlighted).
- `deploy`/`deployment`, `idea`/`ideas` — covered by prefix matching.
- **Typos** (`adbrian`, `deploment`) — covered by the bounded fuzzy fallback.

## Known limitations (intentional / future)

At ~50 notes this is fast (index built once, reused across keystrokes) and precise.
Not yet handled — revisit only if they bite:

- **Synonyms / acronyms** — `PKM` ↔ `second brain`, `CF` ↔ `Cloudflare` aren't linked.
- **Ranking learning** — no click-through signal; ranking is purely lexical.
- **Scale** — search is client-side over the in-memory bundle. Perfect here; if the
  brain ever grows to thousands of notes, move to a prebuilt inverted index or a
  server-side FTS.

## Tests

- [`../test/lib.test.js`](../test/lib.test.js) — `fold`, `tokenize`, `matches`,
  `excerpt`, `highlight`, `parseQuery`, `editDistanceLE`, and `rankHits` (IDF,
  coverage, token-not-substring, diacritics, fuzzy, phrase/exclude/section).
- [`../test/search.test.js`](../test/search.test.js) — the re-exported worker/MCP
  surface behaves identically.
