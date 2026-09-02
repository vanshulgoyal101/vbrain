# Docs — brain.example.com

Documentation for the private web reader + MCP server for [vbrain](../../README.md).
The rule: **rely on docs, not memory** — every shipped, proposed, and potential
feature and the whole architecture is written down here.

| Doc | What it covers |
|-----|----------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Request flow, Worker modules, frontend, content flow, endpoints map. |
| [API.md](API.md) | Every HTTP endpoint: `/healthz`, `/api/*`, `/files/*`, `/mcp`, status codes. |
| [SEARCH.md](SEARCH.md) | The BM25-lite search engine: folding, tokenizing, ranking, limitations. |
| [DATABASE.md](DATABASE.md) | The one table (`vbrain_captures`), RLS/service-role model, lifecycle, migration. |
| [MCP.md](MCP.md) | The MCP server — tools, auth, client config, Access bypass. |
| [SECURITY.md](SECURITY.md) | Threat model, headers, secrets, the private/no-SEO decision. |
| [PUBLIC-SITE.md](PUBLIC-SITE.md) | The SEO static build (SSG) for the public site (vbrain.vanshul.com). |
| [TESTING.md](TESTING.md) | Vitest suites, the real-crypto JWT test, the injectable-deps pattern. |
| [ROADMAP.md](ROADMAP.md) | Shipped, proposed, and explicit non-goals. |

## Quick start

```bash
cd site
npm install
npm test                 # unit suite (Vitest)
npm run build:site        # build the public SEO site -> site/dist/
node dev-server.mjs       # local read-only preview at http://localhost:8787
npx wrangler deploy       # deploy the Worker (see ../README.md for full setup)
```

New to the code? Read [ARCHITECTURE.md](ARCHITECTURE.md) first, then
[API.md](API.md). Operators start at [../README.md](../README.md) (setup) +
[SECURITY.md](SECURITY.md) (hardening checklist).
