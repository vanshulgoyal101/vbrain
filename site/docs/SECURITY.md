# Security — brain.example.com

The brain holds personal, career, and business notes. The site is **private by
design**: only `owner@example.com` can ever see it.

## Threat model & controls

| Threat | Control |
|--------|---------|
| Anyone browsing the site | Content is served **only** to `owner@example.com`. Anyone can complete Supabase Google sign-in, but the Worker returns `403` for any other email. |
| Direct hit to the Worker (`*.workers.dev`) | Worker **verifies the Supabase access token** on every `/api` call (`access.js`). No valid token → 401; wrong email → 403. |
| Forged / tampered JWT | **ES256** signature verified against Supabase's JWKS; `aud` (`authenticated`), `iss`, and `exp` all checked; alg pinned to ES256; `kid` must match a known key. |
| Content leak via search engines | `noindex, nofollow` + private-by-design (see below). |
| XSS in rendered notes | Content is first-party; capture/inbox text rendered via `textContent`; strict **CSP** (`script-src 'self'`, marked vendored locally). |
| XSS via HTML-string interpolation | The few places that build HTML strings (search hits, commit rows) escape through a single hardened `escapeHtml` in `lib.js` that escapes `& < > " '` — so a value interpolated into `href="…"` cannot break out of the attribute. Link hrefs additionally pass `safeUrl()`, which allows only `http(s):` (blocking `javascript:`/`data:`). |
| Clickjacking | `X-Frame-Options: DENY` + `frame-ancestors 'none'`. |
| Capture data exposure | `vbrain_captures` has RLS on with **no policies** → service-role only; the public anon key cannot read/write it. |
| Secret leakage | GitHub + Supabase keys are **Worker secrets**, never in the bundle or the browser. |
| Info leak via `/healthz` | Returns only booleans (feature wired or not) — no emails, tokens, counts, or note content. |
| Private content cached on-device (PWA) | The service worker caches the **app shell only** (HTML/JS/CSS/icon); it never caches `/api/*`, `/files/*`, `/mcp`, or `/healthz`, so no brain content is written to disk. |

## Response headers (all responses)

`Content-Security-Policy` (default-src 'self'; script-src 'self'; object-src
'none'; frame-ancestors 'none'; base-uri 'none'; …), `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`Permissions-Policy` (geolocation/mic/camera off).

## Secrets

| Secret | Where | Scope |
|--------|-------|-------|
| `GITHUB_TOKEN` | Worker secret | read-only Contents on the private `vbrain` repo |
| `GITHUB_WRITE_TOKEN` | Worker secret (optional) | read-write Contents — enables inline edit |
| `SUPABASE_SERVICE_KEY` | Worker secret | `vbrain_captures` on the portfolio project |
| `MCP_TOKEN` | Worker secret (optional) | bearer auth for the `/mcp` server |

Non-secret config (`ALLOWED_EMAIL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GH_*`)
lives in `wrangler.toml` `[vars]`. The Supabase **anon key** is publishable
(RLS-protected) and is intentionally exposed to the browser via `GET /auth/config`
to start the login flow — it grants no data access on its own.

## On SEO — intentionally NOT indexed

A private, single-user brain must be **unfindable**. Public SEO would defeat the
entire purpose by exposing personal data. So the site ships `noindex, nofollow`
and has no sitemap/OG tags. Ranking effort belongs on the **public** sites
(example.com, games/tools/ctx/mcp), not here. This is a feature, not a gap.

## Hardening checklist (operator)

- [ ] Supabase **Google provider** enabled on the portfolio project (shared with arcade).
- [ ] `https://brain.example.com/**` added to the Supabase **redirect URL allowlist**.
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_EMAIL` set in `wrangler.toml`, redeployed.
- [ ] `GITHUB_TOKEN` set as a Worker secret (fine-grained, read-only).
- [ ] `*.workers.dev` route disabled for this Worker.
- [ ] (If capture) `SUPABASE_SERVICE_KEY` secret set; `SUPABASE_URL` var set.
