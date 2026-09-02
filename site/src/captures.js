// Quick-capture inbox — private, service-role-only access to Supabase.
// The service key never reaches the browser; all calls are Access-gated.

import { json } from './http.js';

export function captureEnabled(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

export function supa(env, path, init = {}, fetchImpl = fetch) {
  return fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export async function listCaptures(env, fetchImpl = fetch) {
  if (!captureEnabled(env)) return json({ error: 'capture not configured' }, 503);
  const r = await supa(env, 'vbrain_captures?filed=eq.false&select=id,text,created_at&order=created_at.desc&limit=200', {}, fetchImpl);
  if (!r.ok) return json({ error: `supabase ${r.status}` }, 502);
  return json({ captures: await r.json() });
}

// Shared insert used by the browser capture box (addCapture) with the same
// validation/limits. Returns a structured result; the caller shapes its response.
export async function insertCapture(env, text, source = 'web', fetchImpl = fetch) {
  if (!captureEnabled(env)) return { ok: false, status: 503, error: 'capture not configured' };
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { ok: false, status: 400, error: 'empty' };
  if (t.length > 8000) return { ok: false, status: 400, error: 'too long' };
  const r = await supa(env, 'vbrain_captures', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ text: t, source }) }, fetchImpl);
  if (!r.ok) return { ok: false, status: 502, error: `supabase ${r.status}` };
  const rows = await r.json();
  return { ok: true, capture: rows[0] };
}

export async function addCapture(request, env, fetchImpl = fetch) {
  const body = await request.json().catch(() => ({}));
  const res = await insertCapture(env, body.text, 'web', fetchImpl);
  if (!res.ok) return json({ error: res.error }, res.status);
  return json({ ok: true, capture: res.capture });
}

export async function fileCapture(request, env, fetchImpl = fetch) {
  if (!captureEnabled(env)) return json({ error: 'capture not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const id = parseInt(body.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad id' }, 400);
  const r = await supa(env, `vbrain_captures?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ filed: true }) }, fetchImpl);
  if (!r.ok) return json({ error: `supabase ${r.status}` }, 502);
  return json({ ok: true });
}
