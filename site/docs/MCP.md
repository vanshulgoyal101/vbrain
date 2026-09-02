# MCP server — query the brain from any AI agent

vbrain exposes an **MCP (Model Context Protocol)** endpoint so Claude Code, Codex,
Cursor, or any MCP client can search and read the brain as a tool. Same shape as
[ctx.example.com](https://ctx.example.com) / [mcp.example.com](https://mcp.example.com).

- **Endpoint:** `POST https://brain.example.com/mcp` (JSON-RPC 2.0, protocol 2025-06-18).
- **Auth:** `Authorization: Bearer <MCP_TOKEN>`. `/mcp` uses its own dedicated
  bearer token, independent of the Supabase Google session the web UI uses.

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `search_brain` | `query` (string), `max_results` (1–20, default 5) | Ranked notes with excerpts. |
| `get_note` | `path` (e.g. `career/profile.md`) | Full markdown of one note. |
| `list_notes` | — | Every note path. |
| `get_backlinks` | `path` | The notes that link TO that note (graph traversal). |

Content is fetched live from the private repo (same bundle path as the web UI).
All four tools are **read-only** — a bot can query the brain but can never edit,
add, or delete anything.

## Setup

1. Set a strong token as a Worker secret:
   ```bash
   wrangler secret put MCP_TOKEN   # a long random string
   ```
   If `MCP_TOKEN` is unset, `/mcp` returns `503` (disabled).
2. That's it — `/mcp` is authed solely by its bearer token (the Supabase user
   session only gates the browser `/api/*` calls, not `/mcp`). Point your MCP
   client at `https://brain.example.com/mcp` with the `Authorization: Bearer`
   header and you're in.

## Client config (example — Claude Code / Cursor)

```json
{
  "mcpServers": {
    "vbrain": {
      "url": "https://brain.example.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_MCP_TOKEN" }
    }
  }
}
```

Then ask your agent things like *"search my brain for the AdBrain validation gate"*
or *"get career/strategy.md"* and it will call these tools.

## Security notes

- The token is a **Worker secret**; never commit it.
- Every tool is **read-only** (search / get / list / backlinks) — a bot can never
  edit, add, or delete a note; writes only happen through the Access-gated web UI.
- Rotate the token by re-running `wrangler secret put MCP_TOKEN`.
