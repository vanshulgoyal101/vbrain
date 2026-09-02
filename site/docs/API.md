# API — brain.example.com

All `/api/*` endpoints require a valid **Supabase Google session** — send the
Supabase access token as `Authorization: Bearer <token>`. The Worker returns `401`
if the token is missing/invalid/expired, `403` if the signed-in email isn't the
allowed one, or `503` if auth isn't configured. All responses are JSON with
strict security headers and `cache-control: no-store` (except the bundle).

## `GET /auth/config` (public)
Bootstraps the browser login flow — no auth, no secrets (the anon key is publishable).
```json
{ "supabaseUrl": "https://YOUR_PROJECT.supabase.co", "anonKey": "eyJ…" }
```

## `GET /healthz` (public)
Liveness probe — no auth, no secrets. Reports which optional features are wired.
```json
{ "ok": true, "service": "vbrain", "auth": true, "mcp": true, "capture": true, "edit": false, "recent": true }
```
Public on the custom domain — no auth needed, safe to monitor externally.

## `GET /api/me`
Identity of the signed-in user + which optional features are enabled.
```json
{ "email": "owner@example.com", "capture": true, "edit": false, "recent": true }
```

## `GET /api/bundle`
The whole brain in one payload (markdown pulled live from the private repo).
Cached ~5 min at the edge.
```json
{ "files": { "README.md": "# ...", "career/profile.md": "# ..." },
  "count": 42, "generatedAt": 1734200000000 }
```
Errors: `503` (`GITHUB_TOKEN` not set), `502` (GitHub error).

## `GET /api/recent`
The latest commits to the brain repo (via the GitHub commits API). Edge-cached ~2 min.
```json
{ "commits": [ { "sha": "e9a6ef8", "message": "docs: add gaps", "date": "2026-08-16T…", "author": "Alex Rivera", "url": "https://github.com/…" } ],
  "generatedAt": 1734200000000 }
```
Errors: `503` (`GITHUB_TOKEN` not set), `502` (GitHub error).

## `GET /api/captures`
Unfiled captures, newest first (max 200). Requires capture configured.
```json
{ "captures": [ { "id": 5, "text": "a thought", "created_at": "2026-08-15T…" } ] }
```

## `POST /api/capture`
Add a capture. Body `{ "text": "…" }` (1–8000 chars).
```json
{ "ok": true, "capture": { "id": 6, "text": "…" } }
```
Errors: `400` (empty / too long), `503` (not configured), `502` (Supabase error).

## `POST /api/capture-file`
Mark a capture filed. Body `{ "id": 6 }`.
```json
{ "ok": true }
```
Errors: `400` (bad id), `503`, `502`.

## `PUT /api/note`
Commit an edited note to the private repo (optional; needs `GITHUB_WRITE_TOKEN`).
Body `{ "path": "career/profile.md", "content": "# …", "message": "…" }`.
```json
{ "ok": true, "path": "career/profile.md", "commit": "<sha>", "created": false }
```
Errors: `400` (bad path / empty / too large), `503` (not configured), `502` (GitHub error).
Writes go to the default branch; CI validates the commit.

## `POST /api/note-pr`
Same as `PUT /api/note`, but opens a **pull request** instead of committing to
`main`: creates a branch `brain-edit/<ts>`, commits the note there, and opens a PR.
Body `{ "path": "career/profile.md", "content": "# …", "message": "…" }`.
```json
{ "ok": true, "path": "career/profile.md", "pr": "https://github.com/…/pull/7", "number": 7, "branch": "brain-edit/1734…" }
```
Errors: `400` (validation), `503` (not configured), `502` (GitHub error). Needs
`GITHUB_WRITE_TOKEN`.

## Status codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 400 | Bad request (validation) |
| 401 | Missing / invalid / expired token (not signed in) |
| 403 | Signed in, but not the allowed email |
| 404 | Unknown API route |
| 502 | Upstream (GitHub / Supabase) error |
| 503 | Feature not configured (auth / token / Supabase) |

Non-`/api` paths serve the static SPA. Static assets under `/files/*` (résumé PDFs,
images) are served from `public/files/` with security headers (public — the SPA
gates the app UI, not individual static files).

## `POST /mcp` — MCP server (separate auth)

JSON-RPC 2.0 for AI agents, authed by `Authorization: Bearer <MCP_TOKEN>` (a
dedicated token, separate from the Supabase user session). Tools: `search_brain`,
`get_note`, `list_notes`, `get_backlinks`.
Returns `503` if `MCP_TOKEN` is unset, `401` if the bearer is wrong, `405` for
non-POST. Full guide: [MCP.md](MCP.md).
