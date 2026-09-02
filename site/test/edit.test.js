import { describe, it, expect, beforeAll } from 'vitest';
import { editEnabled, validNotePath, saveNote, saveNotePR, assertNoteDiscipline, scanSecrets, insertMapRow } from '../src/edit.js';

const ENV = { GH_OWNER: 'o', GH_REPO: 'r', GITHUB_WRITE_TOKEN: 'wtok' };

beforeAll(() => { globalThis.caches = { default: { delete: async () => {}, match: async () => undefined, put: async () => {} } }; });

function mockFetch(seq) {
  let i = 0;
  const calls = [];
  const fn = async (url, init = {}) => { calls.push({ url, init }); const h = seq[Math.min(i, seq.length - 1)]; i++; return h(url, init); };
  fn.calls = calls;
  return fn;
}
const put = (body) => new Request('https://brain/api/note', { method: 'PUT', body: JSON.stringify(body) });
const resp = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

describe('editEnabled', () => {
  it('needs a write token', () => {
    expect(editEnabled(ENV)).toBe(true);
    expect(editEnabled({})).toBe(false);
  });
});

describe('validNotePath', () => {
  it('accepts brain .md paths', () => {
    expect(validNotePath('career/profile.md')).toBe(true);
    expect(validNotePath('README.md')).toBe(true);
  });
  it('rejects traversal, non-md, site/, absolute', () => {
    expect(validNotePath('../secret.md')).toBe(false);
    expect(validNotePath('/etc/passwd')).toBe(false);
    expect(validNotePath('note.txt')).toBe(false);
    expect(validNotePath('site/app.md')).toBe(false);
    expect(validNotePath(42)).toBe(false);
  });
});

describe('saveNote', () => {
  it('503 when editing not configured', async () => {
    expect((await saveNote(put({ path: 'a.md', content: '# A' }), {}, mockFetch([() => resp({})]))).status).toBe(503);
  });
  it('400 on bad path', async () => {
    expect((await saveNote(put({ path: '../x.md', content: '# A' }), ENV, mockFetch([() => resp({})]))).status).toBe(400);
  });
  it('400 on empty content', async () => {
    expect((await saveNote(put({ path: 'a.md', content: '' }), ENV, mockFetch([() => resp({})]))).status).toBe(400);
  });
  it('updates an existing file (uses its sha)', async () => {
    const f = mockFetch([
      () => resp({ sha: 'abc123' }),                       // GET current
      () => resp({ commit: { sha: 'deadbeef' } }, 200),    // PUT
    ]);
    const res = await saveNote(put({ path: 'career/profile.md', content: '# Profile\n> **TL;DR** x\nnew' }), ENV, f);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, commit: 'deadbeef', created: false });
    expect(f.calls[1].init.method).toBe('PUT');
    expect(JSON.parse(f.calls[1].init.body).sha).toBe('abc123');
  });
  it('creates a new file when it does not exist (404)', async () => {
    const f = mockFetch([
      () => resp({ message: 'Not Found' }, 404),
      () => resp({ commit: { sha: 'newsha' } }, 201),
    ]);
    const res = await saveNote(put({ path: 'ideas/new.md', content: '# New\n> **TL;DR** x\nbody' }), ENV, f);
    expect((await res.json()).created).toBe(true);
  });
});

describe('saveNotePR', () => {
  const prReq = (body) => new Request('https://brain/api/note-pr', { method: 'POST', body: JSON.stringify(body) });

  it('503 when editing not configured', async () => {
    expect((await saveNotePR(prReq({ path: 'a.md', content: '# A' }), {}, mockFetch([() => resp({})]))).status).toBe(503);
  });
  it('400 on bad path', async () => {
    expect((await saveNotePR(prReq({ path: 'site/x.md', content: '# A' }), ENV, mockFetch([() => resp({})]))).status).toBe(400);
  });
  it('opens a PR from a fresh branch (ref → branch → sha → put → pull)', async () => {
    const f = mockFetch([
      () => resp({ object: { sha: 'basesha' } }),                     // GET base ref
      () => resp({ ref: 'refs/heads/brain-edit/1' }, 201),            // POST create branch
      () => resp({ sha: 'filesha' }),                                 // GET file sha on branch
      () => resp({ commit: { sha: 'c1' } }, 200),                     // PUT file on branch
      () => resp({ html_url: 'https://gh/pr/7', number: 7 }, 201),    // POST pull
    ]);
    const res = await saveNotePR(prReq({ path: 'career/profile.md', content: '# Profile\n> **TL;DR** x\nedit' }), ENV, f);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, pr: 'https://gh/pr/7', number: 7 });
    expect(f.calls[0].url).toContain('/git/ref/heads/main');
    expect(f.calls[1].url).toContain('/git/refs');
    expect(JSON.parse(f.calls[4].init.body).head).toBe(body.branch);
  });
  it('creates the note on the branch when it does not exist yet (404)', async () => {
    const f = mockFetch([
      () => resp({ object: { sha: 'basesha' } }),
      () => resp({}, 201),
      () => resp({ message: 'Not Found' }, 404),   // file missing → no sha
      () => resp({ commit: { sha: 'c2' } }, 201),
      () => resp({ html_url: 'https://gh/pr/8', number: 8 }, 201),
    ]);
    const res = await saveNotePR(prReq({ path: 'ideas/fresh.md', content: '# Fresh\n> **TL;DR** x\nbody' }), ENV, f);
    expect((await res.json()).number).toBe(8);
    expect(JSON.parse(f.calls[3].init.body).sha).toBeUndefined();
  });
  it('502 when the branch cannot be created', async () => {
    const f = mockFetch([
      () => resp({ object: { sha: 'basesha' } }),
      () => resp({ message: 'boom' }, 422),
    ]);
    expect((await saveNotePR(prReq({ path: 'a.md', content: '# A\n> **TL;DR** x' }), ENV, f)).status).toBe(502);
  });
});

describe('assertNoteDiscipline', () => {
  it('passes a well-formed note', () => {
    expect(assertNoteDiscipline('# Title\n> **TL;DR** one line\n\nbody')).toBeNull();
  });
  it('requires an H1', () => {
    expect(assertNoteDiscipline('no title\n> **TL;DR** x')).toMatch(/H1/);
  });
  it('requires a TL;DR blockquote near the top', () => {
    expect(assertNoteDiscipline('# Title\njust body, no tldr')).toMatch(/TL;DR/);
  });
  it('blocks secrets', () => {
    // token built at runtime so no literal secret-shaped string sits in source
    expect(assertNoteDiscipline('# Title\n> **TL;DR** x\nkey ' + 'ghp_' + 'A'.repeat(36))).toMatch(/GitHub token/);
  });
});

describe('scanSecrets', () => {
  it('flags a Supabase PAT and clears clean text', () => {
    // built at runtime so no literal secret-shaped string sits in source
    expect(scanSecrets('sbp_' + '0'.repeat(40))).toMatch(/Supabase/);
    expect(scanSecrets('nothing secret here')).toBeNull();
  });
});

describe('insertMapRow', () => {
  const MAP = '# MAP\n\n## Career\n\n| Key | Path | Summary |\n|-----|------|---------|\n| `career.profile` | [career/profile.md](career/profile.md) | Profile. |\n\n## Projects\n\n| Key | Path | Summary |\n|-----|------|---------|\n| `projects.pixelpaws` | [projects/pixelpaws.md](projects/pixelpaws.md) | PixelPaws. |\n';
  it('adds a row under the right section', () => {
    const out = insertMapRow(MAP, 'career/runway.md', 'Runway');
    expect(out).toContain('[career/runway.md](career/runway.md)');
    // inserted inside the Career table, before the Projects heading
    expect(out.indexOf('career/runway.md')).toBeLessThan(out.indexOf('## Projects'));
  });
  it('returns null when already registered', () => {
    expect(insertMapRow(MAP, 'career/profile.md', 'Profile')).toBeNull();
  });
});
