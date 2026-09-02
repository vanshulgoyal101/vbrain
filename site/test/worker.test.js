import { describe, it, expect, beforeAll } from 'vitest';
import worker, { api } from '../src/worker.js';

// Minimal ctx stub (waitUntil is a no-op in tests).
const ctx = { waitUntil() {} };
const req = (path, init) => new Request(`https://brain.example.com${path}`, init);

// A caches shim so bundleResponse can run in the router path.
beforeAll(() => { globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }; });

describe('api() dispatch', () => {
  it('/api/me returns the identity + feature flags', async () => {
    const res = await api('/api/me', req('/api/me'), {}, ctx, { email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe('a@b.com');
  });
  it('unknown route → 404', async () => {
    expect((await api('/api/nope', req('/api/nope'), {}, ctx, {})).status).toBe(404);
  });
  it('known route with the wrong method → 404', async () => {
    expect((await api('/api/note', req('/api/note', { method: 'GET' }), {}, ctx, {})).status).toBe(404);
  });
  it('/api/note-append routes to the append handler (503 without a write token)', async () => {
    const res = await api('/api/note-append', req('/api/note-append', { method: 'POST', body: '{}' }), {}, ctx, {});
    expect(res.status).toBe(503);
  });
});

describe('worker routing', () => {
  it('/healthz is public and reports feature flags', async () => {
    const res = await worker.fetch(req('/healthz'), {}, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toMatchObject({ mcp: false, capture: false, edit: false });
    // security headers ride along on JSON responses
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('/healthz reflects configured features', async () => {
    const env = { MCP_TOKEN: 't', SUPABASE_URL: 'u', SUPABASE_SERVICE_KEY: 'k', GITHUB_WRITE_TOKEN: 'w' };
    const body = await (await worker.fetch(req('/healthz'), env, ctx)).json();
    expect(body).toMatchObject({ mcp: true, capture: true, edit: true });
  });

  describe('/mcp', () => {
    it('503 when MCP disabled', async () => {
      const res = await worker.fetch(req('/mcp', { method: 'POST', body: '{}' }), {}, ctx);
      expect(res.status).toBe(503);
    });
    it('405 for non-POST when enabled', async () => {
      const res = await worker.fetch(req('/mcp', { method: 'GET' }), { MCP_TOKEN: 't' }, ctx);
      expect(res.status).toBe(405);
    });
    it('401 with a bad token', async () => {
      const res = await worker.fetch(req('/mcp', { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: '{}' }), { MCP_TOKEN: 't' }, ctx);
      expect(res.status).toBe(401);
    });
    it('handles JSON-RPC with a good token', async () => {
      const res = await worker.fetch(
        req('/mcp', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
        { MCP_TOKEN: 't' }, ctx,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.tools).toHaveLength(4);
    });
  });

  describe('/api/*', () => {
    it('503 when auth is unconfigured (no SUPABASE_URL)', async () => {
      const res = await worker.fetch(req('/api/me'), {}, ctx);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/not configured/);
    });
    it('401 when configured but signed out (no token)', async () => {
      const env = { SUPABASE_URL: 'https://proj.supabase.co', ALLOWED_EMAIL: 'me@x.com' };
      const res = await worker.fetch(req('/api/me'), env, ctx);
      expect(res.status).toBe(401);
    });
    it('unknown /api route 404s (once past the gate is unreachable here)', async () => {
      // Without auth configured every /api path is gated first → 503, proving the gate runs before routing.
      const res = await worker.fetch(req('/api/nope'), {}, ctx);
      expect(res.status).toBe(503);
    });
  });

  describe('/auth/config', () => {
    it('is public and returns supabase url + anon key', async () => {
      const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon' };
      const res = await worker.fetch(req('/auth/config'), env, ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon' });
    });
  });

  describe('static assets', () => {
    it('serves from ASSETS with security headers', async () => {
      const env = { ASSETS: { fetch: async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }) } };
      const res = await worker.fetch(req('/'), env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(await res.text()).toContain('doctype');
    });
    it('falls back to a plain 200 when no ASSETS binding', async () => {
      const res = await worker.fetch(req('/whatever'), {}, ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('brain');
    });
  });
});
