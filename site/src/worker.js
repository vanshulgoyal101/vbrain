// The brain's private second-brain backend (Cloudflare Worker).
//
// Security:
//   1. The browser signs in via Supabase Google OAuth and sends the access token
//      as `Authorization: Bearer <token>` on every /api request.
//   2. This Worker verifies the token (ES256 via Supabase JWKS: aud/iss/exp) and
//      checks the email claim == ALLOWED_EMAIL (see access.js); anyone else → 403.
//      Strict security headers are set on every response.
// Content is fetched live from the PRIVATE vbrain repo (content.js). Captures use
// the existing Supabase project, service-role only (captures.js).
//
// Docs: site/docs/ARCHITECTURE.md, SECURITY.md, API.md.

import { json, withSecurity } from './http.js';
import { verifyAccess } from './access.js';
import { bundleResponse } from './content.js';
import { captureEnabled, listCaptures, addCapture, fileCapture } from './captures.js';
import { editEnabled, saveNote, saveNotePR, appendToNote } from './edit.js';
import { recentResponse, recentEnabled } from './recent.js';
import { handleMcp } from './mcp.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Liveness probe — no secrets, no auth. (Behind edge Access on the custom
    // domain; add an Access bypass for /healthz to monitor externally.)
    if (url.pathname === '/healthz') {
      return json({ ok: true, service: 'vbrain', auth: Boolean(env.SUPABASE_URL && env.ALLOWED_EMAIL), mcp: Boolean(env.MCP_TOKEN), capture: captureEnabled(env), edit: editEnabled(env), recent: recentEnabled(env) });
    }

    // Public auth bootstrap — the frontend needs the Supabase URL + publishable
    // anon key to run the Google sign-in flow. Neither is a secret.
    if (url.pathname === '/auth/config') {
      return json({ supabaseUrl: env.SUPABASE_URL || null, anonKey: env.SUPABASE_ANON_KEY || null });
    }

    // MCP endpoint: bearer-token auth (agents can't do interactive Access).
    if (url.pathname === '/mcp') {
      if (!env.MCP_TOKEN) return json({ error: 'mcp disabled' }, 503);
      if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
      if ((request.headers.get('Authorization') || '') !== `Bearer ${env.MCP_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      return await handleMcp(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      const auth = await verifyAccess(request, env);
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      try {
        return await api(url.pathname, request, env, ctx, auth);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 502);
      }
    }

    if (env.ASSETS) return withSecurity(await env.ASSETS.fetch(request));
    return new Response('brain', { status: 200 });
  },
};

// Routes an authenticated /api/* request. Exported for unit tests.
export async function api(path, request, env, ctx, auth) {
  const method = request.method;
  if (path === '/api/me' && method === 'GET') return json({ email: auth.email, capture: captureEnabled(env), edit: editEnabled(env), recent: recentEnabled(env) });
  if (path === '/api/bundle' && method === 'GET') return await bundleResponse(env, ctx);
  if (path === '/api/recent' && method === 'GET') return await recentResponse(env, ctx);
  if (path === '/api/captures' && method === 'GET') return await listCaptures(env);
  if (path === '/api/capture' && method === 'POST') return await addCapture(request, env);
  if (path === '/api/capture-file' && method === 'POST') return await fileCapture(request, env);
  if (path === '/api/note' && method === 'PUT') return await saveNote(request, env);
  if (path === '/api/note-pr' && method === 'POST') return await saveNotePR(request, env);
  if (path === '/api/note-append' && method === 'POST') return await appendToNote(request, env);
  return json({ error: 'not found' }, 404);
}
