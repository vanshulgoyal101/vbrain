// Inline edit → commit to the private repo. Optional, feature-gated on a
// SEPARATE write-scoped token (GITHUB_WRITE_TOKEN) so the read token stays
// read-only. Writes go straight to the default branch (solo brain, no reviewer);
// CI validates the commit on push.

import { json } from './http.js';
import { purgeBundle } from './content.js';

export function editEnabled(env) {
  return Boolean(env.GITHUB_WRITE_TOKEN);
}

// UTF-8 safe base64 for the GitHub Contents API (no deprecated unescape()).
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Decode base64 (the Contents API returns it wrapped with newlines) → UTF-8 text.
function fromBase64(b64) {
  const bin = atob((b64 || '').replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Secret/PII guard on the write path — mirrors scripts/validate.mjs so a note
// committed via the UI/bot is held to the same "never store secrets" rule.
const SECRET_PATTERNS = [
  [/\bAIza[0-9A-Za-z_\-]{20,}\b/, 'Google API key'],
  [/\bsk-[A-Za-z0-9]{20,}\b/, 'OpenAI-style secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\bsbp_[A-Za-z0-9]{20,}\b/, 'Supabase PAT'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/, 'PAN number (PII)'],
  [/\b\d{4}\s\d{4}\s\d{4}\b/, 'Aadhaar-like 12-digit number (PII)'],
];

export function scanSecrets(text) {
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}

// The same discipline validate.mjs enforces, applied before a full-note write:
// H1 first, a TL;DR blockquote near the top, and no secrets. Returns an error
// string, or null when the note is well-formed.
export function assertNoteDiscipline(content) {
  const lines = content.split('\n');
  const firstNonBlank = lines.find((l) => l.trim());
  if (!firstNonBlank || !/^#\s+\S/.test(firstNonBlank)) return 'note needs an "# H1" title on the first line';
  if (!lines.slice(0, 6).some((l) => l.startsWith('> '))) return 'note needs a "> TL;DR" blockquote in the first 6 lines';
  const secret = scanSecrets(content);
  if (secret) return `possible ${secret} — remove it before saving`;
  return null;
}

// Pure: add a MAP.md row for a brand-new note under its section table. Returns
// the updated MAP text, or null if it's already registered / the table is absent.
const MAP_HEADINGS = { '': '## Entry points', career: '## Career', projects: '## Projects', ideas: '## Ideas', learnings: '## Learnings', infra: '## Infra' };
const MAP_KEY_ABBR = { career: 'career', projects: 'projects', ideas: 'ideas', learnings: 'learn', infra: 'infra' };
export function insertMapRow(mapText, path, title) {
  if (mapText.includes(`](${path})`)) return null; // already on the map
  const section = path.includes('/') ? path.split('/')[0] : '';
  const heading = MAP_HEADINGS[section] || '## Entry points';
  const slug = path.split('/').pop().replace(/\.md$/, '');
  const key = section ? `${MAP_KEY_ABBR[section] || section}.${slug}` : slug;
  const row = `| \`${key}\` | [${path}](${path}) | ${title}. |`;
  const lines = mapText.split('\n');
  const hIdx = lines.findIndex((l) => l.trim() === heading);
  if (hIdx === -1) return null;
  let i = hIdx + 1;
  while (i < lines.length && !lines[i].startsWith('|')) { if (lines[i].startsWith('## ')) return null; i++; }
  if (i >= lines.length) return null;
  let last = i;
  while (last + 1 < lines.length && lines[last + 1].startsWith('|')) last++;
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}

// A brain note path is a repo-relative *.md, no traversal, not in site/.
export function validNotePath(path) {
  return typeof path === 'string'
    && path.endsWith('.md')
    && !path.startsWith('/')
    && !path.includes('..')
    && !path.startsWith('site/')
    && !path.includes('\0');
}

export async function saveNote(request, env, fetchImpl = fetch) {
  if (!editEnabled(env)) return json({ error: 'editing not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const path = body.path;
  const content = body.content;
  if (!validNotePath(path)) return json({ error: 'bad path' }, 400);
  if (typeof content !== 'string' || content.length === 0) return json({ error: 'empty content' }, 400);
  if (content.length > 200_000) return json({ error: 'too large' }, 400);
  const bad = assertNoteDiscipline(content);
  if (bad) return json({ error: bad }, 400);

  const { GH_OWNER, GH_REPO, GH_BRANCH = 'main', GITHUB_WRITE_TOKEN } = env;
  const base = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_WRITE_TOKEN}`, 'User-Agent': 'vbrain', Accept: 'application/vnd.github+json' };

  // Current sha (if the file exists) is required to update it.
  let sha;
  const head = await fetchImpl(`${base}?ref=${GH_BRANCH}`, { headers });
  if (head.ok) sha = (await head.json()).sha;
  else if (head.status !== 404) return json({ error: `github ${head.status}` }, 502);

  const put = await fetchImpl(base, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: (body.message || `edit ${path} via brain`).slice(0, 200),
      content: toBase64(content),
      branch: GH_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) return json({ error: `github ${put.status}` }, 502);
  const data = await put.json();
  // A brand-new note self-registers in MAP.md so it's never an orphan (best-effort).
  let mapRegistered = false;
  if (!sha) {
    const m = content.match(/^#\s+(.+)$/m);
    try { mapRegistered = await ensureMapEntry(env, path, m ? m[1].trim() : path, fetchImpl); } catch {}
  }
  await purgeBundle();
  return json({ ok: true, path, commit: data.commit?.sha, created: !sha, mapRegistered });
}

// Alternative to a direct commit: open a PR from a fresh branch. Same write token;
// leaves `main` untouched until the PR is merged (so no bundle purge here).
export async function saveNotePR(request, env, fetchImpl = fetch) {
  if (!editEnabled(env)) return json({ error: 'editing not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const { path, content } = body;
  if (!validNotePath(path)) return json({ error: 'bad path' }, 400);
  if (typeof content !== 'string' || content.length === 0) return json({ error: 'empty content' }, 400);
  if (content.length > 200_000) return json({ error: 'too large' }, 400);
  const bad = assertNoteDiscipline(content);
  if (bad) return json({ error: bad }, 400);

  const { GH_OWNER, GH_REPO, GH_BRANCH = 'main', GITHUB_WRITE_TOKEN } = env;
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`;
  const headers = { Authorization: `Bearer ${GITHUB_WRITE_TOKEN}`, 'User-Agent': 'vbrain', Accept: 'application/vnd.github+json', 'content-type': 'application/json' };

  // 1. resolve the base branch head.
  const ref = await fetchImpl(`${api}/git/ref/heads/${GH_BRANCH}`, { headers });
  if (!ref.ok) return json({ error: `github ${ref.status}` }, 502);
  const baseSha = (await ref.json()).object?.sha;

  // 2. create a working branch off it.
  const branch = `brain-edit/${Date.now()}`;
  const mkref = await fetchImpl(`${api}/git/refs`, { method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }) });
  if (!mkref.ok) return json({ error: `github ${mkref.status}` }, 502);

  // 3. current file sha on the branch (if the note already exists).
  let sha;
  const head = await fetchImpl(`${api}/contents/${path}?ref=${branch}`, { headers });
  if (head.ok) sha = (await head.json()).sha;
  else if (head.status !== 404) return json({ error: `github ${head.status}` }, 502);

  // 4. commit the edit to the branch.
  const put = await fetchImpl(`${api}/contents/${path}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ message: (body.message || `edit ${path} via brain`).slice(0, 200), content: toBase64(content), branch, ...(sha ? { sha } : {}) }),
  });
  if (!put.ok) return json({ error: `github ${put.status}` }, 502);

  // 5. open the pull request.
  const pr = await fetchImpl(`${api}/pulls`, {
    method: 'POST', headers,
    body: JSON.stringify({ title: (body.message || `edit ${path}`).slice(0, 200), head: branch, base: GH_BRANCH, body: `Proposed edit to \`${path}\` via the brain UI.` }),
  });
  if (!pr.ok) return json({ error: `github ${pr.status}` }, 502);
  const data = await pr.json();
  return json({ ok: true, path, pr: data.html_url, number: data.number, branch });
}

// Best-effort: register a new note in MAP.md with its own commit so the brain
// stays fully indexed. Returns true if a row was added.
export async function ensureMapEntry(env, path, title, fetchImpl = fetch) {
  const { GH_OWNER, GH_REPO, GH_BRANCH = 'main', GITHUB_WRITE_TOKEN } = env;
  const base = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/MAP.md`;
  const headers = { Authorization: `Bearer ${GITHUB_WRITE_TOKEN}`, 'User-Agent': 'vbrain', Accept: 'application/vnd.github+json' };
  const head = await fetchImpl(`${base}?ref=${GH_BRANCH}`, { headers });
  if (!head.ok) return false;
  const cur = await head.json();
  const next = insertMapRow(fromBase64(cur.content), path, title);
  if (!next) return false;
  const put = await fetchImpl(base, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ message: `register ${path} in MAP`.slice(0, 200), content: toBase64(next), branch: GH_BRANCH, sha: cur.sha }),
  });
  return put.ok;
}

// Append a captured thought into an EXISTING note as a dated bullet — the "file a
// capture into the brain" write. Append-only (never rewrites the note),
// secret-scanned, path-guarded. New notes go through saveNote instead.
export async function appendToNote(request, env, fetchImpl = fetch) {
  if (!editEnabled(env)) return json({ error: 'editing not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const path = body.path;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!validNotePath(path)) return json({ error: 'bad path' }, 400);
  if (!text) return json({ error: 'empty' }, 400);
  if (text.length > 8000) return json({ error: 'too long' }, 400);
  const secret = scanSecrets(text);
  if (secret) return json({ error: `possible ${secret} — remove it` }, 400);

  const { GH_OWNER, GH_REPO, GH_BRANCH = 'main', GITHUB_WRITE_TOKEN } = env;
  const base = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_WRITE_TOKEN}`, 'User-Agent': 'vbrain', Accept: 'application/vnd.github+json' };

  const head = await fetchImpl(`${base}?ref=${GH_BRANCH}`, { headers });
  if (head.status === 404) return json({ error: 'note not found' }, 404);
  if (!head.ok) return json({ error: `github ${head.status}` }, 502);
  const cur = await head.json();
  const date = new Date().toISOString().slice(0, 10);
  const next = `${fromBase64(cur.content).replace(/\s*$/, '')}\n- ${text} (${date})\n`;

  const put = await fetchImpl(base, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ message: `file capture into ${path}`.slice(0, 200), content: toBase64(next), branch: GH_BRANCH, sha: cur.sha }),
  });
  if (!put.ok) return json({ error: `github ${put.status}` }, 502);
  const data = await put.json();
  await purgeBundle();
  return json({ ok: true, path, commit: data.commit?.sha });
}
