import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { parseJwt, verifyAccess, getJwks, _resetJwksCache } from '../src/access.js';

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(enc.encode(s));

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', ALLOWED_EMAIL: 'owner@example.com' };
const ISS = 'https://proj.supabase.co/auth/v1';

let keyPair, jwk;

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = 'test-kid';
  jwk.alg = 'ES256';
});

// Build a Supabase-shaped access token (ES256).
async function makeToken({ email = ENV.ALLOWED_EMAIL, aud = 'authenticated', iss = ISS, exp = Math.floor(Date.now() / 1000) + 3600, alg = 'ES256', kid = 'test-kid', sign = true } = {}) {
  const head = b64urlStr(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64urlStr(JSON.stringify({ email, aud, iss, exp, role: 'authenticated' }));
  const signingInput = `${head}.${body}`;
  const sig = sign
    ? await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, enc.encode(signingInput))
    : enc.encode('x'.repeat(64));
  return `${signingInput}.${b64url(sig)}`;
}

const reqWith = (token) => new Request('https://brain/api/me', token ? { headers: { Authorization: `Bearer ${token}` } } : {});
const deps = { now: () => Math.floor(Date.now() / 1000) };

describe('parseJwt', () => {
  it('parses a well-formed token', async () => {
    const { header, payload } = parseJwt(await makeToken());
    expect(header.alg).toBe('ES256');
    expect(payload.email).toBe(ENV.ALLOWED_EMAIL);
  });
  it('throws on malformed', () => expect(() => parseJwt('a.b')).toThrow());
});

describe('verifyAccess (Supabase)', () => {
  beforeAll(() => _resetJwksCache());

  it('503 when auth not configured', async () => {
    expect(await verifyAccess(reqWith('x'), {})).toMatchObject({ ok: false, status: 503 });
  });
  it('401 with no token', async () => {
    expect(await verifyAccess(reqWith(null), ENV, { jwks: [jwk] })).toMatchObject({ ok: false, status: 401 });
  });
  it('accepts a valid token for the allowed email', async () => {
    const r = await verifyAccess(reqWith(await makeToken()), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: true, email: ENV.ALLOWED_EMAIL });
  });
  it('403 for a different signed-in email', async () => {
    const r = await verifyAccess(reqWith(await makeToken({ email: 'someone@else.com' })), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, status: 403, error: 'email not allowed' });
  });
  it('rejects wrong audience', async () => {
    const r = await verifyAccess(reqWith(await makeToken({ aud: 'nope' })), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, error: 'wrong audience' });
  });
  it('rejects a wrong issuer', async () => {
    const r = await verifyAccess(reqWith(await makeToken({ iss: 'https://evil.example/auth/v1' })), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, error: 'wrong issuer' });
  });
  it('rejects expired tokens', async () => {
    const r = await verifyAccess(reqWith(await makeToken({ exp: 1 })), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, error: 'token expired' });
  });
  it('rejects a non-ES256 alg', async () => {
    const r = await verifyAccess(reqWith(await makeToken({ alg: 'HS256' })), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, error: 'unexpected alg' });
  });
  it('rejects an unknown signing key', async () => {
    const r = await verifyAccess(reqWith(await makeToken({ kid: 'other' })), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, error: 'unknown signing key' });
  });
  it('rejects a bad signature', async () => {
    const r = await verifyAccess(reqWith(await makeToken({ sign: false })), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, error: 'bad signature' });
  });

  it('503 when ALLOWED_EMAIL is unset', async () => {
    const r = await verifyAccess(reqWith(await makeToken()), { SUPABASE_URL: ENV.SUPABASE_URL }, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it('401 on a malformed token', async () => {
    const r = await verifyAccess(reqWith('not-a-jwt'), ENV, { ...deps, jwks: [jwk] });
    expect(r).toMatchObject({ ok: false, status: 401, error: 'malformed token' });
  });
  it('401 when the key cannot be imported (verify error)', async () => {
    const subtle = { importKey: async () => { throw new Error('bad key'); }, verify: async () => true };
    const r = await verifyAccess(reqWith(await makeToken()), ENV, { ...deps, jwks: [jwk], subtle });
    expect(r).toMatchObject({ ok: false, status: 401, error: 'verify error' });
  });
});

describe('getJwks', () => {
  beforeEach(() => _resetJwksCache());

  it('fetches the key set and caches it for later calls', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }); };
    const url = 'https://proj.supabase.co/auth/v1/.well-known/jwks.json';
    expect(await getJwks(url, fetchImpl)).toEqual([jwk]);
    expect(await getJwks(url, fetchImpl)).toEqual([jwk]);
    expect(calls).toBe(1);
  });
  it('refetches when the URL changes', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }); };
    await getJwks('https://a/jwks.json', fetchImpl);
    await getJwks('https://b/jwks.json', fetchImpl);
    expect(calls).toBe(2);
  });
  it('throws when the key set cannot be fetched', async () => {
    const fetchImpl = async () => new Response('nope', { status: 500 });
    await expect(getJwks('https://proj/jwks.json', fetchImpl)).rejects.toThrow(/jwks fetch failed/);
  });
  it('surfaces as 502 through verifyAccess', async () => {
    const fetchImpl = async () => new Response('nope', { status: 500 });
    const r = await verifyAccess(reqWith(await makeToken()), ENV, { ...deps, fetchImpl });
    expect(r).toMatchObject({ ok: false, status: 502, error: 'jwks unavailable' });
  });
  it('verifies end to end against a fetched key set', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    const r = await verifyAccess(reqWith(await makeToken()), ENV, { ...deps, fetchImpl });
    expect(r).toMatchObject({ ok: true, email: ENV.ALLOWED_EMAIL });
  });
});
