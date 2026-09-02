# Architecture — brain.example.com

The private web reader for [vbrain](../../README.md). A single Cloudflare Worker
serves a static SPA and a small JSON API, gated by **Supabase Google sign-in** to
one email.

## Request flow

```
Browser ──▶ Supabase Google OAuth ──▶ Worker (vbrain)
             │ mints ES256 access token           │
             │ (anyone can sign in)                ├─ /healthz     → liveness (public, no secrets)
             │                                     ├─ /auth/config → supabase url + anon key (public)
             │                                     ├─ /            → static SPA (public/)
             │                                     ├─ /files/*      → static assets (résumé PDFs, images)
  browser sends the token as               ├─ /api/me       → identity + capture/edit flags
  `Authorization: Bearer <token>` ─────────┤─ /api/bundle   → brain markdown (from GitHub)
             on every /api call                    ├─ /api/note     → inline edit → commit (optional)
                                                    ├─ /api/capture* → quick-capture inbox (Supabase)
                                                    └─ /mcp          → MCP server (bearer token)
```

The Worker is the single gate: it verifies the Supabase token on every `/api`
request (`access.js`) — signature (ES256 via JWKS), `exp`, `aud`, issuer — and
then checks the email claim equals the one allowed email. Anyone can complete
Google sign-in, but only `owner@example.com` is served content; everyone else
gets `403`.

## Worker modules (`src/`)

| Module | Responsibility |
|--------|----------------|
| `worker.js` | Entry point + routing. `/healthz`, `/mcp`, `/api/*` gate, static passthrough with security headers. |
| `access.js` | Parse + verify the Supabase access token (ES256, JWKS, aud, issuer, exp, allowed email). |
| `content.js` | Fetch the private repo as one tarball, gunzip, parse tar, select brain `.md`. |
| `recent.js` | Recent-changes feed via the GitHub commits API (cached ~2 min). |
| `captures.js` | Quick-capture inbox via Supabase REST (service-role only). |
| `search.js` | Re-exports the ONE canonical BM25-lite search engine from `public/lib.js` (so UI + MCP never drift). See [SEARCH.md](SEARCH.md). |
| `mcp.js` | MCP server (JSON-RPC): `search_brain` / `get_note` / `list_notes` / `get_backlinks`. |
| `edit.js` | Inline edit → commit a note to the private repo, or open a PR (optional, write-token-gated). |
| `http.js` | `json()`, security headers, cookie + base64url helpers. |

Each module exposes pure/injectable functions so they're unit-tested without a
live Worker (see [TESTING.md](TESTING.md)).

## Frontend (`public/`)

| File | Responsibility |
|------|----------------|
| `index.html` | Shell: sidebar, search, capture box, content pane. |
| `app.js` (ES module) | Loads the bundle once; nav, routing, rendering, search, inbox, graph, briefing, recent, inline edit. Routes `.pdf`/image links to `/files/`. |
| `lib.js` (ES module) | Pure helpers (title, path resolution, search snippet, backlinks, graph data, suggestions, section bullets) — tested. |
| `styles.css` | Dark theme. |
| `brain.svg` | Minimal line-art brain — favicon + sidebar logo. |
| `manifest.webmanifest` + `sw.js` | PWA: installable + offline **app shell** (never caches `/api` content). |
| `files/` | Static assets served at `/files/*` (résumé PDFs, images). |
| `vendor/marked.min.js` | Markdown renderer, vendored locally (no CDN → strict CSP). |

A dependency-free **`dev-server.mjs`** serves `public/` and stubs `/api/me` +
`/api/bundle` from the local Markdown, and returns an empty `/auth/config` so the
UI runs in **dev mode** (no login) — the graph and everything else can be previewed
with no GitHub token or Supabase: `node dev-server.mjs` → `localhost:8787`.

## Content flow

The brain lives in the **private `vbrain` GitHub repo**. On `/api/bundle` the
Worker downloads `tarball/main` with a read-only token (one request), decompresses
with `DecompressionStream('gzip')`, parses the tar, and returns every brain `.md`
as `{ path: content }`. Cached ~5 min at the edge; the SPA holds it in memory for
instant nav, search, and backlinks.

## Data storage

Only the optional **capture inbox** uses a datastore — the existing "portfolio"
Supabase project, table `public.vbrain_captures` (`site/supabase/vbrain.sql`),
service-role only. Everything else is stateless.

## Why a Worker (not GitHub Pages)

Pages is static and public; it cannot gate a single user. The Worker + Access is
the only way to keep the content private. See [SECURITY.md](SECURITY.md).
