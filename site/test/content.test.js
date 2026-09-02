import { describe, it, expect, beforeAll } from 'vitest';
import { parseTar, selectBrainFiles, fetchBundle, bundleResponse } from '../src/content.js';
import { makeTar, gzip } from './helpers.js';

const enc = new TextEncoder();

describe('parseTar', () => {
  it('extracts file names and contents', () => {
    const tar = makeTar({ 'repo/a.md': '# A', 'repo/b.txt': 'hi' });
    const out = parseTar(tar);
    expect(new TextDecoder().decode(out['repo/a.md'])).toBe('# A');
    expect(new TextDecoder().decode(out['repo/b.txt'])).toBe('hi');
  });
});

describe('selectBrainFiles', () => {
  it('strips the top folder and keeps only brain .md files', () => {
    const raw = {
      'owner-repo-sha/README.md': enc.encode('# R'),
      'owner-repo-sha/career/profile.md': enc.encode('# P'),
      'owner-repo-sha/site/README.md': enc.encode('# skip'),
      'owner-repo-sha/x.txt': enc.encode('skip'),
      'owner-repo-sha/node_modules/y.md': enc.encode('skip'),
    };
    const out = selectBrainFiles(raw);
    expect(Object.keys(out).sort()).toEqual(['README.md', 'career/profile.md']);
    expect(out['README.md']).toBe('# R');
  });
});

describe('fetchBundle', () => {
  it('downloads, gunzips, and selects brain files', async () => {
    const tar = makeTar({ 'o-r-sha/README.md': '# R', 'o-r-sha/site/app.md': 'skip', 'o-r-sha/career/x.md': '# X' });
    const gz = await gzip(tar);
    const fetchImpl = async () => new Response(gz, { status: 200 });
    const files = await fetchBundle({ GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' }, fetchImpl);
    expect(Object.keys(files).sort()).toEqual(['README.md', 'career/x.md']);
  });
  it('throws without a token', async () => {
    await expect(fetchBundle({ GH_OWNER: 'o', GH_REPO: 'r' }, async () => new Response('', { status: 200 }))).rejects.toThrow(/secret not set/);
  });
  it('throws on github error', async () => {
    await expect(fetchBundle({ GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' }, async () => new Response('', { status: 404 }))).rejects.toThrow(/github 404/);
  });
});

describe('bundleResponse', () => {
  beforeAll(() => { globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }; });

  it('503 when token missing', async () => {
    const res = await bundleResponse({ GH_OWNER: 'o', GH_REPO: 'r' }, null, async () => new Response('', { status: 200 }));
    expect(res.status).toBe(503);
  });
  it('returns files on success', async () => {
    const gz = await gzip(makeTar({ 'o-r-sha/now.md': '# Now' }));
    const res = await bundleResponse({ GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' }, null, async () => new Response(gz, { status: 200 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.files['now.md']).toBe('# Now');
  });
});
