import { describe, it, expect, beforeAll } from 'vitest';
import { recentEnabled, shapeCommits, fetchRecent, recentResponse } from '../src/recent.js';

const RAW = [
  { sha: 'abcdef1234567890', html_url: 'https://gh/c/abcdef1', commit: { message: 'docs: add gaps\n\nbody', author: { date: '2026-08-16T10:00:00Z', name: 'Alex Rivera' } } },
  { sha: '0987654321fedcba', html_url: 'https://gh/c/0987654', commit: { message: 'feat: healthz', committer: { date: '2026-08-15T09:00:00Z' } } },
];

describe('recentEnabled', () => {
  it('needs a read token', () => {
    expect(recentEnabled({ GITHUB_TOKEN: 't' })).toBe(true);
    expect(recentEnabled({})).toBe(false);
  });
});

describe('shapeCommits', () => {
  it('shortens shas, takes the first message line, and picks a date', () => {
    const out = shapeCommits(RAW);
    expect(out[0]).toMatchObject({ sha: 'abcdef1', message: 'docs: add gaps', author: 'Alex Rivera', url: 'https://gh/c/abcdef1' });
    expect(out[0].date).toBe('2026-08-16T10:00:00Z');
    expect(out[1].date).toBe('2026-08-15T09:00:00Z'); // committer-date fallback
  });
  it('respects the limit and tolerates junk', () => {
    expect(shapeCommits(RAW, 1)).toHaveLength(1);
    expect(shapeCommits(null)).toEqual([]);
  });
});

describe('fetchRecent', () => {
  it('calls the commits API and shapes the result', async () => {
    let calledUrl;
    const fetchImpl = async (url) => { calledUrl = url; return new Response(JSON.stringify(RAW), { status: 200 }); };
    const out = await fetchRecent({ GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' }, fetchImpl);
    expect(calledUrl).toContain('/repos/o/r/commits?sha=main');
    expect(out[0].sha).toBe('abcdef1');
  });
  it('throws without a token', async () => {
    await expect(fetchRecent({ GH_OWNER: 'o', GH_REPO: 'r' }, async () => new Response('[]'))).rejects.toThrow(/secret not set/);
  });
  it('throws on a github error', async () => {
    await expect(fetchRecent({ GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' }, async () => new Response('', { status: 403 }))).rejects.toThrow(/github 403/);
  });
});

describe('recentResponse', () => {
  beforeAll(() => { globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }; });
  it('503 when not configured', async () => {
    const res = await recentResponse({}, null, async () => new Response('[]'));
    expect(res.status).toBe(503);
  });
  it('200 with commits on success', async () => {
    const res = await recentResponse({ GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' }, null, async () => new Response(JSON.stringify(RAW), { status: 200 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commits).toHaveLength(2);
    expect(body.commits[0].message).toBe('docs: add gaps');
  });
  it('502 on upstream error', async () => {
    const res = await recentResponse({ GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' }, null, async () => new Response('', { status: 500 }));
    expect(res.status).toBe(502);
  });
});
