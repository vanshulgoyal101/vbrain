# brain.example.com — private web UI for vbrain

A Cloudflare Worker that serves a web reader for the brain, gated so **only
`owner@example.com`** can access it. Content is fetched **live from the
private `vbrain` GitHub repo** (nothing is bundled publicly).

## How the security works

1. **Supabase Google sign-in** — the SPA sends you through Supabase's Google OAuth
   (the same "portfolio" project the arcade uses). Supabase mints a short-lived
   ES256 access token.
2. The **Worker verifies that token** on every `/api` call: it fetches Supabase's
   JWKS, checks the signature (ES256), `exp`, `aud`, issuer, and finally that the
   email claim equals **`owner@example.com`** — so content can't leak even via
   the `*.workers.dev` URL. Anyone can sign in with Google, but only that one email
   is served content (everyone else gets `403`).
3. Markdown is pulled from the **private** repo with a **read-only `GITHUB_TOKEN`**
   secret (never committed).

The Supabase **anon key** is publishable (RLS-protected) and lives in `wrangler.toml`;
the Worker exposes it (plus the Supabase URL) at the public `GET /auth/config`
endpoint so the browser can start the login flow.

GitHub Pages is intentionally **not** used — it's static/public and can't gate a
single user.

## One-time setup

### 1. Deploy the Worker
```bash
cd site
npm install
npx wrangler deploy         # creates the worker + brain.example.com custom domain (proxied DNS)
```

### 2. Add the GitHub read token (secret)
Create a **fine-grained personal access token** with **Contents: Read-only** on the
`vbrain` repo, then:
```bash
npx wrangler secret put GITHUB_TOKEN   # paste the token when prompted (never in chat)
```

### 3. Configure Supabase Google auth (the gate)
The brain reuses the existing **"portfolio"** Supabase project (`YOUR_PROJECT`):
- **Google provider** is already enabled on that project (shared with the arcade).
- Add `https://brain.example.com/**` (and `http://localhost:8787/**` for local dev)
  to the project's **Auth → URL Configuration → Redirect URLs** allowlist.
- `wrangler.toml` `[vars]` already carries the non-secret config:
```toml
SUPABASE_URL      = "https://YOUR_PROJECT.supabase.co"
SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"
ALLOWED_EMAIL     = "owner@example.com"
```
```bash
npx wrangler deploy
```

### 4. Lock the back door (recommended)
Disable the `*.workers.dev` route for this Worker (Cloudflare dashboard → Worker →
Settings → Domains & Routes) so the only entry is the custom domain.
(The JWT check already refuses non-allowed requests, but this removes the surface.)

## Result

Visit **https://brain.example.com** → the SPA shows a **Sign in with Google** button
→ Supabase Google login → only `owner@example.com` is served content (nav, search,
markdown). Anyone else can sign in but gets a `403` and never reaches the content.

## Updating content

The brain updates when you push to the `vbrain` repo `main` branch. The Worker
caches the bundle for ~5 minutes; a hard refresh after that shows changes.

## Optional: quick-capture inbox (Supabase)

Jot a thought from the sidebar → it's stored in the existing **"portfolio"**
Supabase project (`YOUR_PROJECT`), table `public.vbrain_captures`, then
file it into the brain later (see the `capture` ritual in [../RITUALS.md](../RITUALS.md)).

- Migration (already applied): `supabase/vbrain.sql`. RLS on, **service-role only**,
  so captures stay private and the public anon key can't touch them.
- To enable: set `SUPABASE_URL` in `wrangler.toml` `[vars]` and
  `wrangler secret put SUPABASE_SERVICE_KEY` (the project's `service_role` key),
  then `wrangler deploy`. Leave `SUPABASE_URL` blank to keep the feature off.

## Local dev
```bash
node dev-server.mjs   # read-only preview at http://localhost:8787 (no token / Access needed)
npx wrangler dev      # runs the real Worker locally; /api needs Access vars + token for content
```

## Files
- `src/worker.js` — routing: `/healthz`, `/mcp`, `/api/*` (Access JWT) + content proxy.
- `src/` — modular backend (`access`, `content`, `captures`, `search`, `mcp`, `edit`, `http`).
- `public/` — the static frontend (`index.html`, `app.js`, `lib.js`, `styles.css`, `files/`).
- `dev-server.mjs` — dependency-free local preview server.
- `wrangler.toml` — config + non-secret vars.

## Docs

Start at [docs/README.md](docs/README.md) — the documentation index.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — request flow, modules, content flow.
- [docs/API.md](docs/API.md) — endpoint reference (`/healthz`, `/api/*`, `/files/*`, `/mcp`).
- [docs/DATABASE.md](docs/DATABASE.md) — the capture table, RLS model, migration.
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, headers, the private/no-SEO decision.
- [docs/MCP.md](docs/MCP.md) — the MCP server (query the brain from any AI agent).
- [docs/TESTING.md](docs/TESTING.md) — how the test suite works.
- [docs/ROADMAP.md](docs/ROADMAP.md) — shipped + proposed features.

## Develop & test

```bash
cd site
npm install
    npm test            # 136 Vitest unit tests
npm run dev         # local Worker (needs Access vars + secrets for /api)
```
