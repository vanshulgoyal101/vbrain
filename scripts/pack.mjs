#!/usr/bin/env node
// vbrain pack — export the brain for LLM context, inspired by gbrain's
// llms.txt / llms-full.txt and ctx's pack_repo.
//
// Usage:
//   node scripts/pack.mjs               # index (llms.txt style): file -> TL;DR
//   node scripts/pack.mjs --full        # whole brain concatenated (one paste)
//   node scripts/pack.mjs --full --out brain.txt
//
// Piping the --full output into any chat gives an agent the entire brain at once.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE = new Set(['site', 'node_modules', '.git', 'scripts']);
const ORDER = ['', 'career', 'projects', 'ideas', 'learnings', 'infra'];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (dir === ROOT && IGNORE.has(name)) continue;
    const p = join(dir, name); const s = statSync(p);
    if (s.isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else if (name.endsWith('.md')) acc.push(relative(ROOT, p));
  }
  return acc;
}

const files = walk(ROOT);
const section = (f) => (f.includes('/') ? f.split('/')[0] : '');
files.sort((a, b) => {
  const sa = ORDER.indexOf(section(a)), sb = ORDER.indexOf(section(b));
  if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
  return a.localeCompare(b);
});

const tldr = (text) => {
  const m = text.match(/^>\s*(.+)$/m);
  if (!m) return '';
  return m[1].replace(/\*\*/g, '').replace(/^\W*TL;?DR\W*/i, '').trim();
};
const estTokens = (s) => Math.ceil(s.length / 4);

const FULL = process.argv.includes('--full');
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx !== -1 ? process.argv[outIdx + 1] : null;

let result;
if (!FULL) {
  const lines = ['# vbrain — index', '', 'A second brain. One line per note.', ''];
  let cur = null;
  for (const f of files) {
    const s = section(f);
    if (s !== cur) { cur = s; lines.push(`\n## ${s || 'overview'}`); }
    lines.push(`- ${f} — ${tldr(readFileSync(join(ROOT, f), 'utf8'))}`);
  }
  result = lines.join('\n') + '\n';
} else {
  const parts = [
    '# vbrain — full export',
    'A second brain, concatenated for LLM context. Sections are files.',
    '',
  ];
  for (const f of files) {
    parts.push(`\n\n${'='.repeat(72)}\n# FILE: ${f}\n${'='.repeat(72)}\n`);
    parts.push(readFileSync(join(ROOT, f), 'utf8').trim());
  }
  result = parts.join('\n') + '\n';
}

if (outFile) {
  writeFileSync(resolve(ROOT, outFile), result);
  console.error(`Wrote ${outFile} (${files.length} files, ~${estTokens(result)} tokens)`);
} else {
  process.stdout.write(result);
  console.error(`\n[${files.length} files, ~${estTokens(result)} tokens]`);
}
