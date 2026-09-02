# Database — brain.example.com

The brain itself is **stateless** — notes live as Markdown in the private `vbrain`
GitHub repo and are fetched live (see [ARCHITECTURE.md](ARCHITECTURE.md)). The only
datastore is the optional **quick-capture inbox**, one table on the existing
"portfolio" Supabase project (`YOUR_PROJECT`).

## Table: `public.vbrain_captures`

Source of truth: [`../supabase/vbrain.sql`](../supabase/vbrain.sql) (additive +
namespaced, safe to re-run).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `bigint` identity, PK | Server-assigned. |
| `created_at` | `timestamptz`, default `now()` | Capture time. |
| `text` | `text`, `check (char_length between 1 and 8000)` | The captured thought. |
| `source` | `text`, default `'web'` | Where it came from (future: `mcp`, `cli`). |
| `filed` | `boolean`, default `false` | Set true once filed into the brain. |

Partial index for the inbox query (unfiled, newest first):

```sql
create index vbrain_captures_unfiled_idx
  on public.vbrain_captures (created_at desc) where filed = false;
```

## Access model — service-role only

Row-Level Security is **enabled with no policies**, so the public `anon` and
`authenticated` roles can neither read nor write. Only the **service role** (the
`SUPABASE_SERVICE_KEY` held as a Worker secret, used behind the Access gate) can
touch the table. This keeps captures private even though they share a project with
the public portfolio site.

```
Browser ──▶ Access gate ──▶ Worker (service key) ──▶ Supabase REST ──▶ vbrain_captures
                                   ▲ key never reaches the browser
```

## Lifecycle

1. **Add** — `POST /api/capture` → `INSERT` (validated 1–8000 chars, `source:'web'`).
2. **List** — `GET /api/captures` → unfiled rows, newest first, capped at 200.
3. **File** — `POST /api/capture-file` → `PATCH filed = true` for one id. The note
   is then written into the brain by hand or via the `capture` ritual
   ([../../RITUALS.md](../../RITUALS.md)); the row stays as an audit trail.

All three run through `src/captures.js` and require `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY`; otherwise the endpoints return `503` and the UI hides the
capture box.

## Apply / re-apply the migration

Run [`../supabase/vbrain.sql`](../supabase/vbrain.sql) in the Supabase SQL editor
(or via the Management API). It uses `create table if not exists` /
`create index if not exists`, so it's idempotent.

## Not stored here

Everything else — notes, the graph, search, backlinks — is derived at request time
from the Markdown bundle. There is **no** user table, session store, or analytics
DB; the single allowed user is enforced by the Supabase access-token check in the
Worker (`access.js`), not a database. See [SECURITY.md](SECURITY.md).
