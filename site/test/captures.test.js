import { describe, it, expect } from 'vitest';
import { captureEnabled, supa, listCaptures, addCapture, fileCapture } from '../src/captures.js';

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_KEY: 'svc-key' };

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => { calls.push({ url, init }); return handler(url, init); };
  fn.calls = calls;
  return fn;
}
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

describe('captureEnabled', () => {
  it('is true only with url + key', () => {
    expect(captureEnabled(ENV)).toBe(true);
    expect(captureEnabled({ SUPABASE_URL: 'x' })).toBe(false);
    expect(captureEnabled({})).toBe(false);
  });
});

describe('supa', () => {
  it('builds the REST URL with service headers', async () => {
    const f = mockFetch(() => ok([]));
    await supa(ENV, 'vbrain_captures?x=1', { method: 'GET' }, f);
    expect(f.calls[0].url).toBe('https://proj.supabase.co/rest/v1/vbrain_captures?x=1');
    expect(f.calls[0].init.headers.apikey).toBe('svc-key');
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer svc-key');
  });
});

describe('listCaptures', () => {
  it('503 when not configured', async () => {
    expect((await listCaptures({}, mockFetch(() => ok([])))).status).toBe(503);
  });
  it('returns captures', async () => {
    const res = await listCaptures(ENV, mockFetch(() => ok([{ id: 1, text: 'hi', created_at: 'now' }])));
    expect((await res.json()).captures).toHaveLength(1);
  });
});

describe('addCapture', () => {
  const post = (body) => new Request('https://brain/api/capture', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  it('rejects empty text', async () => {
    expect((await addCapture(post({ text: '   ' }), ENV, mockFetch(() => ok([])))).status).toBe(400);
  });
  it('rejects overly long text', async () => {
    expect((await addCapture(post({ text: 'x'.repeat(9000) }), ENV, mockFetch(() => ok([])))).status).toBe(400);
  });
  it('inserts and returns the row', async () => {
    const f = mockFetch(() => new Response(JSON.stringify([{ id: 5, text: 'note' }]), { status: 201 }));
    const res = await addCapture(post({ text: 'note' }), ENV, f);
    expect(res.status).toBe(200);
    expect((await res.json()).capture.id).toBe(5);
    expect(f.calls[0].init.method).toBe('POST');
  });
});

describe('fileCapture', () => {
  const post = (body) => new Request('https://brain/api/capture-file', { method: 'POST', body: JSON.stringify(body) });
  it('rejects bad id', async () => {
    expect((await fileCapture(post({ id: 'nope' }), ENV, mockFetch(() => ok({})))).status).toBe(400);
  });
  it('patches filed=true', async () => {
    const f = mockFetch(() => ok({}));
    const res = await fileCapture(post({ id: 7 }), ENV, f);
    expect(res.status).toBe(200);
    expect(f.calls[0].url).toContain('id=eq.7');
    expect(f.calls[0].init.method).toBe('PATCH');
  });
});
