import { describe, it, expect } from 'vitest';
import { json, cookie, b64urlToBytes, b64urlToText, securityHeaders, withSecurity } from '../src/http.js';

describe('json', () => {
  it('sets status, content-type, and security headers', async () => {
    const res = json({ a: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe('securityHeaders', () => {
  it('locks down framing and sources', () => {
    const h = securityHeaders();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain("object-src 'none'");
    expect(h['content-security-policy']).toContain("worker-src 'self'");
    expect(h['content-security-policy']).toContain("manifest-src 'self'");
  });
});

describe('withSecurity', () => {
  it('adds security headers to an existing response', () => {
    const res = withSecurity(new Response('hi', { headers: { 'content-type': 'text/html' } }));
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('content-type')).toBe('text/html');
  });
});

describe('cookie', () => {
  it('reads a named cookie', () => {
    const req = new Request('https://x/', { headers: { Cookie: 'a=1; CF_Authorization=tok; b=2' } });
    expect(cookie(req, 'CF_Authorization')).toBe('tok');
    expect(cookie(req, 'missing')).toBe(null);
  });
});

describe('base64url', () => {
  it('round-trips text', () => {
    const s = 'héllo-世界_{}';
    const b = b64urlToText(Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    expect(b).toBe(s);
  });
  it('decodes bytes without padding', () => {
    expect(Array.from(b64urlToBytes('AAAA'))).toEqual([0, 0, 0]);
  });
});
