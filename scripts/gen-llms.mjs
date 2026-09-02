#!/usr/bin/env node
// vbrain gen-llms — generate the canonical, committed llms.txt + llms-full.txt
// from MAP.md, the single source of truth. Inspired by gbrain's `build:llms`.
//
//   llms.txt        a compact, sectioned index (llmstxt.org style) for agents
//   llms-full.txt   the same index + every note inlined, for single-fetch context
//
// Usage:
//   node scripts/gen-llms.mjs           # write both files at the repo root
//   node scripts/gen-llms.mjs --check   # exit 1 if either file is stale (CI)
//
// MAP.md is authoritative: llms.txt is a DERIVED view, so it can never drift.
// The validator (validate.mjs) also fails if these files are stale.
//
// Set LLMS_REPO_BASE to emit absolute raw URLs instead of relative paths, e.g.
//   LLMS_REPO_BASE=https://raw.githubusercontent.com/your-username/vbrain/main

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.LLMS_REPO_BASE || '').replace(/\/$/, '');
const href = (p) => (BASE ? `${BASE}/${p}` : p);

const HOOK =
  'A second brain built with vbrain: durable, refactor-safe Markdown notes about ' +
  'projects, learnings, and direction. MAP.md is the source of truth; this file is ' +
  'generated from it.';

const READ_ORDER =
  'Read order for agents: AGENTS.md. Rulebook: CONVENTIONS.md + STYLE.md (voice). ' +
  'Paths are relative to the repo root.';

const OPS = [
  ['node scripts/validate.mjs', 'structure / links / MAP coverage / secrets / voice checks (run after edits)'],
  ['node scripts/gen-llms.mjs', 'regenerate llms.txt + llms-full.txt from MAP.md (run when notes change)'],
  ['node scripts/doctor.mjs', '0–100 health score + orphans / staleness / verify-me'],
  ['node scripts/graph.mjs', 'knowledge graph: hubs, orphans, under-connected notes'],
  ['node scripts/pack.mjs --full', 'ad-hoc whole-brain dump to stdout for pasting into a chat'],
  ['node scripts/new-note.mjs <path> <title> <tldr>', 'scaffold a correctly-shaped note'],
];

// ── parse MAP.md into ordered sections of { path, summary } ───────────────────
function parseMap() {
  const text = readFileSync(join(ROOT, 'MAP.md'), 'utf8');
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = { title: h[1], rows: [] }; sections.push(cur); continue; }
    if (!cur || !line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const linkCell = cells.find((c) => /\]\(([^)]+)\)/.test(c)) || '';
    const m = linkCell.match(/\]\(([^)#]+)\)/);
    if (!m) continue;
    const path = m[1].replace(/\/$/, '');
    if (!path.endsWith('.md')) continue;
    const summary = (cells[cells.length - 2] || '').trim();
    cur.rows.push({ path, summary });
  }
  return sections.filter((s) => s.rows.length);
}

function buildIndex() {
  const out = ['# vbrain', '', `> ${HOOK}`, '', READ_ORDER, ''];
  for (const s of parseMap()) {
    out.push(`## ${s.title}`, '');
    for (const { path, summary } of s.rows) out.push(`- [${path}](${href(path)})${summary ? `: ${summary}` : ''}`);
    out.push('');
  }
  out.push('## Operational tips', '');
  for (const [cmd, desc] of OPS) out.push(`- \`${cmd}\` — ${desc}`);
  out.push('');
  return out.join('\n');
}

export function buildLlmsTxt() {
  return buildIndex();
}

export function buildLlmsFullTxt() {
  const seen = new Set();
  const parts = [buildIndex().trimEnd(), '', '---', '', '# Full contents', ''];
  for (const s of parseMap()) {
    for (const { path } of s.rows) {
      if (seen.has(path)) continue;
      seen.add(path);
      const abs = join(ROOT, path);
      if (!existsSync(abs)) continue;
      parts.push(`## FILE: ${path}`, '', readFileSync(abs, 'utf8').trim(), '');
    }
  }
  return parts.join('\n') + '\n';
}

const TARGETS = [
  ['llms.txt', buildLlmsTxt],
  ['llms-full.txt', buildLlmsFullTxt],
];

// ── run ───────────────────────────────────────────────────────────────────────
if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = false;
  for (const [name, build] of TARGETS) {
    const want = build();
    const path = join(ROOT, name);
    const have = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (check) {
      if (have !== want) { stale = true; console.error(`✗ ${name} is stale — run: node scripts/gen-llms.mjs`); }
    } else {
      writeFileSync(path, want);
      console.error(`Wrote ${name} (${want.length} bytes)`);
    }
  }
  if (check && !stale) console.error('llms.txt + llms-full.txt are in sync.');
  process.exit(check && stale ? 1 : 0);
}
