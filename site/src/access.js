// Supabase Auth verification — the Worker's security gate. The frontend signs in
// with Supabase (Google OAuth), then sends the Supabase access token as a Bearer
// header on every /api call. We verify that token (ES256 via Supabase's public
// JWKS) and only serve content when the email matches ALLOWED_EMAIL. Anyone else
// who signs in gets 403; no token gets 401. See docs/SECURITY.md.

import { b64urlToBytes, b64urlToText } from './http.js';

let JWKS_CACHE = { at: 0, url: null, keys: null };

// Pure: split + decode a JWT. Throws on malformed input.
export function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('malformed jwt');
  const [h, p, s] = parts;
  const header = JSON.parse(b64urlToText(h));
  const payload = JSON.parse(b64urlToText(p));
  return { header, payload, signingInput: `${h}.${p}`, signature: b64urlToBytes(s) };
}

export async function getJwks(url, fetchImpl = fetch) {
  if (JWKS_CACHE.keys && JWKS_CACHE.url === url && Date.now() - JWKS_CACHE.at < 3600_000) return JWKS_CACHE.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error('jwks fetch failed');
  const { keys } = await res.json();
  JWKS_CACHE = { at: Date.now(), url, keys };
  return keys;
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// deps: { jwks, now, subtle, fetchImpl } — injectable for testing.
export async function verifyAccess(request, env, deps = {}) {
  const supaUrl = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const allowed = (env.ALLOWED_EMAIL || '').toLowerCase();
  if (!supaUrl) return { ok: false, status: 503, error: 'auth not configured (SUPABASE_URL)' };
  if (!allowed) return { ok: false, status: 503, error: 'ALLOWED_EMAIL not set' };

  const token = bearer(request);
  if (!token) return { ok: false, status: 401, error: 'not signed in' };

  const now = deps.now || (() => Math.floor(Date.now() / 1000));
  const subtle = deps.subtle || crypto.subtle;

  let header, payload, signingInput, signature;
  try {
    ({ header, payload, signingInput, signature } = parseJwt(token));
  } catch {
    return { ok: false, status: 401, error: 'malformed token' };
  }

  if (header.alg !== 'ES256') return { ok: false, status: 401, error: 'unexpected alg' };

  let keys;
  try {
    keys = deps.jwks || (await getJwks(`${supaUrl}/auth/v1/.well-known/jwks.json`, deps.fetchImpl));
  } catch {
    return { ok: false, status: 502, error: 'jwks unavailable' };
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, status: 401, error: 'unknown signing key' };

  let valid = false;
  try {
    const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(signingInput));
  } catch {
    return { ok: false, status: 401, error: 'verify error' };
  }
  if (!valid) return { ok: false, status: 401, error: 'bad signature' };

  if (payload.exp && now() > payload.exp) return { ok: false, status: 401, error: 'token expired' };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes('authenticated')) return { ok: false, status: 401, error: 'wrong audience' };
  if (payload.iss && payload.iss !== `${supaUrl}/auth/v1`) return { ok: false, status: 401, error: 'wrong issuer' };
  // The one-user gate: any Google account can sign in to Supabase, but only the
  // owner's email is ever served content.
  if ((payload.email || '').toLowerCase() !== allowed) return { ok: false, status: 403, error: 'email not allowed' };

  return { ok: true, email: payload.email };
}

// test-only: reset the module JWKS cache
export function _resetJwksCache() { JWKS_CACHE = { at: 0, url: null, keys: null }; }
