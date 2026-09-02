# Testing — brain.example.com

Zero-mock-framework, fast unit tests with **Vitest** (Node environment). Every
module with logic is covered; the Access JWT path uses **real WebCrypto** (a
generated RSA keypair signs a token that `verifyAccess` verifies).

## Run

```bash
cd site
npm install
npm test              # vitest run
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

## Suites (`site/test/`)

| File | Covers |
|------|--------|
| `lib.test.js` | Frontend pure helpers + the **search engine**: fold, tokenize, matches, excerpt, highlight, rankHits (IDF/coverage/token-not-substring/diacritics), backlinks, suggestions, section bullets. |
| `search.test.js` | The worker/MCP-facing re-export surface behaves identically to the UI engine. |
| `http.test.js` | `json()` + security headers, cookie parsing, base64url round-trip. |
| `access.test.js` | JWT parse; `verifyAccess` happy path + every rejection (email, aud, exp, alg, unknown key, bad signature, no token, unconfigured). |
| `content.test.js` | `parseTar`, `selectBrainFiles`, `fetchBundle` (gzip + mock fetch), `bundleResponse` error/success. |
| `recent.test.js` | `recentEnabled`, `shapeCommits`, `fetchRecent`, `recentResponse` (cache/error paths). |
| `captures.test.js` | `captureEnabled`, `supa` URL/headers, add/list/file with validation + mocked Supabase. |
| `mcp.test.js` | JSON-RPC routing (initialize, tools/list, errors, notifications) + `callTool` (search/get/list/backlinks). |
| `worker.test.js` | Router: `/healthz`, `/mcp` gating (503/405/401/200), `/api` Access gate, static passthrough + headers. |
| `edit.test.js` | `validNotePath`, `editEnabled`, `saveNote` + `saveNotePR` (commit/PR/create/validation) with mocked GitHub. |
| `helpers.js` | Shared test utilities (`makeTar`, `gzip`, `tarballFetch`) — not a suite. |

Current: **136 tests, 10 files, all passing.**

## How the crypto test works

`access.test.js` generates an RSA-PKCS1-v1.5 / SHA-256 keypair with WebCrypto,
exports the public key as a JWK (with `kid`), signs a JWT, and passes the JWK to
`verifyAccess` via injectable `deps.jwks`. This exercises the real signature-verify
path without any network or mocking of crypto.

## Testability pattern

Worker modules accept injectable dependencies (`fetchImpl`, `deps.jwks`,
`deps.now`) with production defaults (`globalThis.fetch`, live JWKS, `Date.now`).
Tests pass fakes; production passes nothing. No network, no live Worker needed.

## Not unit-tested (by design)

DOM wiring in `app.js` (rendering, event handlers) — its logic is extracted to the
fully-tested `lib.js`. End-to-end behavior is verified manually after deploy, and
the read-only `dev-server.mjs` gives a local preview without cloud dependencies.
