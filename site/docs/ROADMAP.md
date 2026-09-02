# Roadmap — brain.example.com

Status of features across frontend, backend, and data. Kept here so decisions live
in docs, not memory.

## Shipped

- **Private hosting** — Cloudflare Worker gated by **Supabase Google sign-in**
  (one allowed email), verified in-Worker on every `/api` call (ES256 + JWKS).
- **Live content** — brain markdown fetched from the private repo as one tarball,
  edge-cached ~5 min.
- **Reader UI** — sidebar nav grouped by section, markdown rendering (vendored
  marked), in-app `.md` link navigation.
- **Search** — instant client-side search with a results view + highlighted snippets.
- **Backlinks** — "Linked from" panel per note (knowledge-graph style).
- **Table of contents** — auto ToC for notes with many sections.
- **Code copy** — copy button on code blocks.
- **Keyboard nav** — `/` focus search, `j`/`k` move, `Esc` close.
- **Mobile** — hamburger toggle + slide-in sidebar.
- **Quick-capture inbox** — jot a thought → Supabase (`vbrain_captures`) → file it
  later. Service-role only, private.
- **Security headers** — strict CSP + framing/mime/referrer protections on all responses.
- **Ranked search** — real **BM25-lite** engine: diacritic folding, token+prefix
  matching, IDF + length normalization, field boosts, coverage bonus, **typo
  tolerance** (bounded fuzzy) and **operators** (`"phrase"`, `-exclude`,
  `section:`), all-term highlighting. One engine shared by the UI + MCP. See
  [SEARCH.md](SEARCH.md).
- **MCP server** — `/mcp` endpoint (`search_brain`, `get_note`, `list_notes`,
  `get_backlinks`) so any AI agent can query the brain as a tool. See [MCP.md](MCP.md).
- **Liveness** — public `/healthz` endpoint reporting which features are wired.
- **Static files** — résumé PDFs served at `/files/*`; `.pdf`/image links in notes
  open in-app.
- **Local preview** — dependency-free `dev-server.mjs` serves the UI + brain from
  local Markdown (no token / Access needed).
- **CI** — GitHub Actions runs `validate.mjs --strict` + the site test suite on every push.
- **Doctor** — `scripts/doctor.mjs` health report (orphans, staleness, now.md age).
- **Graph view** — in-UI force-directed map of the note link-graph (click to open).
- **Inline edit** — edit a note in the UI and commit it to the private repo
  (optional, `GITHUB_WRITE_TOKEN`-gated).
- **Tests** — 170 Vitest unit tests (real JWT verification + MCP + router + edit + PR + recent + search engine + SSG); ~98% coverage (`npm run test:coverage`).
- **Recently changed** — `/api/recent` GitHub-commits feed + a "Recently changed" view.
- **Daily briefing** — deterministic `#/briefing` view (focus + next moves + open
  tensions + recent changes + inbox), assembled from the notes themselves.
- **Capture auto-file suggestion** — the inbox ranks each capture against the notes
  and suggests where to file it.
- **Inline edit → PR** — "Propose PR" opens a branch + pull request instead of
  committing straight to `main` (`/api/note-pr`).
- **Offline PWA** — installable app with a service worker that caches the **app
  shell only** (never `/api` content), so it loads offline without persisting
  private data. See [SECURITY.md](SECURITY.md).
- **Public SEO site (SSG)** — a static export of the notes for the *public* brain
  (vbrain.vanshul.com): an indexable page per note (canonical, Open Graph,
  `TechArticle` + `BreadcrumbList` JSON-LD), a landing page, `sitemap.xml`,
  `robots.txt`, Cloudflare Pages `_headers`, clean URLs, skip link + single-H1
  a11y. `npm run build:site`. See [PUBLIC-SITE.md](PUBLIC-SITE.md).
- **Engine sync** — `scripts/sync-engine.mjs` keeps the shared engine identical
  across the public (canonical) and private brains. See [scripts/README](../../scripts/README.md).

## Proposed / potential

- **Capture → note write-through** — one click to append a filed capture into its
  suggested note via the edit API (today it suggests + links; filing is manual).
- **Briefing history** — snapshot the daily briefing over time to see drift.
- **Full-text server search** — currently client-side over the in-memory bundle;
  fine at this scale, revisit only if the brain grows large.

## Explicit non-goals

- **Public SEO on the *private* brain** — brain.vanshul.com is auth-gated and
  intentionally `noindex`; being unfindable is correct. (The separate *public*
  demo site at vbrain.vanshul.com **is** fully SEO-optimized — see the SSG above.)
  See [SECURITY.md](SECURITY.md).
- **Multi-user / sharing** — single-user tool; no accounts, roles, or ACLs beyond
  the one allowed email.
