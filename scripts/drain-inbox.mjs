#!/usr/bin/env node
// Drain the capture inbox — list every unfiled capture with the best target notes
// to file it into, so the inbox never becomes a graveyard. Read-only by design
// (a safe ritual): it suggests, you file via the brain UI (#/inbox) or an edit.
//
// Usage:
//   node scripts/drain-inbox.mjs            # human plan (capture -> suggested notes)
//   node scripts/drain-inbox.mjs --json     # machine-readable
//   node scripts/drain-inbox.mjs --limit 50 # cap how many captures to pull
//
// Credentials (first that resolves wins):
//   • env SUPABASE_URL + SUPABASE_SERVICE_KEY, or
//   • env SUPABASE_TOKEN (a Supabase management PAT), or the SUPABASE_TOKEN in
//     ../arcade/.env — used to reveal the project's service_role key.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankHits, titleOf } from '../site/public/lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx !== -1 ? Math.max(1, parseInt(process.argv[limIdx + 1], 10) || 100) : 100;

// ── tiny .env / wrangler.toml readers (no deps) ──────────────────────────────
function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function supabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/$/, '');
  const toml = join(ROOT, 'site', 'wrangler.toml');
  if (existsSync(toml)) {
    const m = readFileSync(toml, 'utf8').match(/SUPABASE_URL\s*=\s*"([^"]+)"/);
    if (m) return m[1].replace(/\/$/, '');
  }
  return null;
}

async function serviceKey(url) {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  const pat = process.env.SUPABASE_TOKEN || readEnvFile(join(ROOT, '..', 'arcade', '.env')).SUPABASE_TOKEN;
  if (!pat) return null;
  const ref = new URL(url).hostname.split('.')[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${pat}` } });
  if (!res.ok) return null;
  const keys = await res.json();
  return (keys.find((k) => k.name === 'service_role') || {}).api_key || null;
}

// ── local brain notes (for ranking targets) ─────────────────────────────────
const IGNORE = new Set(['site', 'node_modules', '.git', 'scripts', '.github']);
function walk(dir, acc = {}) {
  for (const name of readdirSync(dir)) {
    if (dir === ROOT && IGNORE.has(name)) continue;
    const p = join(dir, name); const s = statSync(p);
    if (s.isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else if (name.endsWith('.md')) acc[relative(ROOT, p)] = readFileSync(p, 'utf8');
  }
  return acc;
}

// ── run ──────────────────────────────────────────────────────────────────────
const url = supabaseUrl();
if (!url) { console.error('No SUPABASE_URL (set env or site/wrangler.toml).'); process.exit(1); }
const key = await serviceKey(url);
if (!key) { console.error('No service key. Set SUPABASE_SERVICE_KEY, or SUPABASE_TOKEN (env or arcade/.env).'); process.exit(1); }

const res = await fetch(`${url}/rest/v1/vbrain_captures?filed=eq.false&select=id,text,created_at&order=created_at.asc&limit=${LIMIT}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) { console.error(`Supabase ${res.status}`); process.exit(1); }
const captures = await res.json();
const files = walk(ROOT);

const plan = captures.map((c) => ({
  id: c.id,
  text: c.text,
  created_at: c.created_at,
  suggestions: rankHits(files, c.text).slice(0, 3).map((h) => ({ path: h.path, title: titleOf(files[h.path], h.path) })),
}));

if (JSON_OUT) { console.log(JSON.stringify({ count: plan.length, plan }, null, 2)); process.exit(0); }

console.log(`\n🗂  Inbox — ${plan.length} unfiled capture${plan.length === 1 ? '' : 's'}\n`);
if (!plan.length) { console.log('Nothing to file. 🎉\n'); process.exit(0); }
for (const c of plan) {
  const when = (c.created_at || '').slice(0, 10);
  console.log(`#${c.id}  (${when})  ${c.text.replace(/\s+/g, ' ').slice(0, 100)}`);
  if (c.suggestions.length) {
    console.log('   → file into: ' + c.suggestions.map((s) => `${s.path}`).join('  ·  '));
  } else {
    console.log('   → no strong match; consider a new note (scripts/new-note.mjs).');
  }
  console.log('');
}
console.log('File them in the brain UI inbox (#/inbox; writes need GITHUB_WRITE_TOKEN), or edit the note directly.\n');
