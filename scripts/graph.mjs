#!/usr/bin/env node
// vbrain graph + gap analysis — inspired by gbrain's self-wiring knowledge graph.
// Builds the internal link graph and reports backlinks, orphans, under-connected
// notes, and hubs — so the brain stays well-woven, not a pile of disconnected files.
//
// Usage:
//   node scripts/graph.mjs                 # human report
//   node scripts/graph.mjs --backlinks X   # who links to file X (repo-relative)
//   node scripts/graph.mjs --json          # machine-readable graph

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE = new Set(['site', 'node_modules', '.git', 'scripts']);
const MAP = 'MAP.md';

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (dir === ROOT && IGNORE.has(name)) continue;
    const p = join(dir, name); const s = statSync(p);
    if (s.isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else if (name.endsWith('.md')) acc.push(relative(ROOT, p));
  }
  return acc;
}

const files = walk(ROOT).sort();
const set = new Set(files);
const outbound = new Map(files.map((f) => [f, new Set()]));
const inbound = new Map(files.map((f) => [f, new Set()]));

for (const f of files) {
  const text = readFileSync(join(ROOT, f), 'utf8');
  for (const m of text.matchAll(/\]\(([^)#]+\.md)[^)]*\)/g)) {
    const target = relative(ROOT, resolve(dirname(join(ROOT, f)), m[1]));
    if (set.has(target) && target !== f) { outbound.get(f).add(target); inbound.get(target).add(f); }
  }
}

const inCount = (f) => inbound.get(f).size;
const outCount = (f) => outbound.get(f).size;

const arg = process.argv[2];
if (arg === '--json') {
  const g = Object.fromEntries(files.map((f) => [f, { out: [...outbound.get(f)], in: [...inbound.get(f)] }]));
  console.log(JSON.stringify(g, null, 2));
  process.exit(0);
}
if (arg === '--backlinks') {
  const target = process.argv[3];
  if (!set.has(target)) { console.error(`Not a brain file: ${target}`); process.exit(1); }
  console.log(`Backlinks to ${target}:`);
  for (const f of [...inbound.get(target)].sort()) console.log(`  ${f}`);
  process.exit(0);
}

// ── report ────────────────────────────────────────────────────────────────────
// "orphan" = nothing links to it except the MAP index.
const orphans = files.filter((f) => f !== MAP && [...inbound.get(f)].every((s) => s === MAP));
const underOut = files.filter((f) => f !== MAP && outCount(f) < 2);
const hubs = [...files].sort((a, b) => inCount(b) - inCount(a)).slice(0, 8);

console.log('── vbrain graph ──');
console.log(`files: ${files.length}   edges: ${[...outbound.values()].reduce((n, s) => n + s.size, 0)}`);

console.log('\nTop hubs (most linked-to):');
for (const f of hubs) console.log(`  ${String(inCount(f)).padStart(2)}  ${f}`);

console.log(`\nOrphans (only reachable via ${MAP} — weave these in): ${orphans.length}`);
for (const f of orphans) console.log(`  ${f}`);

console.log(`\nUnder-connected (<2 outbound links — add cross-links): ${underOut.length}`);
for (const f of underOut) console.log(`  ${outCount(f)}  ${f}`);

console.log('\nTip: node scripts/graph.mjs --backlinks <path>  to see who links to a note.');
